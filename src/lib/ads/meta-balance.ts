import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* =====================================================================
   Saldo real da conta de anúncios
   ---------------------------------------------------------------------
   Substitui `saldoSimulado`, que derivava um número entre R$ 0 e R$ 800
   de um hash do id do cliente. Era placeholder declarado no código — só
   que numa tela chamada "Alertas de saldo", em produção, alimentando
   decisão sobre dinheiro real. Um alerta inventado é pior que alerta
   nenhum: ensina a equipe a confiar num número que não existe.

   ⚠️ `balance` NÃO É SALDO DISPONÍVEL. Medido contra o painel numa conta
   real: a Graph API devolveu `balance: 2334` (R$ 23,34) enquanto o
   painel mostrava R$ 341,77 de fundos. Os R$ 23,34 são o valor
   ACUMULADO A PAGAR desde o último débito — ele SOBE conforme veicula,
   e zera quando a Meta cobra.

   ⚠️ CORREÇÃO DE 19/08/2026, medida contra 5 contas reais da carteira.
   O parágrafo anterior aqui afirmava que a carteira não era obtenível e
   que `is_prepay_account` voltava sempre false. As duas coisas estavam
   erradas:

     • `is_prepay_account` volta TRUE nas cinco contas testadas. Ele é
       fonte confiável para saber se a conta tem carteira — e substitui
       a marcação manual em `client_integrations.billing_type`, que
       nascia "postpaid" e fazia a tela afirmar pós-paga sobre conta que
       ninguém tinha classificado.

     • `spend_cap − amount_spent` é um PISO do disponível, não o
       disponível. Conferido contra o Gerenciador de Anúncios nas cinco
       contas, no mesmo dia:

           conta              painel      cap−gasto    erro
           Camilo Scooters    548,25      481,64       −66,61
           Citolab            146,62      128,81       −17,81
           Óticas Xavier       51,24       45,01        −6,23
           Loro Lanches         0,00        0,00            0
           Bini Embalagens      0,00        0,00            0

       Erra 12% a 14% nas contas com saldo, e SEMPRE PARA MENOS. Somar
       `balance` não corrige: acerta Citolab (147,57 contra 146,62) e
       erra 43 reais no Camilo. Não achei modelo que feche nas cinco.

       Por que mesmo assim é usado: para um alerta de "recarregue antes
       de acabar", errar para menos é o lado seguro — antecipa o aviso.
       Errar para mais deixaria o anúncio cair sem avisar. Por isso o
       número é apresentado como MÍNIMO, nunca como saldo.

   O que continua verdadeiro: `balance` NÃO é saldo. Nas mesmas cinco
   contas ele voltou entre R$ 0,00 e R$ 23,32, sem relação com o
   disponível. Projetar a partir dele inverte o alerta.

   ⚠️ A FÓRMULA SÓ VALE COM `is_prepay_account = true`. Em conta
   pós-paga o `spend_cap` é um limite de gasto de verdade, e a mesma
   subtração diria "saldo" onde há apenas margem até o teto.
   ===================================================================== */

export interface ContaSaldo {
  /**
   * Disponível de fato: `spend_cap − amount_spent`. `null` em conta
   * pós-paga, onde a subtração não significa saldo.
   */
  availableCents: number | null;
  /** A conta tem carteira, segundo a própria Graph API. */
  isPrepay: boolean;
  /** `balance` cru da Graph: acumulado A PAGAR. NÃO é saldo. */
  balanceCents: number;
  currency: string;
  /** `funding_source_details.type` da Graph API. */
  fundingType: number | null;
  /** Ex.: "VISA *1346". */
  fundingLabel: string | null;
  amountSpentCents: number;
}

interface RespostaConta {
  balance?: string;
  amount_spent?: string;
  spend_cap?: string;
  is_prepay_account?: boolean;
  currency?: string;
  funding_source_details?: { type?: number; display_string?: string };
  error?: { message?: string; code?: number };
}

/**
 * Saldo das contas pré-pagas do Meta, indexado por `client_id`.
 *
 * service_role: `integration_secrets` tem RLS ligada e zero policies —
 * nenhuma sessão alcança token. Só o servidor.
 *
 * Falha de uma conta não derruba as outras: a tela precisa mostrar o
 * que conseguiu, e uma conta sem saldo aparece como indisponível em vez
 * de sumir.
 */
export async function fetchPrepaidBalances(): Promise<
  Map<string, ContaSaldo>
> {
  const saldos = new Map<string, ContaSaldo>();
  if (!serverEnv.metaAppId) return saldos;

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("client_integrations")
    .select("client_id, external_account_id, integration_secrets(access_token)")
    .eq("platform", "meta_ads")
    /* SEM filtro de `billing_type`: quem decide se a conta é pré-paga
       agora é a própria Meta, via `is_prepay_account`. Filtrar pela
       coluna manual deixava de fora justamente as contas que ninguém
       classificou — que eram todas. */
    .eq("is_active", true);

  const linhas = (data ?? []) as unknown as {
    client_id: string;
    external_account_id: string;
    integration_secrets?: { access_token?: string | null } | null;
  }[];

  await Promise.all(
    linhas.map(async (linha) => {
      const token = linha.integration_secrets?.access_token;
      if (!token || linha.external_account_id.startsWith("pending:")) return;

      const url = new URL(
        `https://graph.facebook.com/${serverEnv.metaApiVersion}/${linha.external_account_id}`,
      );
      url.searchParams.set(
        "fields",
        "balance,amount_spent,currency,funding_source_details,is_prepay_account,spend_cap",
      );

      try {
        const resposta = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          // Curto: a página não pode ficar pendurada por uma conta.
          signal: AbortSignal.timeout(8_000),
          cache: "no-store",
        });

        const dado = (await resposta.json()) as RespostaConta;
        if (!resposta.ok || dado.error || dado.balance === undefined) return;

        const isPrepay = dado.is_prepay_account === true;
        const cap = Number(dado.spend_cap ?? 0);
        const gasto = Number(dado.amount_spent ?? 0);

        /* Piso em zero: conta esgotada devolve alguns centavos
           negativos, porque a entrega ultrapassa o crédito por
           frações. "−R$ 0,03" na tela lê como erro do sistema. */
        const disponivel =
          isPrepay && cap > 0 ? Math.max(0, cap - gasto) : null;

        saldos.set(linha.client_id, {
          availableCents: disponivel,
          isPrepay,
          // `balance` já vem na menor unidade da moeda — o mesmo
          // centavo que o resto do sistema usa. Não dividir por 100.
          balanceCents: Number(dado.balance),
          currency: dado.currency ?? "BRL",
          fundingType: dado.funding_source_details?.type ?? null,
          fundingLabel: dado.funding_source_details?.display_string ?? null,
          amountSpentCents: gasto,
        });
      } catch {
        // Rede ou timeout: a conta fica sem saldo conhecido.
      }
    }),
  );

  return saldos;
}

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { conversionActionFor } from "@/lib/ads/conversion-action";
import { fetchAdInsights, type AdInsight } from "@/lib/ads/meta-ads";
import { normalizeCustomerId } from "@/lib/ads/normalize";

/* =====================================================================
   Desempenho dos criativos NA JANELA DO RELATÓRIO
   ---------------------------------------------------------------------
   ⚠️ POR QUE ISTO EXISTE, e por que ler o banco não bastava.

   `ad_creatives` guarda UMA linha por anúncio (migration 27: a chave é
   `client_id + platform + external_ad_id`, sem o período), sobrescrita
   por upsert a cada sincronização. Os números que estão lá são os da
   ÚLTIMA janela sincronizada, nunca os do relatório.

   MEDIDO NA CONTA CAPTAÇÃO D em 01/09/2026, e foi assim que o defeito
   apareceu: a conta investiu R$ 741,73 em agosto, e a galeria do
   relatório de agosto imprimia

       05 | DONO DE RESTAURANTE ....... R$ 9,60
       10 | NOVIDADES .................. R$ 0,72
       08 | FORNCEDOR IDEAL ............ R$ 0,60
       01 | FORNECEDOR ................. R$ 0,05
       06 | SALMÃO FRESCO .............. R$ 0,00
       09 | SHOYU ...................... R$ 0,00

   Os seis somavam R$ 10,97. Todos carregavam `period_start` e
   `period_end` iguais a 2026-09-01: a sincronização daquele dia rodou
   em `mode: "month"`, e no dia 1º o mês corrente é UM DIA SÓ. O card
   dizia "investido" e mostrava o gasto de um dia sob um relatório
   rotulado como agosto.

   COM A APURAÇÃO, na mesma conta e na mesma janela:

       05 | DONO DE RESTAURANTE ....... R$ 411,92
       01 | FORNECEDOR .................. R$ 68,84
       06 | SALMÃO FRESCO ................ R$ 37,81
       09 | SHOYU ........................ R$ 20,95
       07 | OPERAÇÃO Q FUNCIONA .......... R$ 15,25
       10 | NOVIDADES .................... R$ 12,55

   E FECHA: os 12 anúncios da janela somam R$ 747,53 contra os R$ 741,73
   que `daily_metrics` tem para a conta em agosto. A diferença de R$ 5,80
   é a Meta reprocessando — as linhas diárias foram gravadas antes.

   REPARE QUE A ESCOLHA TAMBÉM MUDA, não só os valores: "08 | FORNCEDOR
   IDEAL" saía na galeria por ter gastado R$ 0,60 no dia 1º de setembro,
   e sai da lista quando o critério passa a ser agosto.

   É PIOR JUSTAMENTE NO DIA 1º, que é quando os relatórios do mês
   fechado saem: a janela do sync é o próprio dia 1, os insights voltam
   quase vazios, e o `spend_cents` de TODOS os criativos é sobrescrito
   para perto de zero.

   A tabela é uma FOTO, não uma série temporal — não há como recuperar
   do banco o que cada anúncio gastou num período passado. Por isso a
   consulta é feita à Graph API, com a janela exata do relatório.

   ⚠️ MAPA VAZIO NÃO É ZERO. `fetchAdInsights` engole qualquer erro —
   rede, token vencido, conta sem Meta — e devolve Map vazio; o
   sincronizador converte isso em `?? 0`. Repetir esse padrão aqui
   reproduziria exatamente o defeito que este arquivo conserta: uma
   falha de rede viraria "R$ 0,00" impresso com confiança no documento
   do cliente. Aqui, falha devolve `null`, e quem chama mantém o que
   tinha e diz na página de onde vieram os números.
   ===================================================================== */

export interface MetricasDeCriativo {
  spendCents: number;
  conversions: number;
  impressions: number;
  clicks: number;
}

/**
 * Métricas por `external_ad_id` na janela pedida.
 *
 * `null` quando não deu para apurar: conta sem integração Meta, sem
 * token, ou a chamada falhou. Nunca devolve um mapa vazio como se
 * significasse "gastou zero".
 *
 * TIMEOUT CURTO de propósito. O padrão do módulo é 25s, pensado para a
 * sincronização noturna; aqui há alguém esperando na tela, e no cron o
 * orçamento é dividido entre TODOS os relatórios do dia. Uma conta
 * lenta não pode custar o relatório das outras — melhor a galeria sair
 * rotulada do que a fila inteira ser adiada.
 *
 * SÓ META. O Google não entra: a galeria de criativos é alimentada
 * apenas pela sincronização da Meta (`ad_creatives.platform` é sempre
 * `meta_ads`), e inventar um caminho aqui para uma origem que não
 * escreve na tabela seria código sem uso.
 */
export async function metricasDeCriativosNoPeriodo(
  clientId: string,
  since: string,
  until: string,
  timeoutMs = 7_000,
): Promise<Map<string, MetricasDeCriativo> | null> {
  try {
    /* Cliente ADMIN: o token vive em `integration_secrets`, tabela com
       RLS ligada e ZERO policies — nenhuma sessão de usuário alcança.
       A autorização de quem pediu o relatório já aconteceu antes, na
       resolução do cliente, que roda sob RLS. */
    const admin = createSupabaseAdminClient();

    const { data } = await admin
      .from("client_integrations")
      .select(
        "external_account_id, conversion_action_type, integration_secrets(access_token), clients(segment)",
      )
      .eq("client_id", clientId)
      .eq("platform", "meta_ads")
      .eq("is_active", true)
      .maybeSingle();

    const linha = data as unknown as {
      external_account_id: string | null;
      conversion_action_type: string | null;
      integration_secrets?: { access_token?: string | null } | null;
      clients?: { segment?: string | null } | null;
    } | null;

    const token = linha?.integration_secrets?.access_token;
    const conta = linha?.external_account_id;

    // `pending:` marca conta escolhida mas ainda não autorizada.
    if (!token || !conta || conta.startsWith("pending:")) return null;

    const insights = await fetchAdInsights(
      token,
      normalizeCustomerId(conta),
      since,
      until,
      conversionActionFor(
        linha?.clients?.segment as never,
        linha?.conversion_action_type as never,
      ),
      timeoutMs,
    );

    /* Mapa vazio = não apurou. Conta que realmente não veiculou no
       período devolve linhas com zero, não lista vazia — então tratar
       vazio como "tudo zero" só acerta por acidente e erra no caso que
       importa, que é a falha. */
    if (insights.size === 0) return null;

    return new Map(
      [...insights.entries()].map(([id, i]: [string, AdInsight]) => [
        id,
        {
          spendCents: i.spendCents,
          conversions: i.conversions,
          impressions: i.impressions,
          clicks: i.clicks,
        },
      ]),
    );
  } catch {
    return null;
  }
}

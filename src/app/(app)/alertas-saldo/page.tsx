import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import {
  DIAS_DE_ALERTA,
  DIAS_DE_ATENCAO,
  getBalanceAlerts,
} from "@/lib/ads/balances";
import { formatCurrency } from "@/lib/format";
import { getCurrentUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { BalanceAlert, BalanceStatus } from "@/lib/ads/balances";

export const metadata: Metadata = { title: "Alertas de saldo" };

/**
 * Alertas de saldo de mídia.
 *
 * Aberta a qualquer usuário autenticado — quem gerencia a conta precisa
 * ver antes de o anúncio cair, e isso não é dado financeiro da agência.
 *
 * Sem cache: um alerta de saldo desatualizado é pior que nenhum.
 */
export const dynamic = "force-dynamic";

/**
 * A página fala com DUAS APIs externas antes de renderizar — Graph API
 * e Google Ads, uma chamada por conta pré-paga. O padrão da Vercel é
 * curto demais para isso e o usuário veria timeout em vez de alerta.
 *
 * 60s é o teto do plano Hobby. Não é um orçamento a gastar: cada chamada
 * tem timeout próprio de 8s e uma repetição, então o pior caso real fica
 * na casa dos 17s. O valor aqui existe para o teto da plataforma não
 * cortar antes disso.
 */
export const maxDuration = 60;

export default async function BalanceAlertsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const alerts = await getBalanceAlerts();

  /* Uma LINHA POR CLIENTE, com as duas plataformas lado a lado. O motor
     devolve uma entrada por combinação cliente × plataforma, que é a
     forma certa para calcular e a errada para ler: com 34 clientes, a
     lista plana obrigava a procurar o mesmo nome duas vezes para saber
     se a conta como um todo está bem. */
  const porCliente = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      clientSlug: string;
      meta?: BalanceAlert;
      google?: BalanceAlert;
    }
  >();

  for (const a of alerts) {
    const linha = porCliente.get(a.clientId) ?? {
      clientId: a.clientId,
      clientName: a.clientName,
      clientSlug: a.clientSlug,
    };
    if (a.platform === "meta_ads") linha.meta = a;
    else linha.google = a;
    porCliente.set(a.clientId, linha);
  }

  /* Quem corre risco primeiro. `getBalanceAlerts` já ordena por status,
     mas ao agrupar por cliente o que vale é o PIOR das duas contas —
     senão uma conta crítica ficaria no meio da lista por causa da
     plataforma saudável ao lado. */
  const linhas = [...porCliente.values()].sort(
    (a, b) => urgencia(a) - urgencia(b) || a.clientName.localeCompare(b.clientName, "pt-BR"),
  );

  return (
    <PageContainer>
      <PageHeader
        title="⚠️ Alertas de saldo"
        description={`Saldo disponível e quanto ele dura no ritmo dos últimos dias. Crítico abaixo de ${DIAS_DE_ALERTA} dias, atenção abaixo de ${DIAS_DE_ATENCAO}.`}
      />

      {/* O aviso vem ANTES dos cards porque muda como o número deve ser
          lido — depois deles já é tarde. */}
      <div className="mt-6 rounded-xl border border-hairline bg-surface-2/60 p-4">
        <p className="text-sm font-medium">
          O saldo vem de lugares diferentes em cada plataforma
        </p>

        <p className="mt-1.5 text-xs text-muted-foreground">
          <strong>Meta:</strong> saldo informado na recarga menos o gasto desde
          então. O desconto vem da sincronização diária, então o número se
          mantém sozinho — só a recarga precisa ser anotada, em Contas de
          mídia na página do cliente.
        </p>
        <p className="mt-1 text-2xs text-muted-foreground">
          A Graph API não expõe a carteira: seu campo <code>balance</code> é o
          acumulado a pagar, que SOBE conforme veicula. Numa conta medida, ele
          devolvia R$ 23,34 enquanto o saldo real era R$ 341,77 — usá-lo
          inverteria o alerta.
        </p>

        <p className="mt-3 text-xs text-muted-foreground">
          <strong>Google:</strong> lido direto da API, do orçamento da conta
          (limite ajustado menos o valor já servido). Não precisa ser anotado
          à mão.
        </p>
        <p className="mt-1 text-2xs text-muted-foreground">
          Usamos o limite <em>ajustado</em>, não o aprovado: o aprovado ignora
          créditos e estornos. Numa conta medida, o aprovado devolvia
          −R$ 767,09 onde havia R$ 750,43 de folga. Conta em faturamento
          sem teto aparece como &ldquo;sem teto&rdquo;, sem projeção.
        </p>
        <p className="mt-1 text-2xs text-warning">
          Ainda não conferimos o número do Google contra o painel do Google
          Ads. Antes de usá-lo para decidir recarga, compare uma conta.
        </p>

        <p className="mt-3 text-2xs text-muted-foreground">
          A carteira inteira aparece abaixo. Traço significa plataforma não
          conectada naquele cliente; <em>pós-paga</em>{" "}
          significa conta sem
          crédito a esgotar, onde a pergunta &ldquo;quantos dias faltam&rdquo;
          não se aplica. O ritmo é a média dos dias em que a conta gastou na
          última semana — não dos 7 corridos, que subestimaria conta nova.
        </p>
      </div>

      {linhas.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-hairline py-16 text-center">
          <CheckCircle2 className="mx-auto size-8 text-positive" />
          <p className="mt-3 text-sm font-medium">Nenhuma conta ativa</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cadastre um cliente para acompanhar o saldo das contas de mídia.
          </p>
        </div>
      ) : (
        <div className="surface-card mt-6 overflow-hidden">
          <div className="hidden grid-cols-[1fr_repeat(2,minmax(0,200px))] gap-4 border-b border-hairline px-4 py-2.5 md:grid">
            {["Cliente", "Meta Ads", "Google Ads"].map((l) => (
              <span key={l} className="eyebrow">
                {l}
              </span>
            ))}
          </div>

          <ul className="divide-y divide-hairline">
            {linhas.map((linha) => (
              <li
                key={linha.clientId}
                className="grid grid-cols-1 gap-x-4 gap-y-3 px-4 py-3 md:grid-cols-[1fr_repeat(2,minmax(0,200px))] md:items-center"
              >
                <Link
                  href={`/clientes/${linha.clientSlug}`}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {linha.clientName}
                </Link>
                <Celula alerta={linha.meta} rotulo="Meta Ads" />
                <Celula alerta={linha.google} rotulo="Google Ads" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageContainer>
  );
}


/* =====================================================================
   A célula de uma plataforma
   ---------------------------------------------------------------------
   Saldo e dias restantes NA MESMA CÉLULA porque nenhum dos dois
   significa nada sozinho: "R$ 500" pode ser folga de um mês ou de meio
   dia, e é o ritmo ao lado que decide. Separá-los em colunas obrigaria
   quem lê a fazer a divisão de cabeça — exatamente o trabalho que esta
   tela existe para poupar.

   TRÊS AUSÊNCIAS DIFERENTES, três textos diferentes. Achatá-las num
   traço só faria "ainda não conectei" parecer igual a "conectei e não
   sei o saldo", que pedem ações opostas.
   ===================================================================== */

const COR: Record<BalanceStatus, string> = {
  critical: "text-negative",
  warning: "text-warning",
  healthy: "text-positive",
  /* Cinza, não amarelo: não saber o saldo não é alerta sobre a conta, é
     pendência de cadastro. Amarelo misturaria as duas na varredura. */
  unknown: "text-muted-foreground",
  unlimited: "text-muted-foreground",
};

function Celula({
  alerta,
  rotulo,
}: {
  alerta: BalanceAlert | undefined;
  rotulo: string;
}) {
  /* Não conectada: um traço, e nada mais. Foi o que o pedido definiu, e
     é honesto — não há número a mostrar nem ação a sugerir aqui. */
  if (!alerta || !alerta.connected) {
    return (
      <span className="text-sm text-muted-foreground">
        <span className="mr-2 text-2xs uppercase tracking-wide md:hidden">
          {rotulo}
        </span>
        —
      </span>
    );
  }

  if (alerta.billingType === "postpaid") {
    return (
      <span className="text-xs text-muted-foreground">
        <span className="mr-2 text-2xs uppercase tracking-wide md:hidden">
          {rotulo}
        </span>
        Pós-paga
      </span>
    );
  }

  const cor = COR[alerta.status];

  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-wide text-muted-foreground md:hidden">
        {rotulo}
      </span>

      <span className={cn("text-sm font-semibold tabular-nums", cor)}>
        {alerta.status === "unlimited"
          ? "Sem teto"
          : alerta.currentBalance === null
            ? "Saldo não informado"
            : formatCurrency(alerta.currentBalance)}
      </span>

      <span className="text-2xs text-muted-foreground">{legenda(alerta)}</span>
    </span>
  );
}

/**
 * A segunda linha da célula: quantos dias faltam, ou por que não dá
 * para dizer.
 *
 * Cada "não sei" tem um motivo diferente e uma ação diferente, então
 * cada um ganha a própria frase em vez de um "indefinido" genérico.
 */
function legenda(a: BalanceAlert): string {
  if (a.status === "unlimited") return "Faturamento sem teto a esgotar";

  if (a.currentBalance === null) {
    return a.platform === "meta_ads"
      ? "Informe a recarga em Contas de mídia"
      : "Não localizado na API — confira o faturamento";
  }

  if (a.currentBalance === 0) return "Anúncios podem estar fora do ar";

  if (a.daysLeft === null) return "Sem gasto recente — não dá para projetar";

  /* "0 dias" com saldo na conta lê como erro; o que o número diz é
     "menos de um dia". */
  if (a.daysLeft === 0) return "Acaba hoje no ritmo atual";

  const dias = a.daysLeft === 1 ? "Resta 1 dia" : `Restam ${a.daysLeft} dias`;
  return `${dias} · ${formatCurrency(a.burnRate)}/dia`;
}

/**
 * Peso de urgência de um cliente: o PIOR das suas duas plataformas.
 *
 * Sem isto, um cliente com a conta do Meta crítica cairia no meio da
 * lista por causa do Google saudável ao lado — e a tela existe
 * justamente para essa conta aparecer primeiro.
 */
const PESO_STATUS: Record<BalanceStatus, number> = {
  critical: 0,
  warning: 1,
  unknown: 3,
  unlimited: 4,
  healthy: 2,
};

function urgencia(linha: {
  meta?: BalanceAlert;
  google?: BalanceAlert;
}): number {
  const pesos = [linha.meta, linha.google]
    /* Não conectada e pós-paga não competem por atenção: nenhuma das
       duas pede ação nesta tela. */
    .filter((a): a is BalanceAlert => Boolean(a?.connected && a.billingType === "prepaid"))
    .map((a) => PESO_STATUS[a.status]);

  return pesos.length ? Math.min(...pesos) : 9;
}

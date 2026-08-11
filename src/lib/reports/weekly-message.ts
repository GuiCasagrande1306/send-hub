import { deriveMetric, type MetricTotals } from "@/lib/metrics/kpi";
import {
  formatCurrency,
  formatDecimal,
  formatNumber,
  formatPeriodNumeric,
} from "@/lib/format";
import type { ClientSegment } from "@/types/database";

/* =====================================================================
   Resumo semanal por WhatsApp
   ---------------------------------------------------------------------
   Uma mensagem de texto, sem anexo. O PDF continua sendo coisa do
   fechamento mensal: sete dias não sustentam quinze páginas de leitura,
   e o cliente que recebe PDF toda semana para de abrir os dois.

   O QUE VARIA POR NICHO, e por quê. "Faturamento", "ROAS" e "Ticket
   médio" só existem onde a plataforma vê o valor da conversão. Numa
   clínica ou num escritório, o pixel vê o formulário enviado e nunca o
   contrato assinado — mandar "ROAS: 0,00" para essa conta não é um
   número ruim, é um número FALSO, e ensina o cliente a ignorar o resumo
   inteiro. Então o bloco muda com o segmento, na mesma lógica que
   `metrics/goal-metric.ts` já usa para o rótulo da meta.

   Nada aqui recalcula nada: os números saem de `deriveMetric`, o mesmo
   motor do painel e do PDF. Se o resumo divergir da tela, é bug do
   motor — não existe segunda fonte para conferir.
   ===================================================================== */

/** Linha pronta da mensagem. `null` some do texto em vez de virar zero. */
type Linha = string | null;

export interface WeeklySummaryInput {
  clientName: string;
  segment: ClientSegment;
  /** YYYY-MM-DD. */
  periodStart: string;
  /** YYYY-MM-DD. */
  periodEnd: string;
  totals: MetricTotals;
  /**
   * Alcance do período INTEIRO, como a plataforma reporta.
   *
   * Não é somatório de dias: alcance conta pessoas, e quem foi
   * alcançado terça e quinta entraria duas vezes. Por isso ele chega de
   * fora, já consultado para a janela fechada — e `null` quando a
   * consulta não respondeu, caso em que a linha simplesmente não sai.
   */
  reach?: number | null;
}

interface Bloco {
  /** Completa "campanhas de …" no cumprimento. */
  assunto: string;
  linhas: (i: WeeklySummaryInput) => Linha[];
}

const dinheiro = (cents: number) => formatCurrency(Math.round(cents));

/* Compra e pedido têm valor rastreado pelo pixel; lead e visita não.
   É a mesma divisão de `PADRAO_POR_SEGMENTO` em goal-metric.ts. */
function blocoComReceita(rotuloConversao: string): Bloco["linhas"] {
  return ({ totals }) => [
    `💵Ticket Médio: ${dinheiro(deriveMetric("aov", totals))}`,
    `🛒${rotuloConversao}: ${formatNumber(Math.round(totals.conversions))}`,
    `💰Faturamento: ${dinheiro(totals.revenueCents)}`,
    `💵 Valor investido: ${dinheiro(totals.spendCents)}`,
    `📊ROAS: ${formatDecimal(deriveMetric("roas", totals))}`,
  ];
}

function blocoSemReceita(
  rotuloConversao: string,
  rotuloCusto: string,
): Bloco["linhas"] {
  return ({ totals }) => [
    `📩${rotuloConversao}: ${formatNumber(Math.round(totals.conversions))}`,
    `💵${rotuloCusto}: ${dinheiro(deriveMetric("cpa", totals))}`,
    `💵 Valor investido: ${dinheiro(totals.spendCents)}`,
  ];
}

const BLOCOS: Record<ClientSegment, Bloco> = {
  ecommerce: {
    assunto: "Vendas",
    linhas: blocoComReceita("Vendas"),
  },
  delivery: {
    assunto: "Delivery",
    linhas: blocoComReceita("Pedidos"),
  },
  leads: {
    assunto: "Captação",
    linhas: blocoSemReceita("Leads", "Custo por lead"),
  },
  local_business: {
    /* "Visitas ao perfil" é o indicador real desta conta — ver a nota em
       goal-metric.ts sobre de onde ele vem. */
    assunto: "Presença local",
    linhas: blocoSemReceita("Visitas ao perfil", "Custo por visita"),
  },
};

/**
 * Monta o texto que vai para o WhatsApp do cliente.
 *
 * Sem negrito nem formatação do WhatsApp de propósito: o asterisco vira
 * literal em alguns clientes de desktop e no espelho da web, e um
 * relatório com `*` solto no meio parece erro de sistema.
 */
export function buildWeeklySummary(input: WeeklySummaryInput): string {
  const bloco = BLOCOS[input.segment];

  const linhas: Linha[] = [
    input.reach != null ? `Alcance: ${formatNumber(input.reach)}` : null,
    `Impressões: ${formatNumber(input.totals.impressions)}`,
    ...bloco.linhas(input),
  ];

  return [
    `Olá! Segue abaixo relatório das campanhas de ${bloco.assunto}!`,
    "",
    `Período: ${formatPeriodNumeric(input.periodStart, input.periodEnd)}`,
    "",
    ...linhas.filter((l): l is string => l !== null),
  ].join("\n");
}

/**
 * A conta não veiculou nada na semana.
 *
 * Vale uma checagem à parte porque a mensagem "tudo zero" é pior que
 * mensagem nenhuma: o cliente lê como queda de resultado, quando na
 * verdade a campanha estava pausada. Quem chama decide se pula o envio
 * ou avisa a equipe.
 */
export function semVeiculacao(totals: MetricTotals): boolean {
  return totals.spendCents === 0 && totals.impressions === 0;
}

import "server-only";

import { tiposDeConversaoDoCliente } from "@/lib/ads/conversao-do-cliente";
import {
  metricasDeCriativosNoPeriodo,
  type MetricasDeCriativo,
} from "./creative-insights";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildTrend,
  computeKpi,
  previousPeriod,
  splitByPlatform,
  sumMetrics,
  type KpiResult,
  type PlatformSplit,
} from "@/lib/metrics/kpi";
import {
  buildPlatformDetail,
  type PlatformDetail,
} from "./platform-detail";
import type {
  AdCreative,
  Client,
  DailyMetric,
  MetricKey,
} from "@/types/database";

/* =====================================================================
   Dados da página de impressão
   ---------------------------------------------------------------------
   Usa o cliente `service_role`, que IGNORA RLS — porque quem chama é o
   Puppeteer, sem sessão. A autorização acontece ANTES, na validação do
   token HMAC: a página só chega aqui depois de provar que o pedido
   partiu do nosso próprio servidor.
   ===================================================================== */

const HERO_METRICS: MetricKey[] = ["spend", "results", "cpa"];

/**
 * Rótulos do template da conta, pelo cliente ADMIN.
 *
 * Existe porque o mesmo `conversions` é "Vendas" numa conta e
 * "Contatos" noutra, e quem define isso é `report_templates.metric_labels`.
 * Sem esta leitura, a folha revisada na tela dizia "Resultados" e o PDF
 * enviado ao cliente dizia "Vendas" — mesmos números, palavras
 * diferentes, no documento que a equipe usa justamente para conferir.
 *
 * Admin e não RLS pelo mesmo motivo do resto do arquivo: quem chama
 * pode ser o Puppeteer, sem sessão. A autorização acontece antes, na
 * página.
 */
async function rotulosDoTemplate(
  client: Client,
): Promise<Partial<Record<MetricKey, string>>> {
  if (isDemoMode) {
    const { demoTemplates } = await import("@/lib/mock/data");
    const t =
      demoTemplates.find((x) => x.segment === client.segment && x.is_default) ??
      demoTemplates.find((x) => x.segment === client.segment);
    return t?.metric_labels ?? {};
  }

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("report_templates")
    .select("metric_labels, is_default")
    .eq("segment", client.segment)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.metric_labels ?? {}) as Partial<Record<MetricKey, string>>;
}

export interface PrintReportData {
  client: Client;
  kpis: KpiResult[];
  platforms: PlatformSplit[];
  /**
   * Uma entrada por plataforma com veiculação. Sai do MESMO
   * `buildPlatformDetail` que o PDF usa — sem isso, a folha revisada na
   * tela e o arquivo enviado ao cliente mostrariam contas diferentes.
   */
  platformDetail: PlatformDetail[];
  creatives: AdCreative[];
  /**
   * Os números da galeria são DESTA janela?
   *
   * `false` quando a apuração na Graph API não respondeu e os cards
   * caíram no que `ad_creatives` tinha — o gasto da última
   * sincronização, que é outra janela. A folha precisa dizer isso: um
   * número de setembro sob um relatório de agosto, sem ressalva, é pior
   * que nenhum número.
   */
  criativosDoPeriodo: boolean;
  /** Agregado por semana — o gráfico do resumo executivo. */
  weekly: { label: string; spend: number; results: number }[];
  totals: { spendCents: number; results: number };
  period: { start: string; end: string };
}

export async function getPrintReportData(
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PrintReportData | null> {
  if (isDemoMode) {
    const { demoClients, demoMetrics, demoCreatives } = await import(
      "@/lib/mock/data"
    );
    const client = demoClients.find((c) => c.id === clientId);
    if (!client) return null;

    const inRange = (m: DailyMetric, a: string, b: string) =>
      m.client_id === clientId && m.metric_date >= a && m.metric_date <= b;

    const prev = previousPeriod(periodStart, periodEnd);

    return assemble(
      client,
      demoMetrics.filter((m) => inRange(m, periodStart, periodEnd)),
      demoMetrics.filter((m) => inRange(m, prev.start, prev.end)),
      demoCreatives
        .filter((c) => c.client_id === clientId && c.is_active)
        .sort((a, b) => b.spend_cents - a.spend_cents)
        .slice(0, 6),
      periodStart,
      periodEnd,
      await rotulosDoTemplate(client),
      await tiposDeConversaoDoCliente(clientId),
    );
  }

  const admin = createSupabaseAdminClient();
  const prev = previousPeriod(periodStart, periodEnd);

  const [clientRes, current, previous, creatives] = await Promise.all([
    admin.from("clients").select("*").eq("id", clientId).maybeSingle(),
    admin
      .from("daily_metrics")
      .select("*")
      .eq("client_id", clientId)
      .gte("metric_date", periodStart)
      .lte("metric_date", periodEnd),
    admin
      .from("daily_metrics")
      .select("*")
      .eq("client_id", clientId)
      .gte("metric_date", prev.start)
      .lte("metric_date", prev.end),
    /* CANDIDATOS, não a lista final. O corte em seis passou a ser feito
       DEPOIS de apurar a janela — ordenar por `spend_cents` aqui é
       ordenar pelo gasto da última sincronização, que é justamente o
       número errado. 48 cobre com folga a carteira: a conta com mais
       anúncios ativos tem uma dúzia. */
    admin
      .from("ad_creatives")
      .select("*")
      .eq("client_id", clientId)
      .eq("is_active", true)
      .order("spend_cents", { ascending: false })
      .limit(48),
  ]);

  if (!clientRes.data) return null;

  const client = clientRes.data as Client;

  /* O gasto de cada anúncio NA JANELA DO RELATÓRIO, direto da Graph
     API. `ad_creatives` guarda uma foto do último sync — ver o cabeçalho
     de `creative-insights.ts`. */
  const metricasDoPeriodo = await metricasDeCriativosNoPeriodo(
    clientId,
    periodStart,
    periodEnd,
  );

  return assemble(
    client,
    (current.data ?? []) as DailyMetric[],
    (previous.data ?? []) as DailyMetric[],
    aplicarMetricas((creatives.data ?? []) as AdCreative[], metricasDoPeriodo, 6),
    periodStart,
    periodEnd,
    await rotulosDoTemplate(client),
    await tiposDeConversaoDoCliente(clientId),
    metricasDoPeriodo !== null,
  );
}

/**
 * Aplica as métricas do período aos criativos e reordena.
 *
 * O corte em seis era feito no banco, ordenado por `spend_cents` — a
 * coluna com o gasto da ÚLTIMA sincronização. Números de uma janela em
 * cards escolhidos por outra: a galeria mostrava os anúncios que mais
 * gastaram ONTEM com os valores de ontem, sob um relatório de agosto.
 *
 * `null` = não deu para apurar: mantém o que veio do banco, sem zerar.
 * Zerar seria trocar um número errado por outro, e o de agora ao menos
 * é o gasto real de ALGUMA janela.
 */
export function aplicarMetricas(
  criativos: AdCreative[],
  metricas: Map<string, MetricasDeCriativo> | null,
  limite: number,
): AdCreative[] {
  if (!metricas) return criativos.slice(0, limite);

  return [...criativos]
    .map((ad) => {
      const m = metricas.get(ad.external_ad_id);
      /* Sem linha nos insights = não veiculou na janela. Zero aqui é
         verdade, porque o mapa veio preenchido. */
      return {
        ...ad,
        spend_cents: m?.spendCents ?? 0,
        conversions: m?.conversions ?? 0,
        impressions: m?.impressions ?? 0,
        clicks: m?.clicks ?? 0,
      };
    })
    /* ⚠️ QUEM NÃO VEICULOU NA JANELA SAI DA GALERIA. A seção se chama
       "Anúncios no ar" e fala do período da capa; um anúncio criado
       depois dele aparecia ali com "R$ 0,00 · 0 resultados · 0,00%",
       porque a lista era preenchida até seis a qualquer custo.

       Visto no relatório de agosto de uma conta de delivery: três dos
       seis cartões eram anúncios de 02/09 e 08/09 — criados DEPOIS do
       mês fechado. Zero legítimo (anúncio no ar que não gastou) e zero
       por não existir ainda são coisas diferentes, e o cliente não tem
       como distinguir.

       O corte é por IMPRESSÃO e não por gasto: anúncio que entregou sem
       consumir verba no período ainda rodou, e some dele seria esconder
       entrega real. Menos de seis cartões é resposta honesta — melhor
       do que completar com quem não estava lá. */
    .filter((ad) => ad.impressions > 0)
    .sort((a, b) => b.spend_cents - a.spend_cents)
    .slice(0, limite);
}

function assemble(
  client: Client,
  current: DailyMetric[],
  previous: DailyMetric[],
  creatives: AdCreative[],
  periodStart: string,
  periodEnd: string,
  rotulos: Partial<Record<MetricKey, string>> = {},
  tiposDeConversao: string[] = [],
  criativosDoPeriodo = false,
): PrintReportData {
  const currentTotals = sumMetrics(current, tiposDeConversao);
  const previousTotals = sumMetrics(previous, tiposDeConversao);

  return {
    client,
    criativosDoPeriodo,
    // Mesmas funções do dashboard: é o que garante que o PDF entregue ao
    // cliente não divirja do número que o gestor vê na tela.
    kpis: HERO_METRICS.map((key) => {
      const kpi = computeKpi(key, currentTotals, previousTotals);
      const rotulo = rotulos[key];
      return rotulo ? { ...kpi, label: rotulo } : kpi;
    }),
    platforms: splitByPlatform(current),
    platformDetail: buildPlatformDetail(current, previous, rotulos),
    creatives,
    weekly: toWeekly(current),
    totals: {
      spendCents: currentTotals.spendCents,
      results: currentTotals.conversions,
    },
    period: { start: periodStart, end: periodEnd },
  };
}

/**
 * Agrupa a série diária em semanas.
 *
 * Um mês tem ~30 barras diárias; em 18cm de papel elas viram um pente
 * ilegível. Quatro ou cinco barras semanais mostram a MESMA tendência e
 * cabem com folga — é a granularidade certa para relatório impresso.
 */
function toWeekly(rows: DailyMetric[]) {
  const daily = buildTrend(rows);
  const semanas: { label: string; spend: number; results: number }[] = [];

  for (let i = 0; i < daily.length; i += 7) {
    const bloco = daily.slice(i, i + 7);
    if (bloco.length === 0) continue;

    semanas.push({
      label: `Sem ${semanas.length + 1}`,
      spend: bloco.reduce((acc, d) => acc + d.spend, 0),
      results: bloco.reduce((acc, d) => acc + d.results, 0),
    });
  }

  return semanas;
}

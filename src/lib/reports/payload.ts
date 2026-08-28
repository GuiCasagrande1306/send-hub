import "server-only";

import {
  PLATFORM_LABELS,
  buildTrend,
  computeKpi,
  deriveMetric,
  EMPTY_TOTALS,
  splitByPlatform,
  type KpiResult,
  type MetricTotals,
  type PlatformSplit,
  type TrendPoint,
} from "@/lib/metrics/kpi";
import { formatPeriod } from "@/lib/format";
import { mensagemDoCliente } from "./mensagem-do-cliente";
import { sessionSource, type ReportSource } from "./source";
import {
  buildPlatformDetail,
  type PlatformDetail,
} from "./platform-detail";
import type {
  AdCreative,
  Client,
  MetricKey,
  ReportSection,
  ReportTemplate,
} from "@/types/database";

/* =====================================================================
   Payload do relatório
   ---------------------------------------------------------------------
   Tudo o que o PDF precisa, resolvido de uma vez e SERIALIZÁVEL.

   Por que congelar em vez de consultar durante a renderização:

   • As plataformas reprocessam dados. A Meta ajusta conversões por até
     28 dias. Um PDF que consultasse o banco a cada abertura mostraria
     números diferentes dos que foram apresentados ao cliente.
   • O payload inteiro é gravado em `report_history.snapshot`, então o
     relatório é auditável: dá para provar o que foi enviado e quando.
   • Renderização vira função pura de dados — testável sem banco.

   Os KPIs saem de `computeKpi`, exatamente a mesma função do dashboard.
   É isso que garante que o PDF nunca divirja da tela.
   ===================================================================== */

/* Reexportados: o documento PDF e a página A4 importam daqui. */
export type { PlatformCampaign, PlatformDetail } from "./platform-detail";

export interface ReportPayload {
  meta: {
    generatedAt: string;
    periodStart: string;
    periodEnd: string;
    /** Dias na janela — a comparação usa período anterior equivalente. */
    days: number;
    templateName: string;
    accent: string;
  };
  client: {
    id: string;
    name: string;
    segment: Client["segment"];
    brandPrimary: string | null;
    logoUrl: string | null;
    website: string | null;
  };
  kpis: KpiResult[];
  trend: TrendPoint[];
  platforms: PlatformSplit[];
  /** Uma entrada por plataforma que teve veiculação no período. */
  platformDetail: PlatformDetail[];
  creatives: ReportCreative[];
  sections: ReportSection[];
  /** Texto escrito pelo time; vazio quando ainda não preenchido. */
  insights: string;
  nextSteps: string[];
}

/** Criativo já com os derivados calculados — o PDF não faz conta. */
export interface ReportCreative {
  id: string;
  platform: AdCreative["platform"];
  platformLabel: string;
  campaignName: string | null;
  adName: string | null;
  headline: string | null;
  primaryText: string | null;
  imageUrl: string | null;
  /** false quando a origem não é raster — ver nota em `pdf/document.tsx`. */
  imageIsRaster: boolean;
  spendCents: number;
  results: number;
  cpaCents: number;
  ctr: number;
  clicks: number;
}

/**
 * O renderizador de PDF só embute imagem raster. SVG e URLs relativas
 * quebrariam a geração inteira — detectamos antes e trocamos por um
 * bloco de marca. Em produção as miniaturas vêm da Meta/Google em
 * JPEG/PNG, então este caminho é a exceção, não a regra.
 */
function isRasterImage(url: string | null): boolean {
  if (!url) return false;
  if (url.startsWith("data:image/svg")) return false;
  if (url.startsWith("data:image/")) return true;
  if (!/^https?:\/\//.test(url)) return false;
  return !/\.svg(\?|$)/i.test(url);
}

export async function buildReportPayload(options: {
  client: Client;
  template: ReportTemplate;
  periodStart: string;
  periodEnd: string;
  insights?: string;
  nextSteps?: string[];
  /** RLS por padrão; o cron injeta a origem de sistema. */
  source?: ReportSource;
}): Promise<ReportPayload> {
  const { client, template, periodStart, periodEnd } = options;
  const source = options.source ?? sessionSource();

  // Quantos criativos a seção `ad_gallery` pediu (padrão 6).
  const gallery = template.sections.find((s) => s.type === "ad_gallery");
  const creativeLimit = Number(gallery?.options?.limit ?? 6);

  const [metrics, creatives] = await Promise.all([
    source.metrics(client.id, periodStart, periodEnd),
    source.creatives(client.id, creativeLimit),
  ]);

  /* O template define QUAIS KPIs aparecem, em que ordem e COMO SE
     CHAMAM. O rótulo é do template, não da métrica: o mesmo
     `conversions` é "Vendas", "Pedidos", "Leads" ou "Contatos"
     dependendo do negócio do cliente. */
  const rotulos = template.metric_labels ?? {};

  const kpis: KpiResult[] = (template.metrics as MetricKey[]).map((key) => {
    const kpi = computeKpi(key, metrics.currentTotals, metrics.previousTotals);
    const rotulo = rotulos[key];
    return rotulo ? { ...kpi, label: rotulo } : kpi;
  });

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      periodStart,
      periodEnd,
      days: metrics.period.days,
      templateName: template.name,
      accent: template.theme.accent ?? "#7BF178",
    },
    client: {
      id: client.id,
      name: client.name,
      segment: client.segment,
      brandPrimary: client.brand_primary,
      logoUrl: client.logo_url,
      website: client.website,
    },
    kpis,
    trend: buildTrend(metrics.current),
    platforms: splitByPlatform(metrics.current),
    platformDetail: buildPlatformDetail(
      metrics.current,
      metrics.previous,
      rotulos,
    ),
    creatives: creatives.map((ad) => {
      const image = ad.storage_path ?? ad.thumbnail_url;
      return {
        id: ad.id,
        platform: ad.platform,
        platformLabel: PLATFORM_LABELS[ad.platform],
        campaignName: ad.campaign_name,
        adName: ad.ad_name,
        headline: ad.headline,
        primaryText: ad.primary_text,
        imageUrl: image,
        imageIsRaster: isRasterImage(image),
        spendCents: ad.spend_cents,
        results: ad.conversions,
        cpaCents: ad.conversions > 0 ? ad.spend_cents / ad.conversions : 0,
        ctr: ad.impressions > 0 ? ad.clicks / ad.impressions : 0,
        clicks: ad.clicks,
      };
    }),
    sections: template.sections,
    insights: options.insights ?? "",
    nextSteps: options.nextSteps ?? [],
  };
}

/**
 * Resumo em texto que acompanha o PDF no WhatsApp.
 *
 * Precisa fazer sentido sozinho: muita gente lê a mensagem no celular e
 * só abre o anexo depois — ou nunca. Por isso os três números que
 * definem a conta vêm no corpo da mensagem.
 */
/**
 * Legenda que acompanha o PDF no WhatsApp.
 *
 * SEM NÚMERO NENHUM, e a ausência é o recurso. A legenda dizia
 * "Investimos X e geramos Y resultados a um custo de Z cada", com X e Y
 * da conta inteira e Z da campanha de origem desde a migration 42 — os
 * três não fechavam entre si.
 *
 * Medido na carteira da Send em 28/08/2026, nas 20 contas ativas com
 * investimento e resultado: SETE mandavam uma legenda que não fecha na
 * calculadora. A pior, presença local A, dizia R$22,60 onde a conta
 * inteira dá R$48,83.
 *
 * O PDF explica o recorte com o selo "de N campanhas"; um texto de
 * WhatsApp não tem onde pôr nota de rodapé. Então a mensagem para de
 * ter número: ela anuncia o anexo e sai da frente. Uma legenda sem
 * número não tem como discordar do documento que acompanha — a classe
 * inteira de defeito deixa de existir, em vez de ser consertada de novo
 * a cada métrica nova. Ver `mensagem-do-cliente.ts`.
 *
 * SEM RAMO PARA SNAPSHOT ANTIGO, e ele pôde sumir: o que restou vem de
 * `meta`, que todo payload gravado sempre teve. O caminho que remontava
 * a mensagem a partir dos KPIs existia só para os números.
 */
export function buildGroupCaption(
  payload: ReportPayload,
  /**
   * O texto gravado em `report_message_settings`.
   *
   * Buscado NA HORA DO ENVIO, não congelado no snapshot: um relatório
   * que o cron preparou às 6h20 e alguém despacha às 15h sai com a
   * mensagem vigente às 15h. Se o texto mudou no meio, foi porque
   * alguém quis — e a versão nova é a que a agência quer dizer.
   *
   * Sem valor, cai no de fábrica. É o que mantém o caminho de teste e a
   * prévia funcionando sem ida ao banco.
   */
  template?: string,
): string {
  return mensagemDoCliente(
    {
      periodoLabel: formatPeriod(
        payload.meta.periodStart,
        payload.meta.periodEnd,
      ),
      dias: payload.meta.days,
      cliente: payload.client.name,
    },
    template,
  );
}

export function buildWhatsAppSummary(payload: ReportPayload): string {
  const find = (key: MetricKey) => payload.kpis.find((k) => k.key === key);

  const spend = find("spend");
  const results = find("results");
  const cpa = find("cpa");

  const trendWord = (kpi?: KpiResult) => {
    if (!kpi || kpi.deltaPercent === null) return "";
    const arrow = kpi.direction === "up" ? "▲" : kpi.direction === "down" ? "▼" : "";
    return ` ${arrow} ${Math.abs(kpi.deltaPercent).toFixed(1).replace(".", ",")}%`;
  };

  /* Razão sem denominador vira FRASE, não traço. "*—*" no meio de uma
     mensagem de WhatsApp lê como falha do sistema, e some justamente a
     informação que importa: não houve conversão no período. Antes daqui
     saía "*R$ 0,00* ▼ 100,0%", que era pior — dizia o contrário do que
     aconteceu. */
  const linhaCpa = !cpa
    ? ""
    : cpa.indefinido
      ? "📉 Custo por resultado: *sem conversões no período*"
      : `📉 Custo por resultado: *${cpa.formatted}*${trendWord(cpa)}`;

  const period = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });

  const lines = [
    `*${payload.client.name}* — relatório de mídia paga`,
    `Período: ${period.format(new Date(`${payload.meta.periodStart}T12:00:00`))} a ${period.format(
      new Date(`${payload.meta.periodEnd}T12:00:00`),
    )}`,
    "",
    spend ? `💰 Investimento: *${spend.formatted}*${trendWord(spend)}` : "",
    results ? `🎯 Resultados: *${results.formatted}*${trendWord(results)}` : "",
    linhaCpa,
    "",
    "O relatório completo, com a análise e os criativos que rodaram, está no PDF em anexo.",
  ];

  return lines.filter((line) => line !== "").join("\n");
}

/** Total consolidado, usado no cabeçalho da capa. */
export function payloadHeadline(payload: ReportPayload) {
  const totals = payload.platforms.reduce<MetricTotals>(
    (acc, p) => ({
      spendCents: acc.spendCents + p.totals.spendCents,
      impressions: acc.impressions + p.totals.impressions,
      clicks: acc.clicks + p.totals.clicks,
      conversions: acc.conversions + p.totals.conversions,
      revenueCents: acc.revenueCents + p.totals.revenueCents,
      /* A origem soma junto, plataforma a plataforma. Somar só os totais
         e deixar a origem zerada faria o ROAS da capa — que sai da
         origem — imprimir "—" numa conta que tem ROAS. */
      origem: {
        spendCents: acc.origem.spendCents + p.totals.origem.spendCents,
        conversions: acc.origem.conversions + p.totals.origem.conversions,
        revenueCents: acc.origem.revenueCents + p.totals.origem.revenueCents,
        campanhas: acc.origem.campanhas + p.totals.origem.campanhas,
        /* Basta UMA plataforma isolar para o número da capa já não ser
           a conta inteira, e o selo precisa dizer isso. */
        isolado: acc.origem.isolado || p.totals.origem.isolado,
      },
    }),
    EMPTY_TOTALS,
  );

  return {
    totals,
    roas: deriveMetric("roas", totals),
  };
}

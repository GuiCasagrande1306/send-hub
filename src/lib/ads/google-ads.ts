import "server-only";

import { serverEnv } from "@/lib/env";
import {
  isSupportedCurrency,
  microsToCents,
  normalizeCustomerId,
  toDecimal,
  toInt,
} from "./normalize";
import type {
  AdsProvider,
  NormalizedMetricRow,
  ProviderResult,
  SyncFailureCode,
} from "./types";

/* =====================================================================
   Google Ads — searchStream (API v21)
   ---------------------------------------------------------------------
   POST /v21/customers/{customerId}/googleAds:searchStream
   Headers: Authorization, login-customer-id

   Três armadilhas específicas desta API:

   1. `cost_micros` está em MICROS. 1 real = 1.000.000 micros. Para
      centavos divide-se por 10.000 — não por 1.000.000, que é o erro
      que faz o gasto aparecer 100× menor.

   2. `conversions` é DOUBLE, não inteiro: o Google atribui conversão
      fracionada em modelos distribuídos. Truncar subestima o resultado.

   3. O `customer_id` vai SEM hífens na URL, mas o cadastro quase sempre
      é feito com ("123-456-7890").

   Autenticação: o refresh token de longa duração é trocado por um
   access token de 1h a cada rodada. Guardar o access token não vale a
   pena — a troca custa uma requisição e evita toda a classe de bug de
   token vencido em cache.
   ===================================================================== */

/* A Google aposenta versão da API a cada poucos meses, e a resposta de
   uma versão morta NÃO é um JSON de erro: é a página HTML 404 do
   gateway. Foi assim que apareceu "[network_error] Unexpected token '<',
   \"<!DOCTYPE\"" na tela — erro de parse disfarçando um endpoint que
   deixou de existir. Medido em 07/08/2026: v18 e v19 dão 404; v20 e v21
   respondem.

   ⚠️ ATUALIZADA PARA v24 EM 11/08/2026. O Google mantém só as três
   majors mais recentes, e a v21 saiu dessa janela: o
   `UNSUPPORTED_VERSION` "intermitente" que `google-balance.ts` contorna
   com uma repetição não é instabilidade, é o desligamento entrando no
   ar aos poucos. Em 19/09/2026 a v25 já está publicada, então a v24
   segue dentro da janela — mas é a mais velha das três, e é ela que sai
   na próxima virada.

   Um motivo a mais para não pular para a v25 sem pensar: é nela que
   aparece o erro CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION quando o
   projeto do Cloud está só com acesso de Teste. Nas versões anteriores
   o mesmo caso vem como ACTION_NOT_PERMITTED.

   Ao conectar o Google pela primeira vez, confirme aqui antes de
   procurar o erro em outro lugar. Se aparecer HTML no lugar de JSON, é
   esta linha. */
export const API_VERSION = "v24";

/** GAQL: uma linha por campanha por dia. */
export const DAILY_METRICS_QUERY = `
  SELECT
    segments.date,
    campaign.id,
    campaign.name,
    metrics.cost_micros,
    metrics.impressions,
    metrics.clicks,
    metrics.conversions,
    metrics.conversions_value
  FROM campaign
  WHERE segments.date BETWEEN '{since}' AND '{until}'
    AND campaign.status != 'REMOVED'
`;

interface GoogleAdsRow {
  segments?: { date?: string };
  campaign?: { id?: string; name?: string };
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
    conversions?: number;
    conversionsValue?: number;
    /* Só vêm na consulta filtrada por `segments.conversion_action`. */
    allConversions?: number;
    allConversionsValue?: number;
  };
}

interface SearchStreamChunk {
  results?: GoogleAdsRow[];
  error?: { message?: string; status?: string; code?: number };
}

export const googleAdsProvider: AdsProvider = {
  platform: "google_ads",
  label: "Google Ads",

  async fetchMetrics(request): Promise<ProviderResult> {
    if (!serverEnv.googleAdsClientId || !serverEnv.googleAdsClientSecret) {
      return {
        ok: false,
        code: "not_configured",
        message:
          "Credenciais do Google Ads ausentes. Defina GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET.",
      };
    }

    if (!request.accessToken) {
      return {
        ok: false,
        code: "auth_expired",
        message: "Sem refresh token salvo para esta conta do Google Ads.",
      };
    }

    if (!isSupportedCurrency(request.currency)) {
      return {
        ok: false,
        code: "unsupported_currency",
        message: `Conta em ${request.currency}. Somar com contas em BRL produziria um total sem significado.`,
      };
    }

    // O que guardamos é o REFRESH token; o access token dura 1h.
    const token = await exchangeRefreshToken(request.accessToken);
    if (!token.ok) return token;

    const customerId = normalizeCustomerId(request.externalAccountId);

    /* UMA REQUISIÇÃO POR MÊS, não uma pelo intervalo inteiro.

       O `searchStream` recusa janelas grandes com "Request contains an
       invalid argument" — mensagem genérica que não menciona volume.
       Medido: 01/07 a 30/11 de 2025 falha; os mesmos meses passam
       separados. É limite de resposta, não query inválida, e é por isso
       que o erro só aparecia no backfill e nunca na sincronização
       diária. */
    const janelas = chunkDatesByMonth(request.since, request.until);
    const rows: NormalizedMetricRow[] = [];
    const escolhidas = idsDeConversao(request.conversionActionType);

    for (const [i, janela] of janelas.entries()) {
      /* Meio segundo entre chamadas. O limite do Google é por segundo, e
         doze meses disparados em sequência fechada batem nele — trocar
         um erro de volume por um de rate limit não seria progresso. */
      if (i > 0) await new Promise((r) => setTimeout(r, 500));

      const parcial = await buscarJanela(
        customerId,
        token.accessToken,
        janela.since,
        janela.until,
      );

      /* Falha de UMA janela aborta tudo. Devolver as outras daria um
         histórico com buraco silencioso — o gráfico mostraria queda de
         investimento onde houve só falha de rede. */
      if (!parcial.ok) return parcial;

      if (escolhidas.length === 0) {
        rows.push(...parcial.rows);
        continue;
      }

      const soAsEscolhidas = await buscarConversoesEscolhidas(
        customerId,
        token.accessToken,
        janela.since,
        janela.until,
        escolhidas,
      );

      /* Recusar em vez de cair no total é deliberado. O motivo de
         existir a escolha é que o total está errado; entregar o total
         quando a segunda consulta falha devolveria justamente o número
         que se quis evitar, sem aviso nenhum. */
      if (!soAsEscolhidas.ok) return soAsEscolhidas;

      for (const row of parcial.rows) {
        const medido = soAsEscolhidas.porChave.get(
          `${row.metricDate}|${row.campaignId}`,
        );
        rows.push({
          ...row,
          /* Ausente = a campanha não produziu NENHUMA das ações
             escolhidas na data. Zero é a resposta certa: manter o valor
             do total traria de volta as conversões descartadas. */
          conversions: medido?.conversions ?? 0,
          revenueCents: medido?.revenueCents ?? 0,
        });
      }
    }

    return { ok: true, rows };
  },
};

/* ------------------------------------------------------------------ */
/* Fatiamento de datas                                                 */
/* ------------------------------------------------------------------ */

export interface DateWindow {
  since: string;
  until: string;
}

/**
 * Quebra um intervalo em janelas que nunca cruzam a virada do mês.
 *
 * Mês civil, e não blocos fixos de 30 dias, por dois motivos: o corte
 * fica estável entre execuções (a mesma janela sempre produz as mesmas
 * fatias, então repetir o backfill é idempotente), e é a unidade em que
 * se conversa sobre verba de mídia.
 *
 * Datas em ISO puro, sem `Date`: construir `new Date("2025-07-01")` e
 * formatar de volta passa pelo fuso do servidor, e na Vercel (UTC) isso
 * desloca o primeiro dia para 30/06 no horário de Brasília.
 */
export function chunkDatesByMonth(since: string, until: string): DateWindow[] {
  if (since > until) return [];

  const janelas: DateWindow[] = [];
  let cursor = since;

  while (cursor <= until) {
    const [ano, mes] = cursor.split("-").map(Number);
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const fimDoMes = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;

    janelas.push({ since: cursor, until: fimDoMes < until ? fimDoMes : until });

    // Primeiro dia do mês seguinte, virando o ano em dezembro.
    cursor =
      mes === 12
        ? `${ano + 1}-01-01`
        : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
  }

  return janelas;
}

/* ------------------------------------------------------------------ */

/** Uma chamada ao `searchStream`, já normalizada. */
async function buscarJanela(
  customerId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<ProviderResult> {
  const query = DAILY_METRICS_QUERY.replace("{since}", since).replace(
    "{until}",
    until,
  );

  try {
    const response = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(serverEnv.googleAdsLoginCustomerId
            ? {
                "login-customer-id": normalizeCustomerId(
                  serverEnv.googleAdsLoginCustomerId,
                ),
              }
            : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      },
    );

    // searchStream devolve um ARRAY de chunks, não um objeto único.
    const payload = (await response.json()) as
      | SearchStreamChunk[]
      | SearchStreamChunk;

    if (!response.ok) {
      const error = Array.isArray(payload) ? payload[0]?.error : payload.error;
      return {
        ok: false,
        code:
          response.status === 401 || response.status === 403
            ? "auth_expired"
            : response.status === 429
              ? "rate_limited"
              : "platform_error",
        /* A janela entra na mensagem: sem ela, "invalid argument" num
           backfill de doze meses não diz qual mês recusou. */
        message: `${error?.message ?? `Google Ads respondeu ${response.status}.`} (${since} a ${until})`,
      };
    }

    const chunks = Array.isArray(payload) ? payload : [payload];
    const rows: NormalizedMetricRow[] = [];

    for (const chunk of chunks) {
      for (const row of chunk.results ?? []) {
        rows.push(toNormalizedRow(row));
      }
    }

    return { ok: true, rows };
  } catch (error) {
    return {
      ok: false,
      code: "network_error",
      message:
        error instanceof Error
          ? error.message
          : "Falha de rede ao chamar o Google Ads.",
    };
  }
}


/* =====================================================================
   Quais ações de conversão contam
   ---------------------------------------------------------------------
   `metrics.conversions` soma TODAS as ações marcadas como principais na
   conta, e "principal" é escolha de quem configura a conta para o
   Google otimizar — não do relatório. Medido na Biank Imóveis em
   21/09/2026: R$ 242,81 de investimento e 3.203 conversões, porque
   "Visualização de página" estava como principal ao lado de Engajamento
   e Ver rota. O painel mostrou 3.289 leads onde havia 86.

   Quando o cliente tem ações escolhidas, a contagem vem de uma segunda
   consulta, filtrada por elas.

   POR QUE UMA SEGUNDA CONSULTA, E NÃO UM CAMPO A MAIS NA PRIMEIRA:
   `segments.conversion_action` SEGMENTA a resposta. Com ele, uma
   campanha que teve três tipos de conversão no dia vira três linhas — e
   `metrics.cost_micros` vem REPETIDO INTEIRO em cada uma. Somar daria o
   triplo do investimento real. Custo e cliques continuam vindo da
   consulta sem segmento; daqui vem só a conversão.

   `all_conversions`, e não `conversions`: quem escolhe aqui pode querer
   justamente uma ação que NÃO é principal na conta — e para essas
   `metrics.conversions` devolve zero, o que pareceria "a escolha não
   funcionou".
   ===================================================================== */

/** IDs numéricos guardados em `conversion_action_type` do cliente. */
export function idsDeConversao(
  bruto: string | string[] | null | undefined,
): string[] {
  const lista = Array.isArray(bruto) ? bruto : (bruto ?? "").split(",");
  return [...new Set(lista.map((s) => s.trim()).filter((s) => /^\d+$/.test(s)))];
}

interface ConversoesPorChave {
  ok: true;
  /** `YYYY-MM-DD|campaignId` → o que as ações escolhidas produziram. */
  porChave: Map<string, { conversions: number; revenueCents: number }>;
}

async function buscarConversoesEscolhidas(
  customerId: string,
  accessToken: string,
  since: string,
  until: string,
  ids: string[],
): Promise<ConversoesPorChave | { ok: false; code: SyncFailureCode; message: string }> {
  const recursos = ids
    .map((id) => `'customers/${customerId}/conversionActions/${id}'`)
    .join(", ");

  /* `segments.conversion_action` PRECISA estar no SELECT, e não só no
     WHERE. É regra da GAQL: "quando um segmento está na cláusula WHERE,
     ele também precisa estar na cláusula SELECT", e a exceção são
     apenas os segmentos de data. Sem ele o Google recusa com
     "Request contains an invalid argument" — mensagem que não diz qual
     argumento, e foi assim que isto quebrou em produção em 22/09/2026.

     Selecioná-lo também segmenta a resposta por ação, que é justamente
     o que o laço abaixo soma por (data, campanha). */
  const query = `
    SELECT
      segments.date,
      segments.conversion_action,
      campaign.id,
      metrics.all_conversions,
      metrics.all_conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND campaign.status != 'REMOVED'
      AND segments.conversion_action IN (${recursos})
  `;

  try {
    const response = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(serverEnv.googleAdsLoginCustomerId
            ? {
                "login-customer-id": normalizeCustomerId(
                  serverEnv.googleAdsLoginCustomerId,
                ),
              }
            : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      },
    );

    const payload = (await response.json()) as
      | SearchStreamChunk[]
      | SearchStreamChunk;

    if (!response.ok) {
      const error = Array.isArray(payload) ? payload[0]?.error : payload.error;
      return {
        ok: false,
        code:
          response.status === 401 || response.status === 403
            ? "auth_expired"
            : response.status === 429
              ? "rate_limited"
              : "platform_error",
        message: `${error?.message ?? `Google Ads respondeu ${response.status}.`} (conversões escolhidas, ${since} a ${until})`,
      };
    }

    const porChave = new Map<
      string,
      { conversions: number; revenueCents: number }
    >();

    for (const chunk of Array.isArray(payload) ? payload : [payload]) {
      for (const row of chunk.results ?? []) {
        const chave = `${row.segments?.date ?? ""}|${row.campaign?.id ?? "_all"}`;
        const atual = porChave.get(chave) ?? { conversions: 0, revenueCents: 0 };

        /* SOMA, não atribui: uma campanha com duas ações escolhidas
           volta em duas linhas no mesmo dia. */
        atual.conversions += toDecimal(row.metrics?.allConversions);
        atual.revenueCents += Math.round(
          (row.metrics?.allConversionsValue ?? 0) * 100,
        );
        porChave.set(chave, atual);
      }
    }

    return { ok: true, porChave };
  } catch (error) {
    return {
      ok: false,
      code: "network_error",
      message:
        error instanceof Error
          ? error.message
          : "Falha de rede ao buscar as conversões escolhidas.",
    };
  }
}

/* ------------------------------------------------------------------ */
/* OAuth                                                               */
/* ------------------------------------------------------------------ */

type TokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; code: "auth_expired" | "network_error"; message: string };

/** Exportada para `google-balance`, que precisa do mesmo access token. */
export async function exchangeRefreshToken(
  refreshToken: string,
): Promise<TokenResult> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: serverEnv.googleAdsClientId,
        client_secret: serverEnv.googleAdsClientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !data.access_token) {
      return {
        ok: false,
        code: "auth_expired",
        message:
          data.error_description ??
          data.error ??
          "Não foi possível renovar o access token do Google.",
      };
    }

    return { ok: true, accessToken: data.access_token };
  } catch (error) {
    return {
      ok: false,
      code: "network_error",
      message:
        error instanceof Error ? error.message : "Falha ao renovar token do Google.",
    };
  }
}

/* ------------------------------------------------------------------ */

/** Converte uma linha do searchStream para o formato do banco. */
export function toNormalizedRow(row: GoogleAdsRow): NormalizedMetricRow {
  return {
    metricDate: row.segments?.date ?? "",
    campaignId: row.campaign?.id ?? "_all",
    campaignName: row.campaign?.name ?? null,
    /* O Google não tem `objective` como a Meta — o mais próximo é
       `advertising_channel_type` (SEARCH, DISPLAY, PERFORMANCE_MAX), que
       diz ONDE o anúncio aparece, não PARA QUE a campanha existe. Mapear
       um no outro seria palpite, e palpite errado aqui tira gasto de
       verdade da conta do custo por resultado.

       Nulo é a resposta honesta, e `campanha-de-origem.ts` sabe lidar:
       sem objetivo, a campanha entra se PRODUZIU o resultado. Para o
       Google isso é quase sempre o que se quer, porque a rede de
       display que não converte já fica de fora sozinha. */
    objective: null,
    optimizationGoal: null,
    // Micros → centavos: dividir por 10.000.
    spendCents: microsToCents(row.metrics?.costMicros),
    impressions: toInt(row.metrics?.impressions),
    clicks: toInt(row.metrics?.clicks),
    // Fracionário de propósito — a coluna é numeric(12,2).
    conversions: toDecimal(row.metrics?.conversions),
    revenueCents: Math.round((row.metrics?.conversionsValue ?? 0) * 100),
  };
}

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { API_VERSION, exchangeRefreshToken } from "@/lib/ads/google-ads";
import { normalizeCustomerId } from "@/lib/ads/normalize";

/**
 * GET /api/google/conversion-actions?clientId=<uuid>
 *
 * Ações de conversão da conta que ESTE cliente tem vinculada.
 *
 * POR QUE ISTO PRECISOU EXISTIR. `metrics.conversions` soma todas as
 * ações marcadas como principais na conta — e "principal" é decisão de
 * quem configurou a conta, não do relatório. Medido na Biank Imóveis em
 * 21/09/2026: R$ 242,81 de investimento e 3.203 "conversões", porque
 * "Visualização de página" estava como principal junto de Engajamento e
 * Ver rota. O painel mostrava 3.289 leads onde havia 86, e a meta do mês
 * marcava 1.630%.
 *
 * Mudar isso na conta do Google conserta o número e MEXE NO LANCE das
 * campanhas, porque é pelas principais que o Google otimiza. Escolher
 * aqui separa as duas decisões: a conta segue otimizando como a mídia
 * quer, e o relatório conta o que o cliente entende por resultado.
 *
 * ADMIN, como o seletor de contas: a resposta descreve a configuração
 * de medição da conta do cliente.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AcaoDeConversao {
  id: string;
  name: string;
  /** PAGE_VIEW, SUBMIT_LEAD_FORM, PHONE_CALL_LEAD… como o Google nomeia. */
  category: string | null;
  status: string | null;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Não autorizado." },
      { status: 403 },
    );
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json(
      { ok: false, error: "Informe ?clientId=<uuid>." },
      { status: 400 },
    );
  }

  if (!serverEnv.googleAdsClientId || !serverEnv.googleAdsLoginCustomerId) {
    return NextResponse.json({
      ok: false,
      error: "Google Ads não configurado (client id e login-customer-id).",
    });
  }

  const admin = createSupabaseAdminClient();

  const { data: integracao } = await admin
    .from("client_integrations")
    .select("external_account_id, integration_secrets(refresh_token)")
    .eq("client_id", clientId)
    .eq("platform", "google_ads")
    .maybeSingle();

  const conta = (integracao as { external_account_id?: string | null } | null)
    ?.external_account_id;

  /* A pergunta é sobre a conta do CLIENTE, não sobre a MCC: ação de
     conversão é configurada conta a conta. Sem vínculo não há o que
     listar, e dizer isso é melhor que devolver lista vazia. */
  if (!conta || conta.startsWith("pending:")) {
    return NextResponse.json({
      ok: false,
      error: "Escolha a conta de anúncios antes de definir a conversão.",
    });
  }

  const segredos = (
    integracao as {
      integration_secrets?: { refresh_token?: string | null };
    } | null
  )?.integration_secrets;

  if (!segredos?.refresh_token) {
    return NextResponse.json({
      ok: false,
      error:
        "Este cliente ainda não autorizou o Google. Clique em Autorizar primeiro.",
    });
  }

  const acesso = await exchangeRefreshToken(segredos.refresh_token);
  if (!acesso.ok) {
    return NextResponse.json({
      ok: false,
      error: `Google recusou renovar o acesso: ${acesso.message}`,
    });
  }

  try {
    /* REMOVED fica de fora; o resto entra, inclusive PAUSED. Ação
       pausada hoje ainda explica número de mês fechado, e some da lista
       justamente quando alguém vai investigar por que o relatório
       antigo contava diferente. */
    const query = `
      SELECT
        conversion_action.id,
        conversion_action.name,
        conversion_action.category,
        conversion_action.status
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
    `;

    const resposta = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${normalizeCustomerId(
        conta,
      )}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${acesso.accessToken}`,
          "login-customer-id": serverEnv.googleAdsLoginCustomerId.replace(
            /\D/g,
            "",
          ),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!resposta.ok) {
      /* O corpo vai junto, cortado: resposta de versão morta da API é
         uma página HTML inteira, e sem o motivo a tela só diz "não foi
         possível". */
      const motivo = (await resposta.text()).slice(0, 300);
      return NextResponse.json({
        ok: false,
        error: `Google recusou (${resposta.status}): ${motivo}`,
      });
    }

    const chunks = (await resposta.json()) as {
      results?: {
        conversionAction?: {
          id?: string;
          name?: string;
          category?: string;
          status?: string;
        };
      }[];
    }[];

    const acoes: AcaoDeConversao[] = [];

    for (const chunk of Array.isArray(chunks) ? chunks : []) {
      for (const linha of chunk.results ?? []) {
        const a = linha.conversionAction;
        if (!a?.id) continue;
        acoes.push({
          id: String(a.id),
          name: a.name?.trim() || `Ação ${a.id}`,
          category: a.category ?? null,
          status: a.status ?? null,
        });
      }
    }

    acoes.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    return NextResponse.json(
      { ok: true, actions: acoes },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    return NextResponse.json({
      ok: false,
      error:
        erro instanceof Error ? erro.message : "Falha ao falar com o Google.",
    });
  }
}

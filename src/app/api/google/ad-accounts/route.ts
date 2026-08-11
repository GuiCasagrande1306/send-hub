import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { API_VERSION, exchangeRefreshToken } from "@/lib/ads/google-ads";

/**
 * GET /api/google/ad-accounts?clientId=<uuid>
 *
 * Contas do Google Ads alcançáveis pelo token que este cliente
 * autorizou. Espelha `/api/meta/ad-accounts`, e é ADMIN pelo mesmo
 * motivo: a resposta revela a carteira inteira da MCC, que é mais do que
 * o vínculo de um cliente só.
 *
 * A LISTA VEM DE `customer_client`, não de `listAccessibleCustomers`.
 * O segundo parecia o endpoint óbvio e é uma armadilha: devolve o que o
 * usuário do OAuth alcança DIRETAMENTE, não a hierarquia da conta de
 * gerência. Medido numa MCC real: 3 contas contra as 23 da hierarquia — e a do
 * cliente que estávamos tentando vincular ficava de fora.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ContaGoogle {
  id: string;
  name: string;
  currency: string | null;
  /** Contas de teste não servem para relatório de cliente. */
  isTest: boolean;
  isManager: boolean;
}

/** "1234567890" → "123-456-7890", que é como o Google mostra. */
function formatarId(id: string): string {
  const d = id.replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : id;
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

  if (!serverEnv.googleAdsDeveloperToken || !serverEnv.googleAdsLoginCustomerId) {
    return NextResponse.json({
      ok: false,
      error:
        "Google Ads não configurado (developer token e login-customer-id).",
    });
  }

  /* service_role: `integration_secrets` tem RLS ligada e ZERO policies,
     de propósito — nenhuma sessão alcança token. Só o servidor. */
  const admin = createSupabaseAdminClient();

  const { data: integracao } = await admin
    .from("client_integrations")
    .select("id, integration_secrets(access_token, refresh_token)")
    .eq("client_id", clientId)
    .eq("platform", "google_ads")
    .maybeSingle();

  const segredos = (
    integracao as {
      integration_secrets?: {
        access_token?: string | null;
        refresh_token?: string | null;
      };
    } | null
  )?.integration_secrets;

  if (!segredos?.refresh_token) {
    return NextResponse.json({
      ok: false,
      error:
        "Este cliente ainda não autorizou o Google. Clique em Autorizar primeiro.",
    });
  }

  /* TROCA O REFRESH TOKEN, não reusa o access_token gravado.
     O `access_token` de `integration_secrets` foi emitido no
     consentimento e vale UMA HORA; nada no sistema o renova — o único
     ponto que escreve nessa tabela é o callback do OAuth. Esta rota era
     a única do lado Google que o usava direto (google-ads.ts:113,
     google-balance.ts:127 e google-structure.ts:78 todas trocam), então
     o seletor de contas funcionava na primeira hora depois de autorizar
     e devolvia 401 para sempre depois disso — sem mensagem que
     apontasse para a causa. */
  const acesso = await exchangeRefreshToken(segredos.refresh_token);

  if (!acesso.ok) {
    return NextResponse.json({
      ok: false,
      error: `Google recusou renovar o acesso: ${acesso.message}`,
    });
  }

  const headers = {
    Authorization: `Bearer ${acesso.accessToken}`,
    "developer-token": serverEnv.googleAdsDeveloperToken,
    "login-customer-id": serverEnv.googleAdsLoginCustomerId.replace(/\D/g, ""),
    "Content-Type": "application/json",
  };

  try {
    /* UMA chamada, em `customer_client` a partir da MCC.
       `listAccessibleCustomers` era o endpoint errado: ele devolve as
       contas que o USUÁRIO do OAuth alcança diretamente, não a
       hierarquia da conta de gerência. Na MCC medida retornava 3 de 23
       — e a conta que se queria vincular, que estava lá, ficava de
       fora. */
    const mcc = serverEnv.googleAdsLoginCustomerId.replace(/\D/g, "");

    const query = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.test_account,
        customer_client.manager
      FROM customer_client
      WHERE customer_client.status = 'ENABLED'
    `;

    const resposta = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${mcc}/googleAds:searchStream`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ query }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!resposta.ok) {
      /* O corpo vai junto, cortado. Resposta de versão morta da API é
         uma página HTML inteira, e sem o motivo a tela só dizia "não
         foi possível" — foi o que travou o diagnóstico por duas voltas. */
      const motivo = (await resposta.text()).slice(0, 300);
      return NextResponse.json({
        ok: false,
        error: `Google recusou (${resposta.status}): ${motivo}`,
      });
    }

    // searchStream devolve um ARRAY de chunks, não um objeto único.
    const chunks = (await resposta.json()) as {
      results?: {
        customerClient?: {
          id?: string;
          descriptiveName?: string;
          currencyCode?: string;
          testAccount?: boolean;
          manager?: boolean;
        };
      }[];
    }[];

    const contas: ContaGoogle[] = [];

    for (const chunk of Array.isArray(chunks) ? chunks : []) {
      for (const linha of chunk.results ?? []) {
        const c = linha.customerClient;
        if (!c?.id) continue;

        contas.push({
          id: formatarId(c.id),
          name: c.descriptiveName?.trim() || formatarId(c.id),
          currency: c.currencyCode ?? null,
          isTest: Boolean(c.testAccount),
          isManager: Boolean(c.manager),
        });
      }
    }

    /* MCC e conta de teste ficam no fim: são alcançáveis mas quase nunca
       são o que se quer vincular. Vincular a MCC por engano devolve o
       agregado da carteira inteira no relatório de um cliente só. */
    contas.sort((a, b) => {
      const pesoA = (a.isManager ? 2 : 0) + (a.isTest ? 1 : 0);
      const pesoB = (b.isManager ? 2 : 0) + (b.isTest ? 1 : 0);
      return pesoA - pesoB || a.name.localeCompare(b.name, "pt-BR");
    });

    return NextResponse.json({ ok: true, accounts: contas });
  } catch (erro) {
    return NextResponse.json({
      ok: false,
      error:
        erro instanceof Error
          ? `Falha ao consultar o Google: ${erro.message}`
          : "Falha ao consultar o Google.",
    });
  }
}

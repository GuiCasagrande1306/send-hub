import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* =====================================================================
   Renovação preventiva do token da Meta
   ---------------------------------------------------------------------
   O token longo da Meta dura ~60 dias. Até aqui ninguém o renovava: a
   cada dois meses, por cliente, alguém tinha que lembrar de clicar em
   Reautorizar — e o sintoma de ter esquecido é o pior tipo, silencioso.
   O sync devolve `auth_expired`, o relatório do cliente sai vazio, e
   nada na tela liga uma coisa à outra.

   A Meta permite trocar um token longo AINDA VÁLIDO por outro longo,
   pelo mesmo `fb_exchange_token` que o callback usa para converter o
   curto. Ou seja: dá para renovar sem nenhuma interação humana, desde
   que se faça ANTES de vencer. Depois de vencido, não há o que trocar —
   aí é reautorizar na mão mesmo.

   POR QUE 15 DIAS DE ANTECEDÊNCIA. O cron roda uma vez por dia, então
   15 dias são 15 tentativas antes de o acesso cair. Sobra folga para
   uma semana de instabilidade da Graph API, para o job falhar num dia
   de deploy quebrado, e ainda assim resta tempo de alguém agir na mão
   se todas falharem. Renovar cedo demais não custa nada: o relógio dos
   60 dias reinicia a cada troca.

   O QUE ESTE JOB NÃO FAZ. Não ressuscita token vencido, não renova
   Google (lá o refresh token não expira; o access token de 1h é trocado
   a cada uso) e não reautoriza permissão revogada pelo usuário. Nesses
   casos ele grava o motivo em `sync_error`, que é o campo que a tela do
   cliente já mostra.
   ===================================================================== */

/** Antecedência da renovação. Ver a nota acima sobre por que 15. */
const DIAS_DE_ANTECEDENCIA = 15;

export interface RenovacaoDeToken {
  clientName: string;
  platform: string;
  /** Vencimento ANTES da tentativa. */
  vencia: string;
  novoVencimento?: string;
  erro?: string;
}

export interface RelatorioDeRenovacao {
  executadoEm: string;
  /** Quantas integrações entraram na janela de renovação. */
  candidatas: number;
  renovadas: RenovacaoDeToken[];
  falhas: RenovacaoDeToken[];
}

interface LinhaCandidata {
  id: string;
  platform: string;
  token_expires_at: string;
  clients: { name: string } | null;
  integration_secrets: { access_token: string | null } | null;
}

export async function renovarTokensMeta(options?: {
  /** Sobrescreve a antecedência. Só para verificação manual. */
  diasDeAntecedencia?: number;
}): Promise<RelatorioDeRenovacao> {
  const dias = options?.diasDeAntecedencia ?? DIAS_DE_ANTECEDENCIA;

  const base: RelatorioDeRenovacao = {
    executadoEm: new Date().toISOString(),
    candidatas: 0,
    renovadas: [],
    falhas: [],
  };

  /* Sem credencial do app não há troca possível. Sair aqui evita uma
     rodada inteira de chamadas que voltariam todas com o mesmo erro. */
  if (!serverEnv.metaAppId || !serverEnv.metaAppSecret) return base;

  const admin = createSupabaseAdminClient();

  const limite = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

  const { data } = await admin
    .from("client_integrations")
    .select(
      "id, platform, token_expires_at, clients(name), integration_secrets(access_token)",
    )
    .eq("platform", "meta_ads")
    .eq("is_active", true)
    .not("token_expires_at", "is", null)
    .lte("token_expires_at", limite.toISOString())
    /* JÁ VENCIDO fica de fora: a Meta recusa trocar um token morto, e
       incluí-lo produziria uma falha por dia, para sempre, afogando o
       relatório do job. Quem venceu precisa de Reautorizar na mão — e é
       o aviso na tela do cliente que cobra isso. */
    .gt("token_expires_at", new Date().toISOString());

  const candidatas = (data ?? []) as unknown as LinhaCandidata[];
  base.candidatas = candidatas.length;

  for (const linha of candidatas) {
    const identidade = {
      clientName: linha.clients?.name ?? "(cliente removido)",
      platform: linha.platform,
      vencia: linha.token_expires_at,
    };

    const atual = linha.integration_secrets?.access_token;
    if (!atual) {
      base.falhas.push({ ...identidade, erro: "Sem token gravado." });
      continue;
    }

    try {
      const url = new URL(
        `https://graph.facebook.com/${serverEnv.metaApiVersion}/oauth/access_token`,
      );
      url.searchParams.set("grant_type", "fb_exchange_token");
      url.searchParams.set("client_id", serverEnv.metaAppId);
      url.searchParams.set("client_secret", serverEnv.metaAppSecret);
      url.searchParams.set("fb_exchange_token", atual);

      const resposta = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });

      const corpo = (await resposta.json()) as {
        access_token?: string;
        expires_in?: number;
        error?: { message?: string };
      };

      if (!resposta.ok || !corpo.access_token) {
        const erro =
          corpo.error?.message ?? `Meta recusou a renovação (${resposta.status}).`;

        /* O motivo vai para `sync_error`, que a tela do cliente já
           mostra. Sem isto a falha viveria só no corpo da resposta do
           cron, que ninguém lê. */
        await admin
          .from("client_integrations")
          .update({ sync_error: `Renovação do acesso falhou: ${erro}` })
          .eq("id", linha.id);

        base.falhas.push({ ...identidade, erro });
        continue;
      }

      /* Sem `expires_in` a Meta está dizendo que o token não expira
         (acontece com token de sistema). Guardar null é mais honesto do
         que inventar 60 dias — e tira a linha da varredura de amanhã. */
      const novoVencimento = corpo.expires_in
        ? new Date(Date.now() + corpo.expires_in * 1000).toISOString()
        : null;

      await admin
        .from("integration_secrets")
        .update({
          access_token: corpo.access_token,
          expires_at: novoVencimento,
          updated_at: new Date().toISOString(),
        })
        .eq("integration_id", linha.id);

      await admin
        .from("client_integrations")
        .update({ token_expires_at: novoVencimento, sync_error: null })
        .eq("id", linha.id);

      base.renovadas.push({
        ...identidade,
        novoVencimento: novoVencimento ?? "sem prazo",
      });
    } catch (erro) {
      base.falhas.push({
        ...identidade,
        erro: erro instanceof Error ? erro.message : "falha desconhecida",
      });
    }
  }

  return base;
}

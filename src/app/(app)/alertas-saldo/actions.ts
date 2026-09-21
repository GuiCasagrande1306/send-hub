"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";

/* =====================================================================
   Para onde o aviso de saldo vai
   ---------------------------------------------------------------------
   Escolher o grupo é escolher para onde a agência manda mensagem
   automática todo dia — por isso só admin, checado aqui E por policy.
   Duas fontes de verdade sobre permissão divergem, mas aqui a da
   aplicação existe para dar uma FRASE: a policy sozinha recusa com
   42501, que na tela vira "permissão negada" sem dizer de quê.
   ===================================================================== */

const schema = z.object({
  /* Vazio limpa a configuração e DESLIGA o aviso. É estado legítimo:
     desligar deve ser tão fácil quanto ligar, senão alguém desliga
     arrancando o cron. */
  jid: z.string().trim(),
  nome: z.string().trim().max(200).default(""),
});

export async function definirGrupoDoAviso(
  input: z.input<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return { ok: false, error: "Só administradores mudam o destino do aviso." };
  }

  const { jid, nome } = parsed.data;

  if (jid !== "" && !jid.endsWith("@g.us")) {
    return { ok: false, error: "Escolha um grupo da lista." };
  }

  if (isDemoMode) return { ok: true };

  const admin = createSupabaseAdminClient();

  /* O DONO DO GRUPO É QUEM ENVIA. `whatsapp_groups` guarda de qual
     usuário cada grupo veio na sincronização, e é a instância dele que
     tem permissão de postar ali — o WhatsApp não deixa ninguém postar
     num grupo do qual não participa. Deduzir isso aqui evita pedir à
     pessoa uma segunda escolha que ela não teria como responder. */
  let senderId: string | null = null;

  if (jid !== "") {
    const { data: grupo } = await admin
      .from("whatsapp_groups")
      .select("user_id")
      .eq("jid", jid)
      .maybeSingle();

    senderId = grupo?.user_id ?? user.id;
  }

  const { error } = await admin
    .from("balance_alert_settings")
    .update({
      group_jid: jid === "" ? null : jid,
      group_name: jid === "" ? null : nome || null,
      sender_id: senderId,
      /* Zera a trava do dia: trocar o destino deve permitir que o aviso
         de hoje saia no destino novo, em vez de esperar amanhã. */
      last_sent_on: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/alertas-saldo");
  return { ok: true };
}

/* =====================================================================
   Mandar agora
   ---------------------------------------------------------------------
   O aviso é automático uma vez por dia, mas a tela precisa de um jeito
   de mandar na hora — para conferir a configuração, e para o dia em que
   alguém quer avisar o grupo depois de recarregar.

   IGNORA A TRAVA DO DIA de propósito. `enviarAvisoDeSaldo` recusa se o
   aviso de hoje já saiu, o que está certo para o cron: reexecução não
   pode duplicar. Aqui é um clique deliberado de uma pessoa, e recusar
   com "já foi enviado hoje" faria a tela parecer quebrada justamente
   para quem está testando se ela funciona.
   ===================================================================== */

export async function enviarAvisoDeSaldoAgora(): Promise<
  { ok: true; destino: string; criticas: number } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return { ok: false, error: "Só administradores disparam o aviso." };
  }

  if (isDemoMode) {
    return { ok: false, error: "Em modo demonstração não há envio." };
  }

  /* Limpa a trava ANTES, e não dentro do disparador: assim o caminho do
     cron continua com a trava intacta e é este botão que carrega a
     decisão de repetir. */
  const admin = createSupabaseAdminClient();
  await admin
    .from("balance_alert_settings")
    .update({ last_sent_on: null })
    .eq("id", true);

  const { enviarAvisoDeSaldo } = await import("@/lib/ads/balance-notice");
  const r = await enviarAvisoDeSaldo();

  if (!r.enviado) {
    return { ok: false, error: r.motivo ?? "Não foi enviado." };
  }

  revalidatePath("/alertas-saldo");
  return {
    ok: true,
    destino: r.destino ?? "grupo",
    criticas: r.criticas ?? 0,
  };
}

/** A prévia exata do que sairia — para conferir antes de mandar. */
export async function previaDoAvisoDeSaldo(): Promise<
  { ok: true; texto: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const { montarPreviaDoAviso } = await import("@/lib/ads/balance-notice");
  const texto = await montarPreviaDoAviso();

  return texto
    ? { ok: true, texto }
    : { ok: false, error: "Nenhuma conta crítica agora — não haveria mensagem." };
}

/* =====================================================================
   Trazer os grupos do WhatsApp
   ---------------------------------------------------------------------
   O seletor lê `whatsapp_groups`, e até aqui quem preenchia essa tabela
   era SÓ um script de terminal (`scripts/evolution.mjs sincronizar`).
   Numa instalação nova ninguém roda esse script, então o seletor nascia
   desabilitado e sem explicação — controle morto na tela é pior que
   controle ausente, porque parece defeito do sistema.

   O script existe por um motivo real: a varredura da Evolution mediu
   ~110s numa conta com 231 grupos, e a função da Vercel morre em 60s.
   Isso continua valendo para conta grande. A diferença é que aqui a
   busca é um clique DELIBERADO de uma pessoa, e quando o tempo estoura
   a tela diz o que fazer, em vez de nunca funcionar em conta nenhuma.
   ===================================================================== */

export async function buscarMeusGrupos(): Promise<
  { ok: true; total: number } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return { ok: false, error: "Só administradores mexem no destino do aviso." };
  }

  if (isDemoMode) {
    return { ok: false, error: "Em modo demonstração não há WhatsApp." };
  }

  const { getSessionStatus, fetchAllGroups } = await import(
    "@/lib/whatsapp/session"
  );

  /* NÃO É REDUNDANTE com a checagem que `buscarGrupos` já faz lá
     dentro. Quando a varredura falha, `fetchAllGroups` cai na "última
     lista boa" guardada em memória e devolve `ok:true` — ótimo para
     PREENCHER um seletor, péssimo para GRAVAR: escreveríamos no banco
     os grupos de um aparelho que não está mais pareado, e o aviso
     diário sairia mirando um destino que ninguém consegue postar.
     Aqui a pergunta é sobre o aparelho, não sobre a lista.

     A frase também diz ONDE se pareia: quem está no aviso de saldo não
     tem como adivinhar que a resposta mora em outra página. */
  const sessao = await getSessionStatus(user.id);
  if (sessao.state !== "open") {
    return {
      ok: false,
      error:
        "Seu WhatsApp não está conectado. Pareie o celular em Configurações › Meu WhatsApp e tente de novo.",
    };
  }

  const r = await fetchAllGroups(user.id);
  if (!r.ok) return { ok: false, error: r.error };

  const linhas = r.groups
    .filter((g) => g.id.endsWith("@g.us"))
    .map((g) => ({
      user_id: user.id,
      jid: g.id,
      name: g.name.trim() || "(sem nome)",
      updated_at: new Date().toISOString(),
    }));

  if (linhas.length === 0) {
    return {
      ok: false,
      error: "Este WhatsApp não participa de nenhum grupo.",
    };
  }

  /* UPSERT por (user_id, jid), igual ao script: grupo renomeado
     atualiza, grupo novo entra, e nenhum é apagado. Sair de um grupo
     não pode zerar o destino já gravado no cadastro de um cliente. */
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("whatsapp_groups")
    .upsert(linhas, { onConflict: "user_id,jid" });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/alertas-saldo");
  return { ok: true, total: linhas.length };
}

import "server-only";

import { randomBytes } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Client } from "@/types/database";

/* =====================================================================
   O link público do cliente
   ---------------------------------------------------------------------
   Emitir, revogar e resolver o endereço que o cliente abre sem senha.

   ⚠️ RESOLUÇÃO COM service_role, E SÓ ELA. Do outro lado do link não há
   sessão — é o cliente final, que não tem conta no sistema. A RLS não
   tem quem avaliar, então a leitura precisa passar por fora dela.

   O que mantém isso seguro é o ESCOPO: esta função devolve UM cliente,
   o dono do token, e nada mais. Quem chama nunca recebe uma lista para
   filtrar depois — o filtro é a consulta.
   ===================================================================== */

/** 32 bytes de CSPRNG. Ver a nota da coluna na migration 47. */
function sortearToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface LinkPublico {
  id: string;
  token: string;
  criadoEm: string;
  ultimoAcesso: string | null;
}

/**
 * O link ativo desta conta, se houver.
 *
 * Leitura sob a sessão de quem perguntou — é a tela da agência que
 * chama, e a policy de leitura já libera para a equipe.
 */
export async function linkAtivoDoCliente(
  clientId: string,
): Promise<LinkPublico | null> {
  const { data } = await createSupabaseAdminClient()
    .from("client_share_links")
    .select("id, token, created_at, last_seen_at")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id as string,
    token: data.token as string,
    criadoEm: data.created_at as string,
    ultimoAcesso: (data.last_seen_at as string | null) ?? null,
  };
}

/**
 * Emite um link novo, revogando o anterior.
 *
 * ⚠️ REVOGA ANTES DE CRIAR, e a ordem importa: o índice parcial
 * `client_share_links_um_ativo` só admite um ativo por conta, então
 * inverter a ordem faria o insert colidir. Duas linhas vivas seria pior
 * do que a colisão — ninguém saberia qual endereço foi para quem.
 *
 * Emitir de novo INVALIDA o endereço que o cliente já tem. É o
 * comportamento certo para "o link vazou, quero outro", e quem chama
 * precisa dizer isso na tela antes de confirmar.
 */
export async function criarLinkPublico(
  clientId: string,
  criadoPor: string,
): Promise<{ ok: true; link: LinkPublico } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();

  await admin
    .from("client_share_links")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("is_active", true);

  const { data, error } = await admin
    .from("client_share_links")
    .insert({ client_id: clientId, token: sortearToken(), created_by: criadoPor })
    .select("id, token, created_at, last_seen_at")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Não foi possível emitir." };
  }

  return {
    ok: true,
    link: {
      id: data.id as string,
      token: data.token as string,
      criadoEm: data.created_at as string,
      ultimoAcesso: null,
    },
  };
}

/** Fecha o acesso. O endereço para de funcionar na próxima abertura. */
export async function revogarLinkPublico(
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createSupabaseAdminClient()
    .from("client_share_links")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("is_active", true);

  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * De token para cliente. É o portão da página pública.
 *
 * `null` para token inexistente, revogado ou malformado — quem chama
 * responde 404 nos três casos, sem distinguir. Dizer "este link foi
 * revogado" confirmaria que ele existiu, e a diferença entre "nunca
 * existiu" e "existiu e morreu" é informação que só interessa a quem
 * está sondando.
 */
export async function clienteDoToken(token: string): Promise<Client | null> {
  /* Barra tamanho antes de ir ao banco: token de 256 bits em base64url
     tem 43 caracteres. Qualquer coisa muito fora disso é sondagem, e
     não precisa custar uma consulta. */
  if (token.length < 32 || token.length > 128) return null;

  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("client_share_links")
    .select("id, clients(*)")
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();

  const linha = data as unknown as
    | { id: string; clients: Client | null }
    | null;

  if (!linha?.clients) return null;

  /* Carimba o acesso sem segurar a renderização: a página não depende
     desta escrita, e uma falha aqui não pode custar a visita. */
  void admin
    .from("client_share_links")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", linha.id)
    .then(() => undefined);

  return linha.clients;
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

const schema = z.object({
  profileId: z.string().uuid(),
  role: z.enum(["admin", "collaborator"]),
});

export type RoleResult = { ok: true } | { ok: false; error: string };

/**
 * Altera o nível de acesso de alguém da equipe.
 *
 * NÃO usa `service_role`, e isso é deliberado. O trigger
 * `guard_profile_privileges` já libera a troca quando quem escreve é
 * admin (`if app.is_admin() then return new`), e a policy
 * `profiles_admin_all` cobre a linha. Fazer por service_role
 * contornaria as duas — e no dia em que a regra do banco mudasse, esta
 * rota continuaria promovendo gente por fora dela.
 *
 * A checagem de admin daqui é para dar ERRO LEGÍVEL. Quem barra de
 * verdade é o Postgres: um colaborador que chamasse esta action direto
 * teria `new.role := old.role` aplicado pelo trigger e sairia sem
 * alteração nenhuma.
 */
export async function setUserRole(input: {
  profileId: string;
  role: "admin" | "collaborator";
}): Promise<RoleResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (user.role !== "admin") {
    return { ok: false, error: "Apenas administradores alteram acessos." };
  }

  /* Rebaixar a si mesmo deixaria a agência sem ninguém capaz de
     promover de volta — e o conserto seria pelo SQL Editor. Barrar aqui
     custa uma linha; destravar depois custa uma sessão. */
  if (parsed.data.profileId === user.id && parsed.data.role !== "admin") {
    return {
      ok: false,
      error: "Você não pode remover o próprio acesso de administrador.",
    };
  }

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.profileId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/configuracoes/equipe");
  return { ok: true };
}

const ativacaoSchema = z.object({
  profileId: z.string().uuid(),
  isActive: z.boolean(),
});

/**
 * Libera ou suspende o acesso de alguém.
 *
 * É o outro lado do cadastro aberto: quem se inscreve pela tela de
 * login nasce inativo, e esta action é a porta. Também serve para
 * desligar um ex-colaborador sem apagar o histórico dele nas tarefas.
 *
 * Pelo mesmo motivo de `setUserRole`, sem `service_role`: o trigger
 * `guard_profile_privileges` já reescreve `is_active` para o valor
 * antigo quando quem grava não é admin, então o banco continua sendo
 * quem barra de verdade. A checagem daqui existe para dar erro legível.
 */
export async function setUserActive(input: {
  profileId: string;
  isActive: boolean;
}): Promise<RoleResult> {
  const parsed = ativacaoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (user.role !== "admin") {
    return { ok: false, error: "Apenas administradores liberam acessos." };
  }

  /* Suspender a si mesmo é o mesmo tiro no pé de rebaixar-se: a pessoa
     cai em /sem-acesso no próximo carregamento e não sobra tela capaz
     de reverter. */
  if (parsed.data.profileId === user.id && !parsed.data.isActive) {
    return { ok: false, error: "Você não pode suspender o próprio acesso." };
  }

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.profileId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/configuracoes/equipe");
  return { ok: true };
}

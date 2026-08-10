import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isDemoMode, supabaseAnonKey, supabaseUrl } from "@/lib/env";
import type { Profile } from "@/types/database";

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 *
 * Roda com a chave ANON e o JWT do usuário logado — portanto TODA query
 * feita por aqui passa pelas policies de RLS. É o caminho padrão: a
 * autorização vive no banco, não em `if`s espalhados pela aplicação.
 *
 * Next 16: `cookies()` é assíncrono, então esta função também é.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components não podem escrever cookies. Ignorar é seguro:
          // quem renova a sessão é o proxy (src/proxy.ts), que roda antes.
        }
      },
    },
  });
}

/**
 * Usuário autenticado + perfil (com a role) numa única chamada.
 *
 * Usa `getUser()`, não `getSession()`: `getSession` lê o cookie sem
 * validar a assinatura no servidor de auth, e cookie é falsificável.
 * Para decisão de autorização, sempre `getUser()`.
 */
/**
 * Estado de acesso da requisição — TRÊS resultados, não dois.
 *
 * "Autenticado" e "pode usar o sistema" são coisas diferentes, e tratar
 * as duas como o mesmo booleano produzia dois defeitos:
 *
 * 1. LOOP DE REDIRECT. Sessão válida sem linha em `profiles` (usuário
 *    criado no painel do Supabase antes das migrations, ou perfil
 *    apagado à mão) fazia `getCurrentUser` devolver null, o layout
 *    mandar para /login, e o proxy — que só olha a SESSÃO — devolver
 *    para /. Ciclo fechado, sem saída pela interface: não existe rota
 *    de logout fora do layout que redireciona.
 *
 * 2. `is_active` NÃO DESATIVAVA NINGUÉM. A coluna só era respeitada por
 *    `app.is_admin()` no banco. Um colaborador desligado continuava
 *    lendo a carteira inteira, porque `clients_select` é `using (true)`
 *    e `app.client_is_visible()` não olha a coluna.
 *
 * Quem precisa distinguir os três casos usa esta função. Quem só quer
 * "o usuário que pode agir" continua em `getCurrentUser`, que devolve
 * null tanto para anônimo quanto para negado — é a resposta segura.
 */
export type EstadoDeAcesso =
  | { status: "anonimo" }
  | { status: "ok"; profile: Profile }
  | { status: "negado"; motivo: "sem-perfil" | "inativo" };

export async function getAccessState(): Promise<EstadoDeAcesso> {
  if (isDemoMode) {
    const { demoCurrentUser } = await import("@/lib/mock/data");
    return { status: "ok", profile: demoCurrentUser };
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: "anonimo" };

  /* `maybeSingle` e não `single`: ausência de perfil é um ESTADO
     previsto, não erro. Com `single` o PostgREST devolve PGRST116 e a
     causa some — foi o que escondeu o loop acima. */
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile) return { status: "negado", motivo: "sem-perfil" };
  if (!profile.is_active) return { status: "negado", motivo: "inativo" };

  return { status: "ok", profile };
}

export async function getCurrentUser() {
  const acesso = await getAccessState();
  return acesso.status === "ok" ? acesso.profile : null;
}

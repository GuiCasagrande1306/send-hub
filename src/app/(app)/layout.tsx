import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { OAuthReturnToast } from "@/components/layout/oauth-return-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getAccessState } from "@/lib/supabase/server";
import { getClients } from "@/lib/data";
import { isDemoMode } from "@/lib/env";

/**
 * Layout autenticado.
 *
 * A lista de clientes da sidebar já vem filtrada pelo RLS: um
 * colaborador simplesmente não recebe as contas em que não foi
 * incluído. Não há filtro cosmético no cliente — o que não veio do
 * banco não existe para aquela sessão.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const acesso = await getAccessState();

  // Rede de segurança: o proxy já teria redirecionado, mas uma sessão
  // pode expirar entre o proxy e a renderização.
  if (acesso.status === "anonimo") redirect("/login");

  /* NÃO mandar para /login aqui. A sessão é válida — só o perfil que
     não serve — e o proxy devolve toda sessão válida que chega em
     /login de volta para cá. Os dois juntos formavam um loop de
     redirect sem saída pela interface. `/sem-acesso` é a única rota que
     escapa das duas regras e oferece um logout. */
  if (acesso.status === "negado") {
    redirect(`/sem-acesso?motivo=${acesso.motivo}`);
  }

  const user = acesso.profile;

  const clients = await getClients();

  // `delay` em ms — Base UI, não `delayDuration` do Radix.
  return (
    <TooltipProvider delay={200}>
      {/* `useSearchParams` obriga um limite de Suspense, senão o Next
          desativa a renderização estática de TODAS as rotas abaixo
          deste layout. Não renderiza nada — só dispara o aviso. */}
      <Suspense fallback={null}>
        <OAuthReturnToast />
      </Suspense>

      <AppShell user={user} clients={clients} demoMode={isDemoMode}>
        {children}
      </AppShell>
    </TooltipProvider>
  );
}

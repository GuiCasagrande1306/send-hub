import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { TeamTable } from "@/components/settings/team-table";
import { getTeamAll } from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Equipe" };

/**
 * Gestão de equipe e níveis de acesso.
 *
 * `notFound()` e não uma mensagem de "sem permissão": a existência da
 * tela não é informação que um colaborador precise. Redirecionar para o
 * dashboard com erro, como o pedido sugeria, anunciaria que há uma
 * página de administração ali.
 *
 * A checagem aqui é só a primeira camada. Quem barra de verdade é o
 * trigger `guard_profile_privileges`, que reescreve `role` para o valor
 * antigo quando quem grava não é admin — mesmo que alguém chame a
 * Server Action por fora desta página.
 */
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") notFound();

  /* `getTeamAll` e não `getTeam`: aquele esconde inativos porque
     alimenta seletor de responsável, e é justamente o inativo — quem se
     cadastrou e espera liberação — que precisa aparecer aqui. */
  const team = await getTeamAll();
  const pendentes = team.filter((p) => !p.is_active).length;

  return (
    <PageContainer>
      <PageHeader
        title="Equipe"
        description="Quem tem acesso ao Send Hub e em qual nível."
      />

      {pendentes > 0 && (
        <div className="mt-6 rounded-xl border border-signal/40 bg-signal-muted/40 p-4">
          <p className="text-sm font-medium">
            {pendentes === 1
              ? "1 pessoa aguardando liberação"
              : `${pendentes} pessoas aguardando liberação`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Quem se cadastra pela tela de login entra sem acesso a dado nenhum
            até alguém liberar aqui. Confirme que você reconhece o e-mail antes
            de aprovar — a partir daí a pessoa enxerga a carteira inteira,
            métricas e tarefas.
          </p>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-hairline bg-surface-2/50 p-4">
        <p className="text-sm font-medium">O que cada nível enxerga</p>
        <p className="mt-1 text-xs text-muted-foreground">
          <strong>Administrador</strong> vê a torre de controle, cadastra
          clientes, conecta contas de mídia e enxerga honorários.{" "}
          <strong>Colaborador</strong> vê a operação inteira — clientes,
          métricas, tarefas e esteira — mas não os valores de contrato nem
          as telas de cadastro.
        </p>
      </div>

      <div className="mt-5">
        <TeamTable team={team} currentUserId={user.id} />
      </div>
    </PageContainer>
  );
}

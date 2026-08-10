import type { Metadata } from "next";

import { SairButton } from "./sair-button";

export const metadata: Metadata = { title: "Sem acesso" };

/**
 * Saída para a sessão que existe mas não pode usar o sistema.
 *
 * Precisa ficar FORA do grupo `(app)`: aquele layout redireciona quem
 * não tem perfil, e uma tela de erro dentro dele se redirecionaria a si
 * mesma. Precisa também ficar fora de `/login`, porque o proxy manda
 * toda sessão válida que chega em /login de volta para a raiz — era
 * exatamente esse par de regras que fechava o ciclo de redirect.
 *
 * O botão de sair é o ponto principal da página, não enfeite: sem ele a
 * única forma de escapar é limpar o cookie do domínio na mão.
 */
export default async function SemAcessoPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;
  const inativo = motivo === "inativo";

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-12">
      <div className="w-full max-w-md">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <svg
            viewBox="152 96 208 320"
            aria-hidden="true"
            className="h-4 w-auto fill-current"
          >
            <polygon points="152,96 360,96 236,254 152,254" />
            <polygon points="360,258 360,416 152,416 276,258" />
          </svg>
        </span>

        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
          {inativo ? "Seu acesso foi desativado" : "Conta sem acesso liberado"}
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {inativo ? (
            <>
              Sua conta continua existindo, mas foi marcada como inativa por um
              administrador. Enquanto estiver assim, nenhum dado da agência é
              carregado.
            </>
          ) : (
            <>
              Você entrou com sucesso, só que esta conta ainda não foi vinculada
              a um perfil no Send Hub. Isso acontece quando o usuário é criado
              no painel do Supabase antes de o sistema estar provisionado.
            </>
          )}
        </p>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Peça a um administrador para{" "}
          {inativo ? "reativar seu acesso" : "liberar seu perfil"} em
          Configurações → Equipe.
        </p>

        <SairButton />
      </div>
    </main>
  );
}

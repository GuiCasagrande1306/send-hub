import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { LoginForm } from "./login-form";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Entrar" };

/**
 * Tela de login.
 *
 * Metade esquerda: o formulário. Metade direita (só em telas largas):
 * um painel de marca. O contraste entre as duas superfícies é o que
 * evita o "formulário centralizado flutuando no vazio" — layout que
 * denuncia página de autenticação genérica.
 */
export default function LoginPage() {
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2.5">
            {/* O símbolo da marca, o mesmo de `public/logo-*.svg`: inline
                porque aqui ele precisa herdar a cor do badge. */}
            <span className="relative flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <svg
                viewBox="152 96 208 320"
                aria-hidden="true"
                className="h-4 w-auto fill-current"
              >
                <polygon points="152,96 360,96 236,254 152,254" />
                <polygon points="360,258 360,416 152,416 276,258" />
              </svg>
            </span>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-semibold tracking-tight">Send Hub</span>
              <span className="text-2xs text-muted-foreground">Marketing 360</span>
            </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            Entrar na sua conta
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Use o e-mail corporativo cadastrado pela agência.
          </p>

          {isDemoMode ? (
            <div className="mt-8 rounded-xl border border-hairline bg-surface-2/50 p-5">
              <p className="text-sm font-medium">Modo demonstração ativo</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Nenhuma credencial do Supabase foi configurada, então a
                autenticação está desligada e o sistema exibe um conjunto de
                dados de exemplo.
              </p>
              <Link
                href="/"
                className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Entrar na demonstração
              </Link>
            </div>
          ) : (
            // `LoginForm` lê `?next=` para voltar à página pretendida
            // após o login; `useSearchParams` exige limite de Suspense.
            <Suspense fallback={<div className="mt-8 h-52" />}>
              <LoginForm />
            </Suspense>
          )}
        </div>
      </div>

      {/* Amarelo cheio com tinta preta: é a marca inteira numa superfície
          só. Fica igual nos dois temas de propósito — no claro ele separa
          do papel, no escuro do fundo, e em ambos é a mesma metade
          amarela do avatar da agência. Sem `glow-signal` aqui: o brilho
          é do amarelo sobre fundo escuro e some dentro do próprio
          amarelo. */}
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:block">
        <div className="grid-hairline pointer-events-none absolute inset-0 opacity-[0.18]" />
        <div className="relative z-10 flex h-full flex-col justify-end p-16">
          <blockquote className="max-w-md">
            <p className="text-2xl font-medium leading-snug tracking-[-0.02em]">
              Investimento, resultado e custo por resultado. O resto é
              contexto.
            </p>
            <footer className="mt-4 text-sm text-primary-foreground/70">
              O princípio que organiza cada painel deste sistema.
            </footer>
          </blockquote>
        </div>
      </aside>
    </main>
  );
}

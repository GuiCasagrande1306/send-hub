"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/* =====================================================================
   Entrar e criar conta, no mesmo formulário
   ---------------------------------------------------------------------
   Autentica pelo cliente do BROWSER, não por Server Action: é ele que
   grava os cookies de sessão que o proxy renova nas requisições
   seguintes. Depois de autenticar, `router.refresh()` faz os Server
   Components recarregarem já com a sessão válida.

   O QUE ACONTECE DEPOIS DE CRIAR A CONTA. O trigger
   `app.handle_new_user()` decide: a PRIMEIRA conta da instalação vira
   admin ativa e cai direto no painel; todas as depois nascem
   colaboradoras e INATIVAS. A pessoa fica logada, mas `getAccessState()`
   devolve "negado" e o layout a manda para /sem-acesso, onde lê que
   precisa de liberação. É de propósito: sem isso, cadastro aberto num
   painel com `clients_select using (true)` entregaria a carteira
   inteira para quem descobrisse a URL.

   Por isso o botão não promete acesso — diz "Criar conta", e o aviso
   ao lado explica a fila antes de a pessoa clicar.
   ===================================================================== */

type Modo = "entrar" | "criar";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [modo, setModo] = useState<Modo>("entrar");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const criando = modo === "criar";

  function trocarModo(novo: Modo) {
    setModo(novo);
    setError(null);
    setAviso(null);
    setPassword("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setAviso(null);
    setLoading(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase não configurado.");
      setLoading(false);
      return;
    }

    if (criando) {
      if (password.length < 8) {
        setError("A senha precisa de pelo menos 8 caracteres.");
        setLoading(false);
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: nome.trim() } },
      });

      if (signUpError) {
        setError(traduzirErro(signUpError.message));
        setLoading(false);
        return;
      }

      /* E-mail JÁ CADASTRADO não vem como erro. Para não permitir
         enumerar quem tem conta na agência, o Supabase devolve sucesso
         com `identities` vazio. Tratar como sucesso mandaria a pessoa
         para uma tela de espera que nunca termina. */
      if (data.user && data.user.identities?.length === 0) {
        setAviso(
          "Se ainda não houver conta com este e-mail, ela foi criada. Se já houver, use Entrar — ou peça a redefinição de senha a um administrador.",
        );
        setLoading(false);
        return;
      }

      /* Sem sessão = a confirmação por e-mail está LIGADA no projeto.
         O fluxo continua funcionando, só que pelo link do e-mail. */
      if (!data.session) {
        setAviso(
          "Conta criada. Confirme o endereço pelo link que enviamos por e-mail e depois entre por aqui.",
        );
        setLoading(false);
        return;
      }

      /* Com sessão, quem decide para onde ir é o layout autenticado:
         primeira conta cai no painel, as demais em /sem-acesso. */
      router.replace("/");
      router.refresh();
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      // Mensagem genérica de propósito: distinguir "e-mail não existe" de
      // "senha errada" permite enumerar quem tem conta na agência.
      setError("E-mail ou senha incorretos.");
      setLoading(false);
      return;
    }

    router.replace(searchParams.get("next") || "/");
    router.refresh();
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Entrar ou criar conta"
        className="mt-8 grid grid-cols-2 gap-1 rounded-xl border border-hairline bg-surface-2/60 p-1"
      >
        {(
          [
            ["entrar", "Entrar"],
            ["criar", "Criar conta"],
          ] as const
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            role="tab"
            aria-selected={modo === valor}
            onClick={() => trocarModo(valor)}
            className={
              "h-9 rounded-lg text-sm font-medium transition-colors " +
              (modo === valor
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {rotulo}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
        {criando && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="nome">Nome completo</Label>
            <Input
              id="nome"
              autoComplete="name"
              required
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              placeholder="Como aparece para a equipe"
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@sendagencia.com.br"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            autoComplete={criando ? "new-password" : "current-password"}
            required
            minLength={criando ? 8 : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {criando && (
            <p className="text-2xs text-muted-foreground">
              Mínimo de 8 caracteres.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}

        {aviso && (
          <p
            role="status"
            className="rounded-lg bg-signal-muted px-3 py-2 text-sm text-foreground"
          >
            {aviso}
          </p>
        )}

        <Button type="submit" disabled={loading} className="mt-1 h-10">
          {loading && <Loader2 className="size-4 animate-spin" />}
          {criando ? "Criar conta" : "Entrar"}
        </Button>

        {criando && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Contas novas entram aguardando liberação — um administrador
            precisa aprovar em Configurações → Equipe antes que os dados da
            agência apareçam. A primeira conta da instalação é a exceção: ela
            vira a administradora.
          </p>
        )}
      </form>
    </>
  );
}

/** As mensagens do GoTrue vêm em inglês e vazam jargão de implementação. */
function traduzirErro(mensagem: string): string {
  const m = mensagem.toLowerCase();

  if (m.includes("signups not allowed") || m.includes("signup is disabled")) {
    return "O cadastro está desativado neste projeto. Peça a um administrador para criar seu acesso.";
  }
  if (m.includes("password")) {
    return "Senha muito curta ou fraca. Use pelo menos 8 caracteres.";
  }
  if (m.includes("invalid") && m.includes("email")) {
    return "E-mail inválido.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
  }
  return "Não foi possível criar a conta. Tente de novo em instantes.";
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import {
  emitirLinkPublico,
  revogarLinkPublicoAction,
} from "@/app/(app)/clientes/actions";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

/* =====================================================================
   O endereço que o cliente abre sem senha
   ---------------------------------------------------------------------
   ⚠️ ESTE LINK É UMA CREDENCIAL. Quem o tiver vê investimento, receita e
   campanha a campanha desta conta — sem senha e sem registro de quem
   abriu. A tela precisa dizer isso ANTES de alguém emitir, não depois:
   uma vez colado num grupo de WhatsApp, não há como recolher.

   EMITIR DE NOVO DERRUBA O ANTERIOR, e é isso que faz o botão valer
   como conserto de vazamento. Por isso o texto do botão muda quando já
   existe link: "Gerar outro" avisa que o atual morre, "Gerar link" não.
   ===================================================================== */

export function LinkPublico({
  clientId,
  token,
  criadoEm,
  ultimoAcesso,
  podeEditar,
}: {
  clientId: string;
  token: string | null;
  criadoEm: string | null;
  ultimoAcesso: string | null;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [ocupado, iniciar] = useTransition();
  const [copiado, setCopiado] = useState(false);

  /* Montada no navegador: o servidor não sabe por qual domínio a pessoa
     chegou, e um endereço com o host errado é um link que não abre. */
  const url =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/p/${token}`
      : null;

  function emitir() {
    iniciar(async () => {
      try {
        const r = await emitirLinkPublico({ clientId });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(
          token ? "Link novo gerado — o anterior parou de funcionar." : "Link gerado.",
        );
        router.refresh();
      } catch {
        /* Server Action recusada pela rede LANÇA, e dentro de
           `useTransition` a exceção escapa para o error boundary. */
        toast.error("Não deu para gerar. Tente de novo.");
      }
    });
  }

  function revogar() {
    iniciar(async () => {
      try {
        const r = await revogarLinkPublicoAction({ clientId });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success("Link revogado. O endereço parou de abrir.");
        router.refresh();
      } catch {
        toast.error("Não deu para revogar. Tente de novo.");
      }
    });
  }

  async function copiar() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopiado(true);
    toast.success("Link copiado.");
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <section className="surface-card p-4">
      <div className="flex items-start gap-2.5">
        <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Painel do cliente</p>
          <p className="mt-1 max-w-prose text-2xs text-muted-foreground">
            Um endereço que o cliente abre sem senha, com filtro de período
            e os mesmos números do relatório.{" "}
            <strong>Quem tiver o link vê os dados desta conta</strong> — trate
            como senha e mande só para quem deve ver.
          </p>

          {token && url ? (
            <>
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
                {/* `break-all` porque o token não tem espaço para quebrar
                    e vazaria do cartão no celular. */}
                <code className="min-w-0 flex-1 break-all font-mono text-2xs">
                  {url}
                </code>
                <Button size="sm" variant="ghost" onClick={copiar}>
                  {copiado ? (
                    <Check className="size-3.5 text-positive" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  Copiar
                </Button>
              </div>

              <p className="mt-2 text-2xs text-muted-foreground">
                Criado em {criadoEm ? formatDate(criadoEm) : "—"} ·{" "}
                {ultimoAcesso
                  ? `último acesso em ${formatDate(ultimoAcesso)}`
                  : "o cliente ainda não abriu"}
              </p>
            </>
          ) : (
            <p className="mt-3 text-2xs text-muted-foreground">
              Nenhum link ativo — este cliente não tem acesso ao painel.
            </p>
          )}

          {podeEditar ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={ocupado} onClick={emitir}>
                {token ? "Gerar outro" : "Gerar link"}
              </Button>
              {token && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ocupado}
                  onClick={revogar}
                  title="O endereço para de abrir imediatamente."
                >
                  <ShieldOff className="size-3.5" />
                  Revogar
                </Button>
              )}
            </div>
          ) : (
            <p className="mt-3 text-2xs text-muted-foreground">
              Só administradores emitem ou revogam este link.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

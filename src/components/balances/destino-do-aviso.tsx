"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, BellOff, Eye, Send } from "lucide-react";
import { toast } from "sonner";

import {
  definirGrupoDoAviso,
  enviarAvisoDeSaldoAgora,
  previaDoAvisoDeSaldo,
} from "@/app/(app)/alertas-saldo/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* =====================================================================
   Para onde o aviso diário vai
   ---------------------------------------------------------------------
   A página sabia quais contas estão prestes a zerar e não avisava
   ninguém: era preciso abrir a tela para descobrir, o que só acontece
   depois de alguém desconfiar — e aí é tarde. Aqui se escolhe o grupo
   de WhatsApp que recebe.

   SEM GRUPO ESCOLHIDO, O CRON NÃO MANDA NADA — e a tela diz isso, em
   vez de deixar supor que o aviso está de pé. Um alerta que a pessoa
   acha que existe e não existe é pior que nenhum.

   A PRÉVIA VEM DA MESMA FUNÇÃO DO ENVIO. Duas implementações divergem,
   e a que diverge é justamente a que ninguém confere — a prévia. Aqui
   `previaDoAvisoDeSaldo` chama o mesmo `montarMensagem` do disparo.
   ===================================================================== */

export interface GrupoDisponivel {
  jid: string;
  name: string;
}

const NENHUM = "__nenhum__";

export function DestinoDoAviso({
  grupos,
  jidAtual,
  nomeAtual,
  podeEditar,
}: {
  grupos: GrupoDisponivel[];
  jidAtual: string | null;
  nomeAtual: string | null;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(jidAtual ?? NENHUM);
  const [salvando, iniciar] = useTransition();
  const [ocupado, setOcupado] = useState<"previa" | "envio" | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);

  function escolher(novo: string | null) {
    const jid = novo ?? NENHUM;
    setValor(jid);

    iniciar(async () => {
      try {
        const r = await definirGrupoDoAviso({
          jid: jid === NENHUM ? "" : jid,
          nome: grupos.find((g) => g.jid === jid)?.name ?? "",
        });

        if (!r.ok) {
          setValor(jidAtual ?? NENHUM);
          toast.error(r.error);
          return;
        }

        toast.success(
          jid === NENHUM ? "Aviso diário desligado." : "Destino do aviso salvo.",
        );
        router.refresh();
      } catch {
        /* Server Action recusada pela rede LANÇA, e dentro de
           `useTransition` a exceção escapa para o error boundary e leva
           a página inteira. */
        setValor(jidAtual ?? NENHUM);
        toast.error("Não deu para salvar. Tente de novo.");
      }
    });
  }

  async function verPrevia() {
    setOcupado("previa");
    try {
      const r = await previaDoAvisoDeSaldo();
      if (!r.ok) {
        toast.message(r.error);
        return;
      }
      setPrevia(r.texto);
    } catch {
      toast.error("Não deu para montar a prévia.");
    } finally {
      setOcupado(null);
    }
  }

  async function mandarAgora() {
    setOcupado("envio");
    try {
      const r = await enviarAvisoDeSaldoAgora();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `Aviso enviado para ${r.destino} — ${r.criticas} ${r.criticas === 1 ? "conta" : "contas"}.`,
      );
      setPrevia(null);
      router.refresh();
    } catch {
      toast.error("Falha de rede no envio.");
    } finally {
      setOcupado(null);
    }
  }

  const ligado = Boolean(jidAtual);

  return (
    <>
      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-hairline bg-surface-2/60 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-2.5">
          {ligado ? (
            <BellRing className="mt-0.5 size-4 shrink-0 text-positive" />
          ) : (
            <BellOff className="mt-0.5 size-4 shrink-0 text-warning" />
          )}

          <div>
            <p className="text-sm font-medium">
              {ligado ? "Aviso diário ligado" : "Ninguém está sendo avisado"}
            </p>
            <p className="mt-1 max-w-prose text-2xs text-muted-foreground">
              {ligado ? (
                <>
                  Todo dia de manhã, as contas <strong>críticas</strong> vão
                  para <strong>{nomeAtual ?? jidAtual}</strong>. Contas em
                  atenção, sem saldo lido e pós-pagas ficam de fora — aviso que
                  chega todo dia deixa de ser lido, e aí o crítico passa junto.
                </>
              ) : (
                <>
                  Esta página só alerta quem a abre. Escolha um grupo do SendZap
                  para receber as contas críticas de manhã.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          {ligado && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={verPrevia}
                disabled={ocupado !== null}
              >
                <Eye className="size-3.5" />
                {ocupado === "previa" ? "Montando…" : "Ver prévia"}
              </Button>
              {podeEditar && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={mandarAgora}
                  disabled={ocupado !== null}
                  title="Manda o aviso agora, sem esperar a rodada da manhã."
                >
                  <Send className="size-3.5" />
                  {ocupado === "envio" ? "Enviando…" : "Enviar agora"}
                </Button>
              )}
            </>
          )}

          {podeEditar ? (
            <Select
              value={valor}
              onValueChange={escolher}
              disabled={salvando || grupos.length === 0}
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue>
                  {(v: string) =>
                    v === NENHUM
                      ? "Não avisar"
                      : (grupos.find((g) => g.jid === v)?.name ??
                        "Grupo escolhido")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM}>Não avisar</SelectItem>
                {grupos.map((g) => (
                  <SelectItem key={g.jid} value={g.jid}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-2xs text-muted-foreground">
              Só administradores mudam o destino.
            </span>
          )}
        </div>
      </div>

      <Dialog open={previa !== null} onOpenChange={() => setPrevia(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>O que sairia agora</DialogTitle>
            <DialogDescription>
              Exatamente este texto, montado pela mesma função do envio.
            </DialogDescription>
          </DialogHeader>
          {/* `break-words` porque nome de cliente longo não quebra
              sozinho dentro de `whitespace-pre-wrap` e vazaria do
              diálogo. */}
          <pre className="max-h-[50dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 font-mono text-xs">
            {previa}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}

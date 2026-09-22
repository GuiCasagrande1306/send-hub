"use client";

import { useCallback, useState } from "react";
import { Check, ChevronsUpDown, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/* =====================================================================
   O que conta como conversão no Google
   ---------------------------------------------------------------------
   Irmão do `GoogleAccountPicker`, com uma diferença que muda o desenho:
   aqui a escolha é MÚLTIPLA. Uma imobiliária conta formulário E ligação;
   obrigar a escolher um só devolveria metade dos leads.

   Por isso não fecha ao clicar. Seletor de múltipla escolha que fecha a
   cada item obriga a reabrir uma vez por opção, e quem está marcando
   três perde a lista de vista entre uma e outra.

   VAZIO NÃO É NEUTRO, e o rótulo diz isso. Sem escolha vale
   `metrics.conversions`, que soma as ações marcadas como principais na
   conta — configuração feita para o Google otimizar o lance, não para o
   relatório. É de lá que vem "Visualização de página" contada como lead.
   ===================================================================== */

interface Acao {
  id: string;
  name: string;
  category: string | null;
  status: string | null;
}

/** As categorias que quase nunca são o resultado que o cliente compra. */
const MICRO = new Set([
  "PAGE_VIEW",
  "ENGAGEMENT",
  "GET_DIRECTIONS",
  "OUTBOUND_CLICK",
  "DOWNLOAD",
]);

export function GoogleConversionPicker({
  clientId,
  value,
  onChange,
  disabled,
}: {
  clientId: string;
  /** IDs escolhidos. Vazio = total da conta. */
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscou, setBuscou] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    try {
      const r = await fetch(
        `/api/google/conversion-actions?clientId=${encodeURIComponent(clientId)}`,
        { cache: "no-store" },
      );
      const d = await r.json();

      if (d.ok) {
        setAcoes(d.actions ?? []);
        if ((d.actions ?? []).length === 0) {
          setErro("Esta conta não tem ação de conversão configurada.");
        }
      } else {
        setErro(d.error ?? "Não foi possível listar as conversões.");
      }
    } catch {
      setErro("Falha de rede ao buscar as conversões.");
    } finally {
      setCarregando(false);
      setBuscou(true);
    }
  }, [clientId]);

  /* Busca ao ABRIR: é uma chamada à API do Google, e quem abre a tela de
     integrações quase nunca vem mexer na conversão. */
  function aoAbrir(novo: boolean) {
    setAberto(novo);
    if (novo && !buscou) void carregar();
  }

  function alternar(id: string) {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
    );
  }

  const escolhidas = acoes.filter((a) => value.includes(a.id));

  /* O rótulo prefere NOME a contagem. "2 escolhidas" obriga a abrir para
     saber quais; com os nomes, a conferência acontece de relance — que é
     o que alguém faz antes de mandar o relatório. */
  const rotulo =
    value.length === 0
      ? "Todas as principais da conta"
      : escolhidas.length > 0
        ? escolhidas.map((a) => a.name).join(", ")
        : `${value.length} ${value.length === 1 ? "ação escolhida" : "ações escolhidas"}`;

  return (
    <Popover open={aberto} onOpenChange={aoAbrir}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span
              className={cn(
                "truncate",
                value.length === 0 && "text-muted-foreground",
              )}
            >
              {rotulo}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </Button>
        }
      />

      <PopoverContent className="w-[--anchor-width] p-0" align="start">
        <Command shouldFilter>
          <CommandInput placeholder="Buscar ação de conversão…" />

          <CommandList>
            {carregando && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Consultando o Google…
              </div>
            )}

            {!carregando && erro && (
              <div className="px-3 py-3">
                <p className="text-xs text-warning">{erro}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2.5"
                  onClick={() => void carregar()}
                >
                  <RefreshCw className="size-3.5" />
                  Tentar de novo
                </Button>
              </div>
            )}

            {!carregando && !erro && (
              <CommandEmpty>Nenhuma ação com esse nome.</CommandEmpty>
            )}

            <CommandGroup>
              <CommandItem
                value="todas as principais da conta"
                onSelect={() => onChange([])}
              >
                <Check
                  className={cn(
                    "size-3.5 shrink-0",
                    value.length === 0 ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="min-w-0 flex-1">
                  Todas as principais da conta
                </span>
              </CommandItem>
            </CommandGroup>

            {acoes.length > 0 && (
              <CommandGroup heading="Ações de conversão">
                {acoes.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`${a.name} ${a.id}`}
                    /* NÃO fecha: a escolha é múltipla. */
                    onSelect={() => alternar(a.id)}
                  >
                    <Check
                      className={cn(
                        "size-3.5 shrink-0",
                        value.includes(a.id) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>

                    {/* A categoria fica visível justamente nas que
                        inflam o número. É o que deixa "Visualização de
                        página" se denunciar na hora de escolher. */}
                    {a.category && MICRO.has(a.category) && (
                      <span className="shrink-0 rounded bg-warning-muted px-1 text-[10px] text-warning">
                        {a.category === "PAGE_VIEW" ? "visita" : "micro"}
                      </span>
                    )}
                    {a.status === "PAUSED" && (
                      <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                        pausada
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

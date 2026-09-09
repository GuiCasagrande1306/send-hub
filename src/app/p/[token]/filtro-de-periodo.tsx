"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { DateRangePicker, type Intervalo } from "@/components/ui/date-range-picker";

/* =====================================================================
   O período, escrito na URL
   ---------------------------------------------------------------------
   Trocar a data navega em vez de guardar estado. O servidor rebusca e
   devolve a página inteira com os números da janela nova — é o mesmo
   caminho da estação de comando, e pelo mesmo motivo: um controle que
   troca o rótulo sem trocar o dado é pior que controle nenhum.

   A URL carregar o período dá três coisas de graça: o cliente salva um
   período nos favoritos, manda o endereço para o sócio que vê
   exatamente a mesma tela, e o botão voltar do navegador funciona.
   ===================================================================== */

export function FiltroDePeriodo({
  inicio,
  fim,
}: {
  inicio: string;
  fim: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodo, setPeriodo] = useState<Intervalo>({ inicio, fim });
  const [navegando, iniciar] = useTransition();

  function trocar(novo: Intervalo) {
    setPeriodo(novo);
    iniciar(() => {
      /* `push` e não `replace`: o voltar do navegador precisa desfazer a
         troca de período, que é o gesto mais provável depois de olhar
         uma janela e querer a anterior. */
      router.push(`${pathname}?de=${novo.inicio}&ate=${novo.fim}`);
    });
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <span className="eyebrow">
        Período
        {navegando && (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground">
            somando…
          </span>
        )}
      </span>
      <DateRangePicker value={periodo} onChange={trocar} />
    </div>
  );
}

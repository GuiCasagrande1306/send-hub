"use client";

import { useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * O único logout alcançável fora do layout autenticado.
 *
 * `window.location.replace` em vez de `router.push`: depois do
 * `signOut` o cookie mudou, e só uma navegação de documento inteiro faz
 * o proxy reavaliar a sessão. Com navegação de cliente o Next reusaria
 * a árvore em cache e a tela pareceria travada.
 */
export function SairButton() {
  const [saindo, setSaindo] = useState(false);

  return (
    <button
      type="button"
      disabled={saindo}
      onClick={async () => {
        setSaindo(true);
        await getSupabaseBrowserClient().auth.signOut();
        window.location.replace("/login");
      }}
      className="mt-8 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {saindo ? "Saindo…" : "Sair desta conta"}
    </button>
  );
}

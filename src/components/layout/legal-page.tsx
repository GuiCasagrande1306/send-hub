import Link from "next/link";

/* =====================================================================
   Casca das páginas legais
   ---------------------------------------------------------------------
   Política de privacidade e instruções de exclusão de dados são exigidas
   pela Meta para liberar o Login do Facebook — sem elas o diálogo
   responde "Recurso indisponível" para qualquer pessoa que não tenha
   papel no app, e o sintoma não menciona o cadastro incompleto.

   Ficam FORA do grupo `(app)`: precisam abrir sem sessão, porque quem
   as lê é o revisor da Meta e, eventualmente, o cliente final.
   ===================================================================== */

export function LegalPage({
  titulo,
  atualizadoEm,
  children,
}: {
  titulo: string;
  /** Data por extenso. Revisor de plataforma procura por ela. */
  atualizadoEm: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-6 py-16">
      <Link
        href="/login"
        className="inline-flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <svg
            viewBox="152 96 208 320"
            aria-hidden="true"
            className="h-4 w-auto fill-current"
          >
            <polygon points="152,96 360,96 236,254 152,254" />
            <polygon points="360,258 360,416 152,416 276,258" />
          </svg>
        </span>
        <span className="text-sm font-semibold tracking-tight">Send Hub</span>
      </Link>

      <h1 className="mt-10 text-3xl font-semibold tracking-[-0.02em]">
        {titulo}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última atualização: {atualizadoEm}
      </p>

      <div className="mt-10 flex flex-col gap-6 text-sm leading-relaxed text-foreground [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-semibold [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>

      <footer className="mt-16 border-t border-hairline pt-6 text-xs text-muted-foreground">
        Send Hub — sistema interno de gestão da Agência Send.
      </footer>
    </main>
  );
}

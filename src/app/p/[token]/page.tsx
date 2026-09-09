import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { clienteDoToken } from "@/lib/reports/share-link";
import { getPrintReportData } from "@/lib/reports/print-data";
import { dataNoBrasil, intervaloDoMes } from "@/lib/date-br";
import { FiltroDePeriodo } from "./filtro-de-periodo";
import { PainelPublico } from "./painel";

/* =====================================================================
   O painel que o cliente abre sem senha
   ---------------------------------------------------------------------
   Um endereço por conta, com filtro de período, os mesmos números do
   relatório e o detalhe de cada campanha.

   POR QUE ELE EXISTE. O cliente recebe PDF uma vez por mês e não tem
   como olhar no meio do caminho — quem quer ver hoje pede para alguém
   da agência gerar. A agência vira intermediária de uma pergunta que o
   próprio dado responde.

   ⚠️ OS NÚMEROS SÃO OS MESMOS DO PDF, e isso não é coincidência: a
   página chama `getPrintReportData`, a MESMA função da folha A4 e do
   documento enviado. Uma segunda fonte aqui produziria a pior classe de
   defeito possível — o cliente abriria o link, veria um número, abriria
   o PDF e veria outro, e nenhum dos dois teria como provar qual está
   certo.

   O FILTRO VIVE NA URL, e não em estado de componente. Três razões, e
   as três importam para quem usa: o cliente pode salvar nos favoritos
   um período específico, pode mandar o endereço para o sócio vendo
   exatamente a mesma coisa, e o botão voltar do navegador funciona. Com
   estado local, nenhuma das três.
   ===================================================================== */

/* Sem cache: o cliente abre para ver como está AGORA, e um painel de
   ontem servido como se fosse de hoje é pior do que carregar um segundo
   a mais. */
export const dynamic = "force-dynamic";

/**
 * A página fala com a Graph API antes de renderizar — a galeria de
 * anúncios é apurada na janela pedida. Ver `creative-insights.ts`.
 */
export const maxDuration = 60;

/**
 * ⚠️ FORA DO GOOGLE. A página é pública no sentido de "não pede senha",
 * não no de "qualquer um deveria achar". Sem isto, o investimento e o
 * faturamento de um cliente entrariam no índice de busca — e o link
 * deixaria de ser uma credencial para virar um resultado de pesquisa.
 */
export const metadata: Metadata = {
  title: "Painel de performance",
  robots: { index: false, follow: false, nocache: true },
};

export default async function PainelDoCliente({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const { token } = await params;
  const client = await clienteDoToken(token);

  /* 404 para inexistente, revogado e malformado, sem distinguir. Dizer
     "este link foi revogado" confirmaria que ele existiu. */
  if (!client) notFound();

  const { de, ate } = await searchParams;
  const janela = janelaPedida(de, ate);

  const dados = await getPrintReportData(
    client.id,
    janela.start,
    janela.end,
  );

  if (!dados) notFound();

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">Painel de performance</p>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
              {client.name}
            </h1>
          </div>

          <FiltroDePeriodo inicio={janela.start} fim={janela.end} />
        </header>

        <PainelPublico dados={dados} />

        {/* Quem fez, e nada além disso. O rodapé não leva link para o
            painel da agência: quem abre esta página não tem conta, e
            oferecer uma porta que não abre é convite a chamado. */}
        <footer className="mt-12 border-t border-hairline pt-5 text-2xs text-muted-foreground">
          Relatório de mídia paga · Agência Send. Os números vêm direto
          das plataformas de anúncio e são os mesmos do relatório em PDF.
        </footer>
      </div>
    </main>
  );
}

/**
 * A janela pedida na URL, ou o mês corrente.
 *
 * ⚠️ VALIDA O FORMATO E A ORDEM, porque o valor vem da barra de
 * endereços e qualquer pessoa pode digitar o que quiser ali. Data
 * inválida não é erro de tela: `gte`/`lte` com string livre no
 * PostgREST devolveria 400, e a página inteira cairia em 404 por causa
 * de um caractere trocado.
 *
 * O TETO É HOJE, pelo mesmo motivo da estação de comando: um período
 * que termina no futuro rotula o painel com dias que não aconteceram.
 */
function janelaPedida(
  de: string | undefined,
  ate: string | undefined,
): { start: string; end: string } {
  /* `dataNoBrasil` e não `new Date()`: o servidor roda em UTC, e por
     três horas todo dia ele acha que já é amanhã. O painel diria "1 de
     setembro" às 21h do dia 31. */
  const hoje = dataNoBrasil();
  const mes = intervaloDoMes(hoje.slice(0, 7));

  const valida = (v: string | undefined) =>
    v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
      ? v
      : null;

  const inicio = valida(de) ?? mes.start;
  const fimBruto = valida(ate) ?? (mes.end > hoje ? hoje : mes.end);
  const fim = fimBruto > hoje ? hoje : fimBruto;

  // Invertido é erro de digitação, não pedido: devolve o mês.
  if (fim < inicio) return { start: mes.start, end: hoje };

  return { start: inicio, end: fim };
}

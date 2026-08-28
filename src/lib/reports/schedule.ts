import "server-only";
import { MARCA_INTERROMPIDO } from "./envio-interrompido";

import { intervaloDoMes } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateAndDeliverReport } from "./orchestrator";
import { systemSource } from "./source";
import type { Client } from "@/types/database";

/* =====================================================================
   Preparo dos relatórios do dia
   ---------------------------------------------------------------------
   O cron NÃO ENVIA. Ele gera o PDF e para em `ready`; quem dispara é
   uma pessoa, clicando, pelo próprio WhatsApp.

   A troca foi deliberada e tem duas consequências boas: alguém OLHA o
   relatório antes de ele chegar ao cliente, e o clique é instantâneo
   porque o PDF já existe — gerar na hora custaria ~6s de espera com a
   tela travada.

   Roda uma vez por dia e atende quem tem `report_day` igual ao dia de
   hoje. Três decisões que definem o comportamento:

   1. A DATA É A DO BRASIL, não a do servidor. O cron da Vercel roda em
      UTC; perto da virada do dia, "hoje" em UTC e "hoje" em São Paulo
      são datas diferentes, e um cliente agendado para o dia 1 receberia
      no dia 2 — ou não receberia.

   2. O PERÍODO TERMINA ONTEM. O dado de hoje está incompleto: as
      plataformas ainda estão contabilizando. Fechar em ontem é o que
      permite prometer "números fechados" na mensagem que vai ao grupo.

   3. HÁ ORÇAMENTO DE TEMPO. Cada PDF sobe um Chromium; numa carteira
      grande o job seria morto no meio pelo limite da função, deixando
      metade dos clientes sem relatório e SEM registro do porquê. Com
      orçamento, quem não coube volta no relatório de execução como
      adiado, explicitamente.
   ===================================================================== */

/** Margem antes do teto da função, para sobrar tempo de responder. */
const RESERVA_MS = 8_000;

/** Custo estimado do primeiro relatório, antes de haver medição real. */
const CUSTO_INICIAL_MS = 20_000;

export interface ResultadoCliente {
  slug: string;
  nome: string;
  reportId?: string | null;
  erro?: string;
  motivo?: string;
}

export interface RelatorioDeDisparo {
  executadoEm: string;
  diaDoMes: number;
  periodo: { start: string; end: string };
  agendados: number;
  /** PDF gerado e aguardando alguém clicar em enviar. */
  preparados: ResultadoCliente[];
  falhas: ResultadoCliente[];
  pulados: ResultadoCliente[];
  adiados: ResultadoCliente[];
  /** Backfills disparados nesta rodada — ver `garantirDadosDoPeriodo`. */
  sincronizados: { slug: string; janela: string; linhas: number; erro?: string }[];
}

/**
 * O MÊS CIVIL ANTERIOR, completo — a janela do relatório mensal.
 *
 * ⚠️ NÃO É "30 dias terminando ontem", que era o que valia antes. Com
 * aquela regra, uma conta que envia no dia 1º cobria de 02/08 a 31/08:
 * o mês inteiro MENOS o primeiro dia. Medido em 28/08/2026, o que o
 * dia 1º de agosto sozinho carrega na carteira da Send:
 *
 *     R$ 867,05 de investimento
 *     324 conversões
 *     R$ 6.921,96 de receita
 *
 * Some tudo isso do relatório, em silêncio, todo mês. E as 23 contas
 * agendadas estão todas no dia 1º — quem mudar para outro dia passa a
 * ter uma janela que atravessa dois meses e não fecha nenhum.
 *
 * O cliente que recebe em setembro espera ler AGOSTO, e compara com o
 * faturamento que ele já fechou no caixa. Qualquer outra janela obriga
 * ele a desconfiar do número — e desconfiar de um número é o mesmo que
 * não ter o número.
 */
function mesAnterior(hojeISO: string) {
  const [ano, mes] = hojeISO.split("-").map(Number);
  const referencia =
    mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, "0")}`;
  return intervaloDoMes(referencia);
}

/**
 * A janela do relatório já foi realmente buscada nas plataformas?
 *
 * O sync de rotina usa `mode: "month"` — do dia 1 do mês CORRENTE até
 * hoje. Só o que começa ANTES disso nunca foi pedido à plataforma, e é
 * exatamente o caso do relatório de mês fechado.
 *
 * SÓ QUANDO PRECISA: janela inteiramente dentro do mês corrente já foi
 * coberta pela rodada de ontem, e o resumo semanal do meio do mês não
 * paga nada por isto.
 */
export function precisaDeBackfill(
  janelaStart: string,
  hojeISO: string,
): boolean {
  return janelaStart < `${hojeISO.slice(0, 7)}-01`;
}

async function garantirDadosDoPeriodo(
  cliente: Client,
  janela: { start: string; end: string },
  hojeISO: string,
  jaFeitos: Set<string>,
): Promise<RelatorioDeDisparo["sincronizados"][number] | null> {
  if (isDemoMode) return null;
  if (!precisaDeBackfill(janela.start, hojeISO)) return null;

  const chave = `${cliente.id}|${janela.start}|${janela.end}`;
  if (jaFeitos.has(chave)) return null;
  jaFeitos.add(chave);

  const registro = {
    slug: cliente.slug,
    janela: `${janela.start}..${janela.end}`,
    linhas: 0,
  };

  try {
    /* Import dinâmico: `sync.ts` carrega os dois provedores de anúncios
       no topo. Estático, ele entraria em toda rota que importa este
       módulo — inclusive a tela de relatórios, que só precisa das datas. */
    const { syncAllClients } = await import("@/lib/ads/sync");

    const relatorio = await syncAllClients({
      clientId: cliente.id,
      range: { since: janela.start, until: janela.end },
    });

    registro.linhas = relatorio.totalRowsUpserted;

    /* Falha parcial NÃO interrompe. Uma conta com duas plataformas em
       que só o Google recusa o token ainda tem os números da Meta, e um
       relatório com um canal vale mais do que nenhum relatório. */
    if (relatorio.failed > 0) {
      return {
        ...registro,
        erro: relatorio.results
          .filter((r) => !r.ok)
          .map(
            (r) =>
              `${r.platform}: ${r.message ?? r.code ?? "erro sem mensagem"}`,
          )
          .join(" | "),
      };
    }

    return registro;
  } catch (error) {
    /* Também não interrompe: o relatório sai com o que já existe no
       banco. Sem dado nenhum ele sai zerado, que é o estado anterior a
       este conserto — nunca pior. */
    return {
      ...registro,
      erro: error instanceof Error ? error.message : "falha desconhecida",
    };
  }
}

/** Data corrente no fuso de São Paulo, como YYYY-MM-DD. */
function hojeNoBrasil(): string {
  // `en-CA` porque produz exatamente YYYY-MM-DD; montar a string a partir
  // das partes seria mais código para o mesmo resultado.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function dispatchScheduledReports(options?: {
  /** Teto de tempo total. Padrão: 60s, o limite do plano Hobby. */
  budgetMs?: number;
  /** Força um dia específico. Só para verificação manual. */
  diaForcado?: number;
}): Promise<RelatorioDeDisparo> {
  const inicio = Date.now();
  const orcamento = options?.budgetMs ?? 60_000;
  const prazoFinal = inicio + orcamento - RESERVA_MS;

  await destravarPresos();

  const hoje = hojeNoBrasil();
  const diaDoMes = options?.diaForcado ?? Number(hoje.slice(8, 10));

  const periodo = mesAnterior(hoje);

  const base: RelatorioDeDisparo = {
    executadoEm: new Date().toISOString(),
    diaDoMes,
    periodo,
    agendados: 0,
    preparados: [],
    falhas: [],
    pulados: [],
    adiados: [],
    sincronizados: [],
  };

  /* Uma janela por conta, no máximo — o backfill é por (cliente, janela)
     e todas as contas do dia compartilham a mesma janela. */
  const backfillsFeitos = new Set<string>();

  const clientes = await clientesDoDia(diaDoMes);
  base.agendados = clientes.length;

  /* Custo do pior relatório JÁ MEDIDO nesta rodada.
     Enquanto é null vale o chute inicial. Não usar `max` contra o chute
     é proposital: um relatório real leva ~6s, e manter o piso de 20s
     faria o job adiar clientes que caberiam com folga — conservador ao
     ponto de virar defeito. */
  let custoObservado: number | null = null;
  const estimativa = () => custoObservado ?? CUSTO_INICIAL_MS;

  for (const cliente of clientes) {
    // Sem destino não há o que tentar: falharia no envio depois de
    // gastar o tempo de gerar o PDF.
    if (!cliente.whatsapp_phone) {
      base.pulados.push({
        slug: cliente.slug,
        nome: cliente.name,
        motivo: "Cliente sem WhatsApp cadastrado — sem destino para o envio.",
      });
      continue;
    }

    if (Date.now() + estimativa() > prazoFinal) {
      base.adiados.push({
        slug: cliente.slug,
        nome: cliente.name,
        motivo: "Sem tempo de execução restante nesta rodada.",
      });
      continue;
    }

    /* O DADO ANTES DO DOCUMENTO. A rodada de sync cobre do dia 1 do mês
       CORRENTE até hoje, e o relatório mensal lê o mês ANTERIOR — duas
       janelas que não se encostam. Sem isto o PDF sai com o que houver
       no banco, que para o mês fechado pode ser nada. */
    const backfill = await garantirDadosDoPeriodo(
      cliente,
      periodo,
      hoje,
      backfillsFeitos,
    );
    if (backfill) base.sincronizados.push(backfill);

    const antes = Date.now();

    const resultado = await generateAndDeliverReport({
      clientSlug: cliente.slug,
      periodStart: periodo.start,
      periodEnd: periodo.end,
      // Gera e ARQUIVA. O envio é manual, por uma pessoa, pelo
      // WhatsApp dela — ver `sendReportFromUser`.
      deliver: "none",
      source: systemSource(),
      automated: true,
    });

    // A medição real substitui a estimativa: da segunda iteração em
    // diante o job já sabe quanto custa um relatório NESTE ambiente —
    // que difere bastante entre a máquina local e o Chromium serverless.
    custoObservado = Math.max(custoObservado ?? 0, Date.now() - antes);

    const registro: ResultadoCliente = {
      slug: cliente.slug,
      nome: cliente.name,
      reportId: resultado.reportId,
    };

    if (resultado.ok) {
      base.preparados.push(registro);
      continue;
    }

    // Violação do índice parcial = já foi enviado neste período. É o
    // caso esperado de reexecução, não uma falha para investigar.
    if (/duplicate key|unique constraint/i.test(resultado.error ?? "")) {
      base.pulados.push({
        ...registro,
        motivo: "Relatório deste período já havia sido preparado.",
      });
      continue;
    }

    base.falhas.push({ ...registro, erro: resultado.error });
  }

  return base;
}

/** Clientes com envio automático ligado para este dia do mês. */
async function clientesDoDia(dia: number): Promise<Client[]> {
  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    return demoClients.filter(
      (c) => c.report_enabled && c.report_day === dia,
    );
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("clients")
    .select("*")
    .eq("report_enabled", true)
    .eq("report_day", dia)
    .eq("status", "active")
    .order("name");

  if (error) throw error;
  return (data ?? []) as Client[];
}

/**
 * Marca como 'failed' os automáticos presos em geração ou em envio.
 *
 * Silencioso de propósito: é higiene de início de rodada, não um evento.
 * O que interessa fica na própria linha — status e `error_message` — e é
 * lá que alguém vai olhar quando perguntarem por um relatório que não
 * chegou.
 *
 * ⚠️ 'sending' ENTRA, e o motivo é o índice. Uma linha automática presa
 * em 'sending' não é destravada por ninguém, e como
 * `report_history_automated_unique` ignora só 'failed' (migration 46),
 * ela continuaria BLOQUEANDO qualquer nova geração daquele período — o
 * cliente nunca mais receberia o relatório daquela janela.
 *
 * A MENSAGEM DIZ A AMBIGUIDADE porque ela é real: cortada entre gravar
 * 'sending' e a resposta da Evolution, a mensagem pode ter saído. Marcar
 * como falha é a escolha que DESTRAVA — e o texto avisa quem for olhar.
 *
 * `updated_at` e não `created_at` para o envio: a linha pode ter sido
 * criada de manhã pelo cron e só ter ido para 'sending' à tarde. Isso só
 * funciona porque a reserva em `enviarRelatorio` carimba `updated_at` —
 * esta tabela não tem trigger.
 */
async function destravarPresos(): Promise<void> {
  if (isDemoMode) return;

  const admin = createSupabaseAdminClient();
  const limite = new Date(Date.now() - 15 * 60_000).toISOString();

  await admin
    .from("report_history")
    .update({
      status: "failed",
      error_message:
        "Interrompido antes de terminar — a função foi cortada no meio da geração.",
      updated_at: new Date().toISOString(),
    })
    .eq("is_automated", true)
    .in("status", ["queued", "generating"])
    .lt("created_at", limite);

  await admin
    .from("report_history")
    .update({
      status: "failed",
      /* O PREFIXO É CONTRATO com `listarPendentes`: é por ele que a fila
         reconhece a linha como PRESA e continua oferecendo "Chegou /
         Não chegou" em vez de um "Enviar" comum. Sem a marca, o cron
         apagaria a ambiguidade que a tela construiu e a linha voltaria
         no dia seguinte como falha qualquer. */
      error_message: `${MARCA_INTERROMPIDO} — PODE ter sido entregue. Confira o grupo do cliente antes de mandar de novo.`,
      updated_at: new Date().toISOString(),
    })
    .eq("is_automated", true)
    .eq("status", "sending")
    .lt("updated_at", limite);
}

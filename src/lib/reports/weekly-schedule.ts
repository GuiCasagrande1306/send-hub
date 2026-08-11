import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { diaDaSemanaNoBrasil, ultimosSeteDiasBR } from "@/lib/date-br";
import { formatPeriodNumeric } from "@/lib/format";
import { systemSource } from "./source";
import { buildWeeklySummary, semVeiculacao } from "./weekly-message";
import type { Client, ReportStatus } from "@/types/database";

/* =====================================================================
   Preparo dos resumos semanais
   ---------------------------------------------------------------------
   Irmão de `schedule.ts` e com a mesma regra de ouro: o cron NÃO ENVIA.
   Ele monta o texto, grava em `report_history` com status `ready` e
   para. Quem dispara é uma pessoa, pelo próprio WhatsApp.

   Aqui isso não é escolha de produto — é a única possibilidade. O
   orquestrador recusa envio sem usuário ("é o WhatsApp dele que
   despacha") e a instância da agência nunca foi pareada. Não existe
   número de onde um envio automático sairia.

   POR QUE UM ARQUIVO SEPARADO. O `schedule.ts` é sobre PDF: orçamento
   de tempo, Chromium, custo medido por relatório, adiamento de quem não
   coube. Nada disso existe aqui — montar texto custa uma consulta e
   nenhum navegador. Enfiar as duas cadências na mesma função obrigaria
   cada bloco a perguntar de qual tipo ele é.

   A TRAVA DE DUPLICIDADE VEM DE GRAÇA. O índice
   `report_history_automated_unique (client_id, period_start,
   period_end) where is_automated` já existe desde a migration 08. Se o
   cron rodar duas vezes no mesmo dia, a segunda inserção viola o índice
   e o cliente é contado como já preparado — em vez de receber dois
   resumos do mesmo período.
   ===================================================================== */

export interface ResumoSemanal {
  slug: string;
  nome: string;
  reportId?: string | null;
  motivo?: string;
}

export interface RelatorioSemanalDeDisparo {
  executadoEm: string;
  /** 1=segunda … 7=domingo, a convenção da coluna. */
  diaDaSemana: number;
  periodo: { start: string; end: string };
  agendados: number;
  preparados: ResumoSemanal[];
  pulados: ResumoSemanal[];
  falhas: ResumoSemanal[];
}

/**
 * Dia da semana de hoje na convenção da coluna `weekly_report_day`.
 *
 * `diaDaSemanaNoBrasil()` devolve 0..6 com domingo=0; a coluna é ISO,
 * 1..7 com domingo=7, para não divergir de `optimization_day`. A
 * conversão mora AQUI, num lugar só — espalhá-la por cada leitura é
 * como se instala um erro de um dia.
 */
function diaIsoNoBrasil(): number {
  const dia = diaDaSemanaNoBrasil();
  return dia === 0 ? 7 : dia;
}

async function clientesDoDiaDaSemana(diaIso: number): Promise<Client[]> {
  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    return demoClients.filter(
      (c) =>
        c.status === "active" &&
        c.weekly_report_enabled &&
        c.weekly_report_day === diaIso,
    );
  }

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("clients")
    .select("*")
    .eq("status", "active")
    .eq("weekly_report_enabled", true)
    .eq("weekly_report_day", diaIso)
    .order("name");

  return (data ?? []) as Client[];
}

export async function dispatchWeeklySummaries(options?: {
  /** Força um dia da semana. Só para verificação manual. */
  diaForcado?: number;
}): Promise<RelatorioSemanalDeDisparo> {
  const diaDaSemana = options?.diaForcado ?? diaIsoNoBrasil();
  const janela = ultimosSeteDiasBR();
  const periodo = { start: janela.inicio, end: janela.fim };

  const base: RelatorioSemanalDeDisparo = {
    executadoEm: new Date().toISOString(),
    diaDaSemana,
    periodo,
    agendados: 0,
    preparados: [],
    pulados: [],
    falhas: [],
  };

  const clientes = await clientesDoDiaDaSemana(diaDaSemana);
  base.agendados = clientes.length;

  const source = systemSource();

  for (const cliente of clientes) {
    const identidade = { slug: cliente.slug, nome: cliente.name };

    /* Sem destino não há o que preparar: a linha ficaria em `ready`
       para sempre, e a fila mostraria um envio que ninguém consegue
       completar. */
    if (!cliente.whatsapp_phone) {
      base.pulados.push({
        ...identidade,
        motivo: "Cliente sem WhatsApp cadastrado — sem destino para o envio.",
      });
      continue;
    }

    try {
      const { currentTotals } = await source.metrics(
        cliente.id,
        periodo.start,
        periodo.end,
      );

      /* Semana sem veiculação não vira mensagem. "Tudo zero" chega ao
         cliente como queda de resultado, quando na verdade a campanha
         estava pausada — e a conversa que isso gera custa mais do que o
         resumo economiza. Quem precisa saber é a equipe, e ela vê aqui. */
      if (semVeiculacao(currentTotals)) {
        base.pulados.push({
          ...identidade,
          motivo: "Sem veiculação no período — nada investido, nada exibido.",
        });
        continue;
      }

      const texto = buildWeeklySummary({
        clientName: cliente.name,
        segment: cliente.segment,
        periodStart: periodo.start,
        periodEnd: periodo.end,
        totals: currentTotals,
        /* Alcance é deduplicado pela plataforma e não se soma entre
           dias — ver a nota em `types/database.ts`. Enquanto não houver
           consulta ao endpoint da Meta para a janela fechada, a linha
           simplesmente não sai. Inventar é o que já foi feito uma vez
           aqui, com `impressões × 0,62`. */
        reach: null,
      });

      if (isDemoMode) {
        base.preparados.push({ ...identidade, reportId: null });
        continue;
      }

      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("report_history")
        .insert({
          is_automated: true,
          kind: "weekly",
          client_id: cliente.id,
          template_id: null,
          title: `Resumo semanal · ${formatPeriodNumeric(periodo.start, periodo.end)}`,
          period_start: periodo.start,
          period_end: periodo.end,
          status: "ready" satisfies ReportStatus,
          /* Canal e destinatário só na hora do envio: gravá-los agora
             faria a fila parecer entregue antes de alguém clicar. */
          channel: null,
          recipient: null,
          generated_by: null,
          snapshot: { kind: "weekly", texto, totals: currentTotals },
        })
        .select("id")
        .single();

      if (error) {
        /* 23505 é o índice de idempotência: já existe resumo automático
           deste cliente para este período. Segunda passagem do dia, não
           falha. */
        if (error.code === "23505") {
          base.pulados.push({
            ...identidade,
            motivo: "Resumo deste período já estava preparado.",
          });
          continue;
        }
        throw new Error(error.message);
      }

      base.preparados.push({ ...identidade, reportId: data?.id ?? null });
    } catch (erro) {
      base.falhas.push({
        ...identidade,
        motivo: erro instanceof Error ? erro.message : "falha desconhecida",
      });
    }
  }

  return base;
}

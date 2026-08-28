import "server-only";

import { dataNoBrasil } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/format";
import { sendTextFromUser } from "@/lib/whatsapp/session";
import {
  DIAS_DE_ALERTA,
  getBalanceAlertsAsSystem,
  type BalanceAlert,
} from "./balances";

/* =====================================================================
   O aviso diário de saldo
   ---------------------------------------------------------------------
   O QUE ELE CONSERTA. A conta de dias já existia e já estava certa; o
   aviso é que não existia. Quem quisesse saber que uma conta zera
   amanhã precisava abrir a página e olhar — o que só acontece depois de
   alguém desconfiar, que é tarde.

   O QUE ENTRA NA MENSAGEM: só o que está `critical`, isto é, menos de
   três dias de saldo no ritmo atual. Atenção (até sete dias) fica de
   fora de propósito: mandar todo dia uma lista de contas que estão bem
   é o caminho conhecido para a equipe parar de ler o aviso, e aí o
   crítico chega junto e passa batido.

   O QUE NÃO ENTRA:
     `unknown`    — saldo não lido é pendência de cadastro, não risco de
                    queda. Uma lista dizendo "não sei" todo dia é o
                    ruído que faz o aviso ser silenciado.
     `unlimited`  — faturamento sem teto não tem crédito a esgotar.
     pós-paga     — mesma razão.
     não conectada — não há número, e não há o que fazer a respeito
                    nesta mensagem.

   ⚠️ O NÚMERO DA META É UM PISO. A tela já diz isso, e a mensagem
   precisa dizer também: o saldo vem de `spend_cap − amount_spent` e
   ficou entre 12% e 14% ABAIXO do real nas contas conferidas contra o
   Gerenciador. O erro é sempre para menos, então o aviso ANTECIPA — o
   que é o lado certo de errar para um alerta de recarga, e o lado
   errado para alguém que leia o valor como exato e vá pagar por ele.
   ===================================================================== */

export interface ResultadoDoAviso {
  enviado: boolean;
  motivo?: string;
  destino?: string;
  criticas?: number;
}

export async function enviarAvisoDeSaldo(): Promise<ResultadoDoAviso> {
  if (isDemoMode) return { enviado: false, motivo: "modo demonstração" };

  const admin = createSupabaseAdminClient();
  const hoje = dataNoBrasil();

  const { data: config } = await admin
    .from("balance_alert_settings")
    .select("group_jid, group_name, sender_id, last_sent_on")
    .eq("id", true)
    .maybeSingle();

  if (!config?.group_jid || !config.sender_id) {
    return { enviado: false, motivo: "nenhum grupo escolhido para o aviso" };
  }

  /* TRAVA DE REPETIÇÃO antes de qualquer trabalho: reexecutar o cron no
     mesmo dia não pode mandar o aviso de novo. Aviso repetido é a forma
     mais rápida de ensinar a equipe a ignorá-lo. */
  if (config.last_sent_on === hoje) {
    return { enviado: false, motivo: "aviso de hoje já foi enviado" };
  }

  const criticas = await contasCriticas();

  if (criticas.length === 0) {
    /* NADA A DIZER É NOTÍCIA BOA, e não se manda notícia boa todo dia.
       Também não marca `last_sent_on`: se uma conta virar crítica às
       15h, o aviso de amanhã de manhã ainda é o primeiro do assunto. */
    return { enviado: false, motivo: "nenhuma conta crítica" };
  }

  const envio = await sendTextFromUser(
    config.sender_id,
    config.group_jid,
    montarMensagem(criticas),
  );

  if (!envio.success) {
    return { enviado: false, motivo: envio.error ?? "falha no envio" };
  }

  await admin
    .from("balance_alert_settings")
    .update({ last_sent_on: hoje, updated_at: new Date().toISOString() })
    .eq("id", true);

  return {
    enviado: true,
    destino: config.group_name ?? config.group_jid,
    criticas: criticas.length,
  };
}

/**
 * A mensagem.
 *
 * Sem emoji e sem enfeite: vai para um grupo de trabalho e concorre com
 * conversa. O que precisa saltar é o nome da conta e quantos dias
 * restam — nessa ordem, porque a primeira pergunta de quem lê é "qual
 * conta é a minha".
 *
 * A ORDEM É A URGÊNCIA, não o alfabeto: quem acaba hoje vem antes de
 * quem acaba em dois dias. Numa lista longa lida no celular, o fim da
 * lista é onde a atenção já acabou.
 */
function montarMensagem(criticas: BalanceAlert[]): string {
  const ordenadas = [...criticas].sort(
    (a, b) =>
      (a.daysLeft ?? 99) - (b.daysLeft ?? 99) ||
      a.clientName.localeCompare(b.clientName, "pt-BR"),
  );

  const linhas: string[] = [
    "*Saldo de mídia — atenção hoje*",
    "",
    ordenadas.length === 1
      ? "*1 conta prestes a zerar:*"
      : `*${ordenadas.length} contas prestes a zerar:*`,
  ];

  for (const a of ordenadas) {
    const quando =
      a.daysLeft === null
        ? "sem gasto recente"
        : a.daysLeft === 0
          ? "acaba hoje"
          : a.daysLeft === 1
            ? "1 dia"
            : `${a.daysLeft} dias`;

    /* O "≥" viaja para a mensagem pelo mesmo motivo que está na tela: o
       saldo da Meta é um piso, não o valor exato. Esconder o sinal aqui
       faria o grupo receber uma precisão que a medição não sustenta —
       e alguém recarregaria a diferença errada. */
    const valor =
      a.currentBalance === null
        ? "saldo não informado"
        : `${a.balanceSource === "meta_api" ? "≥ " : ""}${formatCurrency(a.currentBalance)}`;

    linhas.push(
      `• ${a.clientName} (${a.platform === "meta_ads" ? "Meta" : "Google"}) — ${valor}, ${quando}`,
    );
  }

  linhas.push(
    "",
    `Menos de ${DIAS_DE_ALERTA} dias no ritmo dos últimos dias. O valor da Meta é um mínimo — o saldo real é esse ou mais.`,
    "Conferir em Alertas de saldo.",
  );

  return linhas.join("\n");
}

/**
 * As contas que entram no aviso.
 *
 * `connected` e `prepaid` na peneira, e não só o status: conta não
 * conectada nasce `unknown`, e conta pós-paga pode nascer `critical`
 * por um ritmo alto sobre saldo nulo — e ali não há saldo a acabar. Ver
 * a tabela de estados em `alertas-saldo/page.tsx`.
 */
async function contasCriticas(): Promise<BalanceAlert[]> {
  const alertas = await getBalanceAlertsAsSystem();
  return alertas.filter(
    (a) =>
      a.connected &&
      a.billingType === "prepaid" &&
      a.status === "critical" &&
      a.currentBalance !== null,
  );
}

/**
 * O texto que sairia agora, sem enviar nada.
 *
 * `null` quando não há conta crítica — a tela diz isso com uma frase em
 * vez de mostrar uma mensagem vazia. É a MESMA função que o envio usa,
 * pelo mesmo motivo de sempre: duas implementações divergem, e a que
 * diverge é a que ninguém confere.
 */
export async function montarPreviaDoAviso(): Promise<string | null> {
  const criticas = await contasCriticas();
  return criticas.length === 0 ? null : montarMensagem(criticas);
}

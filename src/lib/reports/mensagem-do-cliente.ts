/* =====================================================================
   A mensagem que acompanha o relatório
   ---------------------------------------------------------------------
   UM TEXTO SÓ, E ELE É ESTE. Havia dois: o que a estação de comando
   mostrava em "Texto para o cliente" e o que o WhatsApp de fato
   despachava junto do PDF. Quem operava conferia uma coisa e enviava
   outra, sem meio de perceber.

   EDITÁVEL. O texto vem de `report_message_settings` (migration 44) e o
   padrão abaixo é só o de fábrica — o que a linha do banco tem na
   primeira instalação e o que o botão "Restaurar padrão" reescreve.
   Mudar a voz da agência não exige mais deploy.

   SEM NÚMERO NENHUM, e é por isso que a substituição conhece só dois
   marcadores.

   A legenda dizia "Investimos X e geramos Y resultados a um custo de Z
   cada". Parecia inofensivo — são os mesmos números do PDF — até que o
   custo passou a sair da CAMPANHA DE ORIGEM (migration 42) e o
   investimento continuou saindo da conta inteira. Os três números
   pararam de fechar entre si.

   MEDIDO NA CARTEIRA DA SEND em 28/08/2026, nas 20 contas ativas com
   investimento e resultado. SETE mandam uma legenda que não fecha na
   calculadora:

       presença local A  diz R$22,60   na mão dá R$48,83
       captação A        diz R$18,71   na mão dá R$24,16
       delivery A        diz R$10,46   na mão dá R$14,70
       delivery B        diz R$ 7,04   na mão dá R$ 9,76
       delivery C        diz R$ 5,63   na mão dá R$ 7,87
       captação B        diz R$15,78   na mão dá R$17,30
       delivery D        diz R$ 1,95   na mão dá R$ 2,38

   E o número da legenda é o PRIMEIRO que o cliente lê.

   Dava para reconciliar os três: bastava dividir tudo pelo mesmo
   denominador. Mas aí a legenda deixaria de fechar de outro jeito —
   imprimiria o custo da campanha de origem sob um investimento que não
   o produziu, e quem refizesse a conta acharia o valor antigo. O PDF
   explica isso com o selo "de N campanhas"; um texto de WhatsApp não
   tem onde pôr essa nota de rodapé.

   Então a mensagem parou de ter número. Ela anuncia o anexo e sai da
   frente. Uma legenda sem número não tem como discordar do documento
   que ela acompanha — a classe inteira de defeito deixa de existir, em
   vez de ser consertada de novo a cada métrica nova. É por isso que
   NÃO EXISTE marcador de investimento, custo ou retorno: acrescentar um
   reabre a divergência, e ela vai reaparecer calada.

   ⚠️ ISTO NÃO TOCA O RESUMO SEMANAL. `weekly-message.ts` é outra
   coisa: texto sem anexo, com os números que o cliente pediu para ver,
   e sem PDF ao lado para discordar dele. Ele continua como está, e a
   regra de "sem número" vale só para a legenda que acompanha um
   documento.

   ⚠️ "ÚLTIMOS 7 DIAS" SÓ QUANDO SÃO SETE, e é a substituição que
   garante. É a mesma regra que derrubou o primeiro seletor de período
   da estação: ele trocava a frase sem trocar os números. Fora da janela
   semanal a mensagem diz as datas, que é a coisa mais simples que
   continua sendo verdade — e por isso o período é MARCADOR, não texto
   digitado.

   PURO DE PROPÓSITO: sem `server-only`, sem banco. Roda no navegador
   para a prévia e no servidor no envio, e é a mesma função nos dois —
   quem busca o texto é quem chama.

   SEM EMOJI E SEM `*negrito*` no padrão. O asterisco do WhatsApp não
   aparece na prévia, então o que a equipe confere não é o que o cliente
   lê. Quem editar pode usar; é escolha de quem escreve.
   ===================================================================== */

/** O texto de fábrica. Igual ao `insert` da migration 44. */
export const MENSAGEM_PADRAO = `Olá! Aqui está o nosso relatório de performance {periodo}.

Qualquer dúvida, é só chamar por aqui.`;

/**
 * Os marcadores que a substituição conhece.
 *
 * Exportado porque a tela de edição os lista para quem escreve — uma
 * lista aqui e outra na interface divergiriam no primeiro marcador
 * novo, e o sintoma seria um `{marcador}` cru chegando ao cliente.
 */
export const MARCADORES = [
  {
    chave: "{periodo}",
    descricao: 'Vira "dos últimos 7 dias" ou "de 20 – 21 de agosto de 2026"',
  },
  { chave: "{cliente}", descricao: "O nome da conta" },
] as const;

export interface ResumoParaCliente {
  /** "18 – 24 de agosto de 2026", já formatado por `formatPeriod`. */
  periodoLabel: string;
  /**
   * Quantos dias a janela cobre.
   *
   * Só decide entre "dos últimos 7 dias" e a data por extenso. Não
   * entra em conta nenhuma — nenhum número desta mensagem entra.
   */
  dias: number;
  /** O nome da conta, para `{cliente}`. */
  cliente: string;
}

/** A janela semanal, a única que ganha nome próprio na frase. */
const SEMANA = 7;

/** Como `{periodo}` é lido em voz alta. */
export function janelaEmPalavras(r: {
  periodoLabel: string;
  dias: number;
}): string {
  return r.dias === SEMANA
    ? "dos últimos 7 dias"
    : /* "de 1 – 26 de agosto de 2026". A preposição fica aqui e não no
         rótulo porque `formatPeriod` também é usado em cabeçalho de
         tabela, onde "de" sobrando ficaria estranho. */
      `de ${r.periodoLabel}`;
}

/**
 * O texto final, com os marcadores resolvidos.
 *
 * `template` opcional para que a prévia e os testes não precisem ir ao
 * banco. Em produção quem chama passa o que está gravado — ver
 * `getMensagemDoCliente`.
 *
 * Substituição GLOBAL: o mesmo marcador pode aparecer duas vezes num
 * texto escrito à mão, e resolver só a primeira deixaria um `{cliente}`
 * cru na mensagem que vai ao cliente.
 */
export function mensagemDoCliente(
  r: ResumoParaCliente,
  template: string = MENSAGEM_PADRAO,
): string {
  return template
    .replaceAll("{periodo}", janelaEmPalavras(r))
    .replaceAll("{cliente}", r.cliente)
    .trim();
}

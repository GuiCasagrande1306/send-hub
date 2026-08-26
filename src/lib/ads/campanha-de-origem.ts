import { objetivoDoCriativo } from "./creative-goal";
import { VISITA_AO_PERFIL } from "./conversion-action";

/* =====================================================================
   Campanha de origem: de onde o resultado veio
   ---------------------------------------------------------------------
   O custo por resultado e o ROAS eram divididos pelo gasto da CONTA
   INTEIRA — inclusive o que foi para alcance, tráfego e atendimento, que
   não são custo de resultado nenhum. Somá-los faz uma conta saudável
   parecer cara na frente do cliente.

   MEDIDO NA CARTEIRA DA SEND em 26/08/2026, sobre agosto inteiro
   (1.114 linhas de `daily_metrics`, todas por campanha, nenhuma
   agregada). Seis contas passam a isolar:

     delivery A        R$14,91  ->  R$10,49
     captação A        R$23,98  ->  R$19,17
     delivery B        R$ 9,86  ->  R$ 7,19
     delivery C        R$ 7,79  ->  R$ 5,57
     delivery D        R$ 2,39  ->  R$ 1,95
     captação B        R$17,75  ->  R$16,02

   As contas aparecem por SEGMENTO E LETRA, não por nome: o
   repositório não é lugar de carteira de cliente. A letra é estável
   entre os arquivos — "delivery A" aqui é a mesma conta de "delivery A"
   em `kpi.ts`.

   O QUE ESTE ARQUIVO DECIDE é só uma coisa: quais linhas de
   `daily_metrics` entram na conta de custo e de ROAS. O VOLUME não passa
   por aqui — quantas conversões e quanta receita continuam sendo da
   conta inteira, porque o resultado que veio da campanha de alcance é
   resultado de verdade e sumir com ele seria mentir para menos.

   A REGRA: a campanha entra quando a FAMÍLIA dela bate com a família da
   conversão que esta conta mede. Família sai de `objetivoDoCriativo`,
   que já classifica objetivo e meta de otimização em "Vendas",
   "Cadastros", "Mensagens", "Tráfego", "Alcance"…

   Portado do painel da Elo Marketing, onde a regra nasceu; as medições
   acima e abaixo foram refeitas contra a carteira da Send.
   ===================================================================== */

/**
 * A família de campanha que produz cada tipo de conversão.
 *
 * Os rótulos são os que `objetivoDoCriativo` devolve — mudar um lá sem
 * mudar aqui faz o isolamento parar de casar, em silêncio. O teste em
 * `scripts/teste-campanha-de-origem.mts` trava esse par.
 *
 * VISITA AO PERFIL FICA DE FORA de propósito, com `null`. Ela é medida
 * pelo campo `instagram_profile_visits`, que TODA campanha alimenta —
 * inclusive a de alcance, que é justamente a que mais traz visita. A
 * decisão é anterior a este arquivo e está escrita em
 * `conversion-action.ts`; isolar aqui a contradiria. São as 6 contas de
 * presença local entre as 21 com métrica na Send, e nenhuma delas muda
 * de número por causa disto.
 */
const FAMILIA_DA_CONVERSAO: Record<string, string | null> = {
  "offsite_conversion.fb_pixel_purchase": "Vendas",
  "offsite_conversion.fb_pixel_initiate_checkout": "Vendas",
  "offsite_conversion.fb_pixel_add_to_cart": "Vendas",
  "offsite_conversion.fb_pixel_lead": "Cadastros",
  "onsite_conversion.lead_grouped": "Cadastros",
  "offsite_conversion.fb_pixel_complete_registration": "Cadastros",
  "onsite_conversion.messaging_conversation_started_7d": "Mensagens",
  landing_page_view: "Tráfego",
  [VISITA_AO_PERFIL]: null,
};

/** As famílias que contam como origem, para os tipos que esta conta mede. */
export function familiasDeOrigem(tiposDeConversao: string[]): Set<string> {
  const familias = new Set<string>();
  for (const tipo of tiposDeConversao) {
    const f = FAMILIA_DA_CONVERSAO[tipo];
    if (f) familias.add(f);
  }
  return familias;
}

/** O mínimo que a regra precisa saber de uma linha. */
export interface LinhaDeCampanha {
  objective: string | null;
  optimization_goal: string | null;
  conversions: number;
}

/**
 * Esta linha é de uma campanha de origem?
 *
 * NULO É "NÃO SEI", NÃO "NENHUM", e é o caso que mais importa acertar:
 * cai aqui o Google Ads (que não tem `objective` equivalente), a linha
 * gravada antes da migration 42 e a campanha que a Meta devolve sem o
 * campo. Nesses casos o critério vira o único disponível — a campanha
 * PRODUZIU o resultado? —, que erra para o lado seguro: no pior caso o
 * custo volta a ser o de hoje, nunca some.
 *
 * NA SEND, HOJE, ESTE É O ÚNICO RAMO QUE RODA: as 1.114 linhas já
 * gravadas são todas anteriores à migration, então `objective` é nulo em
 * todas. As seis contas que passam a isolar isolam por terem produzido o
 * resultado, não por família. A partir da próxima sincronização o campo
 * chega preenchido e a família assume.
 */
export function ehDeOrigem(
  linha: LinhaDeCampanha,
  familias: Set<string>,
): boolean {
  /* Sem família alvo (visita ao perfil) não há o que isolar. */
  if (familias.size === 0) return true;

  if (linha.objective === null && linha.optimization_goal === null) {
    return Number(linha.conversions) > 0;
  }

  const familia = objetivoDoCriativo(linha.optimization_goal, linha.objective);
  return familia !== null && familias.has(familia);
}

export interface TotaisDeOrigem {
  spendCents: number;
  conversions: number;
  revenueCents: number;
  /** Quantas campanhas distintas entraram. Alimenta o selo "N campanhas". */
  campanhas: number;
  /**
   * `false` quando a regra foi desligada e o total voltou a ser a conta
   * inteira. A tela não desenha selo nesse caso — dizer "1 campanha"
   * quando são todas é pior do que não dizer nada.
   */
  isolado: boolean;
}

/**
 * Soma só as campanhas de origem, com a rede de segurança.
 *
 * Origem sem gasto OU sem resultado desliga o isolamento e devolve a
 * conta inteira: é o número de hoje — pior que o isolado, melhor que um
 * traço no relatório do cliente.
 */
export function totaisDeOrigem<
  T extends LinhaDeCampanha & {
    campaign_id: string;
    spend_cents: number;
    revenue_cents: number;
  },
>(linhas: T[], tiposDeConversao: string[]): TotaisDeOrigem {
  const familias = familiasDeOrigem(tiposDeConversao);

  const tudo = somar(linhas);

  if (familias.size === 0) {
    return { ...tudo, isolado: false };
  }

  /* A DECISÃO É POR CAMPANHA, NÃO POR LINHA, e a diferença só aparece no
     ramo de objetivo nulo — que é onde o critério vira "produziu o
     resultado?", e que na Send é o ramo de todo o histórico.
     `daily_metrics` tem uma linha por DIA: decidindo linha a linha, a
     campanha sem objetivo entrava na conta nos dias em que converteu e
     saía nos dias em que só gastou. O gasto dela vinha recortado pelos
     dias bons, e o custo por resultado saía barato demais — errando
     exatamente para o lado que ninguém desconfia. */
  const porCampanha = new Map<string, T[]>();
  for (const l of linhas) {
    const lista = porCampanha.get(l.campaign_id);
    if (lista) lista.push(l);
    else porCampanha.set(l.campaign_id, [l]);
  }

  const daOrigem: T[] = [];
  for (const doCampaign of porCampanha.values()) {
    const agregada: LinhaDeCampanha = {
      /* O objetivo é atributo da campanha e se repete em toda linha; o
         primeiro que não for nulo vale pelo conjunto. Linha antiga sem
         backfill convive com linha nova no mesmo período. */
      objective: doCampaign.find((l) => l.objective !== null)?.objective ?? null,
      optimization_goal:
        doCampaign.find((l) => l.optimization_goal !== null)?.optimization_goal ??
        null,
      conversions: doCampaign.reduce((s, l) => s + Number(l.conversions), 0),
    };

    if (ehDeOrigem(agregada, familias)) daOrigem.push(...doCampaign);
  }

  const origem = somar(daOrigem);

  /* A REDE DE SEGURANÇA. Origem vazia significa que a conta mede uma
     conversão que nenhuma campanha dela existe para produzir — acontece
     quando o resultado chega por tabela, tipo lead que vem de campanha
     de engajamento. Sem isto, essas contas mostrariam custo "—" e ROAS
     infinito no relatório do cliente.

     MEDIDO NA SEND em 26/08/2026: nenhuma das 21 contas com métrica cai
     aqui. A rede não é código morto — ela é o que garante que o pior
     caso seja o número de hoje —, mas é honesto dizer que hoje ela não
     está segurando ninguém. */
  if (origem.spendCents === 0 || origem.conversions === 0) {
    return { ...tudo, isolado: false };
  }

  /* Só é "isolado" se sobrou algo de fora. Uma conta em que TODA
     campanha produz o resultado está certa dos dois jeitos, e anunciar
     isolamento ali sugere um recorte que não houve. São 9 das 21 na
     Send, entre delivery e captação. */
  return { ...origem, isolado: origem.spendCents < tudo.spendCents };
}

function somar<
  T extends {
    campaign_id: string;
    spend_cents: number;
    revenue_cents: number;
    conversions: number;
  },
>(linhas: T[]): Omit<TotaisDeOrigem, "isolado"> {
  const campanhas = new Set<string>();
  let spendCents = 0;
  let conversions = 0;
  let revenueCents = 0;

  for (const l of linhas) {
    campanhas.add(l.campaign_id);
    spendCents += l.spend_cents;
    conversions += Number(l.conversions);
    revenueCents += l.revenue_cents;
  }

  return { spendCents, conversions, revenueCents, campanhas: campanhas.size };
}

/* =====================================================================
   Teste de mesa da campanha de origem
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-campanha-de-origem.mts

   Trava a regra que decide de qual gasto sai o custo por resultado e o
   ROAS do relatório do cliente. Errar aqui não quebra nada — publica um
   número plausível e falso, que é o pior modo de falhar deste sistema.

   OS CASOS SÃO MEDIDOS, não hipóteses. Os dois primeiros vêm da carteira
   da Send em 26/08/2026, com os valores exatos do banco; os da rede de
   segurança vêm da carteira da Elo Marketing, onde este módulo nasceu —
   nenhuma conta da Send cai nesse ramo hoje, e um teste que só exercita
   o que já acontece não protege de nada.

   O par (família da conversão × família da campanha) só casa enquanto
   `creative-goal.ts` e `campanha-de-origem.ts` concordarem nos rótulos.
   É esse acordo que este arquivo existe para travar.
   ===================================================================== */

import {
  ehDeOrigem,
  familiasDeOrigem,
  totaisDeOrigem,
} from "../src/lib/ads/campanha-de-origem";
import { VISITA_AO_PERFIL } from "../src/lib/ads/conversion-action";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bate) falhas++;
  console.log(`${bate ? "ok  " : "FALHA"} ${nome}`);
  if (!bate) {
    console.log(`        esperado ${JSON.stringify(esperado)}`);
    console.log(`        veio     ${JSON.stringify(real)}`);
  }
};

const COMPRA = "offsite_conversion.fb_pixel_purchase";
const CONVERSA = "onsite_conversion.messaging_conversation_started_7d";
const CADASTRO = "offsite_conversion.fb_pixel_lead";

/* --- as famílias que cada conversão procura ------------------------- */
ok("compra procura Vendas", [...familiasDeOrigem([COMPRA])], ["Vendas"]);
ok("conversa procura Mensagens", [...familiasDeOrigem([CONVERSA])], ["Mensagens"]);
ok(
  "visita ao perfil não procura nada — toda campanha traz visita",
  [...familiasDeOrigem([VISITA_AO_PERFIL])],
  [],
);

/* --- a classificação de cada campanha ------------------------------- */
const vendas = familiasDeOrigem([COMPRA]);
const linha = (objective: string | null, goal: string | null, conv = 0) => ({
  objective,
  optimization_goal: goal,
  conversions: conv,
});

ok("campanha de venda entra", ehDeOrigem(linha("OUTCOME_SALES", "OFFSITE_CONVERSIONS"), vendas), true);
ok("reconhecimento fica de fora, mesmo tendo vendido", ehDeOrigem(linha("OUTCOME_AWARENESS", "REACH", 2), vendas), false);
ok("tráfego fica de fora", ehDeOrigem(linha("LINK_CLICKS", null), vendas), false);
ok("whatsapp fica de fora", ehDeOrigem(linha("OUTCOME_ENGAGEMENT", "REPLIES"), vendas), false);

/* NULO É "NÃO SEI", e o critério vira "produziu?". Cobre o Google Ads e
   a linha gravada antes da migration 42 — que na Send é TODA linha
   existente hoje, as 1.114 de agosto. */
ok("sem objetivo e sem resultado: fora", ehDeOrigem(linha(null, null, 0), vendas), false);
ok("sem objetivo mas produziu: entra", ehDeOrigem(linha(null, null, 3), vendas), true);

const c = (
  id: string,
  gasto: number,
  conv: number,
  receita: number,
  objective: string | null,
  goal: string | null,
) => ({
  campaign_id: id,
  spend_cents: gasto,
  conversions: conv,
  revenue_cents: receita,
  objective,
  optimization_goal: goal,
});

/* --- delivery A, agosto/2026 ---------------------------------
   Valores exatos do banco da Send. As duas campanhas estão sem objetivo
   — são anteriores à migration 42 —, então quem decide é "produziu?". */
const cazza = [
  c("120250416205300631", 22022, 21, 341300, null, null), // 02 | VENDAS DELIVERY
  c("120250480032120631", 9282, 0, 0, null, null), // 01 | TRAFEGO INSTAGRAM
];

const origemCazza = totaisDeOrigem(cazza, [COMPRA]);
ok("delivery A: gasto de origem", origemCazza.spendCents, 22022);
ok("delivery A: campanhas", origemCazza.campanhas, 1);
ok("delivery A: isolou", origemCazza.isolado, true);
ok(
  "delivery A: custo por pedido R$10,49",
  (origemCazza.spendCents / origemCazza.conversions / 100).toFixed(2),
  "10.49",
);
ok(
  "delivery A: ROAS 15,50",
  (origemCazza.revenueCents / origemCazza.spendCents).toFixed(2),
  "15.50",
);

/* O mesmo conjunto, sem isolamento, é o número antigo. */
const tudoCazza = totaisDeOrigem(cazza, [VISITA_AO_PERFIL]);
ok("sem isolamento: gasto é a conta inteira", tudoCazza.spendCents, 31304);
ok("sem isolamento: não marca selo", tudoCazza.isolado, false);
ok(
  "sem isolamento: custo por pedido R$14,91 (o número antigo)",
  (tudoCazza.spendCents / tudoCazza.conversions / 100).toFixed(2),
  "14.91",
);

/* --- captação A, agosto/2026 -------------------------------
   Três campanhas, duas produzem. A de tráfego não converteu nenhuma vez
   e por isso sai — aqui a regra do "produziu?" chega ao mesmo lugar que
   a família chegaria, e é bom que cheguem. */
const otica = [
  c("120253833378150672", 29759, 10, 0, null, null), // RMKT WHATS
  c("120253578399410672", 35422, 24, 0, null, null), // ENGAJ.WHATS
  c("120253551514150672", 16362, 0, 0, null, null), // TRAFEGO INSTA
];
const origemOtica = totaisDeOrigem(otica, [CADASTRO, CONVERSA]);
ok("Ótica: gasto de origem", origemOtica.spendCents, 65181);
ok("Ótica: duas campanhas", origemOtica.campanhas, 2);
ok(
  "Ótica: custo por resultado R$19,17",
  (origemOtica.spendCents / origemOtica.conversions / 100).toFixed(2),
  "19.17",
);
ok(
  "Ótica: sem isolar seriam R$23,98",
  (81543 / 34 / 100).toFixed(2),
  "23.98",
);

/* --- a rede de segurança --------------------------------------------
   MEDIDO NA CARTEIRA DA ELO MARKETING, não na da Send: nenhuma das 21
   contas da Send cai neste ramo hoje. Os dois casos são reais de lá — o
   Istituto Burgo tinha 196 conversas e nenhuma campanha de família
   "Mensagens", porque os leads chegavam por engajamento. Sem a rede, o
   relatório desse cliente mostraria custo "—". */
const burgo = [
  c("a", 80000, 120, 0, "OUTCOME_ENGAGEMENT", "PROFILE_AND_PAGE_ENGAGEMENT"),
  c("b", 66000, 76, 0, "OUTCOME_AWARENESS", "REACH"),
];
const origemBurgo = totaisDeOrigem(burgo, [CONVERSA]);
ok("origem vazia volta para a conta inteira", origemBurgo.spendCents, 146000);
ok("origem vazia não marca selo", origemBurgo.isolado, false);

/* A campanha de origem existe mas não converteu. */
const semResultado = [
  c("a", 8100, 0, 0, "OUTCOME_ENGAGEMENT", "REPLIES"),
  c("b", 195600, 86, 0, "OUTCOME_AWARENESS", "REACH"),
];
const origemSemResultado = totaisDeOrigem(semResultado, [CONVERSA]);
ok("origem sem resultado volta para a conta inteira", origemSemResultado.spendCents, 203700);
ok("origem sem resultado não marca selo", origemSemResultado.isolado, false);

/* Conta em que TODA campanha produz o resultado: certo dos dois jeitos,
   e o selo não aparece — anunciá-lo sugeriria um corte que não houve.
   São 9 das 21 contas da Send, entre elas captação E e captação F. */
const soVenda = [
  c("a", 100000, 40, 500000, "OUTCOME_SALES", "OFFSITE_CONVERSIONS"),
  c("b", 104300, 38, 480000, "OUTCOME_SALES", "OFFSITE_CONVERSIONS"),
];
const origemSoVenda = totaisDeOrigem(soVenda, [COMPRA]);
ok("tudo é origem: soma tudo", origemSoVenda.spendCents, 204300);
ok("tudo é origem: sem selo", origemSoVenda.isolado, false);
ok("tudo é origem: duas campanhas", origemSoVenda.campanhas, 2);

/* --- a decisão é por CAMPANHA, não por linha ------------------------
   `daily_metrics` tem uma linha por DIA — a delivery A tem 16 linhas por
   campanha. Uma campanha sem objetivo é julgada por "produziu o
   resultado?", e julgar isso dia a dia recortaria o gasto dela pelos
   dias bons, deixando o custo por resultado barato demais. Como TODA
   linha da Send está sem objetivo hoje, este é o ramo que roda em toda
   a carteira — não é um caso de borda. */
const semObjetivoTresDias = [
  c("x", 50000, 0, 0, null, null), // dia sem conversão
  c("x", 30000, 5, 250000, null, null), // dia com conversão
  c("x", 20000, 0, 0, null, null), // outro dia sem
  c("y", 40000, 0, 0, "OUTCOME_AWARENESS", "REACH"),
];
const porCampanha = totaisDeOrigem(semObjetivoTresDias, [COMPRA]);
ok(
  "campanha sem objetivo entra INTEIRA quando produziu",
  porCampanha.spendCents,
  100000,
);
ok("e conta como uma campanha só", porCampanha.campanhas, 1);
ok("a de alcance continua fora", porCampanha.isolado, true);

/* O contrário: campanha sem objetivo que nunca converteu fica fora
   inteira, e não só nos dias ruins. */
const nuncaConverteu = [
  c("x", 50000, 0, 0, null, null),
  c("x", 30000, 0, 0, null, null),
  c("v", 60000, 10, 700000, "OUTCOME_SALES", "OFFSITE_CONVERSIONS"),
];
ok(
  "campanha sem objetivo que não produziu fica fora inteira",
  totaisDeOrigem(nuncaConverteu, [COMPRA]).spendCents,
  60000,
);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);

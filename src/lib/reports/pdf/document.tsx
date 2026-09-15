import { join } from "node:path";

import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import { copyDoAnuncio, semEmoji } from "./texto-seguro";
import { corpoQueCabe } from "./medida";
import type { ReportPayload } from "@/lib/reports/payload";
import { payloadHeadline } from "@/lib/reports/payload";
import {
  formatCurrency,
  formatDate,
  formatDelta,
  formatNumber,
  formatPercent,
  formatPeriod,
} from "@/lib/format";

/* =====================================================================
   Documento PDF — apresentação executiva
   ---------------------------------------------------------------------
   Notas de implementação:

   • Tipografia: GEIST, EMBUTIDA no arquivo.

     ⚠️ CORREÇÃO DE UMA AFIRMAÇÃO QUE ESTAVA AQUI. Este comentário dizia
     "Helvetica (embutida no react-pdf)". É falso, e sustentou o
     defeito: as quatorze fontes padrão do PDF — Helvetica entre elas —
     NÃO são embutidas por definição. O arquivo só escreve "use
     Helvetica" e transfere o problema para quem abre.

     Em desktop passa despercebido, porque Preview, Acrobat e Chrome
     substituem por Arial, que tem métrica idêntica. No celular — que é
     onde o cliente abre o PDF que chega por WhatsApp — não existe
     Helvetica nem Arial: o visualizador troca por Roboto ou pior, as
     larguras deixam de bater com as posições que o react-pdf calculou,
     e o resultado é texto sobreposto e valor que some da página.

     Geist porque é a mesma família da interface, é OFL (redistribuível,
     e a licença acompanha em `src/assets/fonts/OFL.txt`) e cobre o
     português inteiro. Os arquivos são lidos do disco no bundle, nunca
     por URL: uma falha de rede em tempo de render derrubaria a geração
     do relatório inteiro.

   • Gráficos: desenhados com <View> posicionado. O react-pdf não executa
     Recharts (não há DOM), e rasterizar gráfico como imagem perderia a
     nitidez na impressão. Retângulos vetoriais imprimem perfeito.

   • Imagens: apenas raster. O payload já marcou `imageIsRaster`; quando
     falso, entra um bloco na cor da marca no lugar — uma imagem inválida
     aqui aborta a geração inteira, e um criativo sem thumb não pode
     custar o relatório do cliente.
   ===================================================================== */

/* Caminho montado em tempo de execução, e não `import` do .ttf: o
   loader trataria o import como asset e devolveria uma URL, que é
   exatamente o caminho por rede que este documento não pode depender.
   Na Vercel o `outputFileTracingIncludes` do next.config garante que os
   dois arquivos viajem junto com a função. */
const DIR_FONTES = join(process.cwd(), "src/assets/fonts");

/* AS QUATRO ENTRADAS SÃO OBRIGATÓRIAS, e as duas de baixo não são
   decoração.

   O react-pdf resolve fonte por (família, peso, estilo) e LANÇA ERRO
   quando a combinação não existe — não cai para a mais próxima. Como
   Helvetica era usada antes, e Helvetica-Oblique é uma das quatorze
   fontes padrão do PDF, todo `fontStyle: "italic"` resolvia sozinho. Ao
   trocar para Geist esse chão some: uma nota em itálico numa seção
   vazia derruba a geração INTEIRA com

     Error: Could not resolve font for Geist, fontWeight 400, fontStyle italic

   e o cliente recebe um 500 no lugar do relatório.

   Geist não tem itálico: a família publicada pela Vercel é só vertical.
   Então as entradas `italic` apontam para os MESMOS arquivos verticais.
   O texto sai sem inclinação, e essa é a escolha consciente — perder a
   inclinação de uma nota secundária custa quase nada, perder o
   relatório custa o envio ao cliente. Isto existe para que um
   `fontStyle: "italic"` escrito daqui a seis meses degrade em vez de
   derrubar. */
Font.register({
  family: "Geist",
  fonts: [
    { src: join(DIR_FONTES, "Geist-Regular.ttf"), fontWeight: 400 },
    { src: join(DIR_FONTES, "Geist-Bold.ttf"), fontWeight: 700 },
    {
      src: join(DIR_FONTES, "Geist-Regular.ttf"),
      fontWeight: 400,
      fontStyle: "italic",
    },
    {
      src: join(DIR_FONTES, "Geist-Bold.ttf"),
      fontWeight: 700,
      fontStyle: "italic",
    },
  ],
});

/* O hifenizador padrão do react-pdf quebra palavra no meio sem hífen
   visível, e em português isso produz coisas como "investi mento" no
   meio de um cartão estreito. Desligado: preferimos a palavra inteira
   passando para a linha seguinte. */
Font.registerHyphenationCallback((palavra) => [palavra]);

/* ------------------------------------------------------------------ */
/* Medidas que o layout e a conta de largura compartilham              */
/* ------------------------------------------------------------------ */

/* Constantes, e não números soltos no StyleSheet, porque `corpoQueCabe`
   precisa saber a largura exata do cartão. Se a margem mudar só no
   estilo, a conta passa a medir um cartão que não existe mais — e o
   valor volta a quebrar calado. */
const LARGURA_A4 = 595.28;
const MARGEM_PAGINA = 44;
const MARGEM_CAPA = 48;
const VAO_KPI = 10;
const RESPIRO_KPI = 14;
const COLUNAS_KPI = 3;
const CORPO_VALOR = 20;

/** Largura útil do número dentro de um cartão de KPI. */
function larguraDoValor(margem: number): number {
  const util = LARGURA_A4 - 2 * margem;
  return (util - (COLUNAS_KPI - 1) * VAO_KPI) / COLUNAS_KPI - 2 * RESPIRO_KPI;
}

/**
 * O corpo da LINHA de cartões: o menor que faz todos caberem.
 *
 * Por linha, e não por cartão. Três números lado a lado em corpos
 * diferentes leem como hierarquia — o maior parece o mais importante —,
 * e a diferença seria só de quantos dígitos cada um tem.
 */
function corpoDaLinha(valores: string[], margem: number): number {
  const largura = larguraDoValor(margem);
  return Math.min(...valores.map((v) => corpoQueCabe(v, largura, CORPO_VALOR)));
}

const INK = "#141413";
const INK_SOFT = "#5C5C57";
const HAIRLINE = "#E4E2DD";
const SURFACE = "#F7F6F3";
const POSITIVE = "#1F7A4D";
const NEGATIVE = "#B03A2E";

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 56,
    paddingHorizontal: MARGEM_PAGINA,
    fontSize: 9.5,
    fontFamily: "Geist",
    color: INK,
    backgroundColor: "#FFFFFF",
  },

  /* ---------------------------- Capa ---------------------------- */
  cover: { padding: 0, fontFamily: "Geist", color: INK },
  coverBand: { height: 300, paddingTop: 56, paddingHorizontal: MARGEM_CAPA },
  coverEyebrow: {
    fontSize: 8,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "#FFFFFF",
    opacity: 0.75,
  },
  coverTitle: {
    fontSize: 34,
    fontFamily: "Geist", fontWeight: 700,
    color: "#FFFFFF",
    marginTop: 14,
    lineHeight: 1.1,
  },
  coverPeriod: { fontSize: 11, color: "#FFFFFF", opacity: 0.9, marginTop: 12 },
  coverBody: { paddingHorizontal: MARGEM_CAPA, paddingTop: 36 },

  /* -------------------------- Estrutura ------------------------- */
  eyebrow: {
    fontSize: 7.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  h2: { fontSize: 15, fontFamily: "Geist", fontWeight: 700, marginBottom: 3 },
  sub: { fontSize: 9, color: INK_SOFT, marginBottom: 16 },
  section: { marginBottom: 26 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 22,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  headerName: { fontSize: 10, fontFamily: "Geist", fontWeight: 700 },
  headerMeta: { fontSize: 8, color: INK_SOFT },

  footer: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: INK_SOFT,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
  },

  /* ---------------------------- KPIs ---------------------------- */
  kpiRow: { flexDirection: "row", gap: VAO_KPI, marginBottom: 10 },
  kpiCard: {
    flex: 1,
    padding: RESPIRO_KPI,
    borderRadius: 8,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  kpiLabel: {
    fontSize: 7,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  kpiValue: { fontSize: CORPO_VALOR, fontFamily: "Geist", fontWeight: 700, marginTop: 7 },
  kpiDelta: { fontSize: 8, marginTop: 6 },
  kpiPrev: { fontSize: 7.5, color: INK_SOFT, marginTop: 2 },
  /* O selo da campanha de origem. Fica ACIMA do delta e abaixo do
     número, porque é qualificação do número, não da variação. */
  kpiOrigem: { fontSize: 6.5, color: INK_SOFT, marginTop: 1 },

  /* --------------------------- Gráfico -------------------------- */
  chartFrame: {
    height: 130,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 1.5,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
    paddingBottom: 1,
  },
  chartAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    fontSize: 7,
    color: INK_SOFT,
  },

  /* --------------------------- Canais --------------------------- */
  /* --------------------- Página por plataforma -------------------- */
  platformBadge: {
    alignSelf: "flex-start",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 3,
    fontSize: 8,
    fontFamily: "Geist", fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#FFFFFF",
    marginBottom: 8,
  },
  platformShare: { fontSize: 9, color: INK_SOFT, marginBottom: 14 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
    paddingBottom: 5,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F3F5",
  },
  th: {
    fontSize: 7.5,
    fontFamily: "Geist", fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  td: { fontSize: 8.5 },
  /* Corta em uma linha com reticências. No react-pdf isto é ESTILO, não
     propriedade do <Text> — e o motor mede a largura real, coisa que um
     corte por número de caracteres não faz. */
  umaLinha: { maxLines: 1, textOverflow: "ellipsis" },

  splitRow: { marginBottom: 12 },
  splitHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  splitName: { fontSize: 9.5, fontFamily: "Geist", fontWeight: 700 },
  splitTrack: {
    height: 5,
    backgroundColor: HAIRLINE,
    borderRadius: 3,
    overflow: "hidden",
  },
  splitMeta: { fontSize: 7.5, color: INK_SOFT, marginTop: 4 },

  /* -------------------------- Criativos ------------------------- */
  /* CARTÃO COMPACTO. Com miniatura de 92 e folga de 12, seis anúncios
     ocupavam quase duas folhas e o cliente rolava duas telas para ver
     quatro. Nada de informação saiu; o que encolheu foi o espaço em
     volta dela. A miniatura em 46 continua reconhecível — é o quadro do
     vídeo, e quem lê reconhece o anúncio pela cor e pelo rosto. */
  adCard: {
    flexDirection: "row",
    gap: 8,
    padding: 8,
    marginBottom: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  adThumb: { width: 46, height: 46, borderRadius: 4, objectFit: "cover" },
  adPlaceholder: {
    width: 46,
    height: 46,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  adPlatform: {
    fontSize: 6.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  adHeadline: { fontSize: 10, fontFamily: "Geist", fontWeight: 700, marginTop: 3 },
  adCopy: { fontSize: 8, color: INK_SOFT, marginTop: 4, lineHeight: 1.45 },
  adMetrics: {
    flexDirection: "row",
    gap: 18,
    marginTop: 8,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  adMetricLabel: {
    fontSize: 6.5,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  adMetricValue: { fontSize: 9, fontFamily: "Geist", fontWeight: 700, marginTop: 2 },

  /* --------------------------- Textos --------------------------- */
  paragraph: { fontSize: 9.5, lineHeight: 1.6, color: INK },
  stepRow: { flexDirection: "row", gap: 8, marginBottom: 7 },
  stepIndex: { fontSize: 9, fontFamily: "Geist", fontWeight: 700, width: 14 },
  stepText: { fontSize: 9.5, lineHeight: 1.5, flex: 1 },

  emptyNote: {
    fontSize: 8.5,
    color: INK_SOFT,
    fontStyle: "italic",
    paddingVertical: 8,
  },
});

export function ReportDocument({ payload }: { payload: ReportPayload }) {
  const accent = payload.meta.accent;
  const brand = payload.client.brandPrimary ?? INK;
  const chartColor = payload.client.brandPrimary ?? accent;
  const period = formatPeriod(payload.meta.periodStart, payload.meta.periodEnd);

  // A capa é sempre a primeira página; as demais seções seguem a ordem
  // definida no template do segmento.
  const bodySections = payload.sections.filter((s) => s.type !== "cover");
  const cover = payload.sections.find((s) => s.type === "cover");

  return (
    <Document
      title={`${payload.client.name} — ${period}`}
      author="Agência Send"
      subject={payload.meta.templateName}
      creator="Send Hub"
    >
      {/* ============================= CAPA ============================= */}
      <Page size="A4" style={styles.cover}>
        <View style={[styles.coverBand, { backgroundColor: brand }]}>
          <Text style={styles.coverEyebrow}>
            {cover?.title ?? "Relatório de Mídia Paga"}
          </Text>
          <Text style={styles.coverTitle}>{payload.client.name}</Text>
          <Text style={styles.coverPeriod}>{period}</Text>

          {/* Faixa de acento: uma barra fina que amarra a capa à marca
              da agência sem competir com a cor do cliente. */}
          <View
            style={{
              width: 64,
              height: 4,
              backgroundColor: accent,
              marginTop: 22,
              borderRadius: 2,
            }}
          />
        </View>

        <View style={styles.coverBody}>
          <CoverSummary payload={payload} />
        </View>

        <View style={styles.footer} fixed>
          <Text>Agência Send · Relatório de performance</Text>
          <Text>
            Gerado em {formatDate(payload.meta.generatedAt)}
          </Text>
        </View>
      </Page>

      {/* =========================== CONTEÚDO =========================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.headerName}>{payload.client.name}</Text>
          <Text style={styles.headerMeta}>{period}</Text>
        </View>

        {bodySections.map((section, index) => {
          /* `platform_detail` sai do molde das outras seções: ele rende
             UMA PÁGINA POR PLATAFORMA, e o invólucro comum tem
             `wrap={false}` — que tentaria segurar onze KPIs mais a
             tabela de campanhas de dois canais na mesma folha e
             estouraria a margem. */
          if (section.type === "platform_detail") {
            return (
              <PlatformPages
                key={`${section.type}-${index}`}
                payload={payload}
                title={section.title}
                accent={chartColor}
              />
            );
          }

          /* ⚠️ A GALERIA PRECISA PODER QUEBRAR ENTRE PÁGINAS, e o resto
             não. `wrap={false}` valia para toda seção — com seis cartões
             de anúncio a galeria fica mais alta que uma folha, o
             react-pdf avisa

               Node of type VIEW can't wrap between pages and it's
               bigger than available page height

             e desenha tudo POR CIMA: a copy do anúncio atravessa a linha
             de métricas, a miniatura vaza a borda do cartão, e o cliente
             recebe um documento ilegível. Cada CARTÃO continua
             `wrap={false}` — ele cabe numa folha e não deve ser partido
             ao meio.

             As demais seções seguem inteiriças: são curtas, e quebrar um
             gráfico ou uma tabela de campanhas ao meio é pior do que
             empurrá-los para a página seguinte. */
          const galeria = section.type === "ad_gallery";

          return (
            <View
              key={`${section.type}-${index}`}
              style={styles.section}
              wrap={galeria}
            >
              <Text style={styles.h2}>{section.title}</Text>
              {/* Gráficos usam a cor da marca DO CLIENTE, não o acento da
                  agência: o documento é lido por ele, e o neon do template
                  tem contraste ruim sobre papel branco. O acento fica
                  reservado à capa, onde marca a autoria da agência. */}
              <SectionBody
                section={section.type}
                payload={payload}
                accent={chartColor}
              />
            </View>
          );
        })}

        <View style={styles.footer} fixed>
          <Text>Agência Send</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

/* ------------------------------------------------------------------ */
/* Blocos                                                              */
/* ------------------------------------------------------------------ */

function CoverSummary({ payload }: { payload: ReportPayload }) {
  const top = payload.kpis.slice(0, 3);
  /* MARGEM_CAPA, não MARGEM_PAGINA: a capa tem respiro maior, e o cartão
     dela é 2,6pt mais estreito que o das outras páginas. */
  const corpo = corpoDaLinha(top.map((k) => k.formatted), MARGEM_CAPA);

  return (
    <View>
      <Text style={styles.eyebrow}>Resumo do período</Text>
      <View style={[styles.kpiRow, { marginTop: 12 }]}>
        {top.map((kpi) => (
          <View key={kpi.key} style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{kpi.label}</Text>
            <Text style={[styles.kpiValue, { fontSize: corpo }]}>
              {kpi.formatted}
            </Text>
            <SeloDeOrigem kpi={kpi} />
            <DeltaText kpi={kpi} />
          </View>
        ))}
      </View>
      <Text style={[styles.sub, { marginTop: 14 }]}>
        Dados unificados de Google Ads e Meta Ads. A variação compara com
        os {payload.meta.days} dias imediatamente anteriores.
      </Text>
    </View>
  );
}

/**
 * "de 1 campanha" — o recorte que o número usou.
 *
 * SEM ISTO O NÚMERO NÃO FECHA, e é o tipo de discrepância que destrói a
 * confiança no relatório inteiro: a capa diz o investimento da conta
 * inteira, e o card diz um custo por resultado menor. Quem divide na
 * calculadora acha outro número. O selo é a diferença entre "o
 * relatório está errado" e "o custo é da campanha que vende".
 *
 * Só aparece quando houve recorte — numa conta em que toda campanha é de
 * venda, `origem` é nulo e dizer "de 3 campanhas" sugeriria um corte que
 * não houve. São 9 das 21 contas da Send.
 */
function SeloDeOrigem({ kpi }: { kpi: ReportPayload["kpis"][number] }) {
  if (kpi.origem === null) return null;
  return (
    <Text style={styles.kpiOrigem}>
      de {kpi.origem} {kpi.origem === 1 ? "campanha" : "campanhas"}
    </Text>
  );
}

function DeltaText({ kpi }: { kpi: ReportPayload["kpis"][number] }) {
  if (kpi.deltaPercent === null) {
    return <Text style={styles.kpiPrev}>sem base de comparação</Text>;
  }

  // A cor segue o SENTIMENTO já resolvido pelo motor de KPI — CPA caindo
  // é verde, mesmo sendo variação negativa.
  const color =
    kpi.sentiment === "positive"
      ? POSITIVE
      : kpi.sentiment === "negative"
        ? NEGATIVE
        : INK_SOFT;

  // Sem glifo de seta, e a RAZÃO MUDOU. Ela era a codificação: a
  // Helvetica do PDF usa WinAnsi, que não tem ▲/▼, e os caracteres
  // saíam como lixo ("²", "¼"). Com Geist embutida isso acabou —
  // conferido no arquivo: U+25B2, U+25BC e U+2212 estão todos na fonte.
  //
  // O sinal explícito FICA, agora por escolha e não por limitação: ele
  // diz a direção, a cor diz se é bom ou ruim, e as duas coisas juntas
  // sobrevivem a um PDF impresso em preto e branco, que a seta colorida
  // sozinha não faria.
  return (
    <>
      <Text style={[styles.kpiDelta, { color }]}>
        {formatDelta(kpi.deltaPercent)}
      </Text>
      <Text style={styles.kpiPrev}>anterior: {kpi.previousFormatted}</Text>
    </>
  );
}

function SectionBody({
  section,
  payload,
  accent,
}: {
  section: string;
  payload: ReportPayload;
  accent: string;
}) {
  switch (section) {
    case "kpi_grid":
      return <KpiGrid payload={payload} />;
    case "trend_chart":
      return <TrendBars payload={payload} accent={accent} />;
    case "platform_split":
      return <PlatformBars payload={payload} accent={accent} />;
    case "campaign_table":
      return <PlatformBars payload={payload} accent={accent} />;
    case "ad_gallery":
      return <AdGallery payload={payload} />;
    case "insights":
      return payload.insights ? (
        <Text style={styles.paragraph}>{payload.insights}</Text>
      ) : (
        <Text style={styles.emptyNote}>
          Análise não preenchida para este período.
        </Text>
      );
    case "next_steps":
      return payload.nextSteps.length > 0 ? (
        <View>
          {payload.nextSteps.map((step, index) => (
            <View key={index} style={styles.stepRow}>
              <Text style={styles.stepIndex}>{index + 1}.</Text>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyNote}>
          Próximos passos serão alinhados na reunião de resultados.
        </Text>
      );
    default:
      return null;
  }
}

/**
 * Uma página por plataforma: quadro completo de métricas + campanhas.
 *
 * `break` em TODAS, inclusive na primeira. O canal começa em folha
 * limpa porque é assim que o cliente lê — ele procura "a parte do Meta",
 * e uma seção que começa no meio da página anterior não é uma parte.
 *
 * Plataforma sem veiculação no período não aparece: `platformDetail` já
 * vem só com quem teve linha. Uma conta que só roda Meta não recebe uma
 * página de Google zerada.
 */
/* ------------------------------------------------------------------ */
/* Quantas campanhas cabem na página da plataforma                     */
/* ------------------------------------------------------------------ */

/* ⚠️ ALTURAS MEDIDAS, não estimadas. Saíram do PDF renderizado, lendo a
   posição de cada linha com pdfjs, em 15/09/2026:

     linha de cartões de KPI ............ 105,7pt
     + selo "de N campanhas" na linha ...   9,5pt
     linha da tabela de campanhas ........ 22,0pt
     1ª linha da tabela, com 4 linhas de
       cartões sem selo .................. 650,4pt do topo
     fim do miolo da folha ............... 785,9pt (A4 − respiro de 56)

   O TETO ERA SEIS, FIXO, e estava errado para o caso mais comum. Com
   onze KPIs (conta com receita: delivery e e-commerce) e o selo nos
   cartões de custo e de ROAS, só QUATRO linhas cabem. As outras duas
   empurravam "Mais N campanhas" para uma folha nova — que saía com uma
   linha só, ou em branco quando a margem da seção transbordava sozinha.

   Se o desenho do cartão ou da tabela mudar, estes números precisam ser
   medidos de novo. O erro, se houver, aparece como página órfã no fim
   da plataforma — não como texto sobreposto. */
const PASSO_LINHA_DE_CARTOES = 105.7;
const ACRESCIMO_DO_SELO = 9.5;
const PASSO_LINHA_DA_TABELA = 22;
const PRIMEIRA_LINHA_SEM_CARTOES = 650.4 - 4 * PASSO_LINHA_DE_CARTOES;
const FIM_DO_MIOLO = 841.89 - 56;
/** Da última linha até o fim da nota "Mais N campanhas". */
const ALTURA_DA_NOTA = 31.5;
/** Fim de uma linha de tabela abaixo da linha de base. */
const DESCIDA_DA_LINHA = 8.5;
/** Arredondamento do layout e a diferença entre medir e renderizar. */
const FOLGA = 10;

function linhasDeCampanhaQueCabem(
  kpis: ReportPayload["kpis"],
  totalDeCampanhas: number,
): number {
  const linhasDeCartoes = Math.ceil(kpis.length / 3);
  let linhasComSelo = 0;
  for (let i = 0; i < kpis.length; i += 3) {
    if (kpis.slice(i, i + 3).some((k) => k.origem !== null)) linhasComSelo++;
  }

  const primeira =
    PRIMEIRA_LINHA_SEM_CARTOES +
    linhasDeCartoes * PASSO_LINHA_DE_CARTOES +
    linhasComSelo * ACRESCIMO_DO_SELO;
  const limite = FIM_DO_MIOLO - FOLGA;

  /* Todas cabem sem a nota? Então não há nota, e sobra mais espaço. */
  const semNota =
    Math.floor((limite - DESCIDA_DA_LINHA - primeira) / PASSO_LINHA_DA_TABELA) + 1;
  if (totalDeCampanhas <= semNota) return totalDeCampanhas;

  const comNota =
    Math.floor((limite - ALTURA_DA_NOTA - primeira) / PASSO_LINHA_DA_TABELA) + 1;
  /* Nunca zero: uma plataforma com gasto e nenhuma campanha na tabela
     parece defeito. Na pior combinação medida — onze KPIs, duas linhas
     com selo — cabem quatro. */
  return Math.max(1, comNota);
}

function PlatformPages({
  payload,
  title,
  accent,
}: {
  payload: ReportPayload;
  title: string;
  accent: string;
}) {
  if (payload.platformDetail.length === 0) {
    return (
      <View style={styles.section} wrap={false}>
        <Text style={styles.h2}>{title}</Text>
        <Text style={styles.emptyNote}>
          Nenhuma plataforma teve veiculação neste período.
        </Text>
      </View>
    );
  }

  return (
    <>
      {payload.platformDetail.map((p) => {
        const cabem = linhasDeCampanhaQueCabem(p.kpis, p.campaigns.length);
        return (
        /* SEM MARGEM INFERIOR. A página da plataforma ocupa a folha
           inteira e a próxima começa com `break`; os 26pt de margem da
           seção não separavam nada e, com a tabela chegando ao fim do
           miolo, transbordavam sozinhos e abriam uma folha em branco. */
        <View key={p.platform} style={[styles.section, { marginBottom: 0 }]} break>
          <Text style={[styles.platformBadge, { backgroundColor: accent }]}>
            {p.label}
          </Text>

          <Text style={styles.h2}>{title}</Text>
          <Text style={styles.platformShare}>
            {formatPercent(p.spendShare, 0)} do investimento do período · variação
            contra o período anterior deste mesmo canal
          </Text>

          <KpiCards kpis={p.kpis} />

          {p.campaigns.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={[styles.eyebrow, { marginBottom: 8 }]}>
                Campanhas
              </Text>

              <View style={styles.tableHead}>
                <Text style={[styles.th, { flex: 3 }]}>Campanha</Text>
                <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>
                  Investido
                </Text>
                <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>
                  Result.
                </Text>
                <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>
                  Custo
                </Text>
                <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>
                  Cliques
                </Text>
                <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>
                  CTR
                </Text>
              </View>

              {/* QUANTAS CABEM, e a conta está em
                  `linhasDeCampanhaQueCabem`. Era seis fixo — o que valia
                  sem o selo "de N campanhas" nos cartões e deixava de
                  valer justamente nas contas com receita. */}
              {p.campaigns.slice(0, cabem).map((c) => (
                <View key={c.name} style={styles.tableRow}>
                  {/* UMA LINHA, com reticências. Nome que quebrava em
                      duas deixava a linha da tabela com o dobro da
                      altura, e as seis linhas medidas para caber na folha
                      deixavam de caber: sobrava uma página com duas
                      campanhas sozinhas. O corte por caracteres
                      (`encurtar`, 42) não bastava — em maiúsculas, que é
                      a convenção de nome de campanha, 42 caracteres
                      passam da coluna. Quem mede agora é o motor. */}
                  <Text style={[styles.td, styles.umaLinha, { flex: 3 }]}>
                    {c.name}
                  </Text>
                  <Text style={[styles.td, { flex: 1, textAlign: "right" }]}>
                    {formatCurrency(c.spendCents)}
                  </Text>
                  <Text style={[styles.td, { flex: 1, textAlign: "right" }]}>
                    {formatNumber(c.results)}
                  </Text>
                  <Text style={[styles.td, { flex: 1, textAlign: "right" }]}>
                    {c.results > 0 ? formatCurrency(c.cpaCents) : "—"}
                  </Text>
                  {/* Cliques existia só na folha HTML: a equipe conferia
                      uma tabela de seis colunas e o cliente recebia uma
                      de cinco. */}
                  <Text style={[styles.td, { flex: 1, textAlign: "right" }]}>
                    {formatNumber(c.clicks)}
                  </Text>
                  <Text style={[styles.td, { flex: 1, textAlign: "right" }]}>
                    {formatPercent(c.ctr, 2)}
                  </Text>
                </View>
              ))}

              {p.campaigns.length > cabem && (
                <Text style={[styles.emptyNote, { paddingVertical: 6 }]}>
                  Mais {p.campaigns.length - cabem}{" "}
                  {p.campaigns.length - cabem === 1 ? "campanha" : "campanhas"} com
                  investimento menor.
                </Text>
              )}
            </View>
          )}
        </View>
        );
      })}
    </>
  );
}

/** Grade de KPIs de três colunas, reaproveitada pelas duas seções. */
function KpiCards({ kpis }: { kpis: ReportPayload["kpis"] }) {
  const rows: ReportPayload["kpis"][] = [];
  for (let i = 0; i < kpis.length; i += 3) rows.push(kpis.slice(i, i + 3));

  return (
    <View>
      {rows.map((row, rowIndex) => {
        const corpo = corpoDaLinha(row.map((k) => k.formatted), MARGEM_PAGINA);
        return (
        <View key={rowIndex} style={styles.kpiRow}>
          {row.map((kpi) => (
            <View key={kpi.key} style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>{kpi.label}</Text>
              <Text style={[styles.kpiValue, { fontSize: corpo }]}>
                {kpi.formatted}
              </Text>
              <SeloDeOrigem kpi={kpi} />
              <DeltaText kpi={kpi} />
            </View>
          ))}
          {/* Preenche a linha incompleta para os cards não esticarem. */}
          {row.length < 3 &&
            Array.from({ length: 3 - row.length }).map((_, i) => (
              <View key={`spacer-${i}`} style={{ flex: 1 }} />
            ))}
        </View>
        );
      })}
    </View>
  );
}

function KpiGrid({ payload }: { payload: ReportPayload }) {
  // Delega para `KpiCards`: a grade é a mesma da página por plataforma,
  // e duas cópias divergiriam na primeira mudança de espaçamento.
  return <KpiCards kpis={payload.kpis} />;
}

/**
 * Barras de investimento diário.
 * Cada barra é um <View> com altura proporcional — vetor puro, imprime
 * nítido em qualquer resolução.
 */
function TrendBars({
  payload,
  accent,
}: {
  payload: ReportPayload;
  accent: string;
}) {
  const data = payload.trend;
  if (data.length === 0) {
    return <Text style={styles.emptyNote}>Sem dados no período.</Text>;
  }

  const max = Math.max(...data.map((p) => p.spend), 1);

  return (
    <View>
      <View style={styles.chartFrame}>
        {data.map((point) => (
          <View
            key={point.date}
            style={{
              flex: 1,
              // Mínimo de 2pt: dia com investimento quase zero ainda
              // precisa aparecer como barra, senão parece dado faltando.
              height: Math.max((point.spend / max) * 124, 2),
              backgroundColor: accent,
              borderTopLeftRadius: 1.5,
              borderTopRightRadius: 1.5,
            }}
          />
        ))}
      </View>

      <View style={styles.chartAxis}>
        <Text>{formatDate(`${data[0].date}T12:00:00`)}</Text>
        <Text>
          pico {formatCurrency(Math.round(max * 100))}
        </Text>
        <Text>{formatDate(`${data[data.length - 1].date}T12:00:00`)}</Text>
      </View>
    </View>
  );
}

function PlatformBars({
  payload,
  accent,
}: {
  payload: ReportPayload;
  accent: string;
}) {
  if (payload.platforms.length === 0) {
    return <Text style={styles.emptyNote}>Nenhum canal ativo no período.</Text>;
  }

  return (
    <View>
      {payload.platforms.map((row) => (
        <View key={row.platform} style={styles.splitRow}>
          <View style={styles.splitHead}>
            <Text style={styles.splitName}>{row.label}</Text>
            <Text style={{ fontSize: 9.5 }}>
              {formatCurrency(row.totals.spendCents)}{" "}
              <Text style={{ color: INK_SOFT, fontSize: 8 }}>
                {formatPercent(row.spendShare, 0)}
              </Text>
            </Text>
          </View>

          <View style={styles.splitTrack}>
            <View
              style={{
                width: `${Math.max(row.spendShare * 100, 1.5)}%`,
                height: "100%",
                backgroundColor: accent,
              }}
            />
          </View>

          <Text style={styles.splitMeta}>
            {formatNumber(Math.round(row.totals.conversions))} resultados ·{" "}
            {formatCurrency(row.cpa)} por resultado
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Galeria de anúncios: miniatura, copy e as métricas daquele criativo.
 * É a seção que o cliente mais lê — ele reconhece o anúncio que viu.
 */
function AdGallery({ payload }: { payload: ReportPayload }) {
  if (payload.creatives.length === 0) {
    return (
      <Text style={styles.emptyNote}>
        Nenhum criativo ativo sincronizado neste período.
      </Text>
    );
  }

  return (
    <View>
      {/* ⚠️ A RESSALVA EXISTE PARA O CASO EM QUE O NÚMERO NÃO É DESTA
          JANELA. `ad_creatives` guarda uma foto do último sync; quando a
          apuração na Graph API não responde, os cards caem nela — e sem
          esta linha o documento afirmaria, calado, que o gasto de outra
          janela é o do período. */}
      {!payload.meta.criativosDoPeriodo && (
        <Text style={styles.emptyNote}>
          Não foi possível apurar os anúncios nesta janela — os números
          abaixo são da última sincronização, não do período deste
          relatório.
        </Text>
      )}
      {payload.creatives.map((ad) => (
        <View key={ad.id} style={styles.adCard} wrap={false}>
          {ad.imageIsRaster && ad.imageUrl ? (
            // `Image` aqui é do @react-pdf/renderer, não <img> do DOM:
            // não existe `alt` no PDF. A regra de a11y é um falso
            // positivo por casar apenas pelo nome do componente.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={ad.imageUrl} style={styles.adThumb} />
          ) : (
            <View
              style={[
                styles.adPlaceholder,
                { backgroundColor: payload.client.brandPrimary ?? SURFACE },
              ]}
            >
              <Text style={{ fontSize: 7, color: "#FFFFFF", opacity: 0.85 }}>
                {ad.platformLabel}
              </Text>
            </View>
          )}

          <View style={{ flex: 1 }}>
            {/* SEM NOME DE CAMPANHA, SEM O SEPARADOR. `campaign_name`
                vem nulo em 100% dos criativos que a Meta devolve — o
                cartão imprimia "META ADS · —", e um traço pendurado
                depois de um ponto médio lê como campo que falhou.
                Melhor dizer só a plataforma, que é verdade inteira. */}
            <Text style={[styles.adPlatform, styles.umaLinha]}>
              {ad.campaignName
                ? `${ad.platformLabel} · ${ad.campaignName}`
                : ad.platformLabel}
            </Text>
            <Text style={styles.adHeadline}>
              {semEmoji(ad.headline ?? ad.adName ?? "—") || "—"}
            </Text>
            {/* 110 e não 190: com o cartão compacto, a copy longa era o
                que ainda empurrava a galeria para uma segunda folha. O
                anúncio se reconhece pela primeira frase — o texto
                inteiro está na plataforma, não é o PDF que arquiva copy.

                `copyDoAnuncio` limpa ANTES de cortar: cortar primeiro
                gastaria parte do limite com caractere que vai sumir e,
                pior, o corte pode cair no meio de um par de substitutos
                e deixar meio emoji — que é exatamente o lixo que esta
                limpeza existe para tirar. */}
            {copyDoAnuncio(ad.primaryText, 110) && (
              <Text style={styles.adCopy}>
                {copyDoAnuncio(ad.primaryText, 110)}
              </Text>
            )}

            <View style={styles.adMetrics}>
              <View>
                <Text style={styles.adMetricLabel}>Investido</Text>
                <Text style={styles.adMetricValue}>
                  {formatCurrency(ad.spendCents)}
                </Text>
              </View>
              <View>
                <Text style={styles.adMetricLabel}>Resultados</Text>
                <Text style={styles.adMetricValue}>
                  {formatNumber(ad.results)}
                </Text>
              </View>
              <View>
                <Text style={styles.adMetricLabel}>Custo/result.</Text>
                <Text style={styles.adMetricValue}>
                  {ad.cpaCents > 0 ? formatCurrency(ad.cpaCents) : "—"}
                </Text>
              </View>
              <View>
                <Text style={styles.adMetricLabel}>CTR</Text>
                <Text style={styles.adMetricValue}>
                  {formatPercent(ad.ctr, 2)}
                </Text>
              </View>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Corta no limite de palavra — corte no meio da palavra parece defeito. */
export { payloadHeadline };

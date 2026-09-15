/* =====================================================================
   Quanto cabe numa linha, medido na fonte
   ---------------------------------------------------------------------
   O react-pdf não reduz texto para caber: quando o valor de um KPI é
   mais largo que o cartão, ele QUEBRA A LINHA, e o cliente lê "R$" em
   cima e o número embaixo — uma informação literalmente por cima da
   outra.

   MEDIDO em 15/09/2026, com as larguras de avanço de Geist Bold e o
   cartão real (três por linha, folga de 10, respiro de 14):

       R$ 47.190,66        125,9pt a 20pt   cabe
       R$ 123.456,78       139,6pt a 20pt   QUEBRA   (cartão tem 134,4pt)
       R$ 1.234.567,89     157,0pt a 20pt   QUEBRA

   Ou seja: basta um período com faturamento acima de R$ 100 mil para a
   capa sair partida. Na capa é pior, porque a margem lá é 48 e não 44 —
   o cartão tem 131,8pt.

   POR QUE UMA TABELA E NÃO A FONTE CARREGADA. Medir de verdade exigiria
   abrir o .ttf com fontkit dentro do documento, amarrando o PDF a uma
   dependência transitiva do react-pdf que pode mudar de versão sem
   aviso. Valores de KPI usam um alfabeto pequeno e conhecido — dígitos,
   R$, separadores, % e x —, então a tabela é exata para eles.

   Os números saíram do `hmtx` do próprio Geist-Bold.ttf, em fração do
   eme (upem = 1000). Se a fonte for trocada, a tabela precisa ser gerada
   de novo; caractere fora dela conta com a largura do MAIS LARGO da
   tabela, que erra para o lado de reduzir — nunca para o de quebrar.
   ===================================================================== */

const LARGURA_EM: Record<string, number> = {
  "0": 0.693,
  "1": 0.449,
  "2": 0.653,
  "3": 0.65,
  "4": 0.656,
  "5": 0.671,
  "6": 0.627,
  "7": 0.544,
  "8": 0.664,
  "9": 0.631,
  "R": 0.697,
  "$": 0.67,
  ".": 0.236,
  ",": 0.236,
  "%": 0.825,
  " ": 0.228,
  "x": 0.65,
  "—": 0.911,
  "-": 0.417,
  "−": 0.544,
  "+": 0.57,
  "\u00A0": 0.228,
  "k": 0.647,
  "m": 0.9,
  "i": 0.281,
  "l": 0.313,
  "M": 0.915,
  "d": 0.634,
  "K": 0.689,
  "h": 0.611,
};

/** O glifo mais largo da tabela — fallback conservador. */
const MAIS_LARGO = 0.915;

/** Largura do texto em pontos, no corpo pedido, em Geist Bold. */
export function larguraEmNegrito(texto: string, corpo: number): number {
  let em = 0;
  for (const ch of texto) em += LARGURA_EM[ch] ?? MAIS_LARGO;
  return em * corpo;
}

/**
 * O maior corpo, até `maximo`, em que o texto cabe em UMA linha.
 *
 * Arredonda PARA BAIXO em meio ponto e desconta uma folga de 3%: o
 * layout do react-pdf arredonda posições, e um valor que cabe por um
 * décimo de ponto na conta pode quebrar na prática.
 *
 * Nunca abaixo de `minimo`: a partir dali, reduzir mais deixa de ser
 * legível. Se nem no mínimo couber, é sinal de que o cartão precisa de
 * outro desenho — e o valor quebra, que é o comportamento de antes.
 */
export function corpoQueCabe(
  texto: string,
  largura: number,
  maximo: number,
  minimo = 11,
): number {
  const noMaximo = larguraEmNegrito(texto, maximo);
  if (noMaximo <= largura * 0.97) return maximo;
  const ideal = (maximo * largura * 0.97) / noMaximo;
  return Math.max(minimo, Math.floor(ideal * 2) / 2);
}

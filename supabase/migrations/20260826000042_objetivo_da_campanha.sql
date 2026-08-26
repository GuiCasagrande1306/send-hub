/* =====================================================================
   O objetivo da campanha, junto da métrica do dia
   ---------------------------------------------------------------------
   POR QUE. O custo por resultado e o ROAS eram divididos pelo gasto da
   CONTA INTEIRA — inclusive o que foi para alcance e tráfego, que não
   são custo de resultado nenhum.

   MEDIDO NA CARTEIRA DA SEND em 26/08/2026, sobre agosto. Seis contas
   passam a isolar, e a delivery A é o caso do meio:

     02 | VENDAS DELIVERY      R$220,22 · 21 pedidos · R$3.413,00
     01 | TRAFEGO INSTAGRAM      R$92,82 ·  0
     ---------------------------------------------------------
     conta inteira             R$313,04 · 21 pedidos

   Dividir tudo dá R$14,91 por pedido. Isolando a campanha que existe
   para vender: R$10,49. Os R$92,82 de alcance pagam outra coisa, e
   somá-los faz uma conta saudável parecer cara na frente do cliente.

   Para isolar é preciso saber PARA QUE cada campanha foi criada, e isso
   o banco não guardava: `daily_metrics` tem o gasto por campanha desde
   sempre (1.114 linhas em agosto, nenhuma agregada em '_all'), mas nada
   dizia se a campanha era de venda ou de alcance.

   POR QUE AQUI E NÃO NUMA TABELA DE CAMPANHAS. O objetivo é atributo da
   campanha, não do dia — uma tabela `campaigns` seria mais normalizada.
   Só que toda leitura desta métrica é "some as linhas deste período" e
   passaria a exigir join; e o job de sync já escreve uma linha por
   campanha por dia, então preencher duas colunas a mais não custa
   chamada nova. A repetição é o preço, e é barato: são dois textos
   curtos por linha.

   NULO É ESTADO LEGÍTIMO, em três casos, e quem lê precisa tratá-los:
     - Google Ads, que não tem `objective` equivalente
     - linha antiga, gravada antes desta migration
     - campanha que a Meta devolve sem o campo
   A regra em `campanha-de-origem.ts` trata nulo como "não sei": a
   campanha entra na conta se PRODUZIU o resultado. Nunca vira zero.

   NA SEND, HOJE, TODAS AS LINHAS SÃO NULAS — as 1.114 são anteriores a
   esta migration. Então o ramo "não sei" é o único que roda até a
   próxima sincronização, e é ele que produz os seis isolamentos
   medidos acima. Isso é esperado, não é degradação.
   ===================================================================== */

alter table public.daily_metrics
  add column if not exists objective         text,
  add column if not exists optimization_goal text;

comment on column public.daily_metrics.objective is
  'Objetivo da campanha na plataforma (OUTCOME_SALES, OUTCOME_LEADS...). NULL = desconhecido, não "nenhum". Ver campanha-de-origem.ts.';

comment on column public.daily_metrics.optimization_goal is
  'O que o leilão otimiza (OFFSITE_CONVERSIONS, REPLIES...). Mais específico que `objective` e tem precedência sobre ele.';

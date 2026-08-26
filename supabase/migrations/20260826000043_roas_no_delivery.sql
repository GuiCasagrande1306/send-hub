/* =====================================================================
   Receita e ROAS no relatório de delivery
   ---------------------------------------------------------------------
   O template de delivery lista `spend, results, cpa, ctr, cpc`. Não tem
   receita e não tem ROAS: o cliente de delivery vê quanto gastou e
   quantos pedidos entraram, e nada sobre quanto voltou.

   MEDIDO EM 26/08/2026. Sete das onze contas de delivery têm gasto no
   período, e as sete têm receita rastreada pelo pixel:

     delivery E        R$ 735,84  ·  442 ped  ·  R$36.462  ·  49,55x
     delivery D        R$1.113,90 ·  466 ped  ·  R$38.792  ·  34,83x
     delivery F        R$ 900,94  ·  235 ped  ·  R$14.136  ·  15,69x
     delivery G        R$ 282,53  ·   71 ped  ·  R$ 4.143  ·  14,67x
     delivery H        R$ 265,38  ·   42 ped  ·  R$ 3.811  ·  14,36x
     delivery C        R$ 319,22  ·   41 ped  ·  R$ 3.702  ·  11,60x
     delivery A        R$ 313,04  ·   21 ped  ·  R$ 3.413  ·  10,90x

   São R$110 mil de receita medida que o relatório não mostra. E o ROAS
   passou a doer mais agora: com a migration 42, custo e retorno saem da
   campanha que gera o resultado. Na conta delivery A o retorno isolado é 15,50x
   contra 10,90 diluído — exatamente o número que o cliente não tem como
   ver, e que ele estima de cabeça pelo caminho errado.

   POR QUE OS DOIS, e não só o ROAS. Na Elo Marketing, de onde este
   ajuste vem, o template de delivery já tinha `revenue` e faltava só o
   `roas`. Aqui faltam os dois, e ROAS sem receita ao lado é um múltiplo
   sem a grandeza que ele multiplica: "34,83x" não diz quanto entrou. Os
   dois são lidos juntos — quanto voltou, e quantas vezes o
   investimento — e é assim que o template de e-commerce já os ordena.

   ONDE ENTRAM NA ORDEM: logo depois de `spend`, espelhando o
   e-commerce (`spend, revenue, roas, results, cpa, aov`).

   PRESERVA CUSTOMIZAÇÃO. O `update` insere na posição em vez de
   reescrever a lista inteira: quem tiver ajustado as métricas deste
   template pela tela (Relatórios → Templates) não perde o ajuste. O
   `where` com `not (... = any(metrics))` torna a migration idempotente,
   e o `case` cobre o template que já tenha `revenue` mas não `roas` —
   senão a receita entraria duas vezes na lista de quem já a adicionou
   pela tela.

   Está aqui como migration, e não como um clique na tela, porque
   mudança feita só pelo painel deixa o repositório em desacordo com o
   banco — e um banco que discorda do repositório em silêncio é o pior
   modo de falhar que este sistema tem.
   ===================================================================== */

update public.report_templates
   set metrics =
         metrics[1 : coalesce(array_position(metrics, 'spend'), 0)]
         || case when 'revenue' = any (metrics)
                 then array[]::text[]
                 else array['revenue'] end
         || array['roas']
         || metrics[coalesce(array_position(metrics, 'spend'), 0) + 1
                    : array_length(metrics, 1)]
 where segment = 'delivery'
   and not ('roas' = any (metrics));

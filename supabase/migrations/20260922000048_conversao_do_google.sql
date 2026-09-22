/* =====================================================================
   A coluna de conversão passa a servir às DUAS plataformas
   ---------------------------------------------------------------------
   `conversion_action_type` nasceu para a Meta e o comentário dizia isso:
   "action_type da Graph API". Agora o Google grava aqui também, no
   vocabulário dele — ids de ação de conversão separados por vírgula.

   Não são dois conceitos disputando uma coluna: a linha é por
   (cliente, plataforma), então cada uma guarda o seu na sua linha. O que
   muda é só a leitura, que precisa saber de qual plataforma é a linha
   antes de interpretar o valor. Quem faz isso é `sync.ts`.

   POR QUE O GOOGLE PRECISOU DISSO. `metrics.conversions` soma todas as
   ações marcadas como PRINCIPAIS na conta, e "principal" é a
   configuração feita para o Google otimizar o lance — não para o
   relatório. Medido na conta Biank Imóveis em 21/09/2026: R$ 242,81 de
   investimento e 3.203 conversões, porque "Visualização de página"
   estava como principal junto de Engajamento e Ver rota. O painel do
   cliente mostrou 3.289 leads onde existiam 86, e a meta do mês marcou
   1.630%.

   Corrigir isso na conta do Google resolveria o número e MEXERIA NO
   LANCE das campanhas. Escolher aqui separa as duas decisões.

   Só comentário: nenhuma estrutura muda, nada a reverter.
   ===================================================================== */

comment on column public.client_integrations.conversion_action_type is
  'O que conta como conversão, no vocabulário da plataforma da linha. '
  'meta_ads: action_type da Graph API (NULL = padrão do segmento do cliente). '
  'google_ads: ids de ação de conversão separados por vírgula '
  '(NULL = metrics.conversions, ou seja, todas as principais da conta).';

/* =====================================================================
   Vencimento do token, visível para a interface
   ---------------------------------------------------------------------
   O token longo da Meta dura ~60 dias e não se renovava sozinho. O
   sintoma do vencimento é silencioso: o sync passa a devolver
   `auth_expired`, o relatório do cliente sai vazio, e nada na tela diz
   que a causa é uma autorização vencida.

   A data já existe — em `integration_secrets.expires_at`. O problema é
   que aquela tabela tem RLS ligada e ZERO policies de propósito: só
   `service_role` a alcança, e `getClientIntegrations` registra por
   escrito que nunca a lê. Expor o vencimento por lá exigiria trazer a
   leitura de segredo para o caminho da interface, que é exatamente o
   que aquele desenho impede.

   Então a data é ESPELHADA aqui. `client_integrations` já é a tabela
   que a aplicação lê sob RLS, e o vencimento não é segredo: saber
   QUANDO uma autorização expira não ajuda ninguém a usá-la.

   Quem escreve são os dois pontos que já gravam token: o callback do
   OAuth e o job de renovação. A fonte da verdade continua sendo
   `integration_secrets`; esta coluna é uma cópia para leitura.
   ===================================================================== */

alter table public.client_integrations
  add column if not exists token_expires_at timestamptz;

comment on column public.client_integrations.token_expires_at is
  'Cópia legível de integration_secrets.expires_at, para a interface avisar antes de vencer sem tocar na tabela de segredos. NULL = sem prazo conhecido (o refresh token do Google não expira).';

/* O job varre por vencimento próximo todo dia. Índice parcial porque a
   maioria das linhas não tem prazo (Google) ou está longe de vencer. */
create index if not exists client_integrations_token_expiry_idx
  on public.client_integrations (token_expires_at)
  where token_expires_at is not null;

/* Preenche o que já existe, para o aviso valer desde o primeiro dia em
   vez de só nas autorizações futuras. */
update public.client_integrations ci
   set token_expires_at = s.expires_at
  from public.integration_secrets s
 where s.integration_id = ci.id
   and s.expires_at is not null
   and ci.token_expires_at is null;

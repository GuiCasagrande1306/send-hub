/* =====================================================================
   O link que o cliente abre sem senha
   ---------------------------------------------------------------------
   O cliente recebe PDF uma vez por mês e não tem como olhar o
   desempenho no meio do caminho. Quem quer ver hoje precisa pedir para
   alguém da agência gerar um relatório — e a agência vira intermediária
   de uma pergunta que o próprio dado responde.

   Este é o endereço de uma tela pública, por cliente, que ele guarda
   nos favoritos e abre quando quiser, escolhendo o período.

   ⚠️ UM LINK É UMA CREDENCIAL, e esta em particular abre investimento,
   receita e campanhas de uma conta. As decisões abaixo saem daí:

   TOKEN LONGO E ALEATÓRIO, não o id do cliente. São 256 bits de
   `randomBytes` — não se adivinha, não se enumera, e não revela nada
   sobre a conta. O UUID do cliente serviria tecnicamente e seria um
   erro: ele aparece em URL de painel, em log e em export, e passaria a
   valer como senha em todos esses lugares.

   REVOGÁVEL, e é por isso que a tabela existe em vez de um HMAC. Um
   token assinado não tem como ser cancelado antes de vencer — se
   vazasse num grupo de WhatsApp, a única saída seria trocar o segredo e
   derrubar todos os outros links junto. Aqui, `is_active = false`
   fecha um sem tocar nos demais.

   SEM VALIDADE POR PADRÃO, de propósito. Link que vence sozinho vira
   chamado de suporte todo mês e ensina o cliente a não confiar no
   endereço. Quem precisa fechar, revoga.

   UM ATIVO POR CLIENTE. O índice parcial garante: emitir de novo exige
   revogar o anterior, então não existe a situação de dois links vivos e
   ninguém sabendo qual foi para quem.

   `last_seen_at` NÃO É ANALYTICS. Serve para uma pergunta operacional:
   "esse cliente chegou a usar o link?" — e para a inversa, que é a que
   importa em revisão de segurança: um link que ninguém abre há meses é
   um link para revogar.
   ===================================================================== */

create table if not exists public.client_share_links (
  id uuid primary key default gen_random_uuid(),

  client_id uuid not null
    references public.clients (id) on delete cascade,

  /* 32 bytes (256 bits) em base64url, SORTEADO NA APLICAÇÃO.
     ---------------------------------------------------------------
     Sem `default`, e a ausência é deliberada. O caminho natural seria
     `gen_random_bytes(32)`, mas ela vive no pgcrypto, que não está no
     search_path deste banco. A alternativa em SQL puro seria `random()`,
     e essa NÃO serve: o gerador do Postgres é pseudoaleatório e
     previsível a partir da semente — para um valor que funciona como
     senha, é o mesmo que não sortear.

     Quem emite é `criarLinkPublico`, com `randomBytes` do Node, que é
     CSPRNG. O `not null` obriga quem inserir a trazer o valor, e o
     `unique` fecha a porta de uma colisão passar batido.

     BASE64URL e não base64: `+`, `/` e `=` têm significado em URL — a
     barra viraria separador de caminho e o link quebraria. */
  token text not null unique
    constraint client_share_links_token_tamanho
      check (char_length(token) >= 32),

  is_active  boolean not null default true,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,

  /* Última vez que o link foi aberto. Ver a nota no cabeçalho. */
  last_seen_at timestamptz,

  /* Coerência entre as duas colunas: revogado tem data, ativo não tem.
     Sem isto, um `is_active = false` sem `revoked_at` deixaria a tela
     sem como dizer QUANDO o acesso foi fechado. */
  constraint client_share_links_revogacao_coerente
    check ((is_active and revoked_at is null)
        or (not is_active and revoked_at is not null))
);

/* UM ATIVO POR CLIENTE. Parcial, porque os revogados ficam no histórico
   — é o registro de que aquele endereço já existiu e quando morreu. */
create unique index if not exists client_share_links_um_ativo
  on public.client_share_links (client_id)
  where is_active;

create index if not exists client_share_links_token_idx
  on public.client_share_links (token)
  where is_active;

comment on table public.client_share_links is
  'Endereço público do painel de um cliente. Um ativo por conta; revogar é desligar is_active.';

alter table public.client_share_links enable row level security;

/* LEITURA para a equipe autenticada: quem atende a conta precisa ver se
   existe link e copiá-lo. A página pública NÃO passa por aqui — ela lê
   com service_role, porque não há sessão do outro lado. */
drop policy if exists "client_share_links_leitura" on public.client_share_links;
create policy "client_share_links_leitura"
  on public.client_share_links for select
  to authenticated
  using (true);

/* ESCRITA só para admin: emitir é abrir os números de um cliente para
   quem tiver o endereço, e revogar é cortar o acesso dele. Nenhuma das
   duas é decisão de quem está operando hoje. */
drop policy if exists "client_share_links_escrita" on public.client_share_links;
create policy "client_share_links_escrita"
  on public.client_share_links for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

grant select on public.client_share_links to authenticated;
grant insert, update on public.client_share_links to authenticated;

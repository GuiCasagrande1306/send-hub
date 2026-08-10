/* =====================================================================
   Upload de logo do cliente: alinhar com quem pode EDITAR o cliente
   ---------------------------------------------------------------------
   `storage_brand_write` (20260803000003:71) nasceu autorizando por
   `app.can_write_client()`, que exige ser admin, ser `owner_id` do
   cliente, ou ter linha `editor`/`manager` em `client_members`.

   A migration 24 já tinha trocado `clients_update` para
   `app.client_is_visible(id)`, com a justificativa registrada lá: a
   tabela `client_members` segue vazia e nada no sistema escreve nela —
   a RPC de cadastro grava apenas `owner_id = auth.uid()`. A policy do
   Storage ficou para trás e as duas divergiram.

   O resultado é uma falha silenciosa e confusa: o colaborador abre o
   cliente, troca a cor da marca e a logo, salva — os campos de texto
   gravam, porque `clients_update` deixa, e só o upload é recusado pelo
   Storage. A tela informa sucesso e a logo não muda.

   Aqui as duas passam a usar a mesma regra. O bucket `brand` é público
   para leitura de qualquer jeito (20260803000003:50), então isto não
   amplia exposição de dado — só de quem pode escrever, e para o mesmo
   conjunto que já podia editar o registro do cliente.
   ===================================================================== */

drop policy if exists "storage_brand_write" on storage.objects;

create policy "storage_brand_write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand'
    and app.client_is_visible(nullif(split_part(name, '/', 1), '')::uuid)
  );

/* Trocar a logo é sobrescrever o mesmo caminho: sem UPDATE e DELETE a
   segunda troca falha com "duplicate", e a primeira nunca é limpa. */
drop policy if exists "storage_brand_update" on storage.objects;

create policy "storage_brand_update" on storage.objects for update to authenticated
  using (
    bucket_id = 'brand'
    and app.client_is_visible(nullif(split_part(name, '/', 1), '')::uuid)
  );

drop policy if exists "storage_brand_delete" on storage.objects;

create policy "storage_brand_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'brand'
    and app.client_is_visible(nullif(split_part(name, '/', 1), '')::uuid)
  );

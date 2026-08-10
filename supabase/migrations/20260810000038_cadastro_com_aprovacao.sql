/* =====================================================================
   Cadastro aberto, acesso aprovado
   ---------------------------------------------------------------------
   O produto passa a ter tela de cadastro. Sem esta migration isso
   significaria que qualquer pessoa que descobrisse a URL entraria com
   acesso de colaborador — e `clients_select` é `using (true)` desde a
   migration 10, então "colaborador" já enxerga a carteira inteira, as
   métricas, as tarefas e o e-mail de todo o time.

   A troca é: quem se cadastra entra na fila em vez de entrar no sistema.
   `is_active = false` faz `getAccessState()` devolver "negado" e a
   pessoa para em /sem-acesso, sem carregar dado nenhum, até um admin
   liberar em Configurações → Equipe.

   A PRIMEIRA conta é a exceção, e continua sendo: numa instalação nova
   não existe admin para aprovar ninguém, então quem chega primeiro é o
   dono — ativo e administrador. É por isso que a primeira coisa a fazer
   depois de publicar é criar a própria conta, antes de divulgar a URL.

   O `pg_advisory_xact_lock` fecha uma corrida real: dois cadastros
   simultâneos numa base vazia liam `profiles` vazia ao mesmo tempo e
   viravam DOIS admins. O lock é por transação e some sozinho no commit;
   o custo é desprezível num insert que acontece uma vez por pessoa.

   `guard_profile_privileges` (migration 02) já impede que um
   colaborador reescreva o próprio `is_active` — a aprovação só sai pela
   mão de um admin, mesmo que alguém chame a Server Action por fora da
   tela.
   ===================================================================== */

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_primeiro boolean;
begin
  perform pg_advisory_xact_lock(hashtext('app.handle_new_user'));

  v_primeiro := not exists (select 1 from public.profiles);

  insert into public.profiles (id, email, full_name, avatar_url, role, is_active)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    case when v_primeiro then 'admin' else 'collaborator' end::public.user_role,
    v_primeiro
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function app.handle_new_user() is
  'Primeira conta da instalação vira admin ativo; as demais nascem colaboradoras e INATIVAS, aguardando liberação em Configurações → Equipe.';

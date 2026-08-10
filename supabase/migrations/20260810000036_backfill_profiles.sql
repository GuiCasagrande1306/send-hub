/* =====================================================================
   Perfil para quem já existia em auth.users antes deste esquema
   ---------------------------------------------------------------------
   `app.handle_new_user()` só cobre inserts que acontecem DEPOIS de o
   trigger existir — ou seja, depois desta migration ter rodado uma vez.
   Numa instalação nova a ordem plausível é a inversa: provisiona-se o
   projeto no painel, cria-se o próprio usuário na primeira tela que
   aparece (Authentication → Users) e só então roda-se o `db push`.
   Nesse caminho a linha em `auth.users` existe e a de `profiles` nunca
   é criada.

   O sintoma não é um erro legível — é o painel inteiro inacessível: a
   sessão é válida, o perfil não existe, e o app não tem o que carregar.
   Pior, não há conserto pela interface: a única policy de insert em
   `profiles` é `profiles_admin_all`, que exige `app.is_admin()`, que
   exige o perfil que falta. Recuperação só por SQL.

   Custa uma varredura numa tabela pequena, uma vez. Vale o seguro.

   O papel segue a MESMA regra do trigger — primeira linha vira admin —
   e o `order by created_at` garante que, havendo mais de um usuário
   órfão, o admin caia no mais antigo, que é o dono da conta.
   ===================================================================== */

insert into public.profiles (id, email, full_name, role)
select
  u.id,
  u.email,
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    split_part(u.email, '@', 1)
  ),
  case
    when exists (select 1 from public.profiles) then 'collaborator'
    else 'admin'
  end::public.user_role
from auth.users u
where u.email is not null
order by u.created_at
on conflict (id) do nothing;

/* =====================================================================
   Contrato de AGÊNCIA — quem paga é a agência, não o cliente dela
   ---------------------------------------------------------------------
   Parte da carteira é terceirizada: a agência parceira fecha o
   contrato com o cliente final e a Send opera a mídia.

   A Send não cobra desses clientes. Cobra da agência parceira, um valor
   só por parceria, e é assim que o dinheiro entra de fato. Pedir
   honorário e dia de vencimento cliente a cliente para eles é pedir um
   número que não existe — e a tela de Recorrência acabaria listando
   para faturar muito mais linhas do que as cobranças reais.

   POR QUE UMA TABELA NOVA, e não uma linha em `client_financials`

   Aquela tabela é chaveada por `client_id` e uma agência não é cliente.
   Inventar um cliente-fantasma com o nome da parceira para segurar o honorário
   contaminaria toda leitura da carteira: entraria na contagem de contas
   ativas, na Performance, nos alertas de saldo e no seletor de
   relatórios — em troca de não criar seis linhas de DDL.

   `agency` é TEXTO e chave primária, espelhando `clients.agency_partner`,
   que também é texto livre validado no app (`AGENCY_PARTNERS`). Uma FK
   exigiria uma tabela de agências que hoje não existe; quando existir,
   esta chave vira a coluna referenciada sem migração de dados.
   ===================================================================== */

create table if not exists public.agency_contracts (
  agency            text primary key,

  /* Centavos, como todo dinheiro do sistema. Zero é válido e significa
     "combinado ainda não fechado" — o job pula, como faz com cliente
     direto sem honorário. */
  monthly_fee_cents bigint not null default 0 check (monthly_fee_cents >= 0),

  /* 1 a 28 pela mesma razão de `client_financials.billing_day` e do
     `report_day`: fevereiro existe. NULL = sem cobrança recorrente. */
  billing_day       smallint,

  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$
begin
  alter table public.agency_contracts
    add constraint agency_contracts_billing_day_valid
    check (billing_day is null or billing_day between 1 and 28);
exception
  when duplicate_object then null;
end $$;

comment on table public.agency_contracts is
  'Honorário cobrado DA AGÊNCIA parceira, valor único que cobre todos os clientes dela. Cliente terceirizado não gera cobrança própria.';

do $$
begin
  create trigger trg_agency_contracts_touch
    before update on public.agency_contracts
    for each row execute function app.touch_updated_at();
exception
  when duplicate_object then null;
end $$;


/* ---------------------------------------------------------------------
   Acesso — financeiro é admin, como o resto do módulo

   GRANT ANTES DA POLICY. Sexta vez neste projeto: o Postgres checa
   privilégio de tabela antes de avaliar a policy, e sem o grant a
   consulta volta vazia ou com 42501 — sem a policy sequer rodar.
   Ver as migrations 17, 18, 26, 29 e 30.
   ------------------------------------------------------------------ */

alter table public.agency_contracts enable row level security;

grant select, insert, update, delete on public.agency_contracts to authenticated;

drop policy if exists agency_contracts_admin on public.agency_contracts;

create policy agency_contracts_admin on public.agency_contracts
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());


/* ---------------------------------------------------------------------
   Semear as agências que já existem na carteira

   Sem valor e sem dia: o número é combinado comercial e ninguém
   inventa por elas. As linhas existem para a tela ter o que listar, com
   os campos pedindo preenchimento — o mesmo estado em que os clientes
   diretos já estão.
   ------------------------------------------------------------------ */

insert into public.agency_contracts (agency)
select distinct c.agency_partner
  from public.clients c
 where c.agency_partner is not null
   and c.agency_partner <> 'Agência Send'
on conflict (agency) do nothing;


/* ---------------------------------------------------------------------
   Idempotência do job, agora com duas origens

   `recurrence_key` já é única em `financial_transactions` (migration
   29). O job passa a emitir também `agencia:<nome>:2026-09`, que não
   colide com `cliente:<uuid>:...` nem com `despesa:<uuid>:...` porque o
   prefixo faz parte da chave.
   ------------------------------------------------------------------ */

comment on column public.financial_transactions.recurrence_key is
  'Origem + mês: cliente:<uuid>:2026-09, agencia:<nome>:2026-09 ou despesa:<uuid>:2026-09. Único: impede o job de cobrar duas vezes.';

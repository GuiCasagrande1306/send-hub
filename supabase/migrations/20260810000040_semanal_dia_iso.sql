/* =====================================================================
   Corrige a convenção de dia da semana do resumo semanal
   ---------------------------------------------------------------------
   A migration 39 gravou `weekly_report_weekday` como 0..6 com domingo=0,
   copiando o retorno de `diaDaSemanaNoBrasil()`. Errado pelo lugar: a
   coluna irmã `clients.optimization_day` (migration 14) é 1..5 com
   1=segunda, e duas convenções de dia da semana na MESMA tabela é a
   divergência que ninguém percebe até o envio sair no dia errado.

   Aqui vale 1..7 ISO (1=segunda … 7=domingo). A conversão do helper
   acontece no código, uma vez (`dia === 0 ? 7 : dia`), e não espalhada
   por cada leitura.

   DROP e não UPDATE porque a coluna nasceu há minutos, na mesma sessão,
   e a tabela `clients` está vazia — conferido antes de escrever isto.
   Num banco com carteira, isto seria um `update` mapeando 0→7 e um
   `alter constraint`, jamais um drop.

   O nome também muda: `weekly_report_day` entra na família de
   `report_day` e `optimization_day`, em vez de inventar um sufixo novo.
   ===================================================================== */

drop index if exists clients_weekly_report_idx;

alter table public.clients
  drop constraint if exists clients_weekly_report_weekday_check;

alter table public.clients
  drop column if exists weekly_report_weekday;

alter table public.clients
  add column if not exists weekly_report_day smallint not null default 1;

alter table public.clients
  drop constraint if exists clients_weekly_report_day_valid;

alter table public.clients
  add constraint clients_weekly_report_day_valid
  check (weekly_report_day between 1 and 7);

comment on column public.clients.weekly_report_day is
  'Dia do envio do resumo semanal: 1=segunda … 7=domingo (ISO, igual a optimization_day). O período é sempre os 7 dias fechados que terminaram na véspera.';

create index if not exists clients_weekly_report_day_idx
  on public.clients (weekly_report_day)
  where weekly_report_enabled;


/* ---------------------------------------------------------------------
   Que tipo de relatório é esta linha do histórico
   ---------------------------------------------------------------------
   A linha semanal nasce sem `storage_path` — o esquema já aceita, todas
   as colunas de arquivo são nullable desde a migration 01. O problema é
   a TELA: a fila de /relatorios lista por status e oferece o botão do
   caminho de PDF. Sem uma coluna que diga o que a linha é, a pessoa
   clica em "Conferir PDF" onde não existe PDF.

   `default 'monthly'` para que todo o histórico anterior continue sendo
   exatamente o que era.
   ------------------------------------------------------------------ */
alter table public.report_history
  add column if not exists kind text not null default 'monthly';

alter table public.report_history
  drop constraint if exists report_history_kind_valid;

alter table public.report_history
  add constraint report_history_kind_valid
  check (kind in ('monthly', 'weekly'));

comment on column public.report_history.kind is
  'monthly = PDF do fechamento. weekly = resumo de texto por WhatsApp, sem anexo.';

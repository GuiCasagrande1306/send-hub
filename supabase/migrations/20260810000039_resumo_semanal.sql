/* =====================================================================
   Resumo semanal por WhatsApp — agendamento por cliente
   ---------------------------------------------------------------------
   O relatório em PDF continua mensal, governado por `report_day` e
   `report_enabled`. O que entra aqui é uma segunda cadência, de texto:
   sete dias fechados, sem anexo.

   DUAS COLUNAS NOVAS E NÃO UMA. Seria tentador reaproveitar
   `report_enabled` para os dois — e seria errado: existe cliente que
   quer o acompanhamento semanal e não quer o PDF, e o contrário
   também. Um interruptor só obrigaria a escolher entre nunca mandar
   nada ou mandar as duas coisas.

   O DIA DA SEMANA É 0-6, DOMINGO=0. É a convenção de
   `diaDaSemanaNoBrasil()` em `src/lib/date-br.ts`, que já resolve o
   fuso — e é de onde a comparação vai sair. Guardar 1-7 aqui criaria um
   +1 espalhado por cada leitura, que é exatamente o tipo de conversão
   que alguém esquece num lugar só.

   NULL É ESTADO VÁLIDO: cliente com o semanal desligado não precisa ter
   dia escolhido. O default 1 (segunda) vale para quem ligar sem
   escolher, porque segunda é a semana fechada — de segunda a domingo,
   como no pedido que originou isto.
   ===================================================================== */

alter table public.clients
  add column if not exists weekly_report_enabled boolean not null default false,
  add column if not exists weekly_report_weekday smallint not null default 1;

alter table public.clients
  drop constraint if exists clients_weekly_report_weekday_check;

alter table public.clients
  add constraint clients_weekly_report_weekday_check
  check (weekly_report_weekday between 0 and 6);

comment on column public.clients.weekly_report_enabled is
  'Resumo semanal em texto por WhatsApp. Independente de report_enabled, que governa o PDF mensal.';

comment on column public.clients.weekly_report_weekday is
  'Dia do envio do resumo semanal. 0=domingo … 6=sábado, mesma convenção de diaDaSemanaNoBrasil(). O período é sempre os 7 dias fechados que terminaram na véspera.';

/* O cron varre por dia da semana toda manhã. Sem índice é varredura de
   tabela — barata numa carteira pequena, e o índice é barato também. */
create index if not exists clients_weekly_report_idx
  on public.clients (weekly_report_weekday)
  where weekly_report_enabled;

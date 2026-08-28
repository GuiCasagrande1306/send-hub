/* =====================================================================
   Relatório travado deixa de bloquear a retentativa para sempre
   ---------------------------------------------------------------------
   O DEFEITO. `report_history_automated_unique` é único por
   (cliente, período) para toda linha automática — SEM olhar o status. A
   linha nasce em 'queued' antes de o PDF existir, então basta a função
   ser cortada no meio para sobrar uma linha em 'queued', 'generating'
   ou 'sending' que nunca vira nada e que passa a recusar, pelo índice,
   qualquer nova tentativa daquele período.

   O cliente não recebe o relatório daquele mês. Nunca. E a única pista
   é uma linha com status parado numa tabela que ninguém abre.

   AINDA NÃO ACONTECEU AQUI, e é honesto dizer: medido em 28/08/2026, a
   `report_history` da Send tem 2 linhas, as duas em 'ready', nenhuma
   travada. O módulo é novo. Isto é armadilha armada, não incêndio — e o
   custo de desarmar agora é uma migration, contra "o cliente nunca mais
   recebe" depois.

   A CORREÇÃO É EM DOIS TEMPOS, e este arquivo é o primeiro:

   1. O índice passa a IGNORAR linhas em 'failed'. Uma tentativa que
      falhou fica registrada — é o que responde "por que o cliente não
      recebeu?" — mas deixa de trancar a porta.

   2. `dispatchScheduledReports` marca como 'failed' toda linha
      automática presa há mais de 15 minutos, antes de começar a rodada.
      Sem esse passo o índice novo não ajuda: a linha continuaria em
      'generating', que segue sendo um status que o índice enxerga.

   POR QUE NÃO APAGAR A LINHA TRAVADA. Seria mais simples e apaga a
   única evidência de que houve tentativa. Um relatório que não chegou é
   pergunta de cliente, e "não há registro" é a pior resposta possível.

   POR QUE 'failed' E NÃO UM STATUS NOVO. 'failed' já existe, a tela já
   sabe desenhá-lo e a fila já o lista. Um 'expired' exigiria tocar em
   todos esses lugares para dizer a mesma coisa: não foi entregue.

   ⚠️ A LINHA PRESA EM 'sending' É DIFERENTE das outras duas, e o
   `error_message` guarda essa diferença. 'queued' e 'generating' são
   inequívocos: o PDF não existe, nada saiu. 'sending' foi cortado entre
   reservar a linha e ouvir a resposta da Evolution — a mensagem PODE
   ter chegado. Por isso a marca de texto, que a fila reconhece para
   continuar oferecendo "Chegou / Não chegou" em vez de um "Enviar" que
   convidaria ao envio em dobro no grupo do cliente.
   ===================================================================== */

drop index if exists report_history_automated_unique;

create unique index if not exists report_history_automated_unique
  on public.report_history (client_id, period_start, period_end)
  where is_automated and status <> 'failed';

comment on index public.report_history_automated_unique is
  'Impede envio automático duplicado do mesmo período. IGNORA linhas failed: tentativa que falhou fica no histórico sem trancar a retentativa.';

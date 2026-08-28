/* =====================================================================
   A mensagem que acompanha o relatório, editável
   ---------------------------------------------------------------------
   O texto vive no código, montado em `buildGroupCaption`. Mudar a voz
   com que a agência fala com o cliente exige deploy, e o resultado
   previsível é que ninguém muda: a mensagem que sai hoje é a que
   alguém escreveu uma vez.

   E ELA ESTÁ ERRADA HOJE. A legenda diz "Investimos X e geramos Y
   resultados a um custo de Z cada", com X e Y da CONTA INTEIRA e Z da
   CAMPANHA DE ORIGEM — desde a migration 42. Os três números não fecham
   entre si, e quem confere na calculadora acha outro valor.

   MEDIDO NA CARTEIRA DA SEND em 28/08/2026, sobre as 20 contas ativas
   com investimento e resultado. Sete mandam uma legenda que não fecha:

     presença local A  diz R$22,60   ·  na mão dá R$48,83
     captação A        diz R$18,71   ·  na mão dá R$24,16
     delivery A        diz R$10,46   ·  na mão dá R$14,70
     delivery B        diz R$ 7,04   ·  na mão dá R$ 9,76
     delivery C        diz R$ 5,63   ·  na mão dá R$ 7,87
     delivery D        diz R$ 1,95   ·  na mão dá R$ 2,38
     captação B        diz R$15,78   ·  na mão dá R$17,30

   Dava para reconciliar dividindo tudo pelo mesmo denominador. Mas aí a
   legenda deixaria de fechar de outro jeito — imprimiria o custo certo
   sob um investimento que não o produziu. O PDF explica isso com o selo
   "de N campanhas"; um texto de WhatsApp não tem onde pôr nota de
   rodapé.

   Então a mensagem para de ter número. Ela anuncia o anexo e sai da
   frente. Uma legenda sem número não tem como discordar do documento
   que acompanha — a classe inteira de defeito deixa de existir, em vez
   de ser consertada de novo a cada métrica nova.

   ⚠️ ISTO NÃO TOCA O RESUMO SEMANAL. `weekly-message.ts` é outra coisa:
   texto sem anexo, com os números que o cliente pediu para ver, e sem
   PDF ao lado para discordar dele. Ele continua como está.

   UMA LINHA SÓ: `check (id)` sobre um boolean com default `true`, então
   a chave primária só aceita `true` e a segunda inserção colide. Duas
   linhas de configuração e nenhuma forma de saber qual vale é pior que
   configuração nenhuma.
   ===================================================================== */

create table if not exists public.report_message_settings (
  id boolean primary key default true check (id),

  /* O texto com os marcadores. NOT NULL: a ausência de mensagem não é
     um estado válido — o relatório sempre sai com legenda. Para voltar
     ao texto de fábrica a interface reescreve o padrão, não apaga. */
  template text not null,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,

  /* 900 e não 1024: o WhatsApp corta a legenda em 1024 caracteres, e a
     substituição de `{periodo}` CRESCE o texto — "de 1 – 26 de agosto
     de 2026" tem 25 caracteres onde o marcador tinha 9. A folga evita
     que uma mensagem salva sem aviso chegue truncada no meio de uma
     frase. Vazio também não passa. */
  constraint report_message_template_tamanho
    check (char_length(btrim(template)) between 1 and 900)
);

comment on table public.report_message_settings is
  'A legenda enviada junto do PDF. Uma linha só. Marcadores: {periodo} e {cliente}.';

comment on column public.report_message_settings.template is
  'Texto com marcadores. {periodo} vira "dos últimos 7 dias" ou a data; {cliente} vira o nome da conta.';

alter table public.report_message_settings enable row level security;

/* LEITURA para qualquer autenticado: a estação de comando mostra a
   mensagem enquanto a pessoa confere o relatório, e esconder o texto de
   quem despacha não protegeria nada. */
drop policy if exists "report_message_settings_leitura" on public.report_message_settings;
create policy "report_message_settings_leitura"
  on public.report_message_settings for select
  to authenticated
  using (true);

/* ESCRITA só para admin, como os templates: é a voz da agência com o
   cliente final, não uma preferência de quem está operando hoje. */
drop policy if exists "report_message_settings_escrita" on public.report_message_settings;
create policy "report_message_settings_escrita"
  on public.report_message_settings for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

/* ⚠️ GRANT, e não só policy. Sem ele o Postgres recusa antes de avaliar
   a policy, com 42501, e a tela mostra "permissão negada" para um
   admin. */
grant select on public.report_message_settings to authenticated;
grant insert, update on public.report_message_settings to authenticated;

/* A linha nasce com o texto de fábrica. A tela precisa de algo para
   editar, e um `upsert` que cria na primeira gravação esconderia da
   leitura o fato de que a configuração já existe. */
insert into public.report_message_settings (id, template)
values (
  true,
  'Olá! Aqui está o nosso relatório de performance {periodo}.

Qualquer dúvida, é só chamar por aqui.'
)
on conflict (id) do nothing;

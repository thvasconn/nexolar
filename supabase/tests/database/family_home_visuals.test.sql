-- Contrato e isolamento dos dados do mockup do JV. Tudo roda em transação e é revertido.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Simula o contexto usado pela API do Storage ao remover metadados.
-- Só afeta esta transação: não há arquivos reais e o RLS continua ativo.
set local storage.allow_delete_query = 'true';

create temp table visual_ids (k text primary key, v uuid);
create temp table visual_tokens (k text primary key, t text);
grant select, insert on visual_ids, visual_tokens to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-00000000000a', 'visual-ana@teste.dev', '{"full_name":"Ana"}'),
  ('10000000-0000-0000-0000-00000000000b', 'visual-bob@teste.dev', '{"full_name":"Bob"}'),
  ('10000000-0000-0000-0000-00000000000c', 'visual-carla@teste.dev', '{"full_name":"Carla"}'),
  ('10000000-0000-0000-0000-00000000000d', 'visual-dani@teste.dev', '{"full_name":"Dani"}');
insert into public.user_entitlements (user_id, premium_until, source)
values ('10000000-0000-0000-0000-00000000000a', now() + interval '30 days', 'trial');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into visual_ids values ('family', public.create_family('Casa visual'));
insert into visual_tokens values ('family', public.create_family_invite((select v from visual_ids where k = 'family')));
insert into public.family_members (family_id, display_name, kind) values
  ((select v from visual_ids where k = 'family'), 'Vovó', 'person'),
  ((select v from visual_ids where k = 'family'), 'Rex', 'pet');
insert into visual_ids select 'managed', id from public.family_members where display_name = 'Vovó';
insert into visual_ids select 'pet', id from public.family_members where display_name = 'Rex';
insert into visual_ids select 'owner', id from public.family_members where user_id = auth.uid();
insert into public.events (family_id, title, starts_at) values
  ((select v from visual_ids where k = 'family'), 'Aniversário', now() + interval '1 day'),
  ((select v from visual_ids where k = 'family'), 'Jantar', now() + interval '2 days');
insert into visual_ids select 'event', id from public.events where title = 'Aniversário';
insert into visual_ids select 'second_event', id from public.events where title = 'Jantar';
insert into public.event_participants (event_id, display_name, guest_email)
values ((select v from visual_ids where k = 'event'), 'Carla', 'visual-carla@teste.dev');
insert into visual_tokens select 'event', public.create_event_invite(id) from public.event_participants;
insert into public.family_notices (family_id, body) values
  ((select v from visual_ids where k = 'family'), 'Acabou o café'),
  ((select v from visual_ids where k = 'family'), 'Sem reações');
insert into visual_ids select 'notice', id from public.family_notices where body = 'Acabou o café';
insert into visual_ids select 'empty_notice', id from public.family_notices where body = 'Sem reações';

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select public.accept_family_invite((select t from visual_tokens where k = 'family'));

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
insert into visual_ids values ('foreign_family', public.create_family('Outra casa visual'));
insert into public.family_members (family_id, display_name)
values ((select v from visual_ids where k = 'foreign_family'), 'Outra avó');
insert into visual_ids select 'foreign_member', id from public.family_members where display_name = 'Outra avó';
insert into public.events (family_id, title, starts_at)
values ((select v from visual_ids where k = 'foreign_family'), 'Outro evento', now() + interval '3 days');
insert into visual_ids select 'foreign_event', id from public.events;
insert into public.family_notices (family_id, body)
values ((select v from visual_ids where k = 'foreign_family'), 'Outro recado');
insert into visual_ids select 'foreign_notice', id from public.family_notices;

-- ---------------------------------------------------------------------------
-- Reações: contagem, autoria, duplicidade, remoção e RLS da view.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select heart_count, like_count, hearted_by_me, liked_by_me from public.family_notice_reaction_counts
     where notice_id = (select v from visual_ids where k = 'empty_notice') $$,
  $$ values (0::bigint, 0::bigint, false, false) $$, 'recado sem reações retorna contadores zerados');
select lives_ok(
  $$ insert into public.family_notice_reactions (notice_id, reaction) values
     ((select v from visual_ids where k = 'notice'), 'heart'),
     ((select v from visual_ids where k = 'notice'), 'like') $$, 'pessoa pode reagir com os dois tipos');
select results_eq(
  $$ select heart_count, like_count, hearted_by_me, liked_by_me from public.family_notice_reaction_counts
     where notice_id = (select v from visual_ids where k = 'notice') $$,
  $$ values (1::bigint, 1::bigint, true, true) $$, 'contadores e marcações pessoais são calculados no banco');
select throws_ok(
  $$ insert into public.family_notice_reactions (notice_id, reaction)
     values ((select v from visual_ids where k = 'notice'), 'heart') $$,
  '23505', null, 'não duplica reação da mesma pessoa');
select throws_ok(
  $$ insert into public.family_notice_reactions (notice_id, reaction)
     values ((select v from visual_ids where k = 'notice'), 'invalid') $$,
  '23514', null, 'tipo de reação desconhecido é recusado');
select throws_ok(
  $$ insert into public.family_notice_reactions (notice_id, reaction, user_id)
     values ((select v from visual_ids where k = 'notice'), 'heart', '10000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'cliente não reage em nome de outra pessoa');
select throws_ok(
  $$ insert into public.family_notice_reactions (notice_id, reaction, created_at)
     values ((select v from visual_ids where k = 'empty_notice'), 'heart', now()) $$,
  '42501', null, 'cliente não escolhe data da reação');
select throws_ok($$ update public.family_notice_reactions set reaction = 'like' $$,
  '42501', null, 'reação é inserida ou removida, sem escrita arbitrária');
select throws_ok(
  $$ insert into public.family_notice_reactions (notice_id, reaction)
     values ((select v from visual_ids where k = 'foreign_notice'), 'heart') $$,
  '42501', null, 'não reage em recado de outra família');
select is_empty(
  $$ select * from public.family_notice_reaction_counts where family_id = (select v from visual_ids where k = 'foreign_family') $$,
  'view de contadores não vaza recados de outra família');

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select heart_count, like_count, hearted_by_me, liked_by_me from public.family_notice_reaction_counts
     where notice_id = (select v from visual_ids where k = 'notice') $$,
  $$ values (1::bigint, 1::bigint, false, false) $$, 'membro vê totais, marcação pessoal usa a sessão atual');
insert into public.family_notice_reactions (notice_id, reaction)
values ((select v from visual_ids where k = 'notice'), 'heart');
select is((select heart_count from public.family_notice_reaction_counts where notice_id = (select v from visual_ids where k = 'notice')),
  2::bigint, 'corações de pessoas diferentes somam');
delete from public.family_notice_reactions where user_id <> auth.uid();
select is((select like_count from public.family_notice_reaction_counts where notice_id = (select v from visual_ids where k = 'notice')),
  1::bigint, 'membro não apaga reação alheia');
delete from public.family_notice_reactions where user_id = auth.uid();
select results_eq(
  $$ select heart_count, hearted_by_me from public.family_notice_reaction_counts
     where notice_id = (select v from visual_ids where k = 'notice') $$,
  $$ values (1::bigint, false) $$, 'remover a própria reação atualiza contador e marcação');

-- ---------------------------------------------------------------------------
-- Categorias: validação e manutenção da privacidade/permissão de edição.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into public.calendar_items (family_id, title, starts_at)
values ((select v from visual_ids where k = 'family'), 'Sem categoria', now());
select is((select category from public.calendar_items where title = 'Sem categoria'), 'other', 'categoria padrão mantém inserts antigos funcionando');
select lives_ok(
  $$ insert into public.calendar_items (family_id, title, starts_at, category)
     select (select v from visual_ids where k = 'family'), c, now(), c
     from unnest(array['education', 'health', 'meal', 'work', 'sport', 'leisure', 'other']) c $$,
  'todas as categorias aceitas podem ser gravadas');
select throws_ok(
  $$ update public.calendar_items set category = 'invalid' where title = 'Sem categoria' $$,
  '23514', null, 'categoria desconhecida é recusada');
select throws_ok(
  $$ update public.calendar_items set category = null where title = 'Sem categoria' $$,
  '23502', null, 'categoria não pode ser nula');
update public.calendar_items set category = 'education' where title = 'Sem categoria';
select is((select category from public.calendar_items where title = 'Sem categoria'), 'education', 'dono edita a categoria');

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
update public.calendar_items set category = 'health' where title = 'Sem categoria';
select is((select category from public.calendar_items where title = 'Sem categoria'), 'education', 'outro membro não edita categoria de compromisso alheio');
insert into public.calendar_items (family_id, title, starts_at, category, visibility)
values ((select v from visual_ids where k = 'family'), 'Consulta privada', now(), 'health', 'private');

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select category from public.calendar_items where title = 'Consulta privada' $$,
  'admin não vê categoria nem dados de compromisso privado alheio');

-- ---------------------------------------------------------------------------
-- Capa e fotos: caminhos vinculados ao evento/membro; somente perfis sem login.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.events set cover_path = id::text || '/capa.jpg' where id = (select v from visual_ids where k = 'event') $$,
  'membro da família define caminho da capa');
select throws_ok(
  $$ update public.events set cover_path = (select v from visual_ids where k = 'second_event')::text || '/capa.jpg'
     where id = (select v from visual_ids where k = 'event') $$,
  '23514', null, 'evento não usa foto de outro evento, mesmo da mesma família');
select throws_ok(
  $$ update public.events set cover_path = 'https://example.com/public.jpg' where id = (select v from visual_ids where k = 'event') $$,
  '23514', null, 'capa exige caminho relativo do bucket privado');
select throws_ok(
  $$ update public.events set cover_path = id::text || '/' where id = (select v from visual_ids where k = 'event') $$,
  '23514', null, 'capa exige nome de arquivo');
select throws_ok(
  $$ update public.events set cover_path = id::text || '/' || repeat('x', 264) where id = (select v from visual_ids where k = 'event') $$,
  '23514', null, 'caminho da capa tem limite de tamanho');
select lives_ok(
  $$ update public.family_members set photo_path = id::text || '/foto.jpg' where user_id is null $$,
  'admin define foto de pessoa sem login e pet');
select throws_ok(
  $$ update public.family_members set photo_path = (select v from visual_ids where k = 'pet')::text || '/foto.jpg'
     where id = (select v from visual_ids where k = 'managed') $$,
  '23514', null, 'membro não aponta para pasta de outro membro');
select throws_ok(
  $$ update public.family_members set photo_path = id::text || '/foto.jpg' where id = (select v from visual_ids where k = 'owner') $$,
  '23514', null, 'admin não substitui avatar de quem tem login');
select throws_ok(
  $$ update public.family_members set photo_path = id::text || '/' where id = (select v from visual_ids where k = 'pet') $$,
  '23514', null, 'foto do membro exige nome de arquivo');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('event-photos', (select v from visual_ids where k = 'event')::text || '/capa.jpg'),
     ('event-photos', (select v from visual_ids where k = 'event')::text || '/rascunho.jpg'),
     ('event-photos', (select v from visual_ids where k = 'second_event')::text || '/capa.jpg'),
     ('member-photos', (select v from visual_ids where k = 'managed')::text || '/foto.jpg'),
     ('member-photos', (select v from visual_ids where k = 'pet')::text || '/foto.jpg') $$,
  'admin envia capas e fotos de perfis gerenciados');
select lives_ok(
  $$ update storage.objects set metadata = '{"mimetype":"image/jpeg"}' where bucket_id in ('event-photos', 'member-photos') $$,
  'admin pode atualizar arquivos dos dois buckets');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('member-photos', (select v from visual_ids where k = 'owner')::text || '/fake.jpg') $$,
  '42501', null, 'bucket de membros não aceita foto para usuário com login');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('event-photos', 'nao-e-uuid/foto.jpg') $$,
  '42501', null, 'pasta inválida de evento é negada sem erro de cast');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('member-photos', 'nao-e-uuid/foto.jpg') $$,
  '42501', null, 'pasta inválida de membro é negada sem erro de cast');
select throws_ok(
  $$ update storage.objects set name = (select v from visual_ids where k = 'foreign_event')::text || '/roubada.jpg'
     where bucket_id = 'event-photos' and name = (select v from visual_ids where k = 'event')::text || '/rascunho.jpg' $$,
  '42501', null, 'não move arquivo para evento de outra família');
select throws_ok(
  $$ update storage.objects set name = (select v from visual_ids where k = 'foreign_member')::text || '/roubada.jpg'
     where bucket_id = 'member-photos' and name = (select v from visual_ids where k = 'managed')::text || '/foto.jpg' $$,
  '42501', null, 'não move arquivo para membro de outra família');

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'member-photos'), 2::bigint, 'membro lê fotos de pessoas e pets da família');
select is((select count(*) from storage.objects where bucket_id = 'event-photos'), 3::bigint, 'membro lê arquivos dos eventos da família');
update public.family_members set photo_path = null where user_id is null;
select is((select count(*) from public.family_members where photo_path is not null), 2::bigint, 'membro comum não troca nem remove foto gerenciada');
update storage.objects set metadata = '{"blocked":true}' where bucket_id = 'member-photos';
delete from storage.objects where bucket_id = 'member-photos';
select is((select count(*) from storage.objects where bucket_id = 'member-photos'), 2::bigint, 'membro comum não apaga foto gerenciada');
select is_empty($$ select * from storage.objects where bucket_id = 'member-photos' and metadata ? 'blocked' $$,
  'membro comum não atualiza arquivo de foto gerenciada');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('member-photos', (select v from visual_ids where k = 'pet')::text || '/troca.jpg') $$,
  '42501', null, 'membro comum não envia foto de pet');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('event-photos', (select v from visual_ids where k = 'event')::text || '/nova.jpg') $$,
  'membro comum pode enviar capa de evento');
update public.events set cover_path = id::text || '/nova.jpg' where id = (select v from visual_ids where k = 'event');
select is((select cover_path from public.events where id = (select v from visual_ids where k = 'event')),
  (select v from visual_ids where k = 'event')::text || '/nova.jpg', 'membro comum pode trocar a capa');
update storage.objects set metadata = '{"mimetype":"image/png"}'
where bucket_id = 'event-photos' and name = (select v from visual_ids where k = 'event')::text || '/nova.jpg';
select is((select metadata ->> 'mimetype' from storage.objects where bucket_id = 'event-photos'
           and name = (select v from visual_ids where k = 'event')::text || '/nova.jpg'),
  'image/png', 'membro comum pode atualizar arquivo de capa');
delete from storage.objects where bucket_id = 'event-photos' and name = (select v from visual_ids where k = 'event')::text || '/rascunho.jpg';
select is_empty($$ select * from storage.objects where bucket_id = 'event-photos'
                  and name = (select v from visual_ids where k = 'event')::text || '/rascunho.jpg' $$,
  'membro pode remover arquivo de capa');

-- ---------------------------------------------------------------------------
-- Convidado externo: vê apenas a capa atual do evento que aceitou.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select * from storage.objects where bucket_id in ('event-photos', 'member-photos') $$,
  'convidado ainda não aceitou: não lê nenhuma foto');
select public.accept_event_invite((select t from visual_tokens where k = 'event'));
select results_eq(
  $$ select name from storage.objects where bucket_id = 'event-photos' $$,
  $$ select (select v from visual_ids where k = 'event')::text || '/nova.jpg' $$,
  'convidado vê só capa atual, sem capas antigas nem outros eventos');
select is_empty($$ select * from storage.objects where bucket_id = 'member-photos' $$,
  'convidado não vê fotos de membros nem pets');
select is_empty('select * from public.family_notice_reactions', 'convidado não vê reações da família');
select is_empty('select * from public.family_notice_reaction_counts', 'convidado não vê contadores nem recados');
select throws_ok(
  $$ insert into public.family_notice_reactions (notice_id, reaction) values ((select v from visual_ids where k = 'notice'), 'heart') $$,
  '42501', null, 'convidado não reage no mural');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('event-photos', (select v from visual_ids where k = 'event')::text || '/invasao.jpg') $$,
  '42501', null, 'convidado não envia capa');
update public.events set cover_path = null;
select is((select cover_path from public.events where id = (select v from visual_ids where k = 'event')),
  (select v from visual_ids where k = 'event')::text || '/nova.jpg', 'convidado não altera caminho da capa');
update storage.objects set metadata = '{"blocked":true}' where bucket_id = 'event-photos';
delete from storage.objects where bucket_id = 'event-photos';
select is((select count(*) from storage.objects where bucket_id = 'event-photos'), 1::bigint, 'convidado não apaga capa');
select is_empty($$ select * from storage.objects where bucket_id = 'event-photos' and metadata ? 'blocked' $$,
  'convidado não atualiza arquivo de capa');

-- ---------------------------------------------------------------------------
-- Outra família e sessão anon não têm acesso; buckets seguem privados e limitados.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select * from storage.objects where bucket_id in ('event-photos', 'member-photos') $$,
  'estranha não lê capas nem fotos de outras famílias');
select is_empty('select * from public.family_notice_reactions', 'estranha não lê reações alheias');
select is((select count(*) from public.family_notice_reaction_counts), 1::bigint, 'estranha vê apenas contadores da própria família');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('event-photos', (select v from visual_ids where k = 'event')::text || '/invasao.jpg') $$,
  '42501', null, 'estranha não envia capa a evento alheio');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('member-photos', (select v from visual_ids where k = 'pet')::text || '/invasao.jpg') $$,
  '42501', null, 'admin de outra família não envia foto de pet alheio');

reset role;
select results_eq(
  $$ select id, public, file_size_limit, allowed_mime_types from storage.buckets
     where id in ('event-photos', 'member-photos') order by id $$,
  $$ values
     ('event-photos'::text, false, 5242880::bigint, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
     ('member-photos'::text, false, 5242880::bigint, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']) $$,
  'novos buckets são privados, só imagens, até 5 MB');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select * from public.family_notice_reactions', '42501', null, 'anon não lê reações');
select throws_ok('select * from public.family_notice_reaction_counts', '42501', null, 'anon não lê contadores');
select is_empty($$ select * from storage.objects where bucket_id in ('event-photos', 'member-photos') $$,
  'anon não lê fotos privadas');

-- ---------------------------------------------------------------------------
-- Revogação imediata e exclusão em cascata.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
delete from public.event_participants where event_id = (select v from visual_ids where k = 'event');
delete from public.family_members where family_id = (select v from visual_ids where k = 'family')
  and user_id = '10000000-0000-0000-0000-00000000000b';

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select * from storage.objects where bucket_id = 'event-photos' $$,
  'convidado removido perde acesso à capa');

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select is_empty('select * from public.family_notice_reaction_counts', 'ex-membro perde acesso aos contadores');
select is_empty('select * from public.family_notice_reactions', 'ex-membro perde acesso às reações');
select is_empty($$ select * from storage.objects where bucket_id in ('event-photos', 'member-photos') $$,
  'ex-membro perde acesso às fotos');
select throws_ok(
  $$ insert into public.family_notice_reactions (notice_id, reaction) values ((select v from visual_ids where k = 'notice'), 'heart') $$,
  '42501', null, 'ex-membro não adiciona reação');

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ update public.events set cover_path = null where id = (select v from visual_ids where k = 'event') $$,
  'família pode remover referência de capa');
select lives_ok($$ update public.family_members set photo_path = null where user_id is null $$,
  'admin pode remover referência de foto de membro');
delete from storage.objects where bucket_id = 'member-photos';
select is_empty($$ select * from storage.objects where bucket_id = 'member-photos' $$,
  'admin pode apagar arquivos de fotos gerenciadas');
delete from public.family_notices where id = (select v from visual_ids where k = 'notice');
reset role;
select is_empty($$ select * from public.family_notice_reactions
                  where notice_id = (select v from visual_ids where k = 'notice') $$,
  'apagar recado apaga reações em cascata');

select * from finish();
rollback;

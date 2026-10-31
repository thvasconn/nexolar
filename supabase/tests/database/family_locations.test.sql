-- Mapa por família: consentimento naquela família, foto e bloqueio de gravação sem consentimento.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table map_ids (k text primary key, v uuid);
create temp table map_tokens (k text primary key, t text);
create temp table map_counts (k text primary key, v bigint);
grant select, insert on map_ids, map_tokens to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('20000000-0000-0000-0000-00000000000a', 'map-ana@teste.dev', '{"full_name":"Ana"}'),
  ('20000000-0000-0000-0000-00000000000b', 'map-bob@teste.dev', '{"full_name":"Bob"}'),
  ('20000000-0000-0000-0000-00000000000c', 'map-carla@teste.dev', '{"full_name":"Carla"}'),
  ('20000000-0000-0000-0000-00000000000d', 'map-dani@teste.dev', '{"full_name":"Dani"}');
insert into public.user_entitlements (user_id, premium_until, source)
values ('20000000-0000-0000-0000-00000000000a', now() + interval '30 days', 'trial');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into map_ids values ('a', public.create_family('Mapa A')), ('b', public.create_family('Mapa B'));
insert into map_tokens values
  ('bob_a', public.create_family_invite((select v from map_ids where k = 'a'))),
  ('bob_b', public.create_family_invite((select v from map_ids where k = 'b'))),
  ('carla_a', public.create_family_invite((select v from map_ids where k = 'a')));
insert into map_ids select 'ana_a', id from public.family_members where family_id = (select v from map_ids where k = 'a');
update public.family_members set display_name = 'Mãe', color = '#123456' where id = (select v from map_ids where k = 'ana_a');
update public.profiles set avatar_path = id::text || '/avatar.jpg' where id = auth.uid();
insert into public.family_members (family_id, display_name, kind) values
  ((select v from map_ids where k = 'a'), 'Vovó', 'person'),
  ((select v from map_ids where k = 'a'), 'Rex', 'pet');
insert into public.events (family_id, title, starts_at)
values ((select v from map_ids where k = 'a'), 'Evento do mapa', now() + interval '1 day');
insert into map_ids select 'event', id from public.events;
insert into public.event_participants (event_id, display_name)
values ((select v from map_ids where k = 'event'), 'Dani');
insert into map_tokens select 'event', public.create_event_invite(id) from public.event_participants;

reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select public.accept_family_invite((select t from map_tokens where k = 'bob_a'));
select public.accept_family_invite((select t from map_tokens where k = 'bob_b'));
insert into public.location_shares (family_id) values ((select v from map_ids where k = 'b'));
insert into public.member_locations (lat, lng, accuracy_m, recorded_at) values (-23.5, -46.6, 10, now() - interval '1 minute');

reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select public.accept_family_invite((select t from map_tokens where k = 'carla_a'));

reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into public.location_shares (family_id) values ((select v from map_ids where k = 'a'));
insert into public.member_locations (lat, lng, accuracy_m, recorded_at) values (-22.9, -43.2, 12.5, now() - interval '2 minutes');

-- Quem pertence às duas famílias só vê os compartilhamentos da família escolhida.
select results_eq(
  $$ select user_id from public.family_locations((select v from map_ids where k = 'a')) $$,
  $$ values ('20000000-0000-0000-0000-00000000000a'::uuid) $$,
  'mapa A não inclui Bob, que compartilha apenas com B');
select results_eq(
  $$ select user_id from public.family_locations((select v from map_ids where k = 'b')) $$,
  $$ values ('20000000-0000-0000-0000-00000000000b'::uuid) $$,
  'mapa B não inclui a posição própria da Ana, compartilhada apenas com A');
select results_eq(
  $$ select member_id, display_name, color, avatar_path, lat, lng, accuracy_m, recorded_at, updated_at
     from public.family_locations((select v from map_ids where k = 'a')) $$,
  $$ select (select v from map_ids where k = 'ana_a'), 'Mãe'::text, '#123456'::text,
            '20000000-0000-0000-0000-00000000000a/avatar.jpg'::text,
            -22.9::double precision, -43.2::double precision, 12.5::real,
            now() - interval '2 minutes', now() $$,
  'contrato traz identidade, nome do membro, cor, foto, coordenadas, precisão e horários');
select is_empty($$ select * from public.family_locations(null) $$, 'família nula retorna mapa vazio');
select is_empty($$ select * from public.family_locations('ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  'família inexistente retorna mapa vazio');
select is_empty(
  $$ select * from public.family_locations((select v from map_ids where k = 'a')) where avatar_path is null $$,
  'foto disponível vem do perfil do usuário');

-- Ver o mapa não exige compartilhar a própria posição.
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.family_locations((select v from map_ids where k = 'a'))), 1::bigint,
  'Carla vê posições autorizadas sem compartilhar sua própria localização');
select is_empty($$ select * from public.family_locations((select v from map_ids where k = 'b')) $$,
  'membro de A não consulta B, mesmo conhecendo seu UUID');
select throws_ok(
  $$ insert into public.member_locations (lat, lng, recorded_at) values (0, 0, now()) $$,
  '42501', null, 'primeira posição exige compartilhamento ativo');

-- Bob compartilha com A e B; sem foto também aparece no mapa.
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select user_id from public.family_locations((select v from map_ids where k = 'a')) $$,
  $$ values ('20000000-0000-0000-0000-00000000000a'::uuid) $$,
  'ser dono da posição não a inclui em família com compartilhamento desligado');
insert into public.location_shares (family_id) values ((select v from map_ids where k = 'a'));
select is((select count(*) from public.family_locations((select v from map_ids where k = 'a'))), 2::bigint,
  'ligar o compartilhamento inclui a posição salva no mapa da família');
select results_eq(
  $$ select display_name, avatar_path from public.family_locations((select v from map_ids where k = 'a'))
     where user_id = auth.uid() $$,
  $$ values ('Bob'::text, null::text) $$, 'sem apelido usa nome do perfil; sem foto retorna null');
select lives_ok(
  $$ update public.member_locations set lat = -23.6, recorded_at = now() where user_id = auth.uid() $$,
  'compartilhamento ativo permite atualizar a posição existente');
update public.member_locations set lat = 0 where user_id = '20000000-0000-0000-0000-00000000000a';
select is((select lat from public.member_locations where user_id = '20000000-0000-0000-0000-00000000000a'),
  -22.9::double precision, 'não atualiza localização de outra pessoa');

-- A consulta deve retornar a foto atual, sem copiar URLs que expiram.
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
update public.profiles set avatar_path = id::text || '/nova.jpg' where id = auth.uid();
select is((select avatar_path from public.family_locations((select v from map_ids where k = 'a')) where user_id = auth.uid()),
  '20000000-0000-0000-0000-00000000000a/nova.jpg', 'mapa retorna o caminho atual da foto');
select is((select count(*) from public.family_locations((select v from map_ids where k = 'a'))), 2::bigint,
  'pessoa sem login, pet e membro sem posição ficam fora do mapa');

reset role;
insert into map_counts select 'notifications', count(*) from public.notifications
where user_id in (select id from public.profiles where id::text like '20000000-0000-0000-0000-00000000000%');

-- Desligar em A não interrompe o consentimento com B.
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
delete from public.location_shares where family_id = (select v from map_ids where k = 'a') and user_id = auth.uid();
select is_empty(
  $$ select * from public.family_locations((select v from map_ids where k = 'a')) where user_id = auth.uid() $$,
  'desligar em A remove Bob do resultado, mesmo que ele ainda compartilhe com B');
select lives_ok(
  $$ insert into public.member_locations (lat, lng, recorded_at) values (-23.7, -46.7, now())
     on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, recorded_at = excluded.recorded_at $$,
  'upsert continua funcionando enquanto existe consentimento com B');
select is((select lat from public.family_locations((select v from map_ids where k = 'b')) where user_id = auth.uid()),
  -23.7::double precision, 'nova posição só aparece em B');

-- Sem nenhum compartilhamento: INSERT, UPDATE e UPSERT são bloqueados.
delete from public.location_shares where family_id = (select v from map_ids where k = 'b') and user_id = auth.uid();
select throws_ok(
  $$ update public.member_locations set lat = 0, recorded_at = now() where user_id = auth.uid() $$,
  '42501', null, 'atualização direta é recusada após desligar todos os compartilhamentos');
select throws_ok(
  $$ insert into public.member_locations (lat, lng, recorded_at) values (0, 0, now())
     on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, recorded_at = excluded.recorded_at $$,
  '42501', null, 'upsert do app também é recusado sem consentimento');
select is((select lat from public.member_locations where user_id = auth.uid()), -23.7::double precision,
  'tentativas bloqueadas não alteram a última posição salva');
select is_empty($$ select * from public.family_locations((select v from map_ids where k = 'b')) $$,
  'última posição fica salva, mas invisível no mapa');

reset role;
select is((select count(*) from public.notifications
           where user_id in (select id from public.profiles where id::text like '20000000-0000-0000-0000-00000000000%')),
  (select v from map_counts where k = 'notifications'), 'desligar compartilhamento não cria nenhuma notificação');
select is((select count(*) from public.member_locations where user_id = '20000000-0000-0000-0000-00000000000b'),
  1::bigint, 'desligar não apaga a última posição');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select * from public.member_locations where user_id = '20000000-0000-0000-0000-00000000000b' $$,
  'admin não lê posição de pessoa que desligou em todas as famílias');
select is((select count(*) from public.family_locations((select v from map_ids where k = 'a'))), 1::bigint,
  'admin consulta apenas quem segue compartilhando');

-- Religar permite atualizar o registro existente novamente.
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
insert into public.location_shares (family_id) values ((select v from map_ids where k = 'b'));
select lives_ok(
  $$ insert into public.member_locations (lat, lng, recorded_at) values (-23.8, -46.8, now())
     on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, recorded_at = excluded.recorded_at $$,
  'reativar o compartilhamento permite atualizar a posição por upsert');
select is((select lat from public.family_locations((select v from map_ids where k = 'b')) where user_id = auth.uid()),
  -23.8::double precision, 'mapa mostra a posição atualizada após religar');

-- Estranho, convidado de evento e anon não acessam o mapa familiar.
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select * from public.family_locations((select v from map_ids where k = 'a')) $$,
  'estranho não consulta posições da família');
select public.accept_event_invite((select t from map_tokens where k = 'event'));
select is_empty($$ select * from public.family_locations((select v from map_ids where k = 'a')) $$,
  'convidado externo de evento continua sem acesso ao mapa da família');

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select * from public.family_locations('ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  '42501', null, 'anon não executa a RPC de localização');

-- Remover da família apaga consentimento e corta leitura/gravação.
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
delete from public.family_members where family_id = (select v from map_ids where k = 'b')
  and user_id = '20000000-0000-0000-0000-00000000000b';
select is_empty($$ select * from public.family_locations((select v from map_ids where k = 'b')) $$,
  'remover membro retira sua posição do mapa');

reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select * from public.family_locations((select v from map_ids where k = 'b')) $$,
  'ex-membro não consulta o mapa');
select is_empty($$ select * from public.location_shares where user_id = auth.uid() $$,
  'remoção do membro apaga consentimento por cascata');
select throws_ok($$ update public.member_locations set lat = 0 where user_id = auth.uid() $$,
  '42501', null, 'sem consentimento após remoção, também não atualiza posição');

reset role;
select ok(not (select prosecdef from pg_proc where oid = 'public.family_locations(uuid)'::regprocedure),
  'RPC executa com permissões e RLS de quem consulta');
select * from finish();
rollback;

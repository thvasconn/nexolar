-- Testes de segurança e regras de negócio. Rodar: npm run db:test
-- Personagens: ana (dona, premium), bob (entra por convite), carla (convidada externa de um evento), dani (estranha, grátis).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table ids (k text primary key, v uuid);
create temp table tokens (k text primary key, t text);
grant all on ids, tokens to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@teste.dev',   '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@teste.dev',   '{"full_name":"Bob"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@teste.dev', '{"full_name":"Carla"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dani@teste.dev',  '{"full_name":"Dani"}');

-- =========================================================================
-- 1. Garantias estruturais (valem para qualquer tabela ou função futura)
-- =========================================================================
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
$$, 'toda tabela em public tem RLS ligado');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
    and not coalesce(c.reloptions::text like '%security_invoker=true%', false)
$$, 'nenhuma view em public fura o RLS');

select is_empty($$
  select table_name from information_schema.role_table_grants
  where grantee = 'anon' and table_schema in ('public', 'private')
  union all
  select table_name from information_schema.column_privileges
  where grantee = 'anon' and table_schema in ('public', 'private')
$$, 'anon não tem acesso a nenhuma tabela');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relkind = 'r'
    and (has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'insert'))
$$, 'tabelas privadas (admins, auditoria, rate limit) inacessíveis ao app');

select is_empty($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
$$, 'anon não executa nenhuma função');

select is_empty($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef
    and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)
$$, 'toda função SECURITY DEFINER fixa o search_path');

select is(
  (select full_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'Ana', 'perfil criado no cadastro');

-- =========================================================================
-- 2. Família, convites, limites
-- =========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into ids values ('fam', public.create_family('Casa da Ana'));
select throws_ok($$ select public.create_family('Segunda casa') $$, 'P0001', null,
  'plano grátis: só 1 família própria');
select throws_ok($$ select public.create_family_invite((select v from ids where k = 'fam')) $$, 'P0001', null,
  'plano grátis não convida pessoas');
select throws_ok(
  $$ insert into public.user_entitlements (user_id, premium_until, source) values (auth.uid(), now() + interval '10 years', 'coupon') $$,
  '42501', null, 'app não se dá premium');

reset role;
insert into public.user_entitlements values ('00000000-0000-0000-0000-00000000000a', now() + interval '30 days', 'store', now());

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into tokens values ('fam', public.create_family_invite((select v from ids where k = 'fam')));
select lives_ok($$ select public.create_family('Casa da praia') $$, 'premium cria mais famílias');
select throws_ok(
  $$ select public.create_family_invite((select v from ids where k = 'fam'), 'admin') $$, '23514', null,
  'convite não pode dar papel de admin');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select is_empty('select * from public.families', 'estranho não vê a família');
select throws_ok(
  $$ insert into public.family_members (family_id, display_name) values ((select v from ids where k = 'fam'), 'Intruso') $$,
  '42501', null, 'estranho não adiciona membro');
select throws_ok($$ select public.create_family_invite((select v from ids where k = 'fam')) $$, '42501', null,
  'estranho não cria convite');
select is_empty('select * from public.profiles where id <> auth.uid()', 'estranho não vê perfis alheios');

select lives_ok($$ select public.accept_family_invite((select t from tokens where k = 'fam')) $$, 'bob aceita convite');
select isnt_empty('select * from public.families', 'bob agora vê a família');
select is((select count(*)::int from public.profiles), 2, 'bob vê o próprio perfil e o da ana');
update public.family_members set role = 'admin' where user_id = auth.uid();
select is((select role::text from public.family_members where user_id = auth.uid()), 'adult', 'bob não se promove a admin');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.accept_family_invite((select t from tokens where k = 'fam')) $$, 'P0001', null,
  'convite não pode ser usado duas vezes');
select throws_ok($$ select public.accept_family_invite('token-inventado') $$, 'P0001', null,
  'token inventado não funciona');
insert into ids values ('dani_fam', public.create_family('Casa da Dani'));
insert into public.family_members (family_id, display_name, relationship)
select (select v from ids where k = 'dani_fam'), n, 'filho' from unnest(array['Léo', 'Bia', 'Caio']) n;
select throws_ok(
  $$ insert into public.family_members (family_id, display_name) values ((select v from ids where k = 'dani_fam'), 'Quinto') $$,
  'P0001', null, 'plano grátis: máximo de 4 membros');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into public.family_members (family_id, display_name, relationship)
values ((select v from ids where k = 'fam'), 'Vovó', 'avó');
select throws_ok($$ delete from public.family_members where user_id = auth.uid() $$, 'P0001', null,
  'dono não sai da família');
select throws_ok($$ update public.family_members set role = 'adult' where user_id = auth.uid() $$, 'P0001', null,
  'dono não deixa de ser admin');

reset role;
insert into ids select 'ana_m', id from public.family_members
  where user_id = '00000000-0000-0000-0000-00000000000a' and family_id = (select v from ids where k = 'fam');
insert into ids select 'bob_m', id from public.family_members where user_id = '00000000-0000-0000-0000-00000000000b';

-- =========================================================================
-- 3. Agenda: privado é privado, participante vê
-- =========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into public.calendar_items (family_id, title, starts_at, visibility)
values ((select v from ids where k = 'fam'), 'Médico', now() + interval '1 day', 'private');
insert into ids select 'med', id from public.calendar_items where title = 'Médico';

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select is_empty('select * from public.calendar_items', 'compromisso privado não aparece para a família');
select throws_ok(
  $$ insert into public.calendar_participants values ((select v from ids where k = 'med'), (select v from ids where k = 'bob_m')) $$,
  '42501', null, 'só o dono adiciona participantes');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into public.calendar_participants values ((select v from ids where k = 'med'), (select v from ids where k = 'bob_m'));

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.calendar_items), 1, 'quem vai junto vê o compromisso privado');

-- =========================================================================
-- 4. Evento com convidada externa, amigo oculto e rateio
-- =========================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into public.events (family_id, type, title, starts_at)
values ((select v from ids where k = 'fam'), 'secret_santa', 'Natal', now() + interval '30 days');
insert into ids select 'ev', id from public.events where title = 'Natal';
insert into public.event_participants (event_id, member_id, display_name) values
  ((select v from ids where k = 'ev'), (select v from ids where k = 'ana_m'), 'x'),
  ((select v from ids where k = 'ev'), (select v from ids where k = 'bob_m'), 'x');
insert into public.event_participants (event_id, display_name, guest_email)
values ((select v from ids where k = 'ev'), 'Carla', 'carla@teste.dev');

reset role;
insert into ids select 'ana_p', id from public.event_participants where user_id = '00000000-0000-0000-0000-00000000000a';
insert into ids select 'bob_p', id from public.event_participants where user_id = '00000000-0000-0000-0000-00000000000b';
insert into ids select 'carla_p', id from public.event_participants where display_name = 'Carla';
select is((select display_name from public.event_participants where id = (select v from ids where k = 'bob_p')),
  'Bob', 'nome do participante vem do perfil, não do cliente');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into tokens values ('ev', public.create_event_invite((select v from ids where k = 'carla_p')));
select throws_ok(
  $$ insert into public.event_participants (event_id, display_name, user_id) values ((select v from ids where k = 'ev'), 'Fake', auth.uid()) $$,
  '42501', null, 'cliente não escolhe o user_id de um participante');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select throws_ok('select guest_email from public.event_participants', '42501', null,
  'e-mail de convidado não é legível pelo app');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select is_empty('select * from public.events', 'convidada não vê o evento antes de aceitar');
select lives_ok($$ select public.accept_event_invite((select t from tokens where k = 'ev')) $$, 'carla aceita convite do evento');
select is((select count(*)::int from public.events), 1, 'convidada vê só o evento');
select is_empty('select * from public.families', 'convidada não vê a família');
select is_empty('select * from public.family_members', 'convidada não vê membros');
select is_empty('select * from public.calendar_items', 'convidada não vê agenda');
select is((select count(*)::int from public.event_participants), 3, 'convidada vê os participantes do evento');
update public.events set title = 'Hackeado';
select throws_ok(
  $$ insert into public.event_dishes (event_id, name) values ((select v from ids where k = 'ev'), 'Pavê') $$,
  '42501', null, 'convidada não cria prato');

reset role;
select is((select title from public.events where id = (select v from ids where k = 'ev')), 'Natal',
  'convidada não edita o evento');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into public.event_dishes (event_id, name) values ((select v from ids where k = 'ev'), 'Bacalhau');
insert into ids select 'dish', id from public.event_dishes where name = 'Bacalhau';
select lives_ok($$ select public.draw_secret_santa((select v from ids where k = 'ev')) $$, 'ana sorteia o amigo oculto');
select is((select count(*)::int from public.secret_santa_pairs), 1, 'quem sorteou vê só o próprio amigo');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.secret_santa_pairs), 1, 'convidada vê só o próprio amigo');
select lives_ok($$ select public.claim_dish((select v from ids where k = 'dish'), true) $$, 'convidada assume um prato');
insert into ids values ('x1', public.add_expense(
  (select v from ids where k = 'ev'), 'Bacalhau', 100, (select v from ids where k = 'carla_p'),
  array[(select v from ids where k = 'ana_p'), (select v from ids where k = 'bob_p'), (select v from ids where k = 'carla_p')]));
select is(
  (select balance_cents from public.event_balances((select v from ids where k = 'ev'))
   where participant_id = (select v from ids where k = 'carla_p')),
  67::bigint, 'carla pagou 100 e deve 33: saldo +67');
select throws_ok($$ delete from public.event_participants where user_id = auth.uid() $$, 'P0001', null,
  'participante com gasto não sai do evento sem acertar');

reset role;
select is(
  (select sum(amount_cents)::int from public.expense_shares where expense_id = (select v from ids where k = 'x1')),
  100, 'rateio fecha exatamente o total');
select results_eq(
  $$ select amount_cents from public.expense_shares where expense_id = (select v from ids where k = 'x1') order by amount_cents desc $$,
  $$ values (34::bigint), (33::bigint), (33::bigint) $$,
  '100 / 3 = 34 + 33 + 33');
select is(
  (select count(*)::int from public.secret_santa_pairs p
   where exists (select 1 from public.secret_santa_pairs q where q.giver_id = p.receiver_id)),
  3, 'amigo oculto: todos tiram e são tirados');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into ids values ('x2', public.add_expense(
  (select v from ids where k = 'ev'), 'Bebidas', 1000, (select v from ids where k = 'ana_p'),
  array[(select v from ids where k = 'ana_p'), (select v from ids where k = 'bob_p'), (select v from ids where k = 'carla_p')],
  'percent', array[50, 30, 20]));
select throws_ok(
  $$ select public.add_expense((select v from ids where k = 'ev'), 'Erro', 1000, (select v from ids where k = 'ana_p'),
       array[(select v from ids where k = 'ana_p'), (select v from ids where k = 'bob_p')], 'fixed', array[500, 400]) $$,
  'P0001', null, 'divisão fixa que não fecha é recusada');
select throws_ok(
  $$ select public.add_expense((select v from ids where k = 'ev'), 'Erro', 100, (select v from ids where k = 'ana_m'),
       array[(select v from ids where k = 'ana_p')]) $$,
  'P0001', null, 'pagador de fora do evento é recusado');

reset role;
select results_eq(
  $$ select amount_cents from public.expense_shares where expense_id = (select v from ids where k = 'x2') order by amount_cents desc $$,
  $$ values (500::bigint), (300::bigint), (200::bigint) $$,
  'divisão por porcentagem');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.add_expense((select v from ids where k = 'ev'), 'Invasão', 100, (select v from ids where k = 'ana_p'),
       array[(select v from ids where k = 'ana_p')]) $$,
  '42501', null, 'estranha não lança gasto em evento alheio');
select is_empty('select * from public.expenses', 'estranha não vê gastos');
reset role;

-- =========================================================================
-- 5. Localização: só com consentimento; ao desligar, some para a família mas fica salva
-- =========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ insert into public.member_locations (lat, lng, recorded_at) values (-22.9, -43.2, now()) $$,
  '42501', null, 'sem compartilhamento ligado não grava posição');
insert into public.location_shares (family_id) values ((select v from ids where k = 'fam'));
insert into public.member_locations (lat, lng, recorded_at) values (-22.9, -43.2, now());

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.member_locations), 1, 'família vê quem compartilha');
select throws_ok(
  $$ insert into public.location_shares (family_id, user_id) values ((select v from ids where k = 'fam'), '00000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'ninguém liga a localização de outra pessoa');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select is_empty('select * from public.member_locations', 'convidada não vê localização');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
delete from public.location_shares;
select is((select count(*)::int from public.member_locations), 1, 'dono continua vendo a própria última posição');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select is_empty('select * from public.member_locations', 'ao desligar, família deixa de ver');
reset role;
select is((select count(*)::int from public.member_locations
           where user_id = '00000000-0000-0000-0000-00000000000b'), 1, 'última posição fica salva');

-- =========================================================================
-- 6. Receitas e compras
-- =========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into public.recipes (title, visibility) values ('Segredo da vó', 'private');
insert into public.recipes (title, visibility, photo_path)
values ('Estrogonofe', 'public', '00000000-0000-0000-0000-00000000000a/estrogonofe.jpg');
select throws_ok(
  $$ insert into public.recipes (title, photo_path) values ('Foto alheia', '00000000-0000-0000-0000-00000000000b/x.jpg') $$,
  '23514', null, 'receita não aponta para foto de outra pessoa');
insert into public.stores (name, city) values ('Mundial', 'Rio de Janeiro');
insert into public.products (name, ean) values ('Feijão 1kg', '7891234567890');
insert into public.shopping_lists (family_id, store_id)
values ((select v from ids where k = 'fam'), (select id from public.stores where name = 'Mundial'));
insert into public.shopping_items (list_id, product_id, name, price_cents, checked)
select l.id, (select id from public.products where ean = '7891234567890'), 'Feijão', 899, true
from public.shopping_lists l;
update public.shopping_lists set status = 'done';
select is((select count(*)::int from public.price_observations), 1, 'finalizar a lista registra o preço');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(title) from public.recipes), array['Estrogonofe'], 'estranha vê só receita pública');
select is_empty('select * from public.shopping_lists', 'estranha não vê listas');
select is_empty('select * from public.price_observations', 'estranha não vê preços de outra família');
select is((select last_price_cents from public.price_board((select id from public.products where ean = '7891234567890'))),
  899::bigint, 'comparativo colaborativo mostra só o agregado');
select lives_ok(
  $$ insert into public.content_reports (recipe_id, reason) values ((select id from public.recipes), 'spam') $$,
  'usuário denuncia receita pública');

-- =========================================================================
-- 7. Storage
-- =========================================================================
reset role;
insert into storage.objects (bucket_id, name) values
  ('family-photos', (select v from ids where k = 'fam')::text || '/capa.jpg'),
  ('recipe-photos', '00000000-0000-0000-0000-00000000000a/estrogonofe.jpg'),
  ('recipe-photos', '00000000-0000-0000-0000-00000000000a/segredo.jpg'),
  ('avatars', '00000000-0000-0000-0000-00000000000a/eu.jpg');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('avatars', auth.uid()::text || '/eu.jpg') $$,
  'bob envia a própria foto');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000a/troca.jpg') $$,
  '42501', null, 'bob não grava na pasta da ana');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('family-photos', (select v from ids where k = 'fam')::text || '/x.jpg') $$,
  '42501', null, 'só admin troca a foto da família');
select is((select count(*)::int from storage.objects where bucket_id = 'family-photos'), 1, 'membro vê a foto da família');
select is((select count(*)::int from storage.objects where bucket_id = 'avatars'), 2, 'membro vê a foto de quem é da família');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select * from storage.objects where bucket_id in ('family-photos', 'avatars') $$,
  'estranha não vê fotos de família nem perfis');
select is((select array_agg(name) from storage.objects where bucket_id = 'recipe-photos'),
  array['00000000-0000-0000-0000-00000000000a/estrogonofe.jpg'], 'estranha vê só a foto da receita pública');

-- =========================================================================
-- 8. Limite de requisições
-- =========================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select private.rate_limit('teste', 2, interval '1 minute');
select private.rate_limit('teste', 2, interval '1 minute');
select throws_ok($$ select private.rate_limit('teste', 2, interval '1 minute') $$, 'PGRST', null,
  'terceira chamada na janela é barrada com 429');
select lives_ok($$ select private.rate_limit('outro', 2, interval '1 minute') $$, 'limites são por ação');

-- =========================================================================
-- 9. Admin: exige lista de admins + MFA, e grava auditoria
-- =========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok('select public.admin_metrics()', '42501', null, 'não-admin não acessa métricas');
select is((public.admin_whoami() ->> 'is_admin')::boolean, false, 'whoami diz que bob não é admin');

reset role;
insert into private.app_admins (user_id) values ('00000000-0000-0000-0000-00000000000a');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok('select public.admin_metrics()', '42501', null, 'admin sem MFA é barrado');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok((public.admin_metrics() ->> 'users')::int >= 4, 'admin com MFA vê métricas');
select lives_ok($$ select public.admin_grant_premium('00000000-0000-0000-0000-00000000000d', 30, 'teste estendido') $$,
  'admin dá cortesia premium');
select lives_ok($$ select public.admin_set_recipe_hidden((select recipe_id from public.admin_reports() limit 1), true) $$,
  'admin esconde receita denunciada');
select throws_ok($$ select public.admin_set_ban(auth.uid(), true, 'teste') $$, 'P0001', null, 'admin não se bloqueia');
select is((select count(*)::int from public.admin_audit_log()), 2, 'ações ficam na auditoria');

reset role;
select ok((select premium_until > now() + interval '29 days' from public.user_entitlements
           where user_id = '00000000-0000-0000-0000-00000000000d'), 'cortesia gravada');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$ select * from public.recipes where title = 'Estrogonofe' $$, 'receita escondida some para os usuários');

-- =========================================================================
-- 9b. Home da família: pets, aceite, tarefas, metas, contas, mural, notificações
-- =========================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$ insert into public.family_members (family_id, display_name, kind) values ((select v from ids where k = 'dani_fam'), 'Rex', 'pet') $$,
  'pet não conta no limite de membros');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.notifications where type = 'member_joined'), 1, 'admin é avisada quando alguém entra');
insert into public.calendar_items (family_id, title, starts_at, visibility)
values ((select v from ids where k = 'fam'), 'Reunião escola', now() + interval '2 days', 'private');
insert into public.calendar_participants (item_id, member_id)
select id, (select v from ids where k = 'bob_m') from public.calendar_items where title = 'Reunião escola';
insert into public.tasks (family_id, title, assigned_to) values ((select v from ids where k = 'fam'), 'Levar o lixo', (select v from ids where k = 'bob_m'));
insert into public.tasks (family_id, title, visibility) values ((select v from ids where k = 'fam'), 'Presente surpresa', 'private');
insert into public.goals (title, target, unit, period, visibility) values ('Beber água', 2, 'L', 'day', 'family'), ('Diário', 1, 'vezes', 'day', 'private');
insert into public.bills (family_id, name, due_day) values ((select v from ids where k = 'fam'), 'Internet', extract(day from now() at time zone 'America/Sao_Paulo')::int);
insert into public.family_notices (family_id, body) values ((select v from ids where k = 'fam'), 'Chego tarde hoje');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(distinct type)::int from public.notifications where type in ('calendar_invite', 'task_assigned', 'notice')), 3,
  'bob é avisado do compromisso, da tarefa e do recado');
select lives_ok($$ update public.calendar_participants set status = 'accepted' $$, 'bob aceita o compromisso');
select is((select count(*)::int from public.calendar_participants where status <> 'accepted'), 0, 'aceite gravado');
select is((select array_agg(title) from public.tasks), array['Levar o lixo'], 'tarefa privada de outra pessoa não aparece');
select throws_ok($$ update public.tasks set done_by = '00000000-0000-0000-0000-00000000000a' $$, '42501', null,
  'app não escolhe quem concluiu a tarefa');
update public.tasks set done_at = now();
select is((select done_by from public.tasks), '00000000-0000-0000-0000-00000000000b'::uuid, 'quem concluiu é quem está logado');
select is((select array_agg(title) from public.goals), array['Beber água'], 'meta privada não aparece para a família');
select throws_ok(
  $$ insert into public.goal_logs (goal_id, amount) values ((select id from public.goals), 1) $$,
  '42501', null, 'ninguém registra progresso na meta de outro');
update public.notifications set read_at = now();
select is((select count(*)::int from public.notifications where read_at is null), 0, 'bob marca as próprias notificações como lidas');

reset role;
select private.daily_notifications();
select private.daily_notifications();
select is((select count(*)::int from public.notifications where type = 'bill_due'), 2,
  'conta vencendo avisa os adultos uma vez só (sem duplicar)');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select is_empty('select * from public.tasks', 'convidada de evento não vê tarefas');
select is_empty('select * from public.bills', 'convidada de evento não vê contas');
select is_empty('select * from public.family_notices', 'convidada de evento não vê o mural');
select is_empty($$ select * from public.notifications where type <> 'event_invite' $$, 'cada um só vê as próprias notificações');

-- =========================================================================
-- 10. Apagar a família apaga tudo, sem esbarrar nas travas
-- =========================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ delete from public.families where id = (select v from ids where k = 'fam') $$, 'dona apaga a família');
reset role;
select is_empty($$ select * from public.family_members where family_id = (select v from ids where k = 'fam') $$,
  'membros apagados em cascata');
select is_empty('select * from public.expenses', 'gastos do evento apagados em cascata');

select * from finish();
rollback;

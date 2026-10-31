-- Núcleo: perfis, famílias, membros, convites e planos.
--
-- Regras de segurança do projeto inteiro (valem para todas as migrations):
--   1. Toda tabela em `public` tem RLS ligado. Um teste falha se alguma ficar sem.
--   2. `anon` não acessa nada. `authenticated` só recebe GRANT explícito, coluna a coluna quando preciso.
--   3. Funções SECURITY DEFINER usam `search_path = ''` e nomes qualificados.
--   4. Helpers de permissão ficam em `private`, schema que não é exposto pela API.
--   5. Escritas com regra de negócio (dinheiro, convites, sorteio) só por RPC que valida tudo no servidor.

create extension if not exists pgcrypto with schema extensions;

create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
-- EXECUTE para PUBLIC é padrão do Postgres e só sai com a forma global (sem IN SCHEMA).
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'adult', 'child');

-- ---------------------------------------------------------------------------
-- Perfis (1:1 com auth.users, criado por trigger)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text not null check (char_length(full_name) between 1 and 100),
  birth_date  date check (birth_date >= '1900-01-01'),
  avatar_path text check (char_length(avatar_path) <= 300),
  created_at  timestamptz not null default now()
);

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Usuário'), 100));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Planos e assinatura
-- ---------------------------------------------------------------------------
-- null = ilimitado
create table public.plan_limits (
  plan                text primary key check (plan in ('free', 'premium')),
  max_members         int,
  max_owned_families  int,
  max_upcoming_events int,
  max_recipes         int
);
-- ponytail: valores provisórios até o grupo fechar grátis x premium
insert into public.plan_limits values
  ('free',    4, 1, 3,    20),
  ('premium', 9, 3, null, null);

-- Escrita só pelo service_role (webhook do RevenueCat, cupons, recompensas).
create table public.user_entitlements (
  user_id       uuid primary key references public.profiles on delete cascade,
  premium_until timestamptz not null,
  source        text not null check (source in ('store', 'trial', 'coupon', 'reward')),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Famílias e membros
-- ---------------------------------------------------------------------------
create table public.families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  -- restrict: excluir a conta do dono não pode apagar os dados dos outros membros.
  -- O fluxo de exclusão de conta transfere a posse ou apaga a família antes.
  owner_id   uuid not null references public.profiles on delete restrict,
  photo_path text check (char_length(photo_path) <= 300),
  created_at timestamptz not null default now()
);
create index on public.families (owner_id);

create table public.family_members (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families on delete cascade,
  -- null = perfil gerenciado, sem login (criança pequena, avó sem celular)
  user_id      uuid references public.profiles on delete cascade,
  role         public.member_role not null default 'adult',
  display_name text check (char_length(display_name) between 1 and 60),
  birth_date   date check (birth_date >= '1900-01-01'),
  relationship text check (char_length(relationship) <= 40),
  created_at   timestamptz not null default now(),
  unique (family_id, user_id),
  check (user_id is not null or (display_name is not null and role <> 'admin'))
);
create index on public.family_members (user_id);

create table public.family_invites (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  role        public.member_role not null default 'adult' check (role <> 'admin'),
  -- só o hash fica no banco; o token em claro é devolvido uma única vez
  token_hash  bytea not null unique,
  created_by  uuid not null references public.profiles on delete cascade,
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_by uuid references public.profiles on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.family_invites (family_id);

-- ---------------------------------------------------------------------------
-- Helpers de permissão (SECURITY DEFINER para não recursar no RLS)
-- ---------------------------------------------------------------------------
create function private.is_member(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.family_members
    where family_id = fid and user_id = (select auth.uid())
  );
$$;

create function private.is_admin(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.family_members
    where family_id = fid and user_id = (select auth.uid()) and role = 'admin'
  );
$$;

create function private.shares_family(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.family_members a
    join public.family_members b on b.family_id = a.family_id
    where a.user_id = (select auth.uid()) and b.user_id = uid
  );
$$;

create function private.member_in_family(mid uuid, fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.family_members where id = mid and family_id = fid);
$$;

create function private.user_is_premium(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_entitlements where user_id = uid and premium_until > now()
  );
$$;

-- A família é premium quando o dono tem assinatura ativa.
-- Assim "várias famílias" vira benefício natural de quem assina.
create function private.family_is_premium(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select private.user_is_premium(owner_id) from public.families where id = fid),
    false
  );
$$;

create function private.family_limits(fid uuid) returns public.plan_limits
language sql stable security definer set search_path = '' as $$
  select * from public.plan_limits
  where plan = case when private.family_is_premium(fid) then 'premium' else 'free' end;
$$;

create function private.user_limits(uid uuid) returns public.plan_limits
language sql stable security definer set search_path = '' as $$
  select * from public.plan_limits
  where plan = case when private.user_is_premium(uid) then 'premium' else 'free' end;
$$;

-- ---------------------------------------------------------------------------
-- Limite de requisições por usuário (janela fixa)
-- ---------------------------------------------------------------------------
create table private.rate_limits (
  user_id      uuid not null,
  bucket       text not null,
  window_start timestamptz not null,
  hits         int not null,
  primary key (user_id, bucket)
);

-- Estourou: HTTP 429. O rollback da exceção desfaz o incremento, então o contador
-- fica parado no máximo até a janela vencer.
create function private.rate_limit(p_bucket text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h int;
begin
  if uid is null then
    return;
  end if;
  insert into private.rate_limits as r (user_id, bucket, window_start, hits)
  values (uid, p_bucket, now(), 1)
  on conflict (user_id, bucket) do update set
    hits         = case when r.window_start < now() - p_window then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - p_window then now() else r.window_start end
  returning hits into h;
  if h > p_max then
    raise sqlstate 'PGRST' using
      message = json_build_object('code', 'rate_limited', 'message', 'Muitas requisições. Tente de novo em instantes.')::text,
      detail  = json_build_object('status', 429, 'headers', json_build_object('Retry-After', extract(epoch from p_window)::int::text))::text;
  end if;
end $$;

-- Limite geral: toda escrita pela API (POST/PATCH/DELETE e RPCs) conta. Leitura não conta.
create function private.check_request() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('request.method', true) in ('POST', 'PATCH', 'PUT', 'DELETE') then
    perform private.rate_limit('write', 120, interval '1 minute');
  end if;
end $$;

alter role authenticator set pgrst.db_pre_request = 'private.check_request';
notify pgrst, 'reload config';

-- Limites específicos em tabelas de escrita livre (catálogo, denúncias).
create function private.rate_limit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.rate_limit(tg_table_name, tg_argv[0]::int, tg_argv[1]::interval);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers de regra
-- ---------------------------------------------------------------------------
create function private.enforce_member_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int;
begin
  -- serializa inserções concorrentes na mesma família
  perform pg_advisory_xact_lock(hashtextextended('members:' || new.family_id::text, 0));
  lim := (private.family_limits(new.family_id)).max_members;
  if lim is not null and (select count(*) from public.family_members where family_id = new.family_id) >= lim then
    raise exception 'Limite de membros do plano atingido' using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;

create trigger family_members_limit before insert on public.family_members
  for each row execute function private.enforce_member_limit();

-- O dono é sempre admin e não sai da família. Isso garante que toda família tem ao menos um admin.
create function private.protect_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.families where id = old.family_id and owner_id = old.user_id)
     and (tg_op = 'DELETE' or new.role <> 'admin') then
    raise exception 'O dono da família não pode sair nem deixar de ser admin' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger family_members_protect_owner before update or delete on public.family_members
  for each row execute function private.protect_owner();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create function public.create_family(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  fid uuid;
  lim int;
begin
  if uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  perform private.rate_limit('create_family', 10, interval '1 day');
  perform pg_advisory_xact_lock(hashtextextended('families:' || uid::text, 0));
  lim := (private.user_limits(uid)).max_owned_families;
  if lim is not null and (select count(*) from public.families where owner_id = uid) >= lim then
    raise exception 'Limite de famílias do plano atingido' using errcode = 'P0001', hint = 'plan_limit';
  end if;
  insert into public.families (name, owner_id) values (p_name, uid) returning id into fid;
  insert into public.family_members (family_id, user_id, role) values (fid, uid, 'admin');
  return fid;
end $$;

create function public.create_family_invite(p_family_id uuid, p_role public.member_role default 'adult')
returns text
language plpgsql security definer set search_path = '' as $$
declare token text;
begin
  if not private.is_admin(p_family_id) then
    raise exception 'Apenas admins convidam' using errcode = '42501';
  end if;
  if not private.family_is_premium(p_family_id) then
    raise exception 'Convidar pessoas é recurso premium' using errcode = 'P0001', hint = 'premium_required';
  end if;
  perform private.rate_limit('create_invite', 30, interval '1 hour');
  token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.family_invites (family_id, role, token_hash, created_by)
  values (p_family_id, p_role, extensions.digest(token, 'sha256'), auth.uid());
  return token;
end $$;

create function public.accept_family_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  inv public.family_invites;
begin
  if uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  perform private.rate_limit('accept_invite', 20, interval '1 hour');
  select * into inv from public.family_invites
  where token_hash = extensions.digest(p_token, 'sha256')
  for update;
  if not found or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'Convite inválido ou expirado' using errcode = 'P0001';
  end if;
  if not private.family_is_premium(inv.family_id) then
    raise exception 'Esta família não tem mais o plano premium' using errcode = 'P0001', hint = 'premium_required';
  end if;
  if exists (select 1 from public.family_members where family_id = inv.family_id and user_id = uid) then
    raise exception 'Você já faz parte desta família' using errcode = 'P0001';
  end if;
  insert into public.family_members (family_id, user_id, role) values (inv.family_id, uid, inv.role);
  update public.family_invites set accepted_by = uid, accepted_at = now() where id = inv.id;
  return inv.family_id;
end $$;

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.plan_limits       enable row level security;
alter table public.user_entitlements enable row level security;
alter table public.families          enable row level security;
alter table public.family_members    enable row level security;
alter table public.family_invites    enable row level security;

grant select, update (full_name, birth_date, avatar_path) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_family(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

grant select on public.plan_limits to authenticated;
create policy plan_limits_select on public.plan_limits for select to authenticated using (true);

grant select on public.user_entitlements to authenticated;
create policy entitlements_select on public.user_entitlements for select to authenticated
  using (user_id = (select auth.uid()));

grant select, update (name, photo_path), delete on public.families to authenticated;
create policy families_select on public.families for select to authenticated
  using (private.is_member(id));
create policy families_update on public.families for update to authenticated
  using (private.is_admin(id)) with check (private.is_admin(id));
create policy families_delete on public.families for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Cadastro é livre e todo usuário cria a própria família. Entrar na família de outra pessoa
-- só por convite (accept_family_invite), e convidar é recurso premium.
-- Admin cria direto apenas perfis gerenciados (sem user_id).
grant select, delete,
      insert (family_id, role, display_name, birth_date, relationship),
      update (role, display_name, birth_date, relationship)
  on public.family_members to authenticated;
create policy members_select on public.family_members for select to authenticated
  using (private.is_member(family_id));
create policy members_insert on public.family_members for insert to authenticated
  with check (private.is_admin(family_id) and user_id is null);
create policy members_update on public.family_members for update to authenticated
  using (private.is_admin(family_id)) with check (private.is_admin(family_id));
create policy members_delete on public.family_members for delete to authenticated
  using (private.is_admin(family_id) or user_id = (select auth.uid()));

grant select (id, family_id, role, created_by, expires_at, accepted_by, accepted_at, created_at), delete
  on public.family_invites to authenticated;
create policy invites_select on public.family_invites for select to authenticated
  using (private.is_admin(family_id));
create policy invites_delete on public.family_invites for delete to authenticated
  using (private.is_admin(family_id));

grant execute on function private.check_request() to authenticated;
grant execute on function
  private.is_member(uuid), private.is_admin(uuid), private.shares_family(uuid),
  private.member_in_family(uuid, uuid), private.user_is_premium(uuid),
  private.family_is_premium(uuid), private.family_limits(uuid), private.user_limits(uuid)
  to authenticated;

grant execute on function
  public.create_family(text),
  public.create_family_invite(uuid, public.member_role),
  public.accept_family_invite(text)
  to authenticated;

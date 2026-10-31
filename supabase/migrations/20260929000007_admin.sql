-- Painel admin: métricas, moderação, usuários, planos e auditoria.
--
-- O painel é um site estático que usa login normal do Supabase. Nenhuma chave service_role no navegador.
-- Toda função admin exige: estar em private.app_admins E sessão com MFA (aal2).
-- Toda ação que muda algo grava em private.admin_audit_log.
--
-- Para tornar alguém admin (via SQL no painel do Supabase):
--   insert into private.app_admins (user_id) values ('<uuid do usuário>');

create table private.app_admins (
  user_id    uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table private.admin_audit_log (
  id         bigint generated always as identity primary key,
  admin_id   uuid not null,
  action     text not null,
  target     text,
  details    jsonb,
  created_at timestamptz not null default now()
);

create function private.require_app_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.app_admins where user_id = auth.uid()) then
    raise exception 'Acesso restrito' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Confirme o login com o código do autenticador' using errcode = '42501', hint = 'mfa_required';
  end if;
end $$;

create function private.audit(p_action text, p_target text, p_details jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into private.admin_audit_log (admin_id, action, target, details)
  values (auth.uid(), p_action, p_target, p_details);
$$;

-- Única função admin sem MFA: o painel precisa saber se deve pedir o código.
create function public.admin_whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_admin', exists (select 1 from private.app_admins where user_id = auth.uid()),
    'aal', auth.jwt() ->> 'aal'
  );
$$;

create function public.admin_metrics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_app_admin();
  return jsonb_build_object(
    'users',            (select count(*) from auth.users),
    'users_7d',         (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_7d',        (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'families',         (select count(*) from public.families),
    'premium_users',    (select count(*) from public.user_entitlements where premium_until > now()),
    'upcoming_events',  (select count(*) from public.events where starts_at > now()),
    'lists_done_30d',   (select count(*) from public.shopping_lists where finished_at > now() - interval '30 days'),
    'public_recipes',   (select count(*) from public.recipes where visibility = 'public' and not hidden),
    'pending_reports',  (select count(*) from public.content_reports c
                         join public.recipes r on r.id = c.recipe_id where not r.hidden)
  );
end $$;

-- Para relatório de patrocinador: só agregados, sem família ou usuário.
create function public.admin_top_products(p_days int default 30)
returns table (product text, purchases bigint, families bigint, median_price_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_app_admin();
  return query
    select p.name, count(*), count(distinct o.family_id),
           percentile_disc(0.5) within group (order by o.price_cents)
    from public.price_observations o
    join public.products p on p.id = o.product_id
    where o.observed_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
    group by p.name
    order by 2 desc
    limit 50;
end $$;

create function public.admin_reports()
returns table (report_id uuid, recipe_id uuid, recipe_title text, recipe_hidden boolean,
               reason text, reporter_email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_app_admin();
  return query
    select c.id, r.id, r.title, r.hidden, c.reason, u.email::text, c.created_at
    from public.content_reports c
    join public.recipes r on r.id = c.recipe_id
    left join auth.users u on u.id = c.reporter_id
    order by r.hidden, c.created_at desc
    limit 200;
end $$;

create function public.admin_set_recipe_hidden(p_recipe_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_app_admin();
  update public.recipes set hidden = p_hidden where id = p_recipe_id;
  perform private.audit(case when p_hidden then 'recipe.hide' else 'recipe.unhide' end, p_recipe_id::text, null);
end $$;

create function public.admin_find_users(p_query text)
returns table (id uuid, email text, full_name text, created_at timestamptz, last_sign_in_at timestamptz,
               premium_until timestamptz, banned_until timestamptz, families bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_app_admin();
  if char_length(coalesce(trim(p_query), '')) < 3 then
    raise exception 'Digite ao menos 3 caracteres' using errcode = 'P0001';
  end if;
  return query
    select u.id, u.email::text, p.full_name, u.created_at, u.last_sign_in_at, e.premium_until, u.banned_until,
           (select count(*) from public.family_members m where m.user_id = u.id)
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.user_entitlements e on e.user_id = u.id
    where u.email ilike '%' || p_query || '%' or p.full_name ilike '%' || p_query || '%' or u.id::text = p_query
    order by u.created_at desc
    limit 50;
end $$;

-- Cortesia: substitui o "cupom de 100%" (teste estendido, família de sócio, parceiro).
create function public.admin_grant_premium(p_user_id uuid, p_days int, p_reason text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare until timestamptz;
begin
  perform private.require_app_admin();
  if p_days not between 1 and 366 or char_length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'Informe de 1 a 366 dias e o motivo' using errcode = 'P0001';
  end if;
  insert into public.user_entitlements as e (user_id, premium_until, source)
  values (p_user_id, now() + make_interval(days => p_days), 'coupon')
  on conflict (user_id) do update
    set premium_until = greatest(e.premium_until, now()) + make_interval(days => p_days),
        source = 'coupon', updated_at = now()
  returning premium_until into until;
  perform private.audit('user.grant_premium', p_user_id::text,
                        jsonb_build_object('days', p_days, 'reason', p_reason, 'until', until));
  return until;
end $$;

-- Bloqueio derruba as sessões (refresh tokens). O access token atual expira em até 1h.
create function public.admin_set_ban(p_user_id uuid, p_banned boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_app_admin();
  if p_user_id = auth.uid() then
    raise exception 'Você não pode bloquear a si mesmo' using errcode = 'P0001';
  end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'Informe o motivo' using errcode = 'P0001';
  end if;
  update auth.users set banned_until = case when p_banned then 'infinity'::timestamptz end where id = p_user_id;
  if p_banned then
    delete from auth.sessions where user_id = p_user_id;
  end if;
  perform private.audit(case when p_banned then 'user.ban' else 'user.unban' end, p_user_id::text,
                        jsonb_build_object('reason', p_reason));
end $$;

create function public.admin_update_plan_limits(
  p_plan text, p_max_members int, p_max_owned_families int, p_max_upcoming_events int, p_max_recipes int
) returns void
language plpgsql security definer set search_path = '' as $$
declare before jsonb;
begin
  perform private.require_app_admin();
  select to_jsonb(l) into before from public.plan_limits l where plan = p_plan;
  if before is null then
    raise exception 'Plano inexistente' using errcode = 'P0001';
  end if;
  if least(p_max_members, p_max_owned_families, p_max_upcoming_events, p_max_recipes) < 1 then
    raise exception 'Limites precisam ser maiores que zero (vazio = ilimitado)' using errcode = 'P0001';
  end if;
  update public.plan_limits
  set max_members = p_max_members, max_owned_families = p_max_owned_families,
      max_upcoming_events = p_max_upcoming_events, max_recipes = p_max_recipes
  where plan = p_plan;
  perform private.audit('plan.update', p_plan, jsonb_build_object('before', before));
end $$;

create function public.admin_audit_log(p_limit int default 100)
returns table (id bigint, admin_email text, action text, target text, details jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_app_admin();
  return query
    select l.id, u.email::text, l.action, l.target, l.details, l.created_at
    from private.admin_audit_log l
    left join auth.users u on u.id = l.admin_id
    order by l.id desc
    limit least(greatest(p_limit, 1), 500);
end $$;

grant execute on function
  public.admin_whoami(), public.admin_metrics(), public.admin_top_products(int), public.admin_reports(),
  public.admin_set_recipe_hidden(uuid, boolean), public.admin_find_users(text),
  public.admin_grant_premium(uuid, int, text), public.admin_set_ban(uuid, boolean, text),
  public.admin_update_plan_limits(text, int, int, int, int), public.admin_audit_log(int)
  to authenticated;

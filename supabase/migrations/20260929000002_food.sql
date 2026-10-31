-- Receitas, lista de compras e histórico de preços.

-- ---------------------------------------------------------------------------
-- Receitas
-- ---------------------------------------------------------------------------
create type public.recipe_visibility as enum ('private', 'family', 'public');

create table public.recipes (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references public.profiles on delete cascade,
  family_id    uuid references public.families on delete set null,
  visibility   public.recipe_visibility not null default 'private',
  title        text not null check (char_length(title) between 1 and 120),
  description  text check (char_length(description) <= 1000),
  -- [{ "name": "arroz", "qty": 2, "unit": "xícara" }]
  ingredients  jsonb not null default '[]'
               check (jsonb_typeof(ingredients) = 'array' and pg_column_size(ingredients) <= 20000),
  steps        text[] not null default '{}' check (pg_column_size(steps) <= 20000),
  prep_minutes int check (prep_minutes between 0 and 1440),
  servings     int check (servings between 1 and 100),
  tags         text[] not null default '{}' check (cardinality(tags) <= 20),
  photo_path   text check (char_length(photo_path) <= 300),
  video_url    text check (video_url ~ '^https://' and char_length(video_url) <= 500),
  -- moderação: só o service_role (painel admin) altera
  hidden       boolean not null default false,
  created_at   timestamptz not null default now(),
  check (visibility <> 'family' or family_id is not null)
);
create index on public.recipes (owner_id);
create index on public.recipes (family_id);
create index on public.recipes (created_at desc) where visibility = 'public' and not hidden;

create function private.enforce_recipe_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int;
begin
  perform pg_advisory_xact_lock(hashtextextended('recipes:' || new.owner_id::text, 0));
  lim := (private.user_limits(new.owner_id)).max_recipes;
  if lim is not null and (select count(*) from public.recipes where owner_id = new.owner_id) >= lim then
    raise exception 'Limite de receitas do plano atingido' using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;

create trigger recipes_limit before insert on public.recipes
  for each row execute function private.enforce_recipe_limit();

-- Conteúdo gerado por usuário precisa de denúncia (exigência da App Store, guideline 1.2).
create table public.content_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles on delete cascade,
  recipe_id   uuid not null references public.recipes on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 500),
  created_at  timestamptz not null default now(),
  unique (reporter_id, recipe_id)
);

-- ---------------------------------------------------------------------------
-- Catálogo compartilhado: mercados e produtos
-- ---------------------------------------------------------------------------
create table public.stores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  city       text check (char_length(city) <= 80),
  created_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create unique index stores_name_city on public.stores (lower(name), lower(coalesce(city, '')));

create table public.products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  ean        text unique check (ean ~ '^\d{8,14}$'),
  created_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Listas de compras
-- ---------------------------------------------------------------------------
create table public.shopping_lists (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  name        text not null default 'Compras' check (char_length(name) between 1 and 60),
  store_id    uuid references public.stores on delete set null,
  status      text not null default 'open' check (status in ('open', 'done')),
  finished_at timestamptz,
  created_by  uuid default auth.uid() references public.profiles on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.shopping_lists (family_id, created_at desc);

create table public.shopping_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.shopping_lists on delete cascade,
  product_id  uuid references public.products on delete set null,
  name        text not null check (char_length(name) between 1 and 120),
  quantity    numeric not null default 1 check (quantity > 0 and quantity <= 10000),
  unit        text check (char_length(unit) <= 20),
  -- preço unitário; total do item = price_cents * quantity
  price_cents bigint check (price_cents between 0 and 100000000),
  checked     boolean not null default false,
  added_by    uuid default auth.uid() references public.profiles on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.shopping_items (list_id);

-- Alimentado pelo servidor quando uma lista é finalizada. Base do comparativo colaborativo.
create table public.price_observations (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products on delete cascade,
  store_id    uuid not null references public.stores on delete cascade,
  family_id   uuid not null references public.families on delete cascade,
  price_cents bigint not null check (price_cents > 0),
  observed_at timestamptz not null default now()
);
create index on public.price_observations (product_id, store_id, observed_at desc);
create index on public.price_observations (family_id, observed_at desc);

create function private.shopping_list_family(lid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select family_id from public.shopping_lists where id = lid;
$$;

create function private.record_prices() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status <> 'done' then
    new.finished_at := now();
    if new.store_id is not null then
      insert into public.price_observations (product_id, store_id, family_id, price_cents)
      select i.product_id, new.store_id, new.family_id, i.price_cents
      from public.shopping_items i
      where i.list_id = new.id and i.product_id is not null and i.price_cents > 0 and i.checked;
    end if;
  end if;
  return new;
end $$;

create trigger shopping_lists_record_prices before update of status on public.shopping_lists
  for each row execute function private.record_prices();

-- Comparativo colaborativo: expõe só agregados por mercado, nunca família ou usuário.
create function public.price_board(p_product_id uuid)
returns table (store_id uuid, store_name text, last_price_cents bigint, median_price_cents bigint,
               samples bigint, last_seen timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name,
         (array_agg(o.price_cents order by o.observed_at desc))[1],
         percentile_disc(0.5) within group (order by o.price_cents),
         count(*),
         max(o.observed_at)
  from public.price_observations o
  join public.stores s on s.id = o.store_id
  where o.product_id = p_product_id
    and o.observed_at > now() - interval '90 days'
    and auth.uid() is not null
  group by s.id, s.name
  order by 3;
$$;

create trigger stores_rate_limit before insert on public.stores
  for each row execute function private.rate_limit_trigger('30', '1 day');
create trigger products_rate_limit before insert on public.products
  for each row execute function private.rate_limit_trigger('100', '1 day');
create trigger content_reports_rate_limit before insert on public.content_reports
  for each row execute function private.rate_limit_trigger('20', '1 day');

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------
alter table public.recipes            enable row level security;
alter table public.content_reports    enable row level security;
alter table public.stores             enable row level security;
alter table public.products           enable row level security;
alter table public.shopping_lists     enable row level security;
alter table public.shopping_items     enable row level security;
alter table public.price_observations enable row level security;

grant select, delete,
      insert (family_id, visibility, title, description, ingredients, steps, prep_minutes, servings, tags, photo_path, video_url),
      update (family_id, visibility, title, description, ingredients, steps, prep_minutes, servings, tags, photo_path, video_url)
  on public.recipes to authenticated;
create policy recipes_select on public.recipes for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (visibility = 'family' and private.is_member(family_id))
    or (visibility = 'public' and not hidden)
  );
create policy recipes_insert on public.recipes for insert to authenticated
  with check (owner_id = (select auth.uid()) and (family_id is null or private.is_member(family_id)));
create policy recipes_update on public.recipes for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (family_id is null or private.is_member(family_id)));
create policy recipes_delete on public.recipes for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Denúncia: só inserir, e só de receita que a pessoa consegue ver (subquery respeita o RLS de recipes).
grant insert (recipe_id, reason) on public.content_reports to authenticated;
create policy reports_insert on public.content_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (select 1 from public.recipes r where r.id = recipe_id)
  );

grant select, insert (name, city) on public.stores to authenticated;
create policy stores_select on public.stores for select to authenticated using (true);
create policy stores_insert on public.stores for insert to authenticated
  with check (created_by = (select auth.uid()));

grant select, insert (name, ean) on public.products to authenticated;
create policy products_select on public.products for select to authenticated using (true);
create policy products_insert on public.products for insert to authenticated
  with check (created_by = (select auth.uid()));

grant select, delete,
      insert (family_id, name, store_id),
      update (name, store_id, status)
  on public.shopping_lists to authenticated;
create policy lists_select on public.shopping_lists for select to authenticated
  using (private.is_member(family_id));
create policy lists_insert on public.shopping_lists for insert to authenticated
  with check (private.is_member(family_id) and created_by = (select auth.uid()));
create policy lists_update on public.shopping_lists for update to authenticated
  using (private.is_member(family_id)) with check (private.is_member(family_id));
create policy lists_delete on public.shopping_lists for delete to authenticated
  using (private.is_member(family_id));

grant select, delete,
      insert (list_id, product_id, name, quantity, unit, price_cents, checked),
      update (product_id, name, quantity, unit, price_cents, checked)
  on public.shopping_items to authenticated;
create policy items_select on public.shopping_items for select to authenticated
  using (private.is_member(private.shopping_list_family(list_id)));
create policy items_insert on public.shopping_items for insert to authenticated
  with check (private.is_member(private.shopping_list_family(list_id)) and added_by = (select auth.uid()));
create policy items_update on public.shopping_items for update to authenticated
  using (private.is_member(private.shopping_list_family(list_id)))
  with check (private.is_member(private.shopping_list_family(list_id)));
create policy items_delete on public.shopping_items for delete to authenticated
  using (private.is_member(private.shopping_list_family(list_id)));

grant select on public.price_observations to authenticated;
create policy prices_select on public.price_observations for select to authenticated
  using (private.is_member(family_id));

grant execute on function private.shopping_list_family(uuid) to authenticated;
grant execute on function public.price_board(uuid) to authenticated;

alter publication supabase_realtime add table public.shopping_lists, public.shopping_items;

-- Localização em tempo real com consentimento explícito e revogável (LGPD).
--
-- Só o próprio usuário liga o compartilhamento, família por família. Ninguém liga pelo outro,
-- nem admin, nem responsável. Guarda apenas a última posição, sem histórico de rota.
-- Ao desligar, a última posição fica salva mas deixa de ser visível para a família.

create table public.location_shares (
  family_id  uuid not null,
  user_id    uuid not null,
  created_at timestamptz not null default now(),
  primary key (family_id, user_id),
  -- saiu da família = para de compartilhar automaticamente
  foreign key (family_id, user_id) references public.family_members (family_id, user_id) on delete cascade
);
create index on public.location_shares (user_id);

create table public.member_locations (
  user_id     uuid primary key references public.profiles on delete cascade,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  accuracy_m  real check (accuracy_m between 0 and 100000),
  recorded_at timestamptz not null,
  updated_at  timestamptz not null default now()
);

create function private.touch_location() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger member_locations_touch before insert or update on public.member_locations
  for each row execute function private.touch_location();

create function private.can_see_location(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid = (select auth.uid()) or exists (
    select 1 from public.location_shares s
    where s.user_id = uid and private.is_member(s.family_id)
  );
$$;

alter table public.location_shares  enable row level security;
alter table public.member_locations enable row level security;

grant select, insert (family_id), delete on public.location_shares to authenticated;
alter table public.location_shares alter column user_id set default auth.uid();
create policy loc_shares_select on public.location_shares for select to authenticated
  using (private.is_member(family_id));
create policy loc_shares_insert on public.location_shares for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy loc_shares_delete on public.location_shares for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.member_locations alter column user_id set default auth.uid();
grant select, delete,
      insert (lat, lng, accuracy_m, recorded_at),
      update (lat, lng, accuracy_m, recorded_at)
  on public.member_locations to authenticated;
create policy locations_select on public.member_locations for select to authenticated
  using (private.can_see_location(user_id));
-- só grava posição quem está compartilhando com pelo menos uma família
create policy locations_insert on public.member_locations for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.location_shares s where s.user_id = (select auth.uid())));
create policy locations_update on public.member_locations for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy locations_delete on public.member_locations for delete to authenticated
  using (user_id = (select auth.uid()));

grant execute on function private.can_see_location(uuid) to authenticated;

alter publication supabase_realtime add table public.member_locations;

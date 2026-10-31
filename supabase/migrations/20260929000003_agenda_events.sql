-- Agenda (compromissos) e eventos (com convidados externos, pratos e amigo oculto).

-- ---------------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------------
create type public.visibility_scope as enum ('private', 'family');

create table public.calendar_items (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid references public.families on delete cascade,
  owner_id       uuid not null default auth.uid() references public.profiles on delete cascade,
  title          text not null check (char_length(title) between 1 and 120),
  notes          text check (char_length(notes) <= 2000),
  location_text  text check (char_length(location_text) <= 200),
  starts_at      timestamptz not null,
  ends_at        timestamptz,
  all_day        boolean not null default false,
  recurrence     text check (recurrence in ('daily', 'weekly', 'monthly', 'yearly')),
  visibility     public.visibility_scope not null default 'family',
  remind_minutes int check (remind_minutes between 0 and 40320),
  created_at     timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at),
  check (visibility = 'private' or family_id is not null)
);
create index on public.calendar_items (family_id, starts_at);
create index on public.calendar_items (owner_id, starts_at);

-- Quem vai junto recebe o compromisso, mesmo se for privado ("médico amanhã, vou com a mãe").
create table public.calendar_participants (
  item_id   uuid not null references public.calendar_items on delete cascade,
  member_id uuid not null references public.family_members on delete cascade,
  primary key (item_id, member_id)
);
create index on public.calendar_participants (member_id);

create function private.is_calendar_participant(iid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.calendar_participants p
    join public.family_members m on m.id = p.member_id
    where p.item_id = iid and m.user_id = (select auth.uid())
  );
$$;

create function private.can_see_calendar_item(iid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.calendar_items c
    where c.id = iid
      and (c.owner_id = (select auth.uid())
           or (c.visibility = 'family' and private.is_member(c.family_id))
           or private.is_calendar_participant(c.id))
  );
$$;

create function private.owns_calendar_item_with_member(iid uuid, mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.calendar_items c
    where c.id = iid and c.owner_id = (select auth.uid())
      and private.member_in_family(mid, c.family_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Eventos
-- ---------------------------------------------------------------------------
create type public.event_type as enum ('birthday', 'meeting', 'meal', 'party', 'secret_santa', 'other');
create type public.rsvp_status as enum ('pending', 'yes', 'no', 'maybe');

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families on delete cascade,
  created_by    uuid default auth.uid() references public.profiles on delete set null,
  type          public.event_type not null default 'other',
  title         text not null check (char_length(title) between 1 and 120),
  description   text check (char_length(description) <= 2000),
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  location_text text check (char_length(location_text) <= 200),
  created_at    timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index on public.events (family_id, starts_at);

-- Participantes: membros da família ou convidados externos (que só enxergam este evento).
create table public.event_participants (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events on delete cascade,
  member_id         uuid references public.family_members on delete set null,
  -- preenchido pelo servidor: via member_id ou ao aceitar convite. Nunca pelo cliente.
  user_id           uuid references public.profiles on delete set null,
  display_name      text not null check (char_length(display_name) between 1 and 60),
  guest_email       text check (char_length(guest_email) <= 254 and guest_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invite_token_hash bytea unique,
  rsvp              public.rsvp_status not null default 'pending',
  created_at        timestamptz not null default now(),
  unique (event_id, user_id),
  unique (event_id, member_id)
);
create index on public.event_participants (user_id);

create table public.event_dishes (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  assigned_to uuid references public.event_participants on delete set null,
  recipe_id   uuid references public.recipes on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.event_dishes (event_id);

-- Sem grants de escrita: só draw_secret_santa grava. Cada um vê apenas o próprio sorteado.
create table public.secret_santa_pairs (
  event_id    uuid not null references public.events on delete cascade,
  giver_id    uuid not null references public.event_participants on delete cascade,
  receiver_id uuid not null references public.event_participants on delete cascade,
  primary key (event_id, giver_id),
  check (giver_id <> receiver_id)
);

create function private.event_family(eid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select family_id from public.events where id = eid;
$$;

create function private.is_event_guest(eid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.event_participants where event_id = eid and user_id = (select auth.uid())
  );
$$;

create function private.can_access_event(eid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_member(private.event_family(eid)) or private.is_event_guest(eid);
$$;

-- Evento é colaborativo dentro da família; convidado externo só lê, confirma presença e assume prato.
create function private.can_edit_event(eid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_member(private.event_family(eid));
$$;

create function private.my_participant_id(eid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.event_participants where event_id = eid and user_id = (select auth.uid());
$$;

create function private.participant_in_event(pid uuid, eid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select pid is null or exists (select 1 from public.event_participants where id = pid and event_id = eid);
$$;

create function private.enforce_event_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int;
begin
  perform pg_advisory_xact_lock(hashtextextended('events:' || new.family_id::text, 0));
  lim := (private.family_limits(new.family_id)).max_upcoming_events;
  if lim is not null and (
    select count(*) from public.events where family_id = new.family_id and starts_at >= now()
  ) >= lim then
    raise exception 'Limite de eventos do plano atingido' using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;

create trigger events_limit before insert on public.events
  for each row execute function private.enforce_event_limit();

-- Deriva user_id e nome do membro; ignora o que o cliente mandar nesses campos.
create function private.fill_event_participant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.user_id := null;
  new.invite_token_hash := null;
  if new.member_id is not null then
    if not private.member_in_family(new.member_id, private.event_family(new.event_id)) then
      raise exception 'Membro não pertence à família do evento' using errcode = 'P0001';
    end if;
    select m.user_id, coalesce(m.display_name, p.full_name, new.display_name)
      into new.user_id, new.display_name
    from public.family_members m
    left join public.profiles p on p.id = m.user_id
    where m.id = new.member_id;
    new.guest_email := null;
  end if;
  return new;
end $$;

create trigger event_participants_fill before insert on public.event_participants
  for each row execute function private.fill_event_participant();

-- ---------------------------------------------------------------------------
-- RPCs de evento
-- ---------------------------------------------------------------------------
create function public.create_event_invite(p_participant_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  eid uuid;
  token text;
begin
  select event_id into eid from public.event_participants
  where id = p_participant_id and user_id is null and member_id is null;
  if eid is null or not private.can_edit_event(eid) then
    raise exception 'Convidado inválido' using errcode = '42501';
  end if;
  perform private.rate_limit('create_event_invite', 60, interval '1 hour');
  token := encode(extensions.gen_random_bytes(24), 'hex');
  update public.event_participants set invite_token_hash = extensions.digest(token, 'sha256')
  where id = p_participant_id;
  return token;
end $$;

create function public.accept_event_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  part public.event_participants;
begin
  if uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  perform private.rate_limit('accept_invite', 20, interval '1 hour');
  select * into part from public.event_participants
  where invite_token_hash = extensions.digest(p_token, 'sha256')
  for update;
  if not found or (select coalesce(ends_at, starts_at) + interval '1 day' < now()
                   from public.events where id = part.event_id) then
    raise exception 'Convite inválido ou expirado' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.event_participants where event_id = part.event_id and user_id = uid) then
    raise exception 'Você já participa deste evento' using errcode = 'P0001';
  end if;
  update public.event_participants
  set user_id = uid, invite_token_hash = null, rsvp = 'yes'
  where id = part.id;
  return part.event_id;
end $$;

-- Convidado assume ou larga um prato. Membros da família editam pratos direto na tabela.
create function public.claim_dish(p_dish_id uuid, p_claim boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.event_dishes;
  me uuid;
begin
  select * into d from public.event_dishes where id = p_dish_id for update;
  if not found or not private.can_access_event(d.event_id) then
    raise exception 'Prato não encontrado' using errcode = '42501';
  end if;
  me := private.my_participant_id(d.event_id);
  if me is null then
    raise exception 'Você não participa deste evento' using errcode = '42501';
  end if;
  if p_claim and d.assigned_to is not null and d.assigned_to <> me then
    raise exception 'Prato já assumido por outra pessoa' using errcode = 'P0001';
  end if;
  if not p_claim and d.assigned_to is distinct from me then
    raise exception 'Este prato não é seu' using errcode = 'P0001';
  end if;
  update public.event_dishes set assigned_to = case when p_claim then me end where id = p_dish_id;
end $$;

-- Sorteio em ciclo único: embaralha e cada um tira o próximo. Quem sorteia não vê o resultado.
create function public.draw_secret_santa(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  if not private.can_edit_event(p_event_id)
     or (select type from public.events where id = p_event_id) <> 'secret_santa' then
    raise exception 'Sem permissão para sortear' using errcode = '42501';
  end if;
  select array_agg(id order by random()) into ids
  from public.event_participants where event_id = p_event_id and rsvp <> 'no';
  if coalesce(array_length(ids, 1), 0) < 3 then
    raise exception 'São necessários ao menos 3 participantes' using errcode = 'P0001';
  end if;
  delete from public.secret_santa_pairs where event_id = p_event_id;
  insert into public.secret_santa_pairs (event_id, giver_id, receiver_id)
  select p_event_id, ids[i], ids[i % array_length(ids, 1) + 1]
  from generate_subscripts(ids, 1) as i;
end $$;

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------
alter table public.calendar_items        enable row level security;
alter table public.calendar_participants enable row level security;
alter table public.events                enable row level security;
alter table public.event_participants    enable row level security;
alter table public.event_dishes          enable row level security;
alter table public.secret_santa_pairs    enable row level security;

grant select, delete,
      insert (family_id, title, notes, location_text, starts_at, ends_at, all_day, recurrence, visibility, remind_minutes),
      update (family_id, title, notes, location_text, starts_at, ends_at, all_day, recurrence, visibility, remind_minutes)
  on public.calendar_items to authenticated;
create policy calendar_select on public.calendar_items for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (visibility = 'family' and private.is_member(family_id))
    or private.is_calendar_participant(id)
  );
create policy calendar_insert on public.calendar_items for insert to authenticated
  with check (owner_id = (select auth.uid()) and (family_id is null or private.is_member(family_id)));
create policy calendar_update on public.calendar_items for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (family_id is null or private.is_member(family_id)));
create policy calendar_delete on public.calendar_items for delete to authenticated
  using (owner_id = (select auth.uid()) or (visibility = 'family' and private.is_admin(family_id)));

grant select, insert, delete on public.calendar_participants to authenticated;
create policy cal_part_select on public.calendar_participants for select to authenticated
  using (private.can_see_calendar_item(item_id));
create policy cal_part_insert on public.calendar_participants for insert to authenticated
  with check (private.owns_calendar_item_with_member(item_id, member_id));
create policy cal_part_delete on public.calendar_participants for delete to authenticated
  using (private.owns_calendar_item_with_member(item_id, member_id));

grant select, delete,
      insert (family_id, type, title, description, starts_at, ends_at, location_text),
      update (type, title, description, starts_at, ends_at, location_text)
  on public.events to authenticated;
create policy events_select on public.events for select to authenticated
  using (private.can_access_event(id));
create policy events_insert on public.events for insert to authenticated
  with check (private.is_member(family_id) and created_by = (select auth.uid()));
create policy events_update on public.events for update to authenticated
  using (private.is_member(family_id)) with check (private.is_member(family_id));
create policy events_delete on public.events for delete to authenticated
  using (created_by = (select auth.uid()) or private.is_admin(family_id));

-- guest_email e invite_token_hash não são legíveis pelo app: e-mail de um convidado não vaza para os outros.
grant select (id, event_id, member_id, user_id, display_name, rsvp, created_at),
      insert (event_id, member_id, display_name, guest_email),
      update (display_name, rsvp),
      delete
  on public.event_participants to authenticated;
create policy ev_part_select on public.event_participants for select to authenticated
  using (private.can_access_event(event_id));
create policy ev_part_insert on public.event_participants for insert to authenticated
  with check (private.can_edit_event(event_id));
create policy ev_part_update on public.event_participants for update to authenticated
  using (private.can_edit_event(event_id) or user_id = (select auth.uid()))
  with check (private.can_edit_event(event_id) or user_id = (select auth.uid()));
create policy ev_part_delete on public.event_participants for delete to authenticated
  using (private.can_edit_event(event_id) or user_id = (select auth.uid()));

grant select, delete,
      insert (event_id, name, assigned_to, recipe_id),
      update (name, assigned_to, recipe_id)
  on public.event_dishes to authenticated;
create policy dishes_select on public.event_dishes for select to authenticated
  using (private.can_access_event(event_id));
create policy dishes_insert on public.event_dishes for insert to authenticated
  with check (private.can_edit_event(event_id) and private.participant_in_event(assigned_to, event_id));
create policy dishes_update on public.event_dishes for update to authenticated
  using (private.can_edit_event(event_id))
  with check (private.can_edit_event(event_id) and private.participant_in_event(assigned_to, event_id));
create policy dishes_delete on public.event_dishes for delete to authenticated
  using (private.can_edit_event(event_id));

grant select on public.secret_santa_pairs to authenticated;
create policy santa_select on public.secret_santa_pairs for select to authenticated
  using (giver_id = private.my_participant_id(event_id));

grant execute on function
  private.is_calendar_participant(uuid), private.can_see_calendar_item(uuid),
  private.owns_calendar_item_with_member(uuid, uuid), private.event_family(uuid),
  private.is_event_guest(uuid), private.can_access_event(uuid), private.can_edit_event(uuid),
  private.my_participant_id(uuid), private.participant_in_event(uuid, uuid)
  to authenticated;

grant execute on function
  public.create_event_invite(uuid), public.accept_event_invite(text),
  public.claim_dish(uuid, boolean), public.draw_secret_santa(uuid)
  to authenticated;

-- Home pessoal e da família (telas H01 a H07): pets e cor por pessoa, aceite de compromisso, tarefas,
-- cardápio, metas/hábitos, contas a pagar, mural de recados e central de notificações.

-- ---------------------------------------------------------------------------
-- Membros: pets e cor na agenda
-- ---------------------------------------------------------------------------
alter table public.family_members
  add column kind text not null default 'person' check (kind in ('person', 'pet')),
  add column color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  add constraint pets_have_no_login check (kind = 'person' or user_id is null);

grant insert (kind, color), update (color) on public.family_members to authenticated;

-- Pet não conta no limite de membros do plano.
create or replace function private.enforce_member_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int;
begin
  if new.kind = 'pet' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('members:' || new.family_id::text, 0));
  lim := (private.family_limits(new.family_id)).max_members;
  if lim is not null and (
    select count(*) from public.family_members where family_id = new.family_id and kind = 'person'
  ) >= lim then
    raise exception 'Limite de membros do plano atingido' using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;

create function private.is_my_member(mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.family_members where id = mid and user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Agenda: quem foi incluído aceita ou recusa
-- ---------------------------------------------------------------------------
alter table public.calendar_participants
  add column status text not null default 'pending' check (status in ('pending', 'accepted', 'declined'));

grant update (status) on public.calendar_participants to authenticated;
create policy cal_part_update on public.calendar_participants for update to authenticated
  using (private.is_my_member(member_id)) with check (private.is_my_member(member_id));

-- ---------------------------------------------------------------------------
-- Tarefas
-- ---------------------------------------------------------------------------
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  notes       text check (char_length(notes) <= 1000),
  assigned_to uuid references public.family_members on delete set null,
  due_on      date,
  visibility  public.visibility_scope not null default 'family',
  done_at     timestamptz,
  done_by     uuid references public.profiles on delete set null,
  created_by  uuid not null default auth.uid() references public.profiles on delete cascade,
  created_at  timestamptz not null default now()
);
create index on public.tasks (family_id, due_on);
create index on public.tasks (assigned_to);

-- quem concluiu é sempre quem está logado, não o que o cliente mandar
create function private.stamp_task_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.done_at is not null and old.done_at is null then
    new.done_by := auth.uid();
  elsif new.done_at is null then
    new.done_by := null;
  end if;
  return new;
end $$;

create trigger tasks_stamp_done before update of done_at on public.tasks
  for each row execute function private.stamp_task_done();

create function private.can_see_task(t public.tasks) returns boolean
language sql stable security definer set search_path = '' as $$
  select t.created_by = (select auth.uid())
      or (t.visibility = 'family' and private.is_member(t.family_id))
      or private.is_my_member(t.assigned_to);
$$;

-- ---------------------------------------------------------------------------
-- Cardápio semanal
-- ---------------------------------------------------------------------------
create table public.meal_plan (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families on delete cascade,
  day        date not null,
  meal       text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  -- título copiado da receita: se a receita for apagada, o cardápio continua legível
  title      text not null check (char_length(title) between 1 and 120),
  recipe_id  uuid references public.recipes on delete set null,
  created_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  unique (family_id, day, meal)
);

-- ---------------------------------------------------------------------------
-- Metas e hábitos ("exercitar 3x na semana", "beber 2 L por dia", "dormir 8 h por noite")
-- ---------------------------------------------------------------------------
create table public.goals (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles on delete cascade,
  title      text not null check (char_length(title) between 1 and 80),
  target     numeric not null check (target > 0 and target <= 100000),
  unit       text not null default 'vezes' check (char_length(unit) between 1 and 20),
  period     text not null default 'day' check (period in ('day', 'week')),
  visibility public.visibility_scope not null default 'family',
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.goals (owner_id);

create table public.goal_logs (
  id         uuid primary key default gen_random_uuid(),
  goal_id    uuid not null references public.goals on delete cascade,
  logged_on  date not null default current_date,
  amount     numeric not null check (amount > 0 and amount <= 100000),
  created_at timestamptz not null default now()
);
create index on public.goal_logs (goal_id, logged_on);

create function private.can_see_goal(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.goals g
    where g.id = gid
      and (g.owner_id = (select auth.uid()) or (g.visibility = 'family' and private.shares_family(g.owner_id)))
  );
$$;

create function private.owns_goal(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.goals where id = gid and owner_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Contas a pagar (lembrete com vencimento e responsável; rateio de contas fica para depois)
-- ---------------------------------------------------------------------------
create table public.bills (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families on delete cascade,
  name           text not null check (char_length(name) between 1 and 60),
  category       text check (char_length(category) <= 40),
  amount_cents   bigint check (amount_cents between 1 and 100000000000),
  due_day        smallint not null check (due_day between 1 and 31),
  responsible_id uuid references public.family_members on delete set null,
  active         boolean not null default true,
  created_by     uuid default auth.uid() references public.profiles on delete set null,
  created_at     timestamptz not null default now()
);
create index on public.bills (family_id);

create table public.bill_payments (
  bill_id      uuid not null references public.bills on delete cascade,
  period       date not null check (extract(day from period) = 1),
  amount_cents bigint check (amount_cents between 1 and 100000000000),
  paid_by      uuid default auth.uid() references public.profiles on delete set null,
  paid_at      timestamptz not null default now(),
  primary key (bill_id, period)
);

create function private.bill_family(bid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select family_id from public.bills where id = bid;
$$;

-- ---------------------------------------------------------------------------
-- Mural de recados
-- ---------------------------------------------------------------------------
create table public.family_notices (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  pinned     boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.family_notices (family_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Central de notificações (só o servidor cria; o usuário lê, adia, conclui, apaga)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles on delete cascade,
  family_id     uuid references public.families on delete cascade,
  type          text not null check (type in ('calendar_invite', 'event_invite', 'task_assigned', 'notice',
                                               'member_joined', 'bill_due', 'birthday')),
  title         text not null check (char_length(title) <= 200),
  body          text check (char_length(body) <= 500),
  link          text check (char_length(link) <= 200),
  ref_id        uuid,
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  read_at       timestamptz,
  snoozed_until timestamptz,
  done_at       timestamptz,
  -- evita duplicar os avisos diários (conta vencendo, aniversário)
  dedupe_key    text unique,
  created_at    timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create function private.notify(
  p_user uuid, p_family uuid, p_type text, p_title text, p_body text, p_link text, p_ref uuid,
  p_priority text default 'normal', p_dedupe text default null
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, family_id, type, title, body, link, ref_id, priority, dedupe_key)
  select p_user, p_family, p_type, left(p_title, 200), left(p_body, 500), p_link, p_ref, p_priority, p_dedupe
  where p_user is not null and p_user is distinct from auth.uid()
  on conflict (dedupe_key) do nothing;
$$;

create function private.display_name(uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select full_name from public.profiles where id = uid), 'Alguém');
$$;

create function private.notify_calendar_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
declare item public.calendar_items;
begin
  select * into item from public.calendar_items where id = new.item_id;
  perform private.notify(
    (select user_id from public.family_members where id = new.member_id), item.family_id, 'calendar_invite',
    private.display_name(auth.uid()) || ' incluiu você em: ' || item.title,
    to_char(item.starts_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
    '/agenda', item.id);
  return new;
end $$;

create trigger calendar_participants_notify after insert on public.calendar_participants
  for each row execute function private.notify_calendar_invite();

create function private.notify_event_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ev public.events;
begin
  select * into ev from public.events where id = new.event_id;
  perform private.notify(
    new.user_id, ev.family_id, 'event_invite', 'Você está no evento: ' || ev.title,
    to_char(ev.starts_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
    '/evento/' || ev.id, ev.id);
  return new;
end $$;

create trigger event_participants_notify after insert or update of user_id on public.event_participants
  for each row when (new.user_id is not null) execute function private.notify_event_invite();

create function private.notify_task_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    perform private.notify(
      (select user_id from public.family_members where id = new.assigned_to), new.family_id, 'task_assigned',
      private.display_name(auth.uid()) || ' passou uma tarefa para você: ' || new.title,
      case when new.due_on is not null then 'Até ' || to_char(new.due_on, 'DD/MM') end,
      '/tarefas', new.id);
  end if;
  return new;
end $$;

create trigger tasks_notify after insert or update of assigned_to on public.tasks
  for each row execute function private.notify_task_assigned();

create function private.notify_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(m.user_id, new.family_id, 'notice',
    'Recado de ' || private.display_name(new.author_id), new.body, '/familia-home', new.id,
    case when new.pinned then 'normal' else 'low' end)
  from public.family_members m
  where m.family_id = new.family_id and m.user_id is not null;
  return new;
end $$;

create trigger family_notices_notify after insert on public.family_notices
  for each row execute function private.notify_notice();

create function private.notify_member_joined() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(a.user_id, new.family_id, 'member_joined',
    private.display_name(new.user_id) || ' entrou na família', null, '/familia', new.id)
  from public.family_members a
  where a.family_id = new.family_id and a.role = 'admin' and a.user_id <> new.user_id;
  return new;
end $$;

create trigger family_members_notify_joined after insert on public.family_members
  for each row when (new.user_id is not null) execute function private.notify_member_joined();

-- Rodado 1x por dia (pg_cron): contas vencendo em até 2 dias e aniversários do dia.
create function private.daily_notifications() returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- contas: avisa o responsável, ou todos os adultos se não houver responsável
  insert into public.notifications (user_id, family_id, type, title, body, link, ref_id, priority, dedupe_key)
  select m.user_id, b.family_id, 'bill_due', 'Conta vencendo: ' || b.name,
         'Vence ' || to_char(d.due, 'DD/MM'), '/contas', b.id, 'high',
         'bill:' || b.id || ':' || d.due || ':' || m.user_id
  from public.bills b
  cross join lateral (
    select make_date(extract(year from today)::int, extract(month from today)::int,
                     least(b.due_day, extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))::int)) as due
  ) d
  join public.family_members m on m.family_id = b.family_id and m.user_id is not null
       and (m.id = b.responsible_id or (b.responsible_id is null and m.role in ('admin', 'adult')))
  where b.active and d.due between today and today + 2
    and not exists (select 1 from public.bill_payments p where p.bill_id = b.id and p.period = date_trunc('month', today)::date)
  on conflict (dedupe_key) do nothing;

  -- aniversários: avisa o resto da família
  insert into public.notifications (user_id, family_id, type, title, link, ref_id, priority, dedupe_key)
  select other.user_id, bday.family_id, 'birthday',
         'Hoje é aniversário de ' || coalesce(bday.display_name, p.full_name) || ' 🎂', '/', bday.id, 'normal',
         'bday:' || bday.id || ':' || today || ':' || other.user_id
  from public.family_members bday
  left join public.profiles p on p.id = bday.user_id
  join public.family_members other on other.family_id = bday.family_id and other.user_id is not null
       and other.id <> bday.id
  where to_char(coalesce(bday.birth_date, p.birth_date), 'MM-DD') = to_char(today, 'MM-DD')
  on conflict (dedupe_key) do nothing;
end $$;

create extension if not exists pg_cron with schema pg_catalog;
-- 11:00 UTC = 08:00 em Brasília
select cron.schedule('notificacoes-diarias', '0 11 * * *', 'select private.daily_notifications()');

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------
alter table public.tasks          enable row level security;
alter table public.meal_plan      enable row level security;
alter table public.goals          enable row level security;
alter table public.goal_logs      enable row level security;
alter table public.bills          enable row level security;
alter table public.bill_payments  enable row level security;
alter table public.family_notices enable row level security;
alter table public.notifications  enable row level security;

grant select, delete,
      insert (family_id, title, notes, assigned_to, due_on, visibility),
      update (title, notes, assigned_to, due_on, visibility, done_at)
  on public.tasks to authenticated;
create policy tasks_select on public.tasks for select to authenticated using (private.can_see_task(tasks));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (created_by = (select auth.uid()) and private.is_member(family_id)
              and (assigned_to is null or private.member_in_family(assigned_to, family_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (private.can_see_task(tasks))
  with check (private.is_member(family_id) and (assigned_to is null or private.member_in_family(assigned_to, family_id)));
create policy tasks_delete on public.tasks for delete to authenticated
  using (created_by = (select auth.uid()) or (visibility = 'family' and private.is_admin(family_id)));

grant select, delete, insert (family_id, day, meal, title, recipe_id), update (title, recipe_id)
  on public.meal_plan to authenticated;
create policy meal_select on public.meal_plan for select to authenticated using (private.is_member(family_id));
create policy meal_insert on public.meal_plan for insert to authenticated
  with check (private.is_member(family_id) and created_by = (select auth.uid()));
create policy meal_update on public.meal_plan for update to authenticated
  using (private.is_member(family_id)) with check (private.is_member(family_id));
create policy meal_delete on public.meal_plan for delete to authenticated using (private.is_member(family_id));

grant select, delete, insert (title, target, unit, period, visibility), update (title, target, unit, period, visibility, archived)
  on public.goals to authenticated;
create policy goals_select on public.goals for select to authenticated using (private.can_see_goal(id));
create policy goals_insert on public.goals for insert to authenticated with check (owner_id = (select auth.uid()));
create policy goals_update on public.goals for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy goals_delete on public.goals for delete to authenticated using (owner_id = (select auth.uid()));

grant select, delete, insert (goal_id, logged_on, amount) on public.goal_logs to authenticated;
create policy goal_logs_select on public.goal_logs for select to authenticated using (private.can_see_goal(goal_id));
create policy goal_logs_insert on public.goal_logs for insert to authenticated with check (private.owns_goal(goal_id));
create policy goal_logs_delete on public.goal_logs for delete to authenticated using (private.owns_goal(goal_id));

grant select, delete,
      insert (family_id, name, category, amount_cents, due_day, responsible_id),
      update (name, category, amount_cents, due_day, responsible_id, active)
  on public.bills to authenticated;
create policy bills_select on public.bills for select to authenticated using (private.is_member(family_id));
create policy bills_insert on public.bills for insert to authenticated
  with check (private.is_member(family_id) and created_by = (select auth.uid())
              and (responsible_id is null or private.member_in_family(responsible_id, family_id)));
create policy bills_update on public.bills for update to authenticated
  using (private.is_member(family_id))
  with check (private.is_member(family_id) and (responsible_id is null or private.member_in_family(responsible_id, family_id)));
create policy bills_delete on public.bills for delete to authenticated using (private.is_member(family_id));

grant select, delete, insert (bill_id, period, amount_cents) on public.bill_payments to authenticated;
create policy bill_pay_select on public.bill_payments for select to authenticated
  using (private.is_member(private.bill_family(bill_id)));
create policy bill_pay_insert on public.bill_payments for insert to authenticated
  with check (private.is_member(private.bill_family(bill_id)) and paid_by = (select auth.uid()));
create policy bill_pay_delete on public.bill_payments for delete to authenticated
  using (private.is_member(private.bill_family(bill_id)));

grant select, delete, insert (family_id, body, pinned), update (pinned) on public.family_notices to authenticated;
create policy notices_select on public.family_notices for select to authenticated using (private.is_member(family_id));
create policy notices_insert on public.family_notices for insert to authenticated
  with check (private.is_member(family_id) and author_id = (select auth.uid()));
create policy notices_update on public.family_notices for update to authenticated
  using (author_id = (select auth.uid()) or private.is_admin(family_id))
  with check (private.is_member(family_id));
create policy notices_delete on public.family_notices for delete to authenticated
  using (author_id = (select auth.uid()) or private.is_admin(family_id));

grant select, delete, update (read_at, snoozed_until, done_at) on public.notifications to authenticated;
create policy notif_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notif_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notif_delete on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

create trigger family_notices_rate_limit before insert on public.family_notices
  for each row execute function private.rate_limit_trigger('100', '1 day');

grant execute on function
  private.is_my_member(uuid), private.can_see_task(public.tasks), private.can_see_goal(uuid),
  private.owns_goal(uuid), private.bill_family(uuid)
  to authenticated;

alter publication supabase_realtime add table public.notifications, public.family_notices, public.tasks;

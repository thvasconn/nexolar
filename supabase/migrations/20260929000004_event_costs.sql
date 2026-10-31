-- Rateio de gastos de evento ("vamos comprar o bacalhau e dividir").
--
-- Valores sempre em centavos (bigint). Nada de float.
-- Acerto de contas = gasto do devedor com 100% da parte para o credor (mesmo truque do Splitwise).
-- Finanças da casa (contas, contribuições) ficam para depois da V1.

create type public.split_mode as enum ('equal', 'percent', 'fixed');

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events on delete cascade,
  description  text not null check (char_length(description) between 1 and 120),
  category     text check (char_length(category) <= 40),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  -- cascade só dispara quando o evento inteiro é apagado; remover um participante
  -- com gasto registrado é barrado pelo trigger keep_expense_history
  paid_by      uuid not null references public.event_participants on delete cascade,
  spent_on     date not null default current_date,
  created_by   uuid default auth.uid() references public.profiles on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.expenses (event_id);

create table public.expense_shares (
  expense_id     uuid not null references public.expenses on delete cascade,
  participant_id uuid not null references public.event_participants on delete cascade,
  amount_cents   bigint not null check (amount_cents >= 0),
  primary key (expense_id, participant_id)
);
create index on public.expense_shares (participant_id);

-- Não deixa o histórico de gastos dos outros sumir quando alguém sai do evento.
-- Se o evento inteiro está sendo apagado, ele já não existe e a cascata segue.
create function private.keep_expense_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.events where id = old.event_id)
     and (exists (select 1 from public.expenses where paid_by = old.id)
          or exists (select 1 from public.expense_shares where participant_id = old.id)) then
    raise exception 'Esta pessoa tem gastos registrados. Acerte e apague os gastos antes de remover.'
      using errcode = 'P0001';
  end if;
  return old;
end $$;

create trigger event_participants_keep_expenses before delete on public.event_participants
  for each row execute function private.keep_expense_history();

create function private.expense_event(xid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select event_id from public.expenses where id = xid;
$$;

-- ---------------------------------------------------------------------------
-- RPC: registrar gasto com divisão calculada no servidor.
-- Arredondamento pelo maior resto: a soma das partes é sempre exatamente o total.
-- Qualquer participante (inclusive convidado externo) pode lançar.
-- ---------------------------------------------------------------------------
create function public.add_expense(
  p_event_id     uuid,
  p_description  text,
  p_amount_cents bigint,
  p_paid_by      uuid,
  p_party_ids    uuid[],
  p_split_mode   public.split_mode default 'equal',
  p_weights      numeric[] default null,
  p_category     text default null,
  p_spent_on     date default current_date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  n       int := coalesce(array_length(p_party_ids, 1), 0);
  w       numeric[];
  total_w numeric;
  xid     uuid;
begin
  if auth.uid() is null or not private.can_access_event(p_event_id) then
    raise exception 'Sem acesso ao evento' using errcode = '42501';
  end if;

  if n = 0 or (select count(distinct x) from unnest(p_party_ids) x) <> n then
    raise exception 'Informe participantes sem repetição' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_party_ids || p_paid_by) x
    where x is null or not exists (select 1 from public.event_participants where id = x and event_id = p_event_id)
  ) then
    raise exception 'Participante ou pagador fora do evento' using errcode = 'P0001';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Valor inválido' using errcode = 'P0001';
  end if;
  if p_split_mode = 'equal' then
    w := array_fill(1::numeric, array[n]);
  else
    w := p_weights;
    if coalesce(array_length(w, 1), 0) <> n or exists (select 1 from unnest(w) v where v is null or v < 0) then
      raise exception 'Pesos inválidos' using errcode = 'P0001';
    end if;
  end if;
  select sum(v) into total_w from unnest(w) v;
  if total_w <= 0
     or (p_split_mode = 'percent' and total_w <> 100)
     or (p_split_mode = 'fixed' and total_w <> p_amount_cents) then
    raise exception 'A divisão não fecha com o total' using errcode = 'P0001';
  end if;

  insert into public.expenses (event_id, description, category, amount_cents, paid_by, spent_on)
  values (p_event_id, p_description, p_category, p_amount_cents, p_paid_by, coalesce(p_spent_on, current_date))
  returning id into xid;

  with s as (
    select pid, ord,
           floor(p_amount_cents * wt / total_w)::bigint as base,
           p_amount_cents * wt / total_w - floor(p_amount_cents * wt / total_w) as frac
    from unnest(p_party_ids, w) with ordinality as t(pid, wt, ord)
  ), r as (
    select pid, base,
           row_number() over (order by frac desc, ord) as rn,
           p_amount_cents - sum(base) over () as rest
    from s
  )
  insert into public.expense_shares (expense_id, participant_id, amount_cents)
  select xid, pid, base + (rn <= rest)::int from r;

  return xid;
end $$;

-- Saldo por participante: positivo = tem a receber. Respeita o RLS (security invoker).
create function public.event_balances(p_event_id uuid)
returns table (participant_id uuid, paid_cents bigint, owed_cents bigint, balance_cents bigint)
language sql stable security invoker set search_path = '' as $$
  with e as (
    select * from public.expenses where event_id = p_event_id
  ), paid as (
    select paid_by as pid, sum(amount_cents)::bigint as c from e group by 1
  ), owed as (
    select s.participant_id as pid, sum(s.amount_cents)::bigint as c
    from public.expense_shares s join e on e.id = s.expense_id group by 1
  )
  select coalesce(p.pid, o.pid), coalesce(p.c, 0), coalesce(o.c, 0), coalesce(p.c, 0) - coalesce(o.c, 0)
  from paid p full join owed o on o.pid = p.pid;
$$;

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------
alter table public.expenses       enable row level security;
alter table public.expense_shares enable row level security;

-- Escrita só pelo add_expense. Editar = apagar e lançar de novo.
grant select, delete on public.expenses to authenticated;
create policy expenses_select on public.expenses for select to authenticated
  using (private.can_access_event(event_id));
create policy expenses_delete on public.expenses for delete to authenticated
  using (private.can_access_event(event_id)
         and (created_by = (select auth.uid()) or private.is_admin(private.event_family(event_id))));

grant select on public.expense_shares to authenticated;
create policy shares_select on public.expense_shares for select to authenticated
  using (private.can_access_event(private.expense_event(expense_id)));

grant execute on function private.expense_event(uuid) to authenticated;
grant execute on function
  public.add_expense(uuid, text, bigint, uuid, uuid[], public.split_mode, numeric[], text, date),
  public.event_balances(uuid)
  to authenticated;

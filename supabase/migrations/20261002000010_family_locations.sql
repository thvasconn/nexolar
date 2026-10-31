-- Contrato do mapa: só posições compartilhadas com a família consultada.
-- Desligar o compartilhamento não gera recado, push ou notificação.

-- A exigência de consentimento já existia no INSERT; também vale para UPDATE.
-- A última posição continua salva e pode ser consultada pela própria pessoa.
alter policy locations_update on public.member_locations
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.location_shares s where s.user_id = (select auth.uid()))
  );

-- SECURITY INVOKER preserva o RLS de membros, compartilhamentos, posições e perfis.
-- A foto é um caminho do bucket avatars; o app obtém uma URL assinada para exibir.
create function public.family_locations(p_family_id uuid)
returns table (
  member_id uuid,
  user_id uuid,
  display_name text,
  color text,
  avatar_path text,
  lat double precision,
  lng double precision,
  accuracy_m real,
  recorded_at timestamptz,
  updated_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select m.id, m.user_id, coalesce(m.display_name, p.full_name), m.color, p.avatar_path,
         l.lat, l.lng, l.accuracy_m, l.recorded_at, l.updated_at
  from public.family_members m
  join public.location_shares s on s.family_id = m.family_id and s.user_id = m.user_id
  join public.member_locations l on l.user_id = m.user_id
  join public.profiles p on p.id = m.user_id
  where m.family_id = p_family_id and private.is_member(p_family_id);
$$;

revoke execute on function public.family_locations(uuid) from public, anon;
grant execute on function public.family_locations(uuid) to authenticated;

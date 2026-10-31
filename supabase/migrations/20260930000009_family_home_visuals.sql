-- Dados que faltavam para a home da família do mockup do JV.

-- ---------------------------------------------------------------------------
-- Recados: cada pessoa pode marcar coração e/ou gostei, uma vez por tipo.
-- ---------------------------------------------------------------------------
create table public.family_notice_reactions (
  notice_id  uuid not null references public.family_notices on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles on delete cascade,
  reaction   text not null check (reaction in ('heart', 'like')),
  created_at timestamptz not null default now(),
  primary key (notice_id, user_id, reaction)
);
create index on public.family_notice_reactions (user_id);
alter table public.family_notice_reactions enable row level security;

grant select, delete, insert (notice_id, reaction)
  on public.family_notice_reactions to authenticated;

-- A consulta ao recado respeita o RLS: apenas membros atuais da família.
create policy notice_reactions_select on public.family_notice_reactions for select to authenticated
  using (exists (select 1 from public.family_notices n where n.id = notice_id));
create policy notice_reactions_insert on public.family_notice_reactions for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.family_notices n where n.id = notice_id));
create policy notice_reactions_delete on public.family_notice_reactions for delete to authenticated
  using (user_id = (select auth.uid())
         and exists (select 1 from public.family_notices n where n.id = notice_id));

-- Inclui recados com zero reações; security_invoker preserva o RLS das duas tabelas.
create view public.family_notice_reaction_counts with (security_invoker = true) as
select n.id as notice_id, n.family_id,
       count(*) filter (where r.reaction = 'heart') as heart_count,
       count(*) filter (where r.reaction = 'like') as like_count,
       coalesce(bool_or(r.reaction = 'heart' and r.user_id = (select auth.uid())), false) as hearted_by_me,
       coalesce(bool_or(r.reaction = 'like' and r.user_id = (select auth.uid())), false) as liked_by_me
from public.family_notices n
left join public.family_notice_reactions r on r.notice_id = n.id
group by n.id, n.family_id;

grant select on public.family_notice_reaction_counts to authenticated;

-- ---------------------------------------------------------------------------
-- Agenda: categoria define o ícone no app (sem atrelar o banco à biblioteca de ícones).
-- ---------------------------------------------------------------------------
alter table public.calendar_items
  add column category text not null default 'other'
    check (category in ('education', 'health', 'meal', 'work', 'sport', 'leisure', 'other'));
grant insert (category), update (category) on public.calendar_items to authenticated;

-- ---------------------------------------------------------------------------
-- Fotos: caminhos relativos, nunca URLs públicas.
-- ---------------------------------------------------------------------------
alter table public.events
  add column cover_path text,
  add constraint events_cover_owned check (
    cover_path is null or (cover_path like id::text || '/%' and char_length(cover_path) between 38 and 300)
  );
grant update (cover_path) on public.events to authenticated;

-- Membros com login continuam usando profiles.avatar_path, que só eles editam.
alter table public.family_members
  add column photo_path text,
  add constraint members_photo_managed check (photo_path is null or user_id is null),
  add constraint members_photo_owned check (
    photo_path is null or (photo_path like id::text || '/%' and char_length(photo_path) between 38 and 300)
  );
grant update (photo_path) on public.family_members to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('event-photos', 'event-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('member-photos', 'member-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

-- event-photos/<event_id>/<arquivo>: família gerencia; convidado lê só a capa atual.
create policy event_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'event-photos' and (
    private.can_edit_event(private.to_uuid(private.first_folder(name)))
    or exists (
      select 1 from public.events e
      where e.id = private.to_uuid(private.first_folder(name)) and e.cover_path = name
    )
  ));
create policy event_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'event-photos' and private.can_edit_event(private.to_uuid(private.first_folder(name))));
create policy event_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'event-photos' and private.can_edit_event(private.to_uuid(private.first_folder(name))))
  with check (bucket_id = 'event-photos' and private.can_edit_event(private.to_uuid(private.first_folder(name))));
create policy event_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'event-photos' and private.can_edit_event(private.to_uuid(private.first_folder(name))));

-- member-photos/<member_id>/<arquivo>: família lê; só admin gerencia perfis sem login.
create policy member_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'member-photos' and exists (
    select 1 from public.family_members m
    where m.id = private.to_uuid(private.first_folder(name)) and m.user_id is null
  ));
create policy member_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'member-photos' and exists (
    select 1 from public.family_members m
    where m.id = private.to_uuid(private.first_folder(name)) and m.user_id is null and private.is_admin(m.family_id)
  ));
create policy member_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'member-photos' and exists (
    select 1 from public.family_members m
    where m.id = private.to_uuid(private.first_folder(name)) and m.user_id is null and private.is_admin(m.family_id)
  ))
  with check (bucket_id = 'member-photos' and exists (
    select 1 from public.family_members m
    where m.id = private.to_uuid(private.first_folder(name)) and m.user_id is null and private.is_admin(m.family_id)
  ));
create policy member_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'member-photos' and exists (
    select 1 from public.family_members m
    where m.id = private.to_uuid(private.first_folder(name)) and m.user_id is null and private.is_admin(m.family_id)
  ));

-- Storage: fotos de perfil, da família e de receitas.
--
-- Buckets privados (nada é público por URL). O app baixa com a sessão do usuário ou URL assinada.
-- Convenção de caminho: a primeira pasta identifica o dono.
--   avatars/<user_id>/...        perfil
--   family-photos/<family_id>/... foto da família
--   recipe-photos/<user_id>/...  foto de receita

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',       'avatars',       false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('family-photos', 'family-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('recipe-photos', 'recipe-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

-- Os campos *_path das tabelas só podem apontar para a pasta do próprio dono.
alter table public.profiles add constraint profiles_avatar_owned
  check (avatar_path is null or avatar_path like id::text || '/%');
alter table public.families add constraint families_photo_owned
  check (photo_path is null or photo_path like id::text || '/%');
alter table public.recipes add constraint recipes_photo_owned
  check (photo_path is null or photo_path like owner_id::text || '/%');

create function private.first_folder(object_name text) returns text
language sql immutable set search_path = '' as $$
  select split_part(object_name, '/', 1);
$$;

-- Pasta com nome que não é uuid vira null em vez de erro.
create function private.to_uuid(t text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return t::uuid;
exception when invalid_text_representation then
  return null;
end $$;

grant execute on function private.first_folder(text), private.to_uuid(text) to authenticated;

-- avatars
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (
    private.first_folder(name) = (select auth.uid())::text
    or private.shares_family(private.to_uuid(private.first_folder(name)))
  ));
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and private.first_folder(name) = (select auth.uid())::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and private.first_folder(name) = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and private.first_folder(name) = (select auth.uid())::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and private.first_folder(name) = (select auth.uid())::text);

-- family-photos
create policy family_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'family-photos' and private.is_member(private.to_uuid(private.first_folder(name))));
create policy family_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'family-photos' and private.is_admin(private.to_uuid(private.first_folder(name))));
create policy family_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'family-photos' and private.is_admin(private.to_uuid(private.first_folder(name))))
  with check (bucket_id = 'family-photos' and private.is_admin(private.to_uuid(private.first_folder(name))));
create policy family_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'family-photos' and private.is_admin(private.to_uuid(private.first_folder(name))));

-- recipe-photos: lê quem consegue ver a receita (a subquery respeita o RLS de recipes)
create policy recipe_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'recipe-photos' and (
    private.first_folder(name) = (select auth.uid())::text
    or exists (select 1 from public.recipes r where r.photo_path = name)
  ));
create policy recipe_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-photos' and private.first_folder(name) = (select auth.uid())::text);
create policy recipe_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'recipe-photos' and private.first_folder(name) = (select auth.uid())::text)
  with check (bucket_id = 'recipe-photos' and private.first_folder(name) = (select auth.uid())::text);
create policy recipe_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-photos' and private.first_folder(name) = (select auth.uid())::text);

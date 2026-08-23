-- RAFAHSTUDIO — BRIEFING ONLINE
-- Execute este arquivo inteiro no Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.briefing_links (
  public_token text primary key,
  owner_secret text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.briefings (
  id uuid primary key default gen_random_uuid(),
  owner_secret text not null,
  client_name text not null,
  whatsapp text,
  project_name text not null,
  deadline date,
  service_type text,
  texts text,
  people jsonb not null default '[]'::jsonb,
  references_text text,
  notes text,
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  status text not null default 'Novo'
);

create index if not exists briefings_owner_secret_idx on public.briefings(owner_secret);
create index if not exists briefings_created_at_idx on public.briefings(created_at desc);

alter table public.briefing_links enable row level security;
alter table public.briefings enable row level security;

-- Não permitimos leitura direta das tabelas pelo navegador.
drop policy if exists "public_read_links" on public.briefing_links;
drop policy if exists "public_read_briefings" on public.briefings;
drop policy if exists "public_insert_briefings" on public.briefings;

-- Função chamada pelo RafahStudio para registrar/atualizar o link público.
create or replace function public.register_briefing_link(p_public_token text, p_owner_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(coalesce(p_public_token,'')) < 20 or length(coalesce(p_owner_secret,'')) < 20 then
    raise exception 'Token inválido';
  end if;
  insert into public.briefing_links(public_token, owner_secret)
  values (p_public_token, p_owner_secret)
  on conflict (public_token) do update set owner_secret = excluded.owner_secret;
end;
$$;

-- Cliente envia o briefing usando apenas o token público presente no link.
create or replace function public.submit_briefing(
  p_public_token text,
  p_briefing_id uuid,
  p_client_name text,
  p_whatsapp text,
  p_project_name text,
  p_deadline date,
  p_service_type text,
  p_texts text,
  p_people jsonb,
  p_references_text text,
  p_notes text,
  p_files jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_owner_secret text; v_id uuid;
begin
  select owner_secret into v_owner_secret from public.briefing_links where public_token = p_public_token;
  if v_owner_secret is null then raise exception 'Link de briefing inválido ou expirado'; end if;
  insert into public.briefings(id,owner_secret,client_name,whatsapp,project_name,deadline,service_type,texts,people,references_text,notes,files)
  values(p_briefing_id,v_owner_secret,trim(p_client_name),trim(p_whatsapp),trim(p_project_name),p_deadline,p_service_type,p_texts,coalesce(p_people,'[]'::jsonb),p_references_text,p_notes,coalesce(p_files,'[]'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- Somente o designer que possui o segredo local da conta consegue ler os próprios briefings.
create or replace function public.get_briefings_for_owner(p_owner_secret text)
returns setof public.briefings
language sql
security definer
set search_path = public
as $$
  select * from public.briefings
  where owner_secret = p_owner_secret
  order by created_at desc;
$$;

grant execute on function public.register_briefing_link(text,text) to anon, authenticated;
grant execute on function public.submit_briefing(text,uuid,text,text,text,date,text,text,jsonb,text,text,jsonb) to anon, authenticated;
grant execute on function public.get_briefings_for_owner(text) to anon, authenticated;

-- Storage: bucket já existente. Tornamos público para que as URLs das imagens
-- enviadas possam ser visualizadas/baixadas no painel.
update storage.buckets set public = true where id = 'briefing-files';

drop policy if exists "public_upload_briefing_files" on storage.objects;
create policy "public_upload_briefing_files"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'briefing-files');


-- RAFAHSTUDIO — CATÁLOGO DE REFERÊNCIAS
-- CORREÇÃO: remove versões anteriores das funções para evitar
-- incompatibilidade de nomes/ordem dos parâmetros no schema cache do Supabase.

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  owner_secret text not null,
  title text not null,
  description text,
  image_url text not null,
  created_at timestamptz not null default now()
);
create index if not exists catalog_items_owner_idx on public.catalog_items(owner_secret);
create index if not exists catalog_items_created_idx on public.catalog_items(created_at desc);
alter table public.catalog_items enable row level security;

drop function if exists public.create_catalog_item(text,text,text,text);
drop function if exists public.update_catalog_item(text,uuid,text,text,text);
drop function if exists public.delete_catalog_item(text,uuid);
drop function if exists public.get_catalog_for_owner(text);
drop function if exists public.get_catalog_for_public(text);

create or replace function public.create_catalog_item(
  p_owner_secret text,
  p_title text,
  p_description text,
  p_image_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if length(coalesce(p_owner_secret,'')) < 20 then raise exception 'Segredo inválido'; end if;
  if length(trim(coalesce(p_title,''))) < 1 then raise exception 'Título obrigatório'; end if;
  if length(trim(coalesce(p_image_url,''))) < 5 then raise exception 'Imagem obrigatória'; end if;
  insert into public.catalog_items(owner_secret,title,description,image_url)
  values(p_owner_secret,trim(p_title),nullif(trim(p_description),''),trim(p_image_url))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_catalog_item(
  p_owner_secret text,
  p_id uuid,
  p_title text,
  p_description text,
  p_image_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.catalog_items
  set title=trim(p_title), description=nullif(trim(p_description),''), image_url=trim(p_image_url)
  where id=p_id and owner_secret=p_owner_secret;
  if not found then raise exception 'Item do catálogo não encontrado'; end if;
end;
$$;

create or replace function public.delete_catalog_item(p_owner_secret text,p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.catalog_items where id=p_id and owner_secret=p_owner_secret;
  if not found then raise exception 'Item do catálogo não encontrado'; end if;
end;
$$;

create or replace function public.get_catalog_for_owner(p_owner_secret text)
returns table(id uuid,title text,description text,image_url text,created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select c.id,c.title,c.description,c.image_url,c.created_at
  from public.catalog_items c
  where c.owner_secret=p_owner_secret
  order by c.created_at desc;
$$;

create or replace function public.get_catalog_for_public(p_public_token text)
returns table(id uuid,title text,description text,image_url text,created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select c.id,c.title,c.description,c.image_url,c.created_at
  from public.catalog_items c
  join public.briefing_links l on l.owner_secret=c.owner_secret
  where l.public_token=p_public_token
  order by c.created_at desc;
$$;

grant execute on function public.create_catalog_item(text,text,text,text) to anon, authenticated;
grant execute on function public.update_catalog_item(text,uuid,text,text,text) to anon, authenticated;
grant execute on function public.delete_catalog_item(text,uuid) to anon, authenticated;
grant execute on function public.get_catalog_for_owner(text) to anon, authenticated;
grant execute on function public.get_catalog_for_public(text) to anon, authenticated;

-- ============================================================
-- CONTAS DO RAFAHSTUDIO — Supabase Auth + perfil por usuário
-- Execute esta parte uma vez.
-- ============================================================
create table if not exists public.rafah_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  name text not null default '',
  brand text not null default 'RafahStudio',
  whatsapp text not null default '',
  email text not null default '',
  instagram text not null default '',
  portfolio text not null default '',
  area text not null default 'Designer gráfico',
  bio text not null default '',
  photo text not null default '',
  banner text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rafah_profiles enable row level security;

drop policy if exists "rafah_profiles_select_own" on public.rafah_profiles;
drop policy if exists "rafah_profiles_insert_own" on public.rafah_profiles;
drop policy if exists "rafah_profiles_update_own" on public.rafah_profiles;

create policy "rafah_profiles_select_own" on public.rafah_profiles
for select to authenticated using (id = auth.uid());

create policy "rafah_profiles_insert_own" on public.rafah_profiles
for insert to authenticated with check (id = auth.uid());

create policy "rafah_profiles_update_own" on public.rafah_profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ============================================================
-- RAFAHSTUDIO — PERFIL AUTOMÁTICO PARA CADA CONTA AUTH
-- Esta parte garante que toda conta criada no Supabase Auth
-- receba seu próprio perfil, sem depender do navegador.
-- ============================================================

create or replace function public.handle_new_rafah_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_base text;
  v_suffix integer := 0;
begin
  v_base := lower(regexp_replace(
    coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), split_part(coalesce(new.email,''),'@',1), 'usuario'),
    '[^a-zA-Z0-9_.-]', '', 'g'
  ));
  v_base := left(nullif(v_base,'')::text, 45);
  if v_base is null or v_base = '' then v_base := 'usuario'; end if;
  v_username := v_base;

  while exists (select 1 from public.rafah_profiles where username = v_username) loop
    v_suffix := v_suffix + 1;
    v_username := left(v_base, 39) || '-' || v_suffix::text;
  end loop;

  insert into public.rafah_profiles(
    id, username, name, brand, whatsapp, email, area
  ) values (
    new.id,
    v_username,
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(coalesce(new.email,''),'@',1), 'Designer'),
    'RafahStudio',
    coalesce(new.raw_user_meta_data->>'whatsapp',''),
    coalesce(new.email,''),
    coalesce(nullif(trim(new.raw_user_meta_data->>'area'), ''), 'Designer gráfico')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_rafah on auth.users;
create trigger on_auth_user_created_rafah
after insert on auth.users
for each row execute function public.handle_new_rafah_user();

create or replace function public.set_rafah_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rafah_profiles_updated_at on public.rafah_profiles;
create trigger rafah_profiles_updated_at
before update on public.rafah_profiles
for each row execute function public.set_rafah_profile_updated_at();

-- ============================================================
-- IMPORTANTE:
-- A confirmação de e-mail é uma configuração do Authentication > Providers > Email.
-- Para o primeiro teste, deixe "Confirm email" DESATIVADO.
-- A conta continuará armazenada no Supabase Auth e poderá ser usada em outro dispositivo.
-- ============================================================

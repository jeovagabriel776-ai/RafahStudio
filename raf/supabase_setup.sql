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

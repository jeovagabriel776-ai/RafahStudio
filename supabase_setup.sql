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
declare v_existing_owner text;
begin
  if length(coalesce(p_public_token,'')) < 20 or length(coalesce(p_owner_secret,'')) < 20 then
    raise exception 'Token inválido';
  end if;
  select owner_secret into v_existing_owner
  from public.briefing_links
  where public_token = p_public_token
  for update;
  if v_existing_owner is not null and v_existing_owner <> p_owner_secret then
    raise exception 'Este link já pertence a outro workspace';
  end if;
  insert into public.briefing_links(public_token, owner_secret)
  values (p_public_token, p_owner_secret)
  on conflict (public_token) do nothing;
end;
$$;

-- Cliente envia o briefing usando apenas o token público presente no link.
drop function if exists public.submit_briefing(text,uuid,text,text,text,date,text,text,jsonb,text,text,jsonb);
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
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_secret text;
  v_tracking_token text;
begin
  select owner_secret into v_owner_secret from public.briefing_links where public_token=p_public_token;
  if v_owner_secret is null then raise exception 'Link de briefing inválido ou expirado'; end if;
  insert into public.briefings(id,owner_secret,client_name,whatsapp,project_name,deadline,service_type,texts,people,references_text,notes,files)
  values(p_briefing_id,v_owner_secret,trim(p_client_name),trim(p_whatsapp),trim(p_project_name),p_deadline,p_service_type,p_texts,coalesce(p_people,'[]'::jsonb),p_references_text,p_notes,coalesce(p_files,'[]'::jsonb));
  v_tracking_token := encode(gen_random_bytes(24),'hex');
  insert into public.order_tracking(tracking_token,owner_secret,order_id,public_token,client_name,project_name,service_type,deadline,status,value)
  values(v_tracking_token,v_owner_secret,p_briefing_id::text,p_public_token,trim(p_client_name),trim(p_project_name),trim(p_service_type),p_deadline,'Novo',0);
  return jsonb_build_object('briefing_id',p_briefing_id,'tracking_token',v_tracking_token);
end;
$$;

grant execute on function public.submit_briefing(text,uuid,text,text,text,date,text,text,jsonb,text,text,jsonb) to anon, authenticated;

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
  pix_type text not null default 'CPF',
  pix_key text not null default '',
  pix_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rafah_profiles add column if not exists pix_type text not null default 'CPF';
alter table public.rafah_profiles add column if not exists pix_key text not null default '';
alter table public.rafah_profiles add column if not exists pix_name text not null default '';
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


-- ============================================================
-- LINK CURTO + PERFIL PÚBLICO DO BRIEFING
-- Mantém os dados do perfil fora da URL. O cliente recebe apenas
-- o public_token no #briefing=...
-- ============================================================
create table if not exists public.briefing_public_profiles (
  public_token text primary key references public.briefing_links(public_token) on delete cascade,
  name text not null default 'Designer',
  whatsapp text not null default '',
  instagram text not null default '',
  portfolio text not null default '',
  email text not null default '',
  banner text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.briefing_public_profiles add column if not exists pix_type text not null default 'CPF';
alter table public.briefing_public_profiles add column if not exists pix_key text not null default '';
alter table public.briefing_public_profiles add column if not exists pix_name text not null default '';

alter table public.briefing_public_profiles enable row level security;

drop policy if exists "briefing_public_profiles_no_direct_select" on public.briefing_public_profiles;

drop function if exists public.save_public_profile_link(text,text,text,text,text,text,text);
drop function if exists public.save_public_profile_link(text,text,text,text,text,text,text,text);
drop function if exists public.save_public_profile_link(text,text,text,text,text,text,text,text,text,text,text);

create or replace function public.save_public_profile_link(
  p_public_token text,
  p_owner_secret text,
  p_name text,
  p_whatsapp text,
  p_instagram text,
  p_portfolio text,
  p_email text,
  p_banner text,
  p_pix_type text,
  p_pix_key text,
  p_pix_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_owner_secret text;
begin
  select owner_secret into v_owner_secret from public.briefing_links where public_token=p_public_token;
  if v_owner_secret is null or v_owner_secret <> p_owner_secret then raise exception 'Acesso ao link não autorizado'; end if;
  insert into public.briefing_public_profiles(public_token,name,whatsapp,instagram,portfolio,email,banner,pix_type,pix_key,pix_name)
  values(p_public_token,coalesce(nullif(trim(p_name),''),'Designer'),coalesce(trim(p_whatsapp),''),coalesce(trim(p_instagram),''),coalesce(trim(p_portfolio),''),coalesce(trim(p_email),''),coalesce(trim(p_banner),''),coalesce(trim(p_pix_type),'CPF'),coalesce(trim(p_pix_key),''),coalesce(trim(p_pix_name),''))
  on conflict(public_token) do update set
    name=excluded.name,whatsapp=excluded.whatsapp,instagram=excluded.instagram,
    portfolio=excluded.portfolio,email=excluded.email,banner=excluded.banner,
    pix_type=excluded.pix_type,pix_key=excluded.pix_key,pix_name=excluded.pix_name,updated_at=now();
end;
$$;

create or replace function public.get_public_profile_for_token(p_public_token text)
returns table(name text,whatsapp text,instagram text,portfolio text,email text,banner text)
language sql
security definer
set search_path = public
as $$
  select p.name,p.whatsapp,p.instagram,p.portfolio,p.email,p.banner
  from public.briefing_public_profiles p
  where p.public_token=p_public_token;
$$;

grant execute on function public.save_public_profile_link(text,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.get_public_profile_for_token(text) to anon,authenticated;

-- O estado Finalizado é usado depois do pagamento para indicar que o projeto
-- foi concluído e pode ser enviado ao catálogo.


-- ============================================================
-- RAFAHSTUDIO — ACOMPANHAMENTO PÚBLICO DE PEDIDOS
-- O cliente recebe um token privado e acompanha somente aquele pedido.
create table if not exists public.order_tracking (
  tracking_token text primary key,
  owner_secret text not null,
  order_id text not null,
  public_token text,
  client_name text not null default '',
  project_name text not null default '',
  service_type text not null default '',
  deadline date,
  status text not null default 'Novo',
  value numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists order_tracking_owner_idx on public.order_tracking(owner_secret);
create index if not exists order_tracking_updated_idx on public.order_tracking(updated_at desc);
alter table public.order_tracking enable row level security;
drop policy if exists "order_tracking_no_direct_select" on public.order_tracking;
drop policy if exists "order_tracking_no_direct_insert" on public.order_tracking;
alter table public.order_tracking add column if not exists public_token text;
drop function if exists public.upsert_order_tracking(text,text,text,text,text,text,date,text,numeric);
drop function if exists public.upsert_order_tracking(text,text,text,text,text,text,text,date,text,numeric);
drop function if exists public.get_order_tracking(text);
create or replace function public.upsert_order_tracking(
  p_tracking_token text, p_owner_secret text, p_order_id text, p_public_token text, p_client_name text,
  p_project_name text, p_service_type text, p_deadline date, p_status text, p_value numeric
) returns void language plpgsql security definer set search_path=public as $$
begin
  if length(coalesce(p_tracking_token,'')) < 20 or length(coalesce(p_owner_secret,'')) < 20 then raise exception 'Token inválido'; end if;
  insert into public.order_tracking(tracking_token,owner_secret,order_id,public_token,client_name,project_name,service_type,deadline,status,value)
  values(p_tracking_token,p_owner_secret,p_order_id,p_public_token,trim(p_client_name),trim(p_project_name),trim(p_service_type),p_deadline,coalesce(p_status,'Novo'),coalesce(p_value,0))
  on conflict(tracking_token) do update set
    owner_secret=excluded.owner_secret,order_id=excluded.order_id,public_token=excluded.public_token,client_name=excluded.client_name,
    project_name=excluded.project_name,service_type=excluded.service_type,deadline=excluded.deadline,
    status=excluded.status,value=excluded.value,updated_at=now();
end;$$;
create or replace function public.get_order_tracking(p_tracking_token text)
returns table(tracking_token text,public_token text,client_name text,project_name text,service_type text,deadline date,status text,updated_at timestamptz)
language sql security definer set search_path=public as $$
  select t.tracking_token,t.public_token,t.client_name,t.project_name,t.service_type,t.deadline,t.status,t.updated_at
  from public.order_tracking t where t.tracking_token=p_tracking_token limit 1;
$$;
grant execute on function public.upsert_order_tracking(text,text,text,text,text,text,text,date,text,numeric) to authenticated,anon;
grant execute on function public.get_order_tracking(text) to authenticated,anon;


-- Lookup privado dos tokens de acompanhamento do próprio designer.
drop function if exists public.get_order_tracking_for_owner(text);
create or replace function public.get_order_tracking_for_owner(p_owner_secret text)
returns table(order_id text,tracking_token text,status text,updated_at timestamptz)
language sql security definer set search_path=public as $$
  select t.order_id,t.tracking_token,t.status,t.updated_at
  from public.order_tracking t
  where t.owner_secret=p_owner_secret
  order by t.updated_at desc;
$$;
grant execute on function public.get_order_tracking_for_owner(text) to authenticated;

-- ==========================================================
-- RAFAHSTUDIO 2026 — SINCRONIZAÇÃO ENTRE DISPOSITIVOS
-- ==========================================================
create table if not exists public.rafah_workspace_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.rafah_workspace_state enable row level security;
drop policy if exists "workspace_select_own" on public.rafah_workspace_state;
drop policy if exists "workspace_insert_own" on public.rafah_workspace_state;
drop policy if exists "workspace_update_own" on public.rafah_workspace_state;
create policy "workspace_select_own" on public.rafah_workspace_state for select using (auth.uid()=user_id);
create policy "workspace_insert_own" on public.rafah_workspace_state for insert with check (auth.uid()=user_id);
create policy "workspace_update_own" on public.rafah_workspace_state for update using (auth.uid()=user_id) with check (auth.uid()=user_id);
grant select,insert,update on public.rafah_workspace_state to authenticated;

-- ==========================================================
-- RAFAHSTUDIO 2026 — INTERAÇÕES DO ACOMPANHAMENTO
-- ==========================================================
create table if not exists public.order_tracking_events (
  id bigint generated by default as identity primary key,
  tracking_token text not null,
  owner_secret text not null,
  order_id text not null,
  author text not null check (author in ('designer','client','system')),
  kind text not null check (kind in ('art','alteration','approval','message','status','payment')),
  message text not null default '',
  image_url text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists order_tracking_events_token_idx on public.order_tracking_events(tracking_token,created_at desc);
create index if not exists order_tracking_events_owner_idx on public.order_tracking_events(owner_secret,created_at desc);
alter table public.order_tracking_events add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.order_tracking_events drop constraint if exists order_tracking_events_kind_check;
alter table public.order_tracking_events add constraint order_tracking_events_kind_check check (kind in ('art','alteration','approval','message','status','payment'));
alter table public.order_tracking_events enable row level security;

drop function if exists public.get_order_tracking_events(text);
create or replace function public.get_order_tracking_events(p_tracking_token text)
returns table(id bigint,tracking_token text,order_id text,author text,kind text,message text,image_url text,meta jsonb,created_at timestamptz)
language sql security definer set search_path=public as $$
  select e.id,e.tracking_token,e.order_id,e.author,e.kind,e.message,e.image_url,e.meta,e.created_at
  from public.order_tracking_events e
  where e.tracking_token=p_tracking_token
  order by e.created_at desc
  limit 100;
$$;

drop function if exists public.submit_order_alteration(text,text);
create or replace function public.submit_order_alteration(p_tracking_token text,p_message text)
returns bigint language plpgsql security definer set search_path=public as $$
declare t public.order_tracking%rowtype; v_id bigint;
begin
  select * into t from public.order_tracking where tracking_token=p_tracking_token limit 1;
  if t.tracking_token is null then raise exception 'Pedido não encontrado.'; end if;
  if length(trim(coalesce(p_message,'')))<3 then raise exception 'Descreva a alteração.'; end if;
  if t.status in ('Pago','Finalizado') then raise exception 'Este pedido já foi finalizado.'; end if;
  insert into public.order_tracking_events(tracking_token,owner_secret,order_id,author,kind,message)
  values(t.tracking_token,t.owner_secret,t.order_id,'client','alteration',trim(p_message)) returning id into v_id;
  update public.order_tracking set status='Alteração',updated_at=now() where tracking_token=p_tracking_token;
  return v_id;
end $$;

drop function if exists public.submit_order_message(text,text);
create or replace function public.submit_order_message(p_tracking_token text,p_message text)
returns bigint language plpgsql security definer set search_path=public as $$
declare t public.order_tracking%rowtype; v_id bigint;
begin
  select * into t from public.order_tracking where tracking_token=p_tracking_token limit 1;
  if t.tracking_token is null then raise exception 'Pedido não encontrado.'; end if;
  if length(trim(coalesce(p_message,'')))<1 then raise exception 'Digite uma mensagem.'; end if;
  if t.status in ('Pago','Finalizado') then raise exception 'Este pedido já foi finalizado.'; end if;
  insert into public.order_tracking_events(tracking_token,owner_secret,order_id,author,kind,message)
  values(t.tracking_token,t.owner_secret,t.order_id,'client','message',trim(p_message)) returning id into v_id;
  update public.order_tracking set updated_at=now() where tracking_token=p_tracking_token;
  return v_id;
end $$;

drop function if exists public.submit_order_approval(text,text);
create or replace function public.submit_order_approval(p_tracking_token text,p_message text)
returns bigint language plpgsql security definer set search_path=public as $$
declare t public.order_tracking%rowtype; v_id bigint;
begin
  select * into t from public.order_tracking where tracking_token=p_tracking_token limit 1;
  if t.tracking_token is null then raise exception 'Pedido não encontrado.'; end if;
  if t.status in ('Entregue','Pago','Finalizado') then raise exception 'Este pedido já foi aprovado.'; end if;
  insert into public.order_tracking_events(tracking_token,owner_secret,order_id,author,kind,message)
  values(t.tracking_token,t.owner_secret,t.order_id,'client','approval',coalesce(nullif(trim(p_message),''),'Arte aprovada pelo cliente.')) returning id into v_id;
  update public.order_tracking set status='Entregue',updated_at=now() where tracking_token=p_tracking_token;
  return v_id;
end $$;

drop function if exists public.add_order_tracking_event(text,text,text,text,text);
drop function if exists public.add_order_tracking_event(text,text,text,text,text,jsonb);
create or replace function public.add_order_tracking_event(p_owner_secret text,p_tracking_token text,p_kind text,p_message text,p_image_url text,p_meta jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare t public.order_tracking%rowtype; v_id bigint;
begin
  select * into t from public.order_tracking where tracking_token=p_tracking_token and owner_secret=p_owner_secret limit 1;
  if t.tracking_token is null then raise exception 'Pedido não encontrado ou sem permissão.'; end if;
  if p_kind not in ('art','message','status','payment') then raise exception 'Tipo de atualização inválido.'; end if;
  insert into public.order_tracking_events(tracking_token,owner_secret,order_id,author,kind,message,image_url,meta)
  values(t.tracking_token,t.owner_secret,t.order_id,'designer',p_kind,coalesce(p_message,''),coalesce(p_image_url,''),coalesce(p_meta,'{}'::jsonb)) returning id into v_id;
  if p_kind='art' then update public.order_tracking set status='Esperando aprovação',updated_at=now() where tracking_token=p_tracking_token; end if;
  return v_id;
end $$;

drop function if exists public.get_order_tracking_events_for_owner(text);
create or replace function public.get_order_tracking_events_for_owner(p_owner_secret text)
returns table(id bigint,tracking_token text,order_id text,author text,kind text,message text,image_url text,meta jsonb,created_at timestamptz)
language sql security definer set search_path=public as $$
  select e.id,e.tracking_token,e.order_id,e.author,e.kind,e.message,e.image_url,e.meta,e.created_at
  from public.order_tracking_events e
  where e.owner_secret=p_owner_secret
  order by e.created_at desc
  limit 200;
$$;

grant execute on function public.get_order_tracking_events(text) to anon,authenticated;
grant execute on function public.submit_order_alteration(text,text) to anon,authenticated;
grant execute on function public.submit_order_approval(text,text) to anon,authenticated;
grant execute on function public.submit_order_message(text,text) to anon,authenticated;
grant execute on function public.add_order_tracking_event(text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.get_order_tracking_events_for_owner(text) to authenticated;


-- Segurança: o link público nunca expõe owner_secret.
drop function if exists public.get_order_tracking(text);
create or replace function public.get_order_tracking(p_tracking_token text)
returns table(
  tracking_token text,
  order_id text,
  public_token text,
  client_name text,
  project_name text,
  service_type text,
  deadline date,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql security definer set search_path=public as $$
  select t.tracking_token,t.order_id,t.public_token,t.client_name,t.project_name,t.service_type,
         t.deadline,t.status,t.created_at,t.updated_at
  from public.order_tracking t
  where t.tracking_token=p_tracking_token
  limit 1;
$$;
grant execute on function public.get_order_tracking(text) to anon,authenticated;

-- ==========================================================
-- RAFAHSTUDIO 1.4 — REALTIME SOMENTE POR BROADCAST
-- O cliente não recebe leitura direta das tabelas; o canal usa token privado.
-- ==========================================================

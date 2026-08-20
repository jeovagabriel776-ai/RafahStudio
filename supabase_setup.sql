-- RafahStudio - configuração online do briefing
-- Execute no Supabase SQL Editor.

create table if not exists public.briefings (
  id uuid primary key default gen_random_uuid(),
  owner_token text not null,
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

create index if not exists briefings_owner_token_idx on public.briefings(owner_token);
create index if not exists briefings_created_at_idx on public.briefings(created_at desc);

alter table public.briefings enable row level security;

-- Cliente: pode criar briefing.
drop policy if exists "public_insert_briefings" on public.briefings;
create policy "public_insert_briefings"
on public.briefings
for insert to anon, authenticated
with check (char_length(owner_token) >= 16 and char_length(owner_token) <= 128);

-- O designer lê apenas os briefings associados ao token privado do seu link.
-- O token nunca é exibido como dado de acesso do Storage; ele apenas identifica o workspace.
drop policy if exists "public_select_briefings_by_owner_token" on public.briefings;
create policy "public_select_briefings_by_owner_token"
on public.briefings
for select to anon, authenticated
using (owner_token = current_setting('request.headers', true)::json->>'x-rafah-owner-token');

-- Atualização/remoção também exigem o token do workspace.
drop policy if exists "public_update_briefings_by_owner_token" on public.briefings;
create policy "public_update_briefings_by_owner_token"
on public.briefings
for update to anon, authenticated
using (owner_token = current_setting('request.headers', true)::json->>'x-rafah-owner-token')
with check (owner_token = current_setting('request.headers', true)::json->>'x-rafah-owner-token');

drop policy if exists "public_delete_briefings_by_owner_token" on public.briefings;
create policy "public_delete_briefings_by_owner_token"
on public.briefings
for delete to anon, authenticated
using (owner_token = current_setting('request.headers', true)::json->>'x-rafah-owner-token');

-- Storage: bucket já existente.
-- Se o bucket ainda não existir, crie-o no painel como "briefing-files".
-- Estas policies permitem upload público e leitura apenas para usuários autenticados.
-- Para o teste atual, o site usa URLs públicas dos objetos enviados.
drop policy if exists "public_upload_briefing_files" on storage.objects;
create policy "public_upload_briefing_files"
on storage.objects
for insert to anon
with check (bucket_id = 'briefing-files');

drop policy if exists "designer_view_briefing_files" on storage.objects;
create policy "designer_view_briefing_files"
on storage.objects
for select to authenticated
using (bucket_id = 'briefing-files');

-- IMPORTANTE: não coloque service_role/secret key no HTML ou app.js.

-- Para o briefing conseguir entregar ao designer links diretos dos arquivos
-- nesta versão HTML puro, deixe o bucket de briefing público.
update storage.buckets
set public = true
where id = 'briefing-files';

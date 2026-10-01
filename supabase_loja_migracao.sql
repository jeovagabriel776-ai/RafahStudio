-- ============================================================
-- RAFAHSTUDIO 2026 — BANNERS DA LOJA + PEDIDOS NO WORKSPACE
-- Migração incremental para a versão visual atual.
-- ============================================================
alter table public.rafah_profiles
  add column if not exists store_banners jsonb not null default '[]'::jsonb;

-- A função pública ganhou uma coluna de banners; o DROP é necessário
-- porque o PostgreSQL não permite alterar o tipo de retorno com REPLACE.
drop function if exists public.get_public_profile_for_store(text);
create or replace function public.get_public_profile_for_store(p_store_token text)
returns table(name text,whatsapp text,instagram text,portfolio text,email text,banner text,photo text,store_banners jsonb)
language sql security definer set search_path=public as $$
  select p.name,p.whatsapp,p.instagram,p.portfolio,p.email,p.banner,p.photo,coalesce(p.store_banners,'[]'::jsonb)
  from public.store_links s
  join public.briefing_links l on l.owner_secret=s.owner_secret
  join public.briefing_public_profiles p on p.public_token=l.public_token
  where s.store_token=p_store_token
  limit 1;
$$;
grant execute on function public.get_public_profile_for_store(text) to anon,authenticated;


-- Store banners also need to be available through the public profile used by the storefront.
alter table public.briefing_public_profiles
  add column if not exists store_banners jsonb not null default '[]'::jsonb;

drop function if exists public.save_public_profile_link(text,text,text,text,text,text,text,text,text,text,text,text);
create or replace function public.save_public_profile_link(
  p_public_token text,
  p_owner_secret text,
  p_name text,
  p_whatsapp text,
  p_instagram text,
  p_portfolio text,
  p_email text,
  p_banner text,
  p_photo text,
  p_pix_type text,
  p_pix_key text,
  p_pix_name text,
  p_store_banners jsonb
)
returns void language plpgsql security definer set search_path=public as $$
declare v_owner_secret text;
begin
  select owner_secret into v_owner_secret from public.briefing_links where public_token=p_public_token;
  if v_owner_secret is null or v_owner_secret <> p_owner_secret then raise exception 'Acesso ao link não autorizado'; end if;
  insert into public.briefing_public_profiles(public_token,name,whatsapp,instagram,portfolio,email,banner,photo,pix_type,pix_key,pix_name,store_banners)
  values(p_public_token,coalesce(nullif(trim(p_name),''),'Designer'),coalesce(trim(p_whatsapp),''),coalesce(trim(p_instagram),''),coalesce(trim(p_portfolio),''),coalesce(trim(p_email),''),coalesce(trim(p_banner),''),coalesce(trim(p_photo),''),coalesce(trim(p_pix_type),'CPF'),coalesce(trim(p_pix_key),''),coalesce(trim(p_pix_name),''),coalesce(p_store_banners,'[]'::jsonb))
  on conflict(public_token) do update set
    name=excluded.name,whatsapp=excluded.whatsapp,instagram=excluded.instagram,
    portfolio=excluded.portfolio,email=excluded.email,banner=excluded.banner,photo=excluded.photo,
    pix_type=excluded.pix_type,pix_key=excluded.pix_key,pix_name=excluded.pix_name,
    store_banners=excluded.store_banners,updated_at=now();
end $$;
grant execute on function public.save_public_profile_link(text,text,text,text,text,text,text,text,text,text,text,text,jsonb) to authenticated;

drop function if exists public.get_public_profile_for_store(text);
create or replace function public.get_public_profile_for_store(p_store_token text)
returns table(name text,whatsapp text,instagram text,portfolio text,email text,banner text,photo text,store_banners jsonb)
language sql security definer set search_path=public as $$
  select p.name,p.whatsapp,p.instagram,p.portfolio,p.email,p.banner,p.photo,coalesce(p.store_banners,'[]'::jsonb)
  from public.store_links s
  join public.briefing_links l on l.owner_secret=s.owner_secret
  join public.briefing_public_profiles p on p.public_token=l.public_token
  where s.store_token=p_store_token
  limit 1;
$$;
grant execute on function public.get_public_profile_for_store(text) to anon,authenticated;

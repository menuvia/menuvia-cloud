-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 050 — get_restaurant_by_slug / by_qr_token v2
-- ═══════════════════════════════════════════════════════════════
-- Extinde proiecția celor 2 RPC publice cu noile câmpuri din 049
-- + câmpuri existente care nu erau expuse (tagline, address, hours,
-- theme_settings, pickup_settings, google_review_url etc.).
--
-- ATENȚIE: nu putem folosi `create or replace` când schema RETURN TABLE
-- se modifică — PostgreSQL respinge cu "cannot change return type of
-- existing function". Drop + create explicit.

drop function if exists public.get_restaurant_by_slug(text);
drop function if exists public.get_restaurant_by_qr_token(text);

create function public.get_restaurant_by_slug(p_slug text)
returns table (
  id                uuid,
  name              text,
  slug              text,
  description       text,
  tagline           text,
  address           text,
  phone             text,
  hours             text,
  logo_url          text,
  cover_url         text,
  primary_color     text,
  is_active         boolean,
  qr_token          text,
  currency          text,
  tax_included      boolean,
  language          text,
  socials           jsonb,
  amenities         text[],
  hours_structured  jsonb,
  wifi_password     text,
  timezone          text,
  theme_settings    jsonb,
  pickup_settings   jsonb,
  google_review_url text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id, r.name, r.slug, r.description, r.tagline, r.address, r.phone,
    r.hours, r.logo_url, r.cover_url, r.primary_color, r.is_active,
    r.qr_token, r.currency, r.tax_included, r.language,
    r.socials, r.amenities, r.hours_structured, r.wifi_password, r.timezone,
    r.theme_settings, r.pickup_settings, r.google_review_url
  from public.restaurants r
  where r.slug = p_slug
    and r.is_active = true
  limit 1;
$$;

revoke all on function public.get_restaurant_by_slug(text) from public;
grant execute on function public.get_restaurant_by_slug(text) to anon, authenticated;

comment on function public.get_restaurant_by_slug(text) is
  'v2 (mig 050): proiecție extinsă cu câmpurile editoriale + setări temă/pickup. Fără data leak — doar restaurant activ care matchează slug-ul.';


create function public.get_restaurant_by_qr_token(p_token text)
returns table (
  id                uuid,
  name              text,
  slug              text,
  description       text,
  tagline           text,
  address           text,
  phone             text,
  hours             text,
  logo_url          text,
  cover_url         text,
  primary_color     text,
  is_active         boolean,
  qr_token          text,
  currency          text,
  tax_included      boolean,
  language          text,
  socials           jsonb,
  amenities         text[],
  hours_structured  jsonb,
  wifi_password     text,
  timezone          text,
  theme_settings    jsonb,
  pickup_settings   jsonb,
  google_review_url text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id, r.name, r.slug, r.description, r.tagline, r.address, r.phone,
    r.hours, r.logo_url, r.cover_url, r.primary_color, r.is_active,
    r.qr_token, r.currency, r.tax_included, r.language,
    r.socials, r.amenities, r.hours_structured, r.wifi_password, r.timezone,
    r.theme_settings, r.pickup_settings, r.google_review_url
  from public.restaurants r
  where r.qr_token = p_token
    and r.is_active = true
  limit 1;
$$;

revoke all on function public.get_restaurant_by_qr_token(text) from public;
grant execute on function public.get_restaurant_by_qr_token(text) to anon, authenticated;

comment on function public.get_restaurant_by_qr_token(text) is
  'v2 (mig 050): proiecție extinsă identică cu get_restaurant_by_slug.';

-- ═══════════════════════════════════════════════════════════════════
-- Migration 219: get_restaurant_by_slug expune menu_languages (whitelist limbi pe /m/:slug)
-- ─────────────────────────────────────────────────────────────────────
-- BUG (audit meniu, MEDIUM): meniul public /m/:slug consumă
-- `availableMenuLangs(categories, restaurant.menu_languages)` (PublicMenuPage:307),
-- iar mapper-ul din qr.ts parsează `row.menu_languages` — DAR get_restaurant_by_slug
-- nu proiecta coloana → `menu_languages` ajungea mereu `[]` → whitelist-ul de limbi
-- NU se aplica pe meniul public (o limbă deselectată din setări apărea totuși). Pe
-- QR era corect (resolve_qr_token expune menu_languages din mig 206). Inconsistență.
--
-- Fix: adaug `menu_languages jsonb` în proiecție. Schimbarea semnăturii (coloană nouă
-- în `returns table`) cere DROP + CREATE (create or replace nu poate schimba return type).
-- Păstrez EXACT fix-ul mig 217 (qr_token + wifi_password = null::text, fără leak la anon)
-- și slug-ul case-insensitive (mig 148). FE citește pe nume → ordinea coloanei nu contează.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop function if exists public.get_restaurant_by_slug(text);

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
  google_review_url text,
  menu_languages    jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id, r.name, r.slug, r.description, r.tagline, r.address, r.phone,
    r.hours, r.logo_url, r.cover_url, r.primary_color, r.is_active,
    -- mig 217: qr_token + wifi_password nu se scurg la anon (nefolosite public).
    null::text, r.currency, r.tax_included, r.language,
    r.socials, r.amenities, r.hours_structured, null::text, r.timezone,
    r.theme_settings, r.pickup_settings, r.google_review_url,
    -- mig 219: limbile meniului — publice prin definiție (whitelist pe /m/:slug).
    r.menu_languages
  from public.restaurants r
  where lower(r.slug) = lower(p_slug)
    and r.is_active = true
  limit 1;
$$;

grant execute on function public.get_restaurant_by_slug(text) to anon, authenticated;

-- ── Asserție fail-closed: menu_languages prezent, secretele NU, slug ci, anon ──
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.get_restaurant_by_slug(text)'::regprocedure);
  if position('r.menu_languages' in v_def) = 0 then
    raise exception 'ASSERT FAIL: get_restaurant_by_slug fără menu_languages (mig 219)';
  end if;
  if position('r.wifi_password' in v_def) > 0 or position('r.qr_token' in v_def) > 0 then
    raise exception 'ASSERT FAIL: get_restaurant_by_slug a reintrodus leak-ul wifi/qr_token (mig 217)';
  end if;
  if position('lower(r.slug)' in v_def) = 0 then
    raise exception 'ASSERT FAIL: get_restaurant_by_slug a pierdut slug-ul case-insensitive (mig 148)';
  end if;
  if not has_function_privilege('anon', 'public.get_restaurant_by_slug(text)', 'execute') then
    raise exception 'ASSERT FAIL: get_restaurant_by_slug trebuie apelabil de anon';
  end if;
end $$;

commit;

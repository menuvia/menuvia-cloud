-- ═══════════════════════════════════════════════════════════════════
-- Migration 217: get_restaurant_by_slug — nu mai scurge wifi_password + qr_token la anon
-- ─────────────────────────────────────────────────────────────────────
-- BUG (audit securitate, LOW): get_restaurant_by_slug (grant anon+authenticated,
-- suprafața PUBLICĂ a meniului indexabil pe /m/:slug) proiectează `wifi_password`
-- ȘI `qr_token` din `restaurants` către ORICE client anonim de pe internet. Meniul
-- public NU le folosește: afișează doar badge-ul „are wifi" din `amenities`
-- (PublicMenuPage `amenities.includes('wifi')`), NICIODATĂ parola în sine, iar
-- qr_token-ul de restaurant nu se randează nicăieri public. Asimetrie de securitate:
-- `resolve_qr_token` (mig 206, calea QR de-la-masă, cere token fizic) NU expune
-- wifi_password — dar calea publică pe slug o expune întregului internet.
--
-- Fix minim + sigur: redefinire cu ACEEAȘI semnătură (return type neschimbat →
-- `create or replace` e legal, fără DROP) dar `null::text` pentru cele două câmpuri.
-- Tipurile FE sunt deja nullable (`wifi_password: string | null`, qr.ts) și niciun
-- consumator public nu le citește → zero regresie. Dashboard-ul citește restaurantul
-- pe altă cale (RLS owner / tabela qr_tokens), nu prin acest RPC.
--
-- Redefinire = COPIE EXACTĂ a mig 148 (case-insensitive slug păstrat) cu doar cele
-- 2 expresii din SELECT înlocuite. Semnătura tabelului rămâne identică.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.get_restaurant_by_slug(p_slug text)
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
    -- mig 217: qr_token + wifi_password nu se mai scurg la anon (nefolosite public).
    null::text, r.currency, r.tax_included, r.language,
    r.socials, r.amenities, r.hours_structured, null::text, r.timezone,
    r.theme_settings, r.pickup_settings, r.google_review_url
  from public.restaurants r
  where lower(r.slug) = lower(p_slug)
    and r.is_active = true
  limit 1;
$$;

grant execute on function public.get_restaurant_by_slug(text) to anon, authenticated;

-- ── Asserție fail-closed: proiecția nu mai citește cele 2 coloane sensibile ──
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.get_restaurant_by_slug(text)'::regprocedure);
  if position('r.wifi_password' in v_def) > 0 or position('r.qr_token' in v_def) > 0 then
    raise exception 'ASSERT FAIL: get_restaurant_by_slug încă scurge wifi_password/qr_token la anon (mig 217)';
  end if;
  -- slug case-insensitive păstrat (mig 148)
  if position('lower(r.slug)' in v_def) = 0 then
    raise exception 'ASSERT FAIL: get_restaurant_by_slug a pierdut slug-ul case-insensitive (mig 148)';
  end if;
  if not has_function_privilege('anon', 'public.get_restaurant_by_slug(text)', 'execute') then
    raise exception 'ASSERT FAIL: get_restaurant_by_slug trebuie să rămână apelabil de anon (meniu public)';
  end if;
end $$;

commit;

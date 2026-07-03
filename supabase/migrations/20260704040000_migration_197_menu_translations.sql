-- mig 197 — Meniu multilingv (traduceri manuale)
-- ─────────────────────────────────────────────────────────────────────
-- Feature: restaurantul poate oferi meniul în mai multe limbi. Româna
-- rămâne mereu BAZA (originalul din coloanele name/description). Pentru
-- celelalte limbi (en/de/fr/it/hu/es), traducerile manuale trăiesc într-o
-- coloană jsonb `translations` pe products și categories:
--   { "en": { "name": "...", "description": "..." }, "de": { ... } }
--
-- Restaurantul alege ce limbi expune prin `restaurants.menu_languages`
-- (array jsonb de coduri, ex. ["en","de"]). Româna NU apare în listă —
-- e mereu disponibilă implicit.
--
-- Coloanele moștenesc RLS-ul tabelelor lor (products/categories/restaurants),
-- deci NU adăugăm policies noi. NU atingem coloana `slug` (flux separat, RPC).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

-- ── Coloane noi (idempotent) ────────────────────────────────────────
alter table public.products
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.categories
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.restaurants
  add column if not exists menu_languages jsonb not null default '[]'::jsonb;

-- ── Asserții fail-closed: cele 3 coloane trebuie să existe ───────────
do $$
declare
  v_missing text := '';
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'products'
       and column_name = 'translations'
  ) then
    v_missing := v_missing || ' products.translations';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'categories'
       and column_name = 'translations'
  ) then
    v_missing := v_missing || ' categories.translations';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'restaurants'
       and column_name = 'menu_languages'
  ) then
    v_missing := v_missing || ' restaurants.menu_languages';
  end if;

  if length(v_missing) > 0 then
    raise exception 'mig 197: coloane lipsă:%', v_missing;
  end if;

  raise notice 'mig 197: meniu multilingv OK (products.translations, categories.translations, restaurants.menu_languages)';
end $$;

commit;

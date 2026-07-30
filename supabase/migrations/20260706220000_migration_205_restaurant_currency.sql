-- ═══════════════════════════════════════════════════════════════════
-- Migration 205: restaurants.currency devine funcțională — fundația
-- expansiunii internaționale pe planurile 1–2 (docs/PLAN_1M.md §5bis).
-- ─────────────────────────────────────────────────────────────────────
-- Coloana `currency` EXISTĂ din mig 007 (text not null default 'RON'), e
-- expusă public prin get_restaurant_by_slug, dar era MOARTĂ: fără CHECK,
-- fără grant de UPDATE (nescriibilă de owneri) și ignorată de frontend
-- (prețurile erau „lei" hardcodat). O activăm în loc să creăm un duplicat:
--   1. normalizare defensivă a datelor + CHECK whitelist (monedele piețelor
--      țintă: RON default; EUR; HUF/BGN/MDL vecinii; USD/GBP self-serve).
--   2. grant column-level UPDATE (pattern menu_languages/mig 197 —
--      restaurants e column-gated).
-- Sincronizat în 4 locuri (capcana CLAUDE.md): grant-ul de aici,
-- RESTAURANT_UPDATE_FIELDS (sanitize.ts), testul JS, whitelist-ul SQL F6.
-- Expunerea către clientul QR (proiecția resolve_qr_token) = mig 206.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Normalizare defensivă: orice valoare istorică din afara whitelist-ului
-- (coloana n-a avut CHECK din mig 007) cade pe RON înainte de constrângere.
update public.restaurants
   set currency = 'RON'
 where currency is null
    or currency not in ('RON','EUR','HUF','BGN','MDL','USD','GBP');

alter table public.restaurants
  drop constraint if exists restaurants_currency_check;
alter table public.restaurants
  add constraint restaurants_currency_check
  check (currency in ('RON','EUR','HUF','BGN','MDL','USD','GBP'));

comment on column public.restaurants.currency is
  $$Moneda meniului (mig 007, activată în mig 205). DOAR afișare client-side
(fmtPrice, lib/currency.ts) — abonamentele Stripe și fiscalizarea RO rămân pe
fluxurile lor. Whitelist prin CHECK; extinderea listei = migrație nouă.$$;

-- restaurants e column-gated (096B): coloana cere grant explicit ca ownerul
-- s-o poată seta din Setări.
grant update (currency) on table public.restaurants to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'restaurants'
      and column_name = 'currency'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
  ) then
    raise exception 'ASSERT FAIL: authenticated fără UPDATE pe currency';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurants_currency_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    raise exception 'ASSERT FAIL: CHECK-ul de whitelist pe currency lipsește';
  end if;

  if exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'restaurants'
      and column_name = 'currency'
      and grantee = 'anon' and privilege_type = 'UPDATE'
  ) then
    raise exception 'ASSERT FAIL: anon are UPDATE pe currency';
  end if;

  if exists (select 1 from public.restaurants
             where currency not in ('RON','EUR','HUF','BGN','MDL','USD','GBP')) then
    raise exception 'ASSERT FAIL: rânduri cu monedă în afara whitelist-ului';
  end if;
end $$;

commit;

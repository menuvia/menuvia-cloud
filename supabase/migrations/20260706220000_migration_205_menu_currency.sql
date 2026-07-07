-- ═══════════════════════════════════════════════════════════════════
-- Migration 205: restaurants.menu_currency — fundația expansiunii
-- internaționale pe planurile 1–2 (docs/PLAN_1M.md §„Pista internațională").
-- ─────────────────────────────────────────────────────────────────────
-- Meniul client e deja în 7 limbi (mig 197); bariera rămasă pe partea de
-- client e moneda hardcodată „lei". Coloana + grant column-level (același
-- pattern ca menu_languages — restaurants e column-gated).
-- Whitelist de valori: monedele piețelor țintă (RON default; EUR pentru
-- MD/vest; HUF/BGN/MDL vecinii; USD/GBP self-serve global).
-- Sincronizat în 4 locuri (capcana din CLAUDE.md): grant-ul de aici,
-- RESTAURANT_UPDATE_FIELDS (sanitize.ts), testul JS, whitelist-ul SQL F6.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.restaurants
  add column if not exists menu_currency text not null default 'RON';

alter table public.restaurants
  drop constraint if exists restaurants_menu_currency_check;
alter table public.restaurants
  add constraint restaurants_menu_currency_check
  check (menu_currency in ('RON','EUR','HUF','BGN','MDL','USD','GBP'));

comment on column public.restaurants.menu_currency is
  $$Moneda afișată în meniul public/QR și în coș (mig 205). DOAR afișare
client-side — abonamentele Stripe și fiscalizarea RO rămân pe fluxurile lor.
Whitelist prin CHECK; extinderea listei = migrație nouă.$$;

-- restaurants e column-gated (096B): coloana nouă cere grant explicit.
grant update (menu_currency) on table public.restaurants to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'restaurants'
      and column_name = 'menu_currency'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
  ) then
    raise exception 'ASSERT FAIL: authenticated fără UPDATE pe menu_currency';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurants_menu_currency_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    raise exception 'ASSERT FAIL: CHECK-ul de whitelist pe menu_currency lipsește';
  end if;

  -- anon NU primește UPDATE (doar citire prin RPC-urile publice existente).
  if exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'restaurants'
      and column_name = 'menu_currency'
      and grantee = 'anon' and privilege_type = 'UPDATE'
  ) then
    raise exception 'ASSERT FAIL: anon are UPDATE pe menu_currency';
  end if;
end $$;

commit;

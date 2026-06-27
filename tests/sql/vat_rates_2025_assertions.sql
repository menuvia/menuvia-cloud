-- tests/sql/vat_rates_2025_assertions.sql
-- =============================================================================
-- Aserții pentru mig 102: cotele TVA implicite pentru Legea 141/2025 (11%/21%).
-- Restaurantele NOI trebuie să primească 11 (redus) / 21 (standard) din trigger.
-- Migrația NU face UPDATE pe cotele existente — nu testăm asta (e intenționat).
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/vat_rates_2025_assertions.sql
--
--   V1  restaurant nou → grupa 1 = 11.00, grupa 2 = 21.00
--   V2  grupele 3/4 prezente (rezervă 11, scutit 0) — 4 grupe în total
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1','00v1@vat.test')
  on conflict (id) do nothing;
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('0c000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e1',
   'VAT Test R','vat-test-2025-slug','Cluj',true);

-- ── V1: cota redusă 11, cota standard 21 ─────────────────────────────────────
do $$
declare v_redus numeric; v_std numeric;
begin
  select rate_percent into v_redus from public.vat_rates
    where restaurant_id='0c000000-0000-0000-0000-0000000000e1' and vat_group=1;
  select rate_percent into v_std from public.vat_rates
    where restaurant_id='0c000000-0000-0000-0000-0000000000e1' and vat_group=2;
  if v_redus is distinct from 11.00 then raise exception 'V1 FAIL: grupa 1 = % (așteptat 11.00)', v_redus; end if;
  if v_std   is distinct from 21.00 then raise exception 'V1 FAIL: grupa 2 = % (așteptat 21.00)', v_std; end if;
  raise notice 'V1 OK: cote noi 11 (redus) / 21 (standard)';
end $$;

-- ── V2: toate cele 4 grupe sunt seed-uite ────────────────────────────────────
do $$
declare v_cnt int; v_g3 numeric; v_g4 numeric;
begin
  select count(*) into v_cnt from public.vat_rates
    where restaurant_id='0c000000-0000-0000-0000-0000000000e1';
  if v_cnt <> 4 then raise exception 'V2 FAIL: % grupe (așteptat 4)', v_cnt; end if;
  select rate_percent into v_g3 from public.vat_rates
    where restaurant_id='0c000000-0000-0000-0000-0000000000e1' and vat_group=3;
  select rate_percent into v_g4 from public.vat_rates
    where restaurant_id='0c000000-0000-0000-0000-0000000000e1' and vat_group=4;
  if v_g3 is distinct from 11.00 then raise exception 'V2 FAIL: grupa 3 (rezervă) = % (așteptat 11.00)', v_g3; end if;
  if v_g4 is distinct from 0.00  then raise exception 'V2 FAIL: grupa 4 (scutit) = % (așteptat 0.00)', v_g4; end if;
  raise notice 'V2 OK: 4 grupe (3=rezervă 11, 4=scutit 0)';
end $$;

do $$ begin raise notice '════ vat rates 2025 (L.141/2025) assertions: ALL PASS ════'; end $$;

rollback;

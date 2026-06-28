-- mig 163 — happy_hour_rules: CHECK pe max_discount + days_of_week (P3 round-5)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-5 (happy-hour). max_discount nu avea CHECK (>=0) — o valoare negativă ar
-- inversa logica de plafonare; days_of_week (smallint[]) nu avea range check — valori în afara
-- 1..7 trec validarea doar pe UI. Adăugăm constrângeri DB fail-closed (NOT VALID pe rânduri
-- noi, idempotent — nu eșuează pe eventuale rânduri legacy).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname='chk_hh_max_discount_nonneg' and conrelid='public.happy_hour_rules'::regclass) then
    alter table public.happy_hour_rules
      add constraint chk_hh_max_discount_nonneg
      check (max_discount is null or max_discount >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname='chk_hh_days_valid' and conrelid='public.happy_hour_rules'::regclass) then
    alter table public.happy_hour_rules
      add constraint chk_hh_days_valid
      check (days_of_week <@ array[1,2,3,4,5,6,7]::smallint[]) not valid;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='chk_hh_max_discount_nonneg' and conrelid='public.happy_hour_rules'::regclass)
     or not exists (select 1 from pg_constraint where conname='chk_hh_days_valid' and conrelid='public.happy_hour_rules'::regclass) then
    raise exception 'mig 163: constrângerile happy_hour lipsesc';
  end if;
  raise notice 'mig 163: happy_hour_rules CHECK max_discount>=0 + days_of_week in 1..7 OK';
end $$;

commit;

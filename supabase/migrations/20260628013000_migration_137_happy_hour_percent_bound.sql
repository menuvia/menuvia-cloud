-- mig 137 — Fix P3: plafon percent <=100 pe happy_hour_rules server-side (HH-PCT-1)
--
-- Auditul rundei 3 (stocks_promotions). Limita percent<=100 exista doar client-side (zod);
-- prin PostgREST direct un admin putea seta discount_value > 100 pe discount_type='percent'
-- => totaluri/rapoarte corupte. Adaugam CHECK la nivel de tabel (NOT VALID + VALIDATE).

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_hh_percent_max'
       and conrelid = 'public.happy_hour_rules'::regclass
  ) then
    alter table public.happy_hour_rules
      add constraint chk_hh_percent_max
      check (discount_type <> 'percent' or discount_value <= 100) not valid;
    alter table public.happy_hour_rules
      validate constraint chk_hh_percent_max;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='chk_hh_percent_max'
                  and conrelid='public.happy_hour_rules'::regclass) then
    raise exception 'mig 137: constraint lipseste'; end if;
  raise notice 'mig 137: happy_hour percent <=100 server-side OK';
end $$;
commit;

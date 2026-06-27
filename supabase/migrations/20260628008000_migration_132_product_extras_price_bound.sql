-- mig 132 — Fix P3: limita superioara pe product_extras.price (EXTRA-PRICE-1)
--
-- Auditul rundei 3 (products_menu). product_extras.price are CHECK doar `price >= 0`,
-- fara limita superioara. create_order insumeaza extras in totalul comenzii (la fel ca
-- modifier_options, marginit in mig 120 la [-10000, 10000]). Un extra cu pret aberant
-- (ex. 10^12) poate corupe totaluri/rapoarte sau provoca overflow numeric. Aliniem cu
-- precedentul mig 120 (defense-in-depth pe datele de pret insumate server-side).
--
-- price ramane >= 0 (extra = adaos pozitiv); adaugam doar plafonul superior.
-- NOT VALID + VALIDATE: nu blocheaza scrierile in timpul migratiei pe randuri existente.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

alter table public.product_extras
  add constraint chk_product_extras_price_max
  check (price <= 100000) not valid;

alter table public.product_extras
  validate constraint chk_product_extras_price_max;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_product_extras_price_max'
       and conrelid = 'public.product_extras'::regclass
  ) then
    raise exception 'mig 132: constraint-ul chk_product_extras_price_max lipseste';
  end if;
  raise notice 'mig 132: plafon superior product_extras.price (<=100000) OK';
end $$;

commit;

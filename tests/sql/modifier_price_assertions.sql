-- tests/sql/modifier_price_assertions.sql
-- =============================================================================
-- Asersții pentru MOD-1 (mig 120): public.modifier_options.price_delta (mig 002)
-- era numeric(10,2) FĂRĂ CHECK, deci valori absurde (negative uriașe sau enorme)
-- puteau intra și distorsiona totalul comenzii (create_order, mig 088, însumează
-- price_delta în total). Mig 120 adaugă chk_modifier_price_delta: price_delta
-- între -10000 și 10000 RON.
--
-- Self-contained, ROLLBACK la final.
--
--   MP1  price_delta absurd (1e9 RON) → RESPINS de CHECK
--   MP2  price_delta normal (5.00) și reducere mică (-2.00) → ACCEPTATE
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Setup FK (auth.users → profiles via handle_new_user → restaurant → grup) ──
insert into auth.users (id, email) values
  ('c3c3c3c3-3333-4333-8333-333333333333','owner-mp@mod.test');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('d4d4d4d4-4444-4444-8444-444444444444','c3c3c3c3-3333-4333-8333-333333333333',
   'Rmod','rmod-mp','Cluj',true);

-- Un produs (FK opțional pentru context — price_delta trăiește pe opțiuni).
insert into public.products (id, restaurant_id, name, price) values
  ('e5e5e5e5-5555-4555-8555-555555555555','d4d4d4d4-4444-4444-8444-444444444444',
   'Produs MP', 25.00);

-- Grupul de modificatori (FK direct pentru modifier_options).
insert into public.modifier_groups (id, restaurant_id, name) values
  ('f6f6f6f6-6666-4666-8666-666666666666','d4d4d4d4-4444-4444-8444-444444444444',
   'Extra MP');

-- ── MP1: price_delta absurd (1e9) → respins de chk_modifier_price_delta ───────
do $$
declare v_blocked boolean := false;
begin
  begin
    insert into public.modifier_options (modifier_group_id, name, price_delta) values
      ('f6f6f6f6-6666-4666-8666-666666666666','Suplim absurd', 50000);
  exception when check_violation then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'MP1 FAIL: price_delta=50000 a fost acceptat (CHECK lipsește/inactiv)';
  end if;
  raise notice 'MP1 OK: price_delta peste plafon (50000) respins de chk_modifier_price_delta';
end $$;

-- ── MP2: price_delta normal (5.00) și reducere mică (-2.00) → acceptate ───────
do $$
declare v_count int;
begin
  insert into public.modifier_options (modifier_group_id, name, price_delta) values
    ('f6f6f6f6-6666-4666-8666-666666666666','Supliment', 5.00),
    ('f6f6f6f6-6666-4666-8666-666666666666','Reducere mica', -2.00);

  select count(*) into v_count
    from public.modifier_options
   where modifier_group_id='f6f6f6f6-6666-4666-8666-666666666666';
  if v_count <> 2 then
    raise exception 'MP2 FAIL: așteptam 2 opțiuni acceptate, găsit %', v_count;
  end if;
  raise notice 'MP2 OK: price_delta în interval (5.00 și -2.00) acceptate';
end $$;

do $$ begin raise notice '════ modifier price assertions: ALL PASS ════'; end $$;

rollback;

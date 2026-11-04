-- tests/sql/auto/317_create_order_invalid_extras.sql
-- =============================================================================
-- IX1–IX4 — clichetul PERMANENT al mig 317: create_order respinge extra-urile
-- indisponibile în loc să le sară tăcut. Autonom, ROLLBACK la final.
--
--   IX1  extra disponibil → comanda trece, totalul include prețul extra-ului,
--        linia îl poartă (control pozitiv: refuzul de mai jos nu e un refuz
--        general al extra-urilor).
--   IX2  extra marcat indisponibil → refuz cu hint `invalid_extras`, nicio
--        comandă creată. [PICĂ: verificarea count(*) scoasă — comanda trece,
--        totalul fără extra, exact bug-ul OPT-3]
--   IX3  extra al ALTUI produs (același restaurant) și un uuid inexistent →
--        același refuz (tenancy pe pe.product_id, fix #3 din mig 145).
--   IX4  suprafața: o semnătură de 11 argumente, DEFINER, `public, pg_temp`,
--        anon + authenticated pot executa (create_order e public, mig 297).
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('31700000-0000-4000-8000-0000000000a1', 'ix-owner@ix317.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  values ('31700000-0000-4000-8000-0000000000a1', 'ix-owner@ix317.test')
  on conflict (id) do nothing;
update public.profiles set plan = 'growth'
 where id = '31700000-0000-4000-8000-0000000000a1';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('317b0000-0000-4000-8000-000000000001', '31700000-0000-4000-8000-0000000000a1',
   'IX Bistro', 'ix317-bistro', 'Cluj', true);
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('317c0000-0000-4000-8000-000000000001', '317b0000-0000-4000-8000-000000000001',
   'Masa IX', 'ix317-masa', 4, true);
insert into public.products (id, restaurant_id, category_id, name, price, is_active) values
  ('317d0000-0000-4000-8000-000000000001', '317b0000-0000-4000-8000-000000000001', null, 'Burger IX', 25.00, true),
  ('317d0000-0000-4000-8000-000000000002', '317b0000-0000-4000-8000-000000000001', null, 'Pizza IX', 30.00, true);
insert into public.product_extras (id, product_id, name, price, is_available) values
  ('317e0000-0000-4000-8000-000000000001', '317d0000-0000-4000-8000-000000000001', 'Bacon', 5.00, true),
  ('317e0000-0000-4000-8000-000000000002', '317d0000-0000-4000-8000-000000000001', 'Ou', 3.00, false),
  ('317e0000-0000-4000-8000-000000000003', '317d0000-0000-4000-8000-000000000002', 'Ardei', 2.00, true);

do $$
declare
  v_res jsonb; v_hint text; v_refused boolean; v_n_before int; v_n_after int;
  v_items jsonb;
begin
  perform set_config('request.jwt.claim.sub', '31700000-0000-4000-8000-0000000000a1', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- ── IX1: extra disponibil → trece, cu prețul lui ──────────────────────────
  v_res := public.create_order(
    '317b0000-0000-4000-8000-000000000001', 'waiter', '317c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"317d0000-0000-4000-8000-000000000001","quantity":2,
       "extra_ids":["317e0000-0000-4000-8000-000000000001"]}]'::jsonb,
    null, null, null, null, null);
  if (v_res->>'total')::numeric is distinct from 60.00 then
    raise exception 'IX1 FAIL: totalul ar trebui (25 + 5) × 2 = 60, e %', v_res->>'total';
  end if;
  if not exists (
    select 1 from public.order_items oi, jsonb_array_elements(oi.extras_added) x
     where oi.order_id = (v_res->>'id')::uuid and x->>'extra_name' = 'Bacon'
  ) then
    raise exception 'IX1 FAIL: linia nu poartă extra-ul ales';
  end if;
  raise notice 'IX1 PASS: extra disponibil acceptat, total 60';

  -- ── IX2 / IX3: refuzuri ───────────────────────────────────────────────────
  foreach v_items in array array[
    -- IX2: extra indisponibil (Ou)
    '[{"product_id":"317d0000-0000-4000-8000-000000000001","quantity":1,
       "extra_ids":["317e0000-0000-4000-8000-000000000001","317e0000-0000-4000-8000-000000000002"]}]'::jsonb,
    -- IX3a: extra al altui produs (Ardei e al Pizzei)
    '[{"product_id":"317d0000-0000-4000-8000-000000000001","quantity":1,
       "extra_ids":["317e0000-0000-4000-8000-000000000003"]}]'::jsonb,
    -- IX3b: uuid inexistent
    '[{"product_id":"317d0000-0000-4000-8000-000000000001","quantity":1,
       "extra_ids":["317e0000-0000-4000-8000-0000000000ff"]}]'::jsonb
  ] loop
    select count(*) into v_n_before from public.orders
     where restaurant_id = '317b0000-0000-4000-8000-000000000001';
    v_refused := false; v_hint := null;
    begin
      perform public.create_order(
        '317b0000-0000-4000-8000-000000000001', 'waiter', '317c0000-0000-4000-8000-000000000001', null, null,
        v_items, null, null, null, null, null);
    exception when others then
      get stacked diagnostics v_hint := pg_exception_hint;
      v_refused := true;
    end;
    if not v_refused then
      raise exception 'IX2/IX3 FAIL: create_order a acceptat un extra invalid: %', v_items;
    end if;
    if v_hint is distinct from 'invalid_extras' then
      raise exception 'IX2/IX3 FAIL: hint = %, aștept invalid_extras', v_hint;
    end if;
    select count(*) into v_n_after from public.orders
     where restaurant_id = '317b0000-0000-4000-8000-000000000001';
    if v_n_after <> v_n_before then
      raise exception 'IX2/IX3 FAIL: refuzul a lăsat o comandă în urmă';
    end if;
  end loop;
  raise notice 'IX2 PASS: extra indisponibil respins (invalid_extras)';
  raise notice 'IX3 PASS: extra al altui produs / inexistent respins';
end $$;

-- ── IX4: suprafața ─────────────────────────────────────────────────────────
do $$
declare v_n int; v_proc regprocedure; v_cfg text;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';
  if v_n <> 1 then
    raise exception 'IX4 FAIL: % semnături create_order', v_n;
  end if;
  v_proc := 'public.create_order(uuid, text, uuid, uuid, text, jsonb, uuid, timestamptz, text, text, uuid)'::regprocedure;
  if not (select p.prosecdef from pg_proc p where p.oid = v_proc) then
    raise exception 'IX4 FAIL: create_order nu e SECURITY DEFINER';
  end if;
  select lower(regexp_replace(coalesce(array_to_string(p.proconfig, ','), ''), '[[:space:]]+', '', 'g'))
    into v_cfg from pg_proc p where p.oid = v_proc;
  if v_cfg !~ '(^|,)search_path=public,pg_temp(,|$)' then
    raise exception 'IX4 FAIL: proconfig=%', v_cfg;
  end if;
  if not has_function_privilege('anon', v_proc, 'execute')
     or not has_function_privilege('authenticated', v_proc, 'execute') then
    raise exception 'IX4 FAIL: create_order nu mai e apelabil de anon/authenticated';
  end if;
  raise notice 'IX4 PASS: o semnătură, DEFINER, public+pg_temp, anon+authenticated';
end $$;

rollback;

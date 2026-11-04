-- tests/sql/auto/316_kitchen_ticket_extras.sql
-- =============================================================================
-- KX1–KX4 — clichetul PERMANENT al mig 316: tichetul de bucătărie tipărește
-- extra-urile plătite. Autonom, ROLLBACK la final; rulează pe ambele medii.
--
--   KX1  CAPĂT-LA-CAPĂT prin scriitorul REAL: create_order (ospătar, growth,
--        imprimantă de bucătărie pornită) cu o opțiune și un extra → linia din
--        order_items poartă cheia `extra_name` (forma pe care o scriu toți
--        scriitorii vii), iar tichetul pus în coadă conține „+ Mediu" ȘI
--        „+ Bacon". [PICĂ: subinterogarea readusă pe `x->>'name'` (corpul 227) —
--        tichetul are opțiunea, dar nu extra-ul]
--   KX2  rândurile VECHI (scrise înainte de mig 088, cheia `name`) se tipăresc
--        în continuare; un extra fără nume nu produce o linie goală „+ ";
--        caracterele de control din nume devin spații (un nume nu poate
--        fabrica un rând nou pe tichet). [PICĂ: rezerva pe `name` scoasă]
--   KX3  control pozitiv: o comandă fără extra nu primește nicio linie de
--        extra, doar produsul și opțiunea lui.
--   KX4  suprafața: O SINGURĂ semnătură, SECURITY DEFINER, `public, pg_temp`,
--        fără EXECUTE pentru anon/authenticated (e un helper intern).
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('31600000-0000-4000-8000-0000000000a1', 'kx-owner@kx316.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  values ('31600000-0000-4000-8000-0000000000a1', 'kx-owner@kx316.test')
  on conflict (id) do nothing;
update public.profiles set plan = 'growth'
 where id = '31600000-0000-4000-8000-0000000000a1';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('316b0000-0000-4000-8000-000000000001', '31600000-0000-4000-8000-0000000000a1',
   'KX Bistro', 'kx316-bistro', 'Cluj', true);
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('316c0000-0000-4000-8000-000000000001', '316b0000-0000-4000-8000-000000000001',
   'Masa KX', 'kx316-masa', 4, true);
insert into public.bridge_devices (restaurant_id, name, device_secret, prints_kitchen_receipts) values
  ('316b0000-0000-4000-8000-000000000001', 'Bucatarie KX', 'kx316_secret', true);

insert into public.products (id, restaurant_id, category_id, name, price, is_active) values
  ('316d0000-0000-4000-8000-000000000001', '316b0000-0000-4000-8000-000000000001', null, 'Burger KX', 25.00, true),
  ('316d0000-0000-4000-8000-000000000002', '316b0000-0000-4000-8000-000000000001', null, 'Limonada KX', 10.00, true);
insert into public.product_extras (id, product_id, name, price, is_available) values
  ('316e0000-0000-4000-8000-000000000001', '316d0000-0000-4000-8000-000000000001', 'Bacon', 5.00, true);
insert into public.modifier_groups (id, restaurant_id, name, selection_type, is_required, min_select) values
  ('316f0000-0000-4000-8000-000000000001', '316b0000-0000-4000-8000-000000000001', 'Gatire', 'single', false, 0);
insert into public.modifier_options (id, modifier_group_id, name, price_delta, is_available) values
  ('316f1000-0000-4000-8000-000000000001', '316f0000-0000-4000-8000-000000000001', 'Mediu', 0.00, true);
insert into public.product_modifier_groups (product_id, modifier_group_id) values
  ('316d0000-0000-4000-8000-000000000001', '316f0000-0000-4000-8000-000000000001');

-- ── KX1 + KX3: create_order → tichetul pus în coadă ─────────────────────────
do $$
declare
  v_res jsonb; v_oid uuid; v_res2 jsonb; v_oid2 uuid;
  v_payload text; v_payload2 text; v_key_ok boolean;
begin
  perform set_config('request.jwt.claim.sub', '31600000-0000-4000-8000-0000000000a1', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_res := public.create_order(
    '316b0000-0000-4000-8000-000000000001', 'waiter', '316c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"316d0000-0000-4000-8000-000000000001","quantity":1,
       "option_ids":["316f1000-0000-4000-8000-000000000001"],
       "extra_ids":["316e0000-0000-4000-8000-000000000001"]}]'::jsonb,
    null, null, null, null, null);
  v_oid := (v_res->>'id')::uuid;

  v_res2 := public.create_order(
    '316b0000-0000-4000-8000-000000000001', 'waiter', '316c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"316d0000-0000-4000-8000-000000000002","quantity":2}]'::jsonb,
    null, null, null, null, null);
  v_oid2 := (v_res2->>'id')::uuid;

  -- Trigger-ul de enqueue e DEFERRED: îl forțăm acum, în tranzacția testului.
  set constraints all immediate;

  select exists (
    select 1 from public.order_items oi,
                  jsonb_array_elements(coalesce(oi.extras_added, '[]'::jsonb)) x
     where oi.order_id = v_oid and x->>'extra_name' = 'Bacon'
  ) into v_key_ok;
  if not v_key_ok then
    raise exception 'KX1 FAIL: create_order nu a scris extra-ul cu cheia extra_name (forma s-a schimbat?)';
  end if;

  select payload into v_payload from public.kitchen_tickets where order_id = v_oid;
  if v_payload is null then
    raise exception 'KX1 FAIL: niciun tichet pus în coadă pentru comanda cu extra';
  end if;
  if position('Burger KX' in v_payload) = 0 or position('+ Mediu' in v_payload) = 0 then
    raise exception 'KX1 FAIL (control): tichetul nu are produsul sau opțiunea: %', v_payload;
  end if;
  if position('+ Bacon' in v_payload) = 0 then
    raise exception 'KX1 FAIL: extra-ul plătit lipsește de pe tichet: %', v_payload;
  end if;
  raise notice 'KX1 PASS: create_order → tichet cu opțiunea și extra-ul';

  select payload into v_payload2 from public.kitchen_tickets where order_id = v_oid2;
  if v_payload2 is null or position('2x Limonada KX' in v_payload2) = 0 then
    raise exception 'KX3 FAIL: tichetul comenzii fără extra lipsește sau e incomplet: %', v_payload2;
  end if;
  if position('   + ' in v_payload2) > 0 then
    raise exception 'KX3 FAIL: o comandă fără opțiuni/extra a primit o linie „+": %', v_payload2;
  end if;
  raise notice 'KX3 PASS: fără extra, nicio linie de extra';
end $$;

-- ── KX2: rânduri vechi (`name`), nume gol, caractere de control ─────────────
do $$
declare v_payload text;
begin
  insert into public.orders (id, restaurant_id, source, status, total, table_id)
  values ('316a0000-0000-4000-8000-000000000002', '316b0000-0000-4000-8000-000000000001',
          'waiter', 'new', 30, '316c0000-0000-4000-8000-000000000001');
  insert into public.order_items
    (order_id, product_name_snapshot, quantity, unit_price_snapshot, item_total, extras_added)
  values ('316a0000-0000-4000-8000-000000000002', 'Pizza KX', 1, 25, 30,
          ('[{"name":"Ceapa extra","price":2},'
           || '{"extra_id":null,"extra_name":"","price":0},'
           || '{"extra_name":"Ba\ncon","price":3}]')::jsonb);

  v_payload := public.build_kitchen_ticket_payload('316a0000-0000-4000-8000-000000000002');
  if position('+ Ceapa extra' in v_payload) = 0 then
    raise exception 'KX2 FAIL: extra-ul vechi (cheia name) nu mai apare: %', v_payload;
  end if;
  if position('+ Ba con' in v_payload) = 0 then
    raise exception 'KX2 FAIL: caracterul de control din numele extra-ului nu a fost înlocuit: %', v_payload;
  end if;
  if v_payload ~ ('\+ ' || chr(10)) or v_payload ~ '\+ $' then
    raise exception 'KX2 FAIL: un extra fără nume a produs o linie goală: %', v_payload;
  end if;
  raise notice 'KX2 PASS: rânduri vechi, nume gol, caractere de control';
end $$;

-- ── KX4: suprafața, pe catalog ──────────────────────────────────────────────
do $$
declare v_n int; v_proc regprocedure; v_cfg text;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'build_kitchen_ticket_payload';
  if v_n <> 1 then
    raise exception 'KX4 FAIL: % semnături build_kitchen_ticket_payload', v_n;
  end if;
  v_proc := 'public.build_kitchen_ticket_payload(uuid, boolean)'::regprocedure;
  if not (select p.prosecdef from pg_proc p where p.oid = v_proc) then
    raise exception 'KX4 FAIL: nu e SECURITY DEFINER';
  end if;
  select lower(regexp_replace(coalesce(array_to_string(p.proconfig, ','), ''), '[[:space:]]+', '', 'g'))
    into v_cfg from pg_proc p where p.oid = v_proc;
  if v_cfg !~ '(^|,)search_path=public,pg_temp(,|$)' then
    raise exception 'KX4 FAIL: proconfig=%', v_cfg;
  end if;
  if has_function_privilege('anon', v_proc, 'execute')
     or has_function_privilege('authenticated', v_proc, 'execute') then
    raise exception 'KX4 FAIL: helperul e apelabil din client';
  end if;
  raise notice 'KX4 PASS: o semnătură, DEFINER, public+pg_temp, fără EXECUTE din client';
end $$;

rollback;

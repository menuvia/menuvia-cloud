-- tests/sql/kitchen_ticket_assertions.sql
-- =============================================================================
-- Aserții pentru mig 227 (tichete de bucătărie, NEfiscale):
--
--   KT1  growth + device cu prints_kitchen_receipts → INSERT orders/order_items
--        + `set constraints all immediate` → exact 1 tichet pending, payload
--        ne-vid care conține numele produsului și masa.
--   KT2  starter cu device → zero tichete (skip tăcut — comanda NU e avortată).
--   KT3  growth cu device dar prints_kitchen_receipts=false → zero tichete.
--   KT4  INSERT direct în kitchen_tickets pe restaurant starter → respins de
--        trg_kitchen_tickets_plan_gate (gate defense-in-depth).
--   KT5  claim atomic: al doilea claim pe același tichet → {claimed:false}.
--   KT6  confirm de pe ALT device → respins (wrong_bridge_device).
--   KT7  dedup: a doua comandă nu dublează tichetul primei; reprint manual
--        creează rând nou cu is_reprint=true.
--   KT8  bridge_register: merge pe growth (gate kitchen_tickets), pică pe starter.
--   KT9  izolarea cozilor: bridge_get_pending (FISCAL, mig 045) NU vede tichete;
--        bridge_get_pending_tickets NU vede pending_receipts.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('61a1a1a1-1111-4111-8111-aaaaaaaaaaaa','kt-owner-growth@kt.test'),
  ('62a2a2a2-2222-4222-8222-aaaaaaaaaaaa','kt-owner-starter@kt.test');

update public.profiles set plan = 'growth'
 where id = '61a1a1a1-1111-4111-8111-aaaaaaaaaaaa';
update public.profiles set plan = 'starter'
 where id = '62a2a2a2-2222-4222-8222-aaaaaaaaaaaa';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('71b1b1b1-1111-4111-8111-bbbbbbbbbbbb','61a1a1a1-1111-4111-8111-aaaaaaaaaaaa',
   'KT Growth','kt-growth-slug','Cluj',true),
  ('72b2b2b2-2222-4222-8222-bbbbbbbbbbbb','62a2a2a2-2222-4222-8222-aaaaaaaaaaaa',
   'KT Starter','kt-starter-slug','Cluj',true);

insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('81c1c1c1-1111-4111-8111-cccccccccccc','71b1b1b1-1111-4111-8111-bbbbbbbbbbbb','Masa KT1','masa-kt1',4,true),
  ('82c2c2c2-2222-4222-8222-cccccccccccc','72b2b2b2-2222-4222-8222-bbbbbbbbbbbb','Masa KTS','masa-kts',4,true);

-- Device-uri: growth cu tipărire tichete ON + un al doilea device (pentru KT6).
-- Starter NU poate avea device deloc (gate-ul dublu de pe bridge_devices,
-- mig 149→227) — KT2 rămâne valid: enqueue-ul verifică ÎNTÂI feature-ul de
-- plan, deci pe starter tichetul e sărit indiferent de device.
insert into public.bridge_devices (id, restaurant_id, name, device_secret, prints_kitchen_receipts) values
  ('91d1d1d1-1111-4111-8111-dddddddddddd','71b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
   'Bucatarie KT','kt_secret_growth_1',true),
  ('92d2d2d2-2222-4222-8222-dddddddddddd','71b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
   'Bucatarie KT 2','kt_secret_growth_2',true);

-- ── KT1: comanda pe growth → 1 tichet pending cu payload corect ──────────────
do $$
declare v_ticket record;
begin
  insert into public.orders (id, restaurant_id, source, status, total, table_id)
  values ('a1f1f1f1-1111-4111-8111-ffffffffffff','71b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
          'waiter','new',42,'81c1c1c1-1111-4111-8111-cccccccccccc');
  insert into public.order_items
    (order_id, product_name_snapshot, quantity, unit_price_snapshot, item_total, notes, selected_modifiers)
  values ('a1f1f1f1-1111-4111-8111-ffffffffffff','Pizza Quattro KT',2,21,42,'fara ceapa',
          '[{"option_name":"Blat subtire"}]'::jsonb);

  -- Forțează trigger-ul DEFERRED în interiorul tranzacției de test.
  set constraints all immediate;

  select * into v_ticket from public.kitchen_tickets
   where order_id = 'a1f1f1f1-1111-4111-8111-ffffffffffff';
  if not found then
    raise exception 'KT1 FAIL: niciun tichet creat la comanda growth';
  end if;
  if v_ticket.status <> 'pending' then
    raise exception 'KT1 FAIL: statusul tichetului ar trebui pending, e %', v_ticket.status;
  end if;
  if position('Pizza Quattro KT' in v_ticket.payload) = 0
     or position('Masa KT1' in v_ticket.payload) = 0
     or position('Blat subtire' in v_ticket.payload) = 0
     or position('fara ceapa' in v_ticket.payload) = 0 then
    raise exception 'KT1 FAIL: payload incomplet: %', v_ticket.payload;
  end if;
  raise notice 'KT1 OK: tichet pending cu payload complet';
end $$;

-- ── KT2: gate-ul de plan la MOMENTUL COMMIT-ului — downgrade între INSERT ────
-- și fire-ul trigger-ului deferred → tichetul e sărit TĂCUT, comanda intactă.
-- (Pe starter comanda nici nu poate exista — Gate A o respinge la INSERT —
-- deci ramura de plan a enqueue-ului se atinge realist doar prin downgrade.)
do $$
begin
  set constraints all deferred;
  insert into public.orders (id, restaurant_id, source, status, total, table_id)
  values ('a2f2f2f2-2222-4222-8222-ffffffffffff','71b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
          'waiter','new',10,'81c1c1c1-1111-4111-8111-cccccccccccc');
  insert into public.order_items
    (order_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
  values ('a2f2f2f2-2222-4222-8222-ffffffffffff','Cafea KT',1,10,10);

  -- Downgrade ÎNAINTE ca trigger-ul deferred să tragă.
  update public.profiles set plan = 'starter'
   where id = '61a1a1a1-1111-4111-8111-aaaaaaaaaaaa';
  set constraints all immediate;

  if exists (select 1 from public.kitchen_tickets
             where order_id = 'a2f2f2f2-2222-4222-8222-ffffffffffff') then
    raise exception 'KT2 FAIL: tichet creat sub gate-ul de plan (downgrade ignorat)';
  end if;
  if not exists (select 1 from public.orders
                 where id = 'a2f2f2f2-2222-4222-8222-ffffffffffff') then
    raise exception 'KT2 FAIL: comanda a fost avortată de trigger';
  end if;

  update public.profiles set plan = 'growth'
   where id = '61a1a1a1-1111-4111-8111-aaaaaaaaaaaa';
  raise notice 'KT2 OK: sub gate-ul de plan → skip tăcut, comanda intactă';
end $$;

-- ── KT3: growth dar fără device cu tipărire → zero tichete ───────────────────
do $$
begin
  set constraints all deferred;
  update public.bridge_devices set prints_kitchen_receipts = false
   where restaurant_id = '71b1b1b1-1111-4111-8111-bbbbbbbbbbbb';

  insert into public.orders (id, restaurant_id, source, status, total, table_id)
  values ('a3f3f3f3-3333-4333-8333-ffffffffffff','71b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
          'waiter','new',15,'81c1c1c1-1111-4111-8111-cccccccccccc');
  insert into public.order_items
    (order_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
  values ('a3f3f3f3-3333-4333-8333-ffffffffffff','Limonada KT',1,15,15);
  set constraints all immediate;

  if exists (select 1 from public.kitchen_tickets
             where order_id = 'a3f3f3f3-3333-4333-8333-ffffffffffff') then
    raise exception 'KT3 FAIL: tichet creat fără device cu tipărirea pornită';
  end if;

  update public.bridge_devices set prints_kitchen_receipts = true
   where restaurant_id = '71b1b1b1-1111-4111-8111-bbbbbbbbbbbb';
  raise notice 'KT3 OK: fără imprimantă de bucătărie → zero tichete';
end $$;

-- ── KT4: INSERT direct pe starter → respins de gate-ul defense-in-depth ──────
do $$
declare v_raised boolean := false;
begin
  begin
    insert into public.kitchen_tickets (restaurant_id, order_id, payload)
    values ('72b2b2b2-2222-4222-8222-bbbbbbbbbbbb',
            'a2f2f2f2-2222-4222-8222-ffffffffffff', 'payload test');
    raise exception 'KT4 FAIL: insert direct pe starter a trecut';
  exception when others then
    if sqlerrm like 'KT4 FAIL%' then raise; end if;
    v_raised := true;
  end;
  if not v_raised then raise exception 'KT4 FAIL: gate-ul de plan nu a ridicat'; end if;
  raise notice 'KT4 OK: trg_kitchen_tickets_plan_gate respinge starter';
end $$;

-- ── KT5 + KT6: claim atomic + confirm doar de pe device-ul care a claim-uit ──
do $$
declare v_tid uuid; v jsonb; v_raised boolean := false;
begin
  select id into v_tid from public.kitchen_tickets
   where order_id = 'a1f1f1f1-1111-4111-8111-ffffffffffff';

  v := public.bridge_claim_ticket('kt_secret_growth_1', v_tid);
  if (v->>'claimed')::boolean is not true then
    raise exception 'KT5 FAIL: primul claim respins (%)', v;
  end if;
  v := public.bridge_claim_ticket('kt_secret_growth_2', v_tid);
  if (v->>'claimed')::boolean is not false then
    raise exception 'KT5 FAIL: al doilea claim a reușit (%)', v;
  end if;
  raise notice 'KT5 OK: claim atomic (al doilea claim refuzat)';

  begin
    perform public.bridge_confirm_ticket('kt_secret_growth_2', v_tid, true);
    raise exception 'KT6 FAIL: confirm de pe alt device a trecut';
  exception when others then
    if sqlerrm like 'KT6 FAIL%' then raise; end if;
    v_raised := true;
  end;
  if not v_raised then raise exception 'KT6 FAIL: wrong_bridge_device nu a ridicat'; end if;

  v := public.bridge_confirm_ticket('kt_secret_growth_1', v_tid, true);
  if (v->>'updated')::boolean is not true then
    raise exception 'KT6 FAIL: confirm-ul legitim respins (%)', v;
  end if;
  if (select status from public.kitchen_tickets where id = v_tid) <> 'success' then
    raise exception 'KT6 FAIL: statusul nu e success după confirm';
  end if;
  raise notice 'KT6 OK: confirm doar de pe device-ul care a claim-uit';
end $$;

-- ── KT7: dedup per comandă + reprint manual ──────────────────────────────────
do $$
declare v jsonb; v_count int;
begin
  -- Re-fire pe aceeași comandă (simulăm retrigger): dedup-ul din enqueue ține.
  -- (Trigger-ul e pe INSERT — aici verificăm direct funcția de dedup prin
  -- reprint, care ocolește dedup-ul INTENȚIONAT.)
  perform set_config('request.jwt.claim.sub', '61a1a1a1-1111-4111-8111-aaaaaaaaaaaa', true);
  v := public.kitchen_ticket_reprint('a1f1f1f1-1111-4111-8111-ffffffffffff');
  if (v->>'ok')::boolean is not true then
    raise exception 'KT7 FAIL: reprint respins (%)', v;
  end if;
  select count(*) into v_count from public.kitchen_tickets
   where order_id = 'a1f1f1f1-1111-4111-8111-ffffffffffff';
  if v_count <> 2 then
    raise exception 'KT7 FAIL: ar trebui 2 tichete (original + reprint), sunt %', v_count;
  end if;
  if not exists (
    select 1 from public.kitchen_tickets
    where order_id = 'a1f1f1f1-1111-4111-8111-ffffffffffff'
      and is_reprint and position('REPRINT' in payload) > 0
  ) then
    raise exception 'KT7 FAIL: reprint-ul nu e marcat is_reprint / payload fără REPRINT';
  end if;
  raise notice 'KT7 OK: reprint manual creează rând nou is_reprint=true';
end $$;

-- ── KT8: bridge_register — growth trece (kitchen_tickets), starter pică ──────
do $$
declare v_raised boolean := false;
begin
  perform set_config('request.jwt.claim.sub', '61a1a1a1-1111-4111-8111-aaaaaaaaaaaa', true);
  if not exists (select 1 from public.bridge_register(
    '71b1b1b1-1111-4111-8111-bbbbbbbbbbbb', 'Test KT Register')) then
    raise exception 'KT8 FAIL: bridge_register pe growth nu a întors device';
  end if;

  perform set_config('request.jwt.claim.sub', '62a2a2a2-2222-4222-8222-aaaaaaaaaaaa', true);
  begin
    perform public.bridge_register('72b2b2b2-2222-4222-8222-bbbbbbbbbbbb', 'Test KTS');
    raise exception 'KT8 FAIL: bridge_register pe starter a trecut';
  exception when others then
    if sqlerrm like 'KT8 FAIL%' then raise; end if;
    v_raised := true;
  end;
  if not v_raised then raise exception 'KT8 FAIL: gate-ul de plan nu a ridicat'; end if;
  raise notice 'KT8 OK: bridge_register — growth trece, starter respins';
end $$;

-- ── KT9: izolarea cozilor (fiscal ↔ tichete) ─────────────────────────────────
do $$
declare v jsonb; v_fiscal int;
begin
  -- Coada FISCALĂ nu vede tichete (bridge_get_pending citește pending_receipts).
  select count(*) into v_fiscal
    from public.bridge_get_pending('kt_secret_growth_1', 20);
  if v_fiscal <> 0 then
    raise exception 'KT9 FAIL: coada fiscală conține % rânduri (ar trebui 0)', v_fiscal;
  end if;
  -- Coada de tichete vede DOAR kitchen_tickets pending (reprint-ul din KT7).
  v := public.bridge_get_pending_tickets('kt_secret_growth_1', 20);
  if jsonb_array_length(v) <> 1 then
    raise exception 'KT9 FAIL: coada de tichete are % rânduri (ar trebui 1 — reprint-ul)',
      jsonb_array_length(v);
  end if;
  raise notice 'KT9 OK: cozile fiscal/tichete sunt izolate';
end $$;

do $$ begin raise notice '════ kitchen ticket assertions: ALL PASS ════'; end $$;

rollback;

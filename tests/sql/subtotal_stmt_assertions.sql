-- tests/sql/subtotal_stmt_assertions.sql
-- =============================================================================
-- Aserții pentru mig 248 — order_items_subtotal_sync trecut de la FOR EACH ROW
-- la FOR EACH STATEMENT (transition tables). Garantează:
--   SS1  insert multi-linie ÎNTR-UN singur statement → total post-discount corect.
--   SS2  update de linie → recompute corect.
--   SS3  delete parțial și total → recompute corect (0 items → total 0).
--   SS4  structural: 3 triggere statement-level, vechiul row-level dispărut.
--   SS5  amplificare redusă: un insert de 3 linii într-un statement produce UN
--        singur UPDATE pe orders (=> 1 rând audit_log UPDATE), nu 3.
--
-- `_refresh_order_totals` (mig 031) e neatins — verificăm că granularitatea nouă
-- păstrează EXACT aceeași aritmetică. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('e5510000-0000-4000-8000-0000000005a0','ss-owner@ss.test');
update public.profiles set plan = 'enterprise'
 where id = 'e5510000-0000-4000-8000-0000000005a0';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('e5510000-0000-4000-8000-000000000501','e5510000-0000-4000-8000-0000000005a0',
   'SS Bistro','ss-bistro-slug','Cluj',true);

insert into public.products (id, restaurant_id, name, price, is_active)
values ('e5510000-0000-4000-8000-0000000005b0','e5510000-0000-4000-8000-000000000501',
        'Produs SS', 10, true);

-- Comandă cu reducere 'amount' 10 lei, source='waiter' (evită happy-hour, care e
-- doar qr/pickup) — izolează efectul trigger-ului de subtotal.
insert into public.orders (id, restaurant_id, source, status, discount_type, discount_value)
values ('e5510000-0000-4000-8000-0000000005c0','e5510000-0000-4000-8000-000000000501',
        'waiter','new','amount',10);

-- ── SS5 baseline: câte rânduri audit UPDATE pe această comandă înainte de items ──
-- (le numărăm și după insertul multi-linie ca să dovedim delta = 1.)
do $$
declare
  v_before int;
  v_after  int;
begin
  select count(*) into v_before
    from public.audit_log
   where table_name = 'orders'
     and row_id = 'e5510000-0000-4000-8000-0000000005c0'
     and operation = 'UPDATE';

  -- SS1: TREI linii într-UN SINGUR statement (subtotal 10+25+5 = 40; discount 10 → total 30).
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
  values
    ('e5510000-0000-4000-8000-0000000005c0','e5510000-0000-4000-8000-0000000005b0','Produs SS',1,10,10),
    ('e5510000-0000-4000-8000-0000000005c0','e5510000-0000-4000-8000-0000000005b0','Produs SS',1,25,25),
    ('e5510000-0000-4000-8000-0000000005c0','e5510000-0000-4000-8000-0000000005b0','Produs SS',1,5,5);

  if (select total from public.orders where id='e5510000-0000-4000-8000-0000000005c0') <> 30
     or (select discount_amount from public.orders where id='e5510000-0000-4000-8000-0000000005c0') <> 10 then
    raise exception 'SS1 FAIL: insert multi-linie → total=% discount=% (așteptat 30/10)',
      (select total from public.orders where id='e5510000-0000-4000-8000-0000000005c0'),
      (select discount_amount from public.orders where id='e5510000-0000-4000-8000-0000000005c0');
  end if;

  select count(*) into v_after
    from public.audit_log
   where table_name = 'orders'
     and row_id = 'e5510000-0000-4000-8000-0000000005c0'
     and operation = 'UPDATE';

  -- SS5: 3 linii într-un statement ⇒ UN singur UPDATE pe orders (row-level ar fi dat 3).
  if v_after - v_before <> 1 then
    raise exception 'SS5 FAIL: insert de 3 linii a produs % UPDATE-uri pe orders (așteptat 1)', v_after - v_before;
  end if;
  raise notice 'SS1+SS5 OK: insert multi-linie → total 30, un singur UPDATE pe orders';
end $$;

-- ── SS2: update de linie (5 → 45) → subtotal 80, total 70 ─────────────────────
do $$
begin
  update public.order_items set item_total = 45, unit_price_snapshot = 45
   where order_id = 'e5510000-0000-4000-8000-0000000005c0' and item_total = 5;
  if (select total from public.orders where id='e5510000-0000-4000-8000-0000000005c0') <> 70 then
    raise exception 'SS2 FAIL: după update total=% (așteptat 70)',
      (select total from public.orders where id='e5510000-0000-4000-8000-0000000005c0');
  end if;
  raise notice 'SS2 OK: update de linie recalculează total=70';
end $$;

-- ── SS3: delete parțial (2 linii într-un statement) apoi total ───────────────
do $$
begin
  -- Ștergem liniile de 10 și 25 într-un singur statement → rămâne 45 → total 35.
  delete from public.order_items
   where order_id = 'e5510000-0000-4000-8000-0000000005c0' and item_total in (10, 25);
  if (select total from public.orders where id='e5510000-0000-4000-8000-0000000005c0') <> 35 then
    raise exception 'SS3a FAIL: după delete parțial total=% (așteptat 35)',
      (select total from public.orders where id='e5510000-0000-4000-8000-0000000005c0');
  end if;

  -- Ștergem tot → subtotal 0 → discount least(0,10)=0 → total 0.
  delete from public.order_items where order_id = 'e5510000-0000-4000-8000-0000000005c0';
  if (select total from public.orders where id='e5510000-0000-4000-8000-0000000005c0') <> 0
     or (select discount_amount from public.orders where id='e5510000-0000-4000-8000-0000000005c0') <> 0 then
    raise exception 'SS3b FAIL: după delete total → total=% discount=% (așteptat 0/0)',
      (select total from public.orders where id='e5510000-0000-4000-8000-0000000005c0'),
      (select discount_amount from public.orders where id='e5510000-0000-4000-8000-0000000005c0');
  end if;
  raise notice 'SS3 OK: delete parțial → 35, delete total → 0';
end $$;

-- ── SS4: structural — 3 triggere statement-level, vechiul row-level dispărut ──
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.order_items'::regclass
     and not tgisinternal
     and tgname like 'order_items_subtotal_sync_%'
     and (tgtype & 1) = 0;  -- bit 0 = 0 → statement-level
  if v_n <> 3 then
    raise exception 'SS4 FAIL: aștept 3 triggere statement-level, găsit %', v_n;
  end if;
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.order_items'::regclass
                and tgname = 'order_items_subtotal_sync') then
    raise exception 'SS4 FAIL: vechiul trigger row-level încă există';
  end if;
  raise notice 'SS4 OK: 3 triggere statement-level, row-level dispărut';
end $$;

rollback;

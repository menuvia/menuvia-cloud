-- tests/sql/payments_by_method_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 267 — defalcarea pe metodă vine din REGISTRUL
-- de plăți (`order_payments`), nu din enum-ul `orders.payment_method`.
--
--   PM1  comandă cu SPLIT (cash + card) apare defalcată corect, NU în „Alte
--        metode" — regresia măsurată pe producție (88 lei clasificați greșit).
--   PM2  comandă FĂRĂ registru (istoric) cade pe `orders.payment_method` —
--        ramura B; fără ea s-ar pierde 94% din venitul istoric.
--   PM3  defalcarea ÎNCHIDE cu `revenue` pentru ambele forme de comandă.
--   PM4  `v_daily_payments_by_method` bucketează pe ziua ÎNCASĂRII (paid_at),
--        nu pe ziua creării — o comandă deschisă ieri și plătită azi e venit azi.
--   PM5  contractul de coloane al lui `v_daily_orders` e neschimbat (AnalyticsTab
--        face `select('*')`) și include cele 5 găleți.
--   PM6  gate fiscal: un restaurant fără `fiscal_receipt` NU apare în niciunul
--        dintre view-uri (regula de aur — banii sunt Plan 3).
--   PM7  suprafață: `anon` nu are SELECT pe view-urile noi.
--   PM8  PARITATE RLS: proprietar, ospătar și fondator (platform admin FĂRĂ
--        membership) văd ACELAȘI split. Singura aserție din fișier care rulează
--        sub RLS — restul rulează ca `postgres`, care o ocolește și e ORB la
--        clasa asta de regresie.
--   PM9  comandă `paid` cu `paid_amount` NULL intră în defalcare pe `total` și
--        ziua închide (altfel banii dispar din găleți dar rămân în venit).
--
-- Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('9c000000-0000-4000-8000-0000000000a0','pm-owner@pm.test'),
  ('9c000000-0000-4000-8000-0000000000a1','pm-free@pm.test');
update public.profiles set plan = 'enterprise' where id = '9c000000-0000-4000-8000-0000000000a0';
update public.profiles set plan = 'growth'     where id = '9c000000-0000-4000-8000-0000000000a1';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('9c000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-0000000000a0',
   'PM Bistro','pm-bistro-slug','Cluj',true),
  -- Al doilea local e pe growth: NU are `fiscal_receipt`, deci nu are voie să
  -- apară în view-urile de bani (PM6).
  ('9c000000-0000-4000-8000-000000000002','9c000000-0000-4000-8000-0000000000a1',
   'PM Growth','pm-growth-slug','Cluj',true);

insert into public.products (id, restaurant_id, name, price, is_active) values
  ('9c000000-0000-4000-8000-0000000000b0','9c000000-0000-4000-8000-000000000001','Produs PM',50,true),
  ('9c000000-0000-4000-8000-0000000000b1','9c000000-0000-4000-8000-000000000002','Produs PMG',30,true);

-- ── PM1: comandă cu SPLIT (41 card_pos + 47 cash = 88) ───────────────────────
-- Exact forma din producție care a produs bug-ul: `orders.payment_method` e
-- 'other' (metode mixte), dar banii sunt cash ȘI card.
do $$
declare v_cash numeric; v_card numeric; v_other numeric; v_rev numeric;
begin
  insert into public.orders (id, restaurant_id, source, status, payment_method,
                             paid_amount, paid_at)
  values ('9c000000-0000-4000-8000-0000000000d1','9c000000-0000-4000-8000-000000000001',
          'waiter','paid','other',88,'2026-03-10 12:00:00+02');
  insert into public.order_items (order_id, product_id, product_name_snapshot,
                                  quantity, unit_price_snapshot, item_total)
  values ('9c000000-0000-4000-8000-0000000000d1','9c000000-0000-4000-8000-0000000000b0',
          'Produs PM',1,88,88);
  insert into public.order_payments (order_id, amount, method) values
    ('9c000000-0000-4000-8000-0000000000d1',41,'card_pos'),
    ('9c000000-0000-4000-8000-0000000000d1',47,'cash');

  select coalesce(sum(amount) filter (where method='cash'),0),
         coalesce(sum(amount) filter (where method='card_pos'),0),
         coalesce(sum(amount) filter (where method not in ('cash','card_pos','meal_voucher','card_online')),0)
    into v_cash, v_card, v_other
    from public.v_order_payment_methods
   where order_id = '9c000000-0000-4000-8000-0000000000d1';

  if v_cash <> 47 or v_card <> 41 or v_other <> 0 then
    raise exception 'PM1 FAIL: split raportat cash=% card=% alte=% (așteptat 47/41/0 — enum-ul „other" nu mai are voie să înghită banii)',
      v_cash, v_card, v_other;
  end if;

  -- Și la nivel de zi, în v_daily_orders (ce citește AnalyticsTab).
  select cash_revenue, card_revenue, other_revenue, revenue
    into v_cash, v_card, v_other, v_rev
    from public.v_daily_orders
   where restaurant_id = '9c000000-0000-4000-8000-000000000001';
  if v_cash <> 47 or v_card <> 41 or v_other <> 0 or v_rev <> 88 then
    raise exception 'PM1 FAIL (v_daily_orders): cash=% card=% alte=% venit=% (așteptat 47/41/0/88)',
      v_cash, v_card, v_other, v_rev;
  end if;
  raise notice 'PM1 OK: split-ul se defalcă 47 cash + 41 card, nu 88 în „Alte metode"';
end $$;

-- ── PM2 + PM3: comandă FĂRĂ registru cade pe enum-ul comenzii ────────────────
do $$
declare v_cash numeric; v_rev numeric; v_break numeric; v_from_ledger boolean;
begin
  insert into public.orders (id, restaurant_id, source, status, payment_method,
                             paid_amount, paid_at)
  values ('9c000000-0000-4000-8000-0000000000d2','9c000000-0000-4000-8000-000000000001',
          'waiter','paid','cash',50,'2026-03-10 13:00:00+02');
  insert into public.order_items (order_id, product_id, product_name_snapshot,
                                  quantity, unit_price_snapshot, item_total)
  values ('9c000000-0000-4000-8000-0000000000d2','9c000000-0000-4000-8000-0000000000b0',
          'Produs PM',1,50,50);
  -- DELIBERAT fără order_payments: forma istorică (23 din 25 de comenzi plătite
  -- din producție la data migrației).

  select amount, from_ledger into v_cash, v_from_ledger
    from public.v_order_payment_methods
   where order_id = '9c000000-0000-4000-8000-0000000000d2';
  if v_cash is distinct from 50 or v_from_ledger is distinct from false then
    raise exception 'PM2 FAIL: comanda fără registru raportată amount=% from_ledger=% (așteptat 50/false)',
      v_cash, v_from_ledger;
  end if;
  raise notice 'PM2 OK: comanda fără registru cade pe orders.payment_method';

  -- PM3: defalcarea închide cu venitul pe ziua cu AMBELE forme (88 + 50 = 138).
  select revenue,
         cash_revenue + card_revenue + voucher_revenue + online_revenue + other_revenue
    into v_rev, v_break
    from public.v_daily_orders
   where restaurant_id = '9c000000-0000-4000-8000-000000000001';
  if v_rev <> 138 or v_break <> 138 then
    raise exception 'PM3 FAIL: venit=% defalcare=% (așteptat 138/138 — dacă nu închid, operatorul vede bani „dispăruți")',
      v_rev, v_break;
  end if;
  raise notice 'PM3 OK: defalcarea închide cu venitul (138 = 47+41+50)';
end $$;

-- ── PM4: v_daily_payments_by_method bucketează pe ziua ÎNCASĂRII ─────────────
do $$
declare v_day date; v_total numeric; v_cash numeric; v_rows int;
begin
  -- Comandă CREATĂ pe 9 martie, ÎNCASATĂ pe 11 martie. Trebuie să apară pe 11.
  insert into public.orders (id, restaurant_id, source, status, payment_method,
                             paid_amount, created_at, paid_at)
  values ('9c000000-0000-4000-8000-0000000000d3','9c000000-0000-4000-8000-000000000001',
          'waiter','paid','meal_voucher',30,'2026-03-09 20:00:00+02','2026-03-11 09:00:00+02');
  insert into public.order_items (order_id, product_id, product_name_snapshot,
                                  quantity, unit_price_snapshot, item_total)
  values ('9c000000-0000-4000-8000-0000000000d3','9c000000-0000-4000-8000-0000000000b0',
          'Produs PM',1,30,30);

  select count(*) into v_rows from public.v_daily_payments_by_method
   where restaurant_id = '9c000000-0000-4000-8000-000000000001' and day = '2026-03-09';
  if v_rows <> 0 then
    raise exception 'PM4 FAIL: încasarea a aterizat pe ziua CREĂRII (9 martie), nu pe ziua plății';
  end if;

  select day, total_revenue into v_day, v_total
    from public.v_daily_payments_by_method
   where restaurant_id = '9c000000-0000-4000-8000-000000000001' and day = '2026-03-11';
  if v_day is null or v_total <> 30 then
    raise exception 'PM4 FAIL: ziua 11 martie lipsește sau total=% (așteptat 30)', v_total;
  end if;

  -- Ziua de 10 martie ține split-ul + cash-ul: 47 cash, 41 card, total 138.
  select cash_revenue, total_revenue into v_cash, v_total
    from public.v_daily_payments_by_method
   where restaurant_id = '9c000000-0000-4000-8000-000000000001' and day = '2026-03-10';
  if v_cash <> 97 or v_total <> 138 then
    raise exception 'PM4 FAIL: 10 martie cash=% total=% (așteptat 97/138)', v_cash, v_total;
  end if;
  raise notice 'PM4 OK: agregatul zilnic bucketează pe paid_at (Europe/Bucharest)';
end $$;

-- ── PM5: contractul de coloane al lui v_daily_orders ─────────────────────────
do $$
declare v_cols text[];
begin
  select array_agg(a.attname::text order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.v_daily_orders'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from array['restaurant_id','day','total_orders','qr_orders',
                                   'waiter_orders','revenue','cash_revenue','card_revenue',
                                   'voucher_revenue','online_revenue','other_revenue'] then
    raise exception 'PM5 FAIL: v_daily_orders și-a schimbat coloanele: % (AnalyticsTab face select(*))', v_cols;
  end if;
  raise notice 'PM5 OK: contractul de coloane al lui v_daily_orders e intact';
end $$;

-- ── PM6: gate fiscal — growth NU apare în view-urile de bani ─────────────────
do $$
declare v_n int;
begin
  insert into public.orders (id, restaurant_id, source, status, paid_amount, paid_at)
  values ('9c000000-0000-4000-8000-0000000000d4','9c000000-0000-4000-8000-000000000002',
          'waiter','closed',30,'2026-03-10 14:00:00+02');
  insert into public.order_items (order_id, product_id, product_name_snapshot,
                                  quantity, unit_price_snapshot, item_total)
  values ('9c000000-0000-4000-8000-0000000000d4','9c000000-0000-4000-8000-0000000000b1',
          'Produs PMG',1,30,30);

  select count(*) into v_n from public.v_order_payment_methods
   where restaurant_id = '9c000000-0000-4000-8000-000000000002';
  if v_n <> 0 then
    raise exception 'PM6 FAIL: restaurantul growth apare în v_order_payment_methods (% rânduri) — regula de aur', v_n; end if;

  select count(*) into v_n from public.v_daily_payments_by_method
   where restaurant_id = '9c000000-0000-4000-8000-000000000002';
  if v_n <> 0 then
    raise exception 'PM6 FAIL: restaurantul growth apare în v_daily_payments_by_method (% rânduri)', v_n; end if;
  raise notice 'PM6 OK: gate fiscal — growth nu apare în view-urile de bani';
end $$;

-- ── PM7: suprafață — anon nu vede banii ──────────────────────────────────────
do $$
declare v_name text;
begin
  foreach v_name in array array['v_order_payment_methods','v_daily_payments_by_method','v_daily_orders'] loop
    if has_table_privilege('anon', ('public.' || v_name)::regclass, 'SELECT') then
      raise exception 'PM7 FAIL: anon poate citi % (bani pe suprafața publică)', v_name; end if;
    if not has_table_privilege('authenticated', ('public.' || v_name)::regclass, 'SELECT') then
      raise exception 'PM7 FAIL: authenticated NU poate citi %', v_name; end if;
  end loop;
  raise notice 'PM7 OK: view-urile de bani sunt doar pentru authenticated';
end $$;

-- ── PM9: comandă `paid` cu `paid_amount` NULL intră în defalcare ─────────────
-- Forma producibilă printr-un PATCH direct pe PostgREST (`orders: admin all`) și
-- prezentă istoric înainte de mig 264. Cu guardul vechi (`paid_amount is not
-- null`) dispărea din TOATE view-urile, dar ReportsTab o număra în venit
-- (`paid_amount ?? total`) — deci găleţile nu mai închideau cu titlul de
-- deasupra lor, o REGRESIE față de bucketarea client-side veche.
do $$
declare v_amt numeric; v_rev numeric; v_break numeric;
begin
  insert into public.orders (id, restaurant_id, source, status, payment_method,
                             paid_amount, created_at, paid_at)
  values ('9c000000-0000-4000-8000-0000000000d5','9c000000-0000-4000-8000-000000000001',
          'waiter','paid', null, null, '2026-03-12 12:00:00+02','2026-03-12 12:30:00+02');
  insert into public.order_items (order_id, product_id, product_name_snapshot,
                                  quantity, unit_price_snapshot, item_total)
  values ('9c000000-0000-4000-8000-0000000000d5','9c000000-0000-4000-8000-0000000000b0',
          'Produs PM',1,60,60);

  select amount into v_amt from public.v_order_payment_methods
   where order_id = '9c000000-0000-4000-8000-0000000000d5';
  if v_amt is distinct from 60 then
    raise exception 'PM9 FAIL: comanda paid cu paid_amount NULL raportează amount=% (așteptat 60 din total)', v_amt;
  end if;

  select revenue,
         cash_revenue + card_revenue + voucher_revenue + online_revenue + other_revenue
    into v_rev, v_break
    from public.v_daily_orders
   where restaurant_id = '9c000000-0000-4000-8000-000000000001'
     and day = '2026-03-12';
  if v_rev <> 60 or v_break <> 60 then
    raise exception 'PM9 FAIL: ziua 12 martie venit=% defalcare=% (așteptat 60/60)', v_rev, v_break;
  end if;
  raise notice 'PM9 OK: comanda fără sumă înregistrată intră în defalcare pe `total`, iar ziua închide';
end $$;

-- ── PM8: PARITATE RLS — fondatorul vede ACELAȘI split ca proprietarul ────────
-- Cea mai importantă aserție din fișier, și singura care rulează sub RLS: restul
-- suitei rulează ca `postgres` (superuser), deci NU poate vedea clasa asta.
-- `order_payments: member read` (mig 017) inline-a un check pe
-- `restaurant_memberships`, fără escape-urile funelului (186/187). Sub
-- `security_invoker`, fondatorul vedea comenzile dar ZERO plăți → ramura A goală,
-- anti-join-ul ramurii B adevărat pentru tot → view-ul cădea pe enum, adică fix
-- clasificarea greșită. Totalurile reconciliau (88 = 88), deci nimic altceva
-- nu putea prinde regresia.
insert into auth.users (id, email) values
  ('9c000000-0000-4000-8000-0000000000a2','pm-waiter@pm.test'),
  ('9c000000-0000-4000-8000-0000000000a3','pm-founder@pm.test');
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('9c000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-0000000000a2','waiter');
-- Fondator de platformă: FĂRĂ membership, exact ca în founder-view (membership
-- sintetică, injectată doar în RestaurantContext).
update public.profiles set is_platform_admin = true
 where id = '9c000000-0000-4000-8000-0000000000a3';

do $$
declare
  v_uid text; v_cash numeric; v_card numeric; v_other numeric; v_who text;
begin
  foreach v_uid in array array['9c000000-0000-4000-8000-0000000000a0',  -- owner
                               '9c000000-0000-4000-8000-0000000000a2',  -- waiter
                               '9c000000-0000-4000-8000-0000000000a3']  -- fondator
  loop
    v_who := case v_uid
               when '9c000000-0000-4000-8000-0000000000a0' then 'owner'
               when '9c000000-0000-4000-8000-0000000000a2' then 'waiter'
               else 'fondator (platform admin, fără membership)' end;
    perform set_config('request.jwt.claim.sub', v_uid, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;

    select coalesce(sum(amount) filter (where method='cash'),0),
           coalesce(sum(amount) filter (where method='card_pos'),0),
           coalesce(sum(amount) filter (where method not in
             ('cash','card_pos','meal_voucher','card_online')),0)
      into v_cash, v_card, v_other
      from public.v_order_payment_methods
     where order_id = '9c000000-0000-4000-8000-0000000000d1';

    reset role;

    if v_cash <> 47 or v_card <> 41 or v_other <> 0 then
      raise exception 'PM8 FAIL: % vede cash=% card=% alte=% (așteptat 47/41/0 — asimetria RLS readuce clasificarea pe enum)',
        v_who, v_cash, v_card, v_other;
    end if;
    raise notice 'PM8: % vede 47 cash / 41 card', v_who;
  end loop;
  raise notice 'PM8 OK: paritate RLS — proprietar, ospătar și fondator văd ACELAȘI split';
end $$;

rollback;

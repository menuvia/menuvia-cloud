-- tests/sql/daily_payments_rpc_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 268 — RPC-ul sargabil de defalcare zilnică.
--
--   DP1  ECHIVALENȚĂ: RPC-ul întoarce EXACT aceleași cifre ca
--        `v_daily_payments_by_method` pe același interval. Asta e aserția
--        centrală: un fix de performanță care schimbă REZULTATUL nu e un fix.
--   DP2  granițele intervalului sunt INCLUSIVE la ambele capete, în fusul
--        României — o încasare la 23:59:30 în ultima zi TREBUIE inclusă
--        (jumătate-deschis la dreapta pe `p_to + 1 zi`).
--   DP3  o încasare din AFARA intervalului nu intră (nici cu o zi înainte,
--        nici cu una după).
--   DP4  gate fiscal MOȘTENIT: un local fără `fiscal_receipt` primește zero
--        rânduri, chiar dacă are comenzi plătite istoric (scenariul DOWNGRADE,
--        singurul în care gate-ul face muncă reală — vezi PM6/mig 267).
--   DP5  suprafață: `anon` nu poate executa; `authenticated` poate.
--   DP6  CLICHET STRUCTURAL, VIU: INVOKER (nu DEFINER), `pg_temp`, derivare din
--        sursa unică, și filtru SARGABIL pe `paid_at`. Aceleași verificări
--        există în migrație — dar acolo se evaluează O SINGURĂ dată, la poziția
--        268 din lanț. Verificat prin mutație: un RPC rescris să delege
--        view-ului (deci NEsargabil, adică fără niciun motiv să existe) și unul
--        promovat la DEFINER treceau AMBELE de DP1–DP5, fiindcă REZULTATELE
--        rămân identice — DEFINER se vede doar sub RLS, iar suita rulează ca
--        `postgres`. Un test care verifică doar cifrele e orb la clasa asta.
--
--   DP7  CARACTERIZARE: parametri NULL / interval inversat dau ZERO rânduri, NU
--        eroare. Nu e un accident: e semantica SQL normală, e identică cu a
--        view-ului, iar un `raise` ar cere plpgsql — ceea ce pierde inlining-ul
--        funcțiilor SQL și schimbă calea de execuție, adică exact planul pe care
--        migrația asta îl repară. Testul ÎNGHEAȚĂ comportamentul, ca o schimbare
--        viitoare să fie o decizie conștientă, nu o regresie tăcută.
--
-- Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('7d000000-0000-4000-8000-0000000000a0','dp-owner@dp.test');
update public.profiles set plan = 'enterprise' where id = '7d000000-0000-4000-8000-0000000000a0';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('7d000000-0000-4000-8000-000000000001','7d000000-0000-4000-8000-0000000000a0',
   'DP Bistro','dp-bistro-slug','Cluj',true);
insert into public.products (id, restaurant_id, name, price, is_active) values
  ('7d000000-0000-4000-8000-0000000000b0','7d000000-0000-4000-8000-000000000001','Produs DP',50,true);

-- Trei încasări: una ÎNAINTE de interval, una la ULTIMA secundă din interval,
-- una DUPĂ. Plus un split, ca defalcarea să nu fie trivială.
insert into public.orders (id, restaurant_id, source, status, payment_method, paid_amount, created_at, paid_at) values
  ('7d000000-0000-4000-8000-0000000000d0','7d000000-0000-4000-8000-000000000001',
   'waiter','paid','cash',50,'2026-03-09 12:00:00+02','2026-03-09 23:00:00+02'),  -- ÎNAINTE
  ('7d000000-0000-4000-8000-0000000000d1','7d000000-0000-4000-8000-000000000001',
   'waiter','paid','other',88,'2026-03-10 12:00:00+02','2026-03-10 12:30:00+02'),  -- split, în interval
  ('7d000000-0000-4000-8000-0000000000d2','7d000000-0000-4000-8000-000000000001',
   'waiter','paid','cash',30,'2026-03-11 12:00:00+02','2026-03-11 23:59:30+02'),  -- ULTIMA secundă
  ('7d000000-0000-4000-8000-0000000000d3','7d000000-0000-4000-8000-000000000001',
   'waiter','paid','cash',70,'2026-03-12 12:00:00+02','2026-03-12 00:30:00+02');  -- DUPĂ
insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
select o.id, '7d000000-0000-4000-8000-0000000000b0','Produs DP',1,o.paid_amount,o.paid_amount
  from public.orders o where o.restaurant_id = '7d000000-0000-4000-8000-000000000001';
insert into public.order_payments (order_id, amount, method) values
  ('7d000000-0000-4000-8000-0000000000d1',41,'card_pos'),
  ('7d000000-0000-4000-8000-0000000000d1',47,'cash');

-- ── DP1: ECHIVALENȚĂ cu view-ul ──────────────────────────────────────────────
do $$
declare v_diff int;
begin
  select count(*) into v_diff from (
    select day, cash_revenue, card_revenue, voucher_revenue,
           online_revenue, other_revenue, total_revenue
      from public.get_daily_payments_by_method(
             '7d000000-0000-4000-8000-000000000001','2026-03-10','2026-03-11')
    except all
    select day, cash_revenue, card_revenue, voucher_revenue,
           online_revenue, other_revenue, total_revenue
      from public.v_daily_payments_by_method
     where restaurant_id = '7d000000-0000-4000-8000-000000000001'
       and day between '2026-03-10' and '2026-03-11'
  ) d;
  if v_diff <> 0 then
    raise exception 'DP1 FAIL: RPC-ul întoarce alte cifre decât view-ul (% rânduri diferite) — un fix de performanță care schimbă REZULTATUL nu e un fix', v_diff;
  end if;
  -- și în sens invers (view-ul nu are rânduri pe care RPC-ul le pierde)
  select count(*) into v_diff from (
    select day, cash_revenue, card_revenue, voucher_revenue,
           online_revenue, other_revenue, total_revenue
      from public.v_daily_payments_by_method
     where restaurant_id = '7d000000-0000-4000-8000-000000000001'
       and day between '2026-03-10' and '2026-03-11'
    except all
    select day, cash_revenue, card_revenue, voucher_revenue,
           online_revenue, other_revenue, total_revenue
      from public.get_daily_payments_by_method(
             '7d000000-0000-4000-8000-000000000001','2026-03-10','2026-03-11')
  ) d;
  if v_diff <> 0 then
    raise exception 'DP1 FAIL: RPC-ul PIERDE % rânduri față de view', v_diff; end if;
  raise notice 'DP1 OK: RPC ≡ view pe același interval (ambele sensuri)';
end $$;

-- ── DP2 + DP3: granițele intervalului ────────────────────────────────────────
do $$
declare v_total numeric; v_n int;
begin
  -- Ziua 11 martie: încasare la 23:59:30 — TREBUIE inclusă.
  select total_revenue into v_total
    from public.get_daily_payments_by_method(
           '7d000000-0000-4000-8000-000000000001','2026-03-11','2026-03-11');
  if v_total is distinct from 30 then
    raise exception 'DP2 FAIL: încasarea de la 23:59:30 în ultima zi a intervalului lipsește (total=%)', v_total;
  end if;
  raise notice 'DP2 OK: ultima secundă a ultimei zile e inclusă';

  -- Intervalul 10–11 NU are voie să conțină nici 9 martie, nici 12 martie.
  select count(*) into v_n
    from public.get_daily_payments_by_method(
           '7d000000-0000-4000-8000-000000000001','2026-03-10','2026-03-11')
   where day not in ('2026-03-10','2026-03-11');
  if v_n <> 0 then
    raise exception 'DP3 FAIL: % zile din afara intervalului au intrat', v_n; end if;

  -- Și split-ul se defalcă corect în interval (nu 88 în „alte").
  select cash_revenue into v_total
    from public.get_daily_payments_by_method(
           '7d000000-0000-4000-8000-000000000001','2026-03-10','2026-03-10');
  if v_total is distinct from 47 then
    raise exception 'DP3 FAIL: split-ul nu se defalcă în RPC (cash=%, așteptat 47)', v_total; end if;
  raise notice 'DP3 OK: nimic din afara intervalului; split-ul se defalcă 47/41';
end $$;

-- ── DP4: gate fiscal MOȘTENIT (scenariul de downgrade) ───────────────────────
do $$
declare v_n int;
begin
  update public.profiles set plan = 'growth'
   where id = '7d000000-0000-4000-8000-0000000000a0';

  select count(*) into v_n
    from public.get_daily_payments_by_method(
           '7d000000-0000-4000-8000-000000000001','2026-03-01','2026-03-31');
  if v_n <> 0 then
    raise exception 'DP4 FAIL: după downgrade, RPC-ul încă întoarce % rânduri — gate-ul fiscal moștenit din v_order_payment_methods e MORT', v_n;
  end if;

  update public.profiles set plan = 'enterprise'
   where id = '7d000000-0000-4000-8000-0000000000a0';
  raise notice 'DP4 OK: gate fiscal moștenit — banii dispar la downgrade';
end $$;

-- ── DP5: suprafață ───────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon',
       'public.get_daily_payments_by_method(uuid, date, date)', 'EXECUTE') then
    raise exception 'DP5 FAIL: anon poate executa RPC-ul de bani'; end if;
  if not has_function_privilege('authenticated',
       'public.get_daily_payments_by_method(uuid, date, date)', 'EXECUTE') then
    raise exception 'DP5 FAIL: authenticated NU poate executa RPC-ul'; end if;
  raise notice 'DP5 OK: doar authenticated';
end $$;

-- ── DP6: clichetul structural, pe starea FINALĂ a lanțului ───────────────────
do $$
declare v_secdef boolean; v_cfg text; v_src text;
begin
  select p.prosecdef, array_to_string(p.proconfig, ','), pg_get_functiondef(p.oid)
    into v_secdef, v_cfg, v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_daily_payments_by_method';
  if v_src is null then
    raise exception 'DP6 FAIL: get_daily_payments_by_method lipsește'; end if;

  -- INVOKER: RLS-ul și gate-ul fiscal vin MOȘTENITE din v_order_payment_methods.
  -- Un DEFINER le-ar ocoli, iar DP4 nu poate prinde asta: suita rulează ca
  -- `postgres`, care ocolește RLS oricum.
  if v_secdef then
    raise exception 'DP6 FAIL: RPC-ul e SECURITY DEFINER — ar ocoli RLS-ul și gate-ul fiscal moștenite'; end if;

  if v_cfg is null or position('pg_temp' in v_cfg) = 0 then
    raise exception 'DP6 FAIL: RPC fără pg_temp în search_path'; end if;

  if position('v_order_payment_methods' in v_src) = 0 then
    raise exception 'DP6 FAIL: RPC-ul nu mai derivă din sursa unică — și-ar pierde gate-ul fiscal'; end if;

  -- MOTIVUL existenței RPC-ului. Dacă filtrul redevine unul pe cheia de GROUP BY
  -- calculată (`day >= ...`), RPC-ul e doar un wrapper peste view: rezultatele
  -- rămân IDENTICE (deci DP1 trece) dar indexul pe `paid_at` redevine inutil și
  -- costul crește iar cu istoricul TOTAL, nu cu fereastra cerută.
  if position('m.paid_at >=' in v_src) = 0 or position('m.paid_at <' in v_src) = 0 then
    raise exception 'DP6 FAIL: filtrul nu mai e SARGABIL pe paid_at — RPC-ul a redevenit un wrapper peste view'; end if;
  if position('v_daily_payments_by_method' in v_src) > 0 then
    raise exception 'DP6 FAIL: RPC-ul deleagă view-ului (deci filtrează pe cheia calculată) — exact defectul pe care există să-l repare'; end if;

  raise notice 'DP6 OK: INVOKER + pg_temp + derivare din sursa unică + filtru sargabil pe paid_at';
end $$;

-- ── DP7: caracterizarea parametrilor degenerați ──────────────────────────────
do $$
declare v_n int;
begin
  select count(*) into v_n from public.get_daily_payments_by_method(
    '7d000000-0000-4000-8000-000000000001', null, '2026-03-11');
  if v_n <> 0 then
    raise exception 'DP7 FAIL: p_from NULL a întors % rânduri (aștept 0)', v_n; end if;

  select count(*) into v_n from public.get_daily_payments_by_method(
    '7d000000-0000-4000-8000-000000000001', '2026-03-10', null);
  if v_n <> 0 then
    raise exception 'DP7 FAIL: p_to NULL a întors % rânduri (aștept 0)', v_n; end if;

  select count(*) into v_n from public.get_daily_payments_by_method(
    null, '2026-03-10', '2026-03-11');
  if v_n <> 0 then
    raise exception 'DP7 FAIL: p_restaurant_id NULL a întors % rânduri (aștept 0)', v_n; end if;

  -- Interval INVERSAT (from > to): zero rânduri, nu eroare, nu tot istoricul.
  select count(*) into v_n from public.get_daily_payments_by_method(
    '7d000000-0000-4000-8000-000000000001', '2026-03-11', '2026-03-10');
  if v_n <> 0 then
    raise exception 'DP7 FAIL: interval inversat a întors % rânduri (aștept 0)', v_n; end if;

  raise notice 'DP7 OK: parametrii degenerați dau zero rânduri (caracterizat, nu accidental)';
end $$;

rollback;

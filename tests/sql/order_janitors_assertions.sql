-- tests/sql/order_janitors_assertions.sql
-- =============================================================================
-- OJ1–OJ9 — janitorul de comenzi agățate (mig 288, Plan 2).
--
-- Fixtura CONTRAZICE fiecare predicat observabil al `expire_stale_orders`,
-- altfel „funcția n-a atins nimic" ar fi indistinct de „funcția n-a evaluat
-- nimic" (clasa JL1: control pozitiv + rânduri-capcană):
--   status ne-servit vechi            → cancelled, cu motiv        (O1–O3)
--   status ready/served vechi         → closed                     (O4–O5)
--   sub prag (created_at recent)      → neatins                    (N1)
--   created_at vechi, dar SERVIT acum → neatins (vârsta = served_at) (N2)
--   created_at vechi, dar READY acum  → neatins (vârsta = ready_at)  (N6)
--   cu plată în registru              → neatins (new ȘI served)      (N3a/N3b)
--   pickup programat în viitor        → neatins                      (N4)
--   restaurant cu fiscal_receipt      → neatins (new ȘI served)      (N5a/N5b)
--   comandă care face un gate să arunce → sărită, restul lotului trece (OJ7)
--
--   OJ1  rânduri-țintă: new/confirmed/preparing → cancelled + cancel_reason
--   OJ2  ready/served → closed; served_at păstrat dacă exista, setat altfel
--   OJ3  `cancelled` NU produce puncte de loialitate și NU scade stoc, pe
--        când `closed` le produce (motivul pentru care regula are două ramuri)
--   OJ4  rânduri-capcană: fiecare rămâne exact cum era (stare + timestamp)
--   OJ5  a doua rulare = zero rânduri (predicat auto-consumat)
--   OJ6  Plan 3 sărit în AMBELE ramuri; registrul de plăți păstrat intact
--   OJ7  izolare per rând: o comandă respinsă de un trigger nu blochează lotul
--   OJ8  forma: DEFINER + pg_temp, zero grant, fără ocolirea triggerelor
--   OJ9  manifest: rând prezent, minut etalat, marker de siguranță în corp
--
-- Rulează DUPĂ migrații, ca postgres (janitorul rulează ca postgres pe pg_cron).
-- Self-contained, ROLLBACK la final.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('8b000000-0000-4000-8000-0000000000a1', 'oj-growth@oj.test'),
  ('8b000000-0000-4000-8000-0000000000a2', 'oj-pro@oj.test');
update public.profiles set plan = 'growth'     where id = '8b000000-0000-4000-8000-0000000000a1';
update public.profiles set plan = 'enterprise' where id = '8b000000-0000-4000-8000-0000000000a2';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('8b000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-0000000000a1', 'OJ Growth', 'oj-growth', 'Cluj', true),
  ('8b000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-0000000000a2', 'OJ Pro',    'oj-pro',    'Cluj', true);

-- Loyalty (growth+) + stoc, ca ramurile `closed` să aibă efecte MĂSURABILE.
insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('8b000000-0000-4000-8000-000000000001', 'loyalty', true);
insert into public.loyalty_programs (restaurant_id, points_per_leu, reward_threshold, reward_description) values
  ('8b000000-0000-4000-8000-000000000001', 1, 1000, 'Cafea');
insert into public.loyalty_wallets (id, restaurant_id, anon_id, short_code, points) values
  ('8b000000-0000-4000-8000-0000000000e1', '8b000000-0000-4000-8000-000000000001', 'anon_oj_1', 'OJWAL1', 0);

insert into public.products (id, restaurant_id, name, price, is_active) values
  ('8b000000-0000-4000-8000-0000000000b1', '8b000000-0000-4000-8000-000000000001', 'Produs OJ', 15, true),
  ('8b000000-0000-4000-8000-0000000000b2', '8b000000-0000-4000-8000-000000000002', 'Produs OJ Pro', 15, true);
insert into public.ingredients (id, restaurant_id, name, unit, current_stock, cost_per_unit) values
  ('8b000000-0000-4000-8000-0000000000c1', '8b000000-0000-4000-8000-000000000001', 'Faina OJ', 'kg', 100, 5);
insert into public.recipes (product_id, ingredient_id, quantity) values
  ('8b000000-0000-4000-8000-0000000000b1', '8b000000-0000-4000-8000-0000000000c1', 1);

-- Comenzile. `created_at` explicit; restul timestamp-urilor SETATE explicit
-- unde vârsta se măsoară din ele (INSERT nu declanșează stamp_order_timestamps).
-- Ținte (growth, nefiscal):
insert into public.orders (id, restaurant_id, source, status, created_at, ready_at, served_at, loyalty_wallet_id) values
  ('8b000000-0000-4000-8000-0000000001a1', '8b000000-0000-4000-8000-000000000001', 'waiter', 'new',       now() - interval '20 hours', null, null, '8b000000-0000-4000-8000-0000000000e1'),
  ('8b000000-0000-4000-8000-0000000001a2', '8b000000-0000-4000-8000-000000000001', 'waiter', 'confirmed', now() - interval '20 hours', null, null, null),
  ('8b000000-0000-4000-8000-0000000001a3', '8b000000-0000-4000-8000-000000000001', 'waiter', 'preparing', now() - interval '20 hours', null, null, null),
  ('8b000000-0000-4000-8000-0000000001a4', '8b000000-0000-4000-8000-000000000001', 'waiter', 'served',    now() - interval '30 hours', null, now() - interval '20 hours', '8b000000-0000-4000-8000-0000000000e1'),
  ('8b000000-0000-4000-8000-0000000001a5', '8b000000-0000-4000-8000-000000000001', 'waiter', 'ready',     now() - interval '30 hours', now() - interval '20 hours', null, null);
-- Capcane (growth):
insert into public.orders (id, restaurant_id, source, status, created_at, ready_at, served_at, pickup_time) values
  -- N1: sub prag
  ('8b000000-0000-4000-8000-0000000002a1', '8b000000-0000-4000-8000-000000000001', 'waiter', 'new',    now() - interval '2 hours',  null, null, null),
  -- N2: creată demult, dar servită ACUM 2 ore → vârsta e servirea
  ('8b000000-0000-4000-8000-0000000002a2', '8b000000-0000-4000-8000-000000000001', 'waiter', 'served', now() - interval '30 hours', null, now() - interval '2 hours', null),
  -- N6: creată demult, dar gata ACUM 2 ore
  ('8b000000-0000-4000-8000-0000000002a6', '8b000000-0000-4000-8000-000000000001', 'waiter', 'ready',  now() - interval '30 hours', now() - interval '2 hours', null, null),
  -- N3a/N3b: vechi, dar cu bani în registru
  ('8b000000-0000-4000-8000-0000000002a3', '8b000000-0000-4000-8000-000000000001', 'waiter', 'new',    now() - interval '20 hours', null, null, null),
  ('8b000000-0000-4000-8000-0000000002b3', '8b000000-0000-4000-8000-000000000001', 'waiter', 'served', now() - interval '30 hours', null, now() - interval '20 hours', null),
  -- N4: pickup creat demult, dar ridicarea e peste 5 ore
  ('8b000000-0000-4000-8000-0000000002a4', '8b000000-0000-4000-8000-000000000001', 'pickup', 'new',   now() - interval '20 hours', null, null, now() + interval '5 hours');
update public.orders set customer_name = 'OJ', customer_phone = '0722000000'
 where id = '8b000000-0000-4000-8000-0000000002a4';
-- N5a/N5b: restaurant cu fiscal_receipt (enterprise), vechi
insert into public.orders (id, restaurant_id, source, status, created_at, served_at) values
  ('8b000000-0000-4000-8000-0000000002a5', '8b000000-0000-4000-8000-000000000002', 'waiter', 'new',    now() - interval '20 hours', null),
  ('8b000000-0000-4000-8000-0000000002b5', '8b000000-0000-4000-8000-000000000002', 'waiter', 'served', now() - interval '30 hours', now() - interval '20 hours');

-- Articole (totalul se recalculează din ele prin trigger-ul de subtotal).
-- O1 (anulată): 3 × 15 = 45 → dacă ar fi `closed` ar da 45 puncte + 3 kg stoc.
-- O4 (închisă): 2 × 15 = 30 → 30 puncte + 2 kg stoc.
insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total) values
  ('8b000000-0000-4000-8000-0000000001a1', '8b000000-0000-4000-8000-0000000000b1', 'Produs OJ', 3, 15, 45),
  ('8b000000-0000-4000-8000-0000000001a4', '8b000000-0000-4000-8000-0000000000b1', 'Produs OJ', 2, 15, 30),
  ('8b000000-0000-4000-8000-0000000002a3', '8b000000-0000-4000-8000-0000000000b1', 'Produs OJ', 1, 15, 15),
  ('8b000000-0000-4000-8000-0000000002b3', '8b000000-0000-4000-8000-0000000000b1', 'Produs OJ', 1, 15, 15);
insert into public.order_payments (order_id, amount, method) values
  ('8b000000-0000-4000-8000-0000000002a3', 5, 'cash'),
  ('8b000000-0000-4000-8000-0000000002b3', 5, 'cash');

-- Snapshot al capcanelor (stare + marcaje), pentru OJ4/OJ6.
create temp table oj_before as
select id, status, created_at, ready_at, served_at, cancel_reason, cancelled_at
  from public.orders where id::text like '8b000000-0000-4000-8000-0000000002%';

-- ── Prima rulare ─────────────────────────────────────────────────────────────
create temp table oj_run1 as select public.expire_stale_orders(12) as r;

-- ── OJ1: new/confirmed/preparing → cancelled, cu motiv ──────────────────────
do $$
declare v_bad text;
begin
  -- CONTROL POZITIV: funcția a evaluat și a făcut ceva (altfel tot restul e vacuu).
  if (select (r->>'cancelled')::int from oj_run1) <> 3 or (select (r->>'closed')::int from oj_run1) <> 2 then
    raise exception 'OJ1 FAIL: rezultat gresit % (asteptat cancelled=3, closed=2)', (select r from oj_run1); end if;
  select string_agg(id::text || ':' || status::text || ':' || coalesce(cancel_reason, '∅'), ', ') into v_bad
    from public.orders
   where id in ('8b000000-0000-4000-8000-0000000001a1','8b000000-0000-4000-8000-0000000001a2','8b000000-0000-4000-8000-0000000001a3')
     and (status is distinct from 'cancelled'
          or cancel_reason is distinct from 'Expirată automat (neprocesată)'
          or cancelled_at is null);
  if v_bad is not null then
    raise exception 'OJ1 FAIL: comenzile ne-servite vechi nu sunt anulate corect: %', v_bad; end if;
  raise notice 'OJ1 OK: new/confirmed/preparing vechi → cancelled cu motiv';
end $$;

-- ── OJ2: ready/served → closed ──────────────────────────────────────────────
do $$
declare v_served_a4 timestamptz; v_served_a5 timestamptz;
begin
  if exists (select 1 from public.orders
              where id in ('8b000000-0000-4000-8000-0000000001a4','8b000000-0000-4000-8000-0000000001a5')
                and status is distinct from 'closed') then
    raise exception 'OJ2 FAIL: served/ready vechi nu sunt inchise'; end if;
  select served_at into v_served_a4 from public.orders where id = '8b000000-0000-4000-8000-0000000001a4';
  select served_at into v_served_a5 from public.orders where id = '8b000000-0000-4000-8000-0000000001a5';
  -- served_at PĂSTRAT (acum 20h) pe comanda deja servită; SETAT pe cea doar „ready"
  if abs(extract(epoch from v_served_a4 - (now() - interval '20 hours'))) > 5 then
    raise exception 'OJ2 FAIL: served_at rescris pe comanda servita (%)', v_served_a4; end if;
  if v_served_a5 is null then
    raise exception 'OJ2 FAIL: served_at nesetat pe comanda ready inchisa'; end if;
  raise notice 'OJ2 OK: ready/served vechi → closed, served_at coerent';
end $$;

-- ── OJ3: closed produce puncte + stoc, cancelled NU ─────────────────────────
do $$
declare v_pts int; v_stock numeric; v_ev int;
begin
  -- Control pozitiv: ramura `closed` a acordat puncte (30) pe wallet…
  select points into v_pts from public.loyalty_wallets where id = '8b000000-0000-4000-8000-0000000000e1';
  if v_pts is distinct from 30 then
    raise exception 'OJ3 FAIL: puncte=% (asteptat 30 = doar comanda inchisa; cea anulata de 45 NU conteaza)', v_pts; end if;
  select count(*) into v_ev from public.loyalty_events
   where order_id = '8b000000-0000-4000-8000-0000000001a4' and kind = 'earn';
  if v_ev <> 1 then raise exception 'OJ3 FAIL: comanda inchisa are % evenimente earn (asteptat 1)', v_ev; end if;
  if exists (select 1 from public.loyalty_events where order_id = '8b000000-0000-4000-8000-0000000001a1') then
    raise exception 'OJ3 FAIL: comanda ANULATA a produs puncte de loialitate'; end if;
  -- …si stocul: 100 - 2 (inchisa) = 98; cele 3 kg ale celei anulate NU se scad.
  select current_stock into v_stock from public.ingredients where id = '8b000000-0000-4000-8000-0000000000c1';
  if v_stock is distinct from 98 then
    raise exception 'OJ3 FAIL: stoc=% (asteptat 98)', v_stock; end if;
  if not exists (select 1 from public.order_stock_deductions where order_id = '8b000000-0000-4000-8000-0000000001a4')
     or exists (select 1 from public.order_stock_deductions where order_id = '8b000000-0000-4000-8000-0000000001a1') then
    raise exception 'OJ3 FAIL: tabela-claim a stocului nu reflecta inchisa=da / anulata=nu'; end if;
  raise notice 'OJ3 OK: closed → 30 puncte + stoc 98; cancelled → zero puncte, zero stoc';
end $$;

-- ── OJ4: capcanele rămân EXACT cum erau ─────────────────────────────────────
do $$
declare v_bad text;
begin
  -- control pozitiv: avem capcanele (altfel comparația e vacuă)
  if (select count(*) from oj_before) <> 8 then
    raise exception 'OJ4 FAIL: fixtura de capcane are % randuri (asteptat 8)', (select count(*) from oj_before); end if;
  select string_agg(b.id::text, ', ') into v_bad
    from oj_before b join public.orders o on o.id = b.id
   where o.status is distinct from b.status
      or o.cancel_reason is distinct from b.cancel_reason
      or o.cancelled_at is distinct from b.cancelled_at
      or o.served_at is distinct from b.served_at
      or o.ready_at is distinct from b.ready_at;
  if v_bad is not null then
    raise exception 'OJ4 FAIL: capcane modificate: %', v_bad; end if;
  raise notice 'OJ4 OK: sub prag / vârsta din served_at & ready_at / registru / pickup viitor / Plan 3 — neatinse';
end $$;

-- ── OJ5: a doua rulare = zero ───────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.expire_stale_orders(12);
  if v <> jsonb_build_object('cancelled', 0, 'closed', 0, 'errors', 0) then
    raise exception 'OJ5 FAIL: a doua rulare a atins randuri: %', v; end if;
  raise notice 'OJ5 OK: a doua rulare = 0 (auto-consumat)';
end $$;

-- ── OJ6: Plan 3 sărit, registrul intact ─────────────────────────────────────
do $$
begin
  if (select count(*) from public.orders
       where id in ('8b000000-0000-4000-8000-0000000002a5','8b000000-0000-4000-8000-0000000002b5')
         and status in ('new','served')) <> 2 then
    raise exception 'OJ6 FAIL: o comanda de pe restaurantul cu fiscal_receipt a fost atinsa'; end if;
  if (select count(*) from public.order_payments
       where order_id in ('8b000000-0000-4000-8000-0000000002a3','8b000000-0000-4000-8000-0000000002b3')) <> 2 then
    raise exception 'OJ6 FAIL: registrul de plati a fost modificat'; end if;
  -- Control pozitiv al filtrului fiscal: pe un prag de 0 ore restaurantul growth
  -- ar fi atins, cel fiscal NU (aceleasi comenzi, plan diferit).
  perform public.expire_stale_orders(1);
  if (select count(*) from public.orders
       where id in ('8b000000-0000-4000-8000-0000000002a5','8b000000-0000-4000-8000-0000000002b5')
         and status in ('new','served')) <> 2 then
    raise exception 'OJ6 FAIL: pragul mic a atins Plan 3'; end if;
  if (select status from public.orders where id = '8b000000-0000-4000-8000-0000000002a1') <> 'cancelled' then
    raise exception 'OJ6 FAIL: control pozitiv — la prag 1h comanda N1 (acum 2h) trebuia anulata'; end if;
  raise notice 'OJ6 OK: Plan 3 sărit (ambele ramuri), registrul intact; pragul e parametrul real';
end $$;

-- ── OJ7: izolare per rând ───────────────────────────────────────────────────
create function public._oj_poison() returns trigger language plpgsql as $$
begin
  if new.id = '8b000000-0000-4000-8000-0000000003a1' then
    raise exception 'oj poison' using errcode = 'P0001', hint = 'oj_poison';
  end if;
  return new;
end $$;
create trigger zz_oj_poison before update on public.orders
  for each row execute function public._oj_poison();
insert into public.orders (id, restaurant_id, source, status, created_at) values
  ('8b000000-0000-4000-8000-0000000003a1', '8b000000-0000-4000-8000-000000000001', 'waiter', 'new', now() - interval '40 hours'),
  ('8b000000-0000-4000-8000-0000000003a2', '8b000000-0000-4000-8000-000000000001', 'waiter', 'new', now() - interval '39 hours');
do $$
declare v jsonb;
begin
  v := public.expire_stale_orders(12);
  if (v->>'errors')::int <> 1 or (v->>'cancelled')::int <> 1 then
    raise exception 'OJ7 FAIL: rezultat % (asteptat errors=1, cancelled=1)', v; end if;
  if (select status from public.orders where id = '8b000000-0000-4000-8000-0000000003a1') <> 'new' then
    raise exception 'OJ7 FAIL: randul otravit s-a modificat'; end if;
  if (select status from public.orders where id = '8b000000-0000-4000-8000-0000000003a2') <> 'cancelled' then
    raise exception 'OJ7 FAIL: un rand otravit a BLOCAT restul lotului'; end if;
  raise notice 'OJ7 OK: rand respins de un gate → sărit; restul lotului trece';
end $$;
drop trigger zz_oj_poison on public.orders;
drop function public._oj_poison();

-- ── OJ8: forma ──────────────────────────────────────────────────────────────
do $$
declare v_src text; v_def boolean; v_cfg text[]; v_owner name;
begin
  select p.prosrc, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner)
    into v_src, v_def, v_cfg, v_owner
    from pg_proc p where p.oid = 'public.expire_stale_orders(integer)'::regprocedure;
  if not v_def or v_owner <> 'postgres'
     or not exists (select 1 from unnest(coalesce(v_cfg, '{}')) c where c like 'search_path=%' and c like '%pg_temp%') then
    raise exception 'OJ8 FAIL: functia trebuie DEFINER, owner postgres, search_path cu pg_temp'; end if;
  if has_function_privilege('anon', 'public.expire_stale_orders(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.expire_stale_orders(integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.expire_stale_orders(integer)', 'EXECUTE') then
    raise exception 'OJ8 FAIL: functia e apelabila de un rol client / service_role (zero grant)'; end if;
  -- fara ocolirea triggerelor (gate-urile 124/264/270 raman active)
  if v_src ~* 'session_replication_role|disable\s+trigger' then
    raise exception 'OJ8 FAIL: functia ocoleste triggerele'; end if;
  -- gate-urile din DATE pe care se sprijina exista (altfel „trece prin ele" e gol)
  if (select count(*) from pg_trigger
       where tgrelid = 'public.orders'::regclass and not tgisinternal
         and tgname in ('trg_orders_cancel_ledger_gate', 'trg_orders_closed_fiscal_gate', 'trg_loyalty_earn', 'deduct_stock_trigger')) <> 4 then
    raise exception 'OJ8 FAIL: lipsesc triggere din lantul prin care trece janitorul'; end if;
  raise notice 'OJ8 OK: DEFINER postgres, pg_temp, zero grant, fara ocolirea triggerelor';
end $$;

-- ── OJ9: manifest ───────────────────────────────────────────────────────────
do $$
declare v_m record; v_min int;
begin
  select * into v_m from public.pg_cron_janitor_manifest where job_name = 'menuvia_janitor_stale_orders';
  if v_m.job_name is null then raise exception 'OJ9 FAIL: randul de manifest lipseste'; end if;
  v_min := split_part(v_m.schedule, ' ', 1)::int;
  if v_min % 15 = 0 then raise exception 'OJ9 FAIL: minutul % e multiplu de 15', v_min; end if;
  if v_m.command <> 'select public.expire_stale_orders(12)' then
    raise exception 'OJ9 FAIL: comanda % (pragul de 12h e decizia D2)', v_m.command; end if;
  if position(v_m.safety_marker in (select prosrc from pg_proc where oid = to_regprocedure(v_m.signature))) = 0 then
    raise exception 'OJ9 FAIL: markerul de siguranta lipseste din corp'; end if;
  raise notice 'OJ9 OK: manifest (minut %, comanda cu 12h, marker prezent)', v_min;
end $$;

rollback;

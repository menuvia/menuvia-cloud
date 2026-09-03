-- tests/sql/audit_v3_batch2_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 263 (audit v3, lotul 2). Self-contained, ROLLBACK.
--
--   AB1  DS-1: pe un restaurant Plan 3 (pro), close_order e respins cu hint
--        fiscal_plan_requires_payment și comanda rămâne `served` — fără
--        închidere NEfiscală pe planurile cu bon.
--   AB2  Pe growth (fără fiscal_receipt, cu table_lifecycle) close_order trece
--        exact ca înainte (fluxul Plan 2 se termină în `closed`).
--   AB3  CA-02/MF-12: v_daily_orders.online_revenue însumează plățile
--        `card_online`, iar revenue = cash + card + voucher + online.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('63000000-0000-4000-8000-000000000001', 'ab-pro@ab.test'),
  ('63000000-0000-4000-8000-000000000002', 'ab-growth@ab.test');
update public.profiles set plan = 'pro'    where id = '63000000-0000-4000-8000-000000000001';
update public.profiles set plan = 'growth' where id = '63000000-0000-4000-8000-000000000002';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('63b00000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', 'AB Pro',    'ab-pro',    'Cluj', true),
  ('63b00000-0000-4000-8000-000000000002', '63000000-0000-4000-8000-000000000002', 'AB Growth', 'ab-growth', 'Cluj', true);

-- ── AB1: close_order pe Plan 3 → respins ─────────────────────────────────────
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
do $$
declare v_o uuid := '63f00000-0000-4000-8000-000000000001'; v_hint text; v_status text;
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '63b00000-0000-4000-8000-000000000001', 'waiter', 'served', 50);
  v_hint := null;
  begin
    perform public.advance_order(v_o, 'close_order', null, null, null, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'fiscal_plan_requires_payment' then
    raise exception 'AB1 FAIL: close_order pe Plan 3 nu a fost respins (hint=%) — închidere NEfiscală acceptată (DS-1)', v_hint; end if;
  select status into v_status from public.orders where id = v_o;
  if v_status <> 'served' then
    raise exception 'AB1 FAIL: comanda a părăsit starea served (status=%)', v_status; end if;
  raise notice 'AB1 OK: pe Plan 3 close_order e respins (fiscal_plan_requires_payment)';
end $$;

-- ── AB2: close_order pe growth → trece ca înainte ────────────────────────────
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000002', true);
do $$
declare v_o uuid := '63f00000-0000-4000-8000-000000000002'; v_res jsonb; v_status text;
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '63b00000-0000-4000-8000-000000000002', 'waiter', 'served', 50);
  v_res := public.advance_order(v_o, 'close_order', null, null, null, null);
  if coalesce((v_res->>'ok')::boolean, false) is not true then
    raise exception 'AB2 FAIL: close_order pe growth a eșuat (%)', v_res; end if;
  select status into v_status from public.orders where id = v_o;
  if v_status <> 'closed' then
    raise exception 'AB2 FAIL: comanda growth nu e closed (status=%)', v_status; end if;
  raise notice 'AB2 OK: pe growth close_order rămâne fluxul Plan 2 (closed)';
end $$;

-- ── AB3: v_daily_orders.online_revenue ───────────────────────────────────────
do $$
declare v_rest uuid := '63b00000-0000-4000-8000-000000000001';
        v_rev numeric; v_cash numeric; v_card numeric; v_vouch numeric; v_online numeric;
begin
  insert into public.orders (id, restaurant_id, source, status, total, paid_amount, payment_method, paid_at) values
    ('63f00000-0000-4000-8000-000000000011', v_rest, 'qr',     'paid', 30, 30, 'card_online', now()),
    ('63f00000-0000-4000-8000-000000000012', v_rest, 'waiter', 'paid', 20, 20, 'cash',        now()),
    ('63f00000-0000-4000-8000-000000000013', v_rest, 'waiter', 'paid', 10, 10, 'card_pos',    now());
  select sum(revenue), sum(cash_revenue), sum(card_revenue), sum(voucher_revenue), sum(online_revenue)
    into v_rev, v_cash, v_card, v_vouch, v_online
    from public.v_daily_orders where restaurant_id = v_rest;
  if coalesce(v_online, -1) <> 30 then
    raise exception 'AB3 FAIL: online_revenue=% (așteptat 30)', v_online; end if;
  if coalesce(v_rev, -1) <> 60 or v_cash + v_card + v_vouch + v_online <> v_rev then
    raise exception 'AB3 FAIL: revenue=% ≠ cash %+card %+voucher %+online %', v_rev, v_cash, v_card, v_vouch, v_online; end if;
  raise notice 'AB3 OK: online_revenue=30, defalcarea pe metode închide cu venitul (60)';
end $$;

rollback;

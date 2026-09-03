-- tests/sql/audit_v3_batch2_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 263 (audit v3, lotul 2). Self-contained, ROLLBACK.
--
--   AB1  DS-1: pe un restaurant Plan 3 (pro), close_order e respins cu hint
--        fiscal_plan_requires_payment și comanda rămâne `served` — fără
--        închidere NEfiscală pe planurile cu bon.
--   AB2  Pe growth (fără fiscal_receipt, cu table_lifecycle) close_order trece
--        exact ca înainte (fluxul Plan 2 se termină în `closed`).
--   AB4  Aceeași regulă de aur pe `close_session_orders` (review lot 2): pe
--        Plan 3 masa cu note NEîncasate nu se poate închide; după încasare da;
--        pe growth fluxul rămâne neschimbat.
--   AB3  CA-02/MF-12: v_daily_orders.online_revenue + other_revenue însumează plățile
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

-- ── AB3: v_daily_orders — online_revenue + other_revenue închid defalcarea ───
do $$
declare v_rest uuid := '63b00000-0000-4000-8000-000000000001';
        v_rev numeric; v_cash numeric; v_card numeric; v_vouch numeric;
        v_online numeric; v_other numeric;
begin
  insert into public.orders (id, restaurant_id, source, status, total, paid_amount, payment_method, paid_at) values
    ('63f00000-0000-4000-8000-000000000011', v_rest, 'qr',     'paid', 30, 30, 'card_online', now()),
    ('63f00000-0000-4000-8000-000000000012', v_rest, 'waiter', 'paid', 20, 20, 'cash',        now()),
    ('63f00000-0000-4000-8000-000000000013', v_rest, 'waiter', 'paid', 10, 10, 'card_pos',    now()),
    -- split cu metode MIXTE → advance_order scrie 'other' (mig 262)
    ('63f00000-0000-4000-8000-000000000014', v_rest, 'waiter', 'paid',  7,  7, 'other',       now()),
    -- comandă veche fără metodă (NULL) — cade tot în other_revenue
    ('63f00000-0000-4000-8000-000000000015', v_rest, 'waiter', 'paid',  3,  3, null,          now());
  select sum(revenue), sum(cash_revenue), sum(card_revenue), sum(voucher_revenue),
         sum(online_revenue), sum(other_revenue)
    into v_rev, v_cash, v_card, v_vouch, v_online, v_other
    from public.v_daily_orders where restaurant_id = v_rest;
  if coalesce(v_online, -1) <> 30 then
    raise exception 'AB3 FAIL: online_revenue=% (așteptat 30)', v_online; end if;
  if coalesce(v_other, -1) <> 10 then
    raise exception 'AB3 FAIL: other_revenue=% (așteptat 10 = 7 „other" + 3 NULL)', v_other; end if;
  -- Invariantul care contează pentru operator: defalcarea pe metode ÎNCHIDE cu
  -- venitul total (înainte, „other"/NULL dispăreau din defalcare).
  if coalesce(v_rev, -1) <> 70 or v_cash + v_card + v_vouch + v_online + v_other <> v_rev then
    raise exception 'AB3 FAIL: revenue=% ≠ cash %+card %+voucher %+online %+other %',
      v_rev, v_cash, v_card, v_vouch, v_online, v_other; end if;
  raise notice 'AB3 OK: online_revenue=30, other_revenue=10, defalcarea închide cu venitul (70)';
end $$;

-- ── AB4: close_session_orders — aceeași regulă de aur ca advance_order ───────
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
do $$
declare
  v_rest uuid := '63b00000-0000-4000-8000-000000000001';
  v_tbl  uuid := '63a00000-0000-4000-8000-000000000001';
  v_sess uuid := '63c00000-0000-4000-8000-000000000001';
  v_ord  uuid := '63f00000-0000-4000-8000-000000000021';
  v_hint text; v_res jsonb; v_status text;
begin
  insert into public.tables (id, restaurant_id, name, slug, seats, is_active)
    values (v_tbl, v_rest, 'AB Masa', 'ab-masa', 4, true);
  insert into public.table_sessions (id, restaurant_id, table_id, status)
    values (v_sess, v_rest, v_tbl, 'open');
  insert into public.orders (id, restaurant_id, source, status, total, table_id, session_id)
    values (v_ord, v_rest, 'qr', 'served', 40, v_tbl, v_sess);

  -- (a) masă cu notă NEîncasată pe Plan 3 → respins (altfel: bani fără bon)
  v_hint := null;
  begin
    perform public.close_session_orders(v_sess);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'fiscal_plan_requires_payment' then
    raise exception 'AB4 FAIL: închiderea mesei cu notă neîncasată pe Plan 3 nu a fost respinsă (hint=%)', v_hint; end if;
  select status into v_status from public.orders where id = v_ord;
  if v_status <> 'served' then
    raise exception 'AB4 FAIL: comanda a fost închisă nefiscal (status=%)', v_status; end if;
  if (select status from public.table_sessions where id = v_sess) <> 'open' then
    raise exception 'AB4 FAIL: sesiunea s-a închis deși gate-ul a respins operația'; end if;

  -- (b) după încasare masa se eliberează SINGURĂ: `trg_maybe_close_session`
  -- (mig 084) închide sesiunea când ultima comandă intră în paid/cancelled.
  -- Deci pe Plan 3 gate-ul de mai sus nu blochează niciun flux legitim —
  -- close_session_orders rămâne idempotent (already_closed), nu aruncă.
  update public.orders set status = 'paid', paid_amount = 40, payment_method = 'cash', paid_at = now()
   where id = v_ord;
  if (select status from public.table_sessions where id = v_sess) <> 'closed' then
    raise exception 'AB4 FAIL: sesiunea nu s-a închis automat la plata ultimei note (trg_maybe_close_session)'; end if;
  v_res := public.close_session_orders(v_sess);
  if coalesce((v_res->>'already_closed')::boolean, false) is not true then
    raise exception 'AB4 FAIL: close_session_orders pe o masă deja închisă nu e idempotent (%)', v_res; end if;
  raise notice 'AB4a/b OK: pe Plan 3 masa se închide DOAR prin încasare (automat la plată), nu nefiscal';
end $$;

-- (c) pe growth închiderea mesei cu comenzi deschise rămâne fluxul Plan 2
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000002', true);
do $$
declare
  v_rest uuid := '63b00000-0000-4000-8000-000000000002';
  v_tbl  uuid := '63a00000-0000-4000-8000-000000000002';
  v_sess uuid := '63c00000-0000-4000-8000-000000000002';
  v_ord  uuid := '63f00000-0000-4000-8000-000000000022';
  v_res jsonb;
begin
  insert into public.tables (id, restaurant_id, name, slug, seats, is_active)
    values (v_tbl, v_rest, 'AB Masa G', 'ab-masa-g', 4, true);
  insert into public.table_sessions (id, restaurant_id, table_id, status)
    values (v_sess, v_rest, v_tbl, 'open');
  insert into public.orders (id, restaurant_id, source, status, total, table_id, session_id)
    values (v_ord, v_rest, 'qr', 'served', 40, v_tbl, v_sess);

  v_res := public.close_session_orders(v_sess);
  if coalesce((v_res->>'closed_count')::int, 0) <> 1 then
    raise exception 'AB4c FAIL: pe growth masa nu a închis comanda deschisă (%)', v_res; end if;
  if (select status from public.orders where id = v_ord) <> 'closed' then
    raise exception 'AB4c FAIL: comanda growth nu e closed'; end if;
  raise notice 'AB4c OK: pe growth închiderea mesei rămâne neschimbată (Plan 2)';
end $$;

rollback;

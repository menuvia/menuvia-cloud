-- tests/sql/cancel_ledger_gate_assertions.sql
-- =============================================================================
-- Asserții permanente pentru mig 270 (A) — audit v3 RES-25: „Anulează" peste
-- bani deja încasați.
--
-- Clasa: `add_partial_payment` (258) și `settle_table_payment` split (229)
-- depun bani REALI în `order_payments` pe o comandă care rămâne ne-terminală.
-- Ramura `cancel` a lui `advance_order` verifica doar rolul și motivul, iar
-- politica „orders: admin all" permitea și PATCH-ul direct → bani în sertar /
-- pe Stripe fără bon, scoși din rapoarte (`v_order_payment_methods` exclude
-- `cancelled`). Regula de aur, pe direcția opusă lui MF-01.
--
--   CL1  RPC: parțială cash 60/100 → cancel cu motiv → RESPINS
--        (hint cancel_over_payments); status rămâne served, registrul neatins.
--   CL2  DATE: UPDATE direct `status='cancelled'` (calea PostgREST) pe aceeași
--        comandă → respins de trigger cu același hint.
--   CL3  online, NE-served, FĂRĂ motiv: `preparing` + 40 lei `card_online` în
--        registru (forma exactă din settle split 229) → cancel → respins.
--        Înainte de fix trecea fără motiv (guard-ul 118 e doar pe served).
--   CL4  Control pozitiv (anti-vacuu): served FĂRĂ registru + motiv → cancelled
--        (comportamentul vechi rămâne); plată INTEGRALĂ → paid → cancel respins
--        cu `order_terminal`, NU cu `cancel_over_payments` (ordinea guard-urilor
--        e neschimbată).
--   CL5  Clichet structural VIU: trigger BEFORE INSERT OR UPDATE ROW pe orders,
--        funcția citește registrul, `advance_order` poartă hint-ul + TOATE
--        invariantele lanțului 243/262/263/264.
--   CL6  IEȘIREA din gate — `void_order_payment`: waiter → role_insufficient;
--        fără motiv → void_reason_required; pe comandă `paid` → order_terminal;
--        owner cu motiv → rândul dispare, audit_log DELETE cu void_reason, iar
--        anularea trece. Fără storno gate-ul ar fi un blocaj fără ieșire.
--
-- Suita rulează ca `postgres`, care ocolește RLS dar NU triggerele — exact
-- subiectul testului (CL2). Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed: owner Plan 3 (pro), restaurant, comenzi ────────────────────────────
insert into auth.users (id, email) values
  ('70000000-0000-4000-8000-000000000001', 'cl-owner@cl.test'),
  ('70000000-0000-4000-8000-000000000002', 'cl-waiter@cl.test');
update public.profiles set plan = 'pro' where id = '70000000-0000-4000-8000-000000000001';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('70b00000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'CL Pro', 'cl-pro', 'Cluj', true);
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('70b00000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'waiter');

insert into public.orders (id, restaurant_id, source, status, total) values
  ('70f00000-0000-4000-8000-000000000001', '70b00000-0000-4000-8000-000000000001', 'qr', 'served',    100),
  ('70f00000-0000-4000-8000-000000000002', '70b00000-0000-4000-8000-000000000001', 'qr', 'preparing', 100),
  ('70f00000-0000-4000-8000-000000000003', '70b00000-0000-4000-8000-000000000001', 'qr', 'served',    100),
  ('70f00000-0000-4000-8000-000000000004', '70b00000-0000-4000-8000-000000000001', 'qr', 'served',    100),
  ('70f00000-0000-4000-8000-000000000005', '70b00000-0000-4000-8000-000000000001', 'qr', 'served',    100);

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- ── CL1: parțială cash → cancel prin RPC → respins, registrul neatins ────────
do $$
declare v_o uuid := '70f00000-0000-4000-8000-000000000001'; v_hint text; v_status text; v_n int; v_sum numeric;
begin
  perform public.add_partial_payment(v_o, 60, 'cash');
  -- Ordinea guard-urilor e înghețată: pe served FĂRĂ motiv, refuzul e
  -- cancel_reason_required (mig 118) ÎNAINTE de registru.
  v_hint := null;
  begin
    perform public.advance_order(v_o, 'cancel', null, null, null, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'cancel_reason_required' then
    raise exception 'CL1 FAIL: ordinea guard-urilor s-a schimbat — served fără motiv trebuie să dea cancel_reason_required (hint=%)', v_hint; end if;
  v_hint := null;
  begin
    perform public.advance_order(v_o, 'cancel', null, null, null, 'clientul a plecat');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'cancel_over_payments' then
    raise exception 'CL1 FAIL: anularea peste 60 lei încasați NU a fost respinsă (hint=%)', v_hint; end if;
  select status into v_status from public.orders where id = v_o;
  if v_status <> 'served' then
    raise exception 'CL1 FAIL: comanda a părăsit starea served (status=%)', v_status; end if;
  select count(*), coalesce(sum(amount), 0) into v_n, v_sum from public.order_payments where order_id = v_o;
  if v_n <> 1 or v_sum <> 60 then
    raise exception 'CL1 FAIL: registrul a fost atins (n=%, sum=%)', v_n, v_sum; end if;
  raise notice 'CL1 OK: cancel peste parțială → cancel_over_payments, served + registru intact';
end $$;

-- ── CL2: PATCH direct (calea PostgREST sub „orders: admin all") → trigger ────
do $$
declare v_o uuid := '70f00000-0000-4000-8000-000000000001'; v_hint text; v_status text;
begin
  v_hint := null;
  begin
    update public.orders set status = 'cancelled', cancelled_at = now() where id = v_o;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'cancel_over_payments' then
    raise exception 'CL2 FAIL: UPDATE direct la cancelled peste registru nu a fost respins de trigger (hint=%)', v_hint; end if;
  select status into v_status from public.orders where id = v_o;
  if v_status <> 'served' then
    raise exception 'CL2 FAIL: comanda a fost anulată prin UPDATE direct (status=%)', v_status; end if;
  raise notice 'CL2 OK: gate-ul e în DATE — PATCH-ul direct e respins';
end $$;

-- ── CL3: online pe comandă NE-served, fără motiv → respins ──────────────────
do $$
declare v_o uuid := '70f00000-0000-4000-8000-000000000002'; v_hint text; v_status text;
begin
  -- Forma exactă din settle_table_payment (ramura split, mig 229).
  insert into public.order_payments (order_id, amount, method, paid_by)
    values (v_o, 40, 'card_online', null);
  v_hint := null;
  begin
    perform public.advance_order(v_o, 'cancel', null, null, null, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'cancel_over_payments' then
    raise exception 'CL3 FAIL: anularea unei comenzi preparing cu 40 lei card_online a trecut (hint=%)', v_hint; end if;
  select status into v_status from public.orders where id = v_o;
  if v_status <> 'preparing' then
    raise exception 'CL3 FAIL: status=% (așteptat preparing)', v_status; end if;
  raise notice 'CL3 OK: gate-ul e pe REGISTRU, nu pe status/motiv';
end $$;

-- ── CL4: control pozitiv — fără bani se anulează; integral plătită → terminal ─
do $$
declare v_o3 uuid := '70f00000-0000-4000-8000-000000000003';
        v_o4 uuid := '70f00000-0000-4000-8000-000000000004';
        v_hint text; v_status text;
begin
  perform public.advance_order(v_o3, 'cancel', null, null, null, 'produs nedisponibil');
  select status into v_status from public.orders where id = v_o3;
  if v_status <> 'cancelled' then
    raise exception 'CL4a FAIL: anularea unei comenzi FĂRĂ bani a fost blocată (status=%) — regresie', v_status; end if;

  perform public.add_partial_payment(v_o4, 100, 'cash');   -- integral → paid
  select status into v_status from public.orders where id = v_o4;
  if v_status <> 'paid' then
    raise exception 'CL4b: precondiție — plata integrală nu a dus comanda în paid (status=%)', v_status; end if;
  v_hint := null;
  begin
    perform public.advance_order(v_o4, 'cancel', null, null, null, 'x');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'order_terminal' then
    raise exception 'CL4b FAIL: pe o comandă paid guard-ul terminal trebuie să vină PRIMUL (hint=%)', v_hint; end if;
  raise notice 'CL4 OK: cancel fără bani trece; ordinea guard-urilor e neschimbată';
end $$;

-- ── CL5: clichet structural VIU ───────────────────────────────────────────────
do $$
declare v_tgtype smallint; v_src text; v_sig text;
begin
  select tgtype into v_tgtype from pg_trigger
   where tgname = 'trg_orders_cancel_ledger_gate'
     and tgrelid = 'public.orders'::regclass and not tgisinternal;
  if v_tgtype is null then
    raise exception 'CL5 FAIL: trg_orders_cancel_ledger_gate lipsește de pe orders'; end if;
  if (v_tgtype & 2) = 0 or (v_tgtype & 4) = 0 or (v_tgtype & 16) = 0 or (v_tgtype & 1) = 0 then
    raise exception 'CL5 FAIL: trigger-ul trebuie să fie BEFORE INSERT OR UPDATE FOR EACH ROW, oglinda 264 (tgtype=%)', v_tgtype; end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_cancel_ledger_gate';
  if v_src is null or position('order_payments' in v_src) = 0 or position('cancel_over_payments' in v_src) = 0 then
    raise exception 'CL5 FAIL: enforce_cancel_ledger_gate nu citește registrul / nu poartă hint-ul'; end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'advance_order';
  foreach v_sig in array array['cancel_over_payments',
                               'underpayment', 'overpayment', 'fiscal_plan_requires_payment',
                               'table_lifecycle', 'invalid_payment_method', 'for update of o',
                               'cancel_reason_required', 'v_final - v_tips', 'fiscal_receipt',
                               'values (p_order_id, v_net', 'paid_amount = v_partial + v_net',
                               'paid_amount=coalesce(v_net, paid_amount)',
                               'paid_amount_required'] loop
    if position(v_sig in lower(v_src)) = 0 and position(v_sig in v_src) = 0 then
      raise exception 'CL5 FAIL: advance_order a pierdut invariantul „%"', v_sig; end if;
  end loop;
  raise notice 'CL5 OK: trigger BEFORE INSERT OR UPDATE ROW + registru + invariantele advance_order';
end $$;

-- ── CL6: ieșirea din gate — storno cu motiv, doar admin, doar ne-terminale ────
do $$
declare v_o5 uuid := '70f00000-0000-4000-8000-000000000005';
        v_o4 uuid := '70f00000-0000-4000-8000-000000000004';   -- paid din CL4
        v_pid uuid; v_pid4 uuid; v_hint text; v_res jsonb; v_status text; v_n int; v_reason text;
begin
  perform public.add_partial_payment(v_o5, 30, 'cash');
  select id into v_pid from public.order_payments where order_id = v_o5;
  select id into v_pid4 from public.order_payments where order_id = v_o4 limit 1;

  -- (a) waiter → role_insufficient (storno-ul e decizie de admin).
  perform set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true);
  v_hint := null;
  begin
    perform public.void_order_payment(v_pid, 'test');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'role_insufficient' then
    raise exception 'CL6a FAIL: un waiter a putut storna o plată (hint=%)', v_hint; end if;
  perform set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);

  -- (b) fără motiv → void_reason_required.
  v_hint := null;
  begin
    perform public.void_order_payment(v_pid, '   ');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'void_reason_required' then
    raise exception 'CL6b FAIL: storno fără motiv a trecut (hint=%)', v_hint; end if;

  -- (c) pe o comandă paid → order_terminal (registrul e sursa bonului emis).
  v_hint := null;
  begin
    perform public.void_order_payment(v_pid4, 'x');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'order_terminal' then
    raise exception 'CL6c FAIL: storno pe o comandă paid a trecut (hint=%)', v_hint; end if;
  select count(*) into v_n from public.order_payments where order_id = v_o4;
  if v_n <> 1 then raise exception 'CL6c FAIL: registrul comenzii paid a fost atins'; end if;

  -- (d) owner, cu motiv → rândul dispare, audit_log DELETE cu void_reason, cancel-ul trece.
  v_res := public.void_order_payment(v_pid, 'clientul a primit banii înapoi');
  if (v_res->>'amount')::numeric <> 30 or v_res->>'method' <> 'cash' then
    raise exception 'CL6d FAIL: răspunsul storno-ului e greșit (%)', v_res; end if;
  select count(*) into v_n from public.order_payments where order_id = v_o5;
  if v_n <> 0 then raise exception 'CL6d FAIL: rândul stornat a rămas în registru'; end if;
  select old_data->>'void_reason' into v_reason from public.audit_log
   where table_name = 'order_payments' and operation = 'DELETE' and row_id = v_pid::text;
  if v_reason is distinct from 'clientul a primit banii înapoi' then
    raise exception 'CL6d FAIL: storno-ul nu a lăsat urmă în audit_log (reason=%)', v_reason; end if;
  if (select actor_id from public.audit_log where table_name = 'order_payments' and row_id = v_pid::text)
     <> '70000000-0000-4000-8000-000000000001' then
    raise exception 'CL6d FAIL: audit_log nu poartă actorul storno-ului'; end if;

  perform public.advance_order(v_o5, 'cancel', null, null, null, 'bucătăria nu poate onora');
  select status into v_status from public.orders where id = v_o5;
  if v_status <> 'cancelled' then
    raise exception 'CL6d FAIL: după storno anularea a fost blocată (status=%)', v_status; end if;
  raise notice 'CL6 OK: storno = ieșirea din gate (admin + motiv + audit); waiter/fără motiv/paid respinse';
end $$;

rollback;

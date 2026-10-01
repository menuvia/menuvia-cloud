-- tests/sql/paid_immutable_tablepay_assertions.sql
-- =============================================================================
-- Asserții permanente pentru mig 292 — bani pe Planul 3.
--
-- BF-4  O comandă `paid` (bonată) se putea rescrie prin PATCH direct al unui
--       admin (politica `orders: admin all`, mig 013): status → cancelled,
--       paid_amount, payment_method, total, discount_*, tips_amount, paid_at.
--       Gate-ul `trg_orders_cancel_ledger_gate` (270) verifică DOAR registrul
--       `order_payments`, iar `mark_paid` FĂRĂ plăți parțiale scrie doar
--       `paid_amount` (registrul rămâne GOL) → `paid → cancelled` trecea.
--         PI1  precondiția defectului: comandă paid, registru GOL; sub rolul
--              REAL `authenticated` FIECARE coloană de bani e respinsă
--              (hint paid_order_immutable) și rândul rămâne neschimbat.
--         PI2  control pozitiv (anti-vacuu): identitatea (customer_name),
--              notes și fiscal_receipt_requested_at se pot scrie pe o comandă
--              paid; pe o comandă NE-paid același rol poate schimba statusul
--              (trigger-ul mușcă DOAR pe `old.status = 'paid'`).
--         PI3  fluxurile legitime trec: `advance_order` mark_paid chemat ca
--              `authenticated` (DEFINER → current_user = owner-ul funcției),
--              `request_fiscal_receipt` ca `anon`, `anonymize_guest_pii` pe o
--              comandă pickup paid veche; plăți parțiale → paid.
--         PI4  clichet structural: tgtype = 19 EXACT (BEFORE UPDATE ROW, fără
--              `UPDATE OF`), funcția NE-definer, fără EXECUTE pentru roluri
--              client (RP13).
--
-- BF-1  Dublă încasare la „toată masa": un intent `failed` rămâne CONFIRMABIL
--       (mig 207), dar `begin_table_payment`/`begin_split_payment` puneau în
--       `superseded_intents` doar `created/processing` → B plătea nota, A
--       reîncerca cu alt card și plătea încă o dată.
--         PT1  A failed (intent atașat) → begin_table_payment al lui B îl
--              întoarce spre anulare; după settle `canceled` nu mai apare.
--         PT2  același lucru la begin_split_payment pe un intent `kind='table'`
--              failed.
--         PT3  control: un split RECENT `failed` al ALTUI telefon NU se
--              anulează (regula curentă: doar stale > 15 min) și claims-urile
--              lui rămân ținute.
--         PT4  invarianții moșteniți (gate-uri 209/229, ACL service_role-only).
--
-- Suita rulează ca `postgres`; identitatea (authenticated/anon/service_role) se
-- schimbă EXPLICIT cu set_config('role', …) — ca postgres RLS-ul e ocolit și
-- PI1 ar fi orb (trigger-ul se vede doar sub un rol client). Self-contained,
-- ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('92000000-0000-4000-8000-000000000001', 'pi-owner@pi.test');
update public.profiles set plan = 'enterprise'
 where id = '92000000-0000-4000-8000-000000000001';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('92b00000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001',
   'PI Enterprise', 'pi-enterprise', 'Cluj', true);
update public.restaurants set stripe_account_id = 'acct_test_pi'
 where id = '92b00000-0000-4000-8000-000000000001';
insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('92b00000-0000-4000-8000-000000000001', 'online_payments', true);

-- Comenzi BF-4 (ne-sesiune: waiter/pickup).
insert into public.orders (id, restaurant_id, source, status, total, customer_name, customer_phone) values
  ('92f00000-0000-4000-8000-000000000001', '92b00000-0000-4000-8000-000000000001', 'waiter', 'served', 100, null, null),
  ('92f00000-0000-4000-8000-000000000002', '92b00000-0000-4000-8000-000000000001', 'waiter', 'served', 100, null, null),
  ('92f00000-0000-4000-8000-000000000003', '92b00000-0000-4000-8000-000000000001', 'pickup', 'served',  50, 'Pickup Vechi', '0755111222'),
  ('92f00000-0000-4000-8000-000000000004', '92b00000-0000-4000-8000-000000000001', 'waiter', 'served',  80, null, null);

select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Plata integrală FĂRĂ plăți parțiale: `paid_amount` setat, registrul GOL — forma
-- exactă care făcea gate-ul 270 orb. Chemată SUB rolul real `authenticated`.
do $$
declare v_n int; v_st text;
begin
  perform set_config('role', 'authenticated', true);
  perform public.advance_order('92f00000-0000-4000-8000-000000000001', 'mark_paid', 100, 'cash', null, null);
  perform public.advance_order('92f00000-0000-4000-8000-000000000002', 'mark_paid', 100, 'cash', null, null);
  perform public.advance_order('92f00000-0000-4000-8000-000000000003', 'mark_paid',  50, 'card_pos', null, null);
  perform set_config('role', 'none', true);

  select count(*) into v_n from public.orders
   where id in ('92f00000-0000-4000-8000-000000000001','92f00000-0000-4000-8000-000000000002',
                '92f00000-0000-4000-8000-000000000003')
     and status = 'paid' and paid_amount is not null;
  if v_n <> 3 then
    raise exception 'PI0: precondiție — mark_paid sub rolul authenticated nu a produs 3 comenzi paid (n=%)', v_n; end if;
  select count(*) into v_n from public.order_payments
   where order_id in ('92f00000-0000-4000-8000-000000000001','92f00000-0000-4000-8000-000000000002');
  if v_n <> 0 then
    raise exception 'PI0: precondiție — registrul trebuia să fie GOL pentru mark_paid fără parțiale (n=%)', v_n; end if;
  select status into v_st from public.orders where id = '92f00000-0000-4000-8000-000000000004';
  if v_st <> 'served' then raise exception 'PI0: fixtura 4 trebuia să rămână served'; end if;
end $$;

-- ── PI1: sub `authenticated`, FIECARE coloană de bani e respinsă pe paid ────
do $$
declare
  v_o   uuid := '92f00000-0000-4000-8000-000000000001';
  v_col text; v_set text; v_hint text; v_before jsonb; v_after jsonb;
  v_cases text[][] := array[
    array['status',          $c$status = 'cancelled', cancelled_at = now()$c$],
    array['paid_amount',     'paid_amount = 1'],
    array['payment_method',  $c$payment_method = 'card_pos'$c$],
    array['total',           'total = 1'],
    array['discount_type',   $c$discount_type = 'amount'$c$],
    array['discount_value',  'discount_value = 99'],
    array['discount_amount', 'discount_amount = 99'],
    array['tips_amount',     'tips_amount = 7'],
    array['paid_at',         $c$paid_at = now() - interval '3 days'$c$]
  ];
  i int;
begin
  select to_jsonb(o) into v_before from public.orders o where o.id = v_o;
  perform set_config('role', 'authenticated', true);
  for i in 1 .. array_length(v_cases, 1) loop
    v_col := v_cases[i][1]; v_set := v_cases[i][2];
    v_hint := null;
    begin
      execute format('update public.orders set %s where id = %L', v_set, v_o);
      v_hint := 'NU A FOST RESPINS';
      raise exception 'rollback-sub' using errcode = 'P0002';
    exception when others then
      if sqlstate <> 'P0002' then
        get stacked diagnostics v_hint = pg_exception_hint;
      end if;
    end;
    if v_hint is distinct from 'paid_order_immutable' then
      perform set_config('role', 'none', true);
      raise exception 'PI1 FAIL: UPDATE direct pe % al unei comenzi PAID (registru gol) nu a fost respins (hint=%)', v_col, v_hint;
    end if;
  end loop;
  perform set_config('role', 'none', true);
  select to_jsonb(o) into v_after from public.orders o where o.id = v_o;
  if v_after is distinct from v_before then
    raise exception 'PI1 FAIL: comanda paid a fost modificată în ciuda respingerilor';
  end if;
  raise notice 'PI1 OK: 9 coloane de bani respinse sub authenticated pe comanda paid cu registru gol; rândul intact';
end $$;

-- ── PI2: control pozitiv — identitate/notes/fiscal_receipt_requested_at trec;
--        pe NE-paid statusul se poate schimba (trigger-ul mușcă doar pe paid) ──
do $$
declare
  v_paid uuid := '92f00000-0000-4000-8000-000000000001';
  v_open uuid := '92f00000-0000-4000-8000-000000000004';
  v_name text; v_fr timestamptz; v_status text;
begin
  perform set_config('role', 'authenticated', true);
  update public.orders
     set customer_name = 'Corectat', notes = 'nota', fiscal_receipt_requested_at = now()
   where id = v_paid;
  update public.orders set status = 'cancelled', cancelled_at = now() where id = v_open;
  perform set_config('role', 'none', true);

  select customer_name, fiscal_receipt_requested_at into v_name, v_fr from public.orders where id = v_paid;
  if v_name is distinct from 'Corectat' or v_fr is null then
    raise exception 'PI2 FAIL: coloanele de identitate/fiscal_receipt_requested_at nu s-au scris pe comanda paid (name=%, fr=%)', v_name, v_fr; end if;
  select status into v_status from public.orders where id = v_open;
  if v_status is distinct from 'cancelled' then
    raise exception 'PI2 FAIL: pe o comandă NE-paid statusul nu s-a putut schimba (status=%) — trigger-ul e prea larg', v_status; end if;
  raise notice 'PI2 OK: control pozitiv — identitate scriptibilă pe paid; ne-paid neafectat';
end $$;

-- ── PI3: fluxurile legitime ─────────────────────────────────────────────────
do $$
declare
  v_pick uuid := '92f00000-0000-4000-8000-000000000003';
  v_pay  uuid := '92f00000-0000-4000-8000-000000000002';
  v_res jsonb; v_name text; v_phone text; v_fr timestamptz; v_st text; v_amt numeric;
begin
  -- (a) request_fiscal_receipt ca ANON (DEFINER; comandă fără sesiune): scrie
  --     fiscal_receipt_requested_at pe o comandă paid, nu e coloană protejată.
  perform set_config('role', 'anon', true);
  v_res := public.request_fiscal_receipt(v_pay, null);
  perform set_config('role', 'none', true);
  select fiscal_receipt_requested_at into v_fr from public.orders where id = v_pay;
  if v_fr is null or (v_res->>'success') is distinct from 'true' then
    raise exception 'PI3a FAIL: request_fiscal_receipt pe comandă paid (res=%, fr=%)', v_res, v_fr; end if;

  -- (b) anonymize_guest_pii (mig 280, DEFINER, rulează ca postgres) pe pickup paid vechi.
  update public.orders set created_at = now() - interval '13 months', paid_at = now() - interval '13 months'
   where id = v_pick;
  perform public.anonymize_guest_pii(12, 90, 30);
  select customer_name, customer_phone, status, paid_amount into v_name, v_phone, v_st, v_amt
    from public.orders where id = v_pick;
  if v_name is distinct from '[anonimizat]' or v_phone is not null then
    raise exception 'PI3b FAIL: anonimizarea GDPR a comenzii pickup paid a fost blocată (nume=%, tel=%)', v_name, v_phone; end if;
  if v_st <> 'paid' or v_amt <> 50 then
    raise exception 'PI3b FAIL: anonimizarea a atins câmpurile de bani (status=%, paid_amount=%)', v_st, v_amt; end if;
  raise notice 'PI3 OK: request_fiscal_receipt (anon), anonymize_guest_pii și mark_paid (authenticated→DEFINER) trec; banii neatinși';
end $$;

-- ── PI4: clichet structural ─────────────────────────────────────────────────
do $$
declare v_tgtype smallint; v_attr text;
begin
  select tgtype, tgattr::text into v_tgtype, v_attr from pg_trigger
   where tgname = 'trg_orders_paid_immutable'
     and tgrelid = 'public.orders'::regclass and not tgisinternal;
  if v_tgtype is null then
    raise exception 'PI4 FAIL: trg_orders_paid_immutable lipsește de pe orders'; end if;
  if v_tgtype <> 19 then
    raise exception 'PI4 FAIL: trigger-ul trebuie să fie BEFORE UPDATE FOR EACH ROW (tgtype=19), găsit %', v_tgtype; end if;
  if v_attr <> '' then
    raise exception 'PI4 FAIL: trigger-ul nu are voie să aibă listă UPDATE OF (tgattr=%)', v_attr; end if;
  if (select prosecdef from pg_proc where oid = 'public.fn_orders_paid_immutable()'::regprocedure) then
    raise exception 'PI4 FAIL: funcția trebuie să fie NE-definer (altfel current_user nu mai e rolul apelantului și PI1 devine vacuu)'; end if;
  if has_function_privilege('anon', 'public.fn_orders_paid_immutable()', 'execute')
     or has_function_privilege('authenticated', 'public.fn_orders_paid_immutable()', 'execute') then
    raise exception 'PI4 FAIL: funcția de trigger e executabilă de roluri client (RP13)'; end if;
  raise notice 'PI4 OK: tgtype=19, NE-definer, fără EXECUTE client';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- BF-1
-- ═════════════════════════════════════════════════════════════════════════════
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('92c00000-0000-4000-8000-000000000001','92b00000-0000-4000-8000-000000000001','Masa PT1','masa-pt1',4,true),
  ('92c00000-0000-4000-8000-000000000002','92b00000-0000-4000-8000-000000000001','Masa PT2','masa-pt2',4,true),
  ('92c00000-0000-4000-8000-000000000003','92b00000-0000-4000-8000-000000000001','Masa PT3','masa-pt3',4,true);
insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
  ('92d00000-0000-4000-8000-000000000001','92b00000-0000-4000-8000-000000000001','92c00000-0000-4000-8000-000000000001','tok_pt1',true),
  ('92d00000-0000-4000-8000-000000000002','92b00000-0000-4000-8000-000000000001','92c00000-0000-4000-8000-000000000002','tok_pt2',true),
  ('92d00000-0000-4000-8000-000000000003','92b00000-0000-4000-8000-000000000001','92c00000-0000-4000-8000-000000000003','tok_pt3',true);
insert into public.table_sessions (id, restaurant_id, table_id, status) values
  ('92e00000-0000-4000-8000-000000000001','92b00000-0000-4000-8000-000000000001','92c00000-0000-4000-8000-000000000001','open'),
  ('92e00000-0000-4000-8000-000000000002','92b00000-0000-4000-8000-000000000001','92c00000-0000-4000-8000-000000000002','open'),
  ('92e00000-0000-4000-8000-000000000003','92b00000-0000-4000-8000-000000000001','92c00000-0000-4000-8000-000000000003','open');

insert into public.orders (id, restaurant_id, source, status, total, session_id, table_id, qr_token_id) values
  ('92a00000-0000-4000-8000-000000000001','92b00000-0000-4000-8000-000000000001','qr','served',0,
   '92e00000-0000-4000-8000-000000000001','92c00000-0000-4000-8000-000000000001','92d00000-0000-4000-8000-000000000001'),
  ('92a00000-0000-4000-8000-000000000002','92b00000-0000-4000-8000-000000000001','qr','served',0,
   '92e00000-0000-4000-8000-000000000002','92c00000-0000-4000-8000-000000000002','92d00000-0000-4000-8000-000000000002'),
  ('92a00000-0000-4000-8000-000000000003','92b00000-0000-4000-8000-000000000001','qr','served',0,
   '92e00000-0000-4000-8000-000000000003','92c00000-0000-4000-8000-000000000003','92d00000-0000-4000-8000-000000000003');
insert into public.order_items (id, order_id, product_name_snapshot, unit_price_snapshot, quantity, item_total) values
  ('92110000-0000-4000-8000-000000000001','92a00000-0000-4000-8000-000000000001','Fel PT1',30,1,30),
  ('92110000-0000-4000-8000-000000000002','92a00000-0000-4000-8000-000000000002','Fel PT2',30,1,30),
  ('92110000-0000-4000-8000-000000000003','92a00000-0000-4000-8000-000000000003','Fel A PT3',20,1,20),
  ('92110000-0000-4000-8000-000000000004','92a00000-0000-4000-8000-000000000003','Fel B PT3',10,1,10);

-- ── PT1: A (table, failed + intent) → begin_table_payment al lui B îl supersedează
do $$
declare
  v_a jsonb; v_b jsonb; v_c jsonb; v_status text;
begin
  perform set_config('role', 'service_role', true);   -- rolul REAL al funcției Netlify
  v_a := public.begin_table_payment('92e00000-0000-4000-8000-000000000001', 'tok_pt1');
  perform public.attach_payment_intent((v_a->>'payment_id')::uuid, 'pi_pt1_a');
  perform public.settle_table_payment('pi_pt1_a', 'failed', 'card_declined');
  perform set_config('role', 'none', true);
  select status into v_status from public.table_payments where stripe_payment_intent_id = 'pi_pt1_a';
  if v_status <> 'failed' then
    raise exception 'PT1: precondiție — rândul lui A trebuia să fie failed (status=%)', v_status; end if;

  perform set_config('role', 'service_role', true);
  v_b := public.begin_table_payment('92e00000-0000-4000-8000-000000000001', 'tok_pt1');
  perform set_config('role', 'none', true);
  if not (v_b->'superseded_intents') @> '["pi_pt1_a"]'::jsonb then
    raise exception 'PT1 FAIL: intent-ul FAILED (încă confirmabil) al lui A nu e în superseded_intents: % — A poate plăti a doua oară după B', v_b->'superseded_intents'; end if;

  -- Funcția Netlify, după cancel-ul reușit la Stripe: settle 'canceled' (failed → canceled).
  perform set_config('role', 'service_role', true);
  perform public.settle_table_payment('pi_pt1_a', 'canceled', 'Înlocuit de o plată nouă');
  perform set_config('role', 'none', true);
  select status into v_status from public.table_payments where stripe_payment_intent_id = 'pi_pt1_a';
  if v_status <> 'canceled' then
    raise exception 'PT1 FAIL: tranziția failed → canceled nu e permisă de settle (status=%)', v_status; end if;
  -- Un al treilea begin NU mai raportează intent-ul deja anulat (idempotent).
  perform set_config('role', 'service_role', true);
  v_c := public.begin_table_payment('92e00000-0000-4000-8000-000000000001', 'tok_pt1');
  perform set_config('role', 'none', true);
  if (v_c->'superseded_intents') @> '["pi_pt1_a"]'::jsonb then
    raise exception 'PT1 FAIL: un intent deja canceled reapare în superseded_intents'; end if;
  raise notice 'PT1 OK: failed cu intent → superseded; după settle canceled dispare';
end $$;

-- ── PT2: begin_split_payment supersedează un intent kind='table' failed ──────
do $$
declare v_a jsonb; v_s jsonb;
begin
  perform set_config('role', 'service_role', true);
  v_a := public.begin_table_payment('92e00000-0000-4000-8000-000000000002', 'tok_pt2');
  perform public.attach_payment_intent((v_a->>'payment_id')::uuid, 'pi_pt2_a');
  perform public.settle_table_payment('pi_pt2_a', 'failed', 'card_declined');
  v_s := public.begin_split_payment('92e00000-0000-4000-8000-000000000002', 'tok_pt2',
    '[{"order_item_id":"92110000-0000-4000-8000-000000000002","quantity":1}]'::jsonb);
  perform set_config('role', 'none', true);
  if not (v_s->'superseded_intents') @> '["pi_pt2_a"]'::jsonb then
    raise exception 'PT2 FAIL: split-ul nu supersedează intent-ul full-table FAILED (%)', v_s->'superseded_intents'; end if;
  raise notice 'PT2 OK: begin_split_payment supersedează kind=table failed';
end $$;

-- ── PT3: control — split RECENT failed al ALTUI telefon NU se anulează ───────
do $$
declare v_a jsonb; v_b jsonb; v_n int;
begin
  perform set_config('role', 'service_role', true);
  v_a := public.begin_split_payment('92e00000-0000-4000-8000-000000000003', 'tok_pt3',
    '[{"order_item_id":"92110000-0000-4000-8000-000000000003","quantity":1}]'::jsonb);
  perform public.attach_payment_intent((v_a->>'payment_id')::uuid, 'pi_pt3_a');
  perform public.settle_table_payment('pi_pt3_a', 'failed', 'card_declined');
  v_b := public.begin_split_payment('92e00000-0000-4000-8000-000000000003', 'tok_pt3',
    '[{"order_item_id":"92110000-0000-4000-8000-000000000004","quantity":1}]'::jsonb);
  perform set_config('role', 'none', true);
  if (v_b->'superseded_intents') @> '["pi_pt3_a"]'::jsonb then
    raise exception 'PT3 FAIL: un split RECENT failed al altui telefon a fost pus spre anulare (fereastră de dublă încasare/claims eliberate)'; end if;
  select count(*) into v_n from public.table_payments
   where stripe_payment_intent_id = 'pi_pt3_a' and status = 'failed';
  if v_n <> 1 then raise exception 'PT3 FAIL: rândul failed al split-ului A a fost atins'; end if;
  raise notice 'PT3 OK: split-urile recente ale altora rămân neatinse';
end $$;

-- ── PT4: invarianții moșteniți + ACL ────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.begin_table_payment(uuid, text)'::regprocedure) into v_src;
  if position('currency_not_supported' in v_src) = 0 or position('order_totals' in v_src) = 0
     or position('online_payments' in v_src) = 0 or position('order_payments' in v_src) = 0 then
    raise exception 'PT4 FAIL: begin_table_payment a pierdut un invariant (209/211)'; end if;
  select pg_get_functiondef('public.begin_split_payment(uuid, text, jsonb)'::regprocedure) into v_src;
  if position('currency_not_supported' in v_src) = 0 or position('split_bill' in v_src) = 0
     or position('items_already_claimed' in v_src) = 0 or position('interval ''15 minutes''' in v_src) = 0 then
    raise exception 'PT4 FAIL: begin_split_payment a pierdut un invariant (229)'; end if;
  if has_function_privilege('anon', 'public.begin_table_payment(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_table_payment(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.begin_split_payment(uuid, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_split_payment(uuid, text, jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.begin_table_payment(uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.begin_split_payment(uuid, text, jsonb)', 'execute') then
    raise exception 'PT4 FAIL: ACL — begin_* trebuie să rămână service_role-only'; end if;
  raise notice 'PT4 OK: invarianți + ACL service_role-only';
end $$;

rollback;

-- tests/sql/receipt_retry_ambiguous_assertions.sql
-- =============================================================================
-- Asserții permanente pentru mig 270 (B) — audit v3 RES-31: retry-ul unui bon
-- fiscal cu eșec AMBIGUU avea bariera DOAR în UI (BridgeTab confirmDialog).
-- `bridge_retry_receipt` nu citea `error_info`; un apel direct al RPC-ului sau
-- un PATCH direct pe `pending_receipts` re-punea rândul în `pending` cu
-- markerul ȘTERS → casa tipărea al DOILEA bon fiscal real.
--
--   RR1  marker scris de CRON (`bridge_mark_stale_as_error`) → retry FĂRĂ ack →
--        hint `ambiguous_receipt`; status rămâne error; markerul intact.
--   RR2  marker scris de BRIDGE (`bridge_confirm_receipt` cu prefixul din
--        bridge/lib/fiscalnet.js) → același rezultat (gate-ul e pe MARKER, nu
--        pe error_code).
--   RR3  retry CU ack → pending, iar `bridge_get_pending` îl vede (calea de
--        ack e VIE, nu un gate care blochează totul).
--   RR4  eroare CLARĂ (fără marker) → retry fără ack → pending (fără
--        supra-blocare; semantica AV7 păstrată).
--   RR5  SUB ROL CLIENT: `authenticated` (owner) face UPDATE direct
--        `status='pending'` pe rândul marcat → respins de trigger (hint
--        `direct_repend_forbidden`). Singurul test din suită care rulează sub
--        rol — ca postgres, trigger-ul de rol e ORB (clasa gate-ului mort).
--   RR6  după `bridge_cancel_receipt` markerul supraviețuiește pe `cancelled`
--        → retry fără ack → tot `ambiguous_receipt`.
--   RR7  clichet structural VIU: EXACT o semnătură (anti PGRST203), DEFINER cu
--        pg_temp, grant authenticated / nu anon, trigger BEFORE UPDATE ROW
--        NE-definer pe pending_receipts.
--
-- Self-contained, ROLLBACK la final. Seed ca AV (audit_v3_hardening).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('71000000-0000-4000-8000-000000000001', 'rr-owner@rr.test');
update public.profiles set plan = 'pro' where id = '71000000-0000-4000-8000-000000000001';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('71b00000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'RR Bistro', 'rr-bistro', 'Cluj', true);

insert into public.bridge_devices (id, restaurant_id, name, device_secret) values
  ('71e00000-0000-4000-8000-000000000001', '71b00000-0000-4000-8000-000000000001', 'Casa RR', 'RRSECRET');

insert into public.categories (id, restaurant_id, name) values
  ('71c00000-0000-4000-8000-000000000001', '71b00000-0000-4000-8000-000000000001', 'RR Cat');
insert into public.products (id, restaurant_id, category_id, name, price, vat_group, is_active, is_draft) values
  ('71d00000-0000-4000-8000-000000000001', '71b00000-0000-4000-8000-000000000001',
   '71c00000-0000-4000-8000-000000000001', 'RR Cafea', 10, 1, true, false);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

-- Trei comenzi plătite → enqueue (mig 259) → un rând pending_receipts fiecare
-- (payload '' la enqueue, itemii vin după — ca AV7; retry-ul îl regenerează).
insert into public.orders (id, restaurant_id, source, status, total, paid_amount, payment_method, paid_at) values
  ('71f00000-0000-4000-8000-000000000001', '71b00000-0000-4000-8000-000000000001', 'waiter', 'paid', 10, 10, 'cash', now()),
  ('71f00000-0000-4000-8000-000000000002', '71b00000-0000-4000-8000-000000000001', 'waiter', 'paid', 10, 10, 'cash', now()),
  ('71f00000-0000-4000-8000-000000000003', '71b00000-0000-4000-8000-000000000001', 'waiter', 'paid', 10, 10, 'cash', now());
insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
select o.id, '71d00000-0000-4000-8000-000000000001', 'RR Cafea', 1, 10, 10
  from public.orders o where o.restaurant_id = '71b00000-0000-4000-8000-000000000001';

do $$
declare v_n int;
begin
  select count(*) into v_n from public.pending_receipts
   where restaurant_id = '71b00000-0000-4000-8000-000000000001';
  if v_n <> 3 then
    raise exception 'RR seed: enqueue-ul pe INSERT (mig 259) a produs % rânduri (așteptat 3)', v_n; end if;
end $$;

-- ── RR1: marker de CRON → retry fără ack → respins, marker intact ────────────
do $$
declare v_rid uuid; v_hint text; v_status text; v_info text; v_n int;
begin
  select id into v_rid from public.pending_receipts where order_id = '71f00000-0000-4000-8000-000000000001';
  update public.pending_receipts
     set status = 'sent', claimed_at = now() - interval '20 minutes',
         bridge_device_id = '71e00000-0000-4000-8000-000000000001',
         error_code = null, error_info = null, completed_at = null
   where id = v_rid;
  v_n := public.bridge_mark_stale_as_error();
  if v_n < 1 then raise exception 'RR1: precondiție — cron-ul nu a marcat rândul'; end if;

  v_hint := null;
  begin
    perform public.bridge_retry_receipt(v_rid);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'ambiguous_receipt' then
    raise exception 'RR1 FAIL: retry-ul orb peste markerul de cron a trecut (hint=%) — bon fiscal DUBLU', v_hint; end if;
  select status, error_info into v_status, v_info from public.pending_receipts where id = v_rid;
  if v_status <> 'error' or v_info not like 'POSIBIL DUPLICAT%' then
    raise exception 'RR1 FAIL: rândul a pierdut starea/markerul (status=%, info=%)', v_status, v_info; end if;
  raise notice 'RR1 OK: marker de cron → ambiguous_receipt, marker intact';
end $$;

-- ── RR2: marker scris de BRIDGE (fiscalnet.js) → același gate ───────────────
do $$
declare v_rid uuid; v_hint text; v_status text; v_info text;
begin
  select id into v_rid from public.pending_receipts where order_id = '71f00000-0000-4000-8000-000000000002';
  update public.pending_receipts
     set status = 'sent', claimed_at = now(),
         bridge_device_id = '71e00000-0000-4000-8000-000000000001',
         error_code = null, error_info = null, completed_at = null
   where id = v_rid;
  perform public.bridge_confirm_receipt('RRSECRET', v_rid, false, null, 'RESPONSE_TIMEOUT',
    'POSIBIL DUPLICAT — verifică banda casei înainte de retrimitere: RESPONSE_TIMEOUT după predarea către driver');
  select status, error_info into v_status, v_info from public.pending_receipts where id = v_rid;
  if v_status <> 'error' or v_info not like 'POSIBIL DUPLICAT%' then
    raise exception 'RR2: precondiție — bridge_confirm_receipt nu a stocat markerul (status=%, info=%)', v_status, v_info; end if;

  v_hint := null;
  begin
    perform public.bridge_retry_receipt(v_rid);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'ambiguous_receipt' then
    raise exception 'RR2 FAIL: gate-ul nu prinde markerul scris de bridge (hint=%) — probabil e pe error_code, nu pe marker', v_hint; end if;
  raise notice 'RR2 OK: markerul din bridge e prins de același gate';
end $$;

-- ── RR3: retry CU ack → pending, vizibil pentru bridge ───────────────────────
do $$
declare v_rid uuid; v_ok boolean; v_status text; v_seen int;
begin
  select id into v_rid from public.pending_receipts where order_id = '71f00000-0000-4000-8000-000000000001';
  v_ok := public.bridge_retry_receipt(v_rid, true);
  select status into v_status from public.pending_receipts where id = v_rid;
  if v_ok is not true or v_status <> 'pending' then
    raise exception 'RR3 FAIL: retry-ul CU ack nu a re-pus bonul în coadă (ok=%, status=%)', v_ok, v_status; end if;
  select count(*) into v_seen from public.bridge_get_pending('RRSECRET') g where g.id = v_rid;
  if v_seen <> 1 then
    raise exception 'RR3 FAIL: bridge_get_pending nu vede bonul re-pus (n=%)', v_seen; end if;
  raise notice 'RR3 OK: calea de ack e vie';
end $$;

-- ── RR4: eroare CLARĂ → retry fără ack → pending (fără supra-blocare) ────────
do $$
declare v_rid uuid; v_ok boolean; v_status text;
begin
  select id into v_rid from public.pending_receipts where order_id = '71f00000-0000-4000-8000-000000000003';
  update public.pending_receipts
     set status = 'error', error_code = 'HTTP_500', error_info = 'FiscalNet: eroare 500 la scriere', completed_at = now()
   where id = v_rid;
  v_ok := public.bridge_retry_receipt(v_rid);
  select status into v_status from public.pending_receipts where id = v_rid;
  if v_ok is not true or v_status <> 'pending' then
    raise exception 'RR4 FAIL: un eșec CLAR a fost blocat la retry (ok=%, status=%) — gate prea larg', v_ok, v_status; end if;
  raise notice 'RR4 OK: eșecul clar se retrimite fără ack';
end $$;

-- ── RR5: SUB ROL CLIENT — PATCH direct →pending e respins de trigger ─────────
set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000001';
do $$
declare v_rid uuid; v_hint text;
begin
  select id into v_rid from public.pending_receipts where order_id = '71f00000-0000-4000-8000-000000000002';
  if v_rid is null then raise exception 'RR5: precondiție — owner-ul nu vede rândul sub RLS'; end if;
  v_hint := null;
  begin
    update public.pending_receipts
       set status = 'pending', bridge_device_id = null, claimed_at = null
     where id = v_rid;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'direct_repend_forbidden' then
    raise exception 'RR5 FAIL: UPDATE-ul direct la pending ca authenticated a trecut (hint=%) — ocolește RPC-ul', v_hint; end if;
end $$;
reset role;
do $$
declare v_status text;
begin
  select status into v_status from public.pending_receipts where order_id = '71f00000-0000-4000-8000-000000000002';
  if v_status <> 'error' then
    raise exception 'RR5 FAIL: rândul a fost re-pus în coadă prin UPDATE direct (status=%)', v_status; end if;
  raise notice 'RR5 OK: backstop-ul din DATE respinge re-punerea directă din rolurile client';
end $$;

-- ── RR6: după cancel markerul supraviețuiește → retry fără ack tot respins ───
do $$
declare v_rid uuid; v_hint text; v_status text;
begin
  select id into v_rid from public.pending_receipts where order_id = '71f00000-0000-4000-8000-000000000002';
  perform public.bridge_cancel_receipt(v_rid);
  select status into v_status from public.pending_receipts where id = v_rid;
  if v_status <> 'cancelled' then
    raise exception 'RR6: precondiție — cancel nu a dus rândul în cancelled (status=%)', v_status; end if;
  v_hint := null;
  begin
    perform public.bridge_retry_receipt(v_rid);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'ambiguous_receipt' then
    raise exception 'RR6 FAIL: gate-ul e condiționat de status=error — pe cancelled retry-ul orb a trecut (hint=%)', v_hint; end if;
  raise notice 'RR6 OK: gate-ul e independent de status';
end $$;

-- ── RR7: clichet structural VIU ───────────────────────────────────────────────
do $$
declare v_n int; v_src text; v_tgtype smallint;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_retry_receipt';
  if v_n <> 1 then
    raise exception 'RR7 FAIL: bridge_retry_receipt are % semnături — PostgREST ar răspunde PGRST203', v_n; end if;
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_retry_receipt';
  if position('security definer' in lower(v_src)) = 0 or position('pg_temp' in v_src) = 0 then
    raise exception 'RR7 FAIL: bridge_retry_receipt nu e DEFINER cu pg_temp'; end if;
  if position('POSIBIL DUPLICAT' in v_src) = 0 or position('ambiguous_receipt' in v_src) = 0 then
    raise exception 'RR7 FAIL: gate-ul pe marker a dispărut din sursă'; end if;
  if not has_function_privilege('authenticated', 'public.bridge_retry_receipt(uuid, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.bridge_retry_receipt(uuid, boolean)', 'EXECUTE') then
    raise exception 'RR7 FAIL: grant-urile pe bridge_retry_receipt sunt greșite'; end if;

  select tgtype into v_tgtype from pg_trigger
   where tgname = 'trg_pending_receipts_block_client_repend'
     and tgrelid = 'public.pending_receipts'::regclass and not tgisinternal;
  if v_tgtype is null then
    raise exception 'RR7 FAIL: trg_pending_receipts_block_client_repend lipsește'; end if;
  if (v_tgtype & 2) = 0 or (v_tgtype & 16) = 0 or (v_tgtype & 1) = 0 then
    raise exception 'RR7 FAIL: trigger-ul trebuie să fie BEFORE UPDATE FOR EACH ROW (tgtype=%)', v_tgtype; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'fn_pending_receipts_block_client_repend' and p.prosecdef) then
    raise exception 'RR7 FAIL: funcția de trigger a devenit DEFINER — nu mai vede rolul apelantului, RR5 ar deveni vacuu'; end if;
  raise notice 'RR7 OK: o singură semnătură, DEFINER+pg_temp, grant-uri corecte, backstop NE-definer';
end $$;

rollback;

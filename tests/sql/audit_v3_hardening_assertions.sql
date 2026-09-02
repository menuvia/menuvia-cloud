-- tests/sql/audit_v3_hardening_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 262 (remedierile auditului v3, sept 2026).
-- Self-contained, ROLLBACK la final.
--
--   AV1  SEC-01: authenticated NU poate DELETE/INSERT pe profiles (42501) —
--        scenariul de escaladare (șterge + reinserează cu is_platform_admin).
--   AV2  Backstop: chiar cu un GRANT INSERT accidental, trigger-ul respinge
--        scrierea directă din rolul client.
--   AV3  SEC-02: get_restaurant_by_qr_token nu mai există.
--   AV4  SEC-03: anon și authenticated nu pot executa helperii interni
--        (privilegiu + probă comportamentală pe build_fiscalnet_payload);
--        authenticated păstrează DOAR get_restaurant_features.
--   AV5  SEC-04: anon citește DIRECT produsele active ne-draft ale unui
--        restaurant activ (fallback-ul fetchMenuLayered trăiește), nimic din
--        draft sau din restaurante inactive.
--   AV6  MF-01/MF-05/DM-01: mark_paid cu bacșiș — order_payments și paid_amount
--        primesc DOAR banii pe notă; bonul intră în coadă cu payload real;
--        supra-încasarea pe ramura fără parțiale e respinsă; sumă sub bacșiș
--        → invalid_amount.
--   AV7  MF-02: bridge_retry_receipt regenerează payload-ul unui rând 'error'
--        cu payload gol; dacă build-ul eșuează → hint payload_build_failed,
--        rândul rămâne 'error'.
--   AV8  MF-04: enqueue_invoice_for_order respinge o comandă cu factură eșuată
--        AMBIGUU (hint ambiguous_failed_exists) și o acceptă după un eșec clar.
--   AV9  MF-03: bridge_mark_stale_as_error marchează 'sent' > 10 min cu
--        markerul POSIBIL DUPLICAT; service_role-only.
--   AV10 SEC-05: un waiter NU vede invitațiile (email + token), owner-ul da.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('62000000-0000-4000-8000-000000000001', 'av-owner@av.test'),
  ('62000000-0000-4000-8000-000000000002', 'av-waiter@av.test'),
  ('62000000-0000-4000-8000-000000000003', 'av-stranger@av.test');
update public.profiles set plan = 'pro' where id = '62000000-0000-4000-8000-000000000001';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('62b00000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', 'AV Bistro',  'av-bistro', 'Cluj', true),
  ('62b00000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000001', 'AV Închis',  'av-inchis', 'Cluj', false);

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('62b00000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000002', 'waiter');

insert into public.bridge_devices (id, restaurant_id, name, device_secret) values
  ('62e00000-0000-4000-8000-000000000001', '62b00000-0000-4000-8000-000000000001', 'Casa AV', 'AVSECRET');

insert into public.categories (id, restaurant_id, name) values
  ('62c00000-0000-4000-8000-000000000001', '62b00000-0000-4000-8000-000000000001', 'AV Cat'),
  ('62c00000-0000-4000-8000-000000000002', '62b00000-0000-4000-8000-000000000002', 'AV Cat Închis');
insert into public.products (id, restaurant_id, category_id, name, price, vat_group, is_active, is_draft) values
  ('62d00000-0000-4000-8000-000000000001', '62b00000-0000-4000-8000-000000000001', '62c00000-0000-4000-8000-000000000001', 'AV Cafea', 10, 1, true,  false),
  ('62d00000-0000-4000-8000-000000000002', '62b00000-0000-4000-8000-000000000001', '62c00000-0000-4000-8000-000000000001', 'AV Draft', 10, 1, true,  true),
  ('62d00000-0000-4000-8000-000000000003', '62b00000-0000-4000-8000-000000000002', '62c00000-0000-4000-8000-000000000002', 'AV Închis', 10, 1, true,  false);

insert into public.invite_tokens (restaurant_id, email, role, invited_by) values
  ('62b00000-0000-4000-8000-000000000001', 'coleg-nou@av.test', 'manager', '62000000-0000-4000-8000-000000000001');

-- ── AV1: escaladarea SEC-01 e imposibilă (privilegiu de tabelă) ──────────────
set local role authenticated;
set local request.jwt.claim.sub = '62000000-0000-4000-8000-000000000003';
do $$
declare v_del boolean := false; v_ins boolean := false;
begin
  begin
    delete from public.profiles where id = '62000000-0000-4000-8000-000000000003';
  exception when insufficient_privilege then
    v_del := true;
  when others then
    raise exception 'AV1: eroare neașteptată la DELETE (%): %', sqlstate, sqlerrm;
  end;
  begin
    insert into public.profiles (id, email, full_name, plan, is_platform_admin)
    values ('62000000-0000-4000-8000-000000000003', 'av-stranger@av.test', 'Atacator', 'enterprise', true);
  exception when insufficient_privilege then
    v_ins := true;
  when others then
    raise exception 'AV1: eroare neașteptată la INSERT (%): %', sqlstate, sqlerrm;
  end;
  if not v_del then
    raise exception 'AV1 FAIL: authenticated a putut ȘTERGE propriul rând din profiles (SEC-01)'; end if;
  if not v_ins then
    raise exception 'AV1 FAIL: authenticated a putut INSERA în profiles (SEC-01)'; end if;
end $$;
reset role;
do $$
begin
  if (select is_platform_admin from public.profiles where id = '62000000-0000-4000-8000-000000000003') is distinct from false
     or (select plan from public.profiles where id = '62000000-0000-4000-8000-000000000003') <> 'free' then
    raise exception 'AV1 FAIL: profilul a fost modificat'; end if;
  raise notice 'AV1 OK: DELETE+INSERT pe profiles respinse (42501); profilul rămâne free/non-admin';
end $$;

-- ── AV2: backstop-ul (trigger) prinde și un GRANT accidental viitor ──────────
grant insert on public.profiles to authenticated;   -- simulare regresie; rollback la final
set local role authenticated;
set local request.jwt.claim.sub = '62000000-0000-4000-8000-000000000003';
do $$
declare v_blocked boolean := false;
begin
  begin
    insert into public.profiles (id, email, full_name)
    values ('62000000-0000-4000-8000-000000000009', 'av-ghost@av.test', 'Ghost');
  exception when others then
    if sqlstate = '42501' and sqlerrm like '%mig 262%' then
      v_blocked := true;
    else
      raise exception 'AV2: INSERT-ul a fost oprit de altceva decât trigger-ul (%): %', sqlstate, sqlerrm;
    end if;
  end;
  if not v_blocked then
    raise exception 'AV2 FAIL: trigger-ul anti scriere directă n-a respins INSERT-ul'; end if;
end $$;
reset role;
revoke insert on public.profiles from authenticated;
do $$ begin raise notice 'AV2 OK: trigger-ul respinge INSERT-ul direct chiar cu GRANT prezent'; end $$;

-- ── AV3: RPC-ul anon mort a dispărut ─────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.get_restaurant_by_qr_token(text)') is not null then
    raise exception 'AV3 FAIL: get_restaurant_by_qr_token încă există (proiecta wifi_password)'; end if;
  raise notice 'AV3 OK: get_restaurant_by_qr_token a fost eliminat';
end $$;

-- ── AV4: helperii interni nu sunt executabili de anon ────────────────────────
do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public._refresh_order_totals(uuid)', 'public.build_fiscalnet_payload(uuid)',
    'public.owner_plan(uuid)', 'public.get_restaurant_features(uuid)',
    'public.log_ai_import(uuid, uuid, integer)', 'public.reserve_ai_import_slot(uuid, uuid)',
    'public.check_ai_import_quota(uuid)'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception 'AV4 FAIL: anon poate executa %', v_sig; end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.get_restaurant_features(uuid)', 'execute') then
    raise exception 'AV4 FAIL: authenticated a pierdut get_restaurant_features (useFeatures ar muri)'; end if;
  if has_function_privilege('authenticated', 'public.build_fiscalnet_payload(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.log_ai_import(uuid, uuid, integer)', 'execute') then
    raise exception 'AV4 FAIL: authenticated poate executa helperi interni (fără apelant client)'; end if;
end $$;
set local role anon;
do $$
declare v_blocked boolean := false;
begin
  begin
    perform public.build_fiscalnet_payload('62f00000-0000-4000-8000-000000000001');
  exception when insufficient_privilege then
    v_blocked := true;
  when others then
    raise exception 'AV4: eroare neașteptată (%): %', sqlstate, sqlerrm;
  end;
  if not v_blocked then
    raise exception 'AV4 FAIL: anon a putut chema build_fiscalnet_payload'; end if;
end $$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '62000000-0000-4000-8000-000000000001';
do $$
declare v_blocked boolean := false;
begin
  begin
    perform public.build_fiscalnet_payload('62f00000-0000-4000-8000-000000000001');
  exception when insufficient_privilege then
    v_blocked := true;
  when others then
    raise exception 'AV4: eroare neașteptată ca authenticated (%): %', sqlstate, sqlerrm;
  end;
  if not v_blocked then
    raise exception 'AV4 FAIL: authenticated a putut chema build_fiscalnet_payload direct'; end if;
end $$;
reset role;
do $$ begin raise notice 'AV4 OK: helperii interni sunt închiși pentru anon/authenticated; get_restaurant_features rămâne pe dashboard'; end $$;

-- ── AV5: anon citește direct produsele publice (fallback-ul trăiește) ────────
set local role anon;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.products
   where restaurant_id = '62b00000-0000-4000-8000-000000000001';
  if v_n <> 1 then
    raise exception 'AV5 FAIL: anon vede % produse pe restaurantul activ (așteptat 1: activ, ne-draft)', v_n; end if;
  select count(*) into v_n from public.products
   where restaurant_id = '62b00000-0000-4000-8000-000000000002';
  if v_n <> 0 then
    raise exception 'AV5 FAIL: anon vede % produse ale unui restaurant INACTIV', v_n; end if;
end $$;
reset role;
do $$ begin raise notice 'AV5 OK: anon vede doar produsele active ne-draft ale restaurantelor active'; end $$;

-- ── AV6: bacșișul nu intră pe notă; supra-încasarea e respinsă pe ambele ramuri ─
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000001', true);
do $$
declare
  v_rest uuid := '62b00000-0000-4000-8000-000000000001';
  v_prod uuid := '62d00000-0000-4000-8000-000000000001';
  v_o1   uuid := '62f00000-0000-4000-8000-000000000001';  -- parțial 50 + rest 150 + bacșiș 15
  v_o2   uuid := '62f00000-0000-4000-8000-000000000002';  -- fără parțiale, 110 = 100 + bacșiș 10
  v_o3   uuid := '62f00000-0000-4000-8000-000000000003';  -- overpayment 5000 pe 100
  v_o4   uuid := '62f00000-0000-4000-8000-000000000004';  -- 5 înmânat, bacșiș 10
  v_res jsonb; v_hint text; v_sum numeric; v_paid numeric; v_tips numeric;
  v_rstatus text; v_payload text; v_method text;
begin
  -- (a) notă 200 cu parțial 50 → plata integrală 165 (150 rest + 15 bacșiș)
  insert into public.orders (id, restaurant_id, source, status, total) values (v_o1, v_rest, 'waiter', 'served', 200);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o1, v_prod, 'AV Cafea', 1, 200, 200);
  insert into public.order_payments (order_id, amount, method, paid_by)
    values (v_o1, 50, 'cash', '62000000-0000-4000-8000-000000000001');

  v_res := public.advance_order(v_o1, 'mark_paid', 165, 'cash', 15, null);
  if coalesce((v_res->>'ok')::boolean, false) is not true then
    raise exception 'AV6a FAIL: mark_paid cu bacșiș a eșuat (%)', v_res; end if;
  select coalesce(sum(amount), 0) into v_sum from public.order_payments where order_id = v_o1;
  select paid_amount, tips_amount into v_paid, v_tips from public.orders where id = v_o1;
  if v_sum <> 200 then
    raise exception 'AV6a FAIL: sum(order_payments)=% (așteptat 200 — bacșișul a intrat pe notă, MF-01)', v_sum; end if;
  if v_paid <> 200 or v_tips <> 15 then
    raise exception 'AV6a FAIL: paid_amount=% tips=% (așteptat 200 / 15)', v_paid, v_tips; end if;
  select status, payload into v_rstatus, v_payload from public.pending_receipts where order_id = v_o1;
  if v_rstatus is distinct from 'pending' or length(coalesce(v_payload, '')) = 0 then
    raise exception 'AV6a FAIL: bonul nu e în coadă cu payload real (status=%, len=%) — bani fără bon (MF-01)',
      v_rstatus, length(coalesce(v_payload, '')); end if;

  -- (b) fără parțiale: 110 înmânat = 100 notă + 10 bacșiș
  insert into public.orders (id, restaurant_id, source, status, total) values (v_o2, v_rest, 'waiter', 'served', 100);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o2, v_prod, 'AV Cafea', 1, 100, 100);
  v_res := public.advance_order(v_o2, 'mark_paid', 110, 'card_pos', 10, null);
  select paid_amount, tips_amount, payment_method::text into v_paid, v_tips, v_method from public.orders where id = v_o2;
  if v_paid <> 100 or v_tips <> 10 or v_method <> 'card_pos' then
    raise exception 'AV6b FAIL: paid_amount=% tips=% method=% (așteptat 100 / 10 / card_pos — MF-05)', v_paid, v_tips, v_method; end if;
  select status, payload into v_rstatus, v_payload from public.pending_receipts where order_id = v_o2;
  if v_rstatus is distinct from 'pending' or length(coalesce(v_payload, '')) = 0 then
    raise exception 'AV6b FAIL: bonul fără parțiale nu e în coadă cu payload (status=%)', v_rstatus; end if;

  -- (c) fără parțiale: typo 5000 pe o notă de 100 → overpayment
  insert into public.orders (id, restaurant_id, source, status, total) values (v_o3, v_rest, 'waiter', 'served', 100);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o3, v_prod, 'AV Cafea', 1, 100, 100);
  v_hint := null;
  begin
    perform public.advance_order(v_o3, 'mark_paid', 5000, 'cash', 0, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'overpayment' then
    raise exception 'AV6c FAIL: 5000 pe o notă de 100 nu a fost respins cu overpayment (hint=%) — DM-01', v_hint; end if;
  if (select status from public.orders where id = v_o3) <> 'served' then
    raise exception 'AV6c FAIL: comanda a trecut în paid deși suma a fost respinsă'; end if;

  -- (d) suma înmânată nu acoperă bacșișul → invalid_amount
  insert into public.orders (id, restaurant_id, source, status, total) values (v_o4, v_rest, 'waiter', 'served', 100);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o4, v_prod, 'AV Cafea', 1, 100, 100);
  v_hint := null;
  begin
    perform public.advance_order(v_o4, 'mark_paid', 5, 'cash', 10, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'invalid_amount' then
    raise exception 'AV6d FAIL: 5 înmânat cu bacșiș 10 nu a fost respins cu invalid_amount (hint=%)', v_hint; end if;

  raise notice 'AV6 OK: bacșișul stă doar în tips_amount; bonul iese cu payload; overpayment/invalid_amount pe ramura fără parțiale';
end $$;

-- ── AV7: retry-ul regenerează payload-ul ─────────────────────────────────────
do $$
declare
  v_rest uuid := '62b00000-0000-4000-8000-000000000001';
  v_prod uuid := '62d00000-0000-4000-8000-000000000001';
  v_o5   uuid := '62f00000-0000-4000-8000-000000000005';  -- reparabil: itemii apar după enqueue
  v_o6   uuid := '62f00000-0000-4000-8000-000000000006';  -- nereparabil: fără itemi
  v_rid5 uuid; v_rid6 uuid; v_ok boolean; v_hint text; v_status text; v_payload text;
begin
  -- INSERT direct 'paid' (permis pe Plan 3) → enqueue (mig 259) fără itemi → rând 'error' cu payload ''.
  insert into public.orders (id, restaurant_id, source, status, total, paid_amount, payment_method, paid_at)
    values (v_o5, v_rest, 'waiter', 'paid', 30, 30, 'cash', now());
  select id into v_rid5 from public.pending_receipts where order_id = v_o5 limit 1;
  if v_rid5 is null then
    raise exception 'AV7: enqueue-ul pe INSERT (mig 259) nu a produs rând'; end if;
  -- Aducem deterministic rândul în starea MF-02 (build eșuat la enqueue).
  update public.pending_receipts set status = 'error', payload = '', error_code = 'BUILD_FAILED',
         error_info = 'Order: lines sum mismatch' where id = v_rid5;
  -- Staff-ul repară comanda (itemii există acum) → retry trebuie să reconstruiască payload-ul.
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o5, v_prod, 'AV Cafea', 1, 30, 30);

  v_ok := public.bridge_retry_receipt(v_rid5);
  select status, payload into v_status, v_payload from public.pending_receipts where id = v_rid5;
  if v_ok is not true or v_status <> 'pending' or length(coalesce(v_payload, '')) = 0 then
    raise exception 'AV7a FAIL: retry-ul nu a regenerat payload-ul (ok=%, status=%, len=%) — MF-02',
      v_ok, v_status, length(coalesce(v_payload, '')); end if;

  -- Comandă nereparată (fără itemi): retry → hint payload_build_failed, rândul rămâne 'error'.
  insert into public.orders (id, restaurant_id, source, status, total, paid_amount, payment_method, paid_at)
    values (v_o6, v_rest, 'waiter', 'paid', 40, 40, 'cash', now());
  select id into v_rid6 from public.pending_receipts where order_id = v_o6 limit 1;
  update public.pending_receipts set status = 'error', payload = '', error_code = 'BUILD_FAILED' where id = v_rid6;
  v_hint := null;
  begin
    perform public.bridge_retry_receipt(v_rid6);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'payload_build_failed' then
    raise exception 'AV7b FAIL: retry pe o comandă fără itemi nu a dat payload_build_failed (hint=%)', v_hint; end if;
  select status into v_status from public.pending_receipts where id = v_rid6;
  if v_status <> 'error' then
    raise exception 'AV7b FAIL: rândul a părăsit starea error (status=%)', v_status; end if;

  raise notice 'AV7 OK: retry-ul regenerează payload-ul; build eșuat → payload_build_failed, rând rămas error';
end $$;

-- ── AV8: factura eșuată AMBIGUU blochează re-emiterea; eșecul clar nu ────────
do $$
declare
  v_rest uuid := '62b00000-0000-4000-8000-000000000001';
  v_o2   uuid := '62f00000-0000-4000-8000-000000000002';  -- paid din AV6b
  v_inv  uuid := '62a00000-0000-4000-8000-000000000001';
  v_hint text; v_new uuid;
begin
  insert into public.oblio_configs (restaurant_id, api_email, api_secret, company_cif, company_name)
    values (v_rest, 'av@oblio.test', 'sec', 'RO123', 'AV SRL');
  insert into public.invoices (id, restaurant_id, order_id, customer_name, total_with_vat, status, last_error)
    values (v_inv, v_rest, v_o2, 'Client SRL', 100, 'failed',
            'POSIBIL DUPLICAT — timeout după POST către Oblio; factura poate fi deja emisă');

  v_hint := null;
  begin
    perform public.enqueue_invoice_for_order(v_o2, 'Client SRL');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'ambiguous_failed_exists' then
    raise exception 'AV8a FAIL: re-emiterea peste o factură eșuată AMBIGUU nu a fost blocată (hint=%) — MF-04', v_hint; end if;

  -- STUCK_GENERATING (mig 239) e tot ambiguu.
  update public.invoices set last_error = 'STUCK_GENERATING: proces întrerupt în timpul emiterii' where id = v_inv;
  v_hint := null;
  begin
    perform public.enqueue_invoice_for_order(v_o2, 'Client SRL');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'ambiguous_failed_exists' then
    raise exception 'AV8b FAIL: STUCK_GENERATING nu a fost tratat ca ambiguu (hint=%)', v_hint; end if;

  -- Eșec CLAR (4xx) → re-emisibil.
  update public.invoices set last_error = 'Oblio 400: CIF invalid' where id = v_inv;
  v_new := public.enqueue_invoice_for_order(v_o2, 'Client SRL', 'RO999');
  if v_new is null then
    raise exception 'AV8c FAIL: re-emiterea după un eșec clar a fost blocată'; end if;
  if (select status::text from public.invoices where id = v_new) <> 'queued' then
    raise exception 'AV8c FAIL: factura nouă nu e queued'; end if;

  raise notice 'AV8 OK: eșec ambiguu (POSIBIL DUPLICAT/STUCK_GENERATING) blochează; eșec clar permite re-emiterea';
end $$;

-- ── AV9: bonurile agățate în sent primesc markerul ambiguu ──────────────────
do $$
declare
  v_o6  uuid := '62f00000-0000-4000-8000-000000000006';
  v_rid uuid; v_n int; v_status text; v_info text;
begin
  select id into v_rid from public.pending_receipts where order_id = v_o6 limit 1;
  update public.pending_receipts
     set status = 'sent', claimed_at = now() - interval '20 minutes',
         bridge_device_id = '62e00000-0000-4000-8000-000000000001',
         error_code = null, error_info = null, completed_at = null
   where id = v_rid;

  v_n := public.bridge_mark_stale_as_error();
  if v_n < 1 then
    raise exception 'AV9 FAIL: bridge_mark_stale_as_error nu a marcat nimic (%)', v_n; end if;
  select status, error_info into v_status, v_info from public.pending_receipts where id = v_rid;
  if v_status <> 'error' or v_info not like 'POSIBIL DUPLICAT%' then
    raise exception 'AV9 FAIL: rândul agățat nu poartă markerul ambiguu (status=%, info=%)', v_status, v_info; end if;

  if has_function_privilege('anon', 'public.bridge_mark_stale_as_error()', 'execute')
     or has_function_privilege('authenticated', 'public.bridge_mark_stale_as_error()', 'execute')
     or not has_function_privilege('service_role', 'public.bridge_mark_stale_as_error()', 'execute') then
    raise exception 'AV9 FAIL: bridge_mark_stale_as_error nu e service_role-only'; end if;

  raise notice 'AV9 OK: sent > 10 min → error cu POSIBIL DUPLICAT (retry doar după verificarea benzii)';
end $$;

-- ── AV10: invitațiile sunt vizibile doar adminilor ───────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = '62000000-0000-4000-8000-000000000002';   -- waiter
do $$
declare v_n int;
begin
  select count(*) into v_n from public.invite_tokens
   where restaurant_id = '62b00000-0000-4000-8000-000000000001';
  if v_n <> 0 then
    raise exception 'AV10 FAIL: un waiter vede % invitații (email + token bearer) — SEC-05', v_n; end if;
end $$;
set local request.jwt.claim.sub = '62000000-0000-4000-8000-000000000001';   -- owner
do $$
declare v_n int;
begin
  select count(*) into v_n from public.invite_tokens
   where restaurant_id = '62b00000-0000-4000-8000-000000000001';
  if v_n <> 1 then
    raise exception 'AV10 FAIL: owner-ul nu își vede invitația (% rânduri) — TeamManager ar fi gol', v_n; end if;
end $$;
reset role;
do $$ begin raise notice 'AV10 OK: invitațiile sunt admin-only'; end $$;

rollback;

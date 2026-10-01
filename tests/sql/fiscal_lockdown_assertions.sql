-- tests/sql/fiscal_lockdown_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 287 — jurnalul fiscal și secretul Oblio nu mai
-- pot fi scrise/citite direct de rolurile client (SC-1 + oblio_configs).
--
--   FL1  SUB `authenticated` (owner ȘI manager): PATCH pe pending_receipts
--        (payload / status / bon_number) → 42501, rândul rămâne neschimbat;
--        control pozitiv: același rol CITEȘTE rândul (RLS + SELECT).
--   FL2  BACKSTOP-ul din DATE, izolat de zidul de privilegiu: cu UPDATE
--        re-acordat TEMPORAR lui authenticated, trigger-ul respinge cu hint
--        `direct_receipt_update_forbidden` (un GRANT viitor accidental nu
--        redeschide SC-1). Privilegiul se revocă la loc.
--   FL3  RPC-urile legitime TREC (DEFINER, current_user = owner): get_pending,
--        claim, confirm (bridge, device secret), retry, cancel, force_resolve
--        (owner sub authenticated), mark_stale_as_error (service_role).
--   FL4  catalog: zero privilegiu UPDATE efectiv (tabel + TOATE coloanele) pe
--        pending_receipts pentru anon/authenticated; INSERT/SELECT rămân
--        (259 / BridgeTab); trigger BEFORE UPDATE ROW (tgtype 19), funcție
--        NE-definer, fără EXECUTE pentru roluri client/service.
--   FL5  oblio_configs sub `authenticated` (owner ȘI manager): coloanele
--        ne-secrete se citesc, `api_secret` → 42501 (SELECT, SELECT *, și
--        oracol WHERE); INSERT/UPDATE/upsert/DELETE pe coloane rămân.
--   FL6  get_oblio_config_status: owner → configured=true fără secret, local
--        fără config → configured=false, străin → role_insufficient, anon →
--        42501 pe EXECUTE; cititorul DEFINER al secretului nu e afectat.
--
-- Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('87000000-0000-4000-8000-000000000001', 'fl-owner@fl.test'),
  ('87000000-0000-4000-8000-000000000002', 'fl-mgr@fl.test'),
  ('87000000-0000-4000-8000-000000000003', 'fl-stranger@fl.test');
update public.profiles set plan = 'enterprise' where id = '87000000-0000-4000-8000-000000000001';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('87b00000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000001', 'FL Bistro', 'fl-bistro', 'Cluj', true),
  ('87b00000-0000-4000-8000-000000000002', '87000000-0000-4000-8000-000000000001', 'FL Fara Oblio', 'fl-fara-oblio', 'Cluj', true);
insert into public.restaurant_memberships (restaurant_id, user_id, role)
values ('87b00000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000002', 'manager');

insert into public.bridge_devices (id, restaurant_id, name, device_secret) values
  ('87e00000-0000-4000-8000-000000000001', '87b00000-0000-4000-8000-000000000001', 'Casa FL', 'FLSECRET');
insert into public.categories (id, restaurant_id, name) values
  ('87c00000-0000-4000-8000-000000000001', '87b00000-0000-4000-8000-000000000001', 'FL Cat');
insert into public.products (id, restaurant_id, category_id, name, price, vat_group, is_active, is_draft) values
  ('87d00000-0000-4000-8000-000000000001', '87b00000-0000-4000-8000-000000000001',
   '87c00000-0000-4000-8000-000000000001', 'FL Cafea', 10, 1, true, false);

select set_config('request.jwt.claim.sub', '87000000-0000-4000-8000-000000000001', true);

-- Patru comenzi plătite → enqueue 259 → câte un pending_receipts (payload '').
insert into public.orders (id, restaurant_id, source, status, total, paid_amount, payment_method, paid_at) values
  ('87f00000-0000-4000-8000-000000000001', '87b00000-0000-4000-8000-000000000001', 'waiter', 'paid', 10, 10, 'cash', now()),
  ('87f00000-0000-4000-8000-000000000002', '87b00000-0000-4000-8000-000000000001', 'waiter', 'paid', 10, 10, 'cash', now()),
  ('87f00000-0000-4000-8000-000000000003', '87b00000-0000-4000-8000-000000000001', 'waiter', 'paid', 10, 10, 'cash', now()),
  ('87f00000-0000-4000-8000-000000000004', '87b00000-0000-4000-8000-000000000001', 'waiter', 'paid', 10, 10, 'cash', now());
insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
select o.id, '87d00000-0000-4000-8000-000000000001', 'FL Cafea', 1, 10, 10
  from public.orders o where o.restaurant_id = '87b00000-0000-4000-8000-000000000001';

insert into public.oblio_configs (restaurant_id, api_email, api_secret, company_cif, company_name)
values ('87b00000-0000-4000-8000-000000000001', 'fl@oblio.test', 'SUPER-SECRET-1', 'RO123', 'FL SRL');

do $$
declare v_n int;
begin
  select count(*) into v_n from public.pending_receipts
   where restaurant_id = '87b00000-0000-4000-8000-000000000001';
  if v_n <> 4 then raise exception 'FL seed: enqueue 259 a produs % rânduri (așteptat 4)', v_n; end if;
end $$;

-- ── FL1: PATCH direct, sub authenticated ─────────────────────────────────────
-- Același test pentru owner și pentru manager (partenerul/fondatorul trec prin
-- is_admin, deci sunt „manager" pentru RLS — zidul trebuie să-i țină pe toți).
create temp table fl_actors (uid uuid, who text);
insert into fl_actors values
  ('87000000-0000-4000-8000-000000000001', 'owner'),
  ('87000000-0000-4000-8000-000000000002', 'manager');
grant select on fl_actors to authenticated;

do $$
declare a record;
begin
  for a in select * from fl_actors order by who loop
    perform set_config('request.jwt.claim.sub', a.uid::text, true);
    perform set_config('role', 'authenticated', true);
    declare
      v_rid uuid; v_n int; v_state text; v_col text; v_stmt text;
      v_stmts text[] := array[
        'payload = ''S^fals^1''',
        'status = ''success'', bon_number = ''666''',
        'bon_number = ''666'''];
    begin
      -- control pozitiv: rolul vede rândul (RLS + SELECT) — altfel „refuzat" ar fi vacuu
      select id into v_rid from public.pending_receipts
       where order_id = '87f00000-0000-4000-8000-000000000001';
      if v_rid is null then
        raise exception 'FL1 (%): precondiție — rolul nu vede rândul sub RLS', a.who; end if;
      foreach v_stmt in array v_stmts loop
        v_state := null;
        begin
          execute format('update public.pending_receipts set %s where id = %L', v_stmt, v_rid);
          get diagnostics v_n = row_count;
        exception when others then
          get stacked diagnostics v_state = returned_sqlstate;
        end;
        if v_state is distinct from '42501' then
          raise exception 'FL1 FAIL (%): UPDATE [%] a trecut/alt motiv (sqlstate=%)', a.who, v_stmt, v_state; end if;
      end loop;
    end;
    perform set_config('role', 'none', true);
  end loop;
end $$;
reset role;

do $$
declare v_p text; v_s text; v_b text;
begin
  select payload, status, bon_number into v_p, v_s, v_b from public.pending_receipts
   where order_id = '87f00000-0000-4000-8000-000000000001';
  if v_p is distinct from '' or v_s is distinct from 'pending' or v_b is not null then
    raise exception 'FL1 FAIL: rândul a fost modificat (payload=%, status=%, bon=%)', v_p, v_s, v_b; end if;
  raise notice 'FL1 OK: owner și manager nu pot UPDATE pe pending_receipts (42501), rândul neschimbat';
end $$;

-- ── FL2: backstop-ul în DATE, izolat de zidul de privilegiu ──────────────────
grant update on public.pending_receipts to authenticated;
select set_config('request.jwt.claim.sub', '87000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare v_hint text; v_state text; v_ok boolean := false;
begin
  begin
    update public.pending_receipts set status = 'success', bon_number = '666'
     where order_id = '87f00000-0000-4000-8000-000000000001';
    v_ok := true;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
  end;
  if v_ok then
    raise exception 'FL2 FAIL: cu UPDATE re-acordat, authenticated a scris în jurnalul fiscal — backstop-ul lipsește'; end if;
  if v_hint is distinct from 'direct_receipt_update_forbidden' or v_state is distinct from '42501' then
    raise exception 'FL2 FAIL: respins din alt motiv (hint=%, sqlstate=%)', v_hint, v_state; end if;
  raise notice 'FL2 OK: backstop-ul din date respinge UPDATE-ul chiar și cu privilegiul re-acordat';
end $$;
reset role;
-- FL2b: backstop-ul 270 (re-punere în `pending`) rămâne a doua linie și el
update public.pending_receipts set status = 'error', error_code = 'HTTP_500', error_info = 'x'
 where order_id = '87f00000-0000-4000-8000-000000000004';
set local role authenticated;
do $$
declare v_hint text; v_ok boolean := false;
begin
  begin
    update public.pending_receipts set status = 'pending' where order_id = '87f00000-0000-4000-8000-000000000004';
    v_ok := true;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_ok or v_hint is distinct from 'direct_repend_forbidden' then
    raise exception 'FL2b FAIL: backstop-ul 270 (repend) nu mai respinge (ok=%, hint=%)', v_ok, v_hint; end if;
  raise notice 'FL2b OK: backstop-ul 270 pe re-punerea în pending rămâne activ';
end $$;
reset role;
update public.pending_receipts set status = 'pending', error_code = null, error_info = null, completed_at = null
 where order_id = '87f00000-0000-4000-8000-000000000004';
revoke update on public.pending_receipts from authenticated;

-- ── FL3: RPC-urile legitime trec ─────────────────────────────────────────────
-- Pregătire (postgres — trigger-ul lasă rolurile non-client): o2 = bon agățat
-- în `sent` de 20 min (cron → marker POSIBIL DUPLICAT), o3 = eșec clar.
do $$
declare v_n int;
begin
  update public.pending_receipts
     set status = 'sent', claimed_at = now() - interval '20 minutes',
         bridge_device_id = '87e00000-0000-4000-8000-000000000001'
   where order_id = '87f00000-0000-4000-8000-000000000002';
  update public.pending_receipts
     set status = 'error', error_code = 'HTTP_500', error_info = 'FiscalNet: eroare 500', completed_at = now()
   where order_id = '87f00000-0000-4000-8000-000000000003';
  -- control: postgres (proprietarul) NU e blocat de backstop
  if (select count(*) from public.pending_receipts where status in ('sent','error')
       and restaurant_id = '87b00000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'FL3: precondiție — postgres nu a putut pregăti rândurile'; end if;
end $$;

set local role service_role;
do $$
declare v_n int;
begin
  v_n := public.bridge_mark_stale_as_error();
  if v_n < 1 then raise exception 'FL3 FAIL: bridge_mark_stale_as_error (service_role) nu a atins rândul agățat'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '87000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare v_rid uuid; v_ok boolean; v_seen int;
begin
  -- bridge (anon/authenticated + device secret): get_pending → claim → confirm
  select count(*) into v_seen from public.bridge_get_pending('FLSECRET') g
   where g.order_id = '87f00000-0000-4000-8000-000000000001';
  if v_seen <> 1 then raise exception 'FL3 FAIL: bridge_get_pending nu vede bonul (n=%)', v_seen; end if;
  select id into v_rid from public.pending_receipts where order_id = '87f00000-0000-4000-8000-000000000001';
  if public.bridge_claim_receipt('FLSECRET', v_rid) is not true then
    raise exception 'FL3 FAIL: bridge_claim_receipt a refuzat'; end if;
  if public.bridge_confirm_receipt('FLSECRET', v_rid, true, '100', null, null) is not true then
    raise exception 'FL3 FAIL: bridge_confirm_receipt a refuzat'; end if;

  -- retry (eșec clar, fără marker → fără ack)
  select id into v_rid from public.pending_receipts where order_id = '87f00000-0000-4000-8000-000000000003';
  if public.bridge_retry_receipt(v_rid) is not true then
    raise exception 'FL3 FAIL: bridge_retry_receipt a refuzat un eșec clar'; end if;

  -- cancel (pending)
  select id into v_rid from public.pending_receipts where order_id = '87f00000-0000-4000-8000-000000000004';
  if public.bridge_cancel_receipt(v_rid) is not true then
    raise exception 'FL3 FAIL: bridge_cancel_receipt a refuzat'; end if;

  -- force_resolve pe error+marker (277): bonul a ieșit pe bandă, nr. 200
  select id into v_rid from public.pending_receipts where order_id = '87f00000-0000-4000-8000-000000000002';
  if public.bridge_force_resolve_stuck(v_rid, true, '200') is not true then
    raise exception 'FL3 FAIL: bridge_force_resolve_stuck a refuzat'; end if;
end $$;
reset role;

do $$
declare r record;
begin
  for r in select order_id::text o, status, bon_number from public.pending_receipts
            where restaurant_id = '87b00000-0000-4000-8000-000000000001' loop
    if (r.o like '%001' and (r.status <> 'success' or r.bon_number <> '100'))
    or (r.o like '%002' and (r.status <> 'success' or r.bon_number <> '200'))
    or (r.o like '%003' and r.status <> 'pending')
    or (r.o like '%004' and r.status <> 'cancelled') then
      raise exception 'FL3 FAIL: starea finală a rândului % e greșită (status=%, bon=%)', r.o, r.status, r.bon_number; end if;
  end loop;
  raise notice 'FL3 OK: claim/confirm/retry/cancel/force_resolve (client) + mark_stale (service_role) trec prin DEFINER';
end $$;

-- ── FL4: catalog ─────────────────────────────────────────────────────────────
do $$
declare v_role text; v_col text; v_tgtype int; v_def boolean; v_n int;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.pending_receipts', 'UPDATE') then
      raise exception 'FL4 FAIL: % are UPDATE pe pending_receipts', v_role; end if;
    for v_col in select attname::text from pg_attribute
                  where attrelid = 'public.pending_receipts'::regclass and attnum > 0 and not attisdropped loop
      if has_column_privilege(v_role, 'public.pending_receipts', v_col, 'UPDATE') then
        raise exception 'FL4 FAIL: % are UPDATE pe pending_receipts.%', v_role, v_col; end if;
    end loop;
  end loop;
  -- ancora anti-vacuitate: ce trebuie să rămână chiar rămâne
  if not has_table_privilege('authenticated', 'public.pending_receipts', 'SELECT')
     or not has_table_privilege('authenticated', 'public.pending_receipts', 'INSERT') then
    raise exception 'FL4 FAIL (anti-vacuitate): authenticated și-a pierdut SELECT/INSERT (BridgeTab / enqueue 259)'; end if;

  select t.tgtype, p.prosecdef into v_tgtype, v_def
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgname = 'trg_pending_receipts_block_client_update'
     and t.tgrelid = 'public.pending_receipts'::regclass and not t.tgisinternal
     and p.proname = 'fn_pending_receipts_block_client_update';
  if v_tgtype is distinct from 19 then
    raise exception 'FL4 FAIL: trigger-ul trebuie BEFORE UPDATE FOR EACH ROW (tgtype 19), este %', v_tgtype; end if;
  if v_def then raise exception 'FL4 FAIL: backstop-ul e DEFINER — ar ascunde rolul apelantului'; end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v_role, 'public.fn_pending_receipts_block_client_update()', 'EXECUTE') then
      raise exception 'FL4 FAIL: % poate executa funcția de trigger (revoke explicit per rol)', v_role; end if;
  end loop;
  raise notice 'FL4 OK: zero UPDATE client (tabel + toate coloanele), INSERT/SELECT intacte, trigger 19 ne-definer';
end $$;

-- ── FL5: oblio_configs sub authenticated ─────────────────────────────────────
do $$
declare a record;
begin
  for a in select * from fl_actors order by who loop
    perform set_config('request.jwt.claim.sub', a.uid::text, true);
    perform set_config('role', 'authenticated', true);
    declare
      v_n int; v_state text; v_name text; v_probe text;
      v_probes text[] := array[
        'select api_secret from public.oblio_configs',
        'select * from public.oblio_configs',
        'select 1 from public.oblio_configs where api_secret like ''SUPER%''',
        'update public.oblio_configs set company_name = company_name where api_secret = ''x'''];
    begin
      -- control pozitiv: coloanele ne-secrete se citesc
      select company_name into v_name from public.oblio_configs
       where restaurant_id = '87b00000-0000-4000-8000-000000000001';
      if v_name is distinct from 'FL SRL' then
        raise exception 'FL5 FAIL (%): coloanele ne-secrete nu se mai citesc (%)', a.who, v_name; end if;
      foreach v_probe in array v_probes loop
        v_state := null;
        begin
          execute v_probe;
        exception when others then
          get stacked diagnostics v_state = returned_sqlstate;
        end;
        if v_state is distinct from '42501' then
          raise exception 'FL5 FAIL (%): [%] a trecut/alt motiv (sqlstate=%) — secretul e citibil', a.who, v_probe, v_state; end if;
      end loop;
      -- controale pozitive de SCRIERE: UPDATE pe coloană ne-secretă + pe secret
      update public.oblio_configs set company_name = 'FL SRL ' || a.who
       where restaurant_id = '87b00000-0000-4000-8000-000000000001';
      get diagnostics v_n = row_count;
      if v_n <> 1 then raise exception 'FL5 FAIL (%): UPDATE pe coloane ne-secrete nu merge', a.who; end if;
      update public.oblio_configs set api_secret = 'NEW-' || a.who
       where restaurant_id = '87b00000-0000-4000-8000-000000000001';
      get diagnostics v_n = row_count;
      if v_n <> 1 then raise exception 'FL5 FAIL (%): rolul nu mai poate SCRIE secretul', a.who; end if;
      -- upsert-ul (calea veche a clientului) — EXCLUDED.api_secret nu cere SELECT pe coloană
      insert into public.oblio_configs (restaurant_id, api_email, api_secret, company_cif, company_name)
      values ('87b00000-0000-4000-8000-000000000001', 'fl@oblio.test', 'UP-' || a.who, 'RO123', 'FL SRL')
      on conflict (restaurant_id) do update set api_secret = excluded.api_secret, company_name = excluded.company_name;
    end;
    perform set_config('role', 'none', true);
    if (select api_secret from public.oblio_configs where restaurant_id = '87b00000-0000-4000-8000-000000000001')
         is distinct from 'UP-' || a.who then
      raise exception 'FL5 FAIL (%): secretul scris nu a ajuns în DB', a.who; end if;
  end loop;
  raise notice 'FL5 OK: owner și manager citesc coloanele ne-secrete, api_secret → 42501 (SELECT/*/WHERE), SCRIEREA merge';
end $$;
reset role;

-- DELETE + INSERT proaspăt (calea „șterge config" / „config nou"), owner
select set_config('request.jwt.claim.sub', '87000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare v_n int;
begin
  delete from public.oblio_configs where restaurant_id = '87b00000-0000-4000-8000-000000000001';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FL5 FAIL: DELETE pe config nu merge'; end if;
  insert into public.oblio_configs (restaurant_id, api_email, api_secret, company_cif, company_name)
  values ('87b00000-0000-4000-8000-000000000001', 'fl@oblio.test', 'FRESH', 'RO123', 'FL SRL');
end $$;
reset role;

-- ── FL6: get_oblio_config_status ─────────────────────────────────────────────
select set_config('request.jwt.claim.sub', '87000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare r record; v_cols text;
begin
  select * into r from public.get_oblio_config_status('87b00000-0000-4000-8000-000000000001');
  if r.configured is not true or r.company_name is distinct from 'FL SRL' or r.api_email is distinct from 'fl@oblio.test' then
    raise exception 'FL6 FAIL: owner nu primește starea configului (%)', r; end if;
  select * into r from public.get_oblio_config_status('87b00000-0000-4000-8000-000000000002');
  if r.configured is not false or r.api_email is not null then
    raise exception 'FL6 FAIL: local fără config trebuie configured=false (%)', r; end if;
end $$;
reset role;

do $$
declare v_cols text; v_def boolean; v_state text; v_hint text;
begin
  -- forma: exact 4 coloane de ieșire, niciuna cu „secret"
  select string_agg(n, ',' order by n collate "C") into v_cols
    from unnest((select proargnames from pg_proc where oid = 'public.get_oblio_config_status(uuid)'::regprocedure)) n
   where n <> 'p_restaurant_id';
  if v_cols is distinct from 'api_email,company_cif,company_name,configured' then
    raise exception 'FL6 FAIL: forma RPC-ului s-a schimbat (%)', v_cols; end if;
end $$;

select set_config('request.jwt.claim.sub', '87000000-0000-4000-8000-000000000003', true);
set local role authenticated;
do $$
declare v_hint text; v_state text; v_ok boolean := false;
begin
  begin
    perform * from public.get_oblio_config_status('87b00000-0000-4000-8000-000000000001');
    v_ok := true;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
  end;
  if v_ok or v_hint is distinct from 'role_insufficient' or v_state is distinct from '42501' then
    raise exception 'FL6 FAIL: un străin a primit starea configului (ok=%, hint=%)', v_ok, v_hint; end if;
end $$;
reset role;

set local role anon;
do $$
declare v_msg text; v_ok boolean := false;
begin
  begin
    perform * from public.get_oblio_config_status('87b00000-0000-4000-8000-000000000001');
    v_ok := true;
  exception when others then
    v_msg := sqlerrm;
  end;
  -- sqlerrm like '%for function%': „permission denied for schema" e tot 42501
  if v_ok or v_msg not like '%for function%' then
    raise exception 'FL6 FAIL: anon nu e respins pe EXECUTE (ok=%, msg=%)', v_ok, v_msg; end if;
end $$;
reset role;

-- cititorii DEFINER ai secretului nu sunt afectați: proprietarul îl citește
do $$
declare v_owner name; v_def boolean;
begin
  select pg_get_userbyid(proowner), prosecdef into v_owner, v_def
    from pg_proc where proname = 'bridge_oblio_get_queued' and pronamespace = 'public'::regnamespace;
  if not v_def then raise exception 'FL6 FAIL: bridge_oblio_get_queued nu mai e DEFINER'; end if;
  if not has_column_privilege(v_owner, 'public.oblio_configs', 'api_secret', 'SELECT') then
    raise exception 'FL6 FAIL: proprietarul % nu mai poate citi api_secret (generatorul Oblio s-ar rupe)', v_owner; end if;
  raise notice 'FL6 OK: RPC de stare fără secret, străin/anon respinși, cititorul DEFINER intact';
end $$;

\echo '✅ JURNAL FISCAL + SECRET OBLIO PROTEJATE (FL1-FL6)'

rollback;

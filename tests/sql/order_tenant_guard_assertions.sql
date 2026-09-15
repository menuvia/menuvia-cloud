-- tests/sql/order_tenant_guard_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 278 — gate de tenant în DATE pe orice tabelă
-- cu (order_id, restaurant_id): comanda referită trebuie să aparțină ACELUIAȘI
-- restaurant. Cauza-rădăcină a capcanei găsite de recenzia adversarială a mig
-- 276: owner-ul lui B putea insera în `pending_receipts` un `success` cu bon
-- pe comanda lui A (politica `admin manage` verifică doar restaurant_id-ul
-- rândului), ceea ce făcea încasarea reală a lui A să NU mai producă bon (259
-- e idempotent pe order_id singur).
--
--   TG1  SUB ROLUL REAL `authenticated` (owner-ul lui R2): INSERT în
--        pending_receipts cu order_id = comanda lui R1 → respins de trigger cu
--        hint `receipt_tenant_mismatch` (nu de RLS — politica lasă rândul să
--        ajungă la gate; ca postgres testul ar fi orb la asta).
--   TG2  același rol, comanda PROPRIE → trece.
--   TG3  UPDATE care mută order_id la comanda altui restaurant → respins;
--        rând istoric cu order_id NULL → UPDATE de status trece (nimic de
--        verificat).
--   TG4  clichet de CLASĂ: orice tabelă din `public` cu ambele coloane poartă
--        trigger-ul (tgtype 23, funcția de gate, AMBELE coloane în lista
--        `UPDATE OF` — tgattr — sau lista goală), ≥ 4 azi; funcția e DEFINER
--        cu pg_temp și nu e executabilă de roluri client/service. Trigger-ul
--        părinte de pe `orders` (tgtype 19, restaurant_id în listă) există.
--   TG5  partea PĂRINTE, SUB `authenticated`, ca un cont admin la AMBELE
--        restaurante (owner R2 + manager R1): UPDATE de status pe comanda lui
--        R1 trece (control pozitiv — RLS-ul îl lasă), UPDATE de restaurant_id
--        → `order_restaurant_immutable`; comanda rămâne pe R1.
--
-- Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed: doi owneri pe Plan 3, două restaurante, câte o comandă ───────────────
insert into auth.users (id, email) values
  ('7c000000-0000-4000-8000-000000000001', 'tg-own1@tg.test'),
  ('7c000000-0000-4000-8000-000000000002', 'tg-own2@tg.test');
update public.profiles set plan = 'enterprise'
 where id in ('7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000002');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('7cb00000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000001', 'TG R1', 'tg-r1', 'Cluj', true),
  ('7cb00000-0000-4000-8000-000000000002', '7c000000-0000-4000-8000-000000000002', 'TG R2', 'tg-r2', 'Cluj', true);

insert into public.orders (id, restaurant_id, source, status, total) values
  ('7cd00000-0000-4000-8000-000000000001', '7cb00000-0000-4000-8000-000000000001', 'waiter', 'served', 10),
  ('7cd00000-0000-4000-8000-000000000002', '7cb00000-0000-4000-8000-000000000002', 'waiter', 'served', 10);

-- ── TG1 + TG2: sub rolul REAL authenticated, ca owner-ul lui R2 ──────────────
select set_config('request.jwt.claim.sub', '7c000000-0000-4000-8000-000000000002', true);
set local role authenticated;

do $$
declare v_hint text; v_ok boolean := false; v_n int;
begin
  begin
    insert into public.pending_receipts (restaurant_id, order_id, payload, status, bon_number, total_snapshot)
    values ('7cb00000-0000-4000-8000-000000000002', '7cd00000-0000-4000-8000-000000000001', 'S^x', 'success', '666', 10);
    v_ok := true;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'receipt_tenant_mismatch' then
      raise exception 'TG1 FAIL: respins din ALT motiv (%, hint=%) — nu gate-ul de tenant a prins rândul', sqlerrm, v_hint;
    end if;
  end;
  if v_ok then
    raise exception 'TG1 FAIL: owner-ul lui R2 a inserat un bon pe comanda lui R1 — rând cross-tenant acceptat';
  end if;
  raise notice 'TG1 OK: sub authenticated, bonul pe comanda altui restaurant e respins (receipt_tenant_mismatch)';

  -- TG2: comanda proprie → trece
  insert into public.pending_receipts (id, restaurant_id, order_id, payload, status, total_snapshot)
  values ('7ce00000-0000-4000-8000-000000000002', '7cb00000-0000-4000-8000-000000000002',
          '7cd00000-0000-4000-8000-000000000002', 'S^x', 'pending', 10);
  select count(*) into v_n from public.pending_receipts where id = '7ce00000-0000-4000-8000-000000000002';
  if v_n <> 1 then raise exception 'TG2 FAIL: inserarea legitimă nu a trecut'; end if;
  raise notice 'TG2 OK: bonul pe comanda proprie trece';
end $$;

reset role;

-- ── TG3: UPDATE cross-tenant respins; order_id NULL e scutit ─────────────────
do $$
declare v_hint text; v_ok boolean := false; v_st text;
begin
  begin
    update public.pending_receipts
       set order_id = '7cd00000-0000-4000-8000-000000000001'
     where id = '7ce00000-0000-4000-8000-000000000002';
    v_ok := true;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'receipt_tenant_mismatch' then
      raise exception 'TG3 FAIL: UPDATE respins din alt motiv (%, hint=%)', sqlerrm, v_hint;
    end if;
  end;
  if v_ok then
    raise exception 'TG3 FAIL: order_id mutat la comanda altui restaurant prin UPDATE';
  end if;

  -- rând istoric fără comandă (mig 032 a făcut order_id nullable; prod are unul)
  insert into public.pending_receipts (id, restaurant_id, order_id, payload, status, total_snapshot)
  values ('7ce00000-0000-4000-8000-000000000009', '7cb00000-0000-4000-8000-000000000002', null, 'S^x', 'error', 10);
  update public.pending_receipts set status = 'cancelled' where id = '7ce00000-0000-4000-8000-000000000009';
  select status into v_st from public.pending_receipts where id = '7ce00000-0000-4000-8000-000000000009';
  if v_st <> 'cancelled' then raise exception 'TG3 FAIL: rândul fără comandă nu mai poate fi actualizat'; end if;
  raise notice 'TG3 OK: UPDATE cross-tenant respins; order_id NULL e scutit';
end $$;

-- ── TG4: clichet de CLASĂ pe toate tabelele cu (order_id, restaurant_id) ─────
do $$
declare r record; v_missing text[] := '{}'; v_n int;
begin
  for r in
    select c.oid, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute where attrelid = c.oid and attname = 'order_id' and not attisdropped)
       and exists (select 1 from pg_attribute where attrelid = c.oid and attname = 'restaurant_id' and not attisdropped)
  loop
    -- lista `UPDATE OF` (tgattr) trebuie să conțină AMBELE coloane de tenant
    -- (sau să fie goală): un trigger cu `update of status` ar avea tot tgtype 23
    -- și ar lăsa UPDATE-ul pe order_id/restaurant_id să treacă.
    if not exists (select 1 from pg_trigger t
                    where t.tgrelid = r.oid and not t.tgisinternal and t.tgtype = 23
                      and t.tgfoid = 'public.enforce_order_tenant_consistency'::regproc
                      and (t.tgattr = ''::int2vector
                           or ((select attnum from pg_attribute where attrelid = r.oid and attname = 'order_id') = any (t.tgattr::int2[])
                               and (select attnum from pg_attribute where attrelid = r.oid and attname = 'restaurant_id') = any (t.tgattr::int2[])))) then
      v_missing := v_missing || r.relname;
    end if;
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'TG4 FAIL: tabele cu (order_id, restaurant_id) FĂRĂ gate de tenant sau cu lista UPDATE OF incompletă: % — orice tabelă nouă cu perechea primește trigger-ul (mig 278)', v_missing;
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal and t.tgtype = 19
                    and t.tgfoid = 'public.fn_orders_restaurant_id_immutable'::regproc
                    and (t.tgattr = ''::int2vector
                         or (select attnum from pg_attribute where attrelid = 'public.orders'::regclass and attname = 'restaurant_id') = any (t.tgattr::int2[]))) then
    raise exception 'TG4 FAIL: trigger-ul părinte trg_orders_restaurant_id_immutable lipsește sau nu acoperă restaurant_id';
  end if;
  select count(*) into v_n from pg_trigger
   where tgfoid = 'public.enforce_order_tenant_consistency'::regproc and not tgisinternal;
  if v_n < 4 then
    raise exception 'TG4 FAIL: doar % triggere de tenant (așteptat ≥ 4: pending_receipts, kitchen_tickets, invoices, order_feedback)', v_n; end if;
  if not exists (select 1 from pg_proc where oid = 'public.enforce_order_tenant_consistency'::regproc
                    and prosecdef and array_to_string(proconfig, ',') like '%pg_temp%') then
    raise exception 'TG4 FAIL: funcția de gate nu mai e DEFINER cu pg_temp (sub INVOKER mesajul minte, în cascade e oarbă)'; end if;
  if has_function_privilege('anon', 'public.enforce_order_tenant_consistency()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enforce_order_tenant_consistency()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.enforce_order_tenant_consistency()', 'EXECUTE')
     or has_function_privilege('anon', 'public.fn_orders_restaurant_id_immutable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_orders_restaurant_id_immutable()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.fn_orders_restaurant_id_immutable()', 'EXECUTE') then
    raise exception 'TG4 FAIL: o funcție de gate e executabilă de un rol client/service'; end if;
  raise notice 'TG4 OK: % tabele cu (order_id, restaurant_id), toate cu gate pe ambele coloane; părintele imuabil; funcții fără EXECUTE client', v_n;
end $$;

-- ── TG5: partea PĂRINTE — orders.restaurant_id e imuabil, sub authenticated ──
-- Owner-ul lui R2 devine și manager la R1 (un cont admin la două restaurante:
-- lanț/agenție). Membership-ul de owner al lui R1 rămâne unic (invariantul 096
-- e constraint trigger DEFERRED; tranzacția se rulează înapoi oricum).
insert into public.restaurant_memberships (restaurant_id, user_id, role)
values ('7cb00000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000002', 'manager');

select set_config('request.jwt.claim.sub', '7c000000-0000-4000-8000-000000000002', true);
set local role authenticated;

do $$
declare v_hint text; v_ok boolean := false; v_n int; v_rid uuid;
begin
  -- control pozitiv: RLS-ul (orders: admin all) îl lasă să editeze comanda lui R1
  update public.orders set notes = 'tg5' where id = '7cd00000-0000-4000-8000-000000000001';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'TG5 FAIL: controlul pozitiv a picat — managerul lui R1 nu poate edita comanda (RLS), testul ar fi vacuu';
  end if;

  begin
    update public.orders set restaurant_id = '7cb00000-0000-4000-8000-000000000002'
     where id = '7cd00000-0000-4000-8000-000000000001';
    v_ok := true;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'order_restaurant_immutable' then
      raise exception 'TG5 FAIL: mutarea respinsă din ALT motiv (%, hint=%) — nu trigger-ul părinte a prins-o', sqlerrm, v_hint;
    end if;
  end;
  if v_ok then
    raise exception 'TG5 FAIL: comanda lui R1 a fost mutată la R2 prin UPDATE — copiii ei ar rămâne pe R1';
  end if;
  raise notice 'TG5 OK: orders.restaurant_id e imuabil sub authenticated (order_restaurant_immutable)';
end $$;

reset role;

do $$
declare v_rid uuid;
begin
  select restaurant_id into v_rid from public.orders where id = '7cd00000-0000-4000-8000-000000000001';
  if v_rid <> '7cb00000-0000-4000-8000-000000000001' then
    raise exception 'TG5 FAIL: comanda nu mai e pe R1 (%)', v_rid;
  end if;
end $$;

rollback;

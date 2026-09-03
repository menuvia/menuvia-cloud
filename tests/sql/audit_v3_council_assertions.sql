-- tests/sql/audit_v3_council_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 264 (acțiunile de cod din planul consiliului
-- audit v3, după ce echipele roșii au atacat remedierile din 262/263).
-- Self-contained, ROLLBACK la final.
--
--   AC1  RANG 6a: `mark_paid` cu o sumă SUB total e respins (hint
--        `underpayment`) pe ramura FĂRĂ plăți parțiale — altfel comanda ar
--        rămâne 'paid' cu un bon imposibil de emis (guard-ul B3, mig 053).
--   AC2  RANG 6a: același prag pe ramura CU plăți parțiale; iar suma exactă
--        (parțial + rest) trece în continuare, cu bacșiș peste notă.
--   AC3  RANG 6b: pe Plan 3, un UPDATE DIRECT `status='closed'` (calea
--        PostgREST sub „orders: admin all", care ocolea RPC-ul) e respins de
--        trigger; pe growth trece neschimbat.
--   AC4  RANG 9: ca ANON, citirea `product_extras` / `product_pairings`
--        funcționează (fallback-ul fetchMenuLayered) — înainte dădea 42501
--        `permission denied for function is_admin`.
--   AC5  Asserția de CLASĂ: niciun tabel cu SELECT pentru anon nu are politici
--        pe rolul PUBLIC care apelează funelul de autorizare.
--   AC6  `mark_paid` FĂRĂ sumă și fără plăți parțiale e respins (hint
--        `paid_amount_required`): comportamentul vechi trecea comanda în 'paid'
--        cu ZERO rânduri în `order_payments` — bani fără bon pe Plan 3.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed: un restaurant Plan 3 (pro) și unul Plan 2 (growth) ─────────────────
insert into auth.users (id, email) values
  ('64000000-0000-4000-8000-000000000001','ac-pro@ac.test'),
  ('64000000-0000-4000-8000-000000000002','ac-growth@ac.test');
update public.profiles set plan='pro'    where id='64000000-0000-4000-8000-000000000001';
update public.profiles set plan='growth' where id='64000000-0000-4000-8000-000000000002';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('64b00000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','AC Pro','ac-pro','Cluj',true),
  ('64b00000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000002','AC Growth','ac-growth','Cluj',true);

insert into public.categories (id, restaurant_id, name) values
  ('64c00000-0000-4000-8000-000000000001','64b00000-0000-4000-8000-000000000001','AC Cat');
insert into public.products (id, restaurant_id, category_id, name, price, vat_group, is_active, is_draft) values
  ('64d00000-0000-4000-8000-000000000001','64b00000-0000-4000-8000-000000000001',
   '64c00000-0000-4000-8000-000000000001','AC Cafea',100,1,true,false);

select set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000001', true);

-- ── AC1: sub-încasare pe ramura fără plăți parțiale → respinsă ───────────────
do $$
declare v_o uuid := '64f00000-0000-4000-8000-000000000001'; v_hint text; v_status text;
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '64b00000-0000-4000-8000-000000000001', 'waiter', 'served', 100);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o, '64d00000-0000-4000-8000-000000000001', 'AC Cafea', 1, 100, 100);

  v_hint := null;
  begin
    perform public.advance_order(v_o, 'mark_paid', 60, 'cash', 0, null);   -- 60 pe o notă de 100
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'underpayment' then
    raise exception 'AC1 FAIL: 60 pe o notă de 100 nu a fost respins cu underpayment (hint=%) — comandă paid cu bon imposibil de emis', v_hint; end if;
  select status into v_status from public.orders where id = v_o;
  if v_status <> 'served' then
    raise exception 'AC1 FAIL: comanda a trecut în % deși suma nu acoperă nota', v_status; end if;

  -- Control pozitiv: suma exactă + bacșiș peste notă trece și lasă bonul emisibil.
  perform public.advance_order(v_o, 'mark_paid', 110, 'cash', 10, null);
  if (select paid_amount from public.orders where id = v_o) <> 100
     or (select tips_amount from public.orders where id = v_o) <> 10 then
    raise exception 'AC1 FAIL: plata exactă cu bacșiș nu a produs paid_amount=100 / tips=10'; end if;
  raise notice 'AC1 OK: sub-încasarea e respinsă; plata exactă cu bacșiș trece';
end $$;

-- ── AC2: același prag pe ramura CU plăți parțiale ────────────────────────────
do $$
declare v_o uuid := '64f00000-0000-4000-8000-000000000002'; v_hint text; v_sum numeric;
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '64b00000-0000-4000-8000-000000000001', 'waiter', 'served', 200);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o, '64d00000-0000-4000-8000-000000000001', 'AC Cafea', 2, 100, 200);
  insert into public.order_payments (order_id, amount, method, paid_by)
    values (v_o, 50, 'cash', '64000000-0000-4000-8000-000000000001');

  v_hint := null;
  begin
    perform public.advance_order(v_o, 'mark_paid', 100, 'cash', 0, null);  -- 50 + 100 < 200
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'underpayment' then
    raise exception 'AC2 FAIL: 50 parțial + 100 rest pe o notă de 200 nu a fost respins (hint=%)', v_hint; end if;

  -- Control pozitiv: restul EXACT (150) + bacșiș 15 închide nota.
  perform public.advance_order(v_o, 'mark_paid', 165, 'cash', 15, null);
  select coalesce(sum(amount),0) into v_sum from public.order_payments where order_id = v_o;
  if v_sum <> 200 then
    raise exception 'AC2 FAIL: sum(order_payments)=% (așteptat 200 — B3 ar refuza payload-ul)', v_sum; end if;
  raise notice 'AC2 OK: sub-încasarea pe ramura cu parțiale e respinsă; restul exact + bacșiș închide nota la 200';
end $$;

-- ── AC6: `mark_paid` fără sumă, fără parțiale → respins ─────────────────────
do $$
declare v_o uuid := '64f00000-0000-4000-8000-000000000006'; v_hint text;
        v_status text; v_n int;
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '64b00000-0000-4000-8000-000000000001', 'waiter', 'served', 80);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o, '64d00000-0000-4000-8000-000000000001', 'AC Cafea', 1, 80, 80);

  v_hint := null;
  begin
    -- Wrapper-ul din orders.ts trimite `p_paid_amount: payload.paid_amount ?? null`,
    -- deci un apel PostgREST fără sumă ajungea EXACT aici.
    perform public.advance_order(v_o, 'mark_paid', null, 'cash', 0, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'paid_amount_required' then
    raise exception 'AC6 FAIL: mark_paid fără sumă nu a fost respins (hint=%) — comandă paid cu registrul de plăți gol', v_hint; end if;
  select status into v_status from public.orders where id = v_o;
  select count(*) into v_n from public.order_payments where order_id = v_o;
  if v_status <> 'served' or v_n <> 0 then
    raise exception 'AC6 FAIL: status=% / % plăți (așteptat served / 0)', v_status, v_n; end if;

  -- Control pozitiv: CU plăți parțiale, suma lipsă rămâne legitimă — restul se
  -- DEDUCE din registru (total - parțial + bacșiș), deci nu inventăm nimic.
  insert into public.order_payments (order_id, amount, method, paid_by)
    values (v_o, 30, 'cash', '64000000-0000-4000-8000-000000000001');
  perform public.advance_order(v_o, 'mark_paid', null, 'cash', 0, null);
  select coalesce(sum(amount), 0) into v_n from public.order_payments where order_id = v_o;
  if v_n <> 80 then
    raise exception 'AC6 FAIL: restul dedus nu a închis nota la 80 (sum=%)', v_n; end if;
  raise notice 'AC6 OK: suma lipsă e respinsă fără parțiale și dedusă corect cu parțiale';
end $$;

-- ── AC3: UPDATE direct spre 'closed' — respins pe Plan 3, permis pe growth ───
do $$
declare v_o uuid := '64f00000-0000-4000-8000-000000000003'; v_hint text;
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '64b00000-0000-4000-8000-000000000001', 'waiter', 'served', 40);
  v_hint := null;
  begin
    -- Exact calea pe care RPC-ul nu o acoperea: PATCH direct sub „orders: admin all".
    update public.orders set status = 'closed' where id = v_o;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'fiscal_plan_requires_payment' then
    raise exception 'AC3 FAIL: UPDATE direct la closed pe Plan 3 nu a fost respins de trigger (hint=%)', v_hint; end if;
  if (select status from public.orders where id = v_o) <> 'served' then
    raise exception 'AC3 FAIL: comanda a fost închisă nefiscal prin UPDATE direct'; end if;
end $$;

select set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000002', true);
do $$
declare v_o uuid := '64f00000-0000-4000-8000-000000000004';
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '64b00000-0000-4000-8000-000000000002', 'waiter', 'served', 40);
  update public.orders set status = 'closed' where id = v_o;   -- growth: neschimbat
  if (select status from public.orders where id = v_o) <> 'closed' then
    raise exception 'AC3 FAIL: pe growth închiderea a fost blocată (regresie pe Plan 2)'; end if;
  raise notice 'AC3 OK: gate-ul de închidere e în DATE — blochează Plan 3, lasă growth neatins';
end $$;

-- ── AC4: anon citește extras/pairings (fallback-ul fetchMenuLayered) ─────────
insert into public.product_extras (product_id, name, price, is_available)
  values ('64d00000-0000-4000-8000-000000000001', 'AC Sirop', 3, true);
set local role anon;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.product_extras;   -- înainte: 42501 is_admin
  if v_n < 1 then
    raise exception 'AC4 FAIL: anon nu vede extras-urile publice (% rânduri)', v_n; end if;
  perform count(*) from public.product_pairings;         -- doar să nu arunce
  raise notice 'AC4 OK: anon citește product_extras/product_pairings (fallback-ul de meniu trăiește)';
end $$;
reset role;

-- ── AC5: asserția de CLASĂ (tiparul, nu cazul particular) ────────────────────
do $$
declare r record; v_rupte text := '';
begin
  -- Citim catalogul `pg_policy` direct, nu view-ul `pg_policies`, ca să folosim
  -- `polrelid` (un OID) în locul unui nume trecut prin `to_regclass` — exact
  -- round-trip-ul nume→OID care a picat o dată pe un `pg_toast_*` când
  -- planificatorul a reordonat predicatele.
  -- `0 = any(polroles)` e ECHIVALENT cu `pg_policies.roles = '{public}'`, nu o
  -- lărgire: Postgres NORMALIZEAZĂ orice listă care conține PUBLIC la exact
  -- '{0}' („WARNING: ignoring specified roles other than PUBLIC"), deci forma
  -- mixtă `{0, anon}` nu e stocabilă. Verificat empiric pe PG 16 și pe
  -- producție (73 de politici cu PUBLIC, toate '{0}', zero mixte).
  -- Privilegiul se verifică tot în CORPUL buclei, nu în WHERE.
  for r in
    select c.relname::text as tablename,
           pol.polname::text as policyname,
           case pol.polcmd when '*' then 'ALL' when 'r' then 'SELECT' end as cmd,
           pol.polrelid as reloid
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and pol.polcmd in ('*', 'r')
       and 0 = any(pol.polroles)
       and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
            || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
           ~ '(is_admin|is_member|my_role)\('
  loop
    if has_table_privilege('anon', r.reloid, 'SELECT') then
      v_rupte := v_rupte || format('%s/%s[%s] ', r.tablename, r.policyname, r.cmd);
    end if;
  end loop;
  if v_rupte <> '' then
    raise exception 'AC5 FAIL: politici PUBLIC pe tabele citibile de anon care evaluează funelul: %', v_rupte; end if;
  raise notice 'AC5 OK: nicio politică PUBLIC nu rupe citirea anon (asserție de clasă, nu pe tabel)';
end $$;

rollback;

-- tests/sql/auto/waiter_forward_steps.sql
-- =============================================================================
-- WF1–WF4 — pasul următor al ospătarului pe Planul 3 (lotul O7b, nov 2026).
-- FĂRĂ migrație: clientul (`src/lib/waiterSteps.ts`) oferă doar pași pe care
-- `advance_order` (corpul viu, mig 291) îi acceptă DEJA pentru rolul de
-- ospătar. Suita îngheață acea tabelă în blocul FIXTURE de mai jos, iar WS2
-- (`src/lib/__tests__/waiterSteps.test.ts`) cere ca pașii clientului să fie
-- EXACT rândurile lui — un pas nou intră în AMBELE locuri, în același PR.
--
-- Defectul reparat: pe Planul 3 plata apare doar pe `served`, „Închide
-- comanda” e interzisă (regula de aur), iar new → … → ready îl făcea doar
-- Bucătăria (/kitchen, inaccesibil ospătarului). Un local fără ecran de
-- bucătărie nu putea nici servi, nici încasa o comandă nouă.
--
-- Toate apelurile rulează SUB rolul REAL `authenticated`, cu identitatea
-- ospătarului (ca `postgres` contextul de rol e ocolit — clasa PM8/TP24).
-- Autonom, ROLLBACK la final.
--
--   WF1  Fiecare rând FIXTURE, executat de ospătar pe un restaurant
--        enterprise RO, e ACCEPTAT și lasă comanda exact în `to_status`.
--        Control pozitiv: ≥ 8 pași executați.
--        [PICĂ: mark_served îngustat la `not in ('ready')` — verificat:
--         „preparing/false/mark_served → invalid_transition”; 'waiter' scos din
--         rolurile lui start_preparing / mark_ready; 'new' scos din
--         start_preparing]
--   WF2  Completitudine: din `new` (fără și cu pickup), pasul FIXTURE al stării
--        curente, până nu mai există niciunul → comanda ajunge `served` (2 pași
--        fără pickup, 3 cu pickup — control pe număr), apoi mark_paid(10,
--        cash) de ospătar → `paid`, paid_amount = total = 10.
--        [PICĂ: FIXTURE fără rândul unei stări de pe drum (ex. `preparing`
--         fără pickup scos), ciclu sau fundătură]
--   WF3  Ancora regulii de aur. (a) Niciun pas FIXTURE nu e mark_paid /
--        close_order / cancel și niciunul nu duce în paid / closed /
--        cancelled. (b) Pe același restaurant de Plan 3: close_order din
--        `new` → `fiscal_plan_requires_payment`; mark_paid din `new` și din
--        `preparing` → `invalid_transition`; statusul rămâne neschimbat, fără
--        nicio plată în registru. Control în același bloc: start_preparing pe
--        aceeași comandă E acceptat.
--        [PICĂ: un rând ('new', false, 'close_order', 'closed') adăugat în
--         FIXTURE (îl prinde deja WF1: serverul îl refuză); gate-ul fiscal
--         scos din AMBELE straturi — ramura close_order din advance_order ȘI
--         `trg_orders_closed_fiscal_gate` (264). Scos doar din RPC, trigger-ul
--         din DATE respinge cu ACELAȘI hint și WF3 rămâne verde — verificat,
--         e apărarea în adâncime a regulii de aur (ca la OJ12), nu un gol]
--   WF4  Ancora SMS-ului de pickup: `trg_sms_pickup_ready` se declanșează tot
--        pe →ready + pickup, iar orice pas FIXTURE de pickup care duce în
--        `served` pleacă din `ready` (control: există un pas de pickup →ready).
--        [PICĂ: un rând ('preparing', true, 'mark_served', 'served') — pasul
--         care i-ar sări oaspetelui SMS-ul „comanda e gata”]
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('9d000000-0000-4000-8000-0000000000a1', 'wf-owner@wf.test'),
  ('9d000000-0000-4000-8000-0000000000a2', 'wf-waiter@wf.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('9d000000-0000-4000-8000-0000000000a1', 'wf-owner@wf.test'),
  ('9d000000-0000-4000-8000-0000000000a2', 'wf-waiter@wf.test')
  on conflict (id) do nothing;
update public.profiles set plan = 'enterprise' where id = '9d000000-0000-4000-8000-0000000000a1';

insert into public.restaurants (id, owner_id, name, slug, city, is_active, country) values
  ('9d000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-0000000000a1',
   'WF Pro', 'wf-pro-o7b', 'Cluj', true, 'RO');
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('9d000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-0000000000a2', 'waiter');
insert into public.products (id, restaurant_id, name, price, is_active) values
  ('9d000000-0000-4000-8000-0000000000b1', '9d000000-0000-4000-8000-000000000001', 'Cafea', 10, true);

-- Tabela pașilor ospătarului. WS2 parsează blocul dintre markeri (forma
-- `('from', is_pickup, 'action', 'to')`) și îl compară cu `waiterForwardStep`.
create temp table wf_steps (from_status text, is_pickup boolean, action text, to_status text) on commit drop;
insert into wf_steps values
  -- FIXTURE-BEGIN
  ('new',       false, 'start_preparing', 'preparing'),
  ('new',       true,  'start_preparing', 'preparing'),
  ('confirmed', false, 'start_preparing', 'preparing'),
  ('confirmed', true,  'start_preparing', 'preparing'),
  ('preparing', false, 'mark_served',     'served'),
  ('preparing', true,  'mark_ready',      'ready'),
  ('ready',     false, 'mark_served',     'served'),
  ('ready',     true,  'mark_served',     'served')
  -- FIXTURE-END
;

-- O comandă de 10 lei în starea dată (inserată ca postgres: fixtura, nu pasul testat).
create function pg_temp.wf_new_order(p_status text, p_pickup boolean) returns uuid
language plpgsql as $f$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.orders (id, restaurant_id, source, status, customer_name, customer_phone)
  values (v_id, '9d000000-0000-4000-8000-000000000001',
          case when p_pickup then 'pickup' else 'waiter' end::public.order_source,
          p_status::public.order_status,
          case when p_pickup then 'WF' end, case when p_pickup then '0722000000' end);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
  values (v_id, '9d000000-0000-4000-8000-0000000000b1', 'Cafea', 1, 10, 10);
  return v_id;
end $f$;

-- Apel SUB rolul REAL `authenticated`, cu identitatea ospătarului; întoarce
-- null (a trecut) sau 'hint|mesaj'. `set_config('role')` stă ÎN AFARA
-- sub-blocului cu excepție (în interior s-ar derula înapoi cu subtranzacția);
-- EXECUTE dinamic, ca PL/pgSQL să nu cache-uiască verificarea de ACL.
create function pg_temp.wf_as_waiter(p_sql text) returns text
language plpgsql as $f$
declare v_hint text; v_msg text; v_out text := null;
begin
  perform set_config('request.jwt.claim.sub', '9d000000-0000-4000-8000-0000000000a2', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
    v_out := coalesce(v_hint, '') || '|' || v_msg;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_out;
end $f$;

create function pg_temp.wf_status(p_id uuid) returns text
language sql as $f$ select status::text from public.orders where id = p_id $f$;

-- ── WF1: fiecare pas, acceptat de server pentru ospătar ──────────────────────
do $$
declare r record; v_err text; v_bad text := ''; v_n int := 0; v_id uuid;
begin
  for r in select * from wf_steps order by from_status, is_pickup loop
    v_id := pg_temp.wf_new_order(r.from_status, r.is_pickup);
    v_err := pg_temp.wf_as_waiter(format('select public.advance_order(%L::uuid, %L)', v_id, r.action));
    if v_err is not null then
      v_bad := v_bad || format('%s/%s/%s → %s; ', r.from_status, r.is_pickup, r.action, v_err);
    elsif pg_temp.wf_status(v_id) is distinct from r.to_status then
      v_bad := v_bad || format('%s/%s/%s → status final %s (așteptat %s); ',
        r.from_status, r.is_pickup, r.action, pg_temp.wf_status(v_id), r.to_status);
    else
      v_n := v_n + 1;
    end if;
  end loop;
  if v_bad <> '' then
    raise exception 'WF1 FAIL: pași ai ospătarului respinși de server: %', v_bad;
  end if;
  if v_n < 8 then
    raise exception 'WF1 FAIL (control pozitiv): doar % pași executați', v_n;
  end if;
  raise notice 'WF1 OK: % pași acceptați pentru ospătar, sub rolul authenticated', v_n;
end $$;

-- ── WF2: din `new`, pașii FIXTURE duc până la `served`, apoi plata trece ─────
do $$
declare
  v_pickup boolean;
  v_id uuid;
  v_status text;
  v_action text;
  v_err text;
  v_n int;
  v_expected int;
  v_paid numeric;
begin
  foreach v_pickup in array array[false, true] loop
    v_id := pg_temp.wf_new_order('new', v_pickup);
    v_n := 0;
    loop
      v_status := pg_temp.wf_status(v_id);
      select action into v_action from wf_steps where from_status = v_status and is_pickup = v_pickup;
      exit when not found;
      v_n := v_n + 1;
      if v_n > 6 then
        raise exception 'WF2 FAIL: ciclu în FIXTURE (pickup=%, încă pe %)', v_pickup, v_status;
      end if;
      v_err := pg_temp.wf_as_waiter(format('select public.advance_order(%L::uuid, %L)', v_id, v_action));
      if v_err is not null then
        raise exception 'WF2 FAIL: pasul % din % respins (pickup=%): %', v_action, v_status, v_pickup, v_err;
      end if;
    end loop;
    v_expected := case when v_pickup then 3 else 2 end;
    if v_status is distinct from 'served' then
      raise exception 'WF2 FAIL: fundătură — pașii se opresc pe % (pickup=%), nu pe served', v_status, v_pickup;
    end if;
    if v_n <> v_expected then
      raise exception 'WF2 FAIL (control): % pași până la served (pickup=%), așteptați %', v_n, v_pickup, v_expected;
    end if;
    -- Plata rămâne drumul existent din `served` (PayModal → mark_paid).
    v_err := pg_temp.wf_as_waiter(format(
      'select public.advance_order(%L::uuid, %L, 10::numeric, %L)', v_id, 'mark_paid', 'cash'));
    if v_err is not null then
      raise exception 'WF2 FAIL: plata din served respinsă (pickup=%): %', v_pickup, v_err;
    end if;
    select paid_amount into v_paid from public.orders where id = v_id;
    if pg_temp.wf_status(v_id) is distinct from 'paid' or v_paid is distinct from 10::numeric then
      raise exception 'WF2 FAIL: după plată status=% paid_amount=% (așteptat paid / 10)',
        pg_temp.wf_status(v_id), v_paid;
    end if;
  end loop;
  raise notice 'WF2 OK: din new până la paid, 2 pași (+1 la pickup) și plata din served';
end $$;

-- ── WF3: pașii nu ating banii; gate-ul fiscal rămâne viu ─────────────────────
do $$
declare v_bad text; v_id uuid; v_err text; v_pay int;
begin
  -- (a) static, pe FIXTURE
  select string_agg(format('%s/%s/%s→%s', from_status, is_pickup, action, to_status), ', ')
    into v_bad
    from wf_steps
   where action in ('mark_paid', 'close_order', 'cancel')
      or to_status in ('paid', 'closed', 'cancelled');
  if v_bad is not null then
    raise exception 'WF3 FAIL: pași ai ospătarului care ating banii / închid comanda: %', v_bad;
  end if;

  -- (b) dinamic, pe același restaurant de Plan 3
  v_id := pg_temp.wf_new_order('new', false);
  v_err := pg_temp.wf_as_waiter(format('select public.advance_order(%L::uuid, %L)', v_id, 'close_order'));
  if v_err is null or split_part(v_err, '|', 1) <> 'fiscal_plan_requires_payment' then
    raise exception 'WF3 FAIL: close_order din new pe Planul 3 trebuia respins cu fiscal_plan_requires_payment, a dat: %',
      coalesce(v_err, 'ACCEPTAT');
  end if;
  v_err := pg_temp.wf_as_waiter(format(
    'select public.advance_order(%L::uuid, %L, 10::numeric, %L)', v_id, 'mark_paid', 'cash'));
  if v_err is null or split_part(v_err, '|', 1) <> 'invalid_transition' then
    raise exception 'WF3 FAIL: mark_paid din new trebuia respins cu invalid_transition, a dat: %',
      coalesce(v_err, 'ACCEPTAT');
  end if;
  select count(*) into v_pay from public.order_payments where order_id = v_id;
  if pg_temp.wf_status(v_id) is distinct from 'new' or v_pay <> 0 then
    raise exception 'WF3 FAIL: după refuzuri status=% plăți=% (așteptat new / 0)', pg_temp.wf_status(v_id), v_pay;
  end if;

  -- control pozitiv: pasul FIXTURE din `new` trece pe ACEEAȘI comandă
  v_err := pg_temp.wf_as_waiter(format('select public.advance_order(%L::uuid, %L)', v_id, 'start_preparing'));
  if v_err is not null or pg_temp.wf_status(v_id) is distinct from 'preparing' then
    raise exception 'WF3 FAIL (control): start_preparing pe aceeași comandă: % / %', v_err, pg_temp.wf_status(v_id);
  end if;
  v_err := pg_temp.wf_as_waiter(format(
    'select public.advance_order(%L::uuid, %L, 10::numeric, %L)', v_id, 'mark_paid', 'cash'));
  if v_err is null or split_part(v_err, '|', 1) <> 'invalid_transition' then
    raise exception 'WF3 FAIL: mark_paid din preparing trebuia respins cu invalid_transition, a dat: %',
      coalesce(v_err, 'ACCEPTAT');
  end if;
  select count(*) into v_pay from public.order_payments where order_id = v_id;
  if pg_temp.wf_status(v_id) is distinct from 'preparing' or v_pay <> 0 then
    raise exception 'WF3 FAIL: după refuz status=% plăți=% (așteptat preparing / 0)', pg_temp.wf_status(v_id), v_pay;
  end if;
  raise notice 'WF3 OK: pașii nu ating banii; close_order/mark_paid în afara lui served respinse';
end $$;

-- ── WF4: pickup-ul trece prin `ready` (SMS-ul „comanda e gata”) ──────────────
do $$
declare v_def text; v_bad text; v_ready int;
begin
  select pg_get_triggerdef(t.oid) into v_def
    from pg_trigger t
   where t.tgrelid = 'public.orders'::regclass and t.tgname = 'trg_sms_pickup_ready';
  if v_def is null then
    raise exception 'WF4 FAIL: trg_sms_pickup_ready lipsește de pe public.orders';
  end if;
  if position('''ready''' in v_def) = 0 or position('''pickup''' in v_def) = 0 then
    raise exception 'WF4 FAIL: trg_sms_pickup_ready nu mai e pe →ready + pickup: %', v_def;
  end if;
  select string_agg(format('%s→%s', from_status, to_status), ', ') into v_bad
    from wf_steps where is_pickup and to_status = 'served' and from_status <> 'ready';
  if v_bad is not null then
    raise exception 'WF4 FAIL: pas de pickup care sare peste ready (fără SMS): %', v_bad;
  end if;
  select count(*) into v_ready from wf_steps where is_pickup and to_status = 'ready';
  if v_ready < 1 then
    raise exception 'WF4 FAIL (control): niciun pas de pickup nu duce în ready';
  end if;
  raise notice 'WF4 OK: pickup-ul servit doar din ready (% pas → ready)', v_ready;
end $$;

rollback;

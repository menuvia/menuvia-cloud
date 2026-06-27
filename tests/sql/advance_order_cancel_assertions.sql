-- tests/sql/advance_order_cancel_assertions.sql
-- =============================================================================
-- Asersții pentru ADV-1 (mig 118): branch-ul 'cancel' din advance_order
-- permitea anularea unei comenzi deja 'served' (mâncare livrată) fără
-- cancel_reason → audit trail incomplet / rapoarte coruptibile.
-- Mig 118: la cancel din 'served' cancel_reason devine OBLIGATORIU.
-- Statusurile ne-served rămân NESCHIMBATE (cancel_reason opțional).
--
-- Self-contained, ROLLBACK la final. Setup oglindit din „Gate C" (sql-verify.yml).
--
--   AC1  cancel din 'served' FĂRĂ cancel_reason → RESPINS (hint cancel_reason_required)
--   AC2  cancel din 'served' CU  cancel_reason → ACCEPTAT (cancelled + reason persistat)
--   AC3  cancel din 'new'    FĂRĂ cancel_reason → ÎNCĂ ACCEPTAT (neschimbat)
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Setup (ca postgres; handle_new_user creează profilul) ────────────────────
insert into auth.users (id, email) values
  ('c1c1c1c1-1111-4111-8111-111111111111','owner-adv1@adv.test');

-- Planul nu contează pentru 'cancel' (fără gate fiscal), dar setăm explicit.
update public.profiles set plan='growth' where id='c1c1c1c1-1111-4111-8111-111111111111';

-- Restaurant (trigger bootstrap creează owner membership).
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('c2c2c2c2-2222-4222-8222-222222222222','c1c1c1c1-1111-4111-8111-111111111111',
   'Radv','radv-adv1','Cluj',true);

insert into public.tables (id, restaurant_id, name, slug, is_active) values
  ('c3c3c3c3-3333-4333-8333-333333333333','c2c2c2c2-2222-4222-8222-222222222222',
   'Masa ADV','masa-adv',true);

-- Context ca owner (pentru auth check din advance_order).
select set_config('request.jwt.claim.sub', 'c1c1c1c1-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- ── AC1: cancel din 'served' fără cancel_reason → respins ────────────────────
do $$
declare
  v_order_id uuid := 'c4c4c4c4-4444-4444-8444-444444444444';
  v_blocked  boolean := false;
  v_status   text;
begin
  insert into public.orders (id, restaurant_id, table_id, source, status, total, session_id)
    values (v_order_id, 'c2c2c2c2-2222-4222-8222-222222222222',
            'c3c3c3c3-3333-4333-8333-333333333333', 'qr', 'served', 45.00, null);

  begin
    perform public.advance_order(v_order_id, 'cancel', null, null, null, null);
  exception when others then
    if sqlerrm ilike '%cancel_reason%' then v_blocked := true;
    else raise exception 'AC1: eroare neașteptată: %', sqlerrm; end if;
  end;

  if not v_blocked then
    raise exception 'AC1 FAIL: cancel din served fără cancel_reason a fost acceptat';
  end if;

  -- Comanda trebuie să fi rămas 'served' (anularea nu s-a aplicat).
  select status into v_status from public.orders where id = v_order_id;
  if v_status is distinct from 'served' then
    raise exception 'AC1 FAIL: status ar trebui served (neschimbat), e: %', v_status;
  end if;
  raise notice 'AC1 PASS: cancel din served fără reason respins, comandă neschimbată';
end$$;

-- ── AC2: cancel din 'served' cu cancel_reason → acceptat ─────────────────────
do $$
declare
  v_order_id uuid := 'c5c5c5c5-5555-4555-8555-555555555555';
  v_status   text;
  v_reason   text;
begin
  insert into public.orders (id, restaurant_id, table_id, source, status, total, session_id)
    values (v_order_id, 'c2c2c2c2-2222-4222-8222-222222222222',
            'c3c3c3c3-3333-4333-8333-333333333333', 'qr', 'served', 60.00, null);

  perform public.advance_order(v_order_id, 'cancel', null, null, null, 'client a plecat fără plată');

  select status, cancel_reason into v_status, v_reason
    from public.orders where id = v_order_id;
  if v_status is distinct from 'cancelled' then
    raise exception 'AC2 FAIL: status ar trebui cancelled, e: %', v_status;
  end if;
  if v_reason is distinct from 'client a plecat fără plată' then
    raise exception 'AC2 FAIL: cancel_reason ar trebui persistat, e: %', v_reason;
  end if;
  raise notice 'AC2 PASS: cancel din served cu reason acceptat (cancelled + reason persistat)';
end$$;

-- ── AC3: cancel din 'new' fără cancel_reason → încă acceptat (neschimbat) ─────
do $$
declare
  v_order_id uuid := 'c6c6c6c6-6666-4666-8666-666666666666';
  v_status   text;
begin
  insert into public.orders (id, restaurant_id, table_id, source, status, total, session_id)
    values (v_order_id, 'c2c2c2c2-2222-4222-8222-222222222222',
            'c3c3c3c3-3333-4333-8333-333333333333', 'qr', 'new', 10.00, null);

  perform public.advance_order(v_order_id, 'cancel', null, null, null, null);

  select status into v_status from public.orders where id = v_order_id;
  if v_status is distinct from 'cancelled' then
    raise exception 'AC3 FAIL: cancel din new fără reason ar trebui acceptat, status e: %', v_status;
  end if;
  raise notice 'AC3 PASS: cancel din new fără reason încă acceptat (comportament neschimbat)';
end$$;

select 'ALL PASS' as result;

rollback;

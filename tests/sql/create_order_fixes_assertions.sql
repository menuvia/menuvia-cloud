-- ═══════════════════════════════════════════════════════════════
-- create_order — asserțiuni pentru cele 4 fix-uri din mig 117
-- ═══════════════════════════════════════════════════════════════
-- Self-contained: creează owner growth + restaurant + masă + qr_token +
-- sesiune open + produs real (model: pasul „Gate B+" din sql-verify.yml).
-- Verifică:
--   CO1 — qr happy-path cu produs real încă creează comanda;
--   CO2 — același idempotency_key de două ori → aceeași comandă, fără eroare;
--   CO3 — pickup fără pickup_time → respins (ORD-088-2);
--   CO4 — pickup cu telefon invalid → respins (ORD-088-3);
--   CO5 — comandă waiter cu p_qr_token_id non-null → rândul are qr_token_id NULL
--          (ORD-088-4).
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_owner   uuid := '11111111-2222-3333-4444-555555555501'::uuid;
  v_rest    uuid := '11111111-2222-3333-4444-555555555502'::uuid;
  v_table   uuid := '11111111-2222-3333-4444-555555555503'::uuid;
  v_tok     uuid := '11111111-2222-3333-4444-555555555504'::uuid;
  v_token   text := 'create-order-fixes-' || extract(epoch from now())::bigint;
  v_pid     uuid;
  v_sess    jsonb;
  v_sid     uuid;
  v_res     jsonb;
  v_res2    jsonb;
  v_oid     uuid;
  v_idem    uuid := '11111111-2222-3333-4444-5555555555a1'::uuid;
  v_waiter_oid uuid;
  v_qtok    uuid;
  v_count   int;
  v_blocked boolean;
begin
  -- ─── SETUP ────────────────────────────────────────────────────
  insert into auth.users (id, email) values (v_owner, 'create-order-fixes@menuvia.ro');
  update public.profiles set plan = 'growth' where id = v_owner;

  -- pickup_settings.enabled=true ca să ajungem la validarea pickup_time (CO3).
  insert into public.restaurants (id, owner_id, name, slug, city, is_active, pickup_settings)
    values (
      v_rest, v_owner, 'CreateOrder Fixes R', 'create-order-fixes-slug', 'Cluj', true,
      jsonb_build_object('enabled', true, 'min_lead_time_minutes', 20)
    );

  insert into public.tables (id, restaurant_id, name, slug, is_active, seats)
    values (v_table, v_rest, 'Masa 1', 'cof-masa-1', true, 4);

  insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active)
    values (v_tok, v_rest, v_table, v_token, true);

  insert into public.products (restaurant_id, category_id, name, price, is_active)
    values (v_rest, null, 'Cafea', 12.00, true) returning id into v_pid;

  perform set_config('request.jwt.claim.role', 'anon', true);

  -- ─── CO1: qr happy-path cu produs real → comandă creată ───────
  v_sess := public.open_table_session(v_token);
  v_sid  := (v_sess->>'session_id')::uuid;

  v_res := public.create_order(
    v_rest, 'qr', v_table, v_tok, null,
    ('[{"product_id":"' || v_pid || '","quantity":2}]')::jsonb,
    null, null, null, null, v_sid
  );
  v_oid := (v_res->>'id')::uuid;

  if v_oid is null then
    raise exception 'CO1 FAIL: comanda QR happy-path nu a returnat id';
  end if;
  select count(*) into v_count from public.orders where id = v_oid;
  if v_count != 1 then
    raise exception 'CO1 FAIL: comanda QR nu a fost inserată (count=%)', v_count;
  end if;
  if (v_res->>'total')::numeric is distinct from 24.00 then
    raise exception 'CO1 FAIL: total ar trebui 24.00, e: %', v_res->>'total';
  end if;
  raise notice 'CO1 PASS: qr happy-path cu produs real → comandă creată (total=24.00)';

  -- ─── CO2: același idempotency_key de două ori → aceeași comandă ─
  v_res := public.create_order(
    v_rest, 'qr', v_table, v_tok, null,
    ('[{"product_id":"' || v_pid || '","quantity":1}]')::jsonb,
    v_idem, null, null, null, v_sid
  );
  v_res2 := public.create_order(
    v_rest, 'qr', v_table, v_tok, null,
    ('[{"product_id":"' || v_pid || '","quantity":1}]')::jsonb,
    v_idem, null, null, null, v_sid
  );

  if (v_res->>'id') is distinct from (v_res2->>'id') then
    raise exception 'CO2 FAIL: idempotency_key identic a produs comenzi diferite (% vs %)',
      v_res->>'id', v_res2->>'id';
  end if;
  select count(*) into v_count
    from public.orders
   where restaurant_id = v_rest and idempotency_key = v_idem;
  if v_count != 1 then
    raise exception 'CO2 FAIL: ar trebui exact 1 comandă pe idempotency_key, sunt: %', v_count;
  end if;
  raise notice 'CO2 PASS: același idempotency_key → aceeași comandă, fără eroare';

  -- ─── CO3: pickup fără pickup_time → respins (ORD-088-2) ────────
  -- Telefon VALID ca să trecem de ORD-088-3 și să atingem validarea pickup_time.
  v_blocked := false;
  begin
    perform public.create_order(
      v_rest, 'pickup', null, null, null,
      ('[{"product_id":"' || v_pid || '","quantity":1}]')::jsonb,
      null, null, 'Ion Pickup', '0712345678', null
    );
    raise exception 'CO3 FAIL: pickup fără pickup_time a fost acceptat';
  exception when others then
    if sqlerrm like '%pickup_time%' or sqlerrm like '%Pickup orders require pickup_time%' then
      v_blocked := true;
      raise notice 'CO3 PASS: pickup fără pickup_time respins: %', sqlerrm;
    else
      raise exception 'CO3 FAIL: eroare neașteptată (așteptam missing_pickup_time): %', sqlerrm;
    end if;
  end;
  if not v_blocked then raise exception 'CO3 FAIL: validarea pickup_time absentă'; end if;

  -- ─── CO4: pickup cu telefon invalid → respins (ORD-088-3) ─────
  v_blocked := false;
  begin
    perform public.create_order(
      v_rest, 'pickup', null, null, null,
      ('[{"product_id":"' || v_pid || '","quantity":1}]')::jsonb,
      null, now() + interval '1 hour', 'Ion Pickup', '123', null
    );
    raise exception 'CO4 FAIL: pickup cu telefon invalid a fost acceptat';
  exception when others then
    if sqlerrm like '%customer_phone%' or sqlerrm like '%valid customer_phone%' then
      v_blocked := true;
      raise notice 'CO4 PASS: pickup cu telefon invalid respins: %', sqlerrm;
    else
      raise exception 'CO4 FAIL: eroare neașteptată (așteptam invalid_customer_phone): %', sqlerrm;
    end if;
  end;
  if not v_blocked then raise exception 'CO4 FAIL: validarea telefonului absentă'; end if;

  -- ─── CO5: waiter cu p_qr_token_id non-null → qr_token_id NULL ──
  -- Context waiter: owner autentificat (membership owner creat de bootstrap).
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_res := public.create_order(
    v_rest, 'waiter', v_table, v_tok, null,  -- p_qr_token_id = v_tok (non-null!)
    ('[{"product_id":"' || v_pid || '","quantity":1}]')::jsonb,
    null, null, null, null, null
  );
  v_waiter_oid := (v_res->>'id')::uuid;

  select qr_token_id into v_qtok from public.orders where id = v_waiter_oid;
  if v_qtok is not null then
    raise exception 'CO5 FAIL: comanda waiter are qr_token_id non-null: %', v_qtok;
  end if;
  raise notice 'CO5 PASS: waiter cu p_qr_token_id non-null → rândul are qr_token_id NULL';

  raise notice 'ALL PASS';
end$$;

rollback;

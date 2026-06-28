-- ═══════════════════════════════════════════════════════════════
-- update_order_items — asserțiuni pentru extras (mig 146, #2 + M1)
-- ═══════════════════════════════════════════════════════════════
-- Owner growth + restaurant (membership owner via bootstrap) + produs + extra.
-- Creează o comandă waiter CU extra (total 17 = 12 produs + 5 extra), apoi:
--   UE1 — edit FĂRĂ extra_ids (client legacy) → extras PĂSTRATE, total rămâne 17 (M1);
--   UE2 — edit CU extra_ids explicit → extras aplicate/preț corect, total 17 (#2);
--   UE3 — edit cu extra_ids=[] → extras golite explicit, total scade la 12.
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_owner uuid := '31111111-2222-3333-4444-555555555501'::uuid;
  v_rest  uuid := '31111111-2222-3333-4444-555555555502'::uuid;
  v_table uuid := '31111111-2222-3333-4444-555555555503'::uuid;
  v_pid   uuid;
  v_extra uuid;
  v_gsgl  uuid;  -- grup single
  v_s1 uuid; v_s2 uuid;
  v_res   jsonb;
  v_oid   uuid;
  v_total numeric;
  v_extras_cnt int;
  v_blocked boolean;
begin
  insert into auth.users (id, email) values (v_owner, 'uoi-extras@menuvia.ro');
  update public.profiles set plan = 'growth' where id = v_owner;
  insert into public.restaurants (id, owner_id, name, slug, city, is_active)
    values (v_rest, v_owner, 'UOI Extras R', 'uoi-extras-slug', 'Cluj', true);
  insert into public.tables (id, restaurant_id, name, slug, is_active, seats)
    values (v_table, v_rest, 'Masa 1', 'uoi-masa-1', true, 4);
  insert into public.products (restaurant_id, category_id, name, price, is_active)
    values (v_rest, null, 'Burger', 12.00, true) returning id into v_pid;
  insert into public.product_extras (product_id, name, price, is_available)
    values (v_pid, 'Cartofi', 5.00, true) returning id into v_extra;
  insert into public.modifier_groups (restaurant_id, name, selection_type)
    values (v_rest, 'Gătire', 'single') returning id into v_gsgl;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_gsgl, 'Mediu', 0.00, true) returning id into v_s1;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_gsgl, 'Bine făcut', 0.00, true) returning id into v_s2;
  insert into public.product_modifier_groups (product_id, modifier_group_id)
    values (v_pid, v_gsgl);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- ─── SETUP: comandă waiter cu extra (total 17) ─────────────────
  v_res := public.create_order(
    v_rest, 'waiter', v_table, null, null,
    ('[{"product_id":"' || v_pid || '","quantity":1,"extra_ids":["' || v_extra || '"]}]')::jsonb,
    null, null, null, null, null
  );
  v_oid := (v_res->>'id')::uuid;
  if (v_res->>'total')::numeric is distinct from 17.00 then
    raise exception 'SETUP FAIL: total comandă inițială ar trebui 17.00, e: %', v_res->>'total';
  end if;

  -- ─── UE1: edit FĂRĂ extra_ids → extras păstrate (M1) ───────────
  perform public.update_order_items(
    v_oid,
    ('[{"product_id":"' || v_pid || '","quantity":1}]')::jsonb,
    null
  );
  select total into v_total from public.orders where id = v_oid;
  select count(*) into v_extras_cnt
    from public.order_items oi, jsonb_array_elements(oi.extras_added) e
   where oi.order_id = v_oid;
  if v_total is distinct from 17.00 then
    raise exception 'UE1 FAIL: total ar trebui 17.00 (extras păstrate), e: %', v_total;
  end if;
  if v_extras_cnt < 1 then
    raise exception 'UE1 FAIL: extras_added a fost pierdut la edit fără extra_ids';
  end if;
  raise notice 'UE1 PASS: edit fără extra_ids → extras păstrate, total=17.00 (M1)';

  -- ─── UE2: edit CU extra_ids explicit → preț corect (#2) ────────
  perform public.update_order_items(
    v_oid,
    ('[{"product_id":"' || v_pid || '","quantity":1,"extra_ids":["' || v_extra || '"]}]')::jsonb,
    null
  );
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 17.00 then
    raise exception 'UE2 FAIL: total ar trebui 17.00 (extra aplicat), e: %', v_total;
  end if;
  raise notice 'UE2 PASS: edit cu extra_ids → total=17.00 (#2)';

  -- ─── UE3: edit cu extra_ids=[] → extras golite, total 12 ───────
  perform public.update_order_items(
    v_oid,
    ('[{"product_id":"' || v_pid || '","quantity":1,"extra_ids":[]}]')::jsonb,
    null
  );
  select total into v_total from public.orders where id = v_oid;
  select count(*) into v_extras_cnt
    from public.order_items oi, jsonb_array_elements(oi.extras_added) e
   where oi.order_id = v_oid;
  if v_total is distinct from 12.00 then
    raise exception 'UE3 FAIL: total ar trebui 12.00 (extras golite), e: %', v_total;
  end if;
  if v_extras_cnt <> 0 then
    raise exception 'UE3 FAIL: extras_added ar trebui golit, găsite: %', v_extras_cnt;
  end if;
  raise notice 'UE3 PASS: edit cu extra_ids=[] → extras golite, total=12.00';

  -- ─── UE4: grup single cu 2 opțiuni → respins (oglindă create_order #9) ──
  v_blocked := false;
  begin
    perform public.update_order_items(
      v_oid,
      ('[{"product_id":"' || v_pid || '","quantity":1,"option_ids":["' || v_s1 || '","' || v_s2 || '"]}]')::jsonb,
      null
    );
  exception when others then
    if sqlerrm like '%prea multe%' or sqlerrm like '%too_many%' then
      v_blocked := true;
      raise notice 'UE4 PASS: grup single cu 2 opțiuni respins la editare: %', sqlerrm;
    else
      raise exception 'UE4 FAIL: eroare neașteptată (așteptam too_many_in_group): %', sqlerrm;
    end if;
  end;
  if not v_blocked then raise exception 'UE4 FAIL: editarea a acceptat 2 opțiuni într-un grup single'; end if;

  -- ─── UE5: comandă 'closed' nu poate fi editată (anti edit post-decontare) ──
  update public.orders set status = 'closed' where id = v_oid;
  v_blocked := false;
  begin
    perform public.update_order_items(
      v_oid,
      ('[{"product_id":"' || v_pid || '","quantity":1}]')::jsonb,
      null
    );
  exception when others then
    if sqlerrm like '%terminal%' then
      v_blocked := true;
      raise notice 'UE5 PASS: editarea unei comenzi closed respinsă: %', sqlerrm;
    else
      raise exception 'UE5 FAIL: eroare neașteptată (așteptam terminal state): %', sqlerrm;
    end if;
  end;
  if not v_blocked then raise exception 'UE5 FAIL: comanda closed a fost editabilă (divergență bon)'; end if;

  raise notice 'ALL PASS';
end$$;

rollback;

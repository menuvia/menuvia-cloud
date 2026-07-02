-- ═══════════════════════════════════════════════════════════════
-- create_order + update_order_items — minim per grup (mig 191 + 192)
-- ═══════════════════════════════════════════════════════════════
-- Self-contained: owner growth + restaurant (membership owner via bootstrap)
-- + masă + 4 produse, fiecare cu propriul grup de modificatori:
--   • Pizza    → grup 'Blat'    (multiple, is_required, min_select=2, r1/r2/r3);
--   • Salată   → grup 'Dressing'(multiple, min_select=1 FĂRĂ is_required, m1);
--   • Limonadă → grup 'Gheață'  (multiple, pur opțional: min 0, ne-required, p1);
--   • Friptură → grup 'Gătire'  (single, min_select=3 MISCONFIGURAT, s1/s2).
-- Comenzile sunt 'waiter' (fără sesiune QR) ca owner autenticat. Verifică:
--   GM1 — create_order Pizza cu 1 opțiune (< min 2) → respins,
--          hint = 'missing_required_group';
--   GM2 — create_order Pizza cu 2 opțiuni → trece, total corect;
--   GM3 — create_order Salată fără opțiuni (min_select=1, ne-required) → respins
--          (minimul contează și fără is_required);
--   GM4 — create_order Limonadă fără opțiuni (grup pur opțional) → trece;
--   GM5 — update_order_items care golește grupul obligatoriu (option_ids=[])
--          → respins, hint = 'missing_required_group';
--   GM6 — update_order_items valid (2 opțiuni, în interval) → trece, total corect;
--   GM7 — create_order Friptură cu 1 opțiune pe single cu min_select=3
--          → trece (minimul efectiv e plafonat la 1 pe selection_type='single').
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_owner uuid := '41111111-2222-3333-4444-555555555501'::uuid;
  v_rest  uuid := '41111111-2222-3333-4444-555555555502'::uuid;
  v_table uuid := '41111111-2222-3333-4444-555555555503'::uuid;
  v_p_req uuid;  -- Pizza (grup required min 2)
  v_p_min uuid;  -- Salată (grup min_select=1 fără is_required)
  v_p_opt uuid;  -- Limonadă (grup pur opțional)
  v_p_sgl uuid;  -- Friptură (single misconfigurat min_select=3)
  v_g_req uuid; v_g_min uuid; v_g_opt uuid; v_g_sgl uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid;
  v_m1 uuid; v_o1 uuid; v_s1 uuid; v_s2 uuid;
  v_res   jsonb;
  v_oid   uuid;
  v_total numeric;
  v_hint  text;
  v_blocked boolean;
begin
  -- ─── SETUP ────────────────────────────────────────────────────
  insert into auth.users (id, email) values (v_owner, 'group-min@menuvia.ro');
  update public.profiles set plan = 'growth' where id = v_owner;
  insert into public.restaurants (id, owner_id, name, slug, city, is_active)
    values (v_rest, v_owner, 'Group Min R', 'group-min-slug', 'Cluj', true);
  insert into public.tables (id, restaurant_id, name, slug, is_active, seats)
    values (v_table, v_rest, 'Masa 1', 'gm-masa-1', true, 4);

  insert into public.products (restaurant_id, category_id, name, price, is_active)
    values (v_rest, null, 'Pizza', 20.00, true) returning id into v_p_req;
  insert into public.products (restaurant_id, category_id, name, price, is_active)
    values (v_rest, null, 'Salată', 15.00, true) returning id into v_p_min;
  insert into public.products (restaurant_id, category_id, name, price, is_active)
    values (v_rest, null, 'Limonadă', 10.00, true) returning id into v_p_opt;
  insert into public.products (restaurant_id, category_id, name, price, is_active)
    values (v_rest, null, 'Friptură', 30.00, true) returning id into v_p_sgl;

  -- Grup OBLIGATORIU cu minim 2 (multiple, is_required, min_select=2).
  insert into public.modifier_groups (restaurant_id, name, selection_type, is_required, min_select)
    values (v_rest, 'Blat', 'multiple', true, 2) returning id into v_g_req;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_req, 'Subțire', 2.00, true) returning id into v_r1;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_req, 'Pufos', 3.00, true) returning id into v_r2;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_req, 'Integral', 0.00, true) returning id into v_r3;
  insert into public.product_modifier_groups (product_id, modifier_group_id)
    values (v_p_req, v_g_req);

  -- Grup cu min_select=1 dar FĂRĂ is_required — minimul contează singur (GM3).
  insert into public.modifier_groups (restaurant_id, name, selection_type, is_required, min_select)
    values (v_rest, 'Dressing', 'multiple', false, 1) returning id into v_g_min;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_min, 'Iaurt', 0.00, true) returning id into v_m1;
  insert into public.product_modifier_groups (product_id, modifier_group_id)
    values (v_p_min, v_g_min);

  -- Grup PUR OPȚIONAL (min 0, ne-required) — gol trebuie să TREACĂ (GM4).
  insert into public.modifier_groups (restaurant_id, name, selection_type, is_required, min_select)
    values (v_rest, 'Gheață', 'multiple', false, 0) returning id into v_g_opt;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_opt, 'Fără gheață', 0.00, true) returning id into v_o1;
  insert into public.product_modifier_groups (product_id, modifier_group_id)
    values (v_p_opt, v_g_opt);

  -- Grup SINGLE misconfigurat: min_select=3 pe selection_type='single'. Fix #9
  -- (mig 145) impune ≤1 pe single, deci fără plafonarea minimului la 1 produsul
  -- ar deveni necomandabil. Minimul efectiv trebuie să fie 1 (GM7).
  insert into public.modifier_groups (restaurant_id, name, selection_type, is_required, min_select)
    values (v_rest, 'Gătire', 'single', true, 3) returning id into v_g_sgl;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_sgl, 'Mediu', 0.00, true) returning id into v_s1;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_sgl, 'Bine făcut', 0.00, true) returning id into v_s2;
  insert into public.product_modifier_groups (product_id, modifier_group_id)
    values (v_p_sgl, v_g_sgl);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- ─── GM1: required min 2 cu 1 opțiune → respins (missing_required_group) ──
  v_blocked := false;
  begin
    perform public.create_order(
      v_rest, 'waiter', v_table, null, null,
      ('[{"product_id":"' || v_p_req || '","quantity":1,"option_ids":["' || v_r1 || '"]}]')::jsonb,
      null, null, null, null, null
    );
  exception when others then
    get stacked diagnostics v_hint := pg_exception_hint;
    if v_hint = 'missing_required_group' then
      v_blocked := true;
      raise notice 'GM1 PASS: 1 opțiune sub min_select=2 respinsă: %', sqlerrm;
    else
      raise exception 'GM1 FAIL: eroare neașteptată (hint=%, așteptam missing_required_group): %', v_hint, sqlerrm;
    end if;
  end;
  if not v_blocked then raise exception 'GM1 FAIL: create_order a acceptat 1 opțiune într-un grup required cu min 2'; end if;

  -- ─── GM2: required min 2 cu 2 opțiuni → trece, total corect ───
  v_res := public.create_order(
    v_rest, 'waiter', v_table, null, null,
    ('[{"product_id":"' || v_p_req || '","quantity":1,"option_ids":["' || v_r1 || '","' || v_r2 || '"]}]')::jsonb,
    null, null, null, null, null
  );
  v_oid := (v_res->>'id')::uuid;
  if (v_res->>'total')::numeric is distinct from 25.00 then
    raise exception 'GM2 FAIL: total ar trebui 25.00 (20 + 2 + 3), e: %', v_res->>'total';
  end if;
  raise notice 'GM2 PASS: 2 opțiuni la min_select=2 acceptate, total=25.00';

  -- ─── GM3: min_select=1 FĂRĂ is_required, gol → respins ────────
  v_blocked := false;
  begin
    perform public.create_order(
      v_rest, 'waiter', v_table, null, null,
      ('[{"product_id":"' || v_p_min || '","quantity":1}]')::jsonb,
      null, null, null, null, null
    );
  exception when others then
    get stacked diagnostics v_hint := pg_exception_hint;
    if v_hint = 'missing_required_group' then
      v_blocked := true;
      raise notice 'GM3 PASS: grup gol cu min_select=1 (ne-required) respins: %', sqlerrm;
    else
      raise exception 'GM3 FAIL: eroare neașteptată (hint=%, așteptam missing_required_group): %', v_hint, sqlerrm;
    end if;
  end;
  if not v_blocked then raise exception 'GM3 FAIL: min_select=1 nu e impus fără is_required'; end if;

  -- ─── GM4: grup pur opțional gol → trece ───────────────────────
  v_res := public.create_order(
    v_rest, 'waiter', v_table, null, null,
    ('[{"product_id":"' || v_p_opt || '","quantity":1}]')::jsonb,
    null, null, null, null, null
  );
  if (v_res->>'total')::numeric is distinct from 10.00 then
    raise exception 'GM4 FAIL: total ar trebui 10.00, e: %', v_res->>'total';
  end if;
  raise notice 'GM4 PASS: grup pur opțional gol acceptat, total=10.00';

  -- ─── GM5: editare care golește grupul obligatoriu → respins ───
  -- Pe comanda validă din GM2 (2 opțiuni), option_ids=[] ar goli grupul 'Blat'.
  v_blocked := false;
  begin
    perform public.update_order_items(
      v_oid,
      ('[{"product_id":"' || v_p_req || '","quantity":1,"option_ids":[]}]')::jsonb,
      null
    );
  exception when others then
    get stacked diagnostics v_hint := pg_exception_hint;
    if v_hint = 'missing_required_group' then
      v_blocked := true;
      raise notice 'GM5 PASS: editarea care golește grupul obligatoriu respinsă: %', sqlerrm;
    else
      raise exception 'GM5 FAIL: eroare neașteptată (hint=%, așteptam missing_required_group): %', v_hint, sqlerrm;
    end if;
  end;
  if not v_blocked then raise exception 'GM5 FAIL: update_order_items a golit un grup obligatoriu'; end if;

  -- Comanda originală rămâne intactă după respingere (edit atomic).
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 25.00 then
    raise exception 'GM5 FAIL: totalul comenzii s-a schimbat după edit respins (e: %)', v_total;
  end if;

  -- ─── GM6: editare validă în interval (2 opțiuni, qty 2) → trece ──
  perform public.update_order_items(
    v_oid,
    ('[{"product_id":"' || v_p_req || '","quantity":2,"option_ids":["' || v_r1 || '","' || v_r3 || '"]}]')::jsonb,
    null
  );
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 44.00 then
    raise exception 'GM6 FAIL: total ar trebui 44.00 ((20 + 2 + 0) × 2), e: %', v_total;
  end if;
  raise notice 'GM6 PASS: editare validă cu 2 opțiuni acceptată, total=44.00';

  -- ─── GM7: single cu min_select=3 misconfigurat → 1 opțiune ajunge ──
  v_res := public.create_order(
    v_rest, 'waiter', v_table, null, null,
    ('[{"product_id":"' || v_p_sgl || '","quantity":1,"option_ids":["' || v_s1 || '"]}]')::jsonb,
    null, null, null, null, null
  );
  if (v_res->>'total')::numeric is distinct from 30.00 then
    raise exception 'GM7 FAIL: total ar trebui 30.00, e: %', v_res->>'total';
  end if;
  raise notice 'GM7 PASS: single cu min_select=3 acceptă 1 opțiune (minim plafonat la 1)';

  raise notice 'ALL PASS';
end$$;

rollback;

-- ═══════════════════════════════════════════════════════════════
-- create_order — asserțiuni pentru fix-urile mig 145 (#3 / #1 / #9)
-- ═══════════════════════════════════════════════════════════════
-- Self-contained: owner growth + restaurant + masă + qr_token + sesiune open +
-- produs + product_extras + modifier_groups (multiple max_select=2, multiple
-- max_select NULL, single) + opțiuni. Verifică:
--   EX1 — comandă cu extras → succes, total include prețul extra-ului (#3);
--   EX2 — option_ids DUPLICATE → respins `duplicate_options` (#1);
--   EX3 — depășire max_select pe grup multiple → respins `too_many_in_group` (#9);
--   EX4 — max_select NULL (nelimitat) → TRECE (#9);
--   EX5 — grup `single` cu 2 opțiuni → respins `too_many_in_group` (#9);
--   EX6 — create_order are EXACT 1 overload (B1).
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_owner uuid := '21111111-2222-3333-4444-555555555501'::uuid;
  v_rest  uuid := '21111111-2222-3333-4444-555555555502'::uuid;
  v_table uuid := '21111111-2222-3333-4444-555555555503'::uuid;
  v_tok   uuid := '21111111-2222-3333-4444-555555555504'::uuid;
  v_token text := 'extras-options-' || extract(epoch from now())::bigint;
  v_pid   uuid;
  v_extra uuid;
  v_g_lim uuid;  -- multiple, max_select=2
  v_g_unl uuid;  -- multiple, max_select NULL
  v_g_sgl uuid;  -- single
  v_a uuid; v_b uuid; v_c uuid;     -- în v_g_lim
  v_d uuid; v_e uuid; v_f uuid;     -- în v_g_unl
  v_s1 uuid; v_s2 uuid;             -- în v_g_sgl
  v_sess jsonb; v_sid uuid;
  v_res jsonb; v_oid uuid;
  v_count int;
  v_blocked boolean;
begin
  -- ─── SETUP ────────────────────────────────────────────────────
  insert into auth.users (id, email) values (v_owner, 'extras-options@menuvia.ro');
  update public.profiles set plan = 'growth' where id = v_owner;

  insert into public.restaurants (id, owner_id, name, slug, city, is_active)
    values (v_rest, v_owner, 'Extras Options R', 'extras-options-slug', 'Cluj', true);
  insert into public.tables (id, restaurant_id, name, slug, is_active, seats)
    values (v_table, v_rest, 'Masa 1', 'eo-masa-1', true, 4);
  insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active)
    values (v_tok, v_rest, v_table, v_token, true);
  insert into public.products (restaurant_id, category_id, name, price, is_active)
    values (v_rest, null, 'Burger', 12.00, true) returning id into v_pid;

  insert into public.product_extras (product_id, name, price, is_available)
    values (v_pid, 'Cartofi', 5.00, true) returning id into v_extra;

  -- grup multiple, plafon 2
  insert into public.modifier_groups (restaurant_id, name, selection_type, max_select)
    values (v_rest, 'Toppinguri', 'multiple', 2) returning id into v_g_lim;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_lim, 'Ceapă', 1.00, true) returning id into v_a;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_lim, 'Cașcaval', 1.00, true) returning id into v_b;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_lim, 'Bacon', 1.00, true) returning id into v_c;

  -- grup multiple, max_select NULL (nelimitat)
  insert into public.modifier_groups (restaurant_id, name, selection_type, max_select)
    values (v_rest, 'Sosuri', 'multiple', null) returning id into v_g_unl;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_unl, 'Ketchup', 0.00, true) returning id into v_d;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_unl, 'Maioneză', 0.00, true) returning id into v_e;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_unl, 'Muștar', 0.00, true) returning id into v_f;

  -- grup single
  insert into public.modifier_groups (restaurant_id, name, selection_type)
    values (v_rest, 'Gătire', 'single') returning id into v_g_sgl;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_sgl, 'Mediu', 0.00, true) returning id into v_s1;
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available)
    values (v_g_sgl, 'Bine făcut', 0.00, true) returning id into v_s2;

  insert into public.product_modifier_groups (product_id, modifier_group_id)
    values (v_pid, v_g_lim), (v_pid, v_g_unl), (v_pid, v_g_sgl);

  perform set_config('request.jwt.claim.role', 'anon', true);

  -- ─── EX1: comandă cu extras → succes, total include extra (#3) ──
  v_sess := public.open_table_session(v_token);
  v_sid  := (v_sess->>'session_id')::uuid;

  v_res := public.create_order(
    v_rest, 'qr', v_table, v_tok, null,
    ('[{"product_id":"' || v_pid || '","quantity":1,"extra_ids":["' || v_extra || '"]}]')::jsonb,
    null, null, null, null, v_sid
  );
  v_oid := (v_res->>'id')::uuid;
  if v_oid is null then raise exception 'EX1 FAIL: comanda cu extras nu a returnat id'; end if;
  if (v_res->>'total')::numeric is distinct from 17.00 then
    raise exception 'EX1 FAIL: total așteptat 17.00 (12 produs + 5 extra), e: %', v_res->>'total';
  end if;
  raise notice 'EX1 PASS: comandă cu extras creată, total=17.00 (#3)';

  -- ─── EX2: option_ids DUPLICATE → respins (#1) ──────────────────
  v_blocked := false;
  begin
    perform public.create_order(
      v_rest, 'qr', v_table, v_tok, null,
      ('[{"product_id":"' || v_pid || '","quantity":1,"option_ids":["' || v_a || '","' || v_a || '"]}]')::jsonb,
      null, null, null, null, v_sid
    );
  exception when others then
    if sqlerrm like '%duplicate%' or sqlerrm like '%duplicat%' then
      v_blocked := true;
      raise notice 'EX2 PASS: option_ids duplicate respinse: %', sqlerrm;
    else
      raise exception 'EX2 FAIL: eroare neașteptată (așteptam duplicate_options): %', sqlerrm;
    end if;
  end;
  if not v_blocked then raise exception 'EX2 FAIL: option_ids duplicate acceptate (furt posibil)'; end if;

  -- ─── EX3: depășire max_select grup multiple → respins (#9) ──────
  v_blocked := false;
  begin
    perform public.create_order(
      v_rest, 'qr', v_table, v_tok, null,
      ('[{"product_id":"' || v_pid || '","quantity":1,"option_ids":["'
        || v_a || '","' || v_b || '","' || v_c || '"]}]')::jsonb,
      null, null, null, null, v_sid
    );
  exception when others then
    if sqlerrm like '%Prea multe%' or sqlerrm like '%too_many%' then
      v_blocked := true;
      raise notice 'EX3 PASS: depășire max_select (2) respinsă: %', sqlerrm;
    else
      raise exception 'EX3 FAIL: eroare neașteptată (așteptam too_many_in_group): %', sqlerrm;
    end if;
  end;
  if not v_blocked then raise exception 'EX3 FAIL: 3 opțiuni într-un grup max_select=2 acceptate'; end if;

  -- ─── EX4: max_select NULL (nelimitat) → TRECE (#9) ─────────────
  v_res := public.create_order(
    v_rest, 'qr', v_table, v_tok, null,
    ('[{"product_id":"' || v_pid || '","quantity":1,"option_ids":["'
      || v_d || '","' || v_e || '","' || v_f || '"]}]')::jsonb,
    null, null, null, null, v_sid
  );
  if (v_res->>'id') is null then
    raise exception 'EX4 FAIL: grup cu max_select NULL ar trebui să accepte 3 opțiuni';
  end if;
  raise notice 'EX4 PASS: max_select NULL acceptă 3 opțiuni (#9)';

  -- ─── EX5: grup single cu 2 opțiuni → respins (#9) ──────────────
  v_blocked := false;
  begin
    perform public.create_order(
      v_rest, 'qr', v_table, v_tok, null,
      ('[{"product_id":"' || v_pid || '","quantity":1,"option_ids":["'
        || v_s1 || '","' || v_s2 || '"]}]')::jsonb,
      null, null, null, null, v_sid
    );
  exception when others then
    if sqlerrm like '%Prea multe%' or sqlerrm like '%too_many%' then
      v_blocked := true;
      raise notice 'EX5 PASS: grup single cu 2 opțiuni respins: %', sqlerrm;
    else
      raise exception 'EX5 FAIL: eroare neașteptată (așteptam too_many_in_group): %', sqlerrm;
    end if;
  end;
  if not v_blocked then raise exception 'EX5 FAIL: grup single a acceptat 2 opțiuni'; end if;

  -- ─── EX7: extra_ids DUPLICATE → respins ────────────────────────
  v_blocked := false;
  begin
    perform public.create_order(
      v_rest, 'qr', v_table, v_tok, null,
      ('[{"product_id":"' || v_pid || '","quantity":1,"extra_ids":["' || v_extra || '","' || v_extra || '"]}]')::jsonb,
      null, null, null, null, v_sid
    );
  exception when others then
    if sqlerrm like '%uplicate%' then
      v_blocked := true;
      raise notice 'EX7 PASS: extra_ids duplicate respinse: %', sqlerrm;
    else
      raise exception 'EX7 FAIL: eroare neașteptată (așteptam duplicate_extras): %', sqlerrm;
    end if;
  end;
  if not v_blocked then raise exception 'EX7 FAIL: extra_ids duplicate acceptate (dublă-numărare)'; end if;

  -- ─── EX6: exact 1 overload create_order (B1) ───────────────────
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';
  if v_count <> 1 then
    raise exception 'EX6 FAIL: create_order are % overload-uri (așteptat 1)', v_count;
  end if;
  raise notice 'EX6 PASS: create_order are exact 1 overload';

  raise notice 'ALL PASS';
end$$;

rollback;

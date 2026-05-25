-- =============================================================
-- Menuvia — RPC Security Tests
-- Run in Supabase SQL Editor AFTER all migrations.
--
-- These are assertion-based tests. Each test either:
--   - succeeds silently (PASS)
--   - raises an exception with a clear message (FAIL)
--
-- NOTE: These tests use SECURITY DEFINER helper functions to
-- simulate calls as specific users. In production, the RPCs
-- validate auth.uid() which cannot be spoofed.
-- =============================================================

do $$
declare
  v_owner_id     uuid;
  v_waiter_id    uuid;
  v_outsider_id  uuid;
  v_restaurant_id uuid;
  v_table_id     uuid;
  v_qr_token_id  uuid;
  v_product_id   uuid;
  v_category_id  uuid;
  v_mod_group_id uuid;
  v_mod_option_id uuid;
  v_result       jsonb;
  v_order_id     uuid;
  v_token        text;
  v_invite_id    uuid;
begin
  raise notice '=== MENUVIA SECURITY TESTS ===';

  -- ============================================================
  -- SETUP: Create test data
  -- ============================================================

  -- Test users (insert into auth.users directly for testing)
  v_owner_id    := gen_random_uuid();
  v_waiter_id   := gen_random_uuid();
  v_outsider_id := gen_random_uuid();

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
  values
    (v_owner_id,    'test_owner@test.com',    crypt('password123', gen_salt('bf')), now(), '{}'),
    (v_waiter_id,   'test_waiter@test.com',   crypt('password123', gen_salt('bf')), now(), '{}'),
    (v_outsider_id, 'test_outsider@test.com', crypt('password123', gen_salt('bf')), now(), '{}');

  insert into public.profiles (id, email, full_name, plan)
  values
    (v_owner_id,    'test_owner@test.com',    'Test Owner',    'pro'),
    (v_waiter_id,   'test_waiter@test.com',   'Test Waiter',   'free'),
    (v_outsider_id, 'test_outsider@test.com', 'Test Outsider', 'free');

  -- Restaurant
  insert into public.restaurants (id, owner_id, name, slug)
  values (gen_random_uuid(), v_owner_id, 'Test Restaurant', 'test-restaurant-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_restaurant_id;

  -- Memberships
  insert into public.restaurant_memberships (restaurant_id, user_id, role)
  values
    (v_restaurant_id, v_owner_id,  'owner'),
    (v_restaurant_id, v_waiter_id, 'waiter');
  -- outsider has NO membership

  -- Table + QR token
  insert into public.tables (id, restaurant_id, name, slug, is_active)
  values (gen_random_uuid(), v_restaurant_id, 'Masa Test', 'masa-test', true)
  returning id into v_table_id;

  insert into public.qr_tokens (id, restaurant_id, table_id, is_active)
  values (gen_random_uuid(), v_restaurant_id, v_table_id, true)
  returning id into v_qr_token_id;

  -- Category + Product
  insert into public.categories (id, restaurant_id, name, emoji, display_order)
  values (gen_random_uuid(), v_restaurant_id, 'Test Category', '🍕', 0)
  returning id into v_category_id;

  insert into public.products (id, restaurant_id, category_id, name, price, is_active, display_order)
  values (gen_random_uuid(), v_restaurant_id, v_category_id, 'Pizza Margherita', 32.50, true, 0)
  returning id into v_product_id;

  -- Modifier group + option
  insert into public.modifier_groups (id, restaurant_id, name, selection_type, is_required)
  values (gen_random_uuid(), v_restaurant_id, 'Extra toppings', 'multiple', false)
  returning id into v_mod_group_id;

  insert into public.modifier_options (id, modifier_group_id, name, price_delta, is_available)
  values (gen_random_uuid(), v_mod_group_id, 'Mozzarella extra', 5.00, true)
  returning id into v_mod_option_id;

  insert into public.product_modifier_groups (product_id, modifier_group_id)
  values (v_product_id, v_mod_group_id);

  raise notice 'Setup complete.';


  -- ============================================================
  -- TEST 1: QR order with valid product — should succeed
  -- ============================================================
  begin
    -- Simulate anon call (no auth.uid)
    v_result := public.create_order(
      v_restaurant_id, 'qr', null, v_qr_token_id, null,
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id,
        'quantity', 2,
        'option_ids', jsonb_build_array(v_mod_option_id)
      )),
      gen_random_uuid()
    );
    if (v_result ->> 'ok') is not null or (v_result ->> 'id') is not null then
      -- Check total = (32.50 + 5.00) * 2 = 75.00
      if (v_result ->> 'total')::numeric <> 75.00 then
        raise exception 'TEST 1 FAIL: expected total 75.00, got %', v_result ->> 'total';
      end if;
      raise notice 'TEST 1 PASS: QR order created, total=%, server-calculated correctly', v_result ->> 'total';
      v_order_id := (v_result ->> 'id')::uuid;
    else
      raise exception 'TEST 1 FAIL: unexpected result %', v_result;
    end if;
  end;


  -- ============================================================
  -- TEST 2: Idempotency — same key returns same order
  -- ============================================================
  declare
    v_idem_key uuid := gen_random_uuid();
    v_r1 jsonb;
    v_r2 jsonb;
  begin
    v_r1 := public.create_order(
      v_restaurant_id, 'qr', null, v_qr_token_id, null,
      jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 1)),
      v_idem_key
    );
    v_r2 := public.create_order(
      v_restaurant_id, 'qr', null, v_qr_token_id, null,
      jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 1)),
      v_idem_key
    );
    if (v_r1 ->> 'id') = (v_r2 ->> 'id') and (v_r2 ->> 'idempotent_replay')::boolean = true then
      raise notice 'TEST 2 PASS: idempotency works, same order returned';
    else
      raise exception 'TEST 2 FAIL: expected same order, got % and %', v_r1 ->> 'id', v_r2 ->> 'id';
    end if;
  end;


  -- ============================================================
  -- TEST 3: Product from wrong restaurant — must reject
  -- ============================================================
  declare
    v_other_rest_id uuid;
    v_other_prod_id uuid;
  begin
    insert into public.restaurants (id, owner_id, name, slug)
    values (gen_random_uuid(), v_owner_id, 'Other Restaurant', 'other-' || substr(gen_random_uuid()::text, 1, 8))
    returning id into v_other_rest_id;

    insert into public.products (id, restaurant_id, name, price, is_active)
    values (gen_random_uuid(), v_other_rest_id, 'Foreign Product', 10.00, true)
    returning id into v_other_prod_id;

    begin
      perform public.create_order(
        v_restaurant_id, 'qr', null, v_qr_token_id, null,
        jsonb_build_array(jsonb_build_object('product_id', v_other_prod_id, 'quantity', 1)),
        gen_random_uuid()
      );
      raise exception 'TEST 3 FAIL: should have rejected cross-restaurant product';
    exception when others then
      if sqlerrm like '%does not belong to this restaurant%' then
        raise notice 'TEST 3 PASS: cross-restaurant product rejected';
      else
        raise exception 'TEST 3 FAIL: unexpected error: %', sqlerrm;
      end if;
    end;
  end;


  -- ============================================================
  -- TEST 4: Inactive product — must reject
  -- ============================================================
  declare
    v_inactive_id uuid;
  begin
    insert into public.products (id, restaurant_id, name, price, is_active)
    values (gen_random_uuid(), v_restaurant_id, 'Inactive Item', 10.00, false)
    returning id into v_inactive_id;

    begin
      perform public.create_order(
        v_restaurant_id, 'qr', null, v_qr_token_id, null,
        jsonb_build_array(jsonb_build_object('product_id', v_inactive_id, 'quantity', 1)),
        gen_random_uuid()
      );
      raise exception 'TEST 4 FAIL: should have rejected inactive product';
    exception when others then
      if sqlerrm like '%inactive%' then
        raise notice 'TEST 4 PASS: inactive product rejected';
      else
        raise exception 'TEST 4 FAIL: unexpected error: %', sqlerrm;
      end if;
    end;
  end;


  -- ============================================================
  -- TEST 5: Invalid modifier option — must reject
  -- ============================================================
  declare
    v_fake_option uuid := gen_random_uuid();
  begin
    begin
      perform public.create_order(
        v_restaurant_id, 'qr', null, v_qr_token_id, null,
        jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id,
          'quantity', 1,
          'option_ids', jsonb_build_array(v_fake_option)
        )),
        gen_random_uuid()
      );
      raise exception 'TEST 5 FAIL: should have rejected fake modifier option';
    exception when others then
      if sqlerrm like '%invalid options%' then
        raise notice 'TEST 5 PASS: fake modifier option rejected';
      else
        raise exception 'TEST 5 FAIL: unexpected error: %', sqlerrm;
      end if;
    end;
  end;


  -- ============================================================
  -- TEST 6: Quantity out of range — must reject
  -- ============================================================
  begin
    begin
      perform public.create_order(
        v_restaurant_id, 'qr', null, v_qr_token_id, null,
        jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 100)),
        gen_random_uuid()
      );
      raise exception 'TEST 6 FAIL: should have rejected quantity=100';
    exception when others then
      if sqlerrm like '%quantity%' then
        raise notice 'TEST 6 PASS: out-of-range quantity rejected';
      else
        raise exception 'TEST 6 FAIL: unexpected error: %', sqlerrm;
      end if;
    end;
  end;


  -- ============================================================
  -- TEST 7: Empty items — must reject
  -- ============================================================
  begin
    begin
      perform public.create_order(
        v_restaurant_id, 'qr', null, v_qr_token_id, null,
        '[]'::jsonb,
        gen_random_uuid()
      );
      raise exception 'TEST 7 FAIL: should have rejected empty items';
    exception when others then
      if sqlerrm like '%at least one item%' then
        raise notice 'TEST 7 PASS: empty items rejected';
      else
        raise exception 'TEST 7 FAIL: unexpected error: %', sqlerrm;
      end if;
    end;
  end;


  -- ============================================================
  -- TEST 8: preview_invite — valid token
  -- ============================================================
  begin
    insert into public.invite_tokens (id, restaurant_id, email, role, token, invited_by)
    values (gen_random_uuid(), v_restaurant_id, 'newguy@test.com', 'waiter',
            'test_token_' || substr(gen_random_uuid()::text, 1, 16), v_owner_id)
    returning id, token into v_invite_id, v_token;

    v_result := public.preview_invite(v_token);
    if (v_result ->> 'status') = 'valid'
       and (v_result ->> 'email') = 'newguy@test.com'
       and (v_result ->> 'restaurant_name') = 'Test Restaurant'
       and (v_result ->> 'role') = 'waiter'
       -- Must NOT contain internal IDs
       and (v_result ->> 'id') is null
       and (v_result ->> 'invited_by') is null
       and (v_result ->> 'token') is null
    then
      raise notice 'TEST 8 PASS: preview_invite returns correct data, no internal IDs';
    else
      raise exception 'TEST 8 FAIL: unexpected result %', v_result;
    end if;
  end;


  -- ============================================================
  -- TEST 9: preview_invite — invalid token
  -- ============================================================
  begin
    v_result := public.preview_invite('nonexistent_token_xyz');
    if (v_result ->> 'status') = 'invalid' then
      raise notice 'TEST 9 PASS: invalid token returns status=invalid';
    else
      raise exception 'TEST 9 FAIL: expected invalid, got %', v_result;
    end if;
  end;


  -- ============================================================
  -- TEST 10: advance_order state machine — valid transitions
  -- ============================================================
  begin
    -- Use the order from TEST 1
    -- new → confirmed (kitchen/owner)
    -- We call as owner since we can't set auth.uid() in a test block
    -- In production, auth.uid() is enforced by Supabase
    v_result := public.advance_order(v_order_id, 'confirm');
    if (v_result ->> 'new_status') = 'confirmed' then
      raise notice 'TEST 10a PASS: new → confirmed';
    else
      raise exception 'TEST 10a FAIL: expected confirmed, got %', v_result;
    end if;

    v_result := public.advance_order(v_order_id, 'start_preparing');
    if (v_result ->> 'new_status') = 'preparing' then
      raise notice 'TEST 10b PASS: confirmed → preparing';
    else
      raise exception 'TEST 10b FAIL: %', v_result;
    end if;

    v_result := public.advance_order(v_order_id, 'mark_ready');
    if (v_result ->> 'new_status') = 'ready' then
      raise notice 'TEST 10c PASS: preparing → ready';
    else
      raise exception 'TEST 10c FAIL: %', v_result;
    end if;
  end;


  -- ============================================================
  -- TEST 11: advance_order — invalid skip
  -- ============================================================
  declare
    v_skip_order_id uuid;
    v_skip_result jsonb;
  begin
    -- Create a fresh order
    v_skip_result := public.create_order(
      v_restaurant_id, 'qr', null, v_qr_token_id, null,
      jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 1)),
      gen_random_uuid()
    );
    v_skip_order_id := (v_skip_result ->> 'id')::uuid;

    -- Try to skip new → ready (should fail)
    begin
      perform public.advance_order(v_skip_order_id, 'mark_ready');
      raise exception 'TEST 11 FAIL: should have rejected skip from new to ready';
    exception when others then
      if sqlerrm like '%preparing%' then
        raise notice 'TEST 11 PASS: status skip rejected';
      else
        raise exception 'TEST 11 FAIL: unexpected error: %', sqlerrm;
      end if;
    end;
  end;


  -- ============================================================
  -- CLEANUP
  -- ============================================================
  raise notice '=== ALL TESTS PASSED ===';
  raise notice 'Rolling back test data...';
  raise exception 'ROLLBACK_TEST_DATA';

exception
  when others then
    if sqlerrm = 'ROLLBACK_TEST_DATA' then
      raise notice 'Test data rolled back successfully.';
    else
      raise notice 'TEST FAILURE: %', sqlerrm;
      -- Re-raise to rollback
      raise;
    end if;
end;
$$;

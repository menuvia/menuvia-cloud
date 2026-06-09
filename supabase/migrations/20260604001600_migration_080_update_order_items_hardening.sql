-- Migration 080: hardening pe update_order_items + audit order_items + happy hour re-eval
-- ─────────────────────────────────────────────────────────────────────
-- Rezolvă 3 probleme identificate la code review post-mig 079:
--
-- 1. P0 — Race condition TOCTOU
--    update_order_items verifică status, apoi face DELETE+INSERT fără lock.
--    Între ele un alt apel (advance_order mark_paid) poate muta comanda
--    în 'paid' → stoc dedus pe item-urile vechi, apoi edit-ul scrie alte
--    items peste o comandă deja încasată. Adăugăm `select … for update`
--    pe rândul orders ca să serializăm edit vs mark_paid pe aceeași
--    comandă.
--
-- 2. P0 — Audit log pe order_items
--    audit_trigger_fn (mig 044) e atașat pe orders/products/etc., dar NU
--    pe order_items. Edit-ul de items nu lăsa nicio urmă: cine a șters
--    produs de 200 lei dintr-o comandă era invizibil.
--    Adăugăm o funcție dedicată care găsește restaurant_id via JOIN pe
--    orders (order_items nu are coloana direct), apoi loghează în
--    public.audit_log.
--
-- 3. P1 — Happy Hour stale după edit
--    Pe o comandă QR cu HH auto-aplicat ca discount fix (amount), edit-ul
--    de items lăsa reducerea cached neschimbată → procentul real era
--    aiurea. Pentru source ∈ (qr, pickup) cu discount_reason începând cu
--    'Happy Hour', resetăm discount-ul și lăsăm trigger-ul existent să
--    NU reaplice (e doar after insert pe orders). Re-evaluăm explicit
--    aici dacă pot.

-- ═══════════════════════════════════════════════════════════════
-- 1 + 3. UPDATE_ORDER_ITEMS cu lock + happy hour re-eval
-- ═══════════════════════════════════════════════════════════════
create or replace function public.update_order_items(
  p_order_id uuid,
  p_items    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid    uuid := auth.uid();
  v_order         public.orders%rowtype;
  v_role          text;
  v_item          jsonb;
  v_product       record;
  v_option_ids    uuid[];
  v_valid_count   integer;
  v_unit_price    numeric(10,2);
  v_options_delta numeric(10,2);
  v_options_json  jsonb;
  v_item_total    numeric(10,2);
  v_item_qty      integer;
  v_item_notes    text;
  v_payments_sum  numeric(10,2);
  v_items_count   integer;
  v_was_happy_hour boolean := false;
  v_hh_rule       record;
  v_hh_subtotal   numeric(10,2);
  v_hh_discount   numeric(10,2);
  v_hh_best_disc  numeric(10,2) := 0;
  v_hh_best_name  text;
  v_new_subtotal  numeric(10,2);
begin
  if v_caller_uid is null then
    raise exception 'update_order_items: authentication required';
  end if;

  -- ============================================================
  -- LOCK pe rândul orders. Serializează edit-ul cu advance_order
  -- (mark_paid/cancel) pe aceeași comandă. Dacă mark_paid câștigă,
  -- v_order.status va fi 'paid' și ieșim cu eroare la state check.
  -- ============================================================
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'update_order_items: order % not found', p_order_id;
  end if;

  select role::text into v_role
  from public.restaurant_memberships
  where restaurant_id = v_order.restaurant_id
    and user_id = v_caller_uid;

  if v_role is null then
    raise exception 'update_order_items: caller is not a member of this restaurant';
  end if;
  if v_role not in ('owner', 'manager', 'waiter') then
    raise exception 'update_order_items: role % cannot edit orders', v_role;
  end if;

  if v_order.status in ('paid', 'cancelled') then
    raise exception 'update_order_items: order is % — cannot edit terminal state', v_order.status;
  end if;

  select coalesce(sum(amount), 0) into v_payments_sum
  from public.order_payments
  where order_id = p_order_id;
  if v_payments_sum > 0 then
    raise exception
      'update_order_items: order has partial payments (% lei). Anulează plățile întâi.',
      v_payments_sum;
  end if;

  v_items_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if v_items_count = 0 then
    raise exception 'update_order_items: items array empty. Pentru anulare folosește advance_order(cancel).';
  end if;
  if v_items_count > 100 then
    raise exception 'update_order_items: too many items (max 100)';
  end if;

  -- Reține dacă reducerea curentă e Happy Hour auto-aplicat. Dacă da,
  -- după edit re-evaluăm; dacă nu, păstrăm cached value (manual discount).
  v_was_happy_hour := v_order.discount_reason is not null
    and v_order.discount_reason like '%Happy Hour%';

  delete from public.order_items where order_id = p_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_qty := (v_item ->> 'quantity')::integer;
    if v_item_qty is null or v_item_qty < 1 or v_item_qty > 99 then
      raise exception 'update_order_items: invalid quantity (1-99)';
    end if;

    select id, restaurant_id, name, price, is_active
    into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid;

    if not found then
      raise exception 'update_order_items: product % not found', v_item ->> 'product_id';
    end if;
    if v_product.restaurant_id <> v_order.restaurant_id then
      raise exception 'update_order_items: product does not belong to this restaurant';
    end if;
    if not v_product.is_active then
      raise exception 'update_order_items: product "%" is inactive', v_product.name;
    end if;

    v_unit_price := v_product.price;

    v_option_ids := array(
      select (x)::uuid
      from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as x
    );

    v_options_delta := 0;
    v_options_json  := '[]'::jsonb;

    if array_length(v_option_ids, 1) > 0 then
      select count(*) into v_valid_count
      from public.modifier_options mo
      join public.modifier_groups mg on mg.id = mo.modifier_group_id
      join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
      where mo.id = any(v_option_ids)
        and mo.is_available = true
        and pmg.product_id = v_product.id
        and mg.restaurant_id = v_order.restaurant_id;

      if v_valid_count <> array_length(v_option_ids, 1) then
        raise exception 'update_order_items: invalid options for product "%"', v_product.name;
      end if;

      select
        coalesce(sum(mo.price_delta), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'group_id',    mg.id,
          'group_name',  mg.name,
          'option_id',   mo.id,
          'option_name', mo.name,
          'price_delta', mo.price_delta
        )), '[]'::jsonb)
      into v_options_delta, v_options_json
      from public.modifier_options mo
      join public.modifier_groups mg on mg.id = mo.modifier_group_id
      where mo.id = any(v_option_ids);
    end if;

    v_item_total := (v_unit_price + v_options_delta) * v_item_qty;
    v_item_notes := nullif(trim(coalesce(v_item ->> 'notes', '')), '');

    insert into public.order_items (
      order_id, product_id, product_name_snapshot, unit_price_snapshot,
      quantity, item_total, selected_modifiers, notes
    )
    values (
      p_order_id, v_product.id, v_product.name, v_unit_price,
      v_item_qty, v_item_total, v_options_json, v_item_notes
    );
  end loop;

  -- ============================================================
  -- HAPPY HOUR RE-EVAL (doar dacă reducerea curentă era HH auto)
  -- ============================================================
  if v_was_happy_hour then
    -- Subtotal nou după edit (din items proaspăt inserate)
    select coalesce(sum(item_total), 0) into v_new_subtotal
    from public.order_items where order_id = p_order_id;

    -- Caută cea mai bună regulă activă acum
    for v_hh_rule in
      select * from public.public_happy_hour_now(v_order.restaurant_id)
    loop
      if v_hh_rule.scope = 'all' then
        v_hh_subtotal := v_new_subtotal;
      elsif v_hh_rule.scope = 'category' then
        select coalesce(sum(oi.item_total), 0) into v_hh_subtotal
          from public.order_items oi
          join public.products p on p.id = oi.product_id
         where oi.order_id = p_order_id and p.category_id = v_hh_rule.category_id;
      elsif v_hh_rule.scope = 'product' then
        select coalesce(sum(oi.item_total), 0) into v_hh_subtotal
          from public.order_items oi
         where oi.order_id = p_order_id and oi.product_id = v_hh_rule.product_id;
      else
        v_hh_subtotal := 0;
      end if;

      if v_hh_subtotal <= 0 then continue; end if;

      if v_hh_rule.discount_type = 'percent' then
        v_hh_discount := round(v_hh_subtotal * v_hh_rule.discount_value / 100, 2);
      else
        v_hh_discount := least(v_hh_rule.discount_value, v_hh_subtotal);
      end if;

      if v_hh_rule.max_discount is not null and v_hh_discount > v_hh_rule.max_discount then
        v_hh_discount := v_hh_rule.max_discount;
      end if;

      if v_hh_discount > v_hh_best_disc then
        v_hh_best_disc := v_hh_discount;
        v_hh_best_name := v_hh_rule.name;
      end if;
    end loop;

    -- Update discount cached. Dacă nicio regulă nu mai e activă, zero out.
    update public.orders
       set discount_type   = case when v_hh_best_disc > 0 then 'amount'::public.order_discount_type else null end,
           discount_value  = case when v_hh_best_disc > 0 then v_hh_best_disc else null end,
           discount_reason = case
             when v_hh_best_disc > 0 then '🎉 Happy Hour: ' || coalesce(v_hh_best_name, '')
             else null
           end
     where id = p_order_id;
  end if;

  -- Trigger recalc_order_subtotal a făcut deja recalc-ul la DELETE/INSERT,
  -- dar dacă am updatat discount mai sus, mai forțăm un refresh ca să
  -- aplice noua valoare de discount peste subtotal.
  perform public._refresh_order_totals(p_order_id);

  select * into v_order from public.orders where id = p_order_id;
  return jsonb_build_object(
    'id',              v_order.id,
    'total',           v_order.total,
    'discount_amount', v_order.discount_amount,
    'items_count',     v_items_count
  );
end;
$$;

revoke all on function public.update_order_items(uuid, jsonb) from public;
grant execute on function public.update_order_items(uuid, jsonb) to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 2. AUDIT TRIGGER pe order_items
-- ═══════════════════════════════════════════════════════════════
-- Funcție dedicată — order_items nu are coloana restaurant_id, deci
-- trebuie să o aflăm prin JOIN pe orders. Funcția generică din mig 044
-- caută direct în row, ar lăsa restaurant_id NULL → policy RLS nu mai
-- arată log-ul către owner. Aici facem lookup explicit.

create or replace function public.audit_order_items_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_data jsonb;
  v_new_data jsonb;
  v_changed text[];
  v_row_id  text;
  v_order_id uuid;
  v_restaurant_id uuid;
  v_actor_id uuid;
  v_actor_role text;
begin
  v_actor_id := auth.uid();
  v_actor_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    current_user
  );

  if tg_op = 'DELETE' then
    v_old_data := to_jsonb(OLD);
    v_row_id   := coalesce(OLD.id::text, 'unknown');
    v_order_id := OLD.order_id;
  elsif tg_op = 'UPDATE' then
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
    v_row_id   := coalesce(NEW.id::text, 'unknown');
    v_order_id := NEW.order_id;
    select array_agg(key) into v_changed
      from jsonb_each(v_new_data)
     where v_old_data -> key is distinct from v_new_data -> key;
  elsif tg_op = 'INSERT' then
    v_new_data := to_jsonb(NEW);
    v_row_id   := coalesce(NEW.id::text, 'unknown');
    v_order_id := NEW.order_id;
  end if;

  -- Resolve restaurant_id via orders
  begin
    select restaurant_id into v_restaurant_id
      from public.orders where id = v_order_id;
  exception when others then
    v_restaurant_id := null;
  end;

  begin
    insert into public.audit_log (
      actor_id, actor_role, table_name, operation, row_id,
      restaurant_id, old_data, new_data, changed_keys
    ) values (
      v_actor_id, v_actor_role, 'order_items', tg_op, v_row_id,
      v_restaurant_id, v_old_data, v_new_data, v_changed
    );
  exception when others then
    raise warning 'audit_order_items_fn: insert failed: %', sqlerrm;
  end;

  if tg_op = 'DELETE' then
    return OLD;
  else
    return NEW;
  end if;
end;
$$;

drop trigger if exists audit_order_items on public.order_items;
create trigger audit_order_items
  after insert or update or delete on public.order_items
  for each row execute function public.audit_order_items_fn();


-- ═══════════════════════════════════════════════════════════════
-- 4. RPC pentru fetch istoric audit per comandă
-- ═══════════════════════════════════════════════════════════════
-- View-ul v_audit_recent (mig 044) e bun pentru rapoarte globale, dar
-- pentru istoricul unei comenzi specifice avem nevoie de:
--   - filtru combinat (orders.row_id = X SAU order_items cu order_id = X)
--   - filtrele pe jsonb fields prin PostgREST sunt fragile
--   - role check explicit (waiter NU vede tot)
-- RPC SECURITY DEFINER cu role check propriu + foloseşte indexurile.

create or replace function public.get_order_audit_history(p_order_id uuid)
returns table (
  id            bigint,
  created_at    timestamptz,
  actor_id      uuid,
  actor_name    text,
  table_name    text,
  operation     text,
  row_id        text,
  changed_keys  text[],
  diff_short    jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_caller_uid    uuid := auth.uid();
  v_order         public.orders%rowtype;
  v_role          text;
begin
  if v_caller_uid is null then
    raise exception 'get_order_audit_history: authentication required';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'get_order_audit_history: order % not found', p_order_id;
  end if;

  select role::text into v_role
  from public.restaurant_memberships
  where restaurant_id = v_order.restaurant_id
    and user_id = v_caller_uid;

  -- Doar owner/manager văd istoricul. Waiter nu (gating-ul UI deja
  -- ascunde butonul, dar RPC-ul îl reconfirmă server-side).
  if v_role not in ('owner', 'manager') then
    raise exception 'get_order_audit_history: only owner/manager can view audit history';
  end if;

  return query
    select
      a.id,
      a.created_at,
      a.actor_id,
      p.full_name as actor_name,
      a.table_name,
      a.operation,
      a.row_id,
      a.changed_keys,
      case
        when a.operation = 'UPDATE' then
          (select jsonb_object_agg(k, jsonb_build_object('from', a.old_data -> k, 'to', a.new_data -> k))
             from unnest(a.changed_keys) k)
        when a.operation = 'INSERT' then a.new_data
        else a.old_data
      end as diff_short
    from public.audit_log a
    left join public.profiles p on p.id = a.actor_id
    where
      -- Audit pe rândul orders direct
      (a.table_name = 'orders' and a.row_id = p_order_id::text)
      or
      -- Audit pe order_items cu order_id = p_order_id (new_data sau old_data)
      (a.table_name = 'order_items' and (
        (a.new_data ->> 'order_id') = p_order_id::text
        or (a.old_data ->> 'order_id') = p_order_id::text
      ))
    order by a.created_at desc
    limit 200;
end;
$$;

revoke all on function public.get_order_audit_history(uuid) from public;
grant execute on function public.get_order_audit_history(uuid) to authenticated;

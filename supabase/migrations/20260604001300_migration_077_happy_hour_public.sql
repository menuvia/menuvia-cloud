-- Migration 077: Happy Hour pe meniul public + auto-apply la comanda QR
-- ─────────────────────────────────────────────────────────────────────
-- Cerință: clientul care comandă prin QR (self-service) trebuie să vadă
-- prețurile reduse de Happy Hour pe meniu ȘI să fie taxat corect — adică
-- reducerea trebuie aplicată automat la crearea comenzii, server-side.
--
-- Conține:
--   1. RPC public `public_happy_hour_now` — regulile active acum, fără
--      is_member (anon poate citi) → meniul public afișează prețul redus.
--   2. Bugfix `suggest_happy_hour_discount_for_order` — referenția
--      `orders.subtotal` care NU EXISTĂ (coloana e `total`). Funcția era
--      stricată → happy hour nici pe waiter nu funcționa. Calculăm
--      subtotalul din order_items.
--   3. Auto-apply: constraint trigger DEFERRABLE pe orders care, la commit
--      (după ce toate item-urile sunt inserate de create_order), aplică
--      cea mai bună regulă activă pentru comenzile self-service
--      (source qr/pickup), fără reducere manuală.

-- ═══════════════════════════════════════════════════════════════
-- 1. RPC PUBLIC: regulile active acum (pentru afișare pe meniu)
-- ═══════════════════════════════════════════════════════════════
create or replace function public.public_happy_hour_now(
  p_restaurant_id uuid
)
returns table (
  id              uuid,
  name            text,
  scope           text,
  category_id     uuid,
  product_id      uuid,
  discount_type   public.order_discount_type,
  discount_value  numeric,
  max_discount    numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_time time;
  v_now_dow  smallint;
begin
  -- Doar restaurante active (fără is_member — e endpoint public)
  if not exists (
    select 1 from public.restaurants r
    where r.id = p_restaurant_id and r.is_active = true
  ) then
    return;
  end if;

  v_now_time := (now() at time zone 'Europe/Bucharest')::time;
  v_now_dow  := extract(isodow from (now() at time zone 'Europe/Bucharest'))::smallint;
  v_now_dow  := case when v_now_dow = 7 then 1 else v_now_dow + 1 end;

  return query
    select
      r.id, r.name, r.scope, r.category_id, r.product_id,
      r.discount_type, r.discount_value, r.max_discount
    from public.happy_hour_rules r
    where r.restaurant_id = p_restaurant_id
      and r.is_active = true
      and (
        cardinality(r.days_of_week) = 0 OR v_now_dow = ANY(r.days_of_week)
      )
      and (
        (r.ends_at >= r.starts_at AND v_now_time >= r.starts_at AND v_now_time <= r.ends_at)
        OR
        (r.ends_at < r.starts_at AND (v_now_time >= r.starts_at OR v_now_time <= r.ends_at))
      );
end;
$$;

revoke all on function public.public_happy_hour_now(uuid) from public;
grant execute on function public.public_happy_hour_now(uuid) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2. BUGFIX: suggest_happy_hour_discount_for_order — orders.subtotal
--    nu există (coloana e `total`). Calculăm subtotalul din items.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.suggest_happy_hour_discount_for_order(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_order_subtotal numeric;
  v_rule          record;
  v_subtotal      numeric;
  v_discount      numeric;
  v_best_discount numeric := 0;
  v_best          jsonb   := null;
begin
  select restaurant_id into v_restaurant_id
    from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if not public.is_member(v_restaurant_id) then
    raise exception 'Not a member';
  end if;

  -- Subtotal = suma item_total (orders nu are coloană subtotal separată)
  select coalesce(sum(item_total), 0) into v_order_subtotal
    from public.order_items where order_id = p_order_id;

  for v_rule in
    select * from public.evaluate_happy_hour_for_now(v_restaurant_id)
  loop
    if v_rule.scope = 'all' then
      v_subtotal := v_order_subtotal;
    elsif v_rule.scope = 'category' then
      select coalesce(sum(oi.item_total), 0) into v_subtotal
        from public.order_items oi
        join public.products p on p.id = oi.product_id
       where oi.order_id = p_order_id
         and p.category_id = v_rule.category_id;
    elsif v_rule.scope = 'product' then
      select coalesce(sum(oi.item_total), 0) into v_subtotal
        from public.order_items oi
       where oi.order_id = p_order_id
         and oi.product_id = v_rule.product_id;
    else
      v_subtotal := 0;
    end if;

    if v_subtotal <= 0 then continue; end if;

    if v_rule.discount_type = 'percent' then
      v_discount := round(v_subtotal * v_rule.discount_value / 100, 2);
    else
      v_discount := least(v_rule.discount_value, v_subtotal);
    end if;

    if v_rule.max_discount is not null and v_discount > v_rule.max_discount then
      v_discount := v_rule.max_discount;
    end if;

    if v_discount > v_best_discount then
      v_best_discount := v_discount;
      v_best := jsonb_build_object(
        'rule_id',             v_rule.id,
        'rule_name',           v_rule.name,
        'discount_type',       v_rule.discount_type,
        'discount_value',      v_rule.discount_value,
        'applicable_subtotal', v_subtotal,
        'computed_discount',   v_discount
      );
    end if;
  end loop;

  return v_best;
end;
$$;

revoke all on function public.suggest_happy_hour_discount_for_order(uuid) from public;
grant execute on function public.suggest_happy_hour_discount_for_order(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. AUTO-APPLY la comanda self-service (qr/pickup)
-- ═══════════════════════════════════════════════════════════════
-- Constraint trigger DEFERRABLE INITIALLY DEFERRED → rulează la COMMIT,
-- după ce create_order a inserat toate order_items și a setat total.
-- Calculează cea mai bună reducere activă (scope + cap) și o aplică ca
-- discount fix pe comandă (discount_type='amount' → consistent la orice
-- recalc ulterior prin _refresh_order_totals).

create or replace function public._apply_happy_hour_auto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_subtotal numeric;
  v_rule          record;
  v_subtotal      numeric;
  v_discount      numeric;
  v_best_discount numeric := 0;
  v_best_name     text;
begin
  -- Doar comenzi self-service, fără reducere manuală deja aplicată.
  if NEW.source not in ('qr', 'pickup') then
    return null;
  end if;
  if NEW.discount_reason is not null then
    return null;  -- reducere setată deja (manual sau re-run) → nu suprascrie
  end if;

  select coalesce(sum(item_total), 0) into v_order_subtotal
    from public.order_items where order_id = NEW.id;
  if v_order_subtotal <= 0 then
    return null;
  end if;

  for v_rule in
    select * from public.public_happy_hour_now(NEW.restaurant_id)
  loop
    if v_rule.scope = 'all' then
      v_subtotal := v_order_subtotal;
    elsif v_rule.scope = 'category' then
      select coalesce(sum(oi.item_total), 0) into v_subtotal
        from public.order_items oi
        join public.products p on p.id = oi.product_id
       where oi.order_id = NEW.id and p.category_id = v_rule.category_id;
    elsif v_rule.scope = 'product' then
      select coalesce(sum(oi.item_total), 0) into v_subtotal
        from public.order_items oi
       where oi.order_id = NEW.id and oi.product_id = v_rule.product_id;
    else
      v_subtotal := 0;
    end if;

    if v_subtotal <= 0 then continue; end if;

    if v_rule.discount_type = 'percent' then
      v_discount := round(v_subtotal * v_rule.discount_value / 100, 2);
    else
      v_discount := least(v_rule.discount_value, v_subtotal);
    end if;

    if v_rule.max_discount is not null and v_discount > v_rule.max_discount then
      v_discount := v_rule.max_discount;
    end if;

    if v_discount > v_best_discount then
      v_best_discount := v_discount;
      v_best_name := v_rule.name;
    end if;
  end loop;

  if v_best_discount > 0 then
    update public.orders
       set discount_type   = 'amount',
           discount_value  = v_best_discount,
           discount_amount = v_best_discount,
           discount_reason = '🎉 Happy Hour: ' || coalesce(v_best_name, ''),
           total           = greatest(0, v_order_subtotal - v_best_discount)
     where id = NEW.id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_apply_happy_hour_auto on public.orders;
create constraint trigger trg_apply_happy_hour_auto
  after insert on public.orders
  deferrable initially deferred
  for each row execute function public._apply_happy_hour_auto();

-- Migration 087: Poarta C — plan-level enforcement pe lifecycle (table_lifecycle)
-- ─────────────────────────────────────────────────────────────────────
-- Spec §3 Regula 3: "Gating la nivel de RPC/RLS, NU în UI."
-- Spec §10 Poarta C exit: free/starter nu pot folosi `close_order` /
-- `close_session_orders` (lifecycle non-fiscal e feature Plan 2+).
--
-- Strategie minimă invazivă:
--   1. Helper enforce_feature(restaurant_id, feature) — RAISE dacă disabled.
--   2. advance_order: în branch-ul `close_order` cheamă enforce_feature
--      cu 'table_lifecycle'. Restul tranzițiilor (confirm/served/mark_paid)
--      NU sunt afectate (mark_paid e Plan 3, are propriul gate fiscal).
--   3. close_session_orders: același gate la început.
--
-- Notă: Gate A (mig 083) blochează deja create_order la INSERT pentru
-- free/starter. Gate C adaugă un layer pe lifecycle, pentru cazul rar
-- în care planul scade după ce comenzile au fost create (downgrade).

-- ── 1. Helper enforce_feature_for_restaurant ─────────────────────
-- STABLE: planul nu se schimbă în interiorul unei tranzacții → safe.
-- SECURITY DEFINER + search_path fixat: protejează contra atacurilor.
create or replace function public.enforce_feature_for_restaurant(
  p_restaurant_id uuid,
  p_feature       text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_plan       text;
  v_enabled    boolean;
begin
  select
    coalesce(pr.plan, 'free'),
    coalesce(pf.enabled, false)
  into v_plan, v_enabled
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  left join public.plan_features pf
         on pf.plan = pr.plan and pf.feature = p_feature
  where r.id = p_restaurant_id;

  if not coalesce(v_enabled, false) then
    raise exception
      'Featurea % nu e disponibilă pe planul curent (%). Upgrade la Growth sau mai sus.',
      p_feature, v_plan
      using errcode = 'check_violation', hint = 'feature_disabled';
  end if;
end;
$$;

revoke all on function public.enforce_feature_for_restaurant(uuid, text) from public;
grant execute on function public.enforce_feature_for_restaurant(uuid, text) to authenticated;

comment on function public.enforce_feature_for_restaurant(uuid, text) is
  $$Plan-level gate. Cheamă din RPC-uri la începutul acțiunii care necesită
  un feature. Raise check_violation cu hint=feature_disabled.$$;

-- ── 2. advance_order: gate pe close_order ────────────────────────
-- Repetăm SEMNĂTURA exactă pentru CREATE OR REPLACE (păstrăm restul logicii).
create or replace function public.advance_order(
  p_order_id    uuid,
  p_action      text,
  p_paid_amount numeric default null,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   record;
  v_user_id uuid;
  v_role    text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = 'P0001', hint = 'auth_required';
  end if;

  select o.*, r.owner_id, rm.role as member_role
  into v_order
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.restaurant_memberships rm
    on rm.restaurant_id = o.restaurant_id
   and rm.user_id = v_user_id
  where o.id = p_order_id;

  if not found then
    raise exception 'Order not found'
      using errcode = 'P0001', hint = 'order_not_found';
  end if;

  if v_order.owner_id != v_user_id and v_order.member_role is null then
    raise exception 'Not authorized for this restaurant'
      using errcode = 'P0001', hint = 'unauthorized';
  end if;

  -- v_order.member_role e enum public.member_role; cast la text pentru
  -- match cu literalele 'owner','manager' etc. în branch-urile case de jos.
  v_role := coalesce(v_order.member_role::text,
    case when v_order.owner_id = v_user_id then 'owner' else null end);

  if v_order.status in ('paid', 'cancelled', 'closed') then
    raise exception 'Order is already terminal (status: %)', v_order.status
      using errcode = 'P0001', hint = 'order_terminal';
  end if;

  case p_action
    when 'confirm' then
      if v_order.status != 'new' then
        raise exception 'Can only confirm new orders (current: %)', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'waiter') then
        raise exception 'Role % cannot confirm orders', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders set status='confirmed', confirmed_at=now()
      where id=p_order_id;

    when 'start_preparing' then
      if v_order.status not in ('new','confirmed') then
        raise exception 'Can only start preparing new/confirmed orders (current: %)', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'waiter', 'kitchen') then
        raise exception 'Role % cannot start preparing', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders set status='preparing', preparing_at=now()
      where id=p_order_id;

    when 'mark_ready' then
      if v_order.status not in ('preparing','confirmed','new') then
        raise exception 'Order not in a preparable state (current: %)', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'waiter', 'kitchen') then
        raise exception 'Role % cannot mark ready', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders set status='ready', ready_at=now()
      where id=p_order_id;

    when 'mark_served' then
      if v_order.status not in ('ready','confirmed','new','preparing') then
        raise exception 'Order not in a servable state (current: %)', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'waiter') then
        raise exception 'Role % cannot mark served', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders set status='served', served_at=now(), served_by=v_user_id
      where id=p_order_id;

    when 'close_order' then
      -- ★ Gate C: feature 'table_lifecycle' (Plan 2+) ★
      perform public.enforce_feature_for_restaurant(v_order.restaurant_id, 'table_lifecycle');

      if v_order.status not in ('served', 'ready', 'confirmed', 'new', 'preparing') then
        raise exception 'Cannot close order in status: %', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'waiter') then
        raise exception 'Role % cannot close orders', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders
        set status='closed',
            served_at=coalesce(served_at, now()),
            served_by=coalesce(served_by, v_user_id)
      where id=p_order_id;

    when 'mark_paid' then
      -- Plan 3: plată cu bon fiscal — gate-ul fiscal e separat (Gate E follow-up).
      if v_order.status not in ('served','ready') then
        raise exception 'Can only mark paid served/ready orders (current: %)', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'waiter') then
        raise exception 'Role % cannot mark paid', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders
        set status='paid',
            paid_at=now(),
            paid_by=v_user_id,
            paid_amount=coalesce(p_paid_amount, total),
            payment_method=coalesce(p_payment_method, payment_method)
      where id=p_order_id;

    when 'cancel' then
      if v_role not in ('owner', 'manager') then
        raise exception 'Only owner/manager can cancel orders' using errcode = 'P0001';
      end if;
      update public.orders set status='cancelled', cancelled_at=now()
      where id=p_order_id;

    else
      raise exception 'Unknown action: %', p_action
        using errcode = 'P0001', hint = 'unknown_action';
  end case;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'action', p_action
  );
end;
$$;

-- ── 3. close_session_orders: gate la început ─────────────────────
create or replace function public.close_session_orders(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid;
  v_session      record;
  v_closed_count int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = 'P0001', hint = 'auth_required';
  end if;

  select ts.*, rm.role
  into v_session
  from public.table_sessions ts
  left join public.restaurant_memberships rm
    on rm.restaurant_id = ts.restaurant_id
   and rm.user_id = v_user_id
  left join public.restaurants r on r.id = ts.restaurant_id
  where ts.id = p_session_id
    and (r.owner_id = v_user_id or rm.role in ('owner','manager','waiter'));

  if not found then
    raise exception 'Sesiunea nu există sau nu ești autorizat să o închizi.'
      using errcode = 'P0001', hint = 'session_not_found_or_unauthorized';
  end if;

  -- ★ Gate C: feature 'table_lifecycle' (Plan 2+) ★
  perform public.enforce_feature_for_restaurant(v_session.restaurant_id, 'table_lifecycle');

  if v_session.status = 'closed' then
    return jsonb_build_object('session_id', p_session_id, 'closed_count', 0, 'already_closed', true);
  end if;

  update public.orders
    set status = 'closed',
        served_at = coalesce(served_at, now()),
        served_by = coalesce(served_by, v_user_id)
  where session_id = p_session_id
    and status not in ('paid', 'cancelled', 'closed');

  get diagnostics v_closed_count = row_count;

  update public.table_sessions
    set status = 'closed',
        closed_at = now()
  where id = p_session_id;

  return jsonb_build_object(
    'session_id',   p_session_id,
    'closed_count', v_closed_count,
    'ok',           true
  );
end;
$$;

-- ── 4. Confirmare seed plan_features ─────────────────────────────
-- mig 085 a inserat deja: free/starter=false, growth/pro/enterprise=true.
-- Re-upsert defensiv pentru rezistență la rollback parțial.
insert into public.plan_features (plan, feature, enabled, limit_value) values
  ('free',       'table_lifecycle', false, null),
  ('starter',    'table_lifecycle', false, null),
  ('growth',     'table_lifecycle', true,  null),
  ('pro',        'table_lifecycle', true,  null),
  ('enterprise', 'table_lifecycle', true,  null)
on conflict (plan, feature) do update set enabled = excluded.enabled;

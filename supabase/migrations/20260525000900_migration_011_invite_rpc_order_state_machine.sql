-- =============================================================
-- Menuvia — Migration 011
-- Server-authoritative invite acceptance + order state machine
--
-- Fixes:
--   1. accept_invite RPC — replaces broken client-side membership INSERT
--   2. advance_order RPC — enforces valid status transitions per role
-- =============================================================


-- =============================================================
-- 1. accept_invite(p_token text)
--
-- PROBLEM: The client cannot INSERT into restaurant_memberships because
--   RLS requires is_admin(). A new user accepting an invite is not an admin.
--   The current flow is functionally broken.
--   Even if it worked, the client controls the role field — insecure.
--
-- FIX: SECURITY DEFINER RPC that does everything atomically:
--   - validates token exists, not expired, not accepted
--   - validates caller's email matches invite email
--   - inserts membership with role FROM THE DB (not client-supplied)
--   - marks token as accepted
--   - creates profile if it doesn't exist yet
--   - returns result
--   - idempotent: if user is already a member, returns success
-- =============================================================

create or replace function public.accept_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid  uuid := auth.uid();
  v_caller_email text;
  v_invite      public.invite_tokens%rowtype;
  v_existing_id uuid;
begin
  -- 1. Caller must be authenticated
  if v_caller_uid is null then
    raise exception 'accept_invite: authentication required';
  end if;

  -- Get caller email from auth.users
  select email into v_caller_email
  from auth.users
  where id = v_caller_uid;

  -- 2. Find and validate the invite token
  select * into v_invite
  from public.invite_tokens
  where token = p_token;

  if not found then
    raise exception 'accept_invite: token not found';
  end if;

  if v_invite.accepted_at is not null then
    -- Already accepted — check if caller is already a member (idempotent)
    if exists (
      select 1 from public.restaurant_memberships
      where restaurant_id = v_invite.restaurant_id
        and user_id = v_caller_uid
    ) then
      return jsonb_build_object(
        'ok', true,
        'restaurant_id', v_invite.restaurant_id,
        'role', v_invite.role,
        'already_accepted', true
      );
    end if;
    raise exception 'accept_invite: token already used';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'accept_invite: token expired';
  end if;

  -- 3. Email must match (case-insensitive)
  if lower(v_caller_email) <> lower(v_invite.email) then
    raise exception 'accept_invite: email mismatch — this invite was sent to %', v_invite.email;
  end if;

  -- 4. Check if already a member of this restaurant (idempotent)
  select id into v_existing_id
  from public.restaurant_memberships
  where restaurant_id = v_invite.restaurant_id
    and user_id = v_caller_uid;

  if v_existing_id is not null then
    -- Already a member — mark invite as accepted and return success
    update public.invite_tokens
    set accepted_at = now()
    where id = v_invite.id;

    return jsonb_build_object(
      'ok', true,
      'restaurant_id', v_invite.restaurant_id,
      'role', v_invite.role,
      'already_member', true
    );
  end if;

  -- 5. Ensure profile exists (signup via invite might not have created one yet)
  insert into public.profiles (id, email, full_name, plan)
  values (v_caller_uid, v_caller_email, (select raw_user_meta_data->>'full_name' from auth.users where id = v_caller_uid), 'free')
  on conflict (id) do nothing;

  -- 6. Insert membership with role FROM THE DB — client cannot influence this
  insert into public.restaurant_memberships (restaurant_id, user_id, role, invited_by)
  values (v_invite.restaurant_id, v_caller_uid, v_invite.role, v_invite.invited_by);

  -- 7. Mark token as accepted
  update public.invite_tokens
  set accepted_at = now()
  where id = v_invite.id;

  return jsonb_build_object(
    'ok', true,
    'restaurant_id', v_invite.restaurant_id,
    'role', v_invite.role,
    'already_accepted', false
  );
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;


-- =============================================================
-- 2. advance_order(p_order_id uuid, p_action text, ...)
--
-- PROBLEM: advanceOrderStatus does a raw .update() with client-supplied
--   status. RLS controls which rows, but NOT what the new status is.
--   Kitchen can jump new→ready. Waiter can go backwards.
--
-- FIX: SECURITY DEFINER RPC with explicit state machine.
--   Client sends an ACTION (confirm, start_preparing, mark_ready, etc.)
--   not a raw status. RPC validates current status, role, and transition.
--
-- Valid transitions per action:
--   confirm:         new → confirmed        (kitchen, owner, manager)
--   start_preparing: confirmed → preparing   (kitchen, owner, manager)
--   mark_ready:      preparing → ready       (kitchen, owner, manager)
--   mark_served:     ready → served          (waiter, owner, manager)
--   mark_paid:       served → paid           (waiter, owner, manager)
--   cancel:          any non-terminal → cancelled (owner, manager)
-- =============================================================

create or replace function public.advance_order(
  p_order_id      uuid,
  p_action        text,
  p_payment_method text default null,
  p_paid_amount   numeric default null,
  p_cancel_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_order      public.orders%rowtype;
  v_role       public.member_role;
  v_new_status public.order_status;
  v_now        timestamptz := now();
begin
  if v_caller_uid is null then
    raise exception 'advance_order: authentication required';
  end if;

  -- 1. Fetch the order
  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'advance_order: order not found';
  end if;

  -- 2. Get caller's role in this restaurant
  select role into v_role
  from public.restaurant_memberships
  where restaurant_id = v_order.restaurant_id
    and user_id = v_caller_uid;

  if v_role is null then
    raise exception 'advance_order: not a member of this restaurant';
  end if;

  -- 3. Validate action + current status → new status
  case p_action
    when 'confirm' then
      if v_order.status <> 'new' then
        raise exception 'advance_order: can only confirm orders with status "new", got "%"', v_order.status;
      end if;
      if v_role not in ('kitchen', 'owner', 'manager') then
        raise exception 'advance_order: role "%" cannot confirm orders', v_role;
      end if;
      v_new_status := 'confirmed';

    when 'start_preparing' then
      if v_order.status <> 'confirmed' then
        raise exception 'advance_order: can only start preparing "confirmed" orders, got "%"', v_order.status;
      end if;
      if v_role not in ('kitchen', 'owner', 'manager') then
        raise exception 'advance_order: role "%" cannot start preparing', v_role;
      end if;
      v_new_status := 'preparing';

    when 'mark_ready' then
      if v_order.status <> 'preparing' then
        raise exception 'advance_order: can only mark "preparing" orders as ready, got "%"', v_order.status;
      end if;
      if v_role not in ('kitchen', 'owner', 'manager') then
        raise exception 'advance_order: role "%" cannot mark ready', v_role;
      end if;
      v_new_status := 'ready';

    when 'mark_served' then
      if v_order.status <> 'ready' then
        raise exception 'advance_order: can only serve "ready" orders, got "%"', v_order.status;
      end if;
      if v_role not in ('waiter', 'owner', 'manager') then
        raise exception 'advance_order: role "%" cannot mark served', v_role;
      end if;
      v_new_status := 'served';

    when 'mark_paid' then
      if v_order.status <> 'served' then
        raise exception 'advance_order: can only mark "served" orders as paid, got "%"', v_order.status;
      end if;
      if v_role not in ('waiter', 'owner', 'manager') then
        raise exception 'advance_order: role "%" cannot mark paid', v_role;
      end if;
      if p_payment_method is null then
        raise exception 'advance_order: payment_method is required when marking as paid';
      end if;
      v_new_status := 'paid';

    when 'cancel' then
      if v_order.status in ('paid', 'cancelled') then
        raise exception 'advance_order: cannot cancel a "%" order', v_order.status;
      end if;
      if v_role not in ('owner', 'manager') then
        raise exception 'advance_order: only owner/manager can cancel orders';
      end if;
      v_new_status := 'cancelled';

    else
      raise exception 'advance_order: unknown action "%"', p_action;
  end case;

  -- 4. Apply the transition
  update public.orders set
    status         = v_new_status,
    confirmed_at   = case when v_new_status = 'confirmed' then v_now else confirmed_at end,
    preparing_at   = case when v_new_status = 'preparing' then v_now else preparing_at end,
    ready_at       = case when v_new_status = 'ready'     then v_now else ready_at end,
    served_at      = case when v_new_status = 'served'    then v_now else served_at end,
    served_by      = case when v_new_status = 'served'    then v_caller_uid else served_by end,
    paid_at        = case when v_new_status = 'paid'      then v_now else paid_at end,
    paid_by        = case when v_new_status = 'paid'      then v_caller_uid else paid_by end,
    payment_method = case when v_new_status = 'paid'      then p_payment_method::public.payment_method else payment_method end,
    paid_amount    = case when v_new_status = 'paid'      then coalesce(p_paid_amount, v_order.total) else paid_amount end,
    cancelled_at   = case when v_new_status = 'cancelled' then v_now else cancelled_at end,
    cancel_reason  = case when v_new_status = 'cancelled' then p_cancel_reason else cancel_reason end
  where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'old_status', v_order.status,
    'new_status', v_new_status,
    'action', p_action,
    'actor', v_caller_uid
  );
end;
$$;

grant execute on function public.advance_order(uuid, text, text, numeric, text) to authenticated;

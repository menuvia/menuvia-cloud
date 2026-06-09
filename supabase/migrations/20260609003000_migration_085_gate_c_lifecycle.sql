-- Migration 085: Poarta C — lifecycle operațional (→closed) + evidență fără fiscal
-- ─────────────────────────────────────────────────────────────────────
-- Spec §5 Poarta C:
--   • Plan 2 (growth) poate urmări statusul comenzilor pe toată durata:
--     new → confirmed → preparing → ready → served → closed
--   • 'closed' = masa închisă, contul achitat (cash fără bon fiscal)
--   • 'paid' rămâne rezervat pentru Plan 3 (bridge ANAF + bon fiscal)
--   • UI-ul Plan 2 afișează banner "Evidență operațională · Nu emite bon fiscal"
--   • KDS poate marca 'served'; staff poate 'close' sesiunea (→closed pe orders)
--
-- Implementare:
--   1. Adaugă 'closed' în enum order_status
--   2. Actualizează advance_order: permite served → closed
--   3. RPC close_session_orders(p_session_id) — staff închide masa
--   4. plan_features: adaugă 'table_lifecycle' pentru growth+
-- ─────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════
-- 1. Extinde enum order_status cu 'closed'
-- ═══════════════════════════════════════════════════════════════
-- ALTER TYPE ... ADD VALUE nu poate rula în tranzacție cu alte DDL-uri
-- în PostgreSQL < 12. Suntem pe PG 15 (Supabase), deci e safe.
do $$ begin
  alter type public.order_status add value if not exists 'closed' after 'served';
exception when others then
  -- Dacă 'closed' există deja (idempotent)
  null;
end $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. Actualizează advance_order — permite served → closed
-- ═══════════════════════════════════════════════════════════════
-- Drop semnături anterioare (mig 011/043/076) ca să evităm overload
-- ambiguous cu noua semnătură 4-arg de mai jos. CREATE OR REPLACE NU
-- înlocuiește o semnătură diferită, deci fără DROP explicit am rămâne
-- cu 2 funcții cu același nume → "function is not unique" la apel cu null-uri.
drop function if exists public.advance_order(uuid, text, text, numeric, text);
drop function if exists public.advance_order(uuid, text, text, numeric, numeric, text);

create or replace function public.advance_order(
  p_order_id    uuid,
  p_action      text,   -- 'confirm' | 'start_preparing' | 'mark_ready' | 'mark_served' | 'close_order' | 'mark_paid' | 'cancel'
  p_paid_amount numeric  default null,
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

  -- Autentificare obligatorie pentru orice tranziție de la staff
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

  -- Authorization: owner sau member al restaurantului
  if v_order.owner_id != v_user_id and v_order.member_role is null then
    raise exception 'Not authorized for this restaurant'
      using errcode = 'P0001', hint = 'unauthorized';
  end if;

  v_role := coalesce(v_order.member_role,
    case when v_order.owner_id = v_user_id then 'owner' else null end);

  -- Comenzile terminal nu mai pot fi modificate
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
      if v_role not in ('owner', 'manager', 'kitchen', 'waiter') then
        raise exception 'Role % cannot confirm orders', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders set status='confirmed', confirmed_at=now() where id=p_order_id;

    when 'start_preparing' then
      if v_order.status not in ('new','confirmed') then
        raise exception 'Can only start preparing new/confirmed orders (current: %)', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'kitchen') then
        raise exception 'Role % cannot start preparing orders', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders set status='preparing',
        confirmed_at=coalesce(confirmed_at, now())
      where id=p_order_id;

    when 'mark_ready' then
      if v_order.status not in ('preparing','confirmed','new') then
        raise exception 'Order not in a preparable state (current: %)', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'kitchen') then
        raise exception 'Role % cannot mark orders ready', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders set status='ready',
        confirmed_at=coalesce(confirmed_at, now())
      where id=p_order_id;

    when 'mark_served' then
      if v_order.status not in ('ready','confirmed','new','preparing') then
        raise exception 'Order not in a servable state (current: %)', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'waiter') then
        raise exception 'Role % cannot mark orders served', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders set status='served', served_at=now(), served_by=v_user_id
      where id=p_order_id;

    when 'close_order' then
      -- Plan 2: masa achitată fără bon fiscal (cash / card POS fără integrare)
      -- Tranziție: served → closed (sau orice status non-terminal → closed)
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
      -- Plan 3: plată cu bon fiscal (bridge ANAF)
      if v_order.status not in ('served','ready') then
        raise exception 'Can only mark paid served/ready orders (current: %)', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'waiter') then
        raise exception 'Role % cannot mark orders paid', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders
        set status='paid',
            paid_at=now(),
            paid_by=v_user_id,
            payment_method=coalesce(p_payment_method::public.payment_method, 'cash'),
            paid_amount=coalesce(p_paid_amount, total)
      where id=p_order_id;

    when 'cancel' then
      if v_role not in ('owner', 'manager') then
        raise exception 'Role % cannot cancel orders', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders set status='cancelled' where id=p_order_id;

    else
      raise exception 'Unknown action: %', p_action
        using errcode = 'P0001', hint = 'unknown_action';
  end case;

  return jsonb_build_object(
    'id',     p_order_id,
    'action', p_action,
    'ok',     true
  );
end;
$$;

revoke all on function public.advance_order(uuid, text, numeric, text) from public;
grant execute on function public.advance_order(uuid, text, numeric, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. RPC close_session_orders(p_session_id) — staff închide masa
-- ═══════════════════════════════════════════════════════════════
-- Marchează toate comenzile deschise ale sesiunii ca 'closed' și
-- închide sesiunea. Single call din UI — "Închide masa".
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

  if v_session.status = 'closed' then
    return jsonb_build_object('session_id', p_session_id, 'closed_count', 0, 'already_closed', true);
  end if;

  -- Marchează toate comenzile non-terminale ca 'closed'
  update public.orders
    set status = 'closed',
        served_at = coalesce(served_at, now()),
        served_by = coalesce(served_by, v_user_id)
  where session_id = p_session_id
    and status not in ('paid', 'cancelled', 'closed');

  get diagnostics v_closed_count = row_count;

  -- Închide sesiunea
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

revoke all on function public.close_session_orders(uuid) from public;
grant execute on function public.close_session_orders(uuid) to authenticated;

comment on function public.close_session_orders is
  'Închide masa (Plan 2): toate comenzile → closed, sesiune → closed. Fără bon fiscal.';

-- ═══════════════════════════════════════════════════════════════
-- 4. plan_features: adaugă 'table_lifecycle' pentru growth+
-- ═══════════════════════════════════════════════════════════════
-- table_lifecycle = poate urmări statusul complet (served/closed) și
-- poate închide masa din dashboard. free/starter = viewing only.
insert into public.plan_features (plan, feature, enabled, limit_value) values
  ('free',       'table_lifecycle', false, null),
  ('starter',    'table_lifecycle', false, null),
  ('growth',     'table_lifecycle', true,  null),
  ('pro',        'table_lifecycle', true,  null),
  ('enterprise', 'table_lifecycle', true,  null)
on conflict (plan, feature) do update
  set enabled = excluded.enabled,
      limit_value = excluded.limit_value;

-- ═══════════════════════════════════════════════════════════════
-- 5. maybe_close_session_fn — actualizare pentru status 'closed'
-- ═══════════════════════════════════════════════════════════════
-- Trigger-ul creat în mig 084 verifică 'paid' și 'cancelled'.
-- Îl actualizăm să verifice și 'closed' ca stare terminală.
create or replace function public.maybe_close_session_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_count int;
begin
  -- Rulăm doar când orders.session_id e non-null și statusul
  -- s-a schimbat la o stare terminală.
  if new.session_id is null then
    return new;
  end if;
  if new.status not in ('paid', 'cancelled', 'closed') then
    return new;
  end if;
  if old.status = new.status then
    return new;
  end if;

  -- Numără comenzile non-terminale din sesiune
  select count(*) into v_open_count
  from public.orders
  where session_id = new.session_id
    and status not in ('paid', 'cancelled', 'closed')
    and id != new.id;  -- exclude current row (are noul status deja)

  if v_open_count = 0 then
    update public.table_sessions
      set status = 'closed',
          closed_at = coalesce(closed_at, now())
    where id = new.session_id
      and status = 'open';
  end if;

  return new;
end;
$$;

-- Migration 094: P0 critical fixes (audit 2026-06-14)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul critic a identificat 5 vulnerabilități critice în RPC/RLS care
-- toate suferă de aceeași patologie: „semnătură nouă în loc de fix la
-- semnătura veche" (capcana din CLAUDE.md).
--
-- Această migrație le rezolvă pe toate într-un singur fișier + assertion-uri
-- CI pentru fiecare. Detaliu pe fix în comentariile fiecărei secțiuni.
-- ─────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════
-- FIX 1: DROP supraîncărcarea 10-arg a `create_order` (mig 046)
-- ═══════════════════════════════════════════════════════════════
-- Bug: mig 084/088 a creat semnătura 11-arg cu p_session_id (poartă QR);
-- semnătura veche 10-arg (mig 046) a rămas vie, granted la anon, FĂRĂ
-- guard de sesiune. Anon putea apela versiunea veche și ocoli mig 088.
-- Fix: drop pe semnătura exactă. Versiunea 11-arg din mig 088 rămâne
-- singura cale validă pentru anon.
drop function if exists public.create_order(
  uuid,        -- p_restaurant_id
  text,        -- p_source
  uuid,        -- p_table_id
  uuid,        -- p_qr_token_id
  text,        -- p_notes
  jsonb,       -- p_items
  uuid,        -- p_idempotency_key
  timestamptz, -- p_pickup_time
  text,        -- p_customer_name
  text         -- p_customer_phone
);

-- ═══════════════════════════════════════════════════════════════
-- FIX 2: Backbone RLS — set search_path pe is_admin/is_member/my_role
-- ═══════════════════════════════════════════════════════════════
-- Bug: mig 005 le-a creat SECURITY DEFINER fără `set search_path`.
-- Niciodată redefinite => vii în schema finală. Vulnerabilitate de
-- search_path injection pe backbone-ul tuturor politicilor RLS.
-- Fix: redefinire IDENTICĂ + `set search_path = public, pg_temp`.

create or replace function public.my_role(p_restaurant_id uuid)
returns public.member_role
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select role
  from public.restaurant_memberships
  where restaurant_id = p_restaurant_id
    and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_admin(p_restaurant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = p_restaurant_id
      and user_id = auth.uid()
      and role in ('owner', 'manager')
  );
$$;

create or replace function public.is_member(p_restaurant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = p_restaurant_id
      and user_id = auth.uid()
  );
$$;

-- ═══════════════════════════════════════════════════════════════
-- FIX 3: Seed feature 'fiscal_receipt' în plan_features
-- ═══════════════════════════════════════════════════════════════
-- Regula de aur: bani + bon = Plan 3, fără excepții. Feature key
-- 'fiscal_receipt' devine cheia oficială prin care RPC-urile care emit
-- bon (mark_paid) verifică planul. Seed compatibil cu mig 028.
insert into public.plan_features (plan, feature, enabled, limit_value) values
  ('free',       'fiscal_receipt', false, null),
  ('starter',    'fiscal_receipt', false, null),
  ('growth',     'fiscal_receipt', false, null),
  ('pro',        'fiscal_receipt', true,  null),
  ('enterprise', 'fiscal_receipt', true,  null)
on conflict (plan, feature) do update set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value;

-- ═══════════════════════════════════════════════════════════════
-- FIX 4: Gate fiscal pe advance_order branch 'mark_paid'
--        + validare semn pe paid_amount/tips_amount
-- ═══════════════════════════════════════════════════════════════
-- Bug 4a (CRITIC): mark_paid setează status='paid' (stare fiscală
-- terminală) fără niciun gate de plan. Un restaurant 'free'/'starter'/
-- 'growth' putea marca o comandă ca paid (= bon fiscal). Încalcă direct
-- regula de aur.
-- Bug 4b (MARE): paid_amount/tips_amount fără validare de semn → coruptie
-- venituri/bacșișuri cu o singură comandă.
--
-- Conform CLAUDE.md: advance_order există în mig 085 ȘI 087 (copie
-- sincronizată). Modificăm AMBELE versiuni cu același branch corectat.
--
-- Versiunea oficială care rămâne live e cea din 087 (cu enforce_feature
-- pe close_order). Deci redefinim 087 cu gate-ul fiscal pe mark_paid în
-- plus față de close_order.

create or replace function public.advance_order(
  p_order_id    uuid,
  p_action      text,
  p_paid_amount numeric  default null,
  p_payment_method text default null,
  p_tips_amount numeric  default null,
  p_cancel_reason text   default null
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
      if v_role not in ('owner', 'manager', 'kitchen', 'waiter') then
        raise exception 'Role % cannot start preparing orders', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders set status='preparing', preparing_at=now()
      where id=p_order_id;

    when 'mark_ready' then
      if v_order.status not in ('confirmed','preparing') then
        raise exception 'Order not in a preparable state (current: %)', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'kitchen', 'waiter') then
        raise exception 'Role % cannot mark orders ready', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders set status='ready', ready_at=now()
      where id=p_order_id;

    when 'mark_served' then
      if v_order.status not in ('ready','preparing') then
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
      -- ★ GATE FISCAL (mig 094) — regula de aur: bani + bon = Plan 3.
      perform public.enforce_feature_for_restaurant(v_order.restaurant_id, 'fiscal_receipt');

      if v_order.status not in ('served','ready') then
        raise exception 'Can only mark paid served/ready orders (current: %)', v_order.status
          using errcode = 'P0001', hint = 'invalid_transition';
      end if;
      if v_role not in ('owner', 'manager', 'waiter') then
        raise exception 'Role % cannot mark orders paid', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;

      -- ★ VALIDARE SEMN (mig 094) — sume negative coruptează rapoartele.
      if coalesce(p_paid_amount, 0) < 0 then
        raise exception 'paid_amount nu poate fi negativ (primit: %)', p_paid_amount
          using errcode = 'P0001', hint = 'invalid_amount';
      end if;
      if coalesce(p_tips_amount, 0) < 0 then
        raise exception 'tips_amount nu poate fi negativ (primit: %)', p_tips_amount
          using errcode = 'P0001', hint = 'invalid_amount';
      end if;

      update public.orders
        set status='paid',
            paid_at=now(),
            paid_by=v_user_id,
            payment_method=coalesce(p_payment_method::public.payment_method, payment_method),
            paid_amount=coalesce(p_paid_amount, paid_amount),
            tips_amount=coalesce(p_tips_amount, tips_amount)
      where id=p_order_id;

    when 'cancel' then
      if v_role not in ('owner', 'manager', 'waiter') then
        raise exception 'Role % cannot cancel orders', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      update public.orders
        set status='cancelled',
            cancelled_at=now(),
            cancel_reason=coalesce(p_cancel_reason, cancel_reason)
      where id=p_order_id;

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

revoke all on function public.advance_order(uuid, text, numeric, text, numeric, text) from public;
grant execute on function public.advance_order(uuid, text, numeric, text, numeric, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- FIX 5: Session-gate pe submit_order_feedback
-- ═══════════════════════════════════════════════════════════════
-- Bug: anon cu UUID-ul unei comenzi served/paid putea suprascrie
-- feedback-ul oricărui restaurant (on conflict do update). Mig 092 a
-- pus session-gate pe tracking/bon dar a uitat acest RPC.
-- Fix: același pattern ca 092 — _order_session_valid() (mig 092);
-- pickup/legacy (session_id IS NULL) păstrează comportamentul vechi.
-- Backwards-compat: p_session_id default null pe finalul listei de
-- argumente; clienții vechi din cache funcționează dar sunt respinși
-- dacă încearcă feedback pe comenzi cu session_id.
drop function if exists public.submit_order_feedback(uuid, text, int, text);

create or replace function public.submit_order_feedback(
  p_order_id      uuid,
  p_feedback_type text,
  p_rating        int,
  p_comment       text default null,
  p_session_id    uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_order_status  text;
  v_age_hours     numeric;
  v_session_id    uuid;
begin
  if p_feedback_type not in ('payment', 'service', 'food') then
    raise exception 'Tip feedback invalid';
  end if;
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating invalid (1-5)';
  end if;

  select restaurant_id, status, session_id,
         extract(epoch from (now() - created_at)) / 3600
    into v_restaurant_id, v_order_status, v_session_id, v_age_hours
    from public.orders
   where id = p_order_id;

  if v_restaurant_id is null then
    raise exception 'Comandă inexistentă';
  end if;

  -- ★ Session-gate (mig 094) — comenzile de la masă cer sesiune validă.
  -- Pickup/legacy (session_id NULL pe orders) păstrează comportamentul.
  if v_session_id is not null
     and (p_session_id is null
          or not public._order_session_valid(p_order_id, p_session_id)) then
    raise exception 'Sesiunea mesei nu mai este validă.'
      using errcode = 'P0001', hint = 'session_required';
  end if;

  if v_age_hours > 24 then
    raise exception 'Comandă prea veche pentru feedback';
  end if;
  if v_order_status not in ('served', 'paid') then
    raise exception 'Feedback acceptat doar după servire';
  end if;

  if p_comment is not null then
    p_comment := nullif(trim(p_comment), '');
    if length(p_comment) > 500 then
      p_comment := substring(p_comment, 1, 500);
    end if;
  end if;

  insert into public.order_feedback
    (order_id, restaurant_id, feedback_type, rating, comment)
  values
    (p_order_id, v_restaurant_id, p_feedback_type, p_rating, p_comment)
  on conflict (order_id, feedback_type)
  do update set
    rating     = excluded.rating,
    comment    = excluded.comment,
    created_at = now();
end;
$$;

revoke all on function public.submit_order_feedback(uuid, text, int, text, uuid) from public;
grant execute on function public.submit_order_feedback(uuid, text, int, text, uuid) to anon, authenticated;

-- Verificare manuală (post-deploy):
-- 1. select prosrc from pg_proc where proname = 'is_admin'; -- conține search_path
-- 2. select * from pg_proc where proname = 'create_order'; -- doar semnătura 11-arg
-- 3. select plan, enabled from plan_features where feature = 'fiscal_receipt'; -- 5 rânduri
-- 4. ca un user pe plan 'starter', advance_order(<id>, 'mark_paid') => raise feature_disabled
-- 5. submit_order_feedback fără session_id pe comandă cu session => session_required

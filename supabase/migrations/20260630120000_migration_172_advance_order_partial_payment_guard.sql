-- mig 172 — advance_order『mark_paid』: respectă plățile parțiale (anti dublă-încasare)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul adânc (CRITICAL). `add_partial_payment` (mig 017) lasă comanda în
-- status 'served' până când suma cumulată din `order_payments` ≥ total, moment
-- în care setează `paid_amount = sum(order_payments)`. Dar „Plata integrală" din
-- UI cheamă `advance_order(action='mark_paid', p_paid_amount=order.total)`, iar
-- ramura mark_paid (mig 147) făcea `paid_amount = coalesce(p_paid_amount, paid_amount)`
-- FĂRĂ să consulte `order_payments`. Rezultat: o comandă cu o plată parțială de 50
-- (din 200) finalizată cu „Plata integrală 200" ajungea cu order_payments=[50] ȘI
-- paid_amount=200 → dublă-numărare a banilor (50 + 200 pe o comandă de 200).
--
-- Fix (regula de aur: bani + bon = corectitudine gate-uită server-side):
--   În ramura mark_paid, când comanda are deja plăți parțiale (sum(order_payments)>0),
--   tratăm `p_paid_amount` ca RESTUL de achitat, NU ca totalul:
--     • validăm că parțial + rest NU depășește totalul comenzii (anti supra-încasare);
--     • inserăm restul în `order_payments` ca registrul să rămână complet
--       (invariant: paid_amount == sum(order_payments) pentru comenzile plătite);
--     • setăm paid_amount = parțial + rest = total.
--   Când NU există plăți parțiale, comportamentul rămâne IDENTIC cu mig 147.
--
-- Recreare din corpul EFECTIV curent (mig 147) VERBATIM, cu singura modificare în
-- ramura mark_paid. Semnătura, search_path, `for update of o` (#10), gate-ul fiscal,
-- guard-ul cancel_reason (ADV-1) și grant-urile rămân identice.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

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
  v_partial numeric;  -- mig 172: suma plăților parțiale deja înregistrate
  v_final   numeric;  -- mig 172: restul de achitat la „Plata integrală"
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
  where o.id = p_order_id
  for update of o;  -- #10 (mig 147): lock exclusiv pe rândul orders, serializează tranziția

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

      -- mig 172: plățile parțiale deja înregistrate pentru această comandă.
      select coalesce(sum(amount), 0) into v_partial
      from public.order_payments
      where order_id = p_order_id;

      if v_partial > 0 then
        -- Comanda are plăți parțiale → `p_paid_amount` e RESTUL de achitat.
        v_final := coalesce(p_paid_amount, v_order.total - v_partial);
        -- Anti supra-încasare: parțial + rest nu poate depăși totalul comenzii.
        if v_partial + v_final > v_order.total + 0.01 then
          raise exception 'Suma încasată (% parțial + % rest) depășește totalul comenzii (%)',
            v_partial, v_final, v_order.total
            using errcode = 'P0001', hint = 'overpayment';
        end if;
        -- Completăm registrul de plăți (invariant: paid_amount == sum(order_payments)).
        insert into public.order_payments (order_id, amount, method, paid_by)
        values (p_order_id, v_final, coalesce(p_payment_method, 'other'), v_user_id);
        update public.orders
          set status='paid',
              paid_at=now(),
              paid_by=v_user_id,
              payment_method = case
                when (select count(distinct method) from public.order_payments where order_id = p_order_id) = 1
                then (select method from public.order_payments where order_id = p_order_id limit 1)::public.payment_method
                else 'other'::public.payment_method
              end,
              paid_amount = v_partial + v_final,
              tips_amount = coalesce(p_tips_amount, tips_amount)
        where id=p_order_id;
      else
        -- Fără plăți parțiale: comportament IDENTIC cu mig 147.
        update public.orders
          set status='paid',
              paid_at=now(),
              paid_by=v_user_id,
              payment_method=coalesce(p_payment_method::public.payment_method, payment_method),
              paid_amount=coalesce(p_paid_amount, paid_amount),
              tips_amount=coalesce(p_tips_amount, tips_amount)
        where id=p_order_id;
      end if;

    when 'cancel' then
      if v_role not in ('owner', 'manager', 'waiter') then
        raise exception 'Role % cannot cancel orders', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      -- ★ GUARD ADV-1 (mig 118) — anularea unei comenzi deja servite
      -- (mâncare livrată) cere motiv obligatoriu, pentru integritatea
      -- evidenței/rapoartelor. Statusurile ne-served rămân neschimbate.
      if v_order.status = 'served'
         and (p_cancel_reason is null or length(trim(p_cancel_reason)) = 0) then
        raise exception 'cancel_reason este obligatoriu la anularea unei comenzi servite'
          using errcode = 'P0001', hint = 'cancel_reason_required';
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

-- ── Asserție fail-closed: lock + guard cancel + guard parțial prezente ───────
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'advance_order';
  if v_src is null then raise exception 'mig 172: advance_order lipsește'; end if;
  if position('for update of o' in lower(v_src)) = 0 then
    raise exception 'mig 172: lock-ul `for update of o` lipsește (#10)'; end if;
  if position('cancel_reason_required' in v_src) = 0 then
    raise exception 'mig 172: guard-ul cancel_reason_required (ADV-1) lipsește'; end if;
  if position('overpayment' in v_src) = 0 then
    raise exception 'mig 172: guard-ul anti dublă-încasare (plăți parțiale) lipsește'; end if;
  raise notice 'mig 172: advance_order mark_paid respectă plățile parțiale OK';
end $$;

commit;

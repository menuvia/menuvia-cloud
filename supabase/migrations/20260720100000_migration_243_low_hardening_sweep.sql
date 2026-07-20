-- Migration 243: sweep LOW final (Q4-8) — 3 hardening-uri mici
-- ─────────────────────────────────────────────────────────────────────
-- 1. advance_order (lanț 011→085/087→118→147→172→214→243): mark_paid
--    validează p_payment_method cu ACEEAȘI listă ca add_partial_payment
--    (lanț 017→111→231) — 'card_online' NU poate fi înregistrat manual de
--    staff (plățile online vin EXCLUSIV prin Stripe → settle_table_payment).
--    Până acum orice valoare validă de enum trecea, deci un waiter putea
--    marca o comandă drept „plătită online" fără nicio plată Stripe reală.
--    Restul corpului = copie VERBATIM din mig 214.
-- 2. register_affiliate (lanț 097d→188→224→243): handler unique_violation
--    pe INSERT (același pattern ca create_restaurant, mig 221) — cursa de
--    dublu-submit întoarce răspunsul idempotent 'already' în loc de 23505
--    brut. Corpul = copie VERBATIM din mig 224 + handler-ul.
-- 3. check_reservation_rate_limit (mig 115→129): REVOKE EXECUTE de la
--    anon/authenticated — helper-ul e chemat DOAR de trigger-ul
--    reservations_public_rate_limit (SECURITY DEFINER → rulează ca owner,
--    nu are nevoie de grant). Expus direct, era un oracle slab: un anonim
--    putea sonda dacă un telefon are rezervări recente la un restaurant.
-- ─────────────────────────────────────────────────────────────────────
begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════
-- 1. advance_order — gate pe metoda de plată înregistrabilă manual
-- ═══════════════════════════════════════════════════════════════
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
  v_final   numeric;  -- mig 172: restul de achitat la „Plata integrală
  v_tips    numeric;  -- mig 214: bacșișul, exclus din plafonul de supra-încasare"
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

      -- ★ mig 243: metodele înregistrabile MANUAL de staff — paritate cu
      -- add_partial_payment (lanț 017→111→231). 'card_online' e EXCLUS:
      -- plățile online vin doar prin Stripe → settle_table_payment; un staff
      -- nu poate marca o comandă drept plătită online fără plată reală.
      if p_payment_method is not null
         and p_payment_method not in ('cash', 'card_pos', 'other', 'meal_voucher') then
        raise exception 'Metodă de plată invalidă pentru înregistrare manuală (%)', p_payment_method
          using errcode = 'P0001', hint = 'invalid_payment_method';
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
        v_tips  := coalesce(p_tips_amount, 0);
        -- Anti supra-încasare: parțial + rest (FĂRĂ bacșiș — bacșișul e peste notă,
        -- mig 214) nu poate depăși totalul comenzii.
        if v_partial + (v_final - v_tips) > v_order.total + 0.01 then
          raise exception 'Suma încasată (% parțial + % rest, fără bacșiș) depășește totalul comenzii (%)',
            v_partial, v_final - v_tips, v_order.total
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

-- ═══════════════════════════════════════════════════════════════
-- 2. register_affiliate — handler unique_violation (anti-cursă)
-- ═══════════════════════════════════════════════════════════════
create or replace function public.register_affiliate(
  p_parent_referral_code text default null,
  p_phone                text default null,
  p_note                 text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_existing public.affiliates;
  v_parent  public.affiliates;
  v_code    text;
  v_aff_id  uuid;
  v_try     int := 0;
  v_defaults jsonb;
  v_phone   text;
  v_note    text;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'register_affiliate requires authentication';
  end if;

  -- Idempotent: dacă userul are deja o cerere/cont, întoarce-i starea.
  select * into v_existing from public.affiliates where profile_id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'already', true,
      'affiliate_id', v_existing.id, 'referral_code', v_existing.referral_code,
      'status', v_existing.status);
  end if;

  -- Telefonul e obligatoriu: interviul de calificare e telefonic.
  v_phone := btrim(coalesce(p_phone, ''));
  if length(v_phone) < 5 or length(v_phone) > 32 then
    return jsonb_build_object('ok', false, 'reason', 'phone_required');
  end if;
  v_note := nullif(left(btrim(coalesce(p_note, '')), 1000), '');

  -- Parent opțional (sub-afiliere). Trebuie să existe, să fie ACTIV și ≠ self.
  if p_parent_referral_code is not null and btrim(p_parent_referral_code) <> '' then
    select * into v_parent from public.affiliates
     where referral_code = lower(btrim(p_parent_referral_code)) and status = 'active';
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'parent_not_found');
    end if;
    if v_parent.profile_id = v_uid then
      return jsonb_build_object('ok', false, 'reason', 'parent_is_self');
    end if;
  end if;

  -- Generează un referral_code unic (8 hex = ^[a-z0-9]{6,32}$). Retry pe coliziune.
  -- Codul există de la cerere, dar e INERT până la aprobare (atribuirea din
  -- mig 097c caută doar afiliați 'active').
  loop
    v_try := v_try + 1;
    v_code := substr(md5(gen_random_uuid()::text), 1, 8);
    exit when not exists (select 1 from public.affiliates where referral_code = v_code);
    if v_try > 10 then
      raise exception 'register_affiliate: could not generate unique referral_code';
    end if;
  end loop;

  -- Comisioanele de start = defaulturile setate de fondator (mig 188).
  select value into v_defaults from public.platform_settings
   where key = 'affiliate_commission_defaults';

  -- mig 243: cursă dublu-submit (pre-check-ul de mai sus poate rata un INSERT
  -- concurent) → handler unique_violation cu răspuns IDEMPOTENT, același
  -- pattern ca create_restaurant (mig 221). Un 23505 brut ajungea la client.
  begin
    insert into public.affiliates
      (profile_id, referral_code, parent_affiliate_id, status, phone, application_note,
       setup_bps, recurring_bps, cascade_bps, recurring_cap_months)
    values
      (v_uid, v_code, v_parent.id, 'pending', v_phone, v_note,
       coalesce((v_defaults->>'setup_bps')::int, 3000),
       coalesce((v_defaults->>'recurring_bps')::int, 1000),
       coalesce((v_defaults->>'cascade_bps')::int, 200),
       coalesce((v_defaults->>'recurring_cap_months')::int, 12))
    returning id into v_aff_id;
  exception when unique_violation then
    select * into v_existing from public.affiliates where profile_id = v_uid;
    if found then
      return jsonb_build_object('ok', true, 'already', true,
        'affiliate_id', v_existing.id, 'referral_code', v_existing.referral_code,
        'status', v_existing.status);
    end if;
    -- Nu era cursa pe profil (ex. coliziune improbabilă pe referral_code
    -- strecurată între check și insert) — propagă, clientul poate reîncerca.
    raise;
  end;

  return jsonb_build_object('ok', true, 'affiliate_id', v_aff_id,
    'referral_code', v_code, 'status', 'pending',
    'parent_affiliate_id', v_parent.id);
end$$;

revoke all on function public.register_affiliate(text, text, text) from public, anon;
grant execute on function public.register_affiliate(text, text, text) to authenticated;

comment on function public.register_affiliate(text, text, text) is
  $$Depune cererea de afiliere (status 'pending'): telefon obligatoriu (interviul
  de calificare e telefonic), notă opțională. Fondatorul decide prin
  admin_review_affiliate. Idempotent — un al doilea apel întoarce starea curentă,
  inclusiv sub cursă de dublu-submit (handler unique_violation, mig 243).$$;

-- ═══════════════════════════════════════════════════════════════
-- 3. check_reservation_rate_limit — nu mai e apelabil direct
-- ═══════════════════════════════════════════════════════════════
-- Trigger-ul reservations_public_rate_limit chemă helper-ul dintr-o funcție
-- SECURITY DEFINER (rulează ca owner) — grant-ul direct nu era necesar
-- nimănui și expunea un oracle slab pe telefoane (exception vs. success).
revoke execute on function public.check_reservation_rate_limit(uuid, text)
  from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═══════════════════════════════════════════════════════════════
do $$
declare v_src text;
begin
  -- advance_order: guard-ul nou + TOATE invariantele lanțului păstrate.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'advance_order';
  if v_src is null then raise exception 'mig 243: advance_order lipsește'; end if;
  if position('invalid_payment_method' in v_src) = 0 then
    raise exception 'mig 243: gate-ul pe metoda de plată lipsește din mark_paid'; end if;
  if position('for update of o' in lower(v_src)) = 0 then
    raise exception 'mig 243: lock-ul `for update of o` (mig 147) s-a pierdut'; end if;
  if position('cancel_reason_required' in v_src) = 0 then
    raise exception 'mig 243: guard-ul cancel_reason_required (mig 118) s-a pierdut'; end if;
  if position('overpayment' in v_src) = 0 then
    raise exception 'mig 243: guard-ul anti supra-încasare (mig 172) s-a pierdut'; end if;
  if position('v_final - v_tips' in v_src) = 0 then
    raise exception 'mig 243: excluderea bacșișului (mig 214) s-a pierdut'; end if;
  if position('fiscal_receipt' in v_src) = 0 then
    raise exception 'mig 243: gate-ul fiscal (mig 094) s-a pierdut'; end if;

  -- register_affiliate: handler-ul + invariantele mig 224 păstrate.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'register_affiliate';
  if v_src is null then raise exception 'mig 243: register_affiliate lipsește'; end if;
  if position('unique_violation' in v_src) = 0 then
    raise exception 'mig 243: handler-ul unique_violation lipsește'; end if;
  if position('phone_required' in v_src) = 0 then
    raise exception 'mig 243: telefonul obligatoriu (mig 224) s-a pierdut'; end if;
  if position('''pending''' in v_src) = 0 then
    raise exception 'mig 243: statusul pending (mig 224) s-a pierdut'; end if;
  if position('platform_settings' in v_src) = 0 then
    raise exception 'mig 243: defaulturile de comision (mig 188) s-au pierdut'; end if;

  -- check_reservation_rate_limit: EXECUTE retras de la rolurile client.
  if has_function_privilege('anon', 'public.check_reservation_rate_limit(uuid, text)', 'execute') then
    raise exception 'mig 243: anon încă poate chema check_reservation_rate_limit'; end if;
  if has_function_privilege('authenticated', 'public.check_reservation_rate_limit(uuid, text)', 'execute') then
    raise exception 'mig 243: authenticated încă poate chema check_reservation_rate_limit'; end if;

  raise notice 'mig 243: sweep LOW (metodă plată manuală + cursă afiliere + oracle rate-limit) OK';
end $$;

commit;

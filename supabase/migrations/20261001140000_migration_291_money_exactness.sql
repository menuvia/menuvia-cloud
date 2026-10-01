-- migration_291_money_exactness.sql
-- =============================================================================
-- Două defecte de bani pe lanțul comenzii (Planul 3), reproduse pe replay în
-- tests/sql/money_exactness_assertions.sql ÎNAINTE de reparare.
--
-- ── BF-3 — toleranța ±0,01 la încasare ───────────────────────────────────────
-- `advance_order` mark_paid (262/264/270: `+ 0.01` overpayment, `- 0.01`
-- underpayment pe AMBELE ramuri) și `add_partial_payment` (258: `> total + 0.01`)
-- lăsau o comandă să devină `paid` cu sum(order_payments) ≠ total pe cenți
-- (parțial 50,00 + mark_paid 49,99 → 99,99; parțial 50,00 + 50,01 → 100,01),
-- iar `build_fiscalnet_payload` (guard B3, mig 272) cere egalitate EXACTĂ →
-- bon IMPOSIBIL de emis pe bani încasați, comandă blocată (void refuză pe `paid`).
-- Sumele sunt numeric(10,2), deci exacte: egalitatea se face după round(x,2).
-- `advance_order` = copie VERBATIM a lui 270 (lanț 085/087→…→270→291) cu DOAR
-- pragurile schimbate (+ `round(…,2)` pe suma netă, ca zgomotul de float al
-- clientului, ex. 100.09999999999999, să nu respingă o plată corectă);
-- `add_partial_payment` = copie a lui 258 cu plafon exact + `pg_temp` în path.
-- Hint-urile `overpayment`/`underpayment` rămân.
--
-- ── BF-7 — reducerea peste bani deja încasați ────────────────────────────────
-- `apply_order_discount`/`remove_order_discount` (031) schimbau `orders.total`
-- sub o comandă cu plăți în registru sau cu o plată online în curs: restul de
-- plată devenea nepotrivit cu banii deja luați. Acum: refuz cu hint
-- `discount_over_payments` (order_payments > 0) / `discount_online_payment`
-- (table_payments vii: created/processing sau failed cu intent), statusul
-- `closed` respins ca terminal, `for update` pe comandă, `search_path` explicit
-- cu pg_temp (create or replace îl rescrie).
-- =============================================================================

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. advance_order (copie verbatim 270, praguri exacte)
-- ─────────────────────────────────────────────────────────────────────────────
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
set search_path = public, pg_temp
as $$
declare
  v_order   record;
  v_user_id uuid;
  v_role    text;
  v_partial numeric;  -- mig 172: suma plăților parțiale deja înregistrate
  v_final   numeric;  -- mig 172: suma înmânată la „Plata integrală" (CU bacșiș — contractul PayModal)
  v_tips    numeric;  -- mig 214: bacșișul, exclus din plafonul de supra-încasare
  v_net     numeric;  -- mig 262: banii pe NOTĂ = v_final - v_tips (singura sumă din order_payments/paid_amount)
                      -- mig 264: v_net e plafonat SUS (overpayment) și JOS (underpayment)
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

      -- ★ mig 263 (audit v3 DS-1): pe planurile FISCALE nu există închidere
      -- NEfiscală — regula de aur: bani + bon = Plan 3. Comanda se finalizează
      -- prin mark_paid (bon fiscal), niciodată prin close_order. Gate-ul stă
      -- aici, nu doar în UI (un plan necunoscut client-side arăta „Închide").
      if public.restaurant_has_feature(v_order.restaurant_id, 'fiscal_receipt') then
        raise exception 'Pe planul cu fiscalizare comanda se finalizează prin plată (bon fiscal), nu prin închidere'
          using errcode = 'P0001', hint = 'fiscal_plan_requires_payment';
      end if;

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

      v_tips := coalesce(p_tips_amount, 0);

      if v_partial > 0 then
        -- Comanda are plăți parțiale → `p_paid_amount` e RESTUL înmânat (cu bacșiș).
        v_final := coalesce(p_paid_amount, v_order.total - v_partial + v_tips);
        -- ★ mig 262 (MF-01): pe NOTĂ intră doar v_final - v_tips.
        v_net := round(v_final - v_tips, 2);  -- mig 291: cenți exacți (zgomotul de float al clientului dispare)
        if v_net < 0 then
          raise exception 'Suma încasată (%) nu acoperă bacșișul (%)', v_final, v_tips
            using errcode = 'P0001', hint = 'invalid_amount';
        end if;
        -- ★ mig 291 (BF-3): EGALITATE EXACTĂ pe cenți (fără toleranța ±0,01 din 262/264:
        -- 49,99 peste un parțial de 50,00 dădea 'paid' cu 99,99, iar guard-ul B3 din
        -- build_fiscalnet_payload cere egalitate exactă → bon imposibil).
        -- Anti supra-încasare: parțial + rest (FĂRĂ bacșiș — bacșișul e peste notă,
        -- mig 214) nu poate depăși totalul comenzii.
        if v_partial + v_net > v_order.total then
          raise exception 'Suma încasată (% parțial + % rest, fără bacșiș) depășește totalul comenzii (%)',
            v_partial, v_net, v_order.total
            using errcode = 'P0001', hint = 'overpayment';
        end if;
        -- ★ mig 264: prag INFERIOR. `mark_paid` FINALIZEAZĂ nota; dacă banii de
        -- pe notă nu acoperă totalul, comanda ar deveni 'paid' cu
        -- sum(order_payments) < total, iar guard-ul B3 din build_fiscalnet_payload
        -- (mig 053) ar refuza payload-ul → bon IMPOSIBIL de emis, pe bani deja
        -- încasați. Pentru încasări succesive există `add_partial_payment`.
        if v_partial + v_net < v_order.total then
          raise exception 'Suma încasată (% parțial + % rest, fără bacșiș) nu acoperă totalul comenzii (%) — pentru încasare în tranșe folosește plata parțială',
            v_partial, v_net, v_order.total
            using errcode = 'P0001', hint = 'underpayment';
        end if;
        -- Completăm registrul de plăți (invariant: paid_amount == sum(order_payments)).
        if v_net > 0 then
          insert into public.order_payments (order_id, amount, method, paid_by)
          values (p_order_id, v_net, coalesce(p_payment_method, 'other'), v_user_id);
        end if;
        update public.orders
          set status='paid',
              paid_at=now(),
              paid_by=v_user_id,
              payment_method = case
                when (select count(distinct method) from public.order_payments where order_id = p_order_id) = 1
                then (select method from public.order_payments where order_id = p_order_id limit 1)::public.payment_method
                else 'other'::public.payment_method
              end,
              paid_amount = v_partial + v_net,
              tips_amount = coalesce(p_tips_amount, tips_amount)
        where id=p_order_id;
      else
        -- Fără plăți parțiale (mig 262: bacșișul iese din paid_amount, plafon overpayment).
        if p_paid_amount is not null then
          v_final := p_paid_amount;
          v_net := round(v_final - v_tips, 2);  -- mig 291
          if v_net < 0 then
            raise exception 'Suma încasată (%) nu acoperă bacșișul (%)', v_final, v_tips
              using errcode = 'P0001', hint = 'invalid_amount';
          end if;
          if v_net > v_order.total then
            raise exception 'Suma încasată (% fără bacșiș) depășește totalul comenzii (%)',
              v_net, v_order.total
              using errcode = 'P0001', hint = 'overpayment';
          end if;
          -- ★ mig 264: prag INFERIOR și pe ramura fără parțiale (același motiv).
          if v_net < v_order.total then
            raise exception 'Suma încasată (% fără bacșiș) nu acoperă totalul comenzii (%) — pentru încasare în tranșe folosește plata parțială',
              v_net, v_order.total
              using errcode = 'P0001', hint = 'underpayment';
          end if;
        else
          -- ★ mig 264 (rundă review): NULL pe ramura FĂRĂ plăți parțiale era o
          -- portiță de „bani fără bon". Comportamentul vechi trecea comanda în
          -- 'paid' cu `paid_amount` neatins și ZERO rânduri în `order_payments`;
          -- pe Plan 3 (singurul pe care `mark_paid` e permis — gate-ul mig 124)
          -- guard-ul B3 din `build_fiscalnet_payload` cere
          -- sum(order_payments) == suma liniilor, deci bonul devenea IMPOSIBIL
          -- de emis pe o comandă deja marcată plătită.
          -- Fail-closed DELIBERAT (nu derivăm suma ca pe ramura cu parțiale):
          -- acolo restul e determinat de registrul existent, aici n-avem nicio
          -- probă că banii au fost înmânați — a inventa `total` ar înregistra
          -- venit pe care nu l-a tastat nimeni. Singurul apelant legitim
          -- (`handlePay` → PayModal) trimite MEREU suma; o comandă cu total 0
          -- se închide explicit cu `p_paid_amount => 0`.
          raise exception 'mark_paid cere suma încasată (p_paid_amount) când comanda nu are plăți parțiale'
            using errcode = 'P0001', hint = 'paid_amount_required';
        end if;
        update public.orders
          set status='paid',
              paid_at=now(),
              paid_by=v_user_id,
              payment_method=coalesce(p_payment_method::public.payment_method, payment_method),
              paid_amount=coalesce(v_net, paid_amount),
              tips_amount=coalesce(p_tips_amount, tips_amount)
        where id=p_order_id;
      end if;

    when 'cancel' then
      if v_role not in ('owner', 'manager', 'waiter') then
        raise exception 'Role % cannot cancel orders', v_role
          using errcode = 'P0001', hint = 'role_insufficient';
      end if;
      -- ★ GUARD ADV-1 (mig 118) — anularea unei comenzi deja servite cere motiv.
      if v_order.status = 'served'
         and (p_cancel_reason is null or length(trim(p_cancel_reason)) = 0) then
        raise exception 'cancel_reason este obligatoriu la anularea unei comenzi servite'
          using errcode = 'P0001', hint = 'cancel_reason_required';
      end if;
      -- ★ mig 270 (audit v3 RES-25) — anularea peste BANI ÎNCASAȚI e respinsă.
      -- `add_partial_payment` (258) și `settle_table_payment` split (229) pot
      -- depune bani reali în `order_payments` pe o comandă care rămâne
      -- ne-terminală; un cancel peste ele lăsa banii în sertar/Stripe fără bon
      -- și îi scotea din rapoarte (`v_order_payment_methods` exclude
      -- `cancelled`). Autoritatea e trigger-ul `trg_orders_cancel_ledger_gate`
      -- (în DATE); aici doar mesajul cu suma, ÎNAINTE de orice scriere.
      select coalesce(sum(op.amount), 0) into v_partial
        from public.order_payments op
       where op.order_id = p_order_id;
      if v_partial > 0 then
        raise exception 'Comanda are plăți înregistrate (% lei) și nu poate fi anulată — finalizează prin plată sau cere stornarea plăților', v_partial
          using errcode = 'P0001', hint = 'cancel_over_payments';
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

revoke all on function public.advance_order(uuid, text, numeric, text, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.advance_order(uuid, text, numeric, text, numeric, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. add_partial_payment (copie 258, plafon exact)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.add_partial_payment(
  p_order_id      uuid,
  p_amount        numeric,
  p_method        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order       record;
  v_prev_paid   numeric;
  v_total_paid  numeric;
  v_payment_id  uuid;
  v_amount      numeric;
begin
  if p_method not in ('cash', 'card_pos', 'other', 'meal_voucher') then
    raise exception 'Metodă de plată invalidă.';
  end if;

  if p_amount <= 0 then
    raise exception 'Suma trebuie să fie pozitivă.';
  end if;

  -- mig 291: cenți exacți (coloana e numeric(10,2) oricum).
  v_amount := round(p_amount, 2);
  if v_amount <= 0 then
    raise exception 'Suma trebuie să fie pozitivă.';
  end if;

  select o.id, o.restaurant_id, o.total, o.status
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Comandă negăsită.';
  end if;

  if v_order.status != 'served' then
    raise exception 'Comanda trebuie să fie în status "servit" pentru plată.';
  end if;

  -- Autorizare: membru CU rol de încasare (NU kitchen) — aliniat cu mark_paid.
  if not exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = v_order.restaurant_id
      and user_id = auth.uid()
      and role in ('owner', 'manager', 'waiter')
  ) then
    raise exception 'Nu ai dreptul să încasezi plăți pentru acest restaurant.'
      using hint = 'insufficient_role';
  end if;

  -- Regula de aur: încasarea de bani = bon fiscal = Plan 3. Gate pe feature.
  perform public.enforce_feature_for_restaurant(v_order.restaurant_id, 'fiscal_receipt');

  select coalesce(sum(amount), 0) into v_prev_paid
  from public.order_payments
  where order_id = p_order_id;

  -- PLAFON DE SUPRA-ÎNCASARE EXACT (mig 291, BF-3): suma cumulată nu poate
  -- depăși totalul nicio fracțiune de cent (258 tolera +0,01 → 50,00 + 50,01 la
  -- un total de 100,00 dădea `paid` cu 100,01 și bon imposibil — guard B3).
  -- Bacșișul nu trece prin acest RPC (mig 223).
  if v_prev_paid + v_amount > v_order.total then
    raise exception 'Suma încasată (% deja + % acum) depășește totalul comenzii (%).',
      v_prev_paid, v_amount, v_order.total
      using errcode = 'P0001', hint = 'overpayment';
  end if;

  insert into public.order_payments (order_id, amount, method, paid_by)
  values (p_order_id, v_amount, p_method, auth.uid())
  returning id into v_payment_id;

  select coalesce(sum(amount), 0) into v_total_paid
  from public.order_payments
  where order_id = p_order_id;

  if v_total_paid >= v_order.total then
    update public.orders
    set status = 'paid',
        paid_at = now(),
        paid_by = auth.uid(),
        -- payment_method e enum public.payment_method — castăm explicit.
        payment_method = case
          when (select count(distinct method) from public.order_payments where order_id = p_order_id) = 1
          then p_method::public.payment_method
          else 'other'::public.payment_method
        end,
        paid_amount = v_total_paid
    where id = p_order_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'total_paid', v_total_paid,
    'remaining', greatest(v_order.total - v_total_paid, 0),
    'fully_paid', v_total_paid >= v_order.total
  );
end;
$$;

revoke all on function public.add_partial_payment(uuid, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.add_partial_payment(uuid, numeric, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Reducerea de comandă: gate pe bani deja încasați (BF-7)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_order_discount(
  p_order_id uuid,
  p_type     text,         -- 'percent' or 'amount'
  p_value    numeric,
  p_reason   text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_status        public.order_status;
  v_paid          numeric;
begin
  -- mig 291: lock pe comandă — serializează reducerea cu mark_paid /
  -- add_partial_payment (ambele iau același lock).
  select restaurant_id, status into v_restaurant_id, v_status
    from public.orders
   where id = p_order_id
   for update;

  if v_restaurant_id is null then
    raise exception 'Order % not found', p_order_id;
  end if;

  if not public.is_admin(v_restaurant_id) then
    raise exception 'Only owners/managers can apply discounts';
  end if;

  if v_status in ('paid', 'cancelled', 'closed') then
    raise exception 'Cannot apply discount to a % order', v_status;
  end if;

  -- ★ mig 291 (BF-7): bani deja încasați → totalul nu se mai mișcă.
  select coalesce(sum(op.amount), 0) into v_paid
    from public.order_payments op
   where op.order_id = p_order_id;
  if v_paid > 0 then
    raise exception 'Comanda are plăți înregistrate (% lei) — reducerea nu se mai poate modifica; stornează plățile sau finalizează comanda', v_paid
      using errcode = 'P0001', hint = 'discount_over_payments';
  end if;
  if exists (
    select 1 from public.table_payments tp
     where p_order_id = any (tp.order_ids)
       and (tp.status in ('created', 'processing')
            or (tp.status = 'failed' and tp.stripe_payment_intent_id is not null))
  ) then
    raise exception 'Comanda are o plată online în curs — reducerea nu se mai poate modifica până la finalizarea/anularea ei'
      using errcode = 'P0001', hint = 'discount_online_payment';
  end if;

  -- Validări input
  if p_type not in ('percent', 'amount') then
    raise exception 'Discount type must be percent or amount';
  end if;

  if p_value is null or p_value <= 0 then
    raise exception 'Discount value must be > 0';
  end if;

  if p_type = 'percent' and p_value > 100 then
    raise exception 'Percent discount cannot exceed 100';
  end if;

  -- Aplică
  update public.orders
     set discount_type       = p_type::public.order_discount_type,
         discount_value      = p_value,
         discount_reason     = nullif(trim(coalesce(p_reason, '')), ''),
         discount_applied_by = auth.uid(),
         discount_applied_at = now()
   where id = p_order_id;

  perform public._refresh_order_totals(p_order_id);
  return true;
end;
$$;

revoke all on function public.apply_order_discount(uuid, text, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.apply_order_discount(uuid, text, numeric, text) to authenticated;

create or replace function public.remove_order_discount(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_status        public.order_status;
  v_paid          numeric;
begin
  select restaurant_id, status into v_restaurant_id, v_status
    from public.orders
   where id = p_order_id
   for update;

  if v_restaurant_id is null then
    raise exception 'Order % not found', p_order_id;
  end if;

  if not public.is_admin(v_restaurant_id) then
    raise exception 'Only owners/managers can remove discounts';
  end if;

  if v_status in ('paid', 'cancelled', 'closed') then
    raise exception 'Cannot remove discount on a % order', v_status;
  end if;

  -- ★ mig 291 (BF-7): bani deja încasați → totalul nu se mai mișcă.
  select coalesce(sum(op.amount), 0) into v_paid
    from public.order_payments op
   where op.order_id = p_order_id;
  if v_paid > 0 then
    raise exception 'Comanda are plăți înregistrate (% lei) — reducerea nu se mai poate modifica; stornează plățile sau finalizează comanda', v_paid
      using errcode = 'P0001', hint = 'discount_over_payments';
  end if;
  if exists (
    select 1 from public.table_payments tp
     where p_order_id = any (tp.order_ids)
       and (tp.status in ('created', 'processing')
            or (tp.status = 'failed' and tp.stripe_payment_intent_id is not null))
  ) then
    raise exception 'Comanda are o plată online în curs — reducerea nu se mai poate modifica până la finalizarea/anularea ei'
      using errcode = 'P0001', hint = 'discount_online_payment';
  end if;

  update public.orders
     set discount_type       = null,
         discount_value      = null,
         discount_reason     = null,
         discount_applied_by = null,
         discount_applied_at = null
   where id = p_order_id;

  perform public._refresh_order_totals(p_order_id);
  return true;
end;
$$;

revoke all on function public.remove_order_discount(uuid) from public, anon, authenticated, service_role;
grant execute on function public.remove_order_discount(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Asserții fail-closed (catalog)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_cfg text[];
begin
  select p.prosrc, p.proconfig into v_src, v_cfg
    from pg_proc p
   where p.oid = 'public.advance_order(uuid, text, numeric, text, numeric, text)'::regprocedure;
  if v_src like '%0.01%' then
    raise exception 'mig 291: advance_order mai are toleranta 0.01';
  end if;
  if v_src not like '%cancel_over_payments%' or v_src not like '%for update of o%'
     or v_src not like '%paid_amount_required%' or v_src not like '%fiscal_plan_requires_payment%'
     or v_src not like '%invalid_payment_method%' or v_src not like '%cancel_reason_required%'
     or v_src not like '%underpayment%' or v_src not like '%overpayment%' then
    raise exception 'mig 291: advance_order a pierdut un invariant din lantul 270';
  end if;
  if not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'mig 291: advance_order fara search_path public, pg_temp (%)', v_cfg;
  end if;

  select p.prosrc, p.proconfig into v_src, v_cfg
    from pg_proc p
   where p.oid = 'public.add_partial_payment(uuid, numeric, text)'::regprocedure;
  if v_src like '%0.01%' or v_src not like '%meal_voucher%'
     or v_src not like '%enforce_feature_for_restaurant%' or v_src not like '%overpayment%'
     or v_src not like '%::public.payment_method%' then
    raise exception 'mig 291: add_partial_payment incorect';
  end if;
  if not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'mig 291: add_partial_payment fara pg_temp';
  end if;

  select p.prosrc, p.proconfig into v_src, v_cfg
    from pg_proc p
   where p.oid = 'public.apply_order_discount(uuid, text, numeric, text)'::regprocedure;
  if v_src not like '%discount_over_payments%' or v_src not like '%''closed''%'
     or v_src not like '%for update%' or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'mig 291: apply_order_discount incorect';
  end if;
  select p.prosrc, p.proconfig into v_src, v_cfg
    from pg_proc p
   where p.oid = 'public.remove_order_discount(uuid)'::regprocedure;
  if v_src not like '%discount_over_payments%' or v_src not like '%''closed''%'
     or v_src not like '%for update%' or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'mig 291: remove_order_discount incorect';
  end if;
end;
$$;

commit;

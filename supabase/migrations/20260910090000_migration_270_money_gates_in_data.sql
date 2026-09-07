-- migration_270_money_gates_in_data.sql
-- =============================================================================
-- Audit v3 — două gate-uri pe regula de aur („bani + bon fiscal = gate în
-- RPC/RLS, nu doar în UI") care lipseau din DATE. Ambele sunt LATENTE azi
-- (25 de comenzi plătite, 2 cu registru; zero clienți plătitori), dar
-- structurale: se plătesc la primul split/parțial urmat de un „Anulează",
-- respectiv la primul timeout real de casă urmat de un retry orb.
--
-- ── (A) RES-25 — „Anulează" peste bani deja încasați ─────────────────────────
-- Ramura `cancel` a lui `advance_order` verifica DOAR rolul și motivul (mig
-- 118), niciodată registrul `order_payments`. Dar `add_partial_payment` (258)
-- și `settle_table_payment` split (229) depun bani REALI în registru pe o
-- comandă care rămâne ne-terminală (`served` cu 60/100 încasați; `preparing`
-- cu 40 lei `card_online` capturați pe Stripe). Un cancel peste ele:
--   • banii rămân în sertar / pe Stripe, fără niciun bon (regula de aur, pe
--     direcția opusă lui MF-01);
--   • dispar din rapoarte (`v_order_payment_methods`, mig 267, exclude
--     `cancelled` pe AMBELE ramuri), dar `cash_collected_for_shift` (032) îi
--     mai numără → sertarul și rapoartele nu mai spun aceeași poveste;
--   • politica „orders: admin all" permite și PATCH-ul direct prin PostgREST,
--     deci un guard DOAR în RPC n-ar închide clasa (lecția mig 263→264).
-- Fix: trigger `trg_orders_cancel_ledger_gate` (BEFORE UPDATE pe `orders`,
-- oglinda lui `trg_orders_closed_fiscal_gate` din 264) + același guard în
-- `advance_order` (lanț 118→147→172→214→243→262→263→264→**270**, copie
-- VERBATIM a corpului din 264 + guard-ul, cu TOATE invariantele păstrate),
-- ca mesajul cu suma să ajungă la ospătar ÎNAINTE de orice scriere.
-- Singurul scriitor viu de `status='cancelled'` pe `orders` e `advance_order`
-- (verificat: 030/041/158/227/257 scriu pe ALTE tabele), deci gate-ul nu rupe
-- niciun flux legitim. Anularea comenzilor FĂRĂ bani rămâne neschimbată.
-- Ieșirea din gate (A3): `void_order_payment` — storno cu motiv, doar admin,
-- doar comenzi ne-terminale, audit_log. Fără ea gate-ul ar bloca PERMANENT o
-- masă cu split online pe o comandă pe care bucătăria n-o poate onora
-- (echipa roșie). NU intră: refund automat Stripe (rămâne manual, ca azi).
--
-- ── (B) RES-31 — retry-ul bonului AMBIGUU, gate doar în UI ────────────────────
-- `bridge_retry_receipt` (030→038→262) nu citea `error_info`: markerul
-- „POSIBIL DUPLICAT" (scris de bridge/lib/fiscalnet.js la timeout/abort DUPĂ
-- predarea către driver și de `bridge_mark_stale_as_error` la >10 min în
-- `sent`) era verificat DOAR de BridgeTab (confirmDialog). Un apel direct al
-- RPC-ului cu JWT-ul propriu, un bundle vechi (PWA) sau orice suprafață
-- viitoare re-punea rândul în `pending` cu markerul ȘTERS, `bridge_get_pending`
-- îl ridica și casa tipărea al DOILEA bon fiscal real (bandă + raport Z +
-- ANAF) — ireversibil, spre deosebire de tichetele de bucătărie (227).
-- Reprodus pe replay: retry fără gate → `pending`, `error_info` NULL.
-- Fix: semnătură NOUĂ `bridge_retry_receipt(uuid, boolean default false)`
-- (DROP + CREATE — un `create or replace` ar lăsa vechea semnătură și
-- PostgREST ar răspunde PGRST203 la orice apel, ca la `register_affiliate`
-- 243); gate pe MARKER cu hint `ambiguous_receipt` dacă `p_ack_ambiguous`
-- nu e true; apelul cu 1 argument rămâne valid (default) → AV7 neschimbat.
-- Backstop în DATE: `authenticated` are UPDATE pe `pending_receipts` (030)
-- sub politica `admin manage`, fără niciun trigger BEFORE UPDATE → un PATCH
-- direct `status='pending'` ocolea și RPC-ul. `trg_pending_receipts_block_client_repend`
-- (funcție NE-definer — trebuie să vadă rolul APELANTULUI) respinge tranziția
-- →`pending` din rolurile client; RPC-ul DEFINER trece (current_user =
-- owner-ul funcției). INSERT-ul NU se blochează: enqueue-ul mig 259 poate
-- rula ca authenticated pe INSERT-direct-paid.
--
-- Teste permanente: tests/sql/cancel_ledger_gate_assertions.sql (CL1–CL5),
-- tests/sql/receipt_retry_ambiguous_assertions.sql (RR1–RR7).
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ─────────────────────────────────────────────────────────────────────────────
-- A1. enforce_cancel_ledger_gate — gate-ul de anulare peste registru, în DATE
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_cancel_ledger_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paid numeric;
begin
  -- Doar pe tranziția EFECTIVĂ spre 'cancelled'; 'cancelled'→'cancelled' nu
  -- re-declanșează gate-ul (paritate cu 124/264). Forma e TG_OP-safe ca 259/264
  -- (pe INSERT `old` nu există); un INSERT direct 'cancelled' nu poate avea
  -- registru (FK-ul din order_payments cere comanda existentă), dar trigger-ul
  -- e oglinda EXACTĂ a lui trg_orders_closed_fiscal_gate.
  if new.status = 'cancelled'
     and (tg_op = 'INSERT' or old.status is distinct from 'cancelled') then
    select coalesce(sum(op.amount), 0) into v_paid
      from public.order_payments op
     where op.order_id = new.id;
    if v_paid > 0 then
      raise exception 'Comanda are plăți înregistrate (% lei) și nu poate fi anulată — finalizează prin plată sau cere stornarea plăților', v_paid
        using errcode = 'P0001', hint = 'cancel_over_payments';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_cancel_ledger_gate() from public;

drop trigger if exists trg_orders_cancel_ledger_gate on public.orders;
create trigger trg_orders_cancel_ledger_gate
  before insert or update on public.orders
  for each row
  execute function public.enforce_cancel_ledger_gate();

comment on function public.enforce_cancel_ledger_gate() is
  'mig 270 (audit v3 RES-25): orders.status->cancelled e respins cand order_payments are bani pe comanda (hint cancel_over_payments). In DATE, nu doar in RPC — inchide si PATCH-ul direct sub „orders: admin all".';

-- ─────────────────────────────────────────────────────────────────────────────
-- A2. advance_order — copie VERBATIM a corpului din 264 + guard-ul din `cancel`
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
        v_net := v_final - v_tips;
        if v_net < 0 then
          raise exception 'Suma încasată (%) nu acoperă bacșișul (%)', v_final, v_tips
            using errcode = 'P0001', hint = 'invalid_amount';
        end if;
        -- Anti supra-încasare: parțial + rest (FĂRĂ bacșiș — bacșișul e peste notă,
        -- mig 214) nu poate depăși totalul comenzii.
        if v_partial + v_net > v_order.total + 0.01 then
          raise exception 'Suma încasată (% parțial + % rest, fără bacșiș) depășește totalul comenzii (%)',
            v_partial, v_net, v_order.total
            using errcode = 'P0001', hint = 'overpayment';
        end if;
        -- ★ mig 264: prag INFERIOR. `mark_paid` FINALIZEAZĂ nota; dacă banii de
        -- pe notă nu acoperă totalul, comanda ar deveni 'paid' cu
        -- sum(order_payments) < total, iar guard-ul B3 din build_fiscalnet_payload
        -- (mig 053) ar refuza payload-ul → bon IMPOSIBIL de emis, pe bani deja
        -- încasați. Pentru încasări succesive există `add_partial_payment`.
        if v_partial + v_net < v_order.total - 0.01 then
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
          v_net := v_final - v_tips;
          if v_net < 0 then
            raise exception 'Suma încasată (%) nu acoperă bacșișul (%)', v_final, v_tips
              using errcode = 'P0001', hint = 'invalid_amount';
          end if;
          if v_net > v_order.total + 0.01 then
            raise exception 'Suma încasată (% fără bacșiș) depășește totalul comenzii (%)',
              v_net, v_order.total
              using errcode = 'P0001', hint = 'overpayment';
          end if;
          -- ★ mig 264: prag INFERIOR și pe ramura fără parțiale (același motiv).
          if v_net < v_order.total - 0.01 then
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

revoke all on function public.advance_order(uuid, text, numeric, text, numeric, text) from public;
grant execute on function public.advance_order(uuid, text, numeric, text, numeric, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- A3. void_order_payment — IEȘIREA din gate: banii RETURNAȚI se stornează
--     Fără ea, gate-ul ar produce un BLOCAJ operațional (echipa roșie): un
--     split online pe o comandă `preparing` pe care bucătăria n-o poate onora
--     → cancel respins, close_order respins pe Plan 3 (264), mark_paid = bon
--     fals, close_session_orders refuză cât timp comanda e ne-terminală → masa
--     rămâne ocupată PERMANENT. Storno-ul e calea legitimă: banii au fost
--     RETURNAȚI clientului (cash înapoi / refund manual în Stripe — NU se face
--     refund automat aici), adminul (owner/manager, NU waiter) stornează cu
--     motiv obligatoriu, rândul iese din registru și rămâne în audit_log
--     (old_data = rândul + void_reason), abia apoi anularea trece.
--     Doar comenzi NE-terminale: pe `paid` registrul e sursa bonului emis.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.void_order_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid;
  v_pay   record;
  v_order record;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'Authentication required'
      using errcode = 'P0001', hint = 'auth_required';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Motivul stornării e obligatoriu'
      using errcode = 'P0001', hint = 'void_reason_required';
  end if;

  select op.* into v_pay from public.order_payments op where op.id = p_payment_id for update;
  if not found then
    raise exception 'Plata nu există'
      using errcode = 'P0001', hint = 'payment_not_found';
  end if;
  select o.id, o.restaurant_id, o.status into v_order
    from public.orders o where o.id = v_pay.order_id for update;

  if not public.is_admin(v_order.restaurant_id) then
    raise exception 'Doar owner/manager pot storna o plată înregistrată'
      using errcode = 'P0001', hint = 'role_insufficient';
  end if;
  if v_order.status in ('paid', 'cancelled', 'closed') then
    raise exception 'Comanda e finalizată (%) — plata nu se mai poate storna', v_order.status
      using errcode = 'P0001', hint = 'order_terminal';
  end if;

  delete from public.order_payments where id = p_payment_id;

  insert into public.audit_log
    (actor_id, actor_role, table_name, operation, row_id, restaurant_id, old_data, new_data, changed_keys)
  values
    (v_user, 'authenticated', 'order_payments', 'DELETE', p_payment_id::text, v_order.restaurant_id,
     to_jsonb(v_pay) || jsonb_build_object('void_reason', trim(p_reason)), null, null);

  return jsonb_build_object('ok', true, 'order_id', v_pay.order_id,
                            'amount', v_pay.amount, 'method', v_pay.method);
end;
$$;

revoke all on function public.void_order_payment(uuid, text) from public, anon;
grant execute on function public.void_order_payment(uuid, text) to authenticated;

comment on function public.void_order_payment(uuid, text) is
  'mig 270 (audit v3 RES-25): storno pe o plata din order_payments — banii au fost RETURNATI (cash / refund manual Stripe). Doar owner/manager, motiv obligatoriu, doar comenzi ne-terminale; randul sters + audit_log DELETE cu void_reason. Iesirea legitima din gate-ul cancel_over_payments.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A4. void_order_payments_and_cancel — storno pe TOATE plățile + anulare, ATOMIC
--     Clientul nu are voie să facă N storno-uri + un cancel ca N+1 cereri:
--     un eșec la mijloc lăsa registrul stornat parțial sau comanda deschisă
--     cu registrul gol (recenzie CodeRabbit pe #246). Un singur RPC = o
--     singură tranzacție: orice eșec (rol, motiv, terminal, gate) rulează
--     înapoi TOT. Reutilizează void_order_payment (audit per plată) și
--     advance_order (toate invariantele lanțului, inclusiv gate-ul din 270).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.void_order_payments_and_cancel(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid;
  v_order record;
  v_pay   record;
  v_res   jsonb;
  v_n     integer := 0;
  v_sum   numeric := 0;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'Authentication required'
      using errcode = 'P0001', hint = 'auth_required';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Motivul stornării e obligatoriu'
      using errcode = 'P0001', hint = 'void_reason_required';
  end if;

  select o.id, o.restaurant_id, o.status into v_order
    from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Order not found'
      using errcode = 'P0001', hint = 'order_not_found';
  end if;
  if not public.is_admin(v_order.restaurant_id) then
    raise exception 'Doar owner/manager pot storna plăți și anula comanda'
      using errcode = 'P0001', hint = 'role_insufficient';
  end if;
  if v_order.status in ('paid', 'cancelled', 'closed') then
    raise exception 'Comanda e finalizată (%)', v_order.status
      using errcode = 'P0001', hint = 'order_terminal';
  end if;

  -- Fiecare storno trece prin void_order_payment (aceleași gate-uri + audit_log).
  for v_pay in
    select op.id from public.order_payments op
     where op.order_id = p_order_id
     order by op.created_at, op.id
  loop
    v_res := public.void_order_payment(v_pay.id, p_reason);
    v_n   := v_n + 1;
    v_sum := v_sum + coalesce((v_res->>'amount')::numeric, 0);
  end loop;

  -- Anularea prin lanțul oficial: cancel_reason_required, gate-ul de registru
  -- (acum gol), trigger-ele — nimic nu e ocolit.
  perform public.advance_order(p_order_id, 'cancel', null, null, null, p_reason);

  return jsonb_build_object('ok', true, 'order_id', p_order_id,
                            'voided_count', v_n, 'voided_amount', v_sum);
end;
$$;

revoke all on function public.void_order_payments_and_cancel(uuid, text) from public, anon;
grant execute on function public.void_order_payments_and_cancel(uuid, text) to authenticated;

comment on function public.void_order_payments_and_cancel(uuid, text) is
  'mig 270 (audit v3 RES-25, recenzie): storno pe TOATE platile comenzii + anulare intr-o singura tranzactie (all-or-nothing). Doar owner/manager, motiv obligatoriu, doar comenzi ne-terminale. Compune void_order_payment + advance_order.';

-- ─────────────────────────────────────────────────────────────────────────────
-- B1. bridge_retry_receipt — lanț 030→038→262→270: semnătură nouă cu ack
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.bridge_retry_receipt(uuid);

create function public.bridge_retry_receipt(p_receipt_id uuid, p_ack_ambiguous boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_bon_number    text;
  v_status        text;
  v_order_id      uuid;
  v_error_info    text;
  v_payload       text;
  v_total         numeric;
  v_updated       int;
begin
  select restaurant_id, bon_number, status, order_id, error_info
    into v_restaurant_id, v_bon_number, v_status, v_order_id, v_error_info
    from public.pending_receipts
   where id = p_receipt_id;

  if not found then return false; end if;

  if not public.is_admin(v_restaurant_id) then
    raise exception 'Only owners/managers can retry receipts';
  end if;

  -- BRIDGE-001 GUARD (mig 038): bon cu număr fiscal = deja tipărit. NU retry.
  if v_bon_number is not null then
    raise exception 'Bonul a fost deja tipărit fiscal (Nr. %). Pentru anulare, folosește bon de stornare la casa de marcat.', v_bon_number
      using errcode = 'P0001', hint = 'already_printed';
  end if;

  -- Doar 'error' sau 'cancelled' permit retry (nu 'sent', care e ambiguu).
  if v_status not in ('error', 'cancelled') then
    return false;
  end if;

  -- ★ mig 270 (audit v3 RES-31): eșecul AMBIGUU cere confirmare EXPLICITĂ.
  -- Markerul „POSIBIL DUPLICAT" e scris de bridge (fiscalnet.js: timeout /
  -- abort DUPĂ predarea către driver) și de cron (bridge_mark_stale_as_error,
  -- mig 262): bonul POATE fi deja pe bandă. Până acum bariera trăia DOAR în
  -- BridgeTab (confirmDialog) — un apel direct al RPC-ului, un bundle vechi
  -- sau orice suprafață viitoare re-punea rândul în `pending` cu markerul
  -- ȘTERS, iar casa tipărea al doilea bon fiscal REAL (bandă + Z + ANAF).
  -- Gate-ul e pe MARKER, nu pe error_code (bridge-ul scrie coduri diferite;
  -- markerul e singurul contract comun) și e independent de status (cancel
  -- NU șterge error_info). Oglinda lui `enqueue_invoice_for_order` (262).
  -- Prefix (`like 'POSIBIL DUPLICAT%'`), paritate EXACTĂ cu gate-ul Oblio din
  -- enqueue_invoice_for_order (262): ambele surse pun markerul la ÎNCEPUT;
  -- un error_info care doar CITEAZĂ textul (ex. urma de ack de mai jos) NU
  -- e ambiguu.
  if coalesce(v_error_info, '') like 'POSIBIL DUPLICAT%'
     and coalesce(p_ack_ambiguous, false) is not true then
    raise exception 'Bonul are un eșec AMBIGUU (poate fi deja tipărit). Verifică banda casei și confirmă explicit retrimiterea.'
      using errcode = 'P0001', hint = 'ambiguous_receipt';
  end if;

  -- ★ mig 262 (MF-02): payload-ul se reconstruiește din starea CURENTĂ a
  -- comenzii. Rândurile cu payload '' (eșec de build la enqueue — mig 259)
  -- intrau în buclă EMPTY_PAYLOAD la nesfârșit; o editare de staff după
  -- enqueue nu se reflecta pe bon. Bonul n-a fost tipărit (bon_number null),
  -- deci regenerarea e sigură.
  begin
    v_payload := public.build_fiscalnet_payload(v_order_id);
  exception when others then
    raise exception 'Bonul nu poate fi retrimis: payload-ul fiscal nu a putut fi regenerat (%)', sqlerrm
      using errcode = 'P0001', hint = 'payload_build_failed';
  end;

  select total into v_total from public.orders where id = v_order_id;

  update public.pending_receipts
     set status           = 'pending',
         payload          = v_payload,
         total_snapshot   = coalesce(v_total, total_snapshot),
         bridge_device_id = null,
         claimed_at       = null,
         completed_at     = null,
         error_code       = null,
         -- Pe retry-ul AMBIGUU confirmat lăsăm o URMĂ (trasabilitate fiscală):
         -- cine a confirmat verificarea benzii și când. bridge_confirm_receipt
         -- o suprascrie oricum la următorul rezultat; pe eșec clar rămâne NULL.
         error_info       = case
           when coalesce(v_error_info, '') like 'POSIBIL DUPLICAT%'
             then 'Retrimis după verificarea benzii (ack admin '
                  || coalesce(auth.uid()::text, '?') || ' la '
                  || to_char(now() at time zone 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI') || ')'
           else null
         end
   where id     = p_receipt_id
     and status in ('error', 'cancelled')
     and bon_number is null;  -- double check

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.bridge_retry_receipt(uuid, boolean) from public, anon;
grant execute on function public.bridge_retry_receipt(uuid, boolean) to authenticated;

comment on function public.bridge_retry_receipt(uuid, boolean) is
  'Retrimite un bon error/cancelled fara numar fiscal. mig 262: regenereaza payload-ul (hint payload_build_failed). mig 270: esecul AMBIGUU (marker POSIBIL DUPLICAT) cere p_ack_ambiguous=true (hint ambiguous_receipt) — retry-ul orb = bon fiscal DUBLU real.';

-- ─────────────────────────────────────────────────────────────────────────────
-- B2. Backstop în DATE: rolurile client nu pot re-pune un bon în `pending`
--     prin UPDATE direct (calea PostgREST sub „admin manage", mig 030).
--     Funcție NE-definer DELIBERAT: trebuie să vadă rolul apelantului;
--     din RPC-ul DEFINER current_user e owner-ul funcției, deci trece.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_pending_receipts_block_client_repend()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'pending'
     and old.status is distinct from 'pending'
     and current_user in ('anon', 'authenticated') then
    raise exception 'Un bon nu se re-pune in coada prin UPDATE direct — foloseste bridge_retry_receipt (verifica banda casei pe esec ambiguu)'
      using errcode = 'P0001', hint = 'direct_repend_forbidden';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_pending_receipts_block_client_repend() from public;

drop trigger if exists trg_pending_receipts_block_client_repend on public.pending_receipts;
create trigger trg_pending_receipts_block_client_repend
  before update of status on public.pending_receipts
  for each row
  execute function public.fn_pending_receipts_block_client_repend();

comment on function public.fn_pending_receipts_block_client_repend() is
  'mig 270 (audit v3 RES-31): backstop in DATE — anon/authenticated nu pot trece un pending_receipts inapoi in pending prin UPDATE direct; singura cale e bridge_retry_receipt (DEFINER, cu gate pe markerul ambiguu).';

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_src text; v_sig text; v_n int; v_tgtype smallint;
begin
  -- A. advance_order: guard-ul nou + TOATE invariantele lanțului 243/262/263/264.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'advance_order';
  if v_src is null then raise exception 'mig 270: advance_order lipseste'; end if;
  foreach v_sig in array array['cancel_over_payments',
                               'underpayment', 'overpayment', 'fiscal_plan_requires_payment',
                               'table_lifecycle', 'invalid_payment_method', 'for update of o',
                               'cancel_reason_required', 'v_final - v_tips', 'fiscal_receipt',
                               'values (p_order_id, v_net', 'paid_amount = v_partial + v_net',
                               'paid_amount=coalesce(v_net, paid_amount)',
                               'paid_amount_required'] loop
    if position(v_sig in lower(v_src)) = 0 and position(v_sig in v_src) = 0 then
      raise exception 'mig 270: advance_order a pierdut invariantul „%"', v_sig; end if;
  end loop;
  if (length(v_src) - length(replace(v_src, 'hint = ''underpayment''', ''))) / length('hint = ''underpayment''') < 2 then
    raise exception 'mig 270: pragul underpayment nu mai e pe ambele ramuri ale mark_paid'; end if;

  -- Trigger-ul de anulare: exista, e BEFORE + UPDATE, pe orders, si citeste registrul.
  select tgtype into v_tgtype from pg_trigger
   where tgname = 'trg_orders_cancel_ledger_gate' and tgrelid = 'public.orders'::regclass and not tgisinternal;
  if v_tgtype is null then raise exception 'mig 270: trg_orders_cancel_ledger_gate lipseste'; end if;
  if (v_tgtype & 2) = 0 or (v_tgtype & 4) = 0 or (v_tgtype & 16) = 0 or (v_tgtype & 1) = 0 then
    raise exception 'mig 270: trg_orders_cancel_ledger_gate trebuie sa fie BEFORE INSERT OR UPDATE FOR EACH ROW (tgtype=%)', v_tgtype; end if;
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_cancel_ledger_gate';
  if position('order_payments' in v_src) = 0 or position('cancel_over_payments' in v_src) = 0 then
    raise exception 'mig 270: enforce_cancel_ledger_gate nu citeste registrul / nu are hint-ul'; end if;

  -- A3. void_order_payment: DEFINER + pg_temp, gate is_admin, doar ne-terminale, audit.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'void_order_payment';
  if v_src is null then raise exception 'mig 270: void_order_payment lipseste (gate-ul ar fi un blocaj fara iesire)'; end if;
  foreach v_sig in array array['is_admin', 'audit_log', 'order_terminal', 'void_reason_required',
                               'delete from public.order_payments', 'for update'] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'mig 270: void_order_payment a pierdut invariantul „%"', v_sig; end if;
  end loop;
  if position('security definer' in lower(v_src)) = 0 or position('pg_temp' in v_src) = 0 then
    raise exception 'mig 270: void_order_payment nu e DEFINER cu pg_temp'; end if;
  if has_function_privilege('anon', 'public.void_order_payment(uuid, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.void_order_payment(uuid, text)', 'EXECUTE') then
    raise exception 'mig 270: grant-urile pe void_order_payment sunt gresite'; end if;

  -- A4. void_order_payments_and_cancel: DEFINER + pg_temp, compune void + advance.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'void_order_payments_and_cancel';
  if v_src is null then raise exception 'mig 270: void_order_payments_and_cancel lipseste (storno+cancel ar fi N+1 cereri)'; end if;
  foreach v_sig in array array['public.void_order_payment(', 'public.advance_order(', 'is_admin',
                               'void_reason_required', 'order_terminal', 'for update'] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'mig 270: void_order_payments_and_cancel a pierdut invariantul „%"', v_sig; end if;
  end loop;
  if position('security definer' in lower(v_src)) = 0 or position('pg_temp' in v_src) = 0 then
    raise exception 'mig 270: void_order_payments_and_cancel nu e DEFINER cu pg_temp'; end if;
  if has_function_privilege('anon', 'public.void_order_payments_and_cancel(uuid, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.void_order_payments_and_cancel(uuid, text)', 'EXECUTE') then
    raise exception 'mig 270: grant-urile pe void_order_payments_and_cancel sunt gresite'; end if;

  -- B. bridge_retry_receipt: EXACT o semnatura (anti-overload PostgREST), DEFINER
  --    cu pg_temp, gate-ul pe marker + TOATE invariantele 038/262.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_retry_receipt';
  if v_n <> 1 then
    raise exception 'mig 270: bridge_retry_receipt are % semnaturi (PostgREST ar raspunde PGRST203)', v_n; end if;
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_retry_receipt';
  foreach v_sig in array array['POSIBIL DUPLICAT', 'ambiguous_receipt', 'p_ack_ambiguous',
                               'build_fiscalnet_payload', 'payload_build_failed',
                               'already_printed', 'is_admin',
                               'status in (''error'', ''cancelled'')', 'bon_number is null'] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'mig 270: bridge_retry_receipt a pierdut invariantul „%"', v_sig; end if;
  end loop;
  if position('security definer' in lower(v_src)) = 0 or position('pg_temp' in v_src) = 0 then
    raise exception 'mig 270: bridge_retry_receipt nu e DEFINER cu pg_temp'; end if;
  if not has_function_privilege('authenticated', 'public.bridge_retry_receipt(uuid, boolean)', 'EXECUTE') then
    raise exception 'mig 270: authenticated nu mai poate retrimite bonuri (BridgeTab mort)'; end if;
  if has_function_privilege('anon', 'public.bridge_retry_receipt(uuid, boolean)', 'EXECUTE') then
    raise exception 'mig 270: anon poate retrimite bonuri'; end if;

  -- Backstop-ul pe pending_receipts: BEFORE UPDATE ROW, NE-definer (vede rolul apelantului).
  select tgtype into v_tgtype from pg_trigger
   where tgname = 'trg_pending_receipts_block_client_repend'
     and tgrelid = 'public.pending_receipts'::regclass and not tgisinternal;
  if v_tgtype is null then raise exception 'mig 270: trg_pending_receipts_block_client_repend lipseste'; end if;
  if (v_tgtype & 2) = 0 or (v_tgtype & 16) = 0 or (v_tgtype & 1) = 0 then
    raise exception 'mig 270: trg_pending_receipts_block_client_repend trebuie sa fie BEFORE UPDATE FOR EACH ROW'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'fn_pending_receipts_block_client_repend' and p.prosecdef) then
    raise exception 'mig 270: fn_pending_receipts_block_client_repend NU are voie sa fie DEFINER (ar ascunde rolul apelantului)'; end if;

  raise notice 'mig 270: gate anulare peste registru + gate retry ambiguu, ambele in DATE — OK';
end $$;

commit;

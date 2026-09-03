-- migration_264_audit_v3_council.sql
-- =============================================================================
-- Audit v3 — acțiunile de COD din planul consiliului (rangurile 6 și 9), după
-- ce cele două echipe roșii au atacat remedierile din mig 262/263 și au arătat
-- unde NU închid clasa.
--
--   1. RANG 6a — `advance_order` (lanț →262→263→**264**): plafonul de
--      supra-încasare din 262 e DOAR superior. Echipa roșie a reprodus pe DB
--      viu direcția opusă: `mark_paid` cu o sumă SUB restul de plată lasă
--      sum(order_payments) < total, guard-ul B3 din `build_fiscalnet_payload`
--      (mig 053) refuză payload-ul, iar comanda rămâne 'paid' cu un bon
--      IMPOSIBIL de emis — aceeași consecință ca MF-01, pe cealaltă direcție.
--      Fix: prag INFERIOR (hint `underpayment`) pe AMBELE ramuri. Încasarea în
--      tranșe are deja calea ei: `add_partial_payment`.
--   2. RANG 6b — `enforce_closed_status_gate`: gate-ul fiscal de închidere
--      introdus în 263 stă DOAR în RPC, dar politica „orders: admin all" permite
--      unui owner/manager un `PATCH /rest/v1/orders {status:'closed'}` direct
--      prin PostgREST, ocolindu-l. Trigger-ul e oglinda exactă a mig 124 (care
--      face asta pentru →'paid'): mută gate-ul din RPC în DATE, unde stă restul
--      lanțului fiscal. Acoperă orice cod viitor, nu doar apelanții de azi.
--   3. RANG 9 — `product_extras` / `product_pairings`: mig 262 a reparat SEC-04
--      pe `products`, dar tabelele-soră au rămas cu politici FOR ALL pe rolul
--      PUBLIC care apelează `is_admin`. Verificat pe PRODUCȚIE ca anon:
--      `select count(*) from public.product_extras` → `42501: permission denied
--      for function is_admin`. Adică fallback-ul `fetchMenuLayered` (qr.ts) —
--      pe care CLAUDE.md cere explicit să NU-l ștergem — era mort pentru
--      clientul anonim ori de câte ori RPC-ul compus lipsea.
--      Fix + schimbarea TIPARULUI care a lăsat-o să scape: asserția nu mai e
--      literală pe un tabel, ci de CLASĂ — pentru ORICE tabel pe care anon are
--      grant de SELECT, nicio politică aplicabilă la SELECT nu are voie să stea
--      pe rolul PUBLIC și să apeleze funelul is_admin/is_member/my_role.
--
-- Teste permanente AC1–AC5: tests/sql/audit_v3_council_assertions.sql.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. advance_order — copie a corpului din 263 + pragul inferior (RANG 6a)
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
          v_net := null;  -- comportament vechi: paid_amount rămâne neatins
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
-- 2. enforce_closed_status_gate — oglinda mig 124 pentru →'closed' (RANG 6b)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_closed_status_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Doar pe tranziția EFECTIVĂ spre 'closed' (INSERT direct sau UPDATE din
  -- altă stare); 'closed'→'closed' nu re-declanșează gate-ul (paritate 124).
  if new.status = 'closed'
     and (tg_op = 'INSERT' or old.status is distinct from 'closed') then
    -- Regula de aur, în DATE: pe planurile cu bon fiscal nu există închidere
    -- NEfiscală. Acoperă PostgREST direct (politica „orders: admin all"),
    -- RPC-urile și orice cod viitor — nu doar advance_order/close_session_orders.
    if public.restaurant_has_feature(new.restaurant_id, 'fiscal_receipt') then
      raise exception 'Pe planul cu fiscalizare comanda se finalizează prin plată (bon fiscal), nu prin închidere'
        using errcode = 'P0001', hint = 'fiscal_plan_requires_payment';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_closed_status_gate() from public;

drop trigger if exists trg_orders_closed_fiscal_gate on public.orders;
create trigger trg_orders_closed_fiscal_gate
  before insert or update on public.orders
  for each row
  execute function public.enforce_closed_status_gate();

comment on function public.enforce_closed_status_gate() is
  'mig 264: oglinda mig 124 pentru orders.status->closed. Pe planurile fiscale inchiderea NEfiscala e respinsa in DATE, nu doar in RPC (inchide PATCH-ul direct prin PostgREST sub „orders: admin all").';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. product_extras / product_pairings — roluri explicite (RANG 9)
--    Citirea publică rămâne identică (mig 164); doar politica de ADMIN iese de
--    pe rolul PUBLIC, ca anon să nu mai evalueze `is_admin` (fără EXECUTE).
-- ─────────────────────────────────────────────────────────────────────────────
alter policy "extras: admin manage"   on public.product_extras   to authenticated;
alter policy "pairings: admin manage" on public.product_pairings to authenticated;
alter policy "extras: public read"    on public.product_extras   to anon, authenticated;
alter policy "pairings: public read"  on public.product_pairings to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_src text; v_sig text; r record; v_rupte text := ''; v_oid oid;
begin
  -- 1. advance_order: pragul nou + TOATE invariantele lanțului 243/262/263.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'advance_order';
  if v_src is null then raise exception 'mig 264: advance_order lipseste'; end if;
  foreach v_sig in array array['underpayment', 'overpayment', 'fiscal_plan_requires_payment',
                               'table_lifecycle', 'invalid_payment_method', 'for update of o',
                               'cancel_reason_required', 'v_final - v_tips', 'fiscal_receipt',
                               'values (p_order_id, v_net', 'paid_amount = v_partial + v_net',
                               'paid_amount=coalesce(v_net, paid_amount)'] loop
    if position(v_sig in lower(v_src)) = 0 and position(v_sig in v_src) = 0 then
      raise exception 'mig 264: advance_order a pierdut invariantul „%"', v_sig; end if;
  end loop;
  -- Pragul inferior trebuie sa existe pe AMBELE ramuri (parțiale + fara).
  if (length(v_src) - length(replace(v_src, 'hint = ''underpayment''', ''))) / length('hint = ''underpayment''') < 2 then
    raise exception 'mig 264: pragul underpayment nu e pe ambele ramuri ale mark_paid'; end if;

  -- 2. Trigger-ul de inchidere: exista, e BEFORE pe insert+update, si e fiscal.
  if not exists (select 1 from pg_trigger where tgname = 'trg_orders_closed_fiscal_gate'
                   and tgrelid = 'public.orders'::regclass and not tgisinternal) then
    raise exception 'mig 264: trg_orders_closed_fiscal_gate lipseste'; end if;
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_closed_status_gate';
  if v_src is null or position('fiscal_receipt' in v_src) = 0
     or position('fiscal_plan_requires_payment' in v_src) = 0 then
    raise exception 'mig 264: enforce_closed_status_gate nu mai aplica gate-ul fiscal'; end if;

  -- 3. ASERTIE DE CLASA (nu literala pe un tabel): pentru ORICE tabel pe care
  --    anon are SELECT, nicio politica aplicabila la SELECT nu are voie sa stea
  --    pe rolul PUBLIC si sa apeleze funelul de autorizare — anon nu are EXECUTE
  --    pe is_admin/is_member/my_role, deci evaluarea da 42501 si omoara citirea.
  --    Acesta e tiparul care a lasat product_extras/pairings sa scape din 262.
  -- Privilegiul se verifică în CORPUL buclei, nu în WHERE: planificatorul poate
  -- reordona predicatele și ar evalua has_table_privilege pe rânduri din alte
  -- scheme (a picat o dată pe un pg_toast_*). to_regclass întoarce NULL în loc
  -- să arunce pentru un nume care nu se rezolvă.
  for r in
    select p.tablename, p.policyname, p.cmd
      from pg_policies p
     where p.schemaname = 'public'
       and p.cmd in ('ALL', 'SELECT')
       and p.roles = '{public}'::name[]
       and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ '(is_admin|is_member|my_role)\('
  loop
    v_oid := to_regclass('public.' || quote_ident(r.tablename));
    if v_oid is not null and has_table_privilege('anon', v_oid, 'SELECT') then
      v_rupte := v_rupte || format('%s/%s[%s] ', r.tablename, r.policyname, r.cmd);
    end if;
  end loop;
  if v_rupte <> '' then
    raise exception 'mig 264: politici PUBLIC care rup citirea anon (evalueaza funelul fara EXECUTE): %', v_rupte; end if;

  raise notice 'mig 264: audit v3 consiliu (underpayment + gate inchidere in date + clasa anon/PUBLIC) OK';
end $$;

commit;

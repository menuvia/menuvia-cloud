-- migration_262_audit_v3_hardening.sql
-- =============================================================================
-- Remedieri din auditul v3 (sept 2026 — specialiștii securitate, bani/fiscal
-- și date/migrații), fiecare cu asserție fail-closed aici + suita permanentă
-- tests/sql/audit_v3_hardening_assertions.sql (AV1–AV10) în CI.
--
--   1. SEC-01 (CRITIC) profiles: authenticated avea INSERT + DELETE la nivel de
--      tabelă (mig 047); mig 096a a revocat DOAR UPDATE-ul. Un cont self-signup
--      își putea ȘTERGE rândul și îl putea REINSERA cu is_platform_admin=true
--      + plan='enterprise' → preluarea platformei prin escape-ul
--      is_platform_admin() din funelul is_admin/is_member (mig 186) + Plan 3
--      gratuit, cu MFA irelevant (mfa_enforced era tot al atacatorului). SH3
--      testa doar UPDATE. Fix: revoke insert/delete; politica FOR ALL
--      `profiles_self` se sparge în SELECT + UPDATE; trigger fail-closed anti
--      scriere directă din roluri client (defense-in-depth contra unui GRANT
--      viitor accidental). INSERT-ul legitim vine exclusiv din handle_new_user
--      (DEFINER, base schema); DELETE-ul din cascada auth.users
--      (process_account_deletions, service_role).
--   2. SEC-02 get_restaurant_by_qr_token (anon, mig 054): proiecta încă
--      wifi_password + qr_token — invariantul anti-leak din mig 217 nu i s-a
--      aplicat; fără niciun apelant (fetchRestaurantByQrToken era cod mort) →
--      DROP. Asserție: NICIO funcție executabilă de anon nu mai conține
--      `r.wifi_password` / `r.qr_token` în corp.
--   3. SEC-03 helperi interni cu EXECUTE PUBLIC nerevocat (executabili de
--      anon): _refresh_order_totals, build_fiscalnet_payload (citea liniile
--      fiscale ale oricărei comenzi pe UUID), owner_plan, get_restaurant_features
--      (enumerare de plan), log_ai_import / reserve_ai_import_slot /
--      check_ai_import_quota (scriere în ai_import_log al oricărui tenant).
--      Fix: revoke de la public+anon, grant explicit authenticated+service_role
--      (apelanții reali sunt trigger-e/RPC-uri DEFINER sau dashboard-ul).
--   4. SEC-04 products: politicile erau PUBLIC (fără roluri) — anon evalua
--      is_member (fără EXECUTE) → `permission denied` pe citirea directă, adică
--      fallback-ul fetchMenuLayered (qr.ts) era mort pentru anon; iar read-ul
--      public nu era scopat pe restaurant activ (paritate categories, mig 153).
--      Fix: roluri explicite + is_restaurant_active.
--   5. SEC-05 invite_tokens: „invites: member read" (mig 008) lăsa orice
--      waiter/kitchen să citească emailurile invitaților + token-urile bearer.
--      TeamManager e admin-only → politica devine is_admin.
--   6. MF-01 / MF-05 / DM-01 advance_order (lanț →243→262): PayModal trimite
--      p_paid_amount INCLUSIV bacșișul (grandTotal). Pe ramura cu plăți
--      parțiale rândul din order_payments primea rest+bacșiș → guard-ul B3 din
--      build_fiscalnet_payload (mig 053) respingea payload-ul → rând 'error'
--      cu payload gol → BANI FĂRĂ BON pe Plan 3. Pe ambele ramuri paid_amount
--      includea bacșișul (venit umflat în ReportsTab / v_daily_orders /
--      admin_monthly_benchmark), iar ramura fără parțiale nu avea plafon de
--      supra-încasare (typo 5000 vs 50.00 → venit raportat 5000, bon pe 50).
--      Fix: v_net = v_final - v_tips e SINGURA sumă care intră în
--      order_payments și în paid_amount; plafon overpayment pe AMBELE ramuri;
--      bacșișul rămâne exclusiv în orders.tips_amount. Contractul clientului
--      (p_paid_amount = suma înmânată, cu bacșiș) NU se schimbă.
--   7. MF-02 bridge_retry_receipt (lanț 030→038→262): retry-ul NU regenera
--      payload-ul — rândurile 'error' cu payload '' (eșec de build, ex. mig 259
--      pe INSERT-direct-paid) intrau în buclă EMPTY_PAYLOAD la nesfârșit.
--      Fix: retry-ul reconstruiește payload-ul din starea CURENTĂ a comenzii
--      (bonul n-a fost tipărit: bon_number is null); dacă build-ul eșuează,
--      aruncă hint=payload_build_failed cu cauza (vizibilă în BridgeTab).
--   8. MF-03 bridge_mark_stale_as_error (lanț 030→035→262): nu era chemată de
--      nimeni (bonurile agățate în 'sent' rămâneau așa pentru totdeauna) și
--      marca un eșec AMBIGUU (bonul POATE fi tipărit) ca eroare simplă →
--      retry orb = bon dublu. Fix: error_info poartă markerul POSIBIL DUPLICAT
--      (BridgeTab cere confirmarea benzii); automation-cron o cheamă orar.
--   9. MF-04 enqueue_invoice_for_order (lanț 041→262): dedup-ul excludea
--      'failed' → o factură eșuată AMBIGUU (POSIBIL DUPLICAT / STUCK_GENERATING,
--      mig 218/239 — Oblio POATE fi emis-o deja) putea fi re-cerută de owner din
--      IssueInvoiceModal → a DOUA factură reală. Fix: hint
--      ambiguous_failed_exists până când fondatorul o rezolvă
--      (admin_retry_invoice / anulare explicită după verificare în Oblio).
--      Un 'failed' clar (4xx) rămâne re-emisibil.
--  10. DM-05 / MF-13 igienă: toate funcțiile SECURITY DEFINER cu
--      `search_path = public` (fără pg_temp) primesc `public, pg_temp` prin
--      ALTER FUNCTION (corpul nu se atinge) — convenția din CLAUDE.md, ca mig 194.
--
-- Refuzat la verificare (NU e în migrație): MF-11 „bridge_confirm_receipt fără
-- gardă de status/device" — mig 045 are deja garda pe device
-- (wrong_bridge_device), pe status (invalid_state_for_confirm) și idempotență.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SEC-01 — profiles: fără INSERT/DELETE din roluri client
-- ─────────────────────────────────────────────────────────────────────────────
revoke insert, delete on table public.profiles from public, anon, authenticated;

drop policy if exists "profiles_self" on public.profiles;
create policy "profiles_self_select" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Defense-in-depth: chiar dacă un GRANT viitor re-deschide INSERT/DELETE,
-- scrierea directă din anon/authenticated e respinsă. Rulează cu privilegiile
-- apelantului (NU definer) tocmai ca `current_user` să fie rolul PostgREST;
-- handle_new_user / process_account_deletions sunt DEFINER → current_user =
-- owner-ul funcției, deci trec.
create or replace function public.fn_profiles_block_client_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'profiles: INSERT/DELETE direct din roluri client e interzis (mig 262)'
      using errcode = '42501', hint = 'profiles_client_write_denied';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.fn_profiles_block_client_write() from public, anon, authenticated;

drop trigger if exists trg_profiles_block_client_write on public.profiles;
create trigger trg_profiles_block_client_write
  before insert or delete on public.profiles
  for each row execute function public.fn_profiles_block_client_write();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SEC-02 — RPC anon mort care proiecta wifi_password/qr_token
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_restaurant_by_qr_token(text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SEC-03 — helperi interni: fără EXECUTE pentru anon/PUBLIC
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public._refresh_order_totals(uuid)',
    'public.build_fiscalnet_payload(uuid)',
    'public.owner_plan(uuid)',
    'public.get_restaurant_features(uuid)',
    'public.log_ai_import(uuid, uuid, integer)',
    'public.reserve_ai_import_slot(uuid, uuid)',
    'public.check_ai_import_quota(uuid)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception 'mig 262: helperul % lipsește — lista SEC-03 e desincronizată', v_sig;
    end if;
    execute format('revoke execute on function %s from public, anon', v_sig);
    -- Apelanții reali: trigger-e/RPC-uri DEFINER (owner) + dashboard-ul
    -- autentificat (get_restaurant_features prin useFeatures) + service_role.
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SEC-04 — products: roluri explicite + scoping pe restaurant activ
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "products: public read active" on public.products;
create policy "products: public read active" on public.products
  for select to anon, authenticated
  using (is_active = true and is_draft = false and public.is_restaurant_active(restaurant_id));

-- Orice altă politică rămasă pe rolul PUBLIC (member read all / admin write /
-- eventuale politici viitoare) trece pe authenticated — anon nu trebuie să
-- evalueze niciodată is_member/is_admin (fără EXECUTE → permission denied).
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'products'
       and roles = '{public}'::name[]
  loop
    execute format('alter policy %I on public.products to authenticated', r.policyname);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SEC-05 — invite_tokens: citirea invitațiilor e pentru admini
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "invites: member read" on public.invite_tokens;
create policy "invites: admin read" on public.invite_tokens
  for select to authenticated
  using (public.is_admin(restaurant_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. advance_order — lanț 011→085/087→118→147→172→214→243→262
--    Copie a corpului din 243; DOAR ramura mark_paid se schimbă (v_net).
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

      v_tips := coalesce(p_tips_amount, 0);

      if v_partial > 0 then
        -- Comanda are plăți parțiale → `p_paid_amount` e RESTUL înmânat (cu bacșiș).
        v_final := coalesce(p_paid_amount, v_order.total - v_partial + v_tips);
        -- ★ mig 262 (MF-01): pe NOTĂ intră doar v_final - v_tips. Înainte,
        -- rândul din order_payments primea rest+bacșiș → guard-ul B3 din
        -- build_fiscalnet_payload respingea payload-ul → bani fără bon.
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
        -- Completăm registrul de plăți (invariant: paid_amount == sum(order_payments)).
        -- order_payments cere amount > 0: la rest zero (nota deja acoperită de
        -- parțiale, doar bacșiș) nu inserăm nimic.
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
        -- Fără plăți parțiale. ★ mig 262 (MF-05/DM-01): și aici bacșișul iese
        -- din paid_amount (venitul raportat = banii pe notă, ca bonul), iar
        -- supra-încasarea (typo 5000 vs 50.00) e respinsă — înainte ramura
        -- asta accepta ORICE sumă și o scria în paid_amount.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. bridge_retry_receipt — lanț 030→038→262: retry-ul REGENEREAZĂ payload-ul
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.bridge_retry_receipt(p_receipt_id uuid)
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
  v_payload       text;
  v_total         numeric;
  v_updated       int;
begin
  select restaurant_id, bon_number, status, order_id
    into v_restaurant_id, v_bon_number, v_status, v_order_id
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
         error_info       = null
   where id     = p_receipt_id
     and status in ('error', 'cancelled')
     and bon_number is null;  -- double check

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.bridge_retry_receipt(uuid) from public;
grant execute on function public.bridge_retry_receipt(uuid) to authenticated;

comment on function public.bridge_retry_receipt(uuid) is
  'Retrimite un bon error/cancelled fără număr fiscal. mig 262: regenerează payload-ul din comanda curentă; hint payload_build_failed dacă build-ul eșuează.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. bridge_mark_stale_as_error — lanț 030→035→262: marker AMBIGUU
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.bridge_mark_stale_as_error()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  -- Bridge-ul a preluat bonul (pending→sent) dar nu a confirmat în 10 minute:
  -- PC restartat înainte de tipărire SAU tipărit + confirm pierdut pe rețea.
  -- Nu putem ști care → eșec AMBIGUU, ca politica Oblio (mig 218) și markerul
  -- FiscalNet din bridge/lib/fiscalnet.js: BridgeTab cere verificarea benzii
  -- înainte de retrimitere (retry orb = bon fiscal DUBLU real).
  update public.pending_receipts
     set status       = 'error',
         error_code   = 'BRIDGE_TIMEOUT',
         error_info   = 'POSIBIL DUPLICAT — verifică banda casei înainte de retrimitere: '
                        || 'bridge-ul a preluat bonul dar nu a confirmat în 10 minute (BRIDGE_TIMEOUT)',
         completed_at = now(),
         retry_count  = retry_count + 1
   where status = 'sent'
     and claimed_at < now() - interval '10 minutes';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.bridge_mark_stale_as_error() from public, anon, authenticated;
grant execute on function public.bridge_mark_stale_as_error() to service_role;

comment on function public.bridge_mark_stale_as_error() is
  'Cron orar (automation-cron, service_role): bonuri agățate >10 min în sent → error cu marker POSIBIL DUPLICAT (retry doar după verificarea benzii).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. enqueue_invoice_for_order — lanț 041→262: gardă anti duplicat fiscal
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enqueue_invoice_for_order(
  p_order_id        uuid,
  p_customer_name   text,
  p_customer_cif    text default null,
  p_customer_address text default null,
  p_customer_email  text default null,
  p_customer_phone  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_invoice_id uuid;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Order trebuie să existe, să fie paid, și user să fie admin
  select id, restaurant_id, total, status into v_order
    from public.orders where id = p_order_id;

  if not found then
    raise exception 'Comanda nu există';
  end if;

  if not public.is_admin(v_order.restaurant_id) then
    raise exception 'Doar managerul poate emite facturi';
  end if;

  if v_order.status != 'paid' then
    raise exception 'Factura se poate emite doar pentru comenzi plătite (status curent: %)', v_order.status;
  end if;

  -- Restaurantul trebuie să aibă Oblio configurat
  if not exists(
    select 1 from public.oblio_configs
    where restaurant_id = v_order.restaurant_id and is_active = true
  ) then
    raise exception 'Oblio nu e configurat. Mergi la Setări → Facturare.';
  end if;

  -- Dedup: o singură factură activă per order (în starea queued/generating/issued)
  if exists(
    select 1 from public.invoices
    where order_id = p_order_id
      and status in ('queued', 'generating', 'issued')
  ) then
    raise exception 'Există deja o factură pentru această comandă';
  end if;

  -- ★ mig 262 (MF-04): o factură eșuată AMBIGUU (timeout/rețea DUPĂ POST —
  -- mig 218; sau proces întrerupt în 'generating' — mig 239) POATE fi deja
  -- emisă la Oblio. Re-cererea din dashboard = al doilea document fiscal real
  -- (+ e-Factura în SPV pe B2B). Rămâne blocată până când fondatorul o
  -- rezolvă (admin_retry_invoice după verificare în Oblio). Un 'failed' clar
  -- (4xx: CIF invalid, date lipsă) NU are markerul → re-emisibil.
  if exists(
    select 1 from public.invoices
    where order_id = p_order_id
      and status = 'failed'
      and (last_error like 'POSIBIL DUPLICAT%' or last_error like 'STUCK_GENERATING%')
  ) then
    raise exception 'Există o factură eșuată AMBIGUU pentru această comandă (posibil emisă deja la Oblio). Verifică în Oblio și cere fondatorului retrimiterea sau anularea ei înainte de a emite alta.'
      using errcode = 'P0001', hint = 'ambiguous_failed_exists';
  end if;

  if p_customer_name is null or length(trim(p_customer_name)) = 0 then
    raise exception 'Numele clientului e obligatoriu';
  end if;

  insert into public.invoices (
    restaurant_id, order_id, customer_name, customer_cif,
    customer_address, customer_email, customer_phone,
    is_b2b, total_with_vat, created_by
  ) values (
    v_order.restaurant_id, p_order_id, trim(p_customer_name),
    nullif(trim(coalesce(p_customer_cif, '')), ''),
    nullif(trim(coalesce(p_customer_address, '')), ''),
    nullif(trim(coalesce(p_customer_email, '')), ''),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    p_customer_cif is not null and length(trim(p_customer_cif)) > 0,
    v_order.total, v_user_id
  )
  returning id into v_invoice_id;

  return v_invoice_id;
end;
$$;

revoke all on function public.enqueue_invoice_for_order(uuid, text, text, text, text, text) from public;
grant execute on function public.enqueue_invoice_for_order(uuid, text, text, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Igienă search_path: DEFINER cu `public` simplu → `public, pg_temp`
--     (ALTER FUNCTION — corpurile NU se ating; convenția CLAUDE.md, ca mig 194)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record; v_cnt int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where c = 'search_path=public')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
    v_cnt := v_cnt + 1;
  end loop;
  raise notice 'mig 262: % funcții SECURITY DEFINER au primit pg_temp în search_path', v_cnt;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_src text; v_sig text; r record; v_n int;
begin
  -- 1. profiles: fără INSERT/DELETE pentru rolurile client; fără politică FOR ALL.
  foreach v_sig in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_sig, 'public.profiles', 'INSERT')
       or has_table_privilege(v_sig, 'public.profiles', 'DELETE') then
      raise exception 'mig 262: % încă are INSERT/DELETE pe profiles (SEC-01)', v_sig; end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and cmd = 'ALL') then
    raise exception 'mig 262: profiles are încă o politică FOR ALL'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_self_select')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_self_update') then
    raise exception 'mig 262: politicile profiles_self_select/update lipsesc'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_profiles_block_client_write' and tgrelid = 'public.profiles'::regclass) then
    raise exception 'mig 262: trigger-ul anti scriere directă pe profiles lipsește'; end if;
  -- UPDATE-ul column-level din 096a a rămas (full_name da, is_platform_admin nu).
  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'is_platform_admin', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'plan', 'UPDATE') then
    raise exception 'mig 262: privilegiile UPDATE column-level pe profiles (096a/258) s-au schimbat'; end if;

  -- 2. RPC-ul mort a dispărut; nicio funcție anon nu proiectează secretele restaurantului.
  if to_regprocedure('public.get_restaurant_by_qr_token(text)') is not null then
    raise exception 'mig 262: get_restaurant_by_qr_token încă există'; end if;
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and has_function_privilege('anon', p.oid, 'execute')
  loop
    if position('r.wifi_password' in r.src) > 0 or position('r.qr_token' in r.src) > 0 then
      raise exception 'mig 262: funcția anon % proiectează wifi_password/qr_token', r.proname; end if;
  end loop;

  -- 3. Helperii interni nu mai sunt executabili de anon; authenticated păstrează ce folosește.
  foreach v_sig in array array[
    'public._refresh_order_totals(uuid)', 'public.build_fiscalnet_payload(uuid)',
    'public.owner_plan(uuid)', 'public.get_restaurant_features(uuid)',
    'public.log_ai_import(uuid, uuid, integer)', 'public.reserve_ai_import_slot(uuid, uuid)',
    'public.check_ai_import_quota(uuid)'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception 'mig 262: anon încă poate executa %', v_sig; end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.get_restaurant_features(uuid)', 'execute') then
    raise exception 'mig 262: authenticated a pierdut get_restaurant_features (useFeatures ar muri)'; end if;

  -- 4. products: nicio politică pe rolul PUBLIC; read-ul public e scopat pe restaurant activ.
  if exists (select 1 from pg_policies where schemaname='public' and tablename='products' and roles = '{public}'::name[]) then
    raise exception 'mig 262: products mai are politici pe rolul PUBLIC (anon ar evalua is_member)'; end if;
  select qual into v_src from pg_policies
   where schemaname='public' and tablename='products' and policyname='products: public read active';
  if v_src is null or position('is_restaurant_active' in v_src) = 0 then
    raise exception 'mig 262: read-ul public pe products nu e scopat pe restaurant activ'; end if;

  -- 5. invite_tokens: citirea e admin-only.
  if exists (select 1 from pg_policies where schemaname='public' and tablename='invite_tokens' and policyname='invites: member read') then
    raise exception 'mig 262: „invites: member read" încă există'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='invite_tokens' and policyname='invites: admin read') then
    raise exception 'mig 262: „invites: admin read" lipsește (TeamManager n-ar mai vedea invitațiile)'; end if;

  -- 6. advance_order: v_net + TOATE invariantele lanțului (mig 243 le asertează la fel).
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'advance_order';
  if v_src is null then raise exception 'mig 262: advance_order lipsește'; end if;
  foreach v_sig in array array['invalid_payment_method', 'for update of o', 'cancel_reason_required',
                               'overpayment', 'v_final - v_tips', 'fiscal_receipt',
                               'values (p_order_id, v_net', 'paid_amount = v_partial + v_net',
                               'paid_amount=coalesce(v_net, paid_amount)'] loop
    if position(v_sig in lower(v_src)) = 0 and position(v_sig in v_src) = 0 then
      raise exception 'mig 262: advance_order a pierdut invariantul „%"', v_sig; end if;
  end loop;
  -- Bacșișul NU mai intră în order_payments (rândul vechi era `values (p_order_id, v_final`).
  if position('values (p_order_id, v_final' in v_src) > 0 then
    raise exception 'mig 262: order_payments primește iar suma CU bacșiș (MF-01 a revenit)'; end if;

  -- 7. bridge_retry_receipt regenerează payload-ul.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_retry_receipt';
  if v_src is null or position('build_fiscalnet_payload' in v_src) = 0
     or position('payload_build_failed' in v_src) = 0 or position('already_printed' in v_src) = 0 then
    raise exception 'mig 262: bridge_retry_receipt nu regenerează payload-ul / a pierdut guard-ul already_printed'; end if;

  -- 8. bridge_mark_stale_as_error: marker ambiguu + service_role only.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_mark_stale_as_error';
  if v_src is null or position('POSIBIL DUPLICAT' in v_src) = 0 then
    raise exception 'mig 262: markerul POSIBIL DUPLICAT lipsește din bridge_mark_stale_as_error'; end if;
  if has_function_privilege('anon', 'public.bridge_mark_stale_as_error()', 'execute')
     or has_function_privilege('authenticated', 'public.bridge_mark_stale_as_error()', 'execute')
     or not has_function_privilege('service_role', 'public.bridge_mark_stale_as_error()', 'execute') then
    raise exception 'mig 262: grant-urile bridge_mark_stale_as_error nu sunt service_role-only'; end if;

  -- 9. enqueue_invoice_for_order: garda anti duplicat ambiguu + dedup-ul vechi.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enqueue_invoice_for_order';
  if v_src is null or position('ambiguous_failed_exists' in v_src) = 0
     or position('''queued'', ''generating'', ''issued''' in v_src) = 0 then
    raise exception 'mig 262: enqueue_invoice_for_order a pierdut garda ambiguă sau dedup-ul'; end if;

  -- 10. Igienă search_path: zero DEFINER în public cu `search_path=public` fără pg_temp.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c = 'search_path=public');
  if v_n > 0 then
    raise exception 'mig 262: % funcții DEFINER au încă search_path=public fără pg_temp', v_n; end if;

  raise notice 'mig 262: audit v3 hardening (SEC-01..05, MF-01..05, DM-01/05) OK';
end $$;

commit;

-- migration_263_audit_v3_batch2.sql
-- =============================================================================
-- Audit v3, lotul 2 (specialiștii dashboard/staff + cod/arhitectură):
--
--   1. DS-1 advance_order (lanț →262→263): pe planurile FISCALE
--      (`fiscal_receipt`) nu există închidere NEfiscală. UI-ul ascunde „Închide
--      comanda" când planul e ≥ 3, dar când RPC-ul de features pica (sau la
--      primul mount) necunoscutul cădea pe „fără plăți" → butonul apărea pe un
--      restaurant Plan 3, iar `close_order` era acceptat de server (doar gate-ul
--      `table_lifecycle`, pe care pro/enterprise îl au) → comandă `closed` fără
--      bon, fără `paid_amount`, fără venit în Rapoarte/TVA/Casă — regula de aur
--      încălcată tăcut. Gate-ul stă acum în RPC (hint
--      `fiscal_plan_requires_payment`); UI-ul e TRISTATE (necunoscut = fără
--      buton de finalizare).
--   2. `close_session_orders` (lanț 085→087→263) primește ACELAȘI gate: RPC-ul
--      trecea comenzile direct în `closed` verificând doar `table_lifecycle`,
--      deci închiderea mesei era o portiță nefiscală echivalentă cu DS-1 (găsită
--      la review-ul lotului). Gate-ul se aplică DOAR când sesiunea chiar are
--      comenzi deschise — închiderea unei mese cu toate notele deja plătite
--      rămâne o operație normală de lifecycle.
--   3. CA-02 / MF-12 v_daily_orders (lanț 007→022→116→159→232→253→263):
--      coloane NOI `online_revenue` (card_online) și `other_revenue`
--      (`other` + NULL) APPEND la final — plățile online la masă (mig 202/203)
--      nu aveau bucket, iar `other` (split cu metode mixte, mig 262) cădea doar
--      în `revenue`: defalcarea nu închidea cu totalul. ReportsTab/AnalyticsTab
--      le consumă tolerant.
--
-- Teste permanente AB1–AB4: tests/sql/audit_v3_batch2_assertions.sql.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. advance_order — copie a corpului din 262; DOAR ramura close_order primește
--    gate-ul fiscal (restul rămâne byte-identic).
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
-- 2. close_session_orders — lanț 085→087→263: copie a corpului din 087 + gate
--    fiscal pe comenzile care AR FI închise nefiscal.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.close_session_orders(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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

  -- ★ mig 263 (audit v3, review lot 2): pe planurile FISCALE închiderea mesei
  -- nu are voie să treacă în `closed` comenzi neplătite — ar fi exact portița
  -- pe care DS-1 o închide în advance_order (bani încasați fizic, fără bon).
  -- Gate-ul fires DOAR dacă sesiunea chiar are comenzi deschise: o masă cu
  -- toate notele deja `paid` se închide normal (lifecycle curat).
  if public.restaurant_has_feature(v_session.restaurant_id, 'fiscal_receipt')
     and exists (
       select 1 from public.orders
        where session_id = p_session_id
          and status not in ('paid', 'cancelled', 'closed')
     ) then
    raise exception 'Masa are comenzi neincasate: pe planul cu fiscalizare fiecare nota se finalizeaza prin plata (bon fiscal) inainte de inchiderea mesei'
      using errcode = 'P0001', hint = 'fiscal_plan_requires_payment';
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

revoke all on function public.close_session_orders(uuid) from public;
grant execute on function public.close_session_orders(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. v_daily_orders — copia mig 253 (semi-join fiscal, security_invoker) +
--    coloana `online_revenue` APPEND la final (CREATE OR REPLACE păstrează
--    coloanele existente în aceeași ordine; consumatorii vechi nu se schimbă).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_daily_orders
with (security_invoker = true) as
  SELECT restaurant_id,
     date_trunc('day'::text, (created_at AT TIME ZONE 'Europe/Bucharest'::text))::date AS day,
     count(*) AS total_orders,
     count(*) FILTER (WHERE source = 'qr'::order_source) AS qr_orders,
     count(*) FILTER (WHERE source = 'waiter'::order_source) AS waiter_orders,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status), 0::numeric) AS revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'cash'::payment_method), 0::numeric) AS cash_revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'card_pos'::payment_method), 0::numeric) AS card_revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'meal_voucher'::payment_method), 0::numeric) AS voucher_revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'card_online'::payment_method), 0::numeric) AS online_revenue,
     -- `other` + NULL: split cu metode MIXTE (advance_order scrie 'other' cand
     -- order_payments are >1 metoda distincta) si comenzi vechi fara metoda.
     -- Fara bucket-ul asta, cash+card+tichete+online < revenue, iar operatorul
     -- vedea bani „disparuti" din defalcare (review audit v3).
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND (payment_method = 'other'::payment_method OR payment_method IS NULL)), 0::numeric) AS other_revenue
    FROM orders o
   WHERE status <> 'cancelled'::order_status
     AND o.restaurant_id IN (SELECT r.id FROM restaurants r
                              WHERE public.restaurant_has_feature(r.id, 'fiscal_receipt'))
   GROUP BY restaurant_id, (date_trunc('day'::text, (created_at AT TIME ZONE 'Europe/Bucharest'::text))::date);

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_src text; v_sig text; v_cols text[];
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'advance_order';
  if v_src is null then raise exception 'mig 263: advance_order lipsește'; end if;
  -- Gate-ul nou + TOATE invariantele lanțului (243/262) păstrate.
  foreach v_sig in array array['fiscal_plan_requires_payment', 'table_lifecycle',
                               'invalid_payment_method', 'for update of o', 'cancel_reason_required',
                               'overpayment', 'v_final - v_tips', 'fiscal_receipt',
                               'values (p_order_id, v_net', 'paid_amount = v_partial + v_net',
                               'paid_amount=coalesce(v_net, paid_amount)'] loop
    if position(v_sig in lower(v_src)) = 0 and position(v_sig in v_src) = 0 then
      raise exception 'mig 263: advance_order a pierdut invariantul „%"', v_sig; end if;
  end loop;
  if position('values (p_order_id, v_final' in v_src) > 0 then
    raise exception 'mig 263: order_payments primește iar suma CU bacșiș (MF-01 a revenit)'; end if;
  if has_function_privilege('anon', 'public.advance_order(uuid, text, numeric, text, numeric, text)', 'execute') then
    raise exception 'mig 263: anon poate executa advance_order'; end if;

  -- close_session_orders: gate fiscal + invariantele lanțului 085/087.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_session_orders';
  if v_src is null then raise exception 'mig 263: close_session_orders lipseste'; end if;
  foreach v_sig in array array['fiscal_plan_requires_payment', 'table_lifecycle',
                               'session_not_found_or_unauthorized', 'already_closed'] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'mig 263: close_session_orders a pierdut invariantul „%"', v_sig; end if;
  end loop;
  if has_function_privilege('anon', 'public.close_session_orders(uuid)', 'execute') then
    raise exception 'mig 263: anon poate executa close_session_orders'; end if;

  -- v_daily_orders: coloanele vechi în aceeași ordine + bucket-urile noi ULTIMELE.
  select array_agg(attname order by attnum) into v_cols
    from pg_attribute
   where attrelid = 'public.v_daily_orders'::regclass and attnum > 0 and not attisdropped;
  if v_cols <> array['restaurant_id','day','total_orders','qr_orders','waiter_orders',
                     'revenue','cash_revenue','card_revenue','voucher_revenue','online_revenue',
                     'other_revenue']::text[] then
    raise exception 'mig 263: v_daily_orders are coloanele % (asteptat ordinea 253 + online_revenue + other_revenue la final)', v_cols; end if;
  select pg_get_viewdef('public.v_daily_orders'::regclass) into v_src;
  if position('restaurant_has_feature' in v_src) = 0 then
    raise exception 'mig 263: v_daily_orders a pierdut gate-ul fiscal (semi-join, mig 253)'; end if;
  if not exists (select 1 from pg_class c where c.oid = 'public.v_daily_orders'::regclass
                   and c.reloptions @> array['security_invoker=true']) then
    raise exception 'mig 263: v_daily_orders a pierdut security_invoker (mig 125)'; end if;

  raise notice 'mig 263: audit v3 lot 2 (gate fiscal close_order + close_session_orders, online/other_revenue) OK';
end $$;

commit;

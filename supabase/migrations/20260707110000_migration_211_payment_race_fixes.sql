-- ═══════════════════════════════════════════════════════════════════
-- Migration 211: plata online — 3 fixuri de bani din review-ul adversarial
-- ─────────────────────────────────────────────────────────────────────
-- F1 (dublă încasare pe plăți parțiale): begin exclude comenzile cu rânduri
--    în order_payments, dar settle sărea DOAR statusurile terminale — o plată
--    parțială cash luată ÎNTRE begin și confirmare lăsa comanda 'served',
--    iar settle o marca integral card_online (client taxat de două ori,
--    fără nicio urmă). Acum: settle sare comenzile cu plăți parțiale și
--    notează explicit în settle_note (se încheie pe fluxul de staff).
-- F2 (totalul editat între begin și confirmare): update_order_items poate
--    modifica o comandă 'served' în timp ce clientul confirmă snapshot-ul —
--    suma încasată ≠ totalul marcat/fiscalizat, tăcut. Acum: begin salvează
--    snapshot-ul per comandă în table_payments.order_totals; settle marchează
--    comanda plătită (banii AU venit — clientul nu se taxează a doua oară)
--    dar contorizează diferențele și le scrie în settle_note (reconciliere
--    vizibilă, nu tăcere).
-- F3 (două telefoane la aceeași masă): sesiunea e per masă, deci două
--    deschideri ale sheet-ului creau DOUĂ intent-uri live pe toată nota —
--    ambele confirmabile → dublă încasare integrală. Acum: begin întoarce
--    intent-urile 'created'/'processing' existente pe sesiune ca
--    superseded_intents (funcția Netlify le anulează la Stripe ÎNAINTE să
--    creeze intent-ul nou; dacă unul a apucat să REUȘEASCĂ, plata nouă se
--    anulează și clientul află că nota e deja plătită). Rândurile fără
--    intent atașat se anulează direct aici. Rezultat: un singur intent
--    confirmabil per sesiune la orice moment.
-- Ambele funcții rămân SECURITY DEFINER, EXECUTE doar service_role.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ── 1. Snapshot-ul totalurilor per comandă (F2) ──────────────────────
alter table public.table_payments
  add column if not exists order_totals jsonb;

comment on column public.table_payments.order_totals is
  $$Snapshot {order_id: total} la begin (mig 211) — settle compară cu totalul
curent și notează diferențele în settle_note (edit de staff în timpul plății).$$;

-- ── 2. begin_table_payment (corp = mig 209 + supersede + snapshot) ───
create or replace function public.begin_table_payment(
  p_session_id uuid,
  p_token      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sess       record;
  v_tok        record;
  v_account    text;
  v_currency   text;
  v_amount     numeric := 0;
  v_order_ids  uuid[];
  v_totals     jsonb;
  v_superseded jsonb;
  v_fee_bps    integer := 0;
  v_fee        numeric := 0;
  v_payment_id uuid;
begin
  -- Sesiune deschisă (lock: begin-urile concurente pe aceeași masă se
  -- serializează pe rândul sesiunii — supersede-ul de mai jos e race-safe).
  select id, restaurant_id, table_id, status
    into v_sess
    from public.table_sessions
   where id = p_session_id
     for update;
  if not found or v_sess.status <> 'open' then
    raise exception 'Sesiunea de masă nu este deschisă.'
      using errcode = 'P0001', hint = 'invalid_session';
  end if;

  -- Token-ul QR trebuie să aparțină ACELEIAȘI mese (dovada că plătitorul
  -- chiar e la masă, nu ghicește session id-uri).
  select table_id, restaurant_id
    into v_tok
    from public.qr_tokens
   where token = p_token
     and is_active;
  if not found
     or v_tok.table_id <> v_sess.table_id
     or v_tok.restaurant_id <> v_sess.restaurant_id then
    raise exception 'Cod QR invalid pentru această masă.'
      using errcode = 'P0001', hint = 'invalid_token';
  end if;

  -- Cele 3 gate-uri (toate server-side): plan → opt-in local → cont conectat.
  perform public.enforce_feature_for_restaurant(v_sess.restaurant_id, 'online_payments');
  if not public.is_module_enabled(v_sess.restaurant_id, 'online_payments') then
    raise exception 'Plata online nu este activată de restaurant.'
      using errcode = 'P0001', hint = 'module_disabled';
  end if;
  select stripe_account_id, upper(coalesce(currency, 'RON'))
    into v_account, v_currency
    from public.restaurants where id = v_sess.restaurant_id;
  if v_account is null then
    raise exception 'Restaurantul nu are contul de plăți conectat.'
      using errcode = 'P0001', hint = 'not_connected';
  end if;

  -- Gate de monedă (mig 209): bonul fiscal e RON-only → plata online la fel.
  if v_currency <> 'RON' then
    raise exception 'Plata online e disponibilă doar pentru meniuri în lei (RON).'
      using errcode = 'P0001', hint = 'currency_not_supported';
  end if;

  -- Suma se calculează AICI (niciodată din client): comenzile sesiunii care
  -- nu sunt plătite/anulate/închise și nu au deja plăți parțiale pornite
  -- (acelea se termină pe fluxul de staff, altfel am dubla încasarea).
  -- + snapshot-ul per comandă (F2).
  select coalesce(array_agg(o.id), '{}'),
         coalesce(sum(o.total), 0),
         coalesce(jsonb_object_agg(o.id::text, o.total), '{}'::jsonb)
    into v_order_ids, v_amount, v_totals
    from public.orders o
   where o.session_id = p_session_id
     and o.status not in ('paid', 'cancelled', 'closed')
     and not exists (
       select 1 from public.order_payments op where op.order_id = o.id
     );
  if coalesce(array_length(v_order_ids, 1), 0) = 0 or v_amount <= 0 then
    raise exception 'Nu există comenzi de plătit pe această masă.'
      using errcode = 'P0001', hint = 'nothing_to_pay';
  end if;

  select coalesce((value->>'bps')::integer, 0)
    into v_fee_bps
    from public.platform_settings
   where key = 'online_payment_fee_bps';
  v_fee := round(v_amount * coalesce(v_fee_bps, 0) / 10000.0, 2);

  -- F3: un singur intent live per sesiune. Rândurile 'created' fără intent
  -- (attach eșuat / sheet abandonat) nu au nimic la Stripe — anulate direct.
  update public.table_payments
     set status = 'canceled',
         settle_note = 'Înlocuit de o plată nouă (fără intent atașat).',
         updated_at = now()
   where session_id = p_session_id
     and status = 'created'
     and stripe_payment_intent_id is null;

  -- Intent-urile vii rămân NEATINSE aici (dacă unul a reușit între timp,
  -- webhook-ul lui trebuie să mai găsească rândul 'processing' ca să marcheze
  -- comenzile). Funcția Netlify le anulează la Stripe și abia apoi settle-ază.
  select coalesce(jsonb_agg(stripe_payment_intent_id), '[]'::jsonb)
    into v_superseded
    from public.table_payments
   where session_id = p_session_id
     and status in ('created', 'processing')
     and stripe_payment_intent_id is not null;

  insert into public.table_payments
    (restaurant_id, session_id, order_ids, amount, currency, application_fee, order_totals)
  values
    (v_sess.restaurant_id, p_session_id, v_order_ids, v_amount, v_currency, v_fee, v_totals)
  returning id into v_payment_id;

  return jsonb_build_object(
    'payment_id',         v_payment_id,
    'amount',             v_amount,
    'currency',           v_currency,
    'application_fee',    v_fee,
    'order_ids',          to_jsonb(v_order_ids),
    'stripe_account_id',  v_account,
    'superseded_intents', v_superseded
  );
end;
$$;

revoke all on function public.begin_table_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_table_payment(uuid, text) to service_role;

comment on function public.begin_table_payment(uuid, text) is
  $$Inițiază plata online a mesei (mig 203 → 209 gate monedă → 211 supersede +
snapshot): sumă EXCLUSIV server-side, un singur intent live per sesiune,
snapshot-ul totalurilor per comandă pentru reconcilierea din settle.
service_role-only.$$;

-- ── 3. settle_table_payment (corp = mig 207 + F1 + F2) ───────────────
create or replace function public.settle_table_payment(
  p_intent_id  text,
  p_outcome    text,
  p_error_info text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay     record;
  v_oid     uuid;
  v_paid    integer := 0;
  v_skipped integer := 0;
  v_partial integer := 0;
  v_changed integer := 0;
begin
  if p_outcome not in ('succeeded', 'failed', 'canceled') then
    raise exception 'Outcome invalid: %', p_outcome
      using errcode = 'P0001', hint = 'invalid_outcome';
  end if;

  select * into v_pay
    from public.table_payments
   where stripe_payment_intent_id = p_intent_id
     for update;
  if not found then
    raise exception 'Plată necunoscută pentru intent %.', p_intent_id
      using errcode = 'P0001', hint = 'unknown_intent';
  end if;

  -- Idempotență: DOAR succeeded/canceled sunt terminale. 'failed' = "ultima
  -- încercare a eșuat" — PaymentIntent-ul e încă confirmabil (retry de card),
  -- deci un succeeded ulterior TREBUIE să treacă (mig 207).
  if v_pay.status in ('succeeded', 'canceled') then
    return jsonb_build_object('already_settled', true, 'status', v_pay.status);
  end if;
  if p_outcome = 'failed' and v_pay.status = 'failed' then
    -- Încercări eșuate repetate: doar împrospătăm eroarea, fără alt efect.
    update public.table_payments
       set error_info = coalesce(p_error_info, error_info), updated_at = now()
     where id = v_pay.id;
    return jsonb_build_object('already_settled', true, 'status', 'failed');
  end if;

  if p_outcome <> 'succeeded' then
    update public.table_payments
       set status = p_outcome, error_info = p_error_info, updated_at = now()
     where id = v_pay.id;
    return jsonb_build_object('status', p_outcome);
  end if;

  -- F2 (vizibilitate): comenzile al căror total s-a schimbat față de
  -- snapshot-ul de la begin. Se marchează totuși plătite (banii AU fost
  -- încasați — clientul nu se taxează a doua oară), dar diferența se
  -- raportează în settle_note pentru reconciliere manuală.
  if v_pay.order_totals is not null then
    select count(*)::integer into v_changed
      from public.orders o
     where o.id = any(v_pay.order_ids)
       and o.status not in ('paid', 'cancelled', 'closed')
       and (v_pay.order_totals ? o.id::text)
       and o.total is distinct from (v_pay.order_totals->>o.id::text)::numeric;
  end if;

  -- Succes (inclusiv după una sau mai multe încercări eșuate): comenzile din
  -- snapshot devin 'paid' cu card_online — triggerul enqueue_fiscal_receipt
  -- (mig 030) preia bonul de aici.
  foreach v_oid in array v_pay.order_ids loop
    -- F1: plată parțială cash luată între begin și confirmare — comanda se
    -- încheie pe fluxul de staff (altfel am marca integral card_online peste
    -- banii deja luați cash). Notat mai jos; refund-ul e decizie umană.
    if exists (select 1 from public.order_payments op where op.order_id = v_oid)
       and exists (
         select 1 from public.orders o
          where o.id = v_oid
            and o.status not in ('paid', 'cancelled', 'closed')
       ) then
      v_partial := v_partial + 1;
      continue;
    end if;
    update public.orders
       set status         = 'paid',
           payment_method = 'card_online',
           paid_amount    = total,
           paid_at        = now()
     where id = v_oid
       and status not in ('paid', 'cancelled', 'closed');
    if found then
      v_paid := v_paid + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  update public.table_payments
     set status = 'succeeded',
         error_info = null,
         settle_note = nullif(btrim(concat_ws(' ',
           case when v_skipped > 0 then format(
             '%s comenzi sărite (plătite/anulate între timp) — verifică dacă e nevoie de refund parțial.',
             v_skipped) end,
           case when v_partial > 0 then format(
             '%s comenzi cu plăți parțiale (cash) sărite — se încheie la ospătar; suma încasată online le include, verifică refund.',
             v_partial) end,
           case when v_changed > 0 then format(
             '%s comenzi modificate după inițierea plății — suma încasată online e snapshot-ul de la begin, nu totalul curent; reconciliere manuală.',
             v_changed) end
         )), '')
   where id = v_pay.id;

  return jsonb_build_object(
    'status', 'succeeded',
    'orders_paid', v_paid,
    'orders_skipped', v_skipped,
    'orders_partial', v_partial,
    'orders_changed', v_changed
  );
end;
$$;

revoke all on function public.settle_table_payment(text, text, text) from public, anon, authenticated;
grant execute on function public.settle_table_payment(text, text, text) to service_role;

comment on function public.settle_table_payment(text, text, text) is
  $$Idempotent pe intent id; terminale = succeeded/canceled (mig 207). mig 211:
sare comenzile cu plăți parțiale (staff flow) și notează totalurile modificate
față de snapshot. succeeded → orders paid cu card_online (bonul pleacă din
triggerul fiscal).$$;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare
  v_begin text;
  v_settle text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'table_payments'
       and column_name = 'order_totals'
  ) then
    raise exception 'ASSERT FAIL: coloana table_payments.order_totals lipsește';
  end if;

  v_begin := pg_get_functiondef('public.begin_table_payment(uuid, text)'::regprocedure);
  if position('superseded_intents' in v_begin) = 0
     or position('order_totals' in v_begin) = 0
     or position('currency_not_supported' in v_begin) = 0 then
    raise exception 'ASSERT FAIL: begin_table_payment fără supersede/snapshot/gate monedă (mig 211)';
  end if;

  v_settle := pg_get_functiondef('public.settle_table_payment(text, text, text)'::regprocedure);
  if position('order_payments' in v_settle) = 0
     or position('order_totals' in v_settle) = 0
     or position($m$in ('succeeded', 'canceled')$m$ in v_settle) = 0 then
    raise exception 'ASSERT FAIL: settle_table_payment fără F1/F2 sau cu failed re-terminal (mig 211)';
  end if;

  if has_function_privilege('anon', 'public.begin_table_payment(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_table_payment(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.settle_table_payment(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.settle_table_payment(text, text, text)', 'execute') then
    raise exception 'ASSERT FAIL: begin/settle trebuie să rămână service_role-only';
  end if;
end $$;

commit;

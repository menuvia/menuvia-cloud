-- ═══════════════════════════════════════════════════════════════════
-- Migration 209: begin_table_payment — gate fail-closed pe monedă
-- ─────────────────────────────────────────────────────────────────────
-- mig 205 a activat restaurants.currency (RON/EUR/HUF/BGN/MDL/USD/GBP)
-- pentru afișarea meniului, dar begin_table_payment (mig 203) întorcea
-- 'RON' hardcodat, iar funcția Netlify crea intent-ul Stripe în 'ron'.
-- Un local pro/enterprise cu meniul în EUR ar fi afișat €12 și ar fi
-- încasat 12 RON (~€2,40) — bani greșiți, tăcut.
--
-- Fiscalizarea (FiscalNet) e RON-only, deci plata online la masă rămâne
-- RON-only: monedă ≠ RON → respins curat cu hint 'currency_not_supported'
-- (clientul vede fallback-ul „cere nota ospătarului"). Moneda reală se
-- întoarce în răspuns și se scrie pe rând — în ziua în care acceptăm EUR,
-- funcția Netlify o are deja (citește begin.currency, nu hardcodează).
--
-- Redefinire IDENTICĂ cu mig 203 în rest: aceleași gate-uri (plan → modul
-- → cont conectat), aceeași sumă server-side, EXECUTE doar service_role.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

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
  v_fee_bps    integer := 0;
  v_fee        numeric := 0;
  v_payment_id uuid;
begin
  -- Sesiune deschisă (lock: două begin-uri concurente pe aceeași masă se
  -- serializează; fiecare produce propriul rând — Stripe deduplică pe intent).
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
  select coalesce(array_agg(o.id), '{}'), coalesce(sum(o.total), 0)
    into v_order_ids, v_amount
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

  insert into public.table_payments (restaurant_id, session_id, order_ids, amount, currency, application_fee)
  values (v_sess.restaurant_id, p_session_id, v_order_ids, v_amount, v_currency, v_fee)
  returning id into v_payment_id;

  return jsonb_build_object(
    'payment_id',        v_payment_id,
    'amount',            v_amount,
    'currency',          v_currency,
    'application_fee',   v_fee,
    'order_ids',         to_jsonb(v_order_ids),
    'stripe_account_id', v_account
  );
end;
$$;

revoke all on function public.begin_table_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_table_payment(uuid, text) to service_role;

comment on function public.begin_table_payment(uuid, text) is
  $$Inițiază plata online a mesei (mig 203, redefinit în 209 cu gate de
monedă): sumă EXCLUSIV server-side, gate-uri plan/modul/cont/monedă (RON-only
cât timp bonul fiscal e FiscalNet). service_role-only.$$;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
begin
  if position('currency_not_supported' in pg_get_functiondef('public.begin_table_payment(uuid, text)'::regprocedure)) = 0 then
    raise exception 'ASSERT FAIL: begin_table_payment fără gate-ul de monedă (currency_not_supported)';
  end if;
  if has_function_privilege('anon', 'public.begin_table_payment(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_table_payment(uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL: begin_table_payment trebuie să fie service_role-only';
  end if;
  if not has_function_privilege('service_role', 'public.begin_table_payment(uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL: service_role fără EXECUTE pe begin_table_payment';
  end if;
end $$;

commit;

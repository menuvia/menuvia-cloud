-- ═══════════════════════════════════════════════════════════════════
-- Migration 208: cancel_table_payment — „Plătesc la ospătar" (opt-out client)
-- ─────────────────────────────────────────────────────────────────────
-- Cerință fondator: clientul care a deschis plata online trebuie să poată
-- RENUNȚA explicit (n-are bani pe card / preferă cash) — anulăm intent-ul
-- Stripe ca să nu rămână confirmabil (închide fereastra de race din TP5) și
-- clientul cheamă nota. Fluxul: funcția Netlify validează prin RPC-ul de
-- aici (ownership pe sesiune + token = aceeași masă), anulează la Stripe,
-- apoi settle('canceled') — idempotent cu webhook-ul de canceled.
--   • rând fără intent atașat (status 'created') → îl marcăm canceled direct
--     aici (nu există nimic de anulat la Stripe).
--   • rând cu intent → întoarcem intent id + contul conectat; mutația vine
--     prin settle DUPĂ confirmarea Stripe (dacă între timp plata a REUȘIT,
--     Stripe refuză cancel-ul și clientul află că a plătit deja).
-- EXECUTE doar service_role (același contract ca restul suprafeței, mig 203).
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.cancel_table_payment(
  p_payment_id uuid,
  p_session_id uuid,
  p_token      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay     record;
  v_tok     record;
  v_account text;
begin
  select * into v_pay
    from public.table_payments
   where id = p_payment_id
     for update;
  if not found or v_pay.session_id <> p_session_id then
    raise exception 'Plată negăsită pentru această masă.'
      using errcode = 'P0001', hint = 'invalid_payment';
  end if;

  -- Dovada că cel care anulează chiar e la masă: token-ul QR trebuie să
  -- aparțină mesei sesiunii de pe rândul de plată (paritate cu begin).
  select table_id, restaurant_id
    into v_tok
    from public.qr_tokens
   where token = p_token
     and is_active;
  if not found or not exists (
    select 1 from public.table_sessions s
     where s.id = v_pay.session_id
       and s.table_id = v_tok.table_id
       and s.restaurant_id = v_tok.restaurant_id
  ) then
    raise exception 'Cod QR invalid pentru această plată.'
      using errcode = 'P0001', hint = 'invalid_token';
  end if;

  -- Stările terminale nu se anulează.
  if v_pay.status = 'succeeded' then
    return jsonb_build_object('cancelable', false, 'status', 'succeeded');
  end if;
  if v_pay.status = 'canceled' then
    return jsonb_build_object('cancelable', false, 'status', 'canceled');
  end if;

  -- Fără intent atașat → nimic de anulat la Stripe; marcăm direct.
  if v_pay.stripe_payment_intent_id is null then
    update public.table_payments
       set status = 'canceled',
           settle_note = 'Anulat de client (plătește la ospătar) înainte de atașarea intent-ului.',
           updated_at = now()
     where id = v_pay.id;
    return jsonb_build_object('cancelable', true, 'canceled', true, 'no_intent', true);
  end if;

  -- Cu intent: funcția Netlify anulează la Stripe, apoi settle('canceled').
  select stripe_account_id into v_account
    from public.restaurants where id = v_pay.restaurant_id;

  return jsonb_build_object(
    'cancelable',               true,
    'canceled',                 false,
    'stripe_payment_intent_id', v_pay.stripe_payment_intent_id,
    'stripe_account_id',        v_account
  );
end;
$$;

revoke all on function public.cancel_table_payment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_table_payment(uuid, uuid, text) to service_role;

comment on function public.cancel_table_payment(uuid, uuid, text) is
  $$Opt-out client din plata online (mig 208): validează ownership (sesiune +
token pe aceeași masă); fără intent → canceled direct; cu intent → întoarce
datele pentru cancel-ul Stripe (mutația vine prin settle). service_role-only.$$;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.cancel_table_payment(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.cancel_table_payment(uuid, uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL: cancel_table_payment trebuie să fie service_role-only';
  end if;
  if not has_function_privilege('service_role', 'public.cancel_table_payment(uuid, uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL: service_role fără EXECUTE pe cancel_table_payment';
  end if;
end $$;

commit;

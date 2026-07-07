-- ═══════════════════════════════════════════════════════════════════
-- Migration 207: settle_table_payment — 'failed' devine NE-terminal
-- ─────────────────────────────────────────────────────────────────────
-- BUG (prins la review-ul advers al valului de plăți, înainte de orice
-- tranzacție reală): Stripe emite `payment_intent.payment_failed` la FIECARE
-- încercare eșuată de confirmare, iar PaymentIntent-ul RĂMÂNE confirmabil —
-- clientul poate reîncerca alt card în același Payment Element. Versiunea din
-- mig 203 trata 'failed' ca stare terminală → la retry-ul reușit, webhook-ul
-- de succeeded primea `already_settled` și comenzile NU se mai marcau plătite,
-- deși banii fuseseră încasați. Pierdere tăcută de venit + masă "neplătită".
--
-- Fix: terminale rămân DOAR 'succeeded' și 'canceled'. 'failed' înregistrează
-- ultima eroare (informativ) dar permite tranziția failed → succeeded.
-- Restul corpului = copie exactă din mig 203.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

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

  -- Succes (inclusiv după una sau mai multe încercări eșuate): comenzile din
  -- snapshot devin 'paid' cu card_online — triggerul enqueue_fiscal_receipt
  -- (mig 030) preia bonul de aici.
  foreach v_oid in array v_pay.order_ids loop
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
         settle_note = case
           when v_skipped > 0 then format(
             '%s comenzi sărite (plătite/anulate între timp) — verifică dacă e nevoie de refund parțial.',
             v_skipped)
           else null
         end,
         updated_at = now()
   where id = v_pay.id;

  return jsonb_build_object('status', 'succeeded', 'orders_paid', v_paid, 'orders_skipped', v_skipped);
end;
$$;

-- Privilegiile se păstrează (service_role-only, ca în mig 203).
revoke all on function public.settle_table_payment(text, text, text) from public, anon, authenticated;
grant execute on function public.settle_table_payment(text, text, text) to service_role;

comment on function public.settle_table_payment(text, text, text) is
  $$Idempotent pe intent id; terminale = succeeded/canceled (mig 207: failed
permite retry-ul de card → failed→succeeded settle-ază comenzile). succeeded →
orders paid cu card_online (triggerul fiscal preia bonul).$$;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.settle_table_payment(text, text, text)'::regprocedure);
  -- Marker-ul fix-ului: failed nu mai e în lista de stări terminale.
  if position($marker$in ('succeeded', 'canceled')$marker$ in v_def) = 0 then
    raise exception 'ASSERT FAIL: mig 207 — failed pare tot terminal în settle_table_payment';
  end if;
  if has_function_privilege('anon', 'public.settle_table_payment(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.settle_table_payment(text, text, text)', 'execute') then
    raise exception 'ASSERT FAIL: settle_table_payment trebuie să rămână service_role-only';
  end if;
end $$;

commit;

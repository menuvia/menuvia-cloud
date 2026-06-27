-- mig 097B — Program de afiliere: RPC de scriere a comisioanelor (Faza 1, partea 2)
--
-- Singura cale prin care un comision intră în ledger. Apelat de webhook-ul
-- Stripe (service_role) la `invoice.paid`. Toată logica banilor trăiește în SQL
-- testabil (CI „Apply all migrations"), nu în JS Netlify — conform regulii de
-- aur din CLAUDE.md (bani = gate în RPC, nu UI/JS).
--
-- Convenție (aliniat cu cele 7 RPC de lockdown 096): SECURITY DEFINER,
-- search_path = public, pg_temp, returnează jsonb, PUBLIC/anon/authenticated
-- zero EXECUTE. Aici GRANT doar service_role (apelat din webhook, nu din UI).
--
-- Idempotency: crash-safe. Reprocesarea aceluiași event (retry Stripe) NU
-- redublează — `(stripe_event_id, leg)` e UNIQUE și, la duplicat, recuperăm
-- id-ul existent ca să putem totuși completa cascade-ul dacă prima încercare
-- a crăpat între setup și cascade.
--
-- Rotunjire: floor division întreagă `(amount * bps) / 10000` — favorizează
-- casa (comision rotunjit în jos), evită supra-plata. Documentat intenționat.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace function public.process_affiliate_invoice_paid(
  p_event_id               text,
  p_stripe_customer_id     text,
  p_stripe_subscription_id text,
  p_stripe_invoice_id      text,
  p_billing_reason         text,
  p_amount_paid_cents      bigint,
  p_currency               text,
  p_period_month           date,
  p_event_created_at       timestamptz
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_attr            record;
  v_aff             record;
  v_parent          record;
  v_currency        public.affiliate_currency;
  v_leg             public.affiliate_ledger_leg;
  v_bps             int;
  v_hold_until      timestamptz;
  v_commission_cents bigint;
  v_ledger_id       uuid;
  v_recurring_count int;
  v_cascade_cents   bigint;
begin
  -- ── Validări de intrare ───────────────────────────────────────────────────
  if p_amount_paid_cents is null or p_amount_paid_cents <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'zero_amount');
  end if;

  -- Moneda trebuie să fie una suportată (RON/EUR). Necunoscut → nu inventăm.
  begin
    v_currency := p_currency::public.affiliate_currency;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_currency', 'currency', p_currency);
  end;

  -- ── Atribuire (profile-bound MVP: legătura e prin stripe_customer_id) ──────
  select * into v_attr
    from public.affiliate_attributions
   where stripe_customer_id = p_stripe_customer_id
     and status in ('pending', 'active')
   order by captured_at
   limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'no_attribution');
  end if;

  select * into v_aff from public.affiliates where id = v_attr.affiliate_id;
  if not found or v_aff.status <> 'active' then
    return jsonb_build_object('ok', true, 'skipped', 'affiliate_inactive');
  end if;

  -- ── Determină legul + procentul + holdul ──────────────────────────────────
  if p_billing_reason = 'subscription_create' then
    v_leg        := 'setup';
    v_bps        := v_aff.setup_bps;
    v_hold_until := now() + interval '60 days';   -- anti-churn pe setup
  elsif p_billing_reason in ('subscription_cycle', 'subscription_update') then
    v_leg        := 'recurring';
    v_bps        := v_aff.recurring_bps;
    v_hold_until := now() + interval '14 days';
    -- Cap 12 luni: numărăm ciclurile recurring deja înregistrate pe atribuire.
    select count(*) into v_recurring_count
      from public.affiliate_ledger
     where attribution_id = v_attr.id and leg = 'recurring';
    if v_recurring_count >= v_aff.recurring_cap_months then
      return jsonb_build_object('ok', true, 'skipped', 'recurring_cap_reached',
                                'cap', v_aff.recurring_cap_months);
    end if;
  else
    return jsonb_build_object('ok', true, 'skipped', 'irrelevant_billing_reason',
                              'billing_reason', p_billing_reason);
  end if;

  v_commission_cents := (p_amount_paid_cents * v_bps) / 10000;  -- floor, favorizează casa

  -- ── Activează atribuirea la primul comision ───────────────────────────────
  update public.affiliate_attributions
     set status                 = 'active',
         stripe_subscription_id = coalesce(stripe_subscription_id, p_stripe_subscription_id)
   where id = v_attr.id and status = 'pending';

  -- ── Inserează comisionul (idempotent pe event+leg) ────────────────────────
  insert into public.affiliate_ledger
    (affiliate_id, attribution_id, leg, period_month, base_cents, commission_bps,
     amount_cents, currency, hold_until, stripe_event_id, stripe_invoice_id, stripe_event_created_at)
  values
    (v_aff.id, v_attr.id, v_leg,
     case when v_leg = 'recurring' then p_period_month else null end,
     p_amount_paid_cents, v_bps, v_commission_cents, v_currency, v_hold_until,
     p_event_id, p_stripe_invoice_id, p_event_created_at)
  -- predicatul WHERE oglindește indexul parțial uq_affiliate_ledger_event_leg.
  on conflict (stripe_event_id, leg) where stripe_event_id is not null do nothing
  returning id into v_ledger_id;

  -- Crash-safe: dacă rândul există deja (retry), recuperăm id-ul ca să putem
  -- totuși completa cascade-ul dacă prima încercare a crăpat după setup.
  if v_ledger_id is null then
    select id into v_ledger_id
      from public.affiliate_ledger
     where stripe_event_id = p_event_id and leg = v_leg;
  end if;

  -- ── Cascade către parent (1 nivel) ────────────────────────────────────────
  if v_aff.parent_affiliate_id is not null and v_commission_cents > 0 then
    select * into v_parent from public.affiliates where id = v_aff.parent_affiliate_id;
    if found and v_parent.status = 'active' then
      v_cascade_cents := (v_commission_cents * v_parent.cascade_bps) / 10000;
      if v_cascade_cents > 0 then
        insert into public.affiliate_ledger
          (affiliate_id, attribution_id, source_ledger_id, leg, base_cents, commission_bps,
           amount_cents, currency, hold_until, stripe_event_id, stripe_invoice_id, stripe_event_created_at)
        values
          (v_parent.id, v_attr.id, v_ledger_id, 'cascade', v_commission_cents, v_parent.cascade_bps,
           v_cascade_cents, v_currency, v_hold_until, p_event_id, p_stripe_invoice_id, p_event_created_at)
        on conflict (stripe_event_id, leg) where stripe_event_id is not null do nothing;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true,
                            'ledger_id', v_ledger_id,
                            'leg', v_leg,
                            'commission_cents', v_commission_cents);
end$$;

revoke all on function public.process_affiliate_invoice_paid(
  text, text, text, text, text, bigint, text, date, timestamptz
) from public, anon, authenticated;
grant execute on function public.process_affiliate_invoice_paid(
  text, text, text, text, text, bigint, text, date, timestamptz
) to service_role;

comment on function public.process_affiliate_invoice_paid(
  text, text, text, text, text, bigint, text, date, timestamptz
) is
  'Scrie comisionul de afiliere la invoice.paid (setup/recurring + cascade). '
  'SECURITY DEFINER, idempotent pe (event, leg), apelat de webhook (service_role).';

-- ── Asserții inline fail-closed ──────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'process_affiliate_invoice_paid'
       and p.prosecdef  -- SECURITY DEFINER
  ) then
    raise exception 'mig 097B: process_affiliate_invoice_paid missing or not SECURITY DEFINER';
  end if;
  raise notice 'mig 097B: commission RPC OK';
end $$;

commit;

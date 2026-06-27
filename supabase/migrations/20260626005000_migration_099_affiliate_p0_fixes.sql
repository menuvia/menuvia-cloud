-- mig 099 — Program de afiliere: cele 3 fix-uri P0 (corectitudine financiară)
--
-- Auditul critic a găsit 3 găuri care fac programul să plătească GREȘIT:
--   P0-1  Fără clawback: refund/dispute nu storna comisionul → afiliatul
--         păstra banii pe un client refundat. Holdul de 60z era inutil.
--   P0-2  Setup fee pierdut pe trial: la trial prima factură (subscription_create)
--         e €0 → skip; prima cu bani vine ca subscription_cycle → tratată ca
--         recurring. Comisionul de activare nu se plătea niciodată.
--   P0-3  Fără gate Plan 3: comisionul se plătea pe orice plan; la downgrade
--         Plan 3→2 recurring-ul continua. Încalcă regula de aur.
--
-- Migrațiile aplicate nu se editează → fișier nou cu create-or-replace.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- P0-1a. Schema clawback: stripe_refund_id + idempotency per (refund, reversat)
--   Refund-uri parțiale MULTIPLE pe același charge = events diferite dar pot
--   viza același comision → cheia corectă e refund_id, nu event_id.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.affiliate_ledger
  add column if not exists stripe_refund_id text;

-- Un (refund, comision-reversat) o singură dată — acoperă tier-1 + cascade distinct.
create unique index if not exists uq_affiliate_ledger_refund
  on public.affiliate_ledger (stripe_refund_id, reverses_ledger_id)
  where leg = 'clawback' and stripe_refund_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- P0-1b. v_affiliate_payable NET-aware
--   Clawback-ul parțial nu mai exclude 100% din comision: payable = credit +
--   suma stornărilor lui, dacă net > 0. (Vechiul „not exists reverser" făcea
--   un refund de 50% să anuleze tot comisionul.)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view public.v_affiliate_payable
  with (security_invoker = true) as
  select l.id,
         l.affiliate_id,
         l.attribution_id,
         l.leg,
         l.period_month,
         (l.amount_cents + coalesce((
           select sum(r.amount_cents) from public.affiliate_ledger r
            where r.reverses_ledger_id = l.id
         ), 0))::bigint as amount_cents,              -- NET (credit − stornări)
         l.currency,
         l.hold_until
    from public.affiliate_ledger l
   where l.leg in ('setup', 'recurring', 'cascade')
     and l.amount_cents > 0
     and l.hold_until <= now()
     and l.amount_cents + coalesce((
           select sum(r.amount_cents) from public.affiliate_ledger r
            where r.reverses_ledger_id = l.id
         ), 0) > 0;                                   -- net pozitiv

comment on view public.v_affiliate_payable is
  'Comisioane eligibile (net după clawback parțial), trecute de hold (security_invoker).';

-- ═══════════════════════════════════════════════════════════════════════════
-- P0-2 + P0-3. process_affiliate_invoice_paid — semnătură nouă (+ p_plan)
--   • Gate Plan 3 (fail-closed pe pro/enterprise) — downgrade-safe (webhook
--     pasează planul din price.id, sursa de adevăr a ce s-a facturat).
--   • Setup = prima factură cu bani pe atribuire (event-anchored idempotent),
--     nu billing_reason — fixează trial.
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists public.process_affiliate_invoice_paid(
  text, text, text, text, text, bigint, text, date, timestamptz);

create or replace function public.process_affiliate_invoice_paid(
  p_event_id               text,
  p_stripe_customer_id     text,
  p_stripe_subscription_id text,
  p_stripe_invoice_id      text,
  p_billing_reason         text,     -- doar informativ acum (audit)
  p_amount_paid_cents      bigint,
  p_currency               text,
  p_period_month           date,
  p_event_created_at       timestamptz,
  p_plan                   text       -- planul EFECTIV facturat (din price.id)
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
  v_is_setup        boolean;
begin
  if p_amount_paid_cents is null or p_amount_paid_cents <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'zero_amount');
  end if;

  -- P0-3: REGULA DE AUR — comision DOAR pe Plan 3. Fail-closed (null/necunoscut → skip).
  if p_plan is null or p_plan not in ('pro', 'enterprise') then
    return jsonb_build_object('ok', true, 'skipped', 'not_plan3', 'plan', p_plan);
  end if;

  begin
    v_currency := p_currency::public.affiliate_currency;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_currency', 'currency', p_currency);
  end;

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

  -- P0-2: setup = prima factură cu bani pe atribuire, EVENT-ANCHORED idempotent.
  -- Dacă ACEST event a inserat deja un setup → e setup (retry, ON CONFLICT prinde).
  -- Altfel e setup doar dacă NU există încă vreun setup pe atribuire.
  select exists(
    select 1 from public.affiliate_ledger
     where attribution_id = v_attr.id and leg = 'setup' and stripe_event_id = p_event_id
  ) into v_is_setup;
  if not v_is_setup then
    select not exists(
      select 1 from public.affiliate_ledger
       where attribution_id = v_attr.id and leg = 'setup'
    ) into v_is_setup;
  end if;

  if v_is_setup then
    v_leg        := 'setup';
    v_bps        := v_aff.setup_bps;
    v_hold_until := now() + interval '60 days';
  else
    v_leg        := 'recurring';
    v_bps        := v_aff.recurring_bps;
    v_hold_until := now() + interval '14 days';
    select count(*) into v_recurring_count
      from public.affiliate_ledger
     where attribution_id = v_attr.id and leg = 'recurring';
    if v_recurring_count >= v_aff.recurring_cap_months then
      return jsonb_build_object('ok', true, 'skipped', 'recurring_cap_reached',
                                'cap', v_aff.recurring_cap_months);
    end if;
  end if;

  v_commission_cents := (p_amount_paid_cents * v_bps) / 10000;

  update public.affiliate_attributions
     set status                 = 'active',
         stripe_subscription_id = coalesce(stripe_subscription_id, p_stripe_subscription_id)
   where id = v_attr.id and status = 'pending';

  insert into public.affiliate_ledger
    (affiliate_id, attribution_id, leg, period_month, base_cents, commission_bps,
     amount_cents, currency, hold_until, stripe_event_id, stripe_invoice_id, stripe_event_created_at)
  values
    (v_aff.id, v_attr.id, v_leg,
     case when v_leg = 'recurring' then p_period_month else null end,
     p_amount_paid_cents, v_bps, v_commission_cents, v_currency, v_hold_until,
     p_event_id, p_stripe_invoice_id, p_event_created_at)
  on conflict (stripe_event_id, leg) where stripe_event_id is not null do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    select id into v_ledger_id
      from public.affiliate_ledger
     where stripe_event_id = p_event_id and leg = v_leg;
  end if;

  -- Cascade către parent (1 nivel).
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

  return jsonb_build_object('ok', true, 'ledger_id', v_ledger_id, 'leg', v_leg,
                            'commission_cents', v_commission_cents);
end$$;

revoke all on function public.process_affiliate_invoice_paid(
  text, text, text, text, text, bigint, text, date, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.process_affiliate_invoice_paid(
  text, text, text, text, text, bigint, text, date, timestamptz, text
) to service_role;

comment on function public.process_affiliate_invoice_paid(
  text, text, text, text, text, bigint, text, date, timestamptz, text
) is
  'Comision la invoice.paid. Gate Plan 3 (p_plan). Setup=prima factură cu bani (event-anchored).';

-- ═══════════════════════════════════════════════════════════════════════════
-- P0-1c. process_affiliate_refund — clawback proporțional + cascade reverse
--   Apelat de webhook la charge.refunded (per refund.id) și dispute lost.
--   Idempotent pe (refund_id, reverses_ledger_id). Append-only (rânduri noi).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.process_affiliate_refund(
  p_event_id            text,
  p_stripe_invoice_id   text,
  p_charge_amount_cents bigint,
  p_refund_id           text,
  p_refund_amount_cents bigint,
  p_event_created_at    timestamptz
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_orig    record;
  v_casc    record;
  v_claw    bigint;
  v_claw_id uuid;
  v_count   int := 0;
begin
  if p_charge_amount_cents is null or p_charge_amount_cents <= 0
     or p_refund_amount_cents is null or p_refund_amount_cents <= 0
     or p_stripe_invoice_id is null or p_refund_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'bad_input');
  end if;

  -- Comisioanele pozitive (setup/recurring) ale facturii refundate.
  for v_orig in
    select * from public.affiliate_ledger
     where stripe_invoice_id = p_stripe_invoice_id
       and leg in ('setup', 'recurring')
       and amount_cents > 0
  loop
    -- Storno proporțional cu fracția refundată (mărginit la valoarea originalului).
    v_claw := least(v_orig.amount_cents,
                    (v_orig.amount_cents * p_refund_amount_cents) / p_charge_amount_cents);

    -- stripe_event_id rămâne NULL pe clawback: indexul (event,leg) ar coliziona
    -- între clawback-ul tier-1 și cel de cascade (același event, leg='clawback').
    -- Idempotency clawback = (refund_id, reverses_ledger_id). Audit = invoice+refund.
    insert into public.affiliate_ledger
      (affiliate_id, attribution_id, reverses_ledger_id, leg, base_cents, amount_cents,
       currency, hold_until, stripe_invoice_id, stripe_refund_id, stripe_event_created_at)
    values
      (v_orig.affiliate_id, v_orig.attribution_id, v_orig.id, 'clawback', 0, -v_claw,
       v_orig.currency, now(), p_stripe_invoice_id, p_refund_id, p_event_created_at)
    on conflict (stripe_refund_id, reverses_ledger_id) where leg = 'clawback' and stripe_refund_id is not null do nothing
    returning id into v_claw_id;

    if v_claw_id is not null then v_count := v_count + 1; end if;

    -- Cascade reverse: stornează și cota parent-ului din acest comision.
    for v_casc in
      select * from public.affiliate_ledger
       where source_ledger_id = v_orig.id and leg = 'cascade' and amount_cents > 0
    loop
      insert into public.affiliate_ledger
        (affiliate_id, attribution_id, reverses_ledger_id, source_ledger_id, leg, base_cents,
         amount_cents, currency, hold_until, stripe_invoice_id, stripe_refund_id, stripe_event_created_at)
      values
        (v_casc.affiliate_id, v_casc.attribution_id, v_casc.id, v_claw_id, 'clawback', 0,
         -least(v_casc.amount_cents, (v_casc.amount_cents * p_refund_amount_cents) / p_charge_amount_cents),
         v_casc.currency, now(), p_stripe_invoice_id, p_refund_id, p_event_created_at)
      on conflict (stripe_refund_id, reverses_ledger_id) where leg = 'clawback' and stripe_refund_id is not null do nothing;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'clawed_back', v_count, 'refund_id', p_refund_id);
end$$;

revoke all on function public.process_affiliate_refund(text, text, bigint, text, bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_affiliate_refund(text, text, bigint, text, bigint, timestamptz)
  to service_role;

comment on function public.process_affiliate_refund(text, text, bigint, text, bigint, timestamptz) is
  'Clawback proporțional la refund (+ cascade reverse). Idempotent pe (refund_id, reversat).';

-- ── Asserții inline ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='process_affiliate_refund' and p.prosecdef) then
    raise exception 'mig 099: process_affiliate_refund missing';
  end if;
  -- noua semnătură cu 10 args
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='process_affiliate_invoice_paid'
       and p.pronargs = 10) then
    raise exception 'mig 099: process_affiliate_invoice_paid trebuie să aibă 10 args (+ p_plan)';
  end if;
  raise notice 'mig 099: P0 fixes OK';
end $$;

commit;

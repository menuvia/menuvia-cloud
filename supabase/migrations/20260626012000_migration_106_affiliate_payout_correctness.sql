-- mig 106 — Fix corectitudine plăți: 3 căi de plată greșită în state-machine (098)
--
-- Găsite la review adversarial end-to-end. Toate pe mig 098 (deja aplicată) →
-- reparate prin create-or-replace al funcțiilor într-un fișier NOU.
--
-- PAYOUT-1 (P0): trigger-ul de decontare inserează `-gross_cents` la →paid FĂRĂ
--   nicio re-validare. gross e înghețat la draft; dacă între draft și plată apare
--   un clawback (refund), comisionul devine net 0/parțial, dar settle plătește
--   cash gross-ul original → bani reali pe comision stornat.
--   FIX: la →paid, impune invariantul `eligibil_net ≥ deja_plătit + gross`;
--   altfel blochează tranziția (operatorul reconciliază: cancel + re-batch).
--
-- AFF-E2E-1 (P1): un payout putea ajunge 'processing' cu wise_transfer_id NULL
--   (doar comentariul enum cerea setarea lui), apoi processing→failed→revival→paid
--   inserând un al doilea debit → dublă plată.
--   FIX: impune wise_transfer_id NOT NULL la intrarea în 'processing'. Astfel
--   garda de no-revert (098:130) devine efectivă pentru ORICE payout ajuns la
--   transfer, iar singura ieșire din 'failed' rămâne →canceled (reconciliere).
--
-- PAYOUT-2 (P1): 'failed' (și 'on_hold') erau excluse din v_committed, deci
--   gross-ul se elibera necondiționat și re-batch-ul crea un draft nou — dublă
--   plată dacă transferul Wise plecase deja. (Fix-ul „forțează on_hold" propus
--   inițial era insuficient: on_hold lipsea și el din v_committed.)
--   FIX: gross-ul rămâne ANGAJAT pentru 'on_hold' și pentru 'failed' cu
--   wise_transfer_id (transfer inițiat → reconciliere manuală, nu auto-release).
--   Eliberarea reală se face explicit prin →canceled (după ce operatorul
--   confirmă că banii NU au plecat).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Tranziții: impune wise_transfer_id la intrarea în 'processing' (AFF-E2E-1)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_affiliate_payout_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ok boolean := false;
begin
  if OLD.status = NEW.status then
    return NEW;  -- update non-status (ex. invoice_number) permis
  end if;

  v_ok := case OLD.status
    when 'draft'            then NEW.status in ('awaiting_invoice','canceled')
    when 'awaiting_invoice' then NEW.status in ('invoice_matched','canceled')
    when 'invoice_matched'  then NEW.status in ('processing','canceled')
    when 'processing'       then NEW.status in ('paid','failed','on_hold')
    when 'on_hold'          then NEW.status in ('paid','failed')
    when 'failed'           then NEW.status in ('invoice_matched','canceled')
    else false  -- paid / canceled = terminale
  end;

  if not v_ok then
    raise exception using errcode = 'check_violation',
      message = format('payout: tranziție invalidă %s → %s', OLD.status, NEW.status),
      hint    = 'invalid_payout_transition';
  end if;

  -- AFF-E2E-1: un payout nu poate intra în 'processing' fără wise_transfer_id
  -- (transferul a fost efectiv inițiat). Face efectivă garda de no-revert de mai
  -- jos pentru ORICE payout ajuns la transfer și elimină calea
  -- processing(fără wise)→failed→revival→paid (dublă plată).
  if NEW.status = 'processing' and NEW.wise_transfer_id is null then
    raise exception using errcode = 'check_violation',
      message = 'payout: tranziția în processing necesită wise_transfer_id (transfer inițiat)',
      hint    = 'processing_requires_wise_transfer_id';
  end if;

  -- Niciodată înapoi spre o stare pre-transfer odată ce wise_transfer_id există.
  if OLD.wise_transfer_id is not null and NEW.status in ('draft','awaiting_invoice','invoice_matched') then
    raise exception using errcode = 'check_violation',
      message = 'payout: nu se poate reveni la o stare pre-transfer după ce există wise_transfer_id',
      hint    = 'invalid_payout_transition';
  end if;

  NEW.updated_at := now();
  if NEW.status = 'paid' and NEW.paid_at is null then
    NEW.paid_at := now();
  end if;
  return NEW;
end$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Decontare: invariant anti-supraplată la →paid (PAYOUT-1, P0)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_affiliate_payout_settle()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_eligible bigint;
  v_paid     bigint;
begin
  if NEW.status = 'paid' and OLD.status <> 'paid' then
    -- Eligibil net curent (credite net-clawback, trecute de hold), pe moneda payout-ului.
    select coalesce(sum(amount_cents), 0) into v_eligible
      from public.v_affiliate_payable
     where affiliate_id = NEW.affiliate_id and currency = NEW.currency;
    -- Cât s-a decontat deja (payout-urile sunt negative → semn invers).
    select coalesce(-sum(amount_cents), 0) into v_paid
      from public.affiliate_ledger
     where affiliate_id = NEW.affiliate_id and currency = NEW.currency and leg = 'payout';

    -- Invariant: niciodată nu plătim mai mult decât e datorat net (după clawback).
    if v_eligible < v_paid + NEW.gross_cents then
      raise exception using errcode = 'check_violation',
        message = format('payout: gross %s depășește eligibilul net rămas %s (clawback după draft?)',
                          NEW.gross_cents, v_eligible - v_paid),
        hint    = 'payout_exceeds_eligible';
    end if;

    insert into public.affiliate_ledger
      (affiliate_id, leg, amount_cents, currency, hold_until, payout_id)
    values
      (NEW.affiliate_id, 'payout', -NEW.gross_cents, NEW.currency, now(), NEW.id);
  end if;
  return null;
end$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Batch: gross-ul rămâne angajat pentru on_hold + failed-cu-transfer (PAYOUT-2)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.run_affiliate_payout_batch(
  p_period_month date,
  p_min_cents    bigint default 5000
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r           record;
  v_eligible  bigint;
  v_committed bigint;
  v_payable   bigint;
  v_created   int := 0;
  v_skipped   int := 0;
begin
  if p_period_month <> date_trunc('month', p_period_month)::date then
    raise exception 'period_month trebuie să fie prima zi a lunii';
  end if;

  for r in select id from public.affiliates where status = 'active' loop
    select coalesce(sum(amount_cents), 0) into v_eligible
      from public.v_affiliate_payable where affiliate_id = r.id and currency = 'RON';

    -- Angajat = în zbor sau decontat. Eliberăm gross-ul DOAR pentru stările care
    -- garantat NU au mișcat bani: 'canceled' și 'failed' FĂRĂ wise_transfer_id.
    -- 'on_hold' și 'failed' CU wise_transfer_id rămân angajate (reconciliere).
    select coalesce(sum(gross_cents), 0) into v_committed
      from public.affiliate_payouts
     where affiliate_id = r.id and currency = 'RON'
       and (status in ('draft','awaiting_invoice','invoice_matched','processing','paid','on_hold')
            or (status = 'failed' and wise_transfer_id is not null));

    v_payable := v_eligible - v_committed;

    if v_payable < p_min_cents then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.affiliate_payouts (affiliate_id, period_month, currency, gross_cents, status)
    values (r.id, p_period_month, 'RON', v_payable, 'draft')
    on conflict (affiliate_id, period_month) do nothing;

    if found then v_created := v_created + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped,
                            'period', p_period_month);
end$$;

do $$ begin raise notice 'mig 106: payout correctness (PAYOUT-1/2 + AFF-E2E-1) OK'; end $$;

commit;

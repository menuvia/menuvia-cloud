-- tests/sql/affiliate_payout_assertions.sql
-- =============================================================================
-- Asserții pentru payouts (mig 098): state machine + decontare WORM-compatibilă.
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/affiliate_payout_assertions.sql
--
--   PO1  run_batch creează draft din soldul plătibil
--   PO2  idempotent per (afiliat, perioadă)
--   PO3  perioadă următoare nu re-angajează soldul în zbor
--   PO4  tranziție invalidă (draft→paid) respinsă
--   PO5  parcurs valid → paid inserează debit ledger; balanță = 0
--   PO6  paid e terminal (revert respins)
--   PO7  payout failed eliberează soldul (redevine plătibil)
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1','00a1@aff.test'),
  ('00000000-0000-0000-0000-0000000000b2','00b2@aff.test'),
  ('00000000-0000-0000-0000-0000000000c3','00c3@aff.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-0000000000a1','00a1@aff.test'),
  ('00000000-0000-0000-0000-0000000000b2','00b2@aff.test'),
  ('00000000-0000-0000-0000-0000000000c3','00c3@aff.test')
  on conflict (id) do nothing;
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','aff001');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status) values
  ('0b000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b2','active');
-- Comision PAYABLE: hold trecut.
insert into public.affiliate_ledger
  (affiliate_id, attribution_id, leg, base_cents, commission_bps, amount_cents, hold_until, stripe_event_id)
  values ('0a000000-0000-0000-0000-000000000001','0b000000-0000-0000-0000-000000000001',
          'setup',290000,3000,87000, now() - interval '1 day','evt_payable');

-- ── PO1 ──────────────────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.run_affiliate_payout_batch('2026-07-01');
  if (v->>'created')::int <> 1 then raise exception 'PO1 FAIL: created=%', v->>'created'; end if;
  if (select gross_cents from public.affiliate_payouts where period_month='2026-07-01') <> 87000 then
    raise exception 'PO1 FAIL: gross greșit'; end if;
  raise notice 'PO1 OK: draft 87000 creat';
end $$;

-- ── PO2 ──────────────────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.run_affiliate_payout_batch('2026-07-01');
  if (v->>'created')::int <> 0 then raise exception 'PO2 FAIL: re-creat (%)', v; end if;
  raise notice 'PO2 OK: idempotent';
end $$;

-- ── PO3 ──────────────────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.run_affiliate_payout_batch('2026-08-01');
  if (v->>'created')::int <> 0 then raise exception 'PO3 FAIL: a re-angajat soldul în zbor (%)', v; end if;
  raise notice 'PO3 OK: sold în zbor neangajat din nou';
end $$;

-- ── PO4 ──────────────────────────────────────────────────────────────────────
do $$
declare v_raised boolean := false;
begin
  begin
    update public.affiliate_payouts set status='paid' where period_month='2026-07-01';
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'PO4 FAIL: draft→paid acceptat'; end if;
  raise notice 'PO4 OK: tranziție invalidă respinsă';
end $$;

-- ── PO5 ──────────────────────────────────────────────────────────────────────
update public.affiliate_payouts set status='awaiting_invoice' where period_month='2026-07-01';
update public.affiliate_payouts set status='invoice_matched', invoice_number='F2026-001' where period_month='2026-07-01';
update public.affiliate_payouts set status='processing', wise_transfer_id=123456 where period_month='2026-07-01';
update public.affiliate_payouts set status='paid' where period_month='2026-07-01';
do $$
declare v_debit bigint; v_balance bigint;
begin
  select coalesce(sum(amount_cents),0) into v_debit from public.affiliate_ledger where leg='payout';
  if v_debit <> -87000 then raise exception 'PO5 FAIL: debit payout=% (așteptat -87000)', v_debit; end if;
  select balance_cents into v_balance from public.v_affiliate_balance
   where affiliate_id='0a000000-0000-0000-0000-000000000001';
  if v_balance <> 0 then raise exception 'PO5 FAIL: balanță=% (așteptat 0)', v_balance; end if;
  raise notice 'PO5 OK: decontare → debit -87000, balanță 0';
end $$;

-- ── PO6 ──────────────────────────────────────────────────────────────────────
do $$
declare v_raised boolean := false;
begin
  begin
    update public.affiliate_payouts set status='awaiting_invoice' where period_month='2026-07-01';
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'PO6 FAIL: revert din paid acceptat'; end if;
  raise notice 'PO6 OK: paid terminal';
end $$;

-- ── PO7: payout 'failed' CU transfer inițiat NU eliberează soldul (mig 106) ───
-- Anti dublă-plată: după ce wise_transfer_id e setat (transferul a plecat la
-- Wise), un 'failed' lasă gross-ul ANGAJAT (reconciliere). Eliberarea reală se
-- face explicit prin →canceled, după ce operatorul confirmă că banii nu au plecat.
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000c3','aff002');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status) values
  ('0b000000-0000-0000-0000-000000000002','0a000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','active');
insert into public.affiliate_ledger
  (affiliate_id, attribution_id, leg, amount_cents, hold_until, stripe_event_id)
  values ('0a000000-0000-0000-0000-000000000002','0b000000-0000-0000-0000-000000000002',
          'setup',60000, now() - interval '1 day','evt_payable2');
do $$
declare v jsonb;
begin
  perform public.run_affiliate_payout_batch('2026-09-01');
  update public.affiliate_payouts set status='awaiting_invoice'
   where affiliate_id='0a000000-0000-0000-0000-000000000002';
  update public.affiliate_payouts set status='invoice_matched'
   where affiliate_id='0a000000-0000-0000-0000-000000000002';
  update public.affiliate_payouts set status='processing', wise_transfer_id=999
   where affiliate_id='0a000000-0000-0000-0000-000000000002';
  update public.affiliate_payouts set status='failed', failure_reason='IBAN invalid'
   where affiliate_id='0a000000-0000-0000-0000-000000000002';
  -- failed CU wise → gross rămâne angajat → re-batch NU recreează (anti dublă-plată).
  v := public.run_affiliate_payout_batch('2026-10-01');
  if (v->>'created')::int <> 0 then raise exception 'PO7 FAIL: failed-cu-transfer a eliberat soldul (%)', v; end if;
  raise notice 'PO7 OK: failed-cu-transfer rămâne angajat';
  -- Operatorul confirmă că banii NU au plecat → canceled eliberează gross-ul.
  update public.affiliate_payouts set status='canceled'
   where affiliate_id='0a000000-0000-0000-0000-000000000002';
  v := public.run_affiliate_payout_batch('2026-11-01');
  if (v->>'created')::int <> 1 then raise exception 'PO7b FAIL: după canceled soldul nu a redevenit plătibil (%)', v; end if;
  raise notice 'PO7b OK: după canceled → sold reeliberat';
end $$;

-- ── PO8: invariant anti-supraplată — clawback între draft și paid BLOCHEAZĂ plata (PAYOUT-1) ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d8','00d8@aff.test'),
  ('00000000-0000-0000-0000-0000000000e8','00e8@aff.test')
  on conflict (id) do nothing;
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000d8','aff008');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status) values
  ('0b000000-0000-0000-0000-000000000008','0a000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000e8','active');
insert into public.affiliate_ledger
  (affiliate_id, attribution_id, leg, base_cents, commission_bps, amount_cents, hold_until, stripe_invoice_id, stripe_event_id)
  values ('0a000000-0000-0000-0000-000000000008','0b000000-0000-0000-0000-000000000008',
          'setup',50000,10000,50000, now() - interval '1 day','in_p8','evt_p8');
do $$
declare v_raised boolean := false;
begin
  perform public.run_affiliate_payout_batch('2026-12-01');
  update public.affiliate_payouts set status='awaiting_invoice'  where affiliate_id='0a000000-0000-0000-0000-000000000008';
  update public.affiliate_payouts set status='invoice_matched'   where affiliate_id='0a000000-0000-0000-0000-000000000008';
  update public.affiliate_payouts set status='processing', wise_transfer_id=777 where affiliate_id='0a000000-0000-0000-0000-000000000008';
  -- ÎNTRE timp: refund integral → clawback -50000 → eligibil net 0.
  perform public.process_affiliate_refund('evt_r8','in_p8',50000,'re_8',50000,now());
  -- →paid trebuie respins (nu plătim cash pe comision stornat).
  begin
    update public.affiliate_payouts set status='paid' where affiliate_id='0a000000-0000-0000-0000-000000000008';
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'PO8 FAIL: plata pe comision stornat NU a fost blocată'; end if;
  raise notice 'PO8 OK: clawback după draft → plata blocată (invariant net)';
end $$;

-- ── PO9: 'processing' fără wise_transfer_id e respins (AFF-E2E-1) ─────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d9','00d9@aff.test'),
  ('00000000-0000-0000-0000-0000000000e9','00e9@aff.test')
  on conflict (id) do nothing;
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000d9','aff009');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status) values
  ('0b000000-0000-0000-0000-000000000009','0a000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000e9','active');
insert into public.affiliate_ledger
  (affiliate_id, attribution_id, leg, amount_cents, hold_until, stripe_event_id)
  values ('0a000000-0000-0000-0000-000000000009','0b000000-0000-0000-0000-000000000009',
          'setup',40000, now() - interval '1 day','evt_p9');
do $$
declare v_raised boolean := false;
begin
  perform public.run_affiliate_payout_batch('2027-01-01');
  update public.affiliate_payouts set status='awaiting_invoice' where affiliate_id='0a000000-0000-0000-0000-000000000009';
  update public.affiliate_payouts set status='invoice_matched'  where affiliate_id='0a000000-0000-0000-0000-000000000009';
  begin
    update public.affiliate_payouts set status='processing' where affiliate_id='0a000000-0000-0000-0000-000000000009';
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'PO9 FAIL: processing fără wise_transfer_id acceptat'; end if;
  raise notice 'PO9 OK: processing necesită wise_transfer_id';
end $$;

-- ── PO10: comision EUR → batch creează draft EUR (mig 107, multi-monedă) ─────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000da','00da@aff.test'),
  ('00000000-0000-0000-0000-0000000000ea','00ea@aff.test')
  on conflict (id) do nothing;
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000da','aff00a');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status) values
  ('0b000000-0000-0000-0000-00000000000a','0a000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000ea','active');
insert into public.affiliate_ledger
  (affiliate_id, attribution_id, leg, amount_cents, currency, hold_until, stripe_event_id)
  values ('0a000000-0000-0000-0000-00000000000a','0b000000-0000-0000-0000-00000000000a',
          'setup',30000,'EUR', now() - interval '1 day','evt_eur');
do $$
declare v jsonb; v_cur text; v_gross bigint;
begin
  v := public.run_affiliate_payout_batch('2027-02-01');
  if (v->>'created')::int < 1 then raise exception 'PO10 FAIL: niciun draft creat (%)', v; end if;
  select currency::text, gross_cents into v_cur, v_gross from public.affiliate_payouts
   where affiliate_id='0a000000-0000-0000-0000-00000000000a' and period_month='2027-02-01';
  if v_cur is distinct from 'EUR' then raise exception 'PO10 FAIL: draft nu e EUR (%)', v_cur; end if;
  if v_gross is distinct from 30000 then raise exception 'PO10 FAIL: gross EUR % (așteptat 30000)', v_gross; end if;
  raise notice 'PO10 OK: comision EUR → draft EUR 30000';
end $$;

do $$ begin raise notice '════ affiliate payout assertions: ALL PASS ════'; end $$;

rollback;

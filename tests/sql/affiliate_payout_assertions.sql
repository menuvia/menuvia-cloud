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

-- ── PO7: payout failed eliberează soldul ─────────────────────────────────────
-- Afiliat nou cu sold plătibil; batch → draft → ... → failed; re-batch îl reia.
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
  -- Soldul (60000) trebuie să redevină plătibil într-o perioadă nouă.
  v := public.run_affiliate_payout_batch('2026-10-01');
  if (v->>'created')::int <> 1 then raise exception 'PO7 FAIL: soldul nu a redevenit plătibil (%)', v; end if;
  raise notice 'PO7 OK: payout failed → sold reeliberat';
end $$;

do $$ begin raise notice '════ affiliate payout assertions: ALL PASS ════'; end $$;

rollback;

-- tests/sql/affiliate_p0_assertions.sql
-- =============================================================================
-- Asserții pentru fix-urile P0 (mig 099): gate Plan 3, setup-pe-trial, clawback.
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/affiliate_p0_assertions.sql
--
--   P0a  gate Plan 3: plan growth → skipped not_plan3
--   P0b  setup pe trial: primul event (subscription_cycle, bani) → leg=setup
--   P0c  refund full → clawback -comision; balanță 0
--   P0d  refund parțial → clawback proporțional; net payable corect
--   P0e  refund idempotent (același refund_id) → fără dublare
--   P0f  cascade reverse la refund
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into public.profiles (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003');
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','parent1');
insert into public.affiliates (id, profile_id, referral_code, parent_affiliate_id) values
  ('0a000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','child01',
   '0a000000-0000-0000-0000-000000000001');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, stripe_customer_id, status) values
  ('0b000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000003','cus_X','pending');

-- ── P0a: gate Plan 3 ─────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.process_affiliate_invoice_paid('evt_growth','cus_X','s','i','subscription_cycle',2900,'RON','2026-07-01',now(),'growth');
  if v->>'skipped' is distinct from 'not_plan3' then raise exception 'P0a FAIL: growth nu a fost gate-uit (%)', v; end if;
  -- null plan → tot skip
  if (public.process_affiliate_invoice_paid('evt_null','cus_X','s','i','subscription_cycle',2900,'RON','2026-07-01',now(),null))->>'skipped'
       is distinct from 'not_plan3' then raise exception 'P0a FAIL: null plan neגate-uit'; end if;
  raise notice 'P0a OK: gate Plan 3 (growth+null respinse)';
end $$;

-- ── P0b: setup pe trial (primul event e subscription_cycle, NU create) ────────
do $$
declare v jsonb;
begin
  -- Scenariu trial: prima factură cu bani vine ca subscription_cycle. Trebuie SETUP.
  v := public.process_affiliate_invoice_paid('evt_trial1','cus_X','sub_X','in_t1','subscription_cycle',2900,'RON','2026-07-01',now(),'pro');
  if v->>'leg' is distinct from 'setup' then
    raise exception 'P0b FAIL: prima factură (cycle) ar trebui setup, e % ', v->>'leg'; end if;
  if (v->>'commission_cents')::bigint <> 870 then
    raise exception 'P0b FAIL: setup 30%% = 870, e %', v->>'commission_cents'; end if;
  raise notice 'P0b OK: setup pe trial (cycle → setup 870)';
end $$;

-- ── P0c: refund full → clawback total, balanță 0 ─────────────────────────────
do $$
declare v_bal bigint;
begin
  -- Refund integral al facturii in_t1 (charge 2900, refund 2900).
  perform public.process_affiliate_refund('evt_ref1','in_t1',2900,'re_1',2900,now());
  -- child: setup 870 + cascade-ul e pe parent; clawback child -870 → child 0
  select coalesce(balance_cents,0) into v_bal from public.v_affiliate_balance
   where affiliate_id='0a000000-0000-0000-0000-000000000002' and currency='RON';
  if v_bal <> 0 then raise exception 'P0c FAIL: balanță child % (așteptat 0)', v_bal; end if;
  raise notice 'P0c OK: refund full → balanță child 0';
end $$;

-- ── P0f: cascade reverse (parent a fost stornat la P0c) ──────────────────────
do $$
declare v_pbal bigint;
begin
  select coalesce(balance_cents,0) into v_pbal from public.v_affiliate_balance
   where affiliate_id='0a000000-0000-0000-0000-000000000001' and currency='RON';
  -- parent: cascade 17 − clawback 17 = 0
  if v_pbal <> 0 then raise exception 'P0f FAIL: cascade parent nestornat (balanță %)', v_pbal; end if;
  raise notice 'P0f OK: cascade reverse (parent 0)';
end $$;

-- ── P0e: refund idempotent (același refund_id) → fără dublare ─────────────────
do $$
declare v_before int; v_after int;
begin
  select count(*) into v_before from public.affiliate_ledger where stripe_refund_id='re_1';
  perform public.process_affiliate_refund('evt_ref1b','in_t1',2900,'re_1',2900,now());
  select count(*) into v_after from public.affiliate_ledger where stripe_refund_id='re_1';
  if v_before <> v_after then raise exception 'P0e FAIL: refund dublat (% → %)', v_before, v_after; end if;
  raise notice 'P0e OK: refund idempotent (% rânduri)', v_after;
end $$;

-- ── P0d: refund parțial → net payable corect ─────────────────────────────────
-- Atribuire+comision nou (profil 004, alt customer) cu hold trecut pentru payable.
insert into public.profiles (id) values ('00000000-0000-0000-0000-000000000004');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, stripe_customer_id, status) values
  ('0b000000-0000-0000-0000-000000000002','0a000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000004','cus_Y','active');
-- Comision direct cu hold trecut (parent, fără cascade — nu are parent).
insert into public.affiliate_ledger
  (affiliate_id, attribution_id, leg, base_cents, commission_bps, amount_cents, hold_until, stripe_invoice_id, stripe_event_id)
  values ('0a000000-0000-0000-0000-000000000001','0b000000-0000-0000-0000-000000000002',
          'setup',2900,3000,870, now() - interval '1 day','in_y','evt_y');
do $$
declare v_payable bigint;
begin
  -- Refund 50% (1450 din 2900) → clawback -435 → net payable 435.
  perform public.process_affiliate_refund('evt_refy','in_y',2900,'re_y',1450,now());
  select coalesce(sum(amount_cents),0) into v_payable from public.v_affiliate_payable
   where affiliate_id='0a000000-0000-0000-0000-000000000001';
  if v_payable <> 435 then raise exception 'P0d FAIL: net payable % (așteptat 435)', v_payable; end if;
  raise notice 'P0d OK: refund parțial → net payable 435';
end $$;

do $$ begin raise notice '════ affiliate P0 assertions: ALL PASS ════'; end $$;

rollback;

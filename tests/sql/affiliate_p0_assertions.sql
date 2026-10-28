-- tests/sql/affiliate_p0_assertions.sql
-- =============================================================================
-- Asserții pentru fix-urile P0 (mig 099): gate Plan 3, setup-pe-trial, clawback.
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/affiliate_p0_assertions.sql
--
--   P0a  gate pe planuri PLĂTITE (mig 293 a ridicat gate-ul Plan 3 din 099 — decizia
--        fondatorului): free / NULL → skipped not_paid_plan
--   P0b  setup pe trial: primul event cu bani (subscription_cycle) e baza setup-ului,
--        câștigat la a DOUA factură plătită (mig 293)
--   P0c  refund full → clawback -comision; balanță 0
--   P0d  refund parțial → clawback proporțional; net payable corect
--   P0e  refund idempotent (același refund_id) → fără dublare
--   P0f  cascade reverse la refund
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001','0001@aff.test'),
  ('00000000-0000-0000-0000-000000000002','0002@aff.test'),
  ('00000000-0000-0000-0000-000000000003','0003@aff.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-000000000001','0001@aff.test'),
  ('00000000-0000-0000-0000-000000000002','0002@aff.test'),
  ('00000000-0000-0000-0000-000000000003','0003@aff.test')
  on conflict (id) do nothing;
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','parent1');
insert into public.affiliates (id, profile_id, referral_code, parent_affiliate_id) values
  ('0a000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','child01',
   '0a000000-0000-0000-0000-000000000001');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, stripe_customer_id, status) values
  ('0b000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000003','cus_X','pending');

-- ── P0a: gate pe planuri plătite (mig 293) ───────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.process_affiliate_invoice_paid('evt_free','cus_X','s','i','subscription_cycle',2900,'RON','2026-07-01',now(),'free');
  if v->>'skipped' is distinct from 'not_paid_plan' then raise exception 'P0a FAIL: free nu a fost gate-uit (%)', v; end if;
  -- null plan → tot skip
  if (public.process_affiliate_invoice_paid('evt_null','cus_X','s','i','subscription_cycle',2900,'RON','2026-07-01',now(),null))->>'skipped'
       is distinct from 'not_paid_plan' then raise exception 'P0a FAIL: null plan negate-uit'; end if;
  raise notice 'P0a OK: gate planuri plătite (free+null respinse)';
end $$;

-- ── T4: gate EXHAUSTIV — tot ce nu e plan plătit e skip; pro/enterprise produc comision ─
-- mig 293: starter/growth NU mai sunt skip-uite (acoperite pozitiv în
-- affiliate_commission_v2_assertions.sql AF1). Negativele rămân pe 'cus_X'
-- (gate-ul returnează ÎNAINTE de atribuire, deci nu consumă „prima factură").
do $$
declare v jsonb; v_plan text;
begin
  foreach v_plan in array array['free','business','plan3'] loop
    v := public.process_affiliate_invoice_paid('evt_gate_'||v_plan,'cus_X','s','i_'||v_plan,
           'subscription_cycle',2900,'RON','2026-07-01',now(),v_plan);
    if v->>'skipped' is distinct from 'not_paid_plan' then
      raise exception 'T4 FAIL: plan % negate-uit (%)', v_plan, v; end if;
  end loop;
  v := public.process_affiliate_invoice_paid('evt_gate_null','cus_X','s','i_null',
         'subscription_cycle',2900,'RON','2026-07-01',now(),null);
  if v->>'skipped' is distinct from 'not_paid_plan' then
    raise exception 'T4 FAIL: null negate-uit (%)', v; end if;
  raise notice 'T4 OK: {free,business,plan3,null} → not_paid_plan';
end $$;

-- Afiliat + atribuiri DEDICATE pentru cazurile POZITIVE (pro/enterprise → comision).
-- Afiliat separat (NU parent-ul 0a..0001) ca să NU polueze balanța verificată de
-- P0f / payable-ul verificat de P0d. profil 005 = afiliatul, 006/00a = referiți.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000005','0005@aff.test'),
  ('00000000-0000-0000-0000-000000000006','0006@aff.test'),
  ('00000000-0000-0000-0000-00000000000a','000a@aff.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-000000000005','0005@aff.test'),
  ('00000000-0000-0000-0000-000000000006','0006@aff.test'),
  ('00000000-0000-0000-0000-00000000000a','000a@aff.test')
  on conflict (id) do nothing;
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005','t4aff1');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, stripe_customer_id, status) values
  ('0b000000-0000-0000-0000-000000000005','0a000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000006','cus_PRO','pending'),
  ('0b000000-0000-0000-0000-000000000006','0a000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-00000000000a','cus_ENT','pending');
do $$
declare v jsonb;
begin
  -- 'pro' → NU skip; prima factură consemnată, a doua scrie setup 30% din 2900 = 870.
  v := public.process_affiliate_invoice_paid('evt_pro','cus_PRO','s','in_pro',
         'subscription_cycle',2900,'RON','2026-07-01',now(),'pro');
  if v ? 'skipped' then raise exception 'T4 FAIL: pro a fost skip-uit (%)', v; end if;
  v := public.process_affiliate_invoice_paid('evt_pro2','cus_PRO','s','in_pro2',
         'subscription_cycle',2900,'RON','2026-08-01',now(),'pro');
  if (v->>'setup_commission_cents')::bigint is distinct from 870::bigint then
    raise exception 'T4 FAIL: pro setup % (așteptat 870)', v->>'setup_commission_cents'; end if;
  -- 'enterprise' → NU skip; produce comision.
  v := public.process_affiliate_invoice_paid('evt_ent','cus_ENT','s','in_ent',
         'subscription_cycle',2900,'RON','2026-07-01',now(),'enterprise');
  if v ? 'skipped' then raise exception 'T4 FAIL: enterprise a fost skip-uit (%)', v; end if;
  v := public.process_affiliate_invoice_paid('evt_ent2','cus_ENT','s','in_ent2',
         'subscription_cycle',2900,'RON','2026-08-01',now(),'enterprise');
  if (v->>'setup_commission_cents')::bigint is distinct from 870::bigint then
    raise exception 'T4 FAIL: enterprise setup % (așteptat 870)', v->>'setup_commission_cents'; end if;
  raise notice 'T4 OK: pro+enterprise → comision (NU skip)';
end $$;

-- ── P0b: setup pe trial (primul event e subscription_cycle, NU create) ────────
do $$
declare v jsonb;
begin
  -- Scenariu trial: prima factură cu bani vine ca subscription_cycle → baza SETUP-ului.
  v := public.process_affiliate_invoice_paid('evt_trial1','cus_X','sub_X','in_t1','subscription_cycle',2900,'RON','2026-07-01',now(),'pro');
  if v->>'deferred' is distinct from 'setup_awaits_second_invoice' then
    raise exception 'P0b FAIL: prima factură (cycle) trebuie consemnată ca bază de setup (%)', v; end if;
  -- mig 293: setup-ul se scrie la A DOUA factură, cu factura PRIMEI (in_t1).
  v := public.process_affiliate_invoice_paid('evt_trial2','cus_X','sub_X','in_t2','subscription_cycle',2900,'RON','2026-08-01',now(),'pro');
  if (select amount_cents from public.affiliate_ledger where leg='setup' and stripe_invoice_id='in_t1')
       is distinct from 870::bigint then
    raise exception 'P0b FAIL: setup 30%% = 870 pe in_t1, e %',
      (select amount_cents from public.affiliate_ledger where leg='setup' and stripe_invoice_id='in_t1'); end if;
  if (v->>'commission_cents')::bigint is distinct from 290::bigint then
    raise exception 'P0b FAIL: recurring pe in_t2 = 290, e %', v->>'commission_cents'; end if;
  raise notice 'P0b OK: setup pe trial (cycle → bază setup 870, scris la a doua factură)';
end $$;

-- ── P0c: refund full pe prima factură → setup stornat total ──────────────────
do $$
declare v_bal bigint;
begin
  -- Refund integral al facturii in_t1 (charge 2900, refund 2900).
  perform public.process_affiliate_refund('evt_ref1','in_t1',2900,'re_1',2900,now());
  -- child: setup 870 − 870 + recurring 290 (in_t2, nerefundat) = 290
  select balance_cents into v_bal from public.v_affiliate_balance
   where affiliate_id='0a000000-0000-0000-0000-000000000002' and currency='RON';
  if v_bal is distinct from 290::bigint then raise exception 'P0c FAIL: balanță child % (așteptat 290)', v_bal; end if;
  raise notice 'P0c OK: refund full in_t1 → setup stornat, rămâne recurring-ul in_t2';
end $$;

-- ── P0f: cascade reverse (parent a fost stornat la P0c) ──────────────────────
do $$
declare v_pbal bigint;
begin
  select balance_cents into v_pbal from public.v_affiliate_balance
   where affiliate_id='0a000000-0000-0000-0000-000000000001' and currency='RON';
  -- parent: cascade setup 17 − clawback 17 + cascade recurring 5 = 5
  if v_pbal is distinct from 5::bigint then raise exception 'P0f FAIL: cascade parent nestornat (balanță %)', v_pbal; end if;
  raise notice 'P0f OK: cascade reverse (parent 5 = doar cascada recurring)';
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
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000004','0004@aff.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values ('00000000-0000-0000-0000-000000000004','0004@aff.test')
  on conflict (id) do nothing;
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

-- ── T3(a): AL DOILEA refund parțial pe aceeași factură → 50%+50% = 100%, fără over-clawback ──
-- Findings T3: refundurile parțiale CUMULATE pe aceeași factură erau netestate.
-- P0d a stornat deja 50% din in_y (re_y, 1450/2900 → clawback -435).
-- Acum un AL DOILEA refund parțial (alt refund_id re_y2, încă 1450) → clawback -435.
-- Cumulat: 870 stornat din 870 comision → NET payable 0, FĂRĂ over-clawback
-- (fiecare storno e mărginit la fracția lui; suma = exact 100%, nu peste).
do $$
declare v_payable bigint; v_claw_sum bigint;
begin
  perform public.process_affiliate_refund('evt_refy2','in_y',2900,'re_y2',1450,now());
  -- Suma clawback-urilor pe in_y nu depășește comisionul original (-870).
  select coalesce(sum(amount_cents),0) into v_claw_sum from public.affiliate_ledger
   where stripe_invoice_id='in_y' and leg='clawback';
  if v_claw_sum <> -870 then
    raise exception 'T3a FAIL: clawback cumulat % (așteptat -870, fără over-clawback)', v_claw_sum; end if;
  -- Net payable pe afiliat scade la 0 (comisionul in_y e complet stornat).
  select coalesce(sum(amount_cents),0) into v_payable from public.v_affiliate_payable
   where affiliate_id='0a000000-0000-0000-0000-000000000001';
  if v_payable <> 0 then raise exception 'T3a FAIL: net payable % (așteptat 0)', v_payable; end if;
  raise notice 'T3a OK: 50%%+50%% = 100%% storno → net payable 0, fără over-clawback';
end $$;

-- ── T3(b): 'dispute lost' → ACELAȘI process_affiliate_refund (charge integral) ──
-- Documentare path: la dispute lost (chargeback) webhook-ul apelează aceeași RPC
-- cu refund_id = 'dispute_<id>' și refund = charge-ul integral. Comisionul aferent
-- e stornat complet (clawback = -comision), exact ca un refund full.
-- Atribuire+comision dedicate (in_disp) ca să nu interfereze cu in_y.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000007','0007@aff.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values ('00000000-0000-0000-0000-000000000007','0007@aff.test')
  on conflict (id) do nothing;
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, stripe_customer_id, status) values
  ('0b000000-0000-0000-0000-000000000007','0a000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000007','cus_DISP','active');
insert into public.affiliate_ledger
  (affiliate_id, attribution_id, leg, base_cents, commission_bps, amount_cents, hold_until, stripe_invoice_id, stripe_event_id)
  values ('0a000000-0000-0000-0000-000000000001','0b000000-0000-0000-0000-000000000007',
          'setup',2900,3000,870, now() - interval '1 day','in_disp','evt_disp');
do $$
declare v_net bigint;
begin
  -- Dispute lost: refund_id = 'dispute_d1', charge integral (2900/2900).
  perform public.process_affiliate_refund('evt_dispute_d1','in_disp',2900,'dispute_d1',2900,now());
  -- Comisionul in_disp e complet stornat → NET 0 (nu mai apare în payable).
  select coalesce((select sum(amount_cents) from public.v_affiliate_payable p
                    where p.attribution_id='0b000000-0000-0000-0000-000000000007'),0) into v_net;
  if v_net <> 0 then raise exception 'T3b FAIL: dispute lost net % (așteptat 0)', v_net; end if;
  if not exists (select 1 from public.affiliate_ledger
                  where stripe_refund_id='dispute_d1' and leg='clawback' and amount_cents=-870) then
    raise exception 'T3b FAIL: dispute lost nu a generat clawback -870'; end if;
  raise notice 'T3b OK: dispute lost → același RPC, clawback integral -870';
end $$;

do $$ begin raise notice '════ affiliate P0 assertions: ALL PASS ════'; end $$;

rollback;

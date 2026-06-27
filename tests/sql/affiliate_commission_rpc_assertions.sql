-- tests/sql/affiliate_commission_rpc_assertions.sql
-- =============================================================================
-- Asserții pentru RPC-ul de comisioane (mig 097B: process_affiliate_invoice_paid).
-- Rulează DUPĂ aplicarea migrațiilor. Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/affiliate_commission_rpc_assertions.sql
--
-- Acoperă logica financiară cu cel mai mare risc:
--   RC1  setup: 30% comision + 2% cascade la parent
--   RC2  idempotency: reprocesarea aceluiași event nu redublează
--   RC3  recurring: 10% comision + 2% cascade
--   RC4  no-attribution: skip curat
--   RC5  cap recurring: după N cicluri, skip
--   RC6  sold derivat corect (child + parent)
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- Seed: parent F1, child F2 (sub-afiliat), profil-referit P3 atribuit lui F2.
insert into public.profiles (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003');
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','parent1');
insert into public.affiliates (id, profile_id, referral_code, parent_affiliate_id, recurring_cap_months) values
  ('0a000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','child01',
   '0a000000-0000-0000-0000-000000000001', 2);  -- cap mic (2) pentru a testa RC5
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, stripe_customer_id, status) values
  ('0b000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000003','cus_X','pending');

-- ── RC1: setup ───────────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.process_affiliate_invoice_paid('evt_setup','cus_X','sub_X','in_1','subscription_create',2900,'RON',null,now(),'pro');
  if (v->>'commission_cents')::bigint <> 870 then
    raise exception 'RC1 FAIL: setup commission % (așteptat 870)', v->>'commission_cents';
  end if;
  -- cascade parent = 2% din 870 = 17 (floor)
  if (select amount_cents from public.affiliate_ledger
        where leg='cascade' and stripe_event_id='evt_setup') <> 17 then
    raise exception 'RC1 FAIL: cascade parent ≠ 17';
  end if;
  raise notice 'RC1 OK: setup 870 + cascade 17';
end $$;

-- ── RC2: idempotency ─────────────────────────────────────────────────────────
do $$
declare v_before int; v_after int;
begin
  select count(*) into v_before from public.affiliate_ledger where stripe_event_id='evt_setup';
  perform public.process_affiliate_invoice_paid('evt_setup','cus_X','sub_X','in_1','subscription_create',2900,'RON',null,now(),'pro');
  select count(*) into v_after from public.affiliate_ledger where stripe_event_id='evt_setup';
  if v_before <> v_after then
    raise exception 'RC2 FAIL: reprocesarea a creat rânduri noi (% → %)', v_before, v_after;
  end if;
  raise notice 'RC2 OK: idempotency (% rânduri)', v_after;
end $$;

-- ── RC3: recurring ───────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.process_affiliate_invoice_paid('evt_rec1','cus_X','sub_X','in_2','subscription_cycle',2900,'RON','2026-07-01',now(),'pro');
  if (v->>'commission_cents')::bigint <> 290 then
    raise exception 'RC3 FAIL: recurring % (așteptat 290)', v->>'commission_cents';
  end if;
  if (select amount_cents from public.affiliate_ledger
        where leg='cascade' and stripe_event_id='evt_rec1') <> 5 then
    raise exception 'RC3 FAIL: cascade recurring ≠ 5';
  end if;
  raise notice 'RC3 OK: recurring 290 + cascade 5';
end $$;

-- ── RC4: no-attribution ──────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.process_affiliate_invoice_paid('evt_x','cus_UNKNOWN','sub_Z','in_9','subscription_create',2900,'RON',null,now(),'pro');
  if v->>'skipped' is distinct from 'no_attribution' then
    raise exception 'RC4 FAIL: customer necunoscut nu a fost skip-uit (%))', v;
  end if;
  raise notice 'RC4 OK: no-attribution skip';
end $$;

-- ── RC5: cap recurring (cap=2; avem deja 1 din RC3) ──────────────────────────
do $$
declare v jsonb;
begin
  -- al doilea ciclu (august) — atinge cap=2, trebuie acceptat
  v := public.process_affiliate_invoice_paid('evt_rec2','cus_X','sub_X','in_3','subscription_cycle',2900,'RON','2026-08-01',now(),'pro');
  if v->>'leg' is distinct from 'recurring' then
    raise exception 'RC5 FAIL: al doilea recurring respins prematur (%)', v;
  end if;
  -- al treilea ciclu (septembrie) — peste cap=2, trebuie skip
  v := public.process_affiliate_invoice_paid('evt_rec3','cus_X','sub_X','in_4','subscription_cycle',2900,'RON','2026-09-01',now(),'pro');
  if v->>'skipped' is distinct from 'recurring_cap_reached' then
    raise exception 'RC5 FAIL: al treilea recurring nu a fost plafonat (%)', v;
  end if;
  raise notice 'RC5 OK: cap recurring la 2 cicluri';
end $$;

-- ── RC6: sold derivat ────────────────────────────────────────────────────────
do $$
declare v_child bigint; v_parent bigint;
begin
  select balance_cents into v_child from public.v_affiliate_balance
   where affiliate_id='0a000000-0000-0000-0000-000000000002' and currency='RON';
  select balance_cents into v_parent from public.v_affiliate_balance
   where affiliate_id='0a000000-0000-0000-0000-000000000001' and currency='RON';
  -- child: setup 870 + 2× recurring 290 (iul+aug) = 1450
  if v_child is distinct from 1450 then
    raise exception 'RC6 FAIL: sold child % (așteptat 1450)', v_child;
  end if;
  -- parent: cascade 17 (setup) + 5 (iul) + 5 (aug) = 27
  if v_parent is distinct from 27 then
    raise exception 'RC6 FAIL: sold parent % (așteptat 27)', v_parent;
  end if;
  raise notice 'RC6 OK: child=% parent=%', v_child, v_parent;
end $$;

do $$ begin raise notice '════ affiliate commission RPC assertions: ALL PASS ════'; end $$;

rollback;

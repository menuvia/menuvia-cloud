-- tests/sql/affiliate_foundation_assertions.sql
-- =============================================================================
-- Asserții comportamentale pentru mig 097 (Program afiliere — fundația contabilă).
-- Rulează DUPĂ ce migrațiile au fost aplicate pe Postgres-ul de test.
--
-- Self-contained: rulează într-o tranzacție și face ROLLBACK la final, deci NU
-- lasă date în urmă. Idempotent — poate fi rulat de oricâte ori.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/affiliate_foundation_assertions.sql
--
-- Acoperă invariantele critice care nu pot fi exprimate ca simple CHECK:
--   AF1  self-referral respins (trigger)
--   AF2  atribuire validă acceptată
--   AF3  WORM: UPDATE pe ledger respins
--   AF4  WORM: DELETE pe ledger respins
--   AF5  idempotency: (stripe_event_id, leg) unic
--   AF6  cap recurring: (attribution, period_month) unic pe leg=recurring
--   AF7  anti-cycle depth-1: lanț de 2 niveluri respins la COMMIT
--   AF8  sold derivat corect din ledger semnat
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed izolat ──────────────────────────────────────────────────────────────
-- auth.users + profiles (în CI trigger-ul handle_new_user creează profiles din
-- auth.users; explicit insert e on-conflict no-op. Local: explicit insert creează).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001','p1@aff.test'),
  ('00000000-0000-0000-0000-000000000002','p2@aff.test'),
  ('00000000-0000-0000-0000-000000000003','p3@aff.test'),
  ('00000000-0000-0000-0000-000000000004','p4@aff.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-000000000001','p1@aff.test'),
  ('00000000-0000-0000-0000-000000000002','p2@aff.test'),
  ('00000000-0000-0000-0000-000000000003','p3@aff.test'),
  ('00000000-0000-0000-0000-000000000004','p4@aff.test')
  on conflict (id) do nothing;

insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','testaf1');

-- ── AF1: self-referral respins ───────────────────────────────────────────────
do $$
declare v_raised boolean := false;
begin
  begin
    insert into public.affiliate_attributions (affiliate_id, referred_profile_id)
      values ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'AF1 FAIL: self-referral nu a fost respins'; end if;
  raise notice 'AF1 OK: self-referral respins';
end $$;

-- ── AF2: atribuire validă acceptată ──────────────────────────────────────────
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id)
  values ('0b000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
do $$ begin
  if not exists (select 1 from public.affiliate_attributions where id='0b000000-0000-0000-0000-000000000001')
    then raise exception 'AF2 FAIL: atribuirea validă nu s-a inserat'; end if;
  raise notice 'AF2 OK: atribuire validă acceptată';
end $$;

-- Comision setup pentru testele WORM/idempotency.
insert into public.affiliate_ledger
  (id, affiliate_id, attribution_id, leg, base_cents, commission_bps, amount_cents, stripe_event_id)
  values ('0c000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001',
          '0b000000-0000-0000-0000-000000000001','setup',2900,3000,870,'evt_af_setup');

-- ── AF3: WORM UPDATE respins ─────────────────────────────────────────────────
do $$
declare v_raised boolean := false;
begin
  begin
    update public.affiliate_ledger set amount_cents = 99999
      where id='0c000000-0000-0000-0000-000000000001';
  -- T5: trigger-ul WORM (mig 097) ridică errcode='restrict_violation' (SQLSTATE 2F004).
  -- Prindem DOAR acel cod, nu `when others` (care ar masca alte erori reale).
  exception when restrict_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'AF3 FAIL: UPDATE pe ledger nu a fost respins'; end if;
  raise notice 'AF3 OK: WORM UPDATE respins';
end $$;

-- ── AF4: WORM DELETE respins ─────────────────────────────────────────────────
do $$
declare v_raised boolean := false;
begin
  begin
    delete from public.affiliate_ledger where id='0c000000-0000-0000-0000-000000000001';
  -- T5: același trigger WORM → errcode='restrict_violation'. Prindem DOAR acel cod.
  exception when restrict_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'AF4 FAIL: DELETE pe ledger nu a fost respins'; end if;
  raise notice 'AF4 OK: WORM DELETE respins';
end $$;

-- ── AF5: idempotency (event, leg) ────────────────────────────────────────────
do $$
declare v_raised boolean := false;
begin
  begin
    insert into public.affiliate_ledger (affiliate_id, leg, amount_cents, stripe_event_id)
      values ('0a000000-0000-0000-0000-000000000001','setup',870,'evt_af_setup');
  exception when unique_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'AF5 FAIL: dublarea (event,leg) nu a fost respinsă'; end if;
  raise notice 'AF5 OK: idempotency (event,leg)';
end $$;

-- ── AF6: cap recurring per (attribution, period) ─────────────────────────────
insert into public.affiliate_ledger (affiliate_id, attribution_id, leg, period_month, amount_cents, stripe_event_id)
  values ('0a000000-0000-0000-0000-000000000001','0b000000-0000-0000-0000-000000000001','recurring','2026-07-01',290,'evt_af_rec_a');
do $$
declare v_raised boolean := false;
begin
  begin
    insert into public.affiliate_ledger (affiliate_id, attribution_id, leg, period_month, amount_cents, stripe_event_id)
      values ('0a000000-0000-0000-0000-000000000001','0b000000-0000-0000-0000-000000000001','recurring','2026-07-01',290,'evt_af_rec_b');
  exception when unique_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'AF6 FAIL: a doua factură recurring pe aceeași lună nu a fost respinsă'; end if;
  raise notice 'AF6 OK: cap recurring per (attribution, period)';
end $$;

-- ── AF7: anti-cycle depth-1 (lanț 2 niveluri) respins la COMMIT ──────────────
-- B = sub-afiliat al lui f1 (depth 1, OK).
insert into public.affiliates (id, profile_id, referral_code, parent_affiliate_id)
  values ('0a000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','testaf2','0a000000-0000-0000-0000-000000000001');
do $$
declare v_raised boolean := false;
begin
  begin
    -- C → B → f1 ar fi depth-2: trebuie respins (constraint trigger deferred).
    insert into public.affiliates (id, profile_id, referral_code, parent_affiliate_id)
      values ('0a000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','testaf3','0a000000-0000-0000-0000-000000000002');
    -- Forțăm verificarea deferred fără a închide tranzacția exterioară.
    set constraints all immediate;
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'AF7 FAIL: lanțul depth-2 nu a fost respins'; end if;
  raise notice 'AF7 OK: anti-cycle depth-1';
end $$;
-- Re-relaxăm pentru restul tranzacției.
set constraints all deferred;

-- ── AF8: sold derivat ────────────────────────────────────────────────────────
do $$
declare v_balance bigint;
begin
  select balance_cents into v_balance
    from public.v_affiliate_balance
   where affiliate_id = '0a000000-0000-0000-0000-000000000001' and currency = 'RON';
  -- setup 870 + recurring 290 = 1160
  if v_balance is distinct from 1160 then
    raise exception 'AF8 FAIL: sold derivat % (așteptat 1160)', v_balance;
  end if;
  raise notice 'AF8 OK: sold derivat = %', v_balance;
end $$;

-- ── AF9: un singur setup per atribuire (mig 105, anti dublă-plată la race) ────
do $$
declare v_raised boolean := false;
begin
  -- A doua inserție de setup pe aceeași atribuire (event diferit) trebuie respinsă.
  begin
    insert into public.affiliate_ledger
      (affiliate_id, attribution_id, leg, amount_cents, stripe_event_id)
    values ('0a000000-0000-0000-0000-000000000001','0b000000-0000-0000-0000-000000000001',
            'setup', 870, 'evt_dup_setup');
    raise notice 'unexpected insert';
  exception when unique_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'AF9 FAIL: al doilea setup pe aceeași atribuire acceptat (dublă plată)'; end if;
  raise notice 'AF9 OK: setup unic per atribuire';
end $$;

do $$ begin raise notice '════ affiliate foundation assertions: ALL PASS ════'; end $$;

rollback;

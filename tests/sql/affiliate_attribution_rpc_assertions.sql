-- tests/sql/affiliate_attribution_rpc_assertions.sql
-- =============================================================================
-- Asserții pentru RPC-urile de atribuire (mig 097C: capture_affiliate_attribution,
-- preview_referral). Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/affiliate_attribution_rpc_assertions.sql
--
--   AT1  preview valid / invalid
--   AT2  capture valid (cu touch) → atribuire pending
--   AT3  self-referral → skip
--   AT4  cod necunoscut → skip
--   AT5  first-wins (already_attributed)
--   AT6  flux complet: capture → invoice.paid → comision
--   AT7  incrementality fail-closed: fără touch → skip no_touch_organic
--   AT8  incrementality: profil mai vechi decât touch → organic_preexisting
--   AT9  mig 108 hardening: visitor_id prea scurt → bad_visitor_id; ≥8 → ok
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
  ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','ionpop');

-- Touch server-recorded pentru visitor 'visitor_x' (precondiție pentru capture).
-- mig 108: visitor_id trebuie ≥ 8 caractere, altfel touch-ul e respins.
select public.record_affiliate_touch('ionpop','visitor_x');

-- ── AT1: preview ─────────────────────────────────────────────────────────────
do $$
begin
  if (public.preview_referral('IonPop')->>'valid')::boolean is not true then
    raise exception 'AT1 FAIL: preview cod valid'; end if;
  if (public.preview_referral('nope')->>'valid')::boolean is not false then
    raise exception 'AT1 FAIL: preview cod invalid'; end if;
  raise notice 'AT1 OK: preview valid/invalid';
end $$;

-- ── AT2: capture valid ───────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000002','cus_A','visitor_x');
  if v->>'attribution_id' is null then raise exception 'AT2 FAIL: capture valid (%)', v; end if;
  if (select status from public.affiliate_attributions
        where referred_profile_id='00000000-0000-0000-0000-000000000002')::text <> 'pending' then
    raise exception 'AT2 FAIL: atribuirea nu e pending'; end if;
  raise notice 'AT2 OK: capture valid';
end $$;

-- ── AT3: self-referral ───────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000001','cus_B','visitor_x');
  if v->>'skipped' is distinct from 'self_referral' then raise exception 'AT3 FAIL (%)', v; end if;
  raise notice 'AT3 OK: self-referral skip';
end $$;

-- ── AT4: cod necunoscut ──────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.capture_affiliate_attribution('xxxxxx','00000000-0000-0000-0000-000000000003','cus_C','visitor_x');
  if v->>'skipped' is distinct from 'unknown_or_inactive_code' then raise exception 'AT4 FAIL (%)', v; end if;
  raise notice 'AT4 OK: cod necunoscut skip';
end $$;

-- ── AT5: first-wins ──────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000002','cus_A2','visitor_x');
  if v->>'skipped' is distinct from 'already_attributed' then raise exception 'AT5 FAIL (%)', v; end if;
  raise notice 'AT5 OK: first-wins';
end $$;

-- ── AT7: incrementality fail-closed — fără touch → skip ──────────────────────
do $$
declare v jsonb;
begin
  -- visitor 'visitor_notouch' n-are touch → trebuie skip no_touch_organic.
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000003','cus_NT','visitor_notouch');
  if v->>'skipped' is distinct from 'no_touch_organic' then raise exception 'AT7 FAIL: fără touch neגate-uit (%)', v; end if;
  raise notice 'AT7 OK: fără touch → no_touch_organic';
end $$;

-- ── AT8: incrementality — profil mai vechi decât touch → organic ─────────────
do $$
declare v jsonb;
begin
  -- Profil creat acum 1 oră; touch acum → profil < touch − 5min → organic.
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000009','0009@aff.test')
    on conflict (id) do nothing;
  insert into public.profiles (id, email, created_at) values
    ('00000000-0000-0000-0000-000000000009','0009@aff.test', now() - interval '1 hour')
    on conflict (id) do nothing;
  -- În CI trigger-ul creează profilul cu now(); forțăm created_at vechi.
  update public.profiles set created_at = now() - interval '1 hour'
   where id = '00000000-0000-0000-0000-000000000009';
  perform public.record_affiliate_touch('ionpop','visitor_old');
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000009','cus_OLD','visitor_old');
  if v->>'skipped' is distinct from 'organic_preexisting' then raise exception 'AT8 FAIL: profil vechi neגate-uit (%)', v; end if;
  raise notice 'AT8 OK: profil vechi → organic_preexisting';
end $$;

-- ── AT6: flux complet capture → invoice → comision ───────────────────────────
do $$
declare v jsonb;
begin
  v := public.process_affiliate_invoice_paid('evt_at6','cus_A','sub_A','in_A','subscription_create',2900,'RON',null,now(),'pro');
  if (v->>'commission_cents')::bigint <> 870 then raise exception 'AT6 FAIL: comision % (870)', v->>'commission_cents'; end if;
  raise notice 'AT6 OK: flux complet → comision 870';
end $$;

-- ── AT9: mig 108 — bound pe visitor_id în record_affiliate_touch ─────────────
do $$
declare v jsonb;
begin
  -- visitor_id prea scurt ('abc' = 3 caractere) → respins fără insert.
  v := public.record_affiliate_touch('ionpop','abc');
  if v->>'reason' is distinct from 'bad_visitor_id' then
    raise exception 'AT9 FAIL: visitor_id scurt neגate-uit (%)', v; end if;

  -- visitor_id valid (≥ 8 caractere) → ok.
  v := public.record_affiliate_touch('ionpop','visitor_ok');
  if (v->>'ok')::boolean is not true then
    raise exception 'AT9 FAIL: visitor_id valid respins (%)', v; end if;
  raise notice 'AT9 OK: bound visitor_id (scurt → bad_visitor_id, valid → ok)';
end $$;

do $$ begin raise notice '════ affiliate attribution RPC assertions: ALL PASS ════'; end $$;

rollback;

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
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into public.profiles (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003');
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','ionpop');

-- Touch server-recorded pentru visitor 'vis_x' (precondiție pentru capture).
select public.record_affiliate_touch('ionpop','vis_x');

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
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000002','cus_A','vis_x');
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
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000001','cus_B','vis_x');
  if v->>'skipped' is distinct from 'self_referral' then raise exception 'AT3 FAIL (%)', v; end if;
  raise notice 'AT3 OK: self-referral skip';
end $$;

-- ── AT4: cod necunoscut ──────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.capture_affiliate_attribution('xxxxxx','00000000-0000-0000-0000-000000000003','cus_C','vis_x');
  if v->>'skipped' is distinct from 'unknown_or_inactive_code' then raise exception 'AT4 FAIL (%)', v; end if;
  raise notice 'AT4 OK: cod necunoscut skip';
end $$;

-- ── AT5: first-wins ──────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000002','cus_A2','vis_x');
  if v->>'skipped' is distinct from 'already_attributed' then raise exception 'AT5 FAIL (%)', v; end if;
  raise notice 'AT5 OK: first-wins';
end $$;

-- ── AT7: incrementality fail-closed — fără touch → skip ──────────────────────
do $$
declare v jsonb;
begin
  -- visitor 'vis_notouch' n-are touch → trebuie skip no_touch_organic.
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000003','cus_NT','vis_notouch');
  if v->>'skipped' is distinct from 'no_touch_organic' then raise exception 'AT7 FAIL: fără touch neגate-uit (%)', v; end if;
  raise notice 'AT7 OK: fără touch → no_touch_organic';
end $$;

-- ── AT8: incrementality — profil mai vechi decât touch → organic ─────────────
do $$
declare v jsonb;
begin
  -- Profil creat acum 1 oră; touch acum → profil < touch − 5min → organic.
  insert into public.profiles (id, created_at) values
    ('00000000-0000-0000-0000-000000000009', now() - interval '1 hour');
  perform public.record_affiliate_touch('ionpop','vis_old');
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000009','cus_OLD','vis_old');
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

do $$ begin raise notice '════ affiliate attribution RPC assertions: ALL PASS ════'; end $$;

rollback;

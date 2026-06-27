-- tests/sql/affiliate_attribution_rpc_assertions.sql
-- =============================================================================
-- Asserții pentru RPC-urile de atribuire (mig 097C: capture_affiliate_attribution,
-- preview_referral). Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/affiliate_attribution_rpc_assertions.sql
--
--   AT1  preview valid / invalid
--   AT2  capture valid → atribuire pending
--   AT3  self-referral → skip
--   AT4  cod necunoscut → skip
--   AT5  first-wins (already_attributed)
--   AT6  flux complet: capture → invoice.paid → comision
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into public.profiles (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003');
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','ionpop');

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
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000002','cus_A');
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
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000001','cus_B');
  if v->>'skipped' is distinct from 'self_referral' then raise exception 'AT3 FAIL (%)', v; end if;
  raise notice 'AT3 OK: self-referral skip';
end $$;

-- ── AT4: cod necunoscut ──────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.capture_affiliate_attribution('xxxxxx','00000000-0000-0000-0000-000000000003','cus_C');
  if v->>'skipped' is distinct from 'unknown_or_inactive_code' then raise exception 'AT4 FAIL (%)', v; end if;
  raise notice 'AT4 OK: cod necunoscut skip';
end $$;

-- ── AT5: first-wins ──────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.capture_affiliate_attribution('ionpop','00000000-0000-0000-0000-000000000002','cus_A2');
  if v->>'skipped' is distinct from 'already_attributed' then raise exception 'AT5 FAIL (%)', v; end if;
  raise notice 'AT5 OK: first-wins';
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

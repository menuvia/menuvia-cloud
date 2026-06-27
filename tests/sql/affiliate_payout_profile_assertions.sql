-- tests/sql/affiliate_payout_profile_assertions.sql
-- =============================================================================
-- Asserții pentru mig 101: upsert_payout_profile (datele fiscale/bancare ale
-- afiliatului, scrise prin RPC SECURITY DEFINER scopat la auth.uid()).
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/affiliate_payout_profile_assertions.sql
--
--   PP1  upsert valid → ok, rând creat
--   PP2  al doilea upsert → UPDATE (nu duplică), valorile noi persistă
--   PP3  IBAN prea scurt → invalid_iban
--   PP4  formă juridică invalidă → invalid_legal_form
--   PP5  caller fără afiliere → not_an_affiliate
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1','00p1@aff.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-0000000000d1','00p1@aff.test')
  on conflict (id) do nothing;
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d1','payaff');

-- Context: afiliatul autentificat = profilul p1.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1', true);

-- ── PP1: upsert valid ────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.upsert_payout_profile('pfa','RO12345678','RO49AAAA1B31007593840000','Popescu Ion PFA');
  if (v->>'ok')::boolean is not true then raise exception 'PP1 FAIL: upsert valid (%)', v; end if;
  if (select legal_form from public.affiliate_payout_profile
        where affiliate_id='0a000000-0000-0000-0000-0000000000d1') <> 'pfa' then
    raise exception 'PP1 FAIL: rândul nu s-a creat corect'; end if;
  raise notice 'PP1 OK: upsert valid → rând creat';
end $$;

-- ── PP2: al doilea upsert = UPDATE ───────────────────────────────────────────
do $$
declare v jsonb; v_cnt int;
begin
  v := public.upsert_payout_profile('srl','RO99999999','RO49BBBB1B31007593840000','Test SRL');
  if (v->>'ok')::boolean is not true then raise exception 'PP2 FAIL: al doilea upsert (%)', v; end if;
  select count(*) into v_cnt from public.affiliate_payout_profile
    where affiliate_id='0a000000-0000-0000-0000-0000000000d1';
  if v_cnt <> 1 then raise exception 'PP2 FAIL: a duplicat (% rânduri)', v_cnt; end if;
  if (select iban from public.affiliate_payout_profile
        where affiliate_id='0a000000-0000-0000-0000-0000000000d1') <> 'RO49BBBB1B31007593840000' then
    raise exception 'PP2 FAIL: IBAN-ul nu s-a actualizat'; end if;
  raise notice 'PP2 OK: re-upsert = UPDATE (1 rând, valori noi)';
end $$;

-- ── PP3: IBAN prea scurt ─────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.upsert_payout_profile('pfa','RO12345678','RO49',' X');
  if v->>'reason' is distinct from 'invalid_iban' then raise exception 'PP3 FAIL: IBAN scurt neגate-uit (%)', v; end if;
  raise notice 'PP3 OK: IBAN prea scurt → invalid_iban';
end $$;

-- ── PP4: formă juridică invalidă ─────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.upsert_payout_profile('sa','RO12345678','RO49AAAA1B31007593840000','X');
  if v->>'reason' is distinct from 'invalid_legal_form' then raise exception 'PP4 FAIL: formă invalidă neגate-uită (%)', v; end if;
  raise notice 'PP4 OK: formă juridică invalidă → invalid_legal_form';
end $$;

-- ── PP5: caller fără afiliere ────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff', true);
  v := public.upsert_payout_profile('pfa','RO12345678','RO49AAAA1B31007593840000','X');
  if v->>'reason' is distinct from 'not_an_affiliate' then raise exception 'PP5 FAIL: non-afiliat acceptat (%)', v; end if;
  raise notice 'PP5 OK: caller fără afiliere → not_an_affiliate';
end $$;

do $$ begin raise notice '════ affiliate payout profile assertions: ALL PASS ════'; end $$;

rollback;

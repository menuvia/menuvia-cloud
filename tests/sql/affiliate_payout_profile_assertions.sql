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

-- ── PP3: IBAN prea scurt (și NU alterează rândul existent) ───────────────────
do $$
declare v jsonb;
begin
  v := public.upsert_payout_profile('pfa','RO12345678','RO49',' X');
  if v->>'reason' is distinct from 'invalid_iban' then raise exception 'PP3 FAIL: IBAN scurt neגate-uit (%)', v; end if;
  -- efect secundar: rândul (creat de PP2, legal_form='srl') trebuie neschimbat
  if (select iban from public.affiliate_payout_profile
        where affiliate_id='0a000000-0000-0000-0000-0000000000d1') <> 'RO49BBBB1B31007593840000' then
    raise exception 'PP3 FAIL: respins dar a alterat IBAN-ul'; end if;
  raise notice 'PP3 OK: IBAN prea scurt → invalid_iban (rând intact)';
end $$;

-- ── PP4: formă juridică invalidă (și NU alterează rândul existent) ───────────
do $$
declare v jsonb;
begin
  v := public.upsert_payout_profile('sa','RO12345678','RO49AAAA1B31007593840000','X');
  if v->>'reason' is distinct from 'invalid_legal_form' then raise exception 'PP4 FAIL: formă invalidă neגate-uită (%)', v; end if;
  if (select legal_form from public.affiliate_payout_profile
        where affiliate_id='0a000000-0000-0000-0000-0000000000d1') <> 'srl' then
    raise exception 'PP4 FAIL: respins dar a alterat forma juridică'; end if;
  raise notice 'PP4 OK: formă juridică invalidă → invalid_legal_form (rând intact)';
end $$;

-- ── PP7: IBAN/CUI cu spații sunt btrim-uite la persistare ────────────────────
do $$
declare v jsonb;
begin
  v := public.upsert_payout_profile('pfa','  RO12345678  ','  RO49DDDD1B31007593840000  ','  N  ');
  if (v->>'ok')::boolean is not true then raise exception 'PP7 FAIL: btrim-IBAN respins (%)', v; end if;
  if (select iban from public.affiliate_payout_profile
        where affiliate_id='0a000000-0000-0000-0000-0000000000d1') <> 'RO49DDDD1B31007593840000' then
    raise exception 'PP7 FAIL: IBAN-ul nu a fost btrim-uit'; end if;
  if (select cui from public.affiliate_payout_profile
        where affiliate_id='0a000000-0000-0000-0000-0000000000d1') <> 'RO12345678' then
    raise exception 'PP7 FAIL: CUI-ul nu a fost btrim-uit'; end if;
  -- IBAN doar din spații → length(btrim)=0 < 15 → respins
  if public.upsert_payout_profile('pfa','RO1','               ','N')->>'reason' is distinct from 'invalid_iban' then
    raise exception 'PP7 FAIL: IBAN din spații neגate-uit'; end if;
  raise notice 'PP7 OK: btrim IBAN/CUI + IBAN gol respins';
end $$;

-- ── PP6: afiliatul B nu poate scrie/altera profilul afiliatului A ─────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d2','00p2@aff.test') on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-0000000000d2','00p2@aff.test') on conflict (id) do nothing;
insert into public.affiliates (id, profile_id, referral_code) values
  ('0b000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d2','payaf2');
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d2', true);
  v := public.upsert_payout_profile('pfa','ROB','RO49CCCC1B31007593840000','B self');
  if (v->>'ok')::boolean is not true then raise exception 'PP6 FAIL: B nu-și poate scrie profilul (%)', v; end if;
  -- scrierea lui B a mers DOAR pe affiliate_id-ul lui B
  if (select beneficiary_name from public.affiliate_payout_profile
        where affiliate_id='0b000000-0000-0000-0000-0000000000d2') <> 'B self' then
    raise exception 'PP6 FAIL: profilul lui B nescris corect'; end if;
  -- profilul lui A (d1, btrim-uit la 'N' în PP7) NU a fost atins de B
  if (select beneficiary_name from public.affiliate_payout_profile
        where affiliate_id='0a000000-0000-0000-0000-0000000000d1') <> 'N' then
    raise exception 'PP6 FAIL: B a alterat profilul lui A (scriere cross-afiliat)'; end if;
  raise notice 'PP6 OK: scrierea e scopată la propriul afiliat';
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

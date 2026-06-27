-- tests/sql/affiliate_payout_rls_assertions.sql
-- =============================================================================
-- Asserții RLS pentru datele de payout (mig 103): citirea e STRICT own-only.
-- Regresie pentru leak-ul găsit la review: un afiliat-părinte NU trebuie să vadă
-- IBAN/CUI-ul sau plățile sub-afiliaților. Rulează ca rol `authenticated` (RLS se
-- aplică doar non-superuser). Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/affiliate_payout_rls_assertions.sql
--
--   RLS1  afiliatul își vede propriul profil de payout (1)
--   RLS2  părintele NU vede profilul sub-afiliatului (0)  ← leak-ul reparat
--   RLS3  un afiliat fără legătură NU vede nimic străin (0)
--   RLS4  același own-only pe affiliate_payouts
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- Setup ca postgres (RLS bypass) — actori: parent, child (sub), unrelated.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1','a1@rls.test'),
  ('00000000-0000-0000-0000-0000000000b2','b2@rls.test'),
  ('00000000-0000-0000-0000-0000000000c3','c3@rls.test')
  on conflict (id) do nothing;
insert into public.affiliates (id, profile_id, referral_code) values
  ('0a000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','parnt1'),
  ('0a000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000c3','unrel1');
insert into public.affiliates (id, profile_id, referral_code, parent_affiliate_id) values
  ('0a000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b2','child1',
   '0a000000-0000-0000-0000-0000000000a1');
insert into public.affiliate_payout_profile (affiliate_id, legal_form, cui, iban, beneficiary_name) values
  ('0a000000-0000-0000-0000-0000000000a1','pfa','ROPARENT','RO49PARENT00000000000000','Parent'),
  ('0a000000-0000-0000-0000-0000000000b2','pfa','ROCHILD','RO49CHILD000000000000000','Child');
insert into public.affiliate_payouts (affiliate_id, period_month, gross_cents) values
  ('0a000000-0000-0000-0000-0000000000b2','2026-07-01', 5000);

-- Comutăm la rolul aplicației + identitatea părintelui (a1).
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

do $$
declare n int;
begin
  -- RLS1: părintele își vede propriul profil
  select count(*) into n from public.affiliate_payout_profile
   where affiliate_id='0a000000-0000-0000-0000-0000000000a1';
  if n <> 1 then raise exception 'RLS1 FAIL: own profil invizibil (%)', n; end if;
  raise notice 'RLS1 OK: own profil vizibil';

  -- RLS2: părintele NU vede profilul sub-afiliatului (leak-ul reparat)
  select count(*) into n from public.affiliate_payout_profile
   where affiliate_id='0a000000-0000-0000-0000-0000000000b2';
  if n <> 0 then raise exception 'RLS2 FAIL: LEAK — parent vede profilul child (%)', n; end if;
  raise notice 'RLS2 OK: profilul sub-afiliatului ascuns de părinte';

  -- RLS4: același own-only pe affiliate_payouts (plata sub-afiliatului ascunsă)
  select count(*) into n from public.affiliate_payouts
   where affiliate_id='0a000000-0000-0000-0000-0000000000b2';
  if n <> 0 then raise exception 'RLS4 FAIL: LEAK — parent vede plata child (%)', n; end if;
  raise notice 'RLS4 OK: plata sub-afiliatului ascunsă de părinte';
end $$;

-- RLS3: un afiliat fără legătură (c3) nu vede nimic străin.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c3';
do $$
declare n int;
begin
  select count(*) into n from public.affiliate_payout_profile;  -- fără filtru = tot ce-i permite RLS
  if n <> 0 then raise exception 'RLS3 FAIL: afiliat fără legătură vede % profiluri', n; end if;
  raise notice 'RLS3 OK: afiliat fără legătură nu vede profiluri străine';
end $$;

reset role;
do $$ begin raise notice '════ affiliate payout RLS assertions: ALL PASS ════'; end $$;

rollback;

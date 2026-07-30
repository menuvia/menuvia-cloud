-- tests/sql/mfa_platform_assertions.sql
-- =============================================================================
-- Aserții pentru mig 235 (MFA pe conturile de platformă):
--   MF1  Fail-open pe ne-înrolați: admin cu mfa_enforced=false trece de
--        is_platform_admin() și pe sesiune aal1 (founder-ul NU e blocat
--        înainte de enrollment).
--   MF2  Enforcement: cu mfa_enforced=true, aal1 → false; aal2 → true.
--   MF3  Clichetul anti-downgrade: set_my_mfa_enforced(false) e respins pe
--        aal1 (flag-ul rămâne true), acceptat pe aal2; activarea e liberă.
--   MF4  Funelul 186/187 e neatins (ambele escape-uri prezente) + granturi.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1b10000-0000-4000-8000-0000000000d1','mf-admin@mf.test'),
  ('a1b20000-0000-4000-8000-0000000000d2','mf-normal@mf.test');

update public.profiles set is_platform_admin = true
 where id = 'a1b10000-0000-4000-8000-0000000000d1';

-- ── MF1: fail-open pe ne-înrolați (mfa_enforced=false, aal1) ─────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'a1b10000-0000-4000-8000-0000000000d1';

do $$
begin
  if not public.is_platform_admin() then
    raise exception 'MF1 FAIL: admin ne-înrolat blocat pe aal1 (fail-open spart)';
  end if;
  raise notice 'MF1 OK: fără flag, admin-ul trece și pe aal1';
end $$;

reset role;

-- ── MF2: enforcement cu flag pornit ──────────────────────────────────────────
update public.profiles set mfa_enforced = true
 where id = 'a1b10000-0000-4000-8000-0000000000d1';

set local role authenticated;
set local request.jwt.claim.sub = 'a1b10000-0000-4000-8000-0000000000d1';

do $$
begin
  -- aal1 (fără claims GUC) → respins
  if public.is_platform_admin() then
    raise exception 'MF2 FAIL: admin cu MFA obligatoriu a trecut pe aal1';
  end if;

  -- aal2 → trece
  perform set_config('request.jwt.claims',
    '{"sub":"a1b10000-0000-4000-8000-0000000000d1","aal":"aal2"}', true);
  if not public.is_platform_admin() then
    raise exception 'MF2 FAIL: admin cu sesiune aal2 respins';
  end if;

  -- înapoi pe aal1 pentru blocurile următoare
  perform set_config('request.jwt.claims', '', true);
  raise notice 'MF2 OK: enforcement aal2 legat de mfa_enforced';
end $$;

-- ── MF3: clichetul — OFF doar din aal2 ───────────────────────────────────────
do $$
declare v jsonb;
begin
  -- dezactivare din aal1 → respinsă, flag-ul rămâne true
  begin
    perform public.set_my_mfa_enforced(false);
    raise exception 'MF3 FAIL: MFA dezactivat dintr-o sesiune aal1';
  exception when others then
    if sqlerrm not ilike '%aal2%' and sqlerrm not ilike '%MFA%' then raise; end if;
  end;
  if not (select mfa_enforced from public.profiles
           where id = 'a1b10000-0000-4000-8000-0000000000d1') then
    raise exception 'MF3 FAIL: flag-ul a fost stins deși apelul a fost respins';
  end if;

  -- dezactivare din aal2 → acceptată
  perform set_config('request.jwt.claims',
    '{"sub":"a1b10000-0000-4000-8000-0000000000d1","aal":"aal2"}', true);
  v := public.set_my_mfa_enforced(false);
  if (v->>'ok')::boolean is not true then
    raise exception 'MF3 FAIL: dezactivarea din aal2 nu a mers (%)', v;
  end if;

  -- re-activarea e liberă (chiar și de pe aal1)
  perform set_config('request.jwt.claims', '', true);
  v := public.set_my_mfa_enforced(true);
  if (v->>'ok')::boolean is not true then
    raise exception 'MF3 FAIL: activarea de pe aal1 nu a mers (%)', v;
  end if;
  raise notice 'MF3 OK: clichet anti-downgrade funcțional';
end $$;

reset role;

-- ── MF4: funelul neatins + granturi ──────────────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_admin'
     and pg_get_function_identity_arguments(p.oid) = 'p_restaurant_id uuid';
  if v_def not ilike '%is_platform_admin%' or v_def not ilike '%has_partner_access%' then
    raise exception 'MF4 FAIL: funelul is_admin a pierdut un escape (186/187)';
  end if;

  if has_function_privilege('anon', 'public.set_my_mfa_enforced(boolean)', 'execute') then
    raise exception 'MF4 FAIL: set_my_mfa_enforced accesibil anon';
  end if;
  if has_function_privilege('anon', 'public.fn_session_aal()', 'execute') then
    raise exception 'MF4 FAIL: fn_session_aal accesibil anon';
  end if;
  raise notice 'MF4 OK: funel neatins + granturi corecte';
end $$;

select 'MFA PLATFORM ASSERTIONS: MF1–MF4 PASS' as result;

rollback;

-- tests/sql/auto/330_staff_error_hints.sql
-- =============================================================================
-- EH1–EH6 — clichetul PERMANENT al mig 330 (lotul L8d): cele două RPC-uri ale
-- cardurilor de cont (GdprCard / MfaCard) poartă HINT pe fiecare refuz, cu
-- ACELAȘI mesaj și ACELAȘI SQLSTATE ca înainte (P0001), fără să piardă vreun
-- invariant al lui 042 / 235. Clientul (src/lib/accountRefusals.ts) se uită
-- întâi la hint; potrivirea pe text rămâne doar rezerva unei baze fără 330.
-- Rulează din tests/sql/auto/ (scripts/run-sql-auto.sh) pe AMBELE medii;
-- autonom, ROLLBACK la final. Apelurile cu utilizator rulează SUB rolul REAL
-- `authenticated` (ca postgres EXECUTE-ul ar fi ocolit); comparațiile sunt
-- `is distinct from`.
--
--   EH1  request_account_deletion fără utilizator → P0001, mesajul EXACT
--        „Autentificare necesară”, hint `auth_required`.
--        [PICĂ: hint-ul scos (= replay fără 330); errcode schimbat]
--   EH2  abonament activ → P0001, mesajul EXACT de dinainte, hint
--        `active_subscription`, iar `deletion_requested_at` rămâne NULL.
--        [PICĂ: hint-ul scos] (Ordinea refuz → scriere o ține EH6, TEXTUAL:
--        un `raise` după UPDATE ar anula oricum instrucțiunea, deci
--        comportamental ordinea nu se vede.)
--   EH3  CONTROL POZITIV: fără abonament → răspunsul jsonb CAPTURAT sub
--        `authenticated` are `success` = boolean JSON `true` (nu șirul "true",
--        nu lipsă) și marcajul e scris — fără el, EH2 ar trece și pe o funcție
--        care refuză orice. [PICĂ: `'success', false` / `'success', 'true'`
--        (șir) / cheia scoasă din răspuns]
--   EH4  set_my_mfa_enforced(false) din aal1 → P0001, mesajul EXACT, hint
--        `mfa_aal2_required`, flag-ul rămâne TRUE; din aal2 → acceptat;
--        activarea (true) e liberă și din aal1 (clichetul 235, MF3).
--        [PICĂ: hint-ul scos; clichetul aal2 scos (dezactivarea trece)]
--   EH5  set_my_mfa_enforced: parametru NULL → hint `invalid_parameter`; fără
--        utilizator → hint `auth_required`; mesajele EXACTE.
--   EH6  catalogul: o singură semnătură fiecare, DEFINER + `public, pg_temp`,
--        FIECARE `raise exception` cu hint, refuzul (ancorat pe literalul
--        hint-ului) ÎNAINTEA scrierii, anon/PUBLIC fără EXECUTE,
--        authenticated cu EXECUTE.
--        [PICĂ: un `raise` nou fără hint; un grant PUBLIC; pg_temp pierdut;
--        refuzul abonamentului / al aal2 mutat după UPDATE]
-- Mutații dovedite pe replay (au picat toate, apoi restaurate): hint-urile
-- scoase din request_account_deletion (EH1), clichetul aal2 scos (EH4), hint-ul
-- aal2 scos (EH4), grant PUBLIC (EH6), errcode 42501 pe refuzul de sesiune
-- (EH1), `search_path = public` fără pg_temp (EH6), hint greșit pe parametru (EH5).
-- =============================================================================

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('33000000-0000-4000-8000-00000000a001', 'eh330-sub@eh.test'),
  ('33000000-0000-4000-8000-00000000a002', 'eh330-free@eh.test'),
  ('33000000-0000-4000-8000-00000000a003', 'eh330-mfa@eh.test');

update public.profiles
   set plan = 'growth', stripe_subscription_id = 'sub_eh330'
 where id = '33000000-0000-4000-8000-00000000a001';
update public.profiles set mfa_enforced = true
 where id = '33000000-0000-4000-8000-00000000a003';

-- Refuzul unui apel: (sqlstate, mesaj, hint), sau NULL dacă a trecut.
create function pg_temp.eh_refusal(p_sql text, p_uid text, p_claims text)
returns text[]
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
  v_hint  text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  perform set_config('request.jwt.claims', coalesce(p_claims, ''), true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    return array[v_state, v_msg, v_hint];
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return null;
end;
$$;

-- Rezultatul jsonb al unui apel REUȘIT sub rolul REAL `authenticated`. O
-- excepție se propagă (testul pică zgomotos); rolul și claim-urile sunt
-- `set_config(..., true)` — locale tranzacției, ca în `eh_refusal`.
create function pg_temp.eh_result(p_sql text, p_uid text)
returns jsonb
language plpgsql
as $$
declare
  v_res jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v_res;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_res;
end;
$$;

-- ── EH1 ──────────────────────────────────────────────────────────────────────
do $$
declare v text[];
begin
  v := pg_temp.eh_refusal('select public.request_account_deletion()', null, null);
  if v is distinct from array['P0001', 'Autentificare necesară', 'auth_required'] then
    raise exception 'EH1 FAIL: fără utilizator → %', v;
  end if;
  raise notice 'EH1 PASS: fără utilizator → P0001 + auth_required';
end $$;

-- ── EH2 / EH3 ────────────────────────────────────────────────────────────────
do $$
declare
  v     text[];
  v_res jsonb;
begin
  v := pg_temp.eh_refusal('select public.request_account_deletion()', '33000000-0000-4000-8000-00000000a001', null);
  if v is distinct from array['P0001',
       'Aveți un abonament activ. Anulați-l prin Portal Stripe înainte de a șterge contul.',
       'active_subscription'] then
    raise exception 'EH2 FAIL: abonament activ → %', v;
  end if;
  if (select deletion_requested_at from public.profiles
       where id = '33000000-0000-4000-8000-00000000a001') is not null then
    raise exception 'EH2 FAIL: refuzul a scris totuși marcajul de ștergere';
  end if;
  raise notice 'EH2 PASS: abonament activ → P0001 + active_subscription, fără scriere';

  -- Control pozitiv: fără abonament, cererea trece, RĂSPUNSUL spune succes și
  -- contul e marcat. Rezultatul se capturează (nu doar „n-a aruncat”): un corp
  -- care întoarce `success: false` fără să arunce trecea varianta veche.
  v_res := pg_temp.eh_result('select public.request_account_deletion()', '33000000-0000-4000-8000-00000000a002');
  if jsonb_typeof(v_res -> 'success') is distinct from 'boolean'
     or (v_res -> 'success') is distinct from 'true'::jsonb then
    raise exception 'EH3 FAIL: răspunsul nu are success = true (boolean JSON): %', v_res;
  end if;
  if (select deletion_requested_at from public.profiles
       where id = '33000000-0000-4000-8000-00000000a002') is null then
    raise exception 'EH3 FAIL: cererea a trecut, dar marcajul lipsește';
  end if;
  raise notice 'EH3 PASS: control — fără abonament, success = true și marcajul e scris';
end $$;

-- ── EH4 ──────────────────────────────────────────────────────────────────────
do $$
declare
  v   text[];
  uid constant text := '33000000-0000-4000-8000-00000000a003';
  aal2 constant text := '{"sub":"33000000-0000-4000-8000-00000000a003","aal":"aal2"}';
begin
  v := pg_temp.eh_refusal('select public.set_my_mfa_enforced(false)', uid, null);
  if v is distinct from array['P0001', 'Dezactivarea MFA cere o sesiune verificată cu MFA (aal2)', 'mfa_aal2_required'] then
    raise exception 'EH4 FAIL: dezactivarea din aal1 → %', v;
  end if;
  if (select mfa_enforced from public.profiles where id = uid::uuid) is distinct from true then
    raise exception 'EH4 FAIL: flag-ul a fost stins deși apelul a fost respins';
  end if;

  v := pg_temp.eh_refusal('select public.set_my_mfa_enforced(false)', uid, aal2);
  if v is not null then
    raise exception 'EH4 FAIL: dezactivarea din aal2 a fost refuzată: %', v;
  end if;
  if (select mfa_enforced from public.profiles where id = uid::uuid) is distinct from false then
    raise exception 'EH4 FAIL: dezactivarea din aal2 n-a stins flag-ul';
  end if;

  v := pg_temp.eh_refusal('select public.set_my_mfa_enforced(true)', uid, null);
  if v is not null then
    raise exception 'EH4 FAIL: activarea din aal1 a fost refuzată: %', v;
  end if;
  if (select mfa_enforced from public.profiles where id = uid::uuid) is distinct from true then
    raise exception 'EH4 FAIL: activarea n-a pornit flag-ul';
  end if;
  raise notice 'EH4 PASS: aal1 → P0001 + mfa_aal2_required (flag neatins); aal2 stinge; activarea liberă';
end $$;

-- ── EH5 ──────────────────────────────────────────────────────────────────────
do $$
declare v text[];
begin
  v := pg_temp.eh_refusal('select public.set_my_mfa_enforced(null)', '33000000-0000-4000-8000-00000000a003', null);
  if v is distinct from array['P0001', 'Parametru invalid', 'invalid_parameter'] then
    raise exception 'EH5 FAIL: parametru NULL → %', v;
  end if;
  v := pg_temp.eh_refusal('select public.set_my_mfa_enforced(true)', null, null);
  if v is distinct from array['P0001', 'Autentificare necesară', 'auth_required'] then
    raise exception 'EH5 FAIL: fără utilizator → %', v;
  end if;
  raise notice 'EH5 PASS: invalid_parameter / auth_required, mesaje neschimbate';
end $$;

-- ── EH6 ──────────────────────────────────────────────────────────────────────
do $$
declare
  r        record;
  v_src    text;
  v_raises int;
  v_hinted int;
begin
  for r in
    select * from (values
      ('request_account_deletion', 'public.request_account_deletion()', 2),
      ('set_my_mfa_enforced', 'public.set_my_mfa_enforced(boolean)', 3)
    ) as t(name, sig, n_raises)
  loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = r.name) is distinct from 1::bigint then
      raise exception 'EH6 FAIL: % are mai multe semnături', r.name;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = r.sig::regprocedure) then
      raise exception 'EH6 FAIL: % nu e SECURITY DEFINER', r.name;
    end if;
    if not coalesce((select 'search_path=public, pg_temp' = any (p.proconfig)
                       from pg_proc p where p.oid = r.sig::regprocedure), false) then
      raise exception 'EH6 FAIL: % fără search_path = public, pg_temp', r.name;
    end if;
    v_src := (select p.prosrc from pg_proc p where p.oid = r.sig::regprocedure);
    v_raises := (select count(*) from regexp_matches(v_src, 'raise\s+exception', 'gi'));
    v_hinted := (select count(*) from regexp_matches(v_src, 'raise\s+exception[^;]*using\s+hint\s*=', 'gi'));
    -- Numărul EXACT: anti-vacuitate (un corp gol ar da 0 = 0).
    if v_raises is distinct from r.n_raises or v_hinted is distinct from v_raises then
      raise exception 'EH6 FAIL: % are % raise (așteptat %), % cu hint', r.name, v_raises, r.n_raises, v_hinted;
    end if;
    if has_function_privilege('anon', r.sig, 'execute') then
      raise exception 'EH6 FAIL: % executabil de anon', r.name;
    end if;
    if not has_function_privilege('authenticated', r.sig, 'execute') then
      raise exception 'EH6 FAIL: % nu e executabil de authenticated', r.name;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                where p.oid = r.sig::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception 'EH6 FAIL: % are EXECUTE pentru PUBLIC', r.name;
    end if;
  end loop;

  -- Ordinea refuz → scriere, pe starea FINALĂ a lanțului (asserția din mig 330
  -- se evaluează o singură dată, la poziția 330). Comportamental nu se vede: un
  -- `raise` după UPDATE ar anula oricum instrucțiunea. Ancora e literalul
  -- hint-ului — `active_subscription` gol apare întâi în DECLARE.
  for r in
    select * from (values
      ('request_account_deletion', 'public.request_account_deletion()',
       'hint = ''active_subscription''', 'set deletion_requested_at'),
      ('set_my_mfa_enforced', 'public.set_my_mfa_enforced(boolean)',
       'hint = ''mfa_aal2_required''', 'update public.profiles set mfa_enforced')
    ) as t(name, sig, refusal_anchor, write_anchor)
  loop
    v_src := (select p.prosrc from pg_proc p where p.oid = r.sig::regprocedure);
    if position(r.refusal_anchor in v_src) = 0 or position(r.write_anchor in v_src) = 0
       or position(r.refusal_anchor in v_src) > position(r.write_anchor in v_src) then
      raise exception 'EH6 FAIL: % — refuzul (%) nu mai precedă scrierea (%)', r.name, r.refusal_anchor, r.write_anchor;
    end if;
  end loop;
  raise notice 'EH6 PASS: o semnătură, DEFINER + pg_temp, fiecare raise cu hint, refuzul înaintea scrierii, ACL neschimbat';
end $$;

rollback;

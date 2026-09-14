-- tests/sql/privilege_regime_assertions.sql
-- =============================================================================
-- RP1-RP12: REGIMUL DE PRIVILEGII — invariantele care NU se reconstituie din
-- date. Același fișier rulează în DOUĂ contexte:
--   (a) în CI, NECONDIȚIONAT, la fiecare replay al lanțului (sql-verify.yml);
--   (b) MANUAL, pe o bază RESTAURATĂ, ca poartă go/no-go (docs/RUNBOOK.md §6.3).
--
-- DE CE EXISTĂ (audit v3 RES-07):
-- Celelalte ~60 de suite din tests/sql/ pot fi îndreptate DOAR spre o bază pe
-- care lanțul de migrații a construit-o chiar acum: mută date, cer fixture, nu
-- sunt rulabile pe o bază restaurată din backup. Deci NIMIC nu verifica vreodată
-- regimul de privilegii al unei baze care nu a fost construită de lanț — exact
-- ce produce un restore.
--
-- Măsurat, cu comanda PROPRIE a repo-ului (`pg_dump -Fc --no-owner
-- --no-privileges` → `pg_restore --clean --if-exists`, exit 0, zero erori):
-- arhiva păstrează 114 CREATE POLICY și RLS pe toate cele 76 de tabele, dar 0
-- GRANT / 0 REVOKE / 0 ALTER DEFAULT PRIVILEGES → `proacl` cade la NULL,
-- EXECUTE-ul implicit al lui PUBLIC revine, și `anon` putea apela
-- `accept_invite`, `change_restaurant_slug`, `build_fiscalnet_payload`.
-- Simultan `authenticated` pierdea SELECT pe `restaurants` (cădere ZGOMOTOASĂ
-- peste o escaladare TĂCUTĂ). Al doilea mod de eșec, complet invizibil: un
-- restore care UITĂ pasul de re-activare lasă 84 din 89 de porți
-- fiscale/tenant/happy-hour STINSE, cu datele, ACL-urile și RLS-ul intacte.
--
-- CONTRACT (fiecare punct e o capcană dovedită, nu o precauție):
--   1. READ-ONLY: catalog + `set local role` + SELECT. Zero I/U/D/DDL. Poate fi
--      rulat pe PRODUCȚIE, în paralel cu trafic.
--   2. `\set ON_ERROR_STOP on` e ÎN FIȘIER (ca RW1 și ca toate suitele).
--      Măsurat: la invocare DIRECTĂ (`psql -f acest_fișier`) directiva e
--      suficientă — exit 3, inclusiv când eșecul e în RW1-ul inclus prin `\ir`.
--      ATENȚIE: dacă fișierul e `\i`-uit dintr-un script ÎNVELIȘ, eroarea NU se
--      propagă și psql iese 0 — deci wiring-ul trece ORICUM
--      `-v ON_ERROR_STOP=1` (clasa lipsei lui `-1` din
--      scripts/recover_orphan_vat_snapshots.sql).
--   3. FIECARE verificare negativă are CONTROL POZITIV în același bloc. Motivul
--      e MĂSURAT: pe baza golită de `--no-privileges`, G5 din suita phase-1c
--      tipărește „G5 PASS: 096B table-level lockdown preserved", fiindcă „anon
--      nu are INSERT" e trivial adevărat când anon nu are NIMIC. RP3 ține
--      ancora explicită pentru tot fișierul.
--   4. Privilegii EFECTIVE (`has_*_privilege`), NICIODATĂ text de ACL: prod e
--      PG 17.6 (bitul MAINTAIN, 'm'), CI e postgres:15, replay-ul local 16.13.
--      Toate numerele sunt PRAGURI, niciodată egalități (prod 261 DEFINER / 95
--      triggere vs. replay 259 / 89).
--   5. În scanările de catalog, privilegiul se cere pe OID (`c.oid`), nu pe
--      nume: `has_table_privilege(rol,'public.'||relname,...)` se poate evalua
--      ÎNAINTEA filtrului pe nspname și pică cu „relation public.buckets does
--      not exist" (aceeași reordonare de predicate ca AC5, mig 264).
--   6. Allowlist-urile au CLICHET: o excepție care nu mai e o încălcare reală
--      TREBUIE scoasă, altfel devine ușă deschisă pentru un obiect viitor.
--   7. RP1-RP11 sunt FĂRĂ DATE (trec pe un restore `--schema-only`). RP12 cere
--      rânduri, deliberat, și PICĂ zgomotos dacă nu are — vezi acolo.
--
-- ÎNLOCUIEȘTE (nu reînvie) jumătatea de privilegii a celor două suite MOARTE,
-- `authorization_phase_1a_assertions.sql` (A1-A8) și
-- `authorization_final_state_assertions.sql` (F1-F9), ambele cu `if:` permanent
-- fals din iunie 2026 și ambele PICÂND pe lanțul curent (096c a înlocuit
-- deliberat trigger-ul de rând cu un constraint trigger DEFERRABLE INITIALLY
-- DEFERRED, deci tranzitul intra-tx e acum LEGAL și hint-ul s-a schimbat; iar
-- CHECK-ul A6 e VALIDAT). Harta de supersedare, per asserție:
--   A1 → RP3        A2 → obsolet (096c validează CHECK-ul)   A3 → RP4
--   A4 → RP7+G3     A5 → obsolet (096c)                     A6 → G8 (VIU)
--   A7 → RP10       A8 → G6+G9 (VII)
--   F1 → G1 (VIU: gardă retrasă)   F2 → G3 (VIU)   F3 → G2/G6 (VII)
--   F4.1 → G9 (mutat aici)         F4.2 → G6.2 (VIU, deja acoperit)
--   F5 → RP2+RP3    F6 → RW1 (deja necondiționat)   F7 → G8 (VIU)
--   F8 → RP10       F9 → G10 (mutat aici)
-- Include-ul partajat `assertions/a6_invite_owner_constraint.sql` (A6/F7 în
-- forma NOT VALID) e ȘTERS odată cu ele: cerea `convalidated = false`, deci
-- pica pe orice lanț ≥ 096c și nu mai avea niciun consumator; G8 folosește
-- varianta `_validated`, care e VIE.
-- RP5 reînvie în plus gate-ul MORT din corpul mig 262.
--
-- Verificat: verde pe replay-ul curat (mig 273) și pe PRODUCȚIE (predicatele de
-- catalog, 12 sept 2026); ROȘU pe ambele moduri reale de eșec de restore.
-- =============================================================================

\set ON_ERROR_STOP on
\echo '── RP: regimul de privilegii'

-- ═══════ RP1. Rolurile aplicației, observate SUB ROLUL REAL ═══════
-- Atributele de rol sunt la nivel de CLUSTER: `pg_dumpall --roles-only` le are,
-- un dump de bază de date NU (măsurat: 0 `CREATE ROLE` / `ALTER ROLE` atât în
-- `--schema-only`, cât și în `--data-only`). BYPASSRLS al lui service_role e
-- portant pentru toată suprafața de service (table-payment.js & co.).
--
-- `row_security_active()` e discriminatorul: TRUE pentru un rol căruia RLS-ul i
-- se aplică, FALSE pentru BYPASSRLS/superuser/proprietar. Deci blocul are
-- control pozitiv în AMBELE direcții, nu cere NICIUN rând de date și nici măcar
-- privilegiu de SELECT pe tabel (verificat: anon NU are SELECT pe `restaurants`
-- și funcția întoarce oricum `true`) — mai tare decât o citire de `pg_roles`,
-- care e oarbă la un tabel ajuns în proprietatea unui rol de aplicație.
--
-- ATENȚIE: `set local role` dintr-un bloc DO NU se revine la ieșirea din bloc
-- (verificat: `current_user` rămâne `anon` după `end $$`) — de aceea fiecare
-- ramură, inclusiv cea de excepție, face `reset role` EXPLICIT.
do $$
declare v_a boolean; v_b boolean; v_role text; v_missing text;
begin
  select string_agg(r, ', ') into v_missing
    from unnest(array['anon','authenticated','service_role']) r
   where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then
    raise exception 'RP1 FAIL: rolurile aplicației lipsesc: % — pg_dump NU cară roluri (vezi pg_dumpall --roles-only)', v_missing;
  end if;

  -- FAIL-CLOSED: un cititor cu doar `pg_read_all_data` NU poate `set role`
  -- (verificat: „permission denied to set role"). Atunci poarta nu POATE
  -- verifica regimul RLS — și asta e NO-GO, nu un skip tăcut.
  begin
    set local role anon;
  exception when others then
    reset role;
    raise exception 'RP1 FAIL (FAIL-CLOSED): rolul % nu poate face `set role anon` (%). Poarta nu poate verifica regimul RLS — rulează-o ca owner-ul bazei (pe Supabase: `postgres`, membru în anon/authenticated/service_role), NU cu un reader doar-cu-pg_read_all_data.', current_user, sqlerrm;
  end;
  reset role;

  foreach v_role in array array['anon','authenticated'] loop
    execute format('set local role %I', v_role);
    select row_security_active('public.restaurants'),
           row_security_active('public.orders') into v_a, v_b;
    reset role;
    if v_a is not true or v_b is not true then
      raise exception 'RP1 FAIL: RLS NU se aplică rolului % (restaurants=%, orders=%) — rol cu BYPASSRLS/superuser, sau proprietar de tabel', v_role, v_a, v_b;
    end if;
  end loop;

  set local role service_role;
  select row_security_active('public.orders') into v_a;
  reset role;
  if v_a is not false then
    raise exception 'RP1 FAIL: service_role a pierdut BYPASSRLS (row_security_active=true) — toată suprafața de service se rupe';
  end if;

  if exists (select 1 from pg_roles
              where rolname in ('anon','authenticated')
                and (rolsuper or rolbypassrls or rolcanlogin)) then
    raise exception 'RP1 FAIL: anon/authenticated au atribute privilegiate (super/bypassrls/login)';
  end if;
  raise notice 'RP1 OK: RLS activ pentru anon+authenticated, BYPASSRLS intact pe service_role';
end$$;
reset role;

-- ═══════ RP2. RLS pe TOT public + clichet pe setul deny-all-by-absence ═══════
-- Setul „RLS pornit + ZERO politici" e negare prin ABSENȚĂ. Verificat identic pe
-- replay ȘI pe producție: exact aceste 10 tabele (a 10-a, `pg_cron_janitor_manifest`,
-- vine din mig 274). Un tabel care INTRĂ în set
-- nedeclarat = politici PIERDUTE (restore parțial, replay oprit la mijloc). Un
-- tabel care IESE = a primit o politică ce nu a fost revizuită.
do $$
declare
  v_total int; v_off text; v_pol int; v_nopol text; v_nucleu text;
  v_denyall text[] := array[
    'affiliate_touches','function_rate_limits','gdpr_deletion_config','leads',
    'order_stock_deductions','pg_cron_janitor_manifest','recrutare_leads',
    'retained_invoices','security_ownership_remediations','stripe_events'];
  v_core text[] := array['restaurants','restaurant_memberships','orders','order_items',
                         'order_payments','profiles','invite_tokens','products'];
begin
  select count(*), string_agg(c.relname, ', ' order by c.relname)
           filter (where not c.relrowsecurity)
    into v_total, v_off
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r';
  if v_total < 50 then   -- control pozitiv: nu măsurăm o schemă goală
    raise exception 'RP2 FAIL (control pozitiv): doar % tabele în public — schema pare incompletă', v_total;
  end if;
  if v_off is not null then
    raise exception 'RP2 FAIL: RLS OPRIT pe: %', v_off;
  end if;
  select count(*) into v_pol from pg_policy;
  if v_pol < 80 then     -- PRAG, nu egalitate
    raise exception 'RP2 FAIL (control pozitiv): doar % politici RLS în bază', v_pol;
  end if;

  -- Nucleul TREBUIE să aibă politici: RLS pornit fără nicio politică e deny-all
  -- (sigur, dar aplicația e moartă) și nu are voie să treacă drept „regim intact".
  select string_agg(t, ', ') into v_nucleu from unnest(v_core) t
   where not exists (select 1 from pg_policy p
                      where p.polrelid = ('public.' || quote_ident(t))::regclass);
  if v_nucleu is not null then
    raise exception 'RP2 FAIL: tabele de nucleu fără nicio politică RLS: %', v_nucleu;
  end if;

  -- `collate "C"` pe AMBELE părți: ordinea textului depinde de locale (capcana
  -- CJ10/CJ12 din PR #256), iar aici comparăm o listă ordonată.
  select string_agg(c.relname, ', ' order by c.relname collate "C") into v_nopol
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
  if coalesce(v_nopol, '') <> (select string_agg(t, ', ' order by t collate "C") from unnest(v_denyall) t) then
    raise exception 'RP2 FAIL: setul deny-all-by-absence s-a schimbat.%  aștept: [%]%  găsit:  [%]',
      chr(10), array_to_string(v_denyall, ', '), chr(10), coalesce(v_nopol, '(gol)');
  end if;

  -- Dintre cele 9, DOAR `affiliate_touches` are grant de SELECT către client
  -- (date de fraudă: negarea vine din RLS, nu din revoke — mig 097/097d).
  -- Valoarea așteptată e NE-VIDĂ, deci sub-verificarea e propriul ei control
  -- pozitiv: pe baza golită de `--no-privileges` devine [(gol)] și PICĂ.
  select string_agg(c.relname, ', ' order by c.relname) into v_nopol
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
     and (has_table_privilege('anon', c.oid, 'SELECT')
       or has_table_privilege('authenticated', c.oid, 'SELECT'));
  if coalesce(v_nopol, '') <> 'affiliate_touches' then
    raise exception 'RP2 FAIL: tabele deny-all citibile de client, altele decât affiliate_touches: [%]', coalesce(v_nopol, '(gol)');
  end if;
  raise notice 'RP2 OK: % tabele, RLS pornit pe toate, % politici, set deny-all neschimbat', v_total, v_pol;
end$$;

-- ═══════ RP3. Lockdown 096B/258 + ANCORA ANTI-VACUITATE ═══════
-- Ancora e cea mai importantă linie din tot fișierul: cere ca privilegii
-- legitime să EXISTE, deci nicio verificare de absență din fișier nu poate fi
-- trivial satisfăcută de o bază golită.
do $$
declare v_role text; v_owner text; v_pol int;
begin
  -- ANCORĂ (pozitiv, pentru tot fișierul)
  if not has_table_privilege('authenticated', 'public.restaurants', 'SELECT') then
    raise exception 'RP3 FAIL (ancoră anti-vacuitate): authenticated nu are SELECT pe restaurants — baza are privilegiile ȘTERSE (restore cu pg_dump --no-privileges?), iar orice verificare „X nu are drepturi" devine trivial adevărată';
  end if;
  if not has_table_privilege('authenticated', 'public.restaurant_memberships', 'SELECT') then
    raise exception 'RP3 FAIL (ancoră anti-vacuitate): authenticated nu are SELECT pe restaurant_memberships';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') then
    raise exception 'RP3 FAIL (ancoră anti-vacuitate): authenticated nu are UPDATE pe profiles.full_name';
  end if;

  -- 096B: zero scriere directă pe cele trei tabele de autorizare (fost F5/G5,
  -- dar aici cu ancora de mai sus, deci NE-vacuu — G5 trece pe o bază golită).
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'public.restaurants',
         'INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception 'RP3 FAIL: % are privilegiu non-UPDATE pe restaurants', v_role;
    end if;
    if has_table_privilege(v_role, 'public.restaurant_memberships', 'INSERT, UPDATE, DELETE') then
      raise exception 'RP3 FAIL: % are IUD direct pe restaurant_memberships', v_role;
    end if;
    if has_table_privilege(v_role, 'public.invite_tokens', 'INSERT, UPDATE, DELETE') then
      raise exception 'RP3 FAIL: % are IUD direct pe invite_tokens', v_role;
    end if;
  end loop;

  -- 096A/258: jurnalul de remediere = deny-all (fost A1, orfan în suita moartă).
  if (select c.relkind from pg_class c
       where c.oid = 'public.security_ownership_remediations'::regclass) <> 'r' then
    raise exception 'RP3 FAIL: security_ownership_remediations nu e un TABEL';
  end if;
  select pg_get_userbyid(c.relowner) into v_owner from pg_class c
   where c.oid = 'public.security_ownership_remediations'::regclass;
  if v_owner in ('anon','authenticated','service_role') then
    raise exception 'RP3 FAIL: jurnalul de remediere e deținut de rolul de client %', v_owner;
  end if;
  if not (select c.relrowsecurity from pg_class c
           where c.oid = 'public.security_ownership_remediations'::regclass) then
    raise exception 'RP3 FAIL: RLS oprit pe security_ownership_remediations (mig 258 l-a pornit)';
  end if;
  select count(*) into v_pol from pg_policy
   where polrelid = 'public.security_ownership_remediations'::regclass;
  if v_pol <> 0 then
    raise exception 'RP3 FAIL: security_ownership_remediations are % politici — deny-all e prin ABSENȚĂ (mig 258)', v_pol;
  end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'public.security_ownership_remediations',
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception 'RP3 FAIL: % are privilegii pe security_ownership_remediations', v_role;
    end if;
  end loop;
  raise notice 'RP3 OK: ancora anti-vacuitate trece; lockdown 096B + deny-all 258 intacte';
end$$;

-- ═══════ RP4. profiles: whitelist EXACT de coloane UPDATE (fostul A3) ═══════
-- A3 trăia în suita phase-1A, moartă din iunie 2026 prin `if:`-ul
-- hashFiles(096a)!='' && hashFiles(096b)==''. Era o listă NEGATIVĂ de 4 nume
-- interzise (plan/plan_expires_at/stripe_*), deci o a 5-a coloană sensibilă
-- adăugată ulterior trecea tăcut. Aici e whitelist EXACT, în AMBELE direcții,
-- ca RW1. `is_platform_admin` NU e în set — de asta escaladarea din SH3 (mig
-- 258) e imposibilă. Verificat identic pe replay și pe producție.
do $$
declare
  v_extra text; v_lipsa text; v_role text;
  v_whitelist text[] := array[
    'full_name','deletion_requested_at','terms_accepted_at','terms_accepted_version'];
begin
  select string_agg(w, ', ') into v_lipsa from unnest(v_whitelist) w
   where not has_column_privilege('authenticated', 'public.profiles', w, 'UPDATE');
  if v_lipsa is not null then
    raise exception 'RP4 FAIL: authenticated a pierdut UPDATE pe coloanele profiles: %', v_lipsa;
  end if;
  select string_agg(c.column_name, ', ' order by c.ordinal_position) into v_extra
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'profiles'
     and has_column_privilege('authenticated', 'public.profiles', c.column_name, 'UPDATE')
     and not (c.column_name = any (v_whitelist));
  if v_extra is not null then
    raise exception 'RP4 FAIL: authenticated poate scrie coloane profiles din afara whitelist-ului: % (plan/plan_expires_at/stripe_* = Plan 3 gratuit; is_platform_admin = preluare de platformă)', v_extra;
  end if;
  -- mig 262: INSERT/DELETE revocate pentru TOATE rolurile de client (ștergerea
  -- + reinserarea rândului cu is_platform_admin=true era escaladare completă).
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'public.profiles', 'INSERT')
       or has_table_privilege(v_role, 'public.profiles', 'DELETE')
       or has_table_privilege(v_role, 'public.profiles', 'UPDATE') then
      raise exception 'RP4 FAIL: % are privilegiu la nivel de TABEL (I/U/D) pe profiles — mig 262 le-a revocat', v_role;
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.profiles', 'SELECT') then
    raise exception 'RP4 FAIL: authenticated a pierdut SELECT pe profiles (aplicația e moartă la login)';
  end if;
  if has_table_privilege('anon', 'public.profiles', 'SELECT') then
    raise exception 'RP4 FAIL: anon are SELECT pe profiles';
  end if;
  raise notice 'RP4 OK: profiles UPDATE = whitelist exact de % coloane; zero I/U/D la nivel de tabel', array_length(v_whitelist, 1);
end$$;

-- ═══════ RP5. Convenția DEFINER: search_path TREBUIE să conțină pg_temp ═══════
-- ÎNVIE GATE-UL MORT din mig 262: acolo verificarea trăia DOAR în corpul
-- migrației — o singură evaluare, la poziția 262 din lanț, niciodată după
-- (clasa DP6 / F1-F9 / VS8). Și era mai îngustă decât o descrie CLAUDE.md:
-- potrivea ȘIRUL LITERAL 'search_path=public', deci o funcție DEFINER FĂRĂ
-- niciun proconfig, sau cu 'search_path=public, extensions', trecea. Aici
-- condiția e POZITIVĂ (pg_temp trebuie să fie prezent), deci prinde ambele —
-- ambele mutații verificate.
do $$
declare
  -- Excepții de PLATFORMĂ, nu de aplicație. `rls_auto_enable()` e funcția
  -- event-trigger-ului `ensure_rls` (ddl_command_end) al lui Supabase, cu
  -- search_path=pg_catalog: NU e în lanț, NU e în repo, NU e membru de
  -- extensie, și NU poate fi recreată de operator (CREATE EVENT TRIGGER cere
  -- superuser, iar `postgres` pe prod are rolsuper=false). Inofensivă: o
  -- funcție care întoarce `event_trigger` nu poate fi apelată direct, indiferent
  -- de ACL. Fără excepția asta, poarta ar fi ROȘIE pe prod din prima zi.
  v_allow text[] := array['rls_auto_enable()'];
  v_bad text; v_stale text; v_absent text; v_total int;
begin
  select count(*) into v_total from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef;
  if v_total < 200 then   -- PRAG (replay 259, prod 261)
    raise exception 'RP5 FAIL (control pozitiv): doar % funcții DEFINER în public — schema pare incompletă', v_total;
  end if;

  select string_agg(x.sig || ' [' || x.cfg || ']', ', ' order by x.sig) into v_bad
    from (
      select p.oid::regprocedure::text sig,
             coalesce(array_to_string(p.proconfig, ','), '(fără proconfig)') cfg
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and not exists (
           select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
            where lower(regexp_replace(c, '[[:space:]]+', '', 'g')) like 'search\_path=%pg\_temp%')
    ) x
   where not (x.sig = any (v_allow));
  if v_bad is not null then
    raise exception 'RP5 FAIL: funcții SECURITY DEFINER în public fără pg_temp în search_path: % (scrie-le direct cu `set search_path = public, pg_temp`)', v_bad;
  end if;

  -- CLICHET pe allowlist: o excepție care NU mai e o încălcare reală trebuie
  -- SCOASĂ, altfel devine ușă deschisă pentru o funcție viitoare cu același nume.
  select string_agg(a, ', ') into v_stale from unnest(v_allow) a
   where exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.oid::regprocedure::text = a)
     and not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and p.oid::regprocedure::text = a
          and not exists (
            select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
             where lower(regexp_replace(c, '[[:space:]]+', '', 'g')) like 'search\_path=%pg\_temp%'));
  if v_stale is not null then
    raise exception 'RP5 FAIL (clichet pe allowlist): % nu mai e o excepție reală (reparată, sau nu mai e DEFINER) — scoate-o din v_allow', v_stale;
  end if;
  -- O excepție ABSENTĂ e legitimă (replay CI / Postgres non-Supabase): se
  -- RAPORTEAZĂ, nu pică — altfel poarta ar fi roșie pe orice mediu în afară de prod.
  select string_agg(a, ', ') into v_absent from unnest(v_allow) a
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.oid::regprocedure::text = a);
  if v_absent is not null then
    raise notice 'RP5 NOTĂ: excepții de platformă absente în această bază (normal pe replay/CI): %', v_absent;
  end if;
  raise notice 'RP5 OK: % funcții DEFINER în public, toate cu pg_temp (excepții platformă: %)',
    v_total, array_to_string(v_allow, ', ');
end$$;

-- ═══════ RP6. Helperii interni nu sunt apelabili de client (mig 262) ═══════
-- Măsurat pe restore-ul cu --no-privileges: TOȚI cei 6 devin apelabili de
-- anon/authenticated, fiindcă `proacl` cade la NULL și EXECUTE-ul implicit al
-- lui PUBLIC revine. De aceea verificarea e pe privilegiu EFECTIV
-- (has_function_privilege), NU pe `aclexplode(proacl)` — cu proacl NULL
-- aclexplode nu întoarce nimic, deci o verificare pe ACL ar fi ORBĂ exact aici.
do $$
declare
  v_helperi text[] := array[
    'public._refresh_order_totals(uuid)','public.build_fiscalnet_payload(uuid)',
    'public.owner_plan(uuid)','public.log_ai_import(uuid, uuid, integer)',
    'public.reserve_ai_import_slot(uuid, uuid)','public.check_ai_import_quota(uuid)'];
  v_sig text; v_expus text := null; v_lipsa text := null;
begin
  foreach v_sig in array v_helperi loop
    if to_regprocedure(v_sig) is null then
      v_lipsa := concat_ws(', ', v_lipsa, v_sig);
      continue;
    end if;
    if has_function_privilege('anon', v_sig::regprocedure, 'EXECUTE')
       or has_function_privilege('authenticated', v_sig::regprocedure, 'EXECUTE') then
      v_expus := concat_ws(', ', v_expus, v_sig);
    end if;
    -- control POZITIV per helper: apelanții reali (trigger-e / RPC-uri DEFINER
    -- / funcții Netlify) trebuie să-l poată executa.
    if not has_function_privilege('service_role', v_sig::regprocedure, 'EXECUTE') then
      raise exception 'RP6 FAIL: service_role nu poate executa % — bonul fiscal / totalurile se rup', v_sig;
    end if;
  end loop;
  if v_lipsa is not null then
    raise exception 'RP6 FAIL: helperi interni LIPSĂ: %', v_lipsa;
  end if;
  if v_expus is not null then
    raise exception 'RP6 FAIL: helperi interni expuși clientului: %', v_expus;
  end if;
  -- singurul helper cu apelant client legitim (useFeatures → get_restaurant_features).
  if not has_function_privilege('authenticated', 'public.get_restaurant_features(uuid)', 'EXECUTE') then
    raise exception 'RP6 FAIL (control pozitiv): authenticated a pierdut EXECUTE pe get_restaurant_features — useFeatures e rupt, deci nu măsurăm un univers gol';
  end if;
  if has_function_privilege('anon', 'public.get_restaurant_features(uuid)', 'EXECUTE') then
    raise exception 'RP6 FAIL: anon poate executa get_restaurant_features';
  end if;
  raise notice 'RP6 OK: % helperi interni închiși; get_restaurant_features + service_role intacte',
    array_length(v_helperi, 1);
end$$;

-- ═══════ RP7. ZERO triggere dezactivate, oriunde + canare numite ═══════
-- Modul de eșec cel mai TĂCUT al unui restore, și singurul invariant din acest
-- fișier pe care NIMIC din repo nu-l acoperea global
-- (`grep -n "tgenabled = 'D'" tests/sql/*.sql` → gol). Măsurat: o bază cu toate
-- datele, tot regimul de privilegii și RLS pe toate cele 76 de tabele, cu 84
-- din 89 de porți fiscale/tenant/happy-hour STINSE — iar RW1 și restul suitei
-- trec fără să observe. Suita phase-1c prinde starea dezactivată pentru cele 3
-- triggere pe care le NUMEȘTE (G2/G2.5/G3), dar mută date și cere fixture, deci
-- nu e rulabilă pe o bază restaurată.
-- FĂRĂ egalitate pe număr: replay 89, prod 95.
do $$
declare
  v_off text; v_total int; v_missing text;
  -- Canare: „zero dezactivate" e trivial adevărat dacă triggerele nu au fost
  -- create niciodată. Fiecare canar e o poartă de BANI sau de IZOLARE, și e
  -- calificat cu TABELA (un trigger mutat pe alt tabel nu mai apără nimic).
  v_canary text[] := array[
    'public.orders|trg_orders_paid_fiscal_gate',              -- mig 124
    'public.orders|trg_orders_closed_fiscal_gate',            -- mig 264
    'public.orders|trg_orders_cancel_ledger_gate',            -- mig 270
    'public.orders|trg_enforce_order_table_tenant',           -- mig 113/240
    'public.orders|enqueue_fiscal_receipt_trg',               -- mig 259
    'public.orders|trg_apply_happy_hour_auto',                -- mig 077 (constraint trigger)
    'public.order_items|trg_snapshot_order_item_vat',         -- mig 272
    'public.order_items|order_items_subtotal_sync_upd',       -- mig 248
    'public.restaurant_memberships|trg_enforce_owner_membership_invariant', -- mig 096c
    'public.restaurants|trg_restaurants_owner_id_immutable',  -- mig 096b
    'public.profiles|trg_profiles_block_client_write',        -- mig 262
    'public.pending_receipts|trg_pending_receipts_block_client_repend', -- mig 270
    'public.pending_receipts|trg_pending_receipts_block_delete'         -- mig 275
  ];
begin
  select count(*), string_agg(n.nspname || '.' || c.relname || '.' || t.tgname, ', ')
           filter (where t.tgenabled = 'D')
    into v_total, v_off
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal;
  if v_off is not null then
    raise exception 'RP7 FAIL: triggere DEZACTIVATE (restore fără pasul de re-enable, sau script de reparație oprit la mijloc): %', v_off;
  end if;
  if v_total < 80 then   -- PRAG (replay 89, prod 95)
    raise exception 'RP7 FAIL (control pozitiv): doar % triggere ne-interne', v_total;
  end if;
  select string_agg(cn, ', ') into v_missing from unnest(v_canary) cn
   where not exists (
     select 1 from pg_trigger t
      where t.tgrelid = split_part(cn, '|', 1)::regclass
        and t.tgname = split_part(cn, '|', 2)
        and not t.tgisinternal
        and t.tgenabled in ('O','A'));
  if v_missing is not null then
    raise exception 'RP7 FAIL: triggere canar lipsă sau inactive: %', v_missing;
  end if;
  raise notice 'RP7 OK: % triggere ne-interne, zero dezactivate, % canare active',
    v_total, array_length(v_canary, 1);
end$$;

-- ═══════ RP8. Default privileges: anon/PUBLIC fără CRUD pe obiecte VIITOARE ══
-- `pg_default_acl` nu avea NICIO verificare nicăieri în repo
-- (`grep -rlnE "pg_default_acl|default privileges" tests/sql/*.sql` → gol).
-- Măsurat: `pg_dump --no-privileges` cară 0 `ALTER DEFAULT PRIVILEGES`, deci un
-- tabel creat DUPĂ restore n-ar mai fi lizibil de `authenticated` — iar
-- operatorul ar „repara" cu un grant larg.
--
-- Scopat la grantorii APLICAȚIEI (tot ce nu e în allowlist-ul de platformă): pe
-- producție există și rânduri ale platformei, grantor `supabase_admin`, care dau
-- lui `anon` arwdDxtm pe tabelele viitoare — configurație Supabase, pe care
-- aplicația NU o poate revoca și care e contrabalansată de event-trigger-ul
-- `ensure_rls`; backstop-ul nostru pentru ea e RP2 (RLS pe FIECARE tabel).
-- Al lanțului propriu e mig 047, singurele două ALTER DEFAULT PRIVILEGES din
-- 273 de migrații, și dă DOAR lui `authenticated`.
do $$
declare
  v_platform text[] := array['supabase_admin'];
  v_crud text[] := array['SELECT','INSERT','UPDATE','DELETE'];
  v_app int; v_bad text; v_lipsa text;
begin
  select count(*) into v_app
    from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'public' and not (pg_get_userbyid(d.defaclrole) = any (v_platform));
  if v_app = 0 then
    raise exception 'RP8 FAIL (control pozitiv): zero default privileges proprii în schema public — mig 047 nu a rulat, sau dump-ul le-a pierdut (--no-privileges le șterge)';
  end if;
  -- POZITIV: authenticated TREBUIE să primească CRUD pe tabelele viitoare (mig 047).
  select string_agg(p, ', ') into v_lipsa from unnest(v_crud) p
   where not exists (
     select 1 from pg_default_acl d
     join pg_namespace n on n.oid = d.defaclnamespace,
          aclexplode(d.defaclacl) ae
      where n.nspname = 'public' and d.defaclobjtype = 'r'
        and not (pg_get_userbyid(d.defaclrole) = any (v_platform))
        and pg_get_userbyid(ae.grantee) = 'authenticated'
        and ae.privilege_type = p);
  if v_lipsa is not null then
    raise exception 'RP8 FAIL: default privileges proprii nu mai dau authenticated % pe tabelele viitoare din public (mig 047)', v_lipsa;
  end if;
  -- NEGATIV: anon și PUBLIC nu au voie CRUD implicit.
  select string_agg(x.grantor || '/' || x.objtype || ' → ' || x.grantee || ': ' || x.priv, ', '
                    order by x.grantor, x.objtype, x.grantee, x.priv) into v_bad
    from (
      select pg_get_userbyid(d.defaclrole) grantor, d.defaclobjtype::text objtype,
             case when ae.grantee = 0 then 'PUBLIC' else pg_get_userbyid(ae.grantee) end grantee,
             ae.privilege_type priv
        from pg_default_acl d
        join pg_namespace n on n.oid = d.defaclnamespace,
             aclexplode(d.defaclacl) ae
       where n.nspname = 'public'
         and not (pg_get_userbyid(d.defaclrole) = any (v_platform))
         and (ae.grantee = 0 or pg_get_userbyid(ae.grantee) = 'anon')
         and ae.privilege_type = any (v_crud)
    ) x;
  if v_bad is not null then
    raise exception 'RP8 FAIL: default privileges PROPRII dau CRUD lui anon/PUBLIC pe obiecte viitoare (orice tabel nou devine deschis la creare): %', v_bad;
  end if;
  raise notice 'RP8 OK: % intrări proprii de default privileges; authenticated are CRUD, anon/PUBLIC zero', v_app;
end$$;

-- ═══════ RP9. Orice view citibil de client are security_invoker=true ═══════
-- Închide CLASA lui VS8: `security_invoker` era verificat doar pentru
-- `vat_report_daily`, în corpul mig 272 și în VS8 — pe UN view. Invariantul
-- general nu e arbitrar (se definește prin „are grant către un rol de client",
-- nu prin listă) și e verificat identic pe replay ȘI pe producție: din 16
-- view-uri în public, cele 13 cu grant de client au TOATE security_invoker=true,
-- iar singurul fără opțiune (`admin_tenant_overview`) nu e acordat niciunui rol
-- de client. Fără opțiune, view-ul rulează cu drepturile PROPRIETARULUI și
-- ocolește RLS-ul: un cont autentificat fără nicio apartenență citește raportul
-- TVA al altui restaurant (dovedit prin mutație în mig 272 / VS11).
do $$
declare v_bad text; v_n int;
begin
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and (has_table_privilege('anon', c.oid, 'SELECT')
       or has_table_privilege('authenticated', c.oid, 'SELECT'));
  if v_n = 0 then
    raise exception 'RP9 FAIL (control pozitiv): zero view-uri citibile de client — privilegiile lipsesc, deci verificarea ar fi vacuă';
  end if;
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and (has_table_privilege('anon', c.oid, 'SELECT')
       or has_table_privilege('authenticated', c.oid, 'SELECT'))
     and not exists (select 1 from unnest(coalesce(c.reloptions, '{}'::text[])) o
                      where o = 'security_invoker=true');
  if v_bad is not null then
    raise exception 'RP9 FAIL: view-uri citibile de client FĂRĂ security_invoker (rulează cu drepturile proprietarului, ocolind RLS): %', v_bad;
  end if;
  raise notice 'RP9 OK: % view-uri citibile de client, toate security_invoker=true', v_n;
end$$;

-- ═══════ RP10. Cele 7 RPC-uri de autorizare: convenție + matrice EXECUTE ═════
-- Rescapă INTEGRAL fostul F8 (orfan în suita moartă). G7, care e VIU, verifică
-- existența, PUBLIC-zero și matricea, dar NU convenția: prosecdef, tip de
-- retur, owner de încredere, search_path=public,pg_temp, și detecția de
-- OVERLOAD. Overload-ul e o clasă dovedită de trei ori în acest lanț
-- (register_affiliate 243, bridge_retry_receipt 270, create_reservation_public
-- 273): un `create or replace` cu semnătură nouă lasă AMBELE → PGRST203 la
-- ORICE apel. Scopat la cele 7, NU global: lanțul are deja un overload legitim
-- (`bridge_get_pending` × 2, identic pe replay și pe prod), deci un clichet
-- global ar cere allowlist din prima zi.
-- Matricea e păstrată aici (deși G7 o are) ca poarta să fie AUTO-SUFICIENTĂ pe
-- o bază restaurată, unde G7 nu rulează: măsurat, pe restore-ul golit
-- service_role ajunge `true` pe preview_invite prin EXECUTE-ul implicit al lui
-- PUBLIC, și ramura POZITIVĂ a matricei e ce prinde asta.
do $$
declare
  v_expected text[] := array[
    'public.preview_invite(text)',
    'public.accept_invite(text)',
    'public.create_restaurant(text,text,text,text)',
    'public.change_member_role(uuid,public.member_role)',
    'public.remove_member(uuid)',
    'public.revoke_invite(uuid)',
    'public.change_restaurant_slug(uuid,text)'];
  v_oids oid[]; v_missing text; v_extra text; v_fn text;
  v_proc regprocedure; v_owner text; v_cfg text;
  v_role text; v_should boolean; v_actual boolean;
begin
  select string_agg(fn, ', ') into v_missing from unnest(v_expected) fn
   where to_regprocedure(fn) is null;
  if v_missing is not null then
    raise exception 'RP10 FAIL: RPC-uri de autorizare lipsă: %', v_missing;
  end if;
  select array_agg(to_regprocedure(fn)::oid) into v_oids from unnest(v_expected) fn;

  select string_agg(p.oid::regprocedure::text, ', ') into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('preview_invite','accept_invite','create_restaurant',
                       'change_member_role','remove_member','revoke_invite',
                       'change_restaurant_slug')
     and not (p.oid = any (v_oids));
  if v_extra is not null then
    raise exception 'RP10 FAIL: overload-uri neașteptate (PostgREST → PGRST203 la ORICE apel): %', v_extra;
  end if;

  foreach v_fn in array v_expected loop
    v_proc := v_fn::regprocedure;
    if not (select p.prosecdef from pg_proc p where p.oid = v_proc) then
      raise exception 'RP10 FAIL: % nu e SECURITY DEFINER', v_fn;
    end if;
    if (select pg_catalog.format_type(p.prorettype, null) from pg_proc p where p.oid = v_proc) <> 'jsonb' then
      raise exception 'RP10 FAIL: % nu întoarce jsonb', v_fn;
    end if;
    select pg_get_userbyid(p.proowner) into v_owner from pg_proc p where p.oid = v_proc;
    if v_owner in ('anon','authenticated','service_role') then
      raise exception 'RP10 FAIL: % e deținut de rolul de client % (DEFINER ar rula cu drepturile LUI)', v_fn, v_owner;
    end if;
    select lower(regexp_replace(coalesce(array_to_string(p.proconfig, ','), ''), '[[:space:]]+', '', 'g'))
      into v_cfg from pg_proc p where p.oid = v_proc;
    if v_cfg !~ '(^|,)search_path=public,pg_temp(,|$)' then
      raise exception 'RP10 FAIL: % proconfig=% (aștept search_path=public,pg_temp)', v_fn, v_cfg;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) ae
                where p.oid = v_proc and ae.grantee = 0 and ae.privilege_type = 'EXECUTE') then
      raise exception 'RP10 FAIL: PUBLIC păstrează EXECUTE pe %', v_fn;
    end if;
  end loop;

  for v_role, v_fn, v_should in
    select * from (values
      ('anon',         'public.preview_invite(text)',                        true),
      ('authenticated','public.preview_invite(text)',                        true),
      ('service_role', 'public.preview_invite(text)',                        false),
      ('anon',         'public.accept_invite(text)',                         false),
      ('authenticated','public.accept_invite(text)',                         true),
      ('service_role', 'public.accept_invite(text)',                         false),
      ('anon',         'public.create_restaurant(text,text,text,text)',      false),
      ('authenticated','public.create_restaurant(text,text,text,text)',      true),
      ('service_role', 'public.create_restaurant(text,text,text,text)',      false),
      ('anon',         'public.change_member_role(uuid,public.member_role)', false),
      ('authenticated','public.change_member_role(uuid,public.member_role)', true),
      ('service_role', 'public.change_member_role(uuid,public.member_role)', false),
      ('anon',         'public.remove_member(uuid)',                         false),
      ('authenticated','public.remove_member(uuid)',                         true),
      ('service_role', 'public.remove_member(uuid)',                         false),
      ('anon',         'public.revoke_invite(uuid)',                         false),
      ('authenticated','public.revoke_invite(uuid)',                         true),
      ('service_role', 'public.revoke_invite(uuid)',                         false),
      ('anon',         'public.change_restaurant_slug(uuid,text)',           false),
      ('authenticated','public.change_restaurant_slug(uuid,text)',           true),
      ('service_role', 'public.change_restaurant_slug(uuid,text)',           false)
    ) m(rl, fn, should)
  loop
    v_actual := has_function_privilege(v_role, v_fn::regprocedure, 'EXECUTE');
    if v_actual <> v_should then
      raise exception 'RP10 FAIL: EXECUTE % pe % aștept=% actual=%', v_role, v_fn, v_should, v_actual;
    end if;
  end loop;
  raise notice 'RP10 OK: 7 RPC-uri DEFINER (jsonb, public+pg_temp, owner de încredere, zero overload, PUBLIC-zero) + matrice EXECUTE';
end$$;

-- ═══════ RP11 = RW1 (delegat, sursă UNICĂ) ═══════
-- Whitelist-ul de coloane UPDATE pe `restaurants` are deja fișierul lui, legat
-- NECONDIȚIONAT în CI (audit v3 rangul 13). E pur catalog, deci prod-runnable:
-- îl includem aici ca operatorul de restore să obțină TOT regimul cu O comandă
-- și ca whitelist-ul să rămână într-un SINGUR loc (cele „4 locuri" din
-- CLAUDE.md nu devin 5). `\ir` se rezolvă relativ la FIȘIERUL care include,
-- deci merge din orice cwd (verificat rulând cu cale absolută din `/`). În CI
-- rulează de două ori (pasul propriu + prin poartă): ~20 ms, acceptat conștient
-- în schimbul unicității sursei.
\ir restaurant_update_whitelist_assertions.sql

-- ═══════ RP12. Citire SUB ROLUL REAL (singura verificare ne-oarbă la politici) ══
-- RP1-RP11 sunt catalog: sunt ORBE la o politică `using (true)`. Aici se asumă
-- rolul REAL `authenticated`, FĂRĂ niciun claim JWT, deci `auth.uid()` e NULL →
-- `is_member`/`is_platform_admin`/`has_partner_access` sunt toate false → ZERO
-- rânduri vizibile. Aceeași disciplină ca PM8/TP24/VS11 (restul suitelor rulează
-- ca `postgres`, care ocolește RLS și e ORB la clasa asta).
--
-- CERE DATE, deliberat, cu guard de NE-VACUITATE care PICĂ (nu sare): „0 rânduri"
-- nu dovedește nimic pe un tabel gol. În CI datele vin din pasul de fixture
-- (`authorization_test_fixture.sql`), care rulează ÎNAINTEA pasului RW1 și deci
-- înaintea acestei porți — de aceea pasul de CI se pune ACOLO, nu mai sus. Pe o
-- bază restaurată datele vin din tenanții reali (RUNBOOK §6.2 rulează poarta
-- DUPĂ încărcare). Pe un restore `--schema-only` poarta pică ZGOMOTOS, cu mesaj
-- acționabil — ceea ce e corect: regimul RLS nu poate fi dovedit fără rânduri.
begin;
do $$
declare v_n bigint;
begin
  if not pg_has_role(current_user, 'authenticated', 'USAGE') then
    raise exception 'RP12 FAIL (FAIL-CLOSED): rolul % nu poate face `set role authenticated`, deci verificarea de RLS nu poate rula. Rulează poarta ca owner-ul bazei (pe Supabase: `postgres`).', current_user;
  end if;
  if not has_table_privilege('authenticated', 'public.restaurants', 'SELECT') then
    raise exception 'RP12 FAIL: authenticated nu are SELECT pe restaurants';
  end if;
  select count(*) into v_n from public.restaurants;
  if v_n = 0 then
    raise exception 'RP12 FAIL (ne-vacuitate): public.restaurants e GOALĂ, deci verificarea de RLS ar fi vacuă. Rulează poarta DUPĂ încărcarea datelor (în CI: după authorization_test_fixture.sql).';
  end if;
end$$;
set local role authenticated;
do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.restaurants;
  if v_n <> 0 then
    raise exception 'RP12 FAIL: `authenticated` fără membership vede % restaurante — politică prea largă (using(true)) sau BYPASSRLS', v_n;
  end if;
  select count(*) into v_n from public.order_payments;
  if v_n <> 0 then
    raise exception 'RP12 FAIL: `authenticated` fără membership vede % plăți (order_payments)', v_n;
  end if;
end$$;
rollback;
do $$ begin raise notice 'RP12 OK: authenticated fără membership vede 0 restaurante / 0 plăți (sub RLS real)'; end$$;

\echo '✅ REGIM DE PRIVILEGII INTACT (RP1-RP12 + RW1)'

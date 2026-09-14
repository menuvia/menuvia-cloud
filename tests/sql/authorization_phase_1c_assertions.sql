-- tests/sql/authorization_phase_1c_assertions.sql
--   Set complet asserții PR 1C (după 096C). Cere fixture-ul rulat în prealabil.
--
--   G1. Guard tranzitoriu eliminat (trigger + funcție).
--   G2. Invariant deferred CONSTRAINT TRIGGER activ (deferrable, init deferred).
--   G3. owner_id immutability trigger (096A) păstrat activ.
--   G4. Schema/tabela `archive.invite_tokens_owner_history` există, zero
--       privilegii pentru rolurile aplicației.
--   G5. Privilegii table-level final-state (096B) păstrate: zero IUD pe cele
--       trei tabele pentru PUBLIC/anon/authenticated.
--   G6. Comportamental: invariantul deferred respinge o stare finală ruptă
--       (DELETE owner) la SET CONSTRAINTS IMMEDIATE; pozitiv: create_restaurant
--       rămâne valid (1 owner aliniat).
--   G7. 7 RPC-uri intacte: EXECUTE matrix per (anon, authenticated, service_role)
--       + PUBLIC EXECUTE zero.
--   G8. A6 validated via \ir (convalidated=true + 3 cazuri comportamentale).

\set ON_ERROR_STOP on

-- ═══════════════════════ G1. Guard tranzitoriu eliminat ══════════════════════
do $$
begin
  if exists (select 1 from pg_trigger
              where tgname='trg_block_owner_membership_mutation' and not tgisinternal) then
    raise exception 'G1 FAIL: transitory guard trigger still present';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='fn_block_owner_membership_mutation') then
    raise exception 'G1 FAIL: fn_block_owner_membership_mutation still present';
  end if;
  raise notice 'G1 PASS: transitory guard fully retired';
end$$;

-- ═══════════════════════ G2. Invariant deferred trigger activ ════════════════
do $$
declare v_count int;
begin
  select count(*) into v_count from pg_trigger
   where tgname  = 'trg_enforce_owner_membership_invariant'
     and tgrelid = 'public.restaurant_memberships'::regclass
     and not tgisinternal
     and tgenabled in ('O','A')
     and tgdeferrable and tginitdeferred
     and tgfoid = 'public.fn_enforce_owner_membership_invariant()'::regprocedure;
  if v_count <> 1 then
    raise exception 'G2 FAIL: deferred invariant trigger missing/not-deferred/wrong-fn';
  end if;
  raise notice 'G2 PASS: trg_enforce_owner_membership_invariant active, DEFERRABLE INITIALLY DEFERRED';
end$$;

-- ═══════════════════════ G2.5 Invariant trigger și pe `restaurants` ═════════
-- Defense-in-depth: triggerul a doua atașat la `public.restaurants` (AFTER
-- INSERT OR UPDATE OF owner_id) — acoperă cazul în care un RPC viitor ar
-- bypassa `bootstrap_restaurant_owner` la INSERT, sau dezactivează triggerul
-- de imutabilitate pentru UPDATE owner_id (cum face scriptul admin de remediere).
do $$
declare v_count int;
begin
  select count(*) into v_count from pg_trigger
   where tgname  = 'trg_enforce_owner_membership_invariant_restaurants'
     and tgrelid = 'public.restaurants'::regclass
     and not tgisinternal
     and tgenabled in ('O','A')
     and tgdeferrable and tginitdeferred
     and tgfoid = 'public.fn_enforce_owner_membership_invariant()'::regprocedure;
  if v_count <> 1 then
    raise exception 'G2.5 FAIL: deferred invariant trigger on restaurants missing/not-deferred/wrong-fn';
  end if;
  raise notice 'G2.5 PASS: trg_enforce_owner_membership_invariant_restaurants active, DEFERRABLE INITIALLY DEFERRED';
end$$;

-- ═══════════════════════ G3. owner_id immutability păstrat ═══════════════════
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname='trg_restaurants_owner_id_immutable'
                    and tgrelid='public.restaurants'::regclass
                    and not tgisinternal and tgenabled in ('O','A')
                    and tgfoid='public.fn_restaurants_owner_id_immutable()'::regprocedure) then
    raise exception 'G3 FAIL: owner_id immutability trigger missing';
  end if;
  raise notice 'G3 PASS: trg_restaurants_owner_id_immutable still active';
end$$;

-- ═══════════════════════ G3.5 Coexistență triggers ownership ═════════════════
-- Modelul de securitate depinde de AMBELE triggere active simultan:
--   • trg_restaurants_owner_id_immutable — owner_id pe `restaurants` e
--     imuabil (096A). Fără el, o tranzacție ar putea pivota owner_id ca să
--     „alinieze" un membership compromis → invariantul deferred l-ar accepta
--     ca stare finală coerentă, dar atacatorul ar fi mutat efectiv ownership.
--   • trg_enforce_owner_membership_invariant — exact 1 owner membership
--     aliniat la COMMIT (096C). Fără el, un RPC buggy ar putea persista
--     zero/doi owneri sau un owner nealiniat.
-- Eliminarea ORICĂRUIA slăbește tăcut invariantul global: invariantul de
-- membership presupune owner_id imuabil; immutability presupune memberships
-- coerente. Niciunul nu e suficient singur.
do $$
declare v_immutable int; v_invariant int;
begin
  select count(*) into v_immutable from pg_trigger
   where tgname  = 'trg_restaurants_owner_id_immutable'
     and tgrelid = 'public.restaurants'::regclass
     and tgfoid  = 'public.fn_restaurants_owner_id_immutable()'::regprocedure
     and not tgisinternal and tgenabled in ('O','A');
  if v_immutable <> 1 then
    raise exception 'G3.5 FAIL: owner_id immutability trigger missing/disabled (count=%)', v_immutable;
  end if;

  select count(*) into v_invariant from pg_trigger
   where tgname  = 'trg_enforce_owner_membership_invariant'
     and tgrelid = 'public.restaurant_memberships'::regclass
     and tgfoid  = 'public.fn_enforce_owner_membership_invariant()'::regprocedure
     and not tgisinternal and tgenabled in ('O','A');
  if v_invariant <> 1 then
    raise exception 'G3.5 FAIL: owner membership invariant trigger missing/disabled (count=%)', v_invariant;
  end if;

  raise notice 'G3.5 PASS: both ownership triggers coexist (owner_id immutability + membership invariant)';
end$$;

-- ═══════════════════════ G4. Arhivă owner-invite ═════════════════════════════
do $$
declare v_role text;
begin
  if to_regclass('archive.invite_tokens_owner_history') is null then
    raise exception 'G4 FAIL: archive.invite_tokens_owner_history missing';
  end if;
  -- Zero privilegii pe tabela de arhivă pentru rolurile aplicației
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'archive.invite_tokens_owner_history',
         'SELECT, INSERT, UPDATE, DELETE') then
      raise exception 'G4 FAIL: % retains privilege on archive table', v_role;
    end if;
  end loop;
  -- PUBLIC via aclexplode
  if exists (select 1 from pg_class c, aclexplode(c.relacl) ae
              where c.oid = 'archive.invite_tokens_owner_history'::regclass
                and ae.grantee = 0) then
    raise exception 'G4 FAIL: PUBLIC retains privilege on archive table';
  end if;
  raise notice 'G4 PASS: archive table present, zero app-role privileges';
end$$;

-- ═══════════════════════ G5. Privilegii table-level (096B) păstrate ══════════
do $$
declare v_role text;
begin
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'public.restaurants',
         'INSERT, DELETE, REFERENCES, TRUNCATE, TRIGGER') then
      raise exception 'G5 FAIL: % retains non-UPDATE privilege on restaurants', v_role;
    end if;
    if has_table_privilege(v_role, 'public.restaurant_memberships', 'INSERT, UPDATE, DELETE') then
      raise exception 'G5 FAIL: % retains IUD on restaurant_memberships', v_role;
    end if;
    if has_table_privilege(v_role, 'public.invite_tokens', 'INSERT, UPDATE, DELETE') then
      raise exception 'G5 FAIL: % retains IUD on invite_tokens', v_role;
    end if;
  end loop;
  raise notice 'G5 PASS: 096B table-level lockdown preserved';
end$$;

-- ═══════════════════════ G6. Comportamental invariant deferred ═══════════════
-- G6.1 negativ: ștergerea owner membership lasă o stare finală ruptă →
-- SET CONSTRAINTS ALL IMMEDIATE forțează triggerul deferred → check_violation.
begin;
set local role postgres;
savepoint g6;
do $$
declare v_hint text;
begin
  delete from public.restaurant_memberships
   where restaurant_id = '00000000-0000-4000-8000-00000000a602'
     and role = 'owner'::public.member_role;
  begin
    set constraints all immediate;
    raise exception 'G6.1 FAIL: deferred invariant did not fire on missing owner';
  exception
    when check_violation then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'invariant:owner_membership_singleton' then
        raise exception 'G6.1 FAIL: wrong hint=%', v_hint;
      end if;
    when others then
      raise exception 'G6.1 FAIL: unexpected SQLSTATE %', sqlstate;
  end;
end$$;
rollback to savepoint g6;
rollback;

-- G6.2 pozitiv: create_restaurant produce exact 1 owner aliniat; SET CONSTRAINTS
-- IMMEDIATE nu ridică nimic (invariant satisfăcut).
begin;
do $$ begin
  update public.profiles set plan = 'enterprise'
   where id = '00000000-0000-4000-8000-00000000a601';
end$$;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a601';
set local role authenticated;
do $$
declare v_slug text := 'g6-bootstrap-' || gen_random_uuid()::text;
        v_resp jsonb; v_rid uuid; v_n int;
begin
  v_resp := public.create_restaurant('G6 Bootstrap', 'București', v_slug, '#C8963C');
  if not (v_resp->>'ok')::boolean then raise exception 'G6.2 FAIL: resp=%', v_resp; end if;
  v_rid := (v_resp->>'restaurant_id')::uuid;
  set constraints all immediate;  -- nu trebuie să ridice
  select count(*) into v_n from public.restaurant_memberships
   where restaurant_id = v_rid and role = 'owner'::public.member_role;
  if v_n <> 1 then raise exception 'G6.2 FAIL: owner count=%', v_n; end if;
  raise notice 'G6 PASS: deferred invariant blocks broken end-state + permits create_restaurant';
end$$;
rollback;

-- G6.3 negativ alignment: count=1 dar user_id ≠ restaurants.owner_id.
-- Acoperă ramura distinctă `invariant:owner_membership_alignment`, care e
-- separată de `owner_membership_singleton` testată în G6.1. Pivotăm user_id
-- al owner-membership-ului existent la un user competitor → count rămâne 1
-- (singleton ok) dar alignment se rupe. SET CONSTRAINTS IMMEDIATE forțează
-- triggerul deferred → check_violation cu hint exact.
begin;
set local role postgres;
savepoint g63;
do $$
declare v_hint text; v_other uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_other, 'g63-other@test.invalid')
    on conflict (id) do nothing;
  update public.restaurant_memberships
     set user_id = v_other
   where restaurant_id = '00000000-0000-4000-8000-00000000a602'
     and role = 'owner'::public.member_role;
  begin
    set constraints all immediate;
    raise exception 'G6.3 FAIL: deferred invariant did not fire on alignment break';
  exception
    when check_violation then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'invariant:owner_membership_alignment' then
        raise exception 'G6.3 FAIL: wrong hint=% (expected invariant:owner_membership_alignment)', v_hint;
      end if;
    when others then
      raise exception 'G6.3 FAIL: unexpected SQLSTATE %', sqlstate;
  end;
  raise notice 'G6.3 PASS: deferred invariant blocks owner_membership_alignment break + zero state drift';
end$$;
rollback to savepoint g63;
rollback;

-- G6.4 negativ multi-restaurant UPDATE: mută owner-membership-ul restaurantului
-- a602 într-un al doilea restaurant. Restaurantul a602 rămâne fără owner (count=0)
-- → triggerul trebuie să verifice AMBELE restaurante (OLD + NEW), nu doar NEW.
-- Înainte de fix: coalesce(NEW.restaurant_id, OLD.restaurant_id) verifica doar
-- NEW, ratând restaurantul vechi. Fix: iterare distinctă peste OLD + NEW.
begin;
set local role postgres;
savepoint g64;
do $$
declare
  v_other_rid uuid := '00000000-0000-4000-8000-00000000a604';
  v_other_owner uuid := gen_random_uuid();
  v_hint text;
begin
  -- Seed: al doilea restaurant cu owner-ul aliniat (bootstrap_restaurant_owner
  -- creează owner-membership automat la INSERT). NU rulăm SET CONSTRAINTS
  -- IMMEDIATE aici — păstrăm checkurile queued, ca să le evaluăm o singură dată
  -- la sfârșit, după operația răutăcioasă, pe starea finală.
  insert into auth.users (id, email) values (v_other_owner, 'g64-other-owner@test.invalid')
    on conflict (id) do nothing;
  insert into public.profiles (id, email, full_name)
    values (v_other_owner, 'g64-other-owner@test.invalid', 'G64 Other')
    on conflict (id) do nothing;
  insert into public.restaurants (id, owner_id, name, slug, primary_color)
    values (v_other_rid, v_other_owner, 'G64 Other', 'g64-other', '#000000');

  -- Operația răutăcioasă: șterge owner-ul a604 (creat de bootstrap) și mută
  -- owner-membership-ul a602 în a604, setând user_id = owner_id-ul a604 ca
  -- alinierea pe a604 să fie OK. Atunci A SINGURĂ ramură ruptă rămâne a602
  -- (singleton, count=0) — exact ramura pe care fix-ul OLD+NEW o prinde.
  delete from public.restaurant_memberships
   where restaurant_id = v_other_rid and role = 'owner'::public.member_role;
  update public.restaurant_memberships
     set restaurant_id = v_other_rid, user_id = v_other_owner
   where restaurant_id = '00000000-0000-4000-8000-00000000a602'
     and role = 'owner'::public.member_role;

  -- Acum: a602 are 0 owneri; a604 are 1 owner aliniat. Pre-fix, triggerul cu
  -- coalesce(NEW.restaurant_id, OLD.restaurant_id) ar verifica doar a604 → OK
  -- și ar lăsa a602 nedetectat. Post-fix, iterează peste OLD ∪ NEW distinct și
  -- prinde a602 cu singleton 0.
  begin
    set constraints all immediate;
    raise exception 'G6.4 FAIL: deferred invariant did not fire on OLD-restaurant break after UPDATE move';
  exception
    when check_violation then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'invariant:owner_membership_singleton' then
        raise exception 'G6.4 FAIL: wrong hint=% (expected invariant:owner_membership_singleton on OLD restaurant)', v_hint;
      end if;
    when others then
      raise exception 'G6.4 FAIL: unexpected SQLSTATE %', sqlstate;
  end;
  raise notice 'G6.4 PASS: deferred invariant validates BOTH OLD and NEW restaurant_id on UPDATE move';
end$$;
rollback to savepoint g64;
rollback;

-- ═══════════════════════ G7. 7 RPC-uri EXECUTE matrix intactă ════════════════
do $$
declare v_role text; v_fn text; v_should boolean; v_actual boolean; v_proc regprocedure;
  v_all text[] := array[
    'public.preview_invite(text)','public.accept_invite(text)',
    'public.create_restaurant(text,text,text,text)',
    'public.change_member_role(uuid,public.member_role)',
    'public.remove_member(uuid)','public.revoke_invite(uuid)',
    'public.change_restaurant_slug(uuid,text)'];
begin
  -- toate cele 7 există
  foreach v_fn in array v_all loop
    if to_regprocedure(v_fn) is null then raise exception 'G7 FAIL: % missing', v_fn; end if;
  end loop;
  -- PUBLIC EXECUTE zero
  foreach v_fn in array v_all loop
    v_proc := v_fn::regprocedure;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) ae
                where p.oid = v_proc and ae.grantee=0 and ae.privilege_type='EXECUTE') then
      raise exception 'G7 FAIL: PUBLIC retains EXECUTE on %', v_fn;
    end if;
  end loop;
  -- matrix
  for v_role, v_fn, v_should in
    select * from (values
      ('anon','public.preview_invite(text)',true),
      ('authenticated','public.preview_invite(text)',true),
      ('service_role','public.preview_invite(text)',false),
      ('anon','public.accept_invite(text)',false),
      ('authenticated','public.accept_invite(text)',true),
      ('service_role','public.accept_invite(text)',false),
      ('anon','public.create_restaurant(text,text,text,text)',false),
      ('authenticated','public.create_restaurant(text,text,text,text)',true),
      ('service_role','public.create_restaurant(text,text,text,text)',false),
      ('anon','public.change_member_role(uuid,public.member_role)',false),
      ('authenticated','public.change_member_role(uuid,public.member_role)',true),
      ('service_role','public.change_member_role(uuid,public.member_role)',false),
      ('anon','public.remove_member(uuid)',false),
      ('authenticated','public.remove_member(uuid)',true),
      ('service_role','public.remove_member(uuid)',false),
      ('anon','public.revoke_invite(uuid)',false),
      ('authenticated','public.revoke_invite(uuid)',true),
      ('service_role','public.revoke_invite(uuid)',false),
      ('anon','public.change_restaurant_slug(uuid,text)',false),
      ('authenticated','public.change_restaurant_slug(uuid,text)',true),
      ('service_role','public.change_restaurant_slug(uuid,text)',false)
    ) m(rl, fn, should)
  loop
    v_actual := has_function_privilege(v_role, v_fn::regprocedure, 'EXECUTE');
    if v_actual <> v_should then
      raise exception 'G7 FAIL: % on % expected=% actual=%', v_role, v_fn, v_should, v_actual;
    end if;
  end loop;
  raise notice 'G7 PASS: 7 RPCs EXECUTE matrix intact + PUBLIC zero';
end$$;

-- ═══════════════════════ G8. A6 validated (convalidated + 3 cazuri) ══════════
\ir assertions/a6_invite_owner_constraint_validated.sql


-- ═══════════════════════ G9. change_member_role, cale POZITIVĂ (fostul F4.1) ═════
-- Mutat VERBATIM din `authorization_final_state_assertions.sql` (ȘTEARSĂ în audit
-- v3 RES-07: `if:`-ul ei — hashFiles(096b)!='' && hashFiles(096c)=='' — era permanent
-- fals din iunie 2026, iar F1/F3 nu mai treceau pe lanțul curent). E singurul test
-- COMPORTAMENTAL care rulează un RPC de autorizare sub rolul REAL `authenticated`
-- și verifică apoi că a SCRIS efectiv — poarta read-only
-- (tests/sql/privilege_regime_assertions.sql) nu poate face asta, fiindcă mută
-- date. F4.2 (bootstrap-ul create_restaurant) NU a fost mutat: G6.2 îl acoperă.
-- G9: change_member_role waiter→kitchen pe …a603 (membership existent în fixture)
begin;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a601';
set local role authenticated;
do $$
declare v_mid uuid; v_resp jsonb; v_role public.member_role;
begin
  select id into v_mid from public.restaurant_memberships
   where restaurant_id = '00000000-0000-4000-8000-00000000a602'
     and user_id       = '00000000-0000-4000-8000-00000000a603';
  v_resp := public.change_member_role(v_mid, 'kitchen'::public.member_role);
  if not (v_resp->>'ok')::boolean then raise exception 'G9 FAIL: resp=%', v_resp; end if;
  select role into v_role from public.restaurant_memberships where id = v_mid;
  if v_role <> 'kitchen'::public.member_role then
    raise exception 'G9 FAIL: role after=%', v_role;
  end if;
  raise notice 'G9 PASS: change_member_role waiter→kitchen via RPC';
end$$;
rollback;

-- ═══════════════════════ G10. change_restaurant_slug TOCTOU (fostul F9) ═══════════
-- Mutat VERBATIM din aceeași suită ștearsă (identificatorii f9_* → g10_*). Contractul
-- {ok:false, reason:'slug_taken', slug} nu era păzit de nimic altundeva
-- (`grep -ln slug_taken tests/sql/*.sql` întorcea DOAR suita ștearsă). Fără
-- handler-ul de unique_violation din mig 221, RPC-ul lasă 23505 brut să iasă la
-- client. Mută date, deci nu poate sta în poarta read-only.
-- ═══════════════════════ G10. change_restaurant_slug TOCTOU safety net ════════
--   Forțează unique_violation pe UPDATE-ul intern (printr-un trigger BEFORE
--   UPDATE care injectează un rând cu același slug) și asertă că funcția
--   returnează contractul {ok:false, reason:slug_taken, slug} în loc să lase
--   23505 să iasă către client. Acoperă fereastra TOCTOU dintre `exists` check
--   și UPDATE care nu poate fi eliminată single-statement.
do $$
declare v_resp jsonb;
        v_parasite uuid := gen_random_uuid();
        v_parasite_user uuid := gen_random_uuid();
        v_target_slug text := 'g10-toctou-' || substring(gen_random_uuid()::text, 1, 8);
        v_my uuid := '00000000-0000-4000-8000-00000000a602';
begin
  -- Preconditii fixture-ului existent + competitor user/profile
  insert into auth.users (id, email) values (v_parasite_user, 'f9-parasite@test.invalid')
    on conflict (id) do nothing;
  insert into public.profiles (id, email, full_name)
    values (v_parasite_user, 'f9-parasite@test.invalid', 'G10 Parasite')
    on conflict (id) do nothing;

  -- Trigger injection: la UPDATE-ul restaurantului țintă, inserează rândul
  -- competitor cu acelaşi slug → unique_violation.
  create or replace function pg_temp.g10_race_inject() returns trigger language plpgsql as $f$
  begin
    if NEW.slug = current_setting('app.g10_race_slug', true) then
      insert into public.restaurants (id, owner_id, name, slug, primary_color)
      values (
        current_setting('app.g10_race_parasite_id')::uuid,
        current_setting('app.g10_race_parasite_user')::uuid,
        'G10 Parasite Restaurant',
        NEW.slug,
        '#000000'
      );
    end if;
    return NEW;
  end$f$;

  perform set_config('app.g10_race_slug', v_target_slug, true);
  perform set_config('app.g10_race_parasite_id', v_parasite::text, true);
  perform set_config('app.g10_race_parasite_user', v_parasite_user::text, true);

  -- Conditional drop ca să nu emitem NOTICE inutil în CI dacă triggerul lipsea.
  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.restaurants'::regclass
       and tgname  = 'trg_g10_toctou_inject'
  ) then
    drop trigger trg_g10_toctou_inject on public.restaurants;
  end if;
  create trigger trg_g10_toctou_inject before update on public.restaurants
    for each row execute function pg_temp.g10_race_inject();

  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a601', true);
  v_resp := public.change_restaurant_slug(v_my, v_target_slug);

  drop trigger trg_g10_toctou_inject on public.restaurants;

  -- Contractul trebuie să fie EXACT {ok:false, reason:slug_taken, slug:v_target_slug}.
  -- `IS DISTINCT FROM` pe jsonb întreg e null-safe (cheile lipsă nu mai produc NULL).
  if v_resp is distinct from jsonb_build_object(
    'ok',     false,
    'reason', 'slug_taken',
    'slug',   v_target_slug
  ) then
    raise exception 'G10 FAIL: TOCTOU race response=% (expected {ok:false, reason:slug_taken, slug:%})',
      v_resp, v_target_slug;
  end if;

  -- Cleanup (parasite row a fost inserat în loc, restaurantul țintă neschimbat)
  delete from public.restaurants where id = v_parasite;
  delete from public.profiles  where id = v_parasite_user;
  delete from auth.users       where id = v_parasite_user;

  raise notice 'G10 PASS: change_restaurant_slug TOCTOU race → {ok:false, reason:slug_taken, slug:%}', v_target_slug;
end$$;

\echo '✅ phase-1C assertions passed (G1-G10)'

-- tests/sql/auto/315_create_restaurant_idempotency.sql
-- =============================================================================
-- CI1–CI5 — clichetul PERMANENT al mig 315: `create_restaurant` idempotent pe
-- (proprietar, cheie). Rulează din tests/sql/auto/ pe AMBELE medii. Autonom,
-- ROLLBACK la final. Apelurile se fac SUB rolul REAL `authenticated`
-- (`set local role` + `request.jwt.claim.sub`), ca grant-urile să conteze.
--
--   CI1  aceeași cheie de două ori → ACELAȘI id și slug, `replayed: true` la a
--        doua, UN SINGUR rând în `restaurants`.
--        [PICĂ: lookup-ul scos (al doilea apel creează alt rând, cu alt slug)]
--   CI2  a doua cerere cu aceeași cheie trece și când limita de plan e ATINSĂ
--        (free = 1 local): replay-ul nu inserează, deci nu lovește
--        `enforce_restaurant_limit`. Control: o cheie NOUĂ pe același cont e
--        respinsă de limită (altfel CI2 n-ar dovedi nimic).
--        [PICĂ: lookup-ul mutat după insert]
--   CI3  cheia e scopată pe proprietar: aceeași cheie la alt cont creează un
--        rând NOU (nu întoarce locația altcuiva).
--        [PICĂ: lookup-ul fără `owner_id = v_uid`]
--   CI4  fără cheie (apelurile vechi cu 4 argumente) → comportamentul 221:
--        două apeluri cu același nume = două rânduri, slug-uri diferite.
--   CI5  suprafața, pe catalog: O SINGURĂ semnătură (5 argumente), DEFINER,
--        `public, pg_temp`; anon și service_role fără EXECUTE; handler-ul de
--        cursă distinge constrângerea pe cheie (structural — cursa a două
--        sesiuni concurente nu se poate exersa in-process).
--        [PICĂ: overload vechi lăsat în urmă (PGRST203); handler fără numele
--         indexului]
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('31500000-0000-4000-8000-0000000000a1', 'ci-a@ci315.test'),
  ('31500000-0000-4000-8000-0000000000b1', 'ci-b@ci315.test'),
  ('31500000-0000-4000-8000-0000000000c1', 'ci-c@ci315.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'ci-%@ci315.test'
  on conflict (id) do nothing;
-- A și C pe enterprise (fără limită practică), B pe free (1 local).
update public.profiles set plan = 'enterprise'
 where id in ('31500000-0000-4000-8000-0000000000a1', '31500000-0000-4000-8000-0000000000c1');
update public.profiles set plan = 'free' where id = '31500000-0000-4000-8000-0000000000b1';

-- ── CI1 + CI3 + CI4 (A, apoi C) ─────────────────────────────────────────────
set local request.jwt.claim.sub = '31500000-0000-4000-8000-0000000000a1';
set local role authenticated;
do $$
declare
  k  uuid := '315c0000-0000-4000-8000-0000000000aa';
  r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
begin
  r1 := public.create_restaurant('CI Bistro', null, null, '#C8963C', k);
  r2 := public.create_restaurant('CI Bistro', null, null, '#C8963C', k);
  if (r1->>'restaurant_id') is distinct from (r2->>'restaurant_id')
     or (r1->>'restaurant_slug') is distinct from (r2->>'restaurant_slug') then
    raise exception 'CI1 FAIL: aceeași cheie a dat locații diferite: % / %', r1, r2;
  end if;
  if (r2->>'replayed') is distinct from 'true' then
    raise exception 'CI1 FAIL: al doilea apel nu e marcat replayed: %', r2;
  end if;
  if (r1 ? 'replayed') then
    raise exception 'CI1 FAIL: prima creare marcată replayed: %', r1;
  end if;

  -- CI4: fără cheie, comportamentul vechi — două rânduri, slug-uri diferite.
  r3 := public.create_restaurant('CI Fara Cheie');
  r4 := public.create_restaurant('CI Fara Cheie');
  if (r3->>'restaurant_id') = (r4->>'restaurant_id')
     or (r3->>'restaurant_slug') = (r4->>'restaurant_slug') then
    raise exception 'CI4 FAIL: fără cheie, două apeluri au dat același rând: % / %', r3, r4;
  end if;
end $$;
reset role;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.restaurants
   where owner_id = '31500000-0000-4000-8000-0000000000a1' and name = 'CI Bistro';
  if v_n <> 1 then
    raise exception 'CI1 FAIL: % rânduri pentru aceeași cheie (aștept 1)', v_n;
  end if;
  raise notice 'CI1 PASS: aceeași cheie → aceeași locație, un singur rând';
  raise notice 'CI4 PASS: fără cheie → comportamentul 221 neschimbat';
end $$;

set local request.jwt.claim.sub = '31500000-0000-4000-8000-0000000000c1';
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.create_restaurant('CI Bistro', null, null, '#C8963C',
                                '315c0000-0000-4000-8000-0000000000aa');
  if (r ? 'replayed') then
    raise exception 'CI3 FAIL: cheia altui proprietar a întors locația lui A: %', r;
  end if;
end $$;
reset role;
do $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.restaurants
   where name = 'CI Bistro' and owner_id = '31500000-0000-4000-8000-0000000000c1';
  if v_owner is null then
    raise exception 'CI3 FAIL: C nu are propria locație cu aceeași cheie';
  end if;
  raise notice 'CI3 PASS: cheia e scopată pe proprietar';
end $$;

-- ── CI2 (B, plan free = 1 local) ────────────────────────────────────────────
set local request.jwt.claim.sub = '31500000-0000-4000-8000-0000000000b1';
set local role authenticated;
do $$
declare
  k  uuid := '315c0000-0000-4000-8000-0000000000bb';
  r1 jsonb; r2 jsonb; v_refused boolean := false;
begin
  r1 := public.create_restaurant('CI Free', null, null, '#C8963C', k);
  -- Limita e acum atinsă; replay-ul NU are voie să lovească limita.
  r2 := public.create_restaurant('CI Free', null, null, '#C8963C', k);
  if (r1->>'restaurant_id') is distinct from (r2->>'restaurant_id') then
    raise exception 'CI2 FAIL: replay-ul pe limită a dat alt id: % / %', r1, r2;
  end if;
  -- Control: o cheie NOUĂ chiar e respinsă de limită.
  begin
    perform public.create_restaurant('CI Free 2', null, null, '#C8963C',
                                     '315c0000-0000-4000-8000-0000000000bc');
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'CI2 FAIL (control): limita free nu a respins o locație nouă';
  end if;
  raise notice 'CI2 PASS: replay-ul ocolește limita de plan, o creare nouă nu';
end $$;
reset role;

-- ── CI5 (catalog) ───────────────────────────────────────────────────────────
do $$
declare v_n int; v_proc regprocedure; v_cfg text; v_def text;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_restaurant';
  if v_n <> 1 then
    raise exception 'CI5 FAIL: % semnături create_restaurant (PGRST203 la orice apel)', v_n;
  end if;
  v_proc := to_regprocedure('public.create_restaurant(text,text,text,text,uuid)');
  if v_proc is null then
    raise exception 'CI5 FAIL: semnătura cu p_idempotency_key lipsește';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = v_proc) then
    raise exception 'CI5 FAIL: create_restaurant nu e SECURITY DEFINER';
  end if;
  select lower(regexp_replace(coalesce(array_to_string(p.proconfig, ','), ''), '[[:space:]]+', '', 'g'))
    into v_cfg from pg_proc p where p.oid = v_proc;
  if v_cfg !~ '(^|,)search_path=public,pg_temp(,|$)' then
    raise exception 'CI5 FAIL: proconfig=%', v_cfg;
  end if;
  if has_function_privilege('anon', v_proc, 'execute')
     or has_function_privilege('service_role', v_proc, 'execute') then
    raise exception 'CI5 FAIL: anon/service_role au EXECUTE pe create_restaurant';
  end if;
  if not has_function_privilege('authenticated', v_proc, 'execute') then
    raise exception 'CI5 FAIL: authenticated fără EXECUTE pe create_restaurant';
  end if;
  v_def := pg_get_functiondef(v_proc);
  if position('restaurants_owner_create_key_uidx' in v_def) = 0
     or position('when unique_violation then' in v_def) = 0 then
    raise exception 'CI5 FAIL: handler-ul nu distinge coliziunea pe cheie de cea pe slug';
  end if;
  raise notice 'CI5 PASS: o semnătură, DEFINER, public+pg_temp, doar authenticated';
end $$;

rollback;

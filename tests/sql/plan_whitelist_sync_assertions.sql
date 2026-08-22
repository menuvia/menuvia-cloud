-- tests/sql/plan_whitelist_sync_assertions.sql
-- =============================================================================
-- Sincronizarea whitelist-urilor de plan (audit aug 2026): taxonomia
-- free/starter/growth/pro/enterprise trăiește în mai multe locuri ținute
-- sincron doar prin memorie umană (capcana din CLAUDE.md). Aici o înghețăm în
-- CI pe partea de DB — o valoare adăugată/scoasă doar într-un loc pică roșu.
--
--   PW1  CHECK-ul profiles_plan_check conține EXACT taxonomia canonică.
--   PW2  plan_limits are exact un rând per plan canonic (gating-ul de limite
--        nu poate avea găuri sau planuri-fantomă).
--   PW3  plan_features nu referă niciun plan din afara taxonomiei.
--
-- Frontend-ul (PLAN_LABELS→PLAN_NAMES) e sincronizat prin derivare directă
-- din aceeași sursă (lib/features.ts, refactor aug 2026) + features.test.ts.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_canon  text[] := array['free','starter','growth','pro','enterprise'];
  v_check  text;
  v_bad    text;
  v_missing text;
  v_cnt    int;
begin
  -- ── PW1: CHECK-ul de pe profiles.plan ──────────────────────────────────────
  select pg_get_constraintdef(c.oid) into v_check
    from pg_constraint c
   where c.conname = 'profiles_plan_check'
     and c.conrelid = 'public.profiles'::regclass;
  if v_check is null then
    raise exception 'PW1 FAIL: constraint-ul profiles_plan_check lipsește'; end if;

  -- Fiecare plan canonic apare în definiție; nicio valoare-fantomă cunoscută.
  foreach v_missing in array v_canon loop
    if position('''' || v_missing || '''' in v_check) = 0 then
      raise exception 'PW1 FAIL: planul canonic % lipsește din profiles_plan_check (%)', v_missing, v_check;
    end if;
  end loop;
  if position('''business''' in v_check) > 0 then
    raise exception 'PW1 FAIL: taxonomia moartă ''business'' a reapărut în CHECK'; end if;
  raise notice 'PW1 OK: profiles_plan_check conține exact taxonomia canonică';

  -- ── PW2: plan_limits acoperă exact taxonomia ───────────────────────────────
  select count(*) into v_cnt from public.plan_limits where plan = any(v_canon);
  if v_cnt <> array_length(v_canon, 1) then
    raise exception 'PW2 FAIL: plan_limits are % din % planuri canonice', v_cnt, array_length(v_canon, 1);
  end if;
  select plan into v_bad from public.plan_limits where plan <> all(v_canon) limit 1;
  if v_bad is not null then
    raise exception 'PW2 FAIL: plan_limits conține planul-fantomă %', v_bad; end if;
  raise notice 'PW2 OK: plan_limits = exact un rând per plan canonic';

  -- ── PW3: plan_features nu are planuri-fantomă ──────────────────────────────
  select plan into v_bad from public.plan_features where plan <> all(v_canon) limit 1;
  if v_bad is not null then
    raise exception 'PW3 FAIL: plan_features conține planul-fantomă %', v_bad; end if;
  raise notice 'PW3 OK: plan_features referă doar taxonomia canonică';
end $$;

select 'PLAN WHITELIST SYNC ASSERTIONS: PW1–PW3 PASS' as result;

rollback;

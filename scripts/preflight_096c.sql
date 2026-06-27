-- scripts/preflight_096c.sql
-- =============================================================================
-- READ-ONLY pre-flight diagnostic pentru mig 096C (Authorization Lockdown PR 1C).
-- Rulează ÎNAINTE de a aplica 096C în producție.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/preflight_096c.sql
--
-- Safety:
--   - 100% READ-ONLY: zero INSERT/UPDATE/DELETE/ALTER/CREATE/DROP.
--   - Idempotent. Poate fi rulat de oricâte ori, paralel cu trafic în prod.
--   - Necesită SELECT pe pg_catalog + tabele publice (orice rol DB cu read suficient).
--
-- Go/no-go semantics:
--   - Orice `RAISE EXCEPTION` = NO-GO. Nu aplica 096C până nu rezolvi cauza.
--   - `RAISE NOTICE 'WARNING: ...'` = MOSTLY-GO, dar bump `statement_timeout`
--      pentru fereastra de apply (sau aplică în maintenance window).
--   - `RAISE NOTICE 'PRE-FLIGHT OK: 096C is safe to apply'` la final = GO.
-- =============================================================================

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- Sec 1. Ownership invariant — trebuie deja curat (095B l-a impus la merge)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_anomalies int;
begin
  select count(*) into v_anomalies
  from public.restaurants r
  where (
    select count(*) from public.restaurant_memberships rm
     where rm.restaurant_id = r.id and rm.role = 'owner'::public.member_role
  ) <> 1
     or not exists (
       select 1 from public.restaurant_memberships rm
        where rm.restaurant_id = r.id
          and rm.role = 'owner'::public.member_role
          and rm.user_id = r.owner_id
     );
  raise notice '[Sec 1] ownership invariant: % anomaly restaurants', v_anomalies;
  if v_anomalies > 0 then
    raise exception 'NO-GO: % restaurants have inconsistent owner state. Run scripts/report_ownership_anomalies.sql to triage, then scripts/apply_ownership_remediation.sql with operator-approved input. Re-run this pre-flight afterwards.',
      v_anomalies;
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sec 2. Archive workload — DELETE-RETURNING + INSERT sub statement_timeout=120s
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_owner_rows bigint;
begin
  select count(*) into v_owner_rows
    from public.invite_tokens
   where role = 'owner'::public.member_role;
  raise notice '[Sec 2] owner-invite rows to archive: %', v_owner_rows;
  if v_owner_rows > 10000 then
    raise notice 'WARNING: % owner-invite rows exceed the 10k threshold. The atomic DELETE+INSERT into archive may exceed the 120s statement_timeout in 096C. Recommendation: SET LOCAL statement_timeout to a larger value within a session before applying 096C, or apply in a low-traffic window.',
      v_owner_rows;
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sec 3. VALIDATE CONSTRAINT scan estimate — full seqscan al `invite_tokens`
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_size text; v_size_bytes bigint; v_total bigint;
begin
  select pg_relation_size('public.invite_tokens'),
         pg_size_pretty(pg_relation_size('public.invite_tokens'))
    into v_size_bytes, v_size;
  select count(*) into v_total from public.invite_tokens;
  raise notice '[Sec 3] invite_tokens: % rows, on-disk %', v_total, v_size;
  if v_size_bytes > 1024 * 1024 * 1024 or v_total > 5000000 then
    raise notice 'WARNING: invite_tokens is large (size=%, rows=%). VALIDATE CONSTRAINT does a full sequential scan and may exceed the 120s statement_timeout in 096C. Recommendation: SET LOCAL statement_timeout to e.g. 30min for the apply session.',
      v_size, v_total;
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sec 4. Lock contention — alți deținători de lock-uri pe tabelele atinse
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record; v_count int := 0;
begin
  for r in
    select n.nspname || '.' || c.relname as relname,
           l.mode,
           l.pid,
           a.application_name,
           a.usename,
           a.state
      from pg_locks l
      join pg_class c on c.oid = l.relation
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_stat_activity a on a.pid = l.pid
     where l.pid <> pg_backend_pid()
       and n.nspname = 'public'
       and c.relname in ('restaurants','restaurant_memberships','invite_tokens','profiles')
       and l.granted
       and l.mode not in ('AccessShareLock','RowShareLock')
  loop
    v_count := v_count + 1;
    raise notice '[Sec 4] contention: rel=% mode=% pid=% app=% user=% state=%',
      r.relname, r.mode, r.pid, r.application_name, r.usename, r.state;
  end loop;
  raise notice '[Sec 4] contending lock holders: % (096C takes SHARE ROW EXCLUSIVE; will queue behind anything stronger than ROW SHARE)', v_count;
  if v_count > 0 then
    raise notice 'WARNING: pre-existing locks may delay 096C lock acquisition. lock_timeout=10s in the migration will abort the transaction if not released in time. Consider waiting until contention clears, or coordinate a maintenance window.';
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sec 5. Constraint + trigger pre-state — confirmă că 096A/B au rulat și 096C nu
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_constraint record; v_block_guard int; v_owner_id_guard int; v_archive int;
begin
  -- invite_tokens_role_not_owner trebuie să existe ȘI să fie NOT VALID (NU convalidated)
  select c.convalidated, c.contype into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.invite_tokens'::regclass
     and c.conname  = 'invite_tokens_role_not_owner';
  if not found then
    raise exception 'NO-GO: invite_tokens_role_not_owner CONSTRAINT missing. Did 096A run? Check supabase/migrations/20260615000000_migration_096a_authorization_foundation.sql.';
  end if;
  if v_constraint.contype <> 'c' then
    raise exception 'NO-GO: invite_tokens_role_not_owner has wrong contype=% (expected ''c'')', v_constraint.contype;
  end if;
  if v_constraint.convalidated then
    raise exception 'NO-GO: invite_tokens_role_not_owner is already convalidated=true. 096C only makes sense when it is NOT VALID. Either 096C already ran, or someone manually validated. Investigate before proceeding.';
  end if;
  raise notice '[Sec 5a] invite_tokens_role_not_owner exists, NOT VALID — OK';

  -- trg_block_owner_membership_mutation TREBUIE să fie prezent (096C îl va drop-ui)
  select count(*) into v_block_guard from pg_trigger
   where tgname = 'trg_block_owner_membership_mutation'
     and tgrelid = 'public.restaurant_memberships'::regclass
     and not tgisinternal;
  if v_block_guard <> 1 then
    raise exception 'NO-GO: trg_block_owner_membership_mutation count=% (expected 1). Either 096A did not run, 096C has already partly run, or someone manually dropped the guard. Investigate before proceeding.', v_block_guard;
  end if;
  raise notice '[Sec 5b] trg_block_owner_membership_mutation present (will be dropped by 096C) — OK';

  -- trg_restaurants_owner_id_immutable TREBUIE să rămână prezent (096C NU îl atinge)
  select count(*) into v_owner_id_guard from pg_trigger
   where tgname = 'trg_restaurants_owner_id_immutable'
     and tgrelid = 'public.restaurants'::regclass
     and not tgisinternal;
  if v_owner_id_guard <> 1 then
    raise exception 'NO-GO: trg_restaurants_owner_id_immutable count=% (expected 1). 096A may not have run, or trigger was manually dropped — DO NOT apply 096C without this trigger because the deferred invariant relies on owner_id being immutable.', v_owner_id_guard;
  end if;
  raise notice '[Sec 5c] trg_restaurants_owner_id_immutable present (must remain after 096C) — OK';

  -- archive.invite_tokens_owner_history NU trebuie să existe încă
  select count(*) into v_archive from pg_namespace n
    left join pg_class c on c.relnamespace = n.oid and c.relname = 'invite_tokens_owner_history'
   where n.nspname = 'archive' and c.oid is not null;
  if v_archive > 0 then
    raise exception 'NO-GO: archive.invite_tokens_owner_history already exists. 096C may have already run partially, or someone manually created it. Investigate before proceeding.';
  end if;
  raise notice '[Sec 5d] archive.invite_tokens_owner_history absent (will be created by 096C) — OK';
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sec 6. Final go/no-go
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  raise notice '════════════════════════════════════════════════════════════';
  raise notice 'PRE-FLIGHT OK: 096C is safe to apply';
  raise notice '════════════════════════════════════════════════════════════';
end$$;

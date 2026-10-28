-- tests/sql/auto/000_auto_runner_canary.sql
-- =============================================================================
-- AR0: canarul rulării automate din tests/sql/auto/ (scripts/run-sql-auto.sh).
-- Garantează că directorul nu e gol (runner-ul pică pe director gol) și verifică
-- ceva ADEVĂRAT și portant pe AMBELE medii (Postgres gol din sql-verify și
-- stack-ul Supabase real din E2E): contractul sondei de schemă din /health
-- (mig 271), de care depinde și aplicarea automată pe producție (PR-0) —
-- `get_schema_version(manifest).missing = []` e poarta ei finală.
--   • există, cu semnătura (text[]), întoarce jsonb;
--   • SECURITY DEFINER cu search_path fixat (service_role n-are USAGE pe
--     schema ledger-ului — INVOKER ar fi o sondă moartă, SV5);
--   • anon NU o poate apela (volumul de migrații nu e suprafață publică);
--   • forma e cele 5 chei înghețate (BC5), cu sau fără ledger.
-- Control POZITIV: service_role (apelantul real, /health) o POATE apela.
-- =============================================================================
do $$
declare
  v_fn regprocedure := to_regprocedure('public.get_schema_version(text[])');
  v_keys text;
begin
  if v_fn is null then
    raise exception 'AR0 FAIL: public.get_schema_version(text[]) lipsește';
  end if;
  if not (select prosecdef from pg_proc where oid = v_fn) then
    raise exception 'AR0 FAIL: get_schema_version nu e SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where oid = v_fn
                  and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') then
    raise exception 'AR0 FAIL: get_schema_version fără search_path = public, pg_temp';
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'AR0 FAIL: anon poate apela get_schema_version';
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'AR0 FAIL (control pozitiv): service_role nu poate apela get_schema_version';
  end if;
  select string_agg(k, ',' order by k collate "C") into v_keys
    from jsonb_object_keys(public.get_schema_version(array['__ar0_inexistent__'])) k;
  if v_keys is distinct from 'available,latest_name,latest_version,ledger_count,missing' then
    raise exception 'AR0 FAIL: forma sondei s-a schimbat: %', v_keys;
  end if;
  raise notice 'AR0 OK: rularea automată din tests/sql/auto e vie; sonda de schemă respectă contractul';
end$$;

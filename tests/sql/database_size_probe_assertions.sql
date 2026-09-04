-- tests/sql/database_size_probe_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 266 (`get_database_size`), sonda de stocare din
-- /health. Self-contained, ROLLBACK la final.
--
--   DB1  Funcția întoarce forma așteptată: `bytes` întreg pozitiv, `pretty` text,
--        `top_tables` array.
--   DB2  Suprafața e EXCLUSIV service_role — anon și authenticated nu pot executa.
--   DB3  E SECURITY INVOKER, nu DEFINER (service_role are deja privilegiul;
--        DEFINER ar fi o escaladare inutilă) și are pg_temp în search_path.
--   DB4  `top_tables` conține doar tabele din schema `public` și e ordonat
--        descrescător — altfel alerta vine fără diagnostic util.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── DB1: forma răspunsului ──────────────────────────────────────────────────
do $$
declare v jsonb; v_b numeric;
begin
  v := public.get_database_size();
  if v is null or jsonb_typeof(v) <> 'object' then
    raise exception 'DB1 FAIL: get_database_size nu întoarce un obiect jsonb'; end if;
  if jsonb_typeof(v->'bytes') <> 'number' then
    raise exception 'DB1 FAIL: `bytes` nu e număr (%)', jsonb_typeof(v->'bytes'); end if;
  v_b := (v->>'bytes')::numeric;
  if v_b is null or v_b <= 0 then
    raise exception 'DB1 FAIL: `bytes` = % (așteptat pozitiv)', v_b; end if;
  if jsonb_typeof(v->'pretty') <> 'string' then
    raise exception 'DB1 FAIL: `pretty` nu e string'; end if;
  if jsonb_typeof(v->'top_tables') <> 'array' then
    raise exception 'DB1 FAIL: `top_tables` nu e array'; end if;
  raise notice 'DB1 OK: forma răspunsului e corectă (% octeți)', v_b;
end $$;

-- ── DB2: suprafața e doar service_role ──────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.get_database_size()', 'EXECUTE') then
    raise exception 'DB2 FAIL: anon poate executa get_database_size'; end if;
  if has_function_privilege('authenticated', 'public.get_database_size()', 'EXECUTE') then
    raise exception 'DB2 FAIL: authenticated poate executa get_database_size'; end if;
  if not has_function_privilege('service_role', 'public.get_database_size()', 'EXECUTE') then
    raise exception 'DB2 FAIL: service_role NU poate executa get_database_size'; end if;
  raise notice 'DB2 OK: EXECUTE exclusiv pentru service_role';
end $$;

-- ── DB3: INVOKER + search_path ──────────────────────────────────────────────
do $$
declare v_secdef boolean; v_cfg text;
begin
  select p.prosecdef, array_to_string(p.proconfig, ',')
    into v_secdef, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_database_size';
  if v_secdef then
    raise exception 'DB3 FAIL: a devenit SECURITY DEFINER — escaladare inutilă'; end if;
  if v_cfg is null or position('pg_temp' in v_cfg) = 0 then
    raise exception 'DB3 FAIL: lipsește pg_temp din search_path (cfg=%)', v_cfg; end if;
  raise notice 'DB3 OK: INVOKER, search_path cu pg_temp';
end $$;

-- ── DB4: top_tables e util (public, descrescător) ───────────────────────────
do $$
declare v jsonb; r record; v_prev numeric := null; v_n int := 0;
begin
  v := public.get_database_size();
  for r in select * from jsonb_array_elements(v->'top_tables') as e(val) loop
    v_n := v_n + 1;
    if jsonb_typeof(r.val->'name') <> 'string' or jsonb_typeof(r.val->'bytes') <> 'number' then
      raise exception 'DB4 FAIL: intrare malformată în top_tables: %', r.val; end if;
    -- numele trebuie să existe ca tabel în `public` (nu din alte scheme)
    if to_regclass('public.' || quote_ident(r.val->>'name')) is null then
      raise exception 'DB4 FAIL: `%` nu e un tabel din schema public', r.val->>'name'; end if;
    if v_prev is not null and (r.val->>'bytes')::numeric > v_prev then
      raise exception 'DB4 FAIL: top_tables nu e ordonat descrescător'; end if;
    v_prev := (r.val->>'bytes')::numeric;
  end loop;
  if v_n = 0 then
    raise exception 'DB4 FAIL: top_tables e gol — alerta ar veni fără diagnostic'; end if;
  raise notice 'DB4 OK: % tabele, ordonate descrescător, toate din public', v_n;
end $$;

rollback;

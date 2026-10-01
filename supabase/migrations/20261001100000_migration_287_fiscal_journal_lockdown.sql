-- migration_287_fiscal_journal_lockdown.sql
-- =============================================================================
-- SC-1 + secretul Oblio: jurnalul fiscal si credentialele de facturare nu mai
-- pot fi scrise / citite direct de rolurile client.
--
-- (1) `pending_receipts` — mig 030 a dat `authenticated` UPDATE pe TOT tabelul,
--     sub politica FOR ALL `admin manage` (is_admin). Orice manager (si, prin
--     funelul is_admin, partener / fondator) putea prin PATCH sa rescrie
--     `payload` al unui bon `pending` (suma falsa la casa) sau sa puna
--     `status='success'` + un `bon_number` inventat (bon fals in jurnal, jeton
--     de idempotenta ocupat, mentiune falsa pe factura Oblio din 276).
--     Mig 270 a inchis DOAR tranzitia ->pending. Acum: REVOKE UPDATE (zid) +
--     trigger BEFORE UPDATE (backstop in DATE, impotriva unui GRANT viitor).
--     Verificat inainte (grep in tot lantul + src/ netlify/ bridge/): TOTI
--     scriitorii de UPDATE sunt RPC-uri SECURITY DEFINER (bridge_claim /
--     confirm / retry / cancel / force_resolve / mark_stale, 030->277); nicio
--     functie/trigger INVOKER si niciun client nu face UPDATE ca authenticated.
--     INSERT ramane (enqueue 259 il face ca authenticated pe INSERT-direct-paid
--     — rezidual consemnat in CLAUDE.md, neatins). SELECT ramane (BridgeTab).
--
-- (2) `oblio_configs.api_secret` era text in clar sub FOR ALL is_admin (041):
--     orice admin (inclusiv partener) il citea prin PostgREST. Acum SELECT pe
--     coloana e revocat pentru anon/authenticated (SELECT ramane pe celelalte
--     coloane, INSERT/UPDATE raman pe tot — owner/manager il SCRIE). Cititorii
--     SQL ai secretului (bridge_oblio_get_queued 041->276) sunt DEFINER, iar
--     oblio-generator.js ruleaza ca service_role — neatinse. Clientul afla
--     „configurat da/nu" din prezenta randului / `get_oblio_config_status`.
-- =============================================================================
begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ── 1. pending_receipts: zid de privilegiu ───────────────────────────────────
revoke update on public.pending_receipts from anon, authenticated;

-- ── 2. pending_receipts: backstop in DATE ────────────────────────────────────
-- NE-definer DELIBERAT (ca fn_pending_receipts_block_client_repend, 270): trebuie
-- sa vada rolul APELANTULUI; din RPC-urile DEFINER current_user = owner-ul lor.
create or replace function public.fn_pending_receipts_block_client_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Jurnalul fiscal nu se modifica direct din rolurile client — foloseste RPC-urile bridge_*'
      using errcode = '42501', hint = 'direct_receipt_update_forbidden';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_pending_receipts_block_client_update()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_pending_receipts_block_client_update on public.pending_receipts;
create trigger trg_pending_receipts_block_client_update
  before update on public.pending_receipts
  for each row
  execute function public.fn_pending_receipts_block_client_update();

comment on function public.fn_pending_receipts_block_client_update() is
  'mig 287 (SC-1): backstop in DATE — anon/authenticated nu pot UPDATE pe pending_receipts (payload/status/bon_number); doar RPC-urile DEFINER bridge_*. NE-definer deliberat.';

-- ── 3. oblio_configs: secretul nu mai e citibil de rolurile client ───────────
revoke select on public.oblio_configs from anon, authenticated;
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.oblio_configs'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname <> 'api_secret';
  execute 'grant select (' || v_cols || ') on public.oblio_configs to authenticated';
end $$;

-- ── 4. RPC de stare, fara secret ─────────────────────────────────────────────
create or replace function public.get_oblio_config_status(p_restaurant_id uuid)
returns table (configured boolean, api_email text, company_cif text, company_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_restaurant_id is null or not public.is_admin(p_restaurant_id) then
    raise exception 'Acces interzis' using errcode = '42501', hint = 'role_insufficient';
  end if;
  return query
    select true, oc.api_email, oc.company_cif, oc.company_name
      from public.oblio_configs oc
     where oc.restaurant_id = p_restaurant_id;
  if not found then
    return query select false, null::text, null::text, null::text;
  end if;
end;
$$;

revoke all on function public.get_oblio_config_status(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_oblio_config_status(uuid) to authenticated;

-- ── 5. Asertii fail-closed ───────────────────────────────────────────────────
do $$
declare v_role text; v_col text; v_tgtype int; v_n int;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.pending_receipts', 'UPDATE') then
      raise exception 'mig 287: % mai are UPDATE (tabel) pe pending_receipts', v_role; end if;
    foreach v_col in array array['payload', 'status', 'bon_number'] loop
      if has_column_privilege(v_role, 'public.pending_receipts', v_col, 'UPDATE') then
        raise exception 'mig 287: % mai are UPDATE pe pending_receipts.%', v_role, v_col; end if;
    end loop;
    if has_column_privilege(v_role, 'public.oblio_configs', 'api_secret', 'SELECT')
       or has_table_privilege(v_role, 'public.oblio_configs', 'SELECT') then
      raise exception 'mig 287: % mai poate citi oblio_configs.api_secret', v_role; end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.pending_receipts', 'INSERT')
     or not has_table_privilege('authenticated', 'public.pending_receipts', 'SELECT') then
    raise exception 'mig 287: INSERT/SELECT pe pending_receipts trebuiau sa ramana (259 / BridgeTab)'; end if;
  if not has_column_privilege('authenticated', 'public.oblio_configs', 'company_name', 'SELECT')
     or not has_column_privilege('authenticated', 'public.oblio_configs', 'api_secret', 'INSERT')
     or not has_column_privilege('authenticated', 'public.oblio_configs', 'api_secret', 'UPDATE') then
    raise exception 'mig 287: SELECT pe coloanele ne-secrete / INSERT+UPDATE pe api_secret trebuiau sa ramana'; end if;
  select tgtype into v_tgtype from pg_trigger
   where tgname = 'trg_pending_receipts_block_client_update'
     and tgrelid = 'public.pending_receipts'::regclass and not tgisinternal;
  if v_tgtype is distinct from 19 then
    raise exception 'mig 287: trigger-ul trebuie sa fie BEFORE UPDATE FOR EACH ROW (tgtype 19), este %', v_tgtype; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'fn_pending_receipts_block_client_update' and p.prosecdef) then
    raise exception 'mig 287: backstop-ul NU are voie sa fie DEFINER (ar ascunde rolul apelantului)'; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_oblio_config_status';
  if v_n <> 1 then raise exception 'mig 287: get_oblio_config_status are % semnaturi', v_n; end if;
  if has_function_privilege('anon', 'public.get_oblio_config_status(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.get_oblio_config_status(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_oblio_config_status(uuid)', 'EXECUTE') then
    raise exception 'mig 287: matricea EXECUTE pe get_oblio_config_status e gresita'; end if;
  raise notice 'mig 287 OK: jurnal fiscal fara UPDATE client + backstop; oblio_configs.api_secret ascuns';
end $$;

commit;

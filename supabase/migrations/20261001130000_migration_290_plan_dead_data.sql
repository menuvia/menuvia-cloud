-- migration_290_plan_dead_data.sql
-- =============================================================================
-- Mesajele de plan fără numele INTERNE + datele de plan moarte (PR 4 „prețuri
-- adevărate", partea de DB).
--
-- ── A. Mesajele gate-urilor de plan ──────────────────────────────────────────
-- Regula 4 din CLAUDE.md: numele comerciale (Meniu Digital / Meniu + Comenzi /
-- Fiscalizare) DOAR în UI; intern rămân free/starter/growth/pro/enterprise. Dar
-- textul unei excepții ajunge la utilizator (PostgREST îl întoarce în
-- `message`, iar clientul îl afișează: `createOrder` aruncă un `Error` real cu
-- el — oaspetele din meniul QR vedea „Comenzile nu sunt disponibile pe planul
-- curent (free). Upgrade la Growth sau mai sus."). Măsurat pe replay prin
-- DESCOPERIRE (orice `raise exception` din `public` care pomenește un nume de
-- plan sau interpolează o variabilă de plan): exact NOUĂ funcții, toate gate-uri
-- de plan, niciuna nu e `advance_order` (al cărei mesaj vorbește despre „planul
-- cu fiscalizare", fără nume intern — rămâne neatins, o recreează mig 291):
--
--   enforce_ordering_enabled        'Upgrade la Growth' + (v_plan)   hint plan_upgrade_required
--   enforce_feature_for_restaurant  'Upgrade la Growth' + (v_plan)   hint feature_disabled
--   enforce_product_limit(_stmt)    'pentru planul %' (v_plan)       hint upgrade_plan / product_limit
--   enforce_table_limit(_stmt)      'pentru planul %' (v_plan)       hint upgrade_plan / table_limit
--   enforce_restaurant_limit        'pentru planul %' (v_plan)       hint upgrade_plan
--   enforce_team_member_limit(_stmt)'pentru planul %' (v_plan)       hint team_member_limit / plan_config_missing
--
-- Fiecare e recreată din DEFINIȚIA CURENTĂ (pg_get_functiondef pe replay-ul
-- lanțului până la 289 — include `search_path = public, pg_temp` pus de mig 262
-- prin ALTER, scris aici EXPLICIT fiindcă `create or replace` rescrie
-- `proconfig`). Se schimbă DOAR textul mesajului; corpul, lacătele, ordinea
-- verificărilor, ERRCODE-ul și HINT-ul sunt IDENTICE. Hint-ul e contractul
-- stabil (table-payment.js îl mapează la 403; PayTableSheet/SplitBillSheet pe
-- `feature_disabled`), textul e doar pentru om. Id-ul tehnic al funcției
-- (`p_feature`, ex. `fiscal_receipt`) RĂMÂNE în mesaj: nu e nume de plan, e
-- singura informație de diagnostic, și suitele PG/PR/batch3 se ancorează pe el.
-- `create or replace` păstrează ACL-urile (verificat în asserții).
--
-- ── B. Date de plan moarte (zero cititori, verificat 2026-10-05) ────────────
-- Cititorii căutați: src/, netlify/, tests/, bridge/, deploy/, scripts/, e2e/,
-- supabase/tests, workflow-urile, ȘI `prosrc` al TUTUROR funcțiilor vii de pe
-- replay + definițiile view-urilor + expresiile politicilor.
--
--   * `reserve_ai_import_slot(uuid,uuid)` / `check_ai_import_quota(uuid)` —
--     niciun apelant în tot istoricul git al lui netlify/ și src/ (`git log -S`):
--     cota AI reală e `ai_quota` (ai_can_use / ai_record_usage, mig 168/171),
--     IDENTICĂ pe toate planurile. Singurele mențiuni erau listele de privilegii
--     RP6 / AV4, actualizate în ACELAȘI PR (absența lor e acum asertată de
--     tests/sql/plan_dead_data_assertions.sql, PD4).
--   * `plan_limits.ai_imports_month` — citit EXCLUSIV de cele două funcții de mai
--     sus. Pagina de prețuri promitea „Import AI 2/lună" pe baza acestei coloane;
--     nicio cale nu o aplica.
--   * `plan_limits.features` (jsonb) — zero cititori SQL; clientul îl mapa în
--     `usePlanLimits` printr-un `select('*')`, iar singurul consumator,
--     `hasFeature`, nu avea apelanți. Clientul din acest PR cere o listă
--     EXPLICITĂ de coloane (prezente și înainte, și după) → ordinea de deploy e
--     liberă; un client vechi cu `select('*')` primește pur și simplu mai puține
--     chei (`features ?? []`).
--   * `plan_features` rândurile `ai_import` și `kitchen_dashboard` — nicio
--     funcție, view sau politică nu le citește (`restaurant_has_feature` /
--     `enforce_feature_for_restaurant` sunt chemate doar cu literali, niciunul
--     dintre aceștia doi); `get_restaurant_features` le trimitea clientului, care
--     nu le citea (doar le avea în uniunea `FeatureName`, scoase acum).
--     `reservations_revenue` e în aceeași situație după audit, dar NU era în
--     domeniul acestui PR — rămâne, consemnat.
--   NERELATE și LĂSATE: `log_ai_import` + tabela `ai_import_log` (la fel de fără
--   apelant, dar nu în listă — un DROP ar extinde suprafața PR-ului).
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ═════════════════════════════════════════════════════════════════════════════
-- A. Mesaje neutre (copii ale definițiilor curente; DOAR textul diferă)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── enforce_feature_for_restaurant (lanț 087 → ALTER 262 → 290) ─────────────
create or replace function public.enforce_feature_for_restaurant(p_restaurant_id uuid, p_feature text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_plan       text;
  v_enabled    boolean;
begin
  select
    coalesce(pr.plan, 'free'),
    coalesce(pf.enabled, false)
  into v_plan, v_enabled
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  left join public.plan_features pf
         on pf.plan = pr.plan and pf.feature = p_feature
  where r.id = p_restaurant_id;

  if not coalesce(v_enabled, false) then
    -- mig 290: fără numele intern al planului (regula 4). Hint-ul e contractul.
    raise exception
      'Funcția „%” nu e disponibilă pe planul curent al restaurantului. Funcția cere un plan superior.',
      p_feature
      using errcode = 'check_violation', hint = 'feature_disabled';
  end if;
end;
$function$;

-- ── enforce_ordering_enabled (lanț 014 → 083 → ALTER 262 → 290) ─────────────
create or replace function public.enforce_ordering_enabled()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_plan          text;
  v_feature       text;
  v_feature_on    boolean;
begin
  -- ── 1. Restaurant activ ──────────────────────────────────────────
  if not exists (
    select 1 from public.restaurants
    where id = new.restaurant_id
      and is_active = true
  ) then
    raise exception 'Restaurantul este dezactivat.'
      using errcode = 'check_violation';
  end if;

  -- ── 2. Plan-level feature gate ───────────────────────────────────
  -- Mapăm source → feature_name
  v_feature := case new.source::text
    when 'waiter'  then 'waiter_manual'
    when 'pickup'  then 'pickup_orders'
    else                'order_qr'       -- 'qr' + orice source viitor
  end;

  -- Obținem planul owner-ului și valoarea feature-ului
  select
    coalesce(pr.plan, 'free'),
    coalesce(pf.enabled, false)
  into v_plan, v_feature_on
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  left join public.plan_features pf
         on pf.plan = pr.plan and pf.feature = v_feature
  where r.id = new.restaurant_id;

  if not coalesce(v_feature_on, false) then
    -- mig 290: mesajul ajunge la OASPETE (meniul QR) — fără numele intern.
    raise exception
      'Comenzile nu sunt disponibile pe planul curent al restaurantului. Funcția cere un plan superior.'
      using errcode = 'check_violation', hint = 'plan_upgrade_required';
  end if;

  -- ── 3. Manual toggle ─────────────────────────────────────────────
  if exists (
    select 1 from public.restaurant_settings
    where restaurant_id = new.restaurant_id
      and ordering_enabled = false
  ) then
    raise exception 'Comenzile sunt oprite momentan pentru acest restaurant.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

-- ── enforce_product_limit (lanț 013 → 038 → ALTER 262 → 290) ────────────────
create or replace function public.enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_plan text;
  v_max  integer;
  v_count integer;
begin
  -- DB-001 FIX: Lock per restaurant_id pentru a preveni race în limit check.
  -- hashtext() convertește uuid::text la int8 pentru advisory lock.
  perform pg_advisory_xact_lock(hashtext('product_limit_' || new.restaurant_id::text));

  select public.owner_plan(new.restaurant_id) into v_plan;
  select max_products into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 15; end if;

  select count(*) into v_count
  from public.products where restaurant_id = new.restaurant_id;

  if v_count >= v_max then
    raise exception 'Limită produse atinsă: maxim % pe planul curent. Pentru mai multe e nevoie de un plan superior.', v_max
      using errcode = 'P0001', hint = 'upgrade_plan';
  end if;
  return new;
end;
$function$;

-- ── enforce_product_limit_stmt (lanț 126 → ALTER 262 → 290) ─────────────────
create or replace function public.enforce_product_limit_stmt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rec   record;
  v_plan  text;
  v_max   integer;
  v_count integer;
begin
  for v_rec in
    select distinct restaurant_id from new_rows
  loop
    -- Acelasi lock ca triggerul per-row (mig 038) — serializeaza inserturile concurente.
    perform pg_advisory_xact_lock(hashtext('product_limit_' || v_rec.restaurant_id::text));

    select public.owner_plan(v_rec.restaurant_id) into v_plan;
    select max_products into v_max
      from public.plan_limits
     where plan = coalesce(v_plan, 'free');
    if v_max is null then v_max := 15; end if;

    select count(*) into v_count
      from public.products
     where restaurant_id = v_rec.restaurant_id;

    if v_count > v_max then
      raise exception
        'Limită produse atinsă: maxim % pe planul curent. Pentru mai multe e nevoie de un plan superior.', v_max
        using errcode = 'P0001', hint = 'product_limit';
    end if;
  end loop;

  return null;  -- ignorat la AFTER ... FOR EACH STATEMENT
end;
$function$;

-- ── enforce_restaurant_limit (lanț 013 → 038 → ALTER 262 → 290) ─────────────
create or replace function public.enforce_restaurant_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_plan text;
  v_max  integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('restaurant_limit_' || new.owner_id::text));

  select plan into v_plan from public.profiles where id = new.owner_id;
  select max_restaurants into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 1; end if;

  select count(*) into v_count
  from public.restaurants where owner_id = new.owner_id;

  if v_count >= v_max then
    raise exception 'Limită restaurante atinsă: maxim % pe planul curent. Pentru mai multe e nevoie de un plan superior.', v_max
      using errcode = 'P0001', hint = 'upgrade_plan';
  end if;
  return new;
end;
$function$;

-- ── enforce_table_limit (lanț 013 → 038 → ALTER 262 → 290) ──────────────────
create or replace function public.enforce_table_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_plan text;
  v_max  integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('table_limit_' || new.restaurant_id::text));

  select public.owner_plan(new.restaurant_id) into v_plan;
  select max_tables into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 3; end if;

  select count(*) into v_count
  from public.tables where restaurant_id = new.restaurant_id;

  if v_count >= v_max then
    raise exception 'Limită mese atinsă: maxim % pe planul curent. Pentru mai multe e nevoie de un plan superior.', v_max
      using errcode = 'P0001', hint = 'upgrade_plan';
  end if;
  return new;
end;
$function$;

-- ── enforce_table_limit_stmt (lanț 114 → ALTER 262 → 290) ───────────────────
create or replace function public.enforce_table_limit_stmt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rec   record;
  v_plan  text;
  v_max   integer;
  v_count integer;
begin
  -- Pentru fiecare restaurant atins de acest statement, verifică totalul.
  for v_rec in
    select distinct restaurant_id from new_rows
  loop
    select public.owner_plan(v_rec.restaurant_id) into v_plan;
    select max_tables into v_max
      from public.plan_limits
     where plan = coalesce(v_plan, 'free');
    if v_max is null then v_max := 3; end if;

    -- Totalul după statement (rândurile noi sunt deja în tabel — AFTER).
    select count(*) into v_count
      from public.tables
     where restaurant_id = v_rec.restaurant_id;

    if v_count > v_max then
      raise exception
        'Limită mese atinsă: maxim % pe planul curent. Pentru mai multe e nevoie de un plan superior.', v_max
        using errcode = 'P0001', hint = 'table_limit';
    end if;
  end loop;

  return null;  -- valoarea de retur e ignorată la AFTER … FOR EACH STATEMENT
end;
$function$;

-- ── enforce_team_member_limit (lanț 131 → ALTER 262 → 290) ──────────────────
create or replace function public.enforce_team_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_plan  text;
  v_max   integer;
  v_count integer;
begin
  -- Serializeaza inserturile concurente pe acelasi restaurant (anti race la count).
  perform pg_advisory_xact_lock(hashtext('team_limit_' || new.restaurant_id::text));

  select public.owner_plan(new.restaurant_id) into v_plan;

  -- Fail-closed: lipsa randului de config NU inseamna nelimitat.
  if not exists (
    select 1 from public.plan_features
     where plan = coalesce(v_plan, 'free') and feature = 'max_team_members'
  ) then
    raise exception 'Config lipsă: limita de membri nu e definită pentru planul restaurantului.'
      using errcode = 'P0001', hint = 'plan_config_missing';
  end if;

  select limit_value into v_max
    from public.plan_features
   where plan = coalesce(v_plan, 'free') and feature = 'max_team_members';

  -- DOAR un rand explicit cu limit_value IS NULL = nelimitat (pro/enterprise).
  if v_max is null then
    return new;
  end if;

  select count(*) into v_count
    from public.restaurant_memberships
   where restaurant_id = new.restaurant_id;

  -- BEFORE INSERT: randul nou nu e inca numarat. La count >= limita, al (count+1)-lea
  -- ar depasi => respins. Owner-ul (count 0) trece intotdeauna.
  if v_count >= v_max then
    raise exception 'Limita de membri atinsă: maxim % pe planul curent. Pentru mai mulți e nevoie de un plan superior.', v_max
      using errcode = 'P0001', hint = 'team_member_limit';
  end if;

  return new;
end;
$function$;

-- ── enforce_team_member_limit_stmt (lanț 131 → ALTER 262 → 290) ─────────────
create or replace function public.enforce_team_member_limit_stmt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare v_rec record; v_plan text; v_max integer; v_count integer;
begin
  for v_rec in select distinct restaurant_id from new_rows loop
    perform pg_advisory_xact_lock(hashtext('team_limit_' || v_rec.restaurant_id::text));
    select public.owner_plan(v_rec.restaurant_id) into v_plan;
    if not exists (select 1 from public.plan_features
                    where plan = coalesce(v_plan,'free') and feature = 'max_team_members') then
      raise exception 'Config lipsă: limita de membri nu e definită pentru planul restaurantului.'
        using errcode = 'P0001', hint = 'plan_config_missing';
    end if;
    select limit_value into v_max from public.plan_features
     where plan = coalesce(v_plan,'free') and feature = 'max_team_members';
    if v_max is null then continue; end if;  -- explicit unlimited
    select count(*) into v_count from public.restaurant_memberships
     where restaurant_id = v_rec.restaurant_id;
    if v_count > v_max then
      raise exception 'Limita de membri atinsă: maxim % pe planul curent. Pentru mai mulți e nevoie de un plan superior.', v_max
        using errcode = 'P0001', hint = 'team_member_limit';
    end if;
  end loop;
  return null;
end;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════
-- B. Date moarte
-- ═════════════════════════════════════════════════════════════════════════════

-- Funcțiile ÎNTÂI: sunt singurii cititori ai lui `ai_imports_month`.
drop function if exists public.reserve_ai_import_slot(uuid, uuid);
drop function if exists public.check_ai_import_quota(uuid);

alter table public.plan_limits drop column if exists ai_imports_month;
alter table public.plan_limits drop column if exists features;

comment on table public.plan_limits is
  'Limite numerice per plan: max_products / max_restaurants / max_tables, citite de trigger-ele enforce_*_limit. mig 290: coloanele ai_imports_month și features au fost ȘTERSE (zero cititori verificat 2026-10-05; cota AI reală e ai_quota, identică pe toate planurile).';

delete from public.plan_features where feature in ('ai_import', 'kitchen_dashboard');

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad   text;
  v_gates text[] := array[
    'public.enforce_feature_for_restaurant(uuid,text)', 'public.enforce_ordering_enabled()',
    'public.enforce_product_limit()', 'public.enforce_product_limit_stmt()',
    'public.enforce_restaurant_limit()', 'public.enforce_table_limit()',
    'public.enforce_table_limit_stmt()', 'public.enforce_team_member_limit()',
    'public.enforce_team_member_limit_stmt()'];
  v_hints text[] := array[
    'feature_disabled', 'plan_upgrade_required', 'upgrade_plan', 'product_limit',
    'upgrade_plan', 'upgrade_plan', 'table_limit', 'team_member_limit', 'team_member_limit'];
  i int;
begin
  -- (1) CLASĂ: niciun `raise exception` din `public` nu mai pomenește un nume
  -- intern de plan și nu interpolează o variabilă de plan.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         regexp_matches(p.prosrc, '(raise\s+exception[^;]*;)', 'gi') m
   where n.nspname = 'public'
     and (m[1] ~* '\m(growth|starter|enterprise|free|business)\M'
          or m[1] ~ '\mPro\M'
          or m[1] ~* '(v_plan|owner_plan\(|\.plan\M|p_plan\M|v_tier\M)');
  if v_bad is not null then
    raise exception 'mig 290: mesaje cu nume intern de plan în: %', v_bad;
  end if;

  -- (2) Contractul stabil: fiecare gate își păstrează HINT-ul, are „plan
  -- superior" în mesaj, e DEFINER cu pg_temp.
  for i in 1 .. array_length(v_gates, 1) loop
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_gates[i]::regprocedure
         and p.prosecdef
         and p.prosrc like '%hint = ''' || v_hints[i] || '''%'
         and p.prosrc like '%plan superior%'
         and 'search_path=public, pg_temp' = any(p.proconfig)
    ) then
      raise exception 'mig 290: % și-a pierdut hint-ul %, mesajul neutru sau search_path', v_gates[i], v_hints[i];
    end if;
  end loop;

  -- (3) ACL-uri neschimbate: funcțiile de trigger nu sunt apelabile de client
  -- (RP13); enforce_feature_for_restaurant își păstrează grant-ul de la 087.
  for i in 2 .. array_length(v_gates, 1) loop
    if has_function_privilege('anon', v_gates[i]::regprocedure, 'execute')
       or has_function_privilege('authenticated', v_gates[i]::regprocedure, 'execute') then
      raise exception 'mig 290: % a devenit executabilă de client', v_gates[i];
    end if;
  end loop;
  if has_function_privilege('anon', 'public.enforce_feature_for_restaurant(uuid,text)', 'execute') then
    raise exception 'mig 290: enforce_feature_for_restaurant executabilă de anon';
  end if;

  -- (4) Datele moarte au dispărut.
  if to_regprocedure('public.reserve_ai_import_slot(uuid,uuid)') is not null
     or to_regprocedure('public.check_ai_import_quota(uuid)') is not null then
    raise exception 'mig 290: funcțiile de cotă AI moarte încă există';
  end if;
  if exists (select 1 from pg_attribute
              where attrelid = 'public.plan_limits'::regclass and not attisdropped
                and attname in ('ai_imports_month', 'features')) then
    raise exception 'mig 290: plan_limits încă are coloane moarte';
  end if;
  if exists (select 1 from public.plan_features where feature in ('ai_import', 'kitchen_dashboard')) then
    raise exception 'mig 290: plan_features încă are rânduri moarte';
  end if;
  -- control POZITIV: limitele vii au rămas (5 planuri canonice, cu max_*).
  if (select count(*) from public.plan_limits
       where max_products is not null and max_tables is not null and max_restaurants is not null) <> 5 then
    raise exception 'mig 290: plan_limits a pierdut rânduri vii';
  end if;

  raise notice 'mig 290: 9 gate-uri cu mesaj neutru (hint neschimbat), 2 funcții + 2 coloane + 2 feature-uri moarte eliminate';
end$$;

commit;

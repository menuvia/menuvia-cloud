-- tests/sql/restaurant_country_assertions.sql
-- =============================================================================
-- Mig 296: `restaurants.country` + regula de aur pe ȚARĂ (fundația menuvia.com).
-- Self-contained, ROLLBACK la final.
--
-- Fixtura: UN owner pe `pro` (Plan 3 include 2 locații) cu un restaurant în
-- România și unul în Germania — exact starea în care planul de pe PROFIL ar da
-- fiscalizare pe AMBELE dacă gate-ul ar sta doar pe plan.
--
--   CC1  RO (control +): fiscal_receipt/online_payments/split_bill/shifts/
--        reports_vat = true în TOATE cele 3 puncte de trecere; default-ul
--        coloanei e 'RO' (un INSERT fără țară = comportamentul de azi).
--   CC2  DE: aceleași feature-uri = false în restaurant_has_feature,
--        get_restaurant_features (forma și `plan` NESCHIMBATE) și
--        enforce_feature_for_restaurant (hint feature_disabled); feature-urile
--        Plan 3 NE-fiscale (floor_plan, analytics_advanced) rămân true — lista
--        e scopată, nu „Plan 3 oprit".
--   CC3  bani pe DE respinși prin TOATE căile, cu control pozitiv pe RO:
--        add_partial_payment, advance_order mark_paid, UPDATE direct →paid
--        (trigger 124), INSERT în pending_receipts (gate 133); iar închiderea
--        NEfiscală e PERMISĂ pe DE (stare coerentă: fără bani în aplicație,
--        comanda se poate totuși închide) și RESPINSĂ pe RO (gate 263).
--   CC4  CHECK: doar ISO alpha-2 în majuscule; NULL respins.
--   CC5  owner-only, sub rolul REAL `authenticated`: managerul NU poate schimba
--        țara (hint country_owner_only) dar poate edita alte coloane (control);
--        owner-ul poate; un UPDATE care nu schimbă țara trece pentru manager.
--   CC6  CLICHET DE CLASĂ: setul funcțiilor din `public` care citesc
--        `plan_features` DIRECT e EXACT registrul de mai jos — o funcție nouă
--        care ar ocoli cele trei puncte de trecere (și deci gate-ul de țară)
--        face CI roșu până primește o decizie.
--   CC7  catalog: helperul intern neexecutabil de clienți; ACL-urile celor trei
--        puncte de trecere neschimbate; trigger-ul BEFORE UPDATE OF country ROW
--        (tgtype 19), NE-definer, neexecutabil de clienți (RP13).
--   CC8  white-label: menuvia.com și subdomeniile lui sunt rezervate.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('96000000-0000-4000-8000-000000000001','cc-owner@cc.test'),
  ('96000000-0000-4000-8000-000000000002','cc-manager@cc.test'),
  ('96000000-0000-4000-8000-000000000003','cc-founder@cc.test');

update public.profiles set plan = 'pro' where id = '96000000-0000-4000-8000-000000000001';
update public.profiles set is_platform_admin = true where id = '96000000-0000-4000-8000-000000000003';

-- RO fără țară explicită (default), DE explicit.
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('96b00000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','CC Ro','cc-ro','Cluj',true);
insert into public.restaurants (id, owner_id, name, slug, city, is_active, country, currency, timezone) values
  ('96b00000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000001','CC De','cc-de','Berlin',true,
   'DE','EUR','Europe/Berlin');

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('96b00000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','manager'),
  ('96b00000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000002','manager');

-- Comenzi `served` (total 100): două pe fiecare restaurant.
insert into public.orders (id, restaurant_id, source, status, total) values
  ('96f00000-0000-4000-8000-000000000011','96b00000-0000-4000-8000-000000000001','qr','served',100),
  ('96f00000-0000-4000-8000-000000000012','96b00000-0000-4000-8000-000000000001','qr','served',100),
  ('96f00000-0000-4000-8000-000000000013','96b00000-0000-4000-8000-000000000001','qr','served',100),
  ('96f00000-0000-4000-8000-000000000021','96b00000-0000-4000-8000-000000000002','qr','served',100),
  ('96f00000-0000-4000-8000-000000000022','96b00000-0000-4000-8000-000000000002','qr','served',100),
  ('96f00000-0000-4000-8000-000000000023','96b00000-0000-4000-8000-000000000002','qr','served',100),
  ('96f00000-0000-4000-8000-000000000024','96b00000-0000-4000-8000-000000000002','qr','served',100);

-- Helper: SQLSTATE + hint al unei instrucțiuni (NULL = a trecut).
create function pg_temp.cc_catch(p_sql text) returns text
language plpgsql as $$
declare v_state text; v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || '/' || coalesce(v_hint, '');
end $$;

-- ── CC1: RO = comportamentul de azi ──────────────────────────────────────────
do $$
declare
  v_f text;
  v_feat jsonb;
begin
  if (select country from public.restaurants where id = '96b00000-0000-4000-8000-000000000001')
     is distinct from 'RO' then
    raise exception 'CC1 FAIL: default-ul coloanei nu e RO';
  end if;
  v_feat := public.get_restaurant_features('96b00000-0000-4000-8000-000000000001');
  foreach v_f in array array['fiscal_receipt','online_payments','split_bill','shifts','reports_vat'] loop
    if not public.restaurant_has_feature('96b00000-0000-4000-8000-000000000001', v_f) then
      raise exception 'CC1 FAIL: RO pe pro a pierdut % (restaurant_has_feature)', v_f;
    end if;
    if (v_feat -> 'features' -> v_f ->> 'enabled') is distinct from 'true' then
      raise exception 'CC1 FAIL: RO pe pro a pierdut % (get_restaurant_features): %', v_f, v_feat;
    end if;
    perform public.enforce_feature_for_restaurant('96b00000-0000-4000-8000-000000000001', v_f);
  end loop;
  raise notice 'CC1 OK: restaurantul RO (default) păstrează toate feature-urile Plan 3';
end $$;

-- ── CC2: DE = feature-urile românești oprite, restul neatins ─────────────────
do $$
declare
  v_f text;
  v_feat jsonb;
  v_ro jsonb;
  r text;
begin
  v_feat := public.get_restaurant_features('96b00000-0000-4000-8000-000000000002');
  v_ro   := public.get_restaurant_features('96b00000-0000-4000-8000-000000000001');
  if v_feat ->> 'plan' is distinct from 'pro' then
    raise exception 'CC2 FAIL: get_restaurant_features trebuie să întoarcă planul REAL (pro): %', v_feat;
  end if;
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_feat -> 'features') k)
     is distinct from
     (select array_agg(k order by k collate "C") from jsonb_object_keys(v_ro -> 'features') k) then
    raise exception 'CC2 FAIL: forma hărții de feature-uri diferă între RO și DE';
  end if;
  foreach v_f in array array['fiscal_receipt','online_payments','split_bill','shifts','reports_vat'] loop
    if public.restaurant_has_feature('96b00000-0000-4000-8000-000000000002', v_f) then
      raise exception 'CC2 FAIL: restaurantul DE are % (restaurant_has_feature)', v_f;
    end if;
    if (v_feat -> 'features' -> v_f ->> 'enabled') is distinct from 'false' then
      raise exception 'CC2 FAIL: restaurantul DE are % (get_restaurant_features)', v_f;
    end if;
    r := pg_temp.cc_catch(format(
      'select public.enforce_feature_for_restaurant(%L, %L)',
      '96b00000-0000-4000-8000-000000000002', v_f));
    if r is distinct from '23514/feature_disabled' then
      raise exception 'CC2 FAIL: enforce_feature_for_restaurant(DE, %) → % (așteptat 23514/feature_disabled)', v_f, r;
    end if;
  end loop;
  foreach v_f in array array['floor_plan','analytics_advanced','order_qr','stocks'] loop
    if not public.restaurant_has_feature('96b00000-0000-4000-8000-000000000002', v_f) then
      raise exception 'CC2 FAIL: feature-ul NE-fiscal % a fost oprit pe DE (lista trebuie scopată)', v_f;
    end if;
  end loop;
  raise notice 'CC2 OK: DE pe pro — fiscal/plăți/TVA oprite în cele 3 puncte, restul neatins';
end $$;

-- ── CC3: banii pe DE respinși pe toate căile; control pozitiv pe RO ──────────
do $$
declare
  r text;
begin
  perform set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001', true);

  -- (a) add_partial_payment — sumă PARȚIALĂ (capcana CLAUDE.md: plata integrală
  --     ar fi mascată de trigger-ul →paid, care aruncă și el).
  r := pg_temp.cc_catch($q$select public.add_partial_payment('96f00000-0000-4000-8000-000000000021', 40, 'cash')$q$);
  if r is distinct from '23514/feature_disabled' then
    raise exception 'CC3a FAIL: add_partial_payment pe DE → % (așteptat respins feature_disabled)', r;
  end if;
  if exists (select 1 from public.order_payments where order_id = '96f00000-0000-4000-8000-000000000021') then
    raise exception 'CC3a FAIL: order_payments are rânduri pe DE';
  end if;
  r := pg_temp.cc_catch($q$select public.add_partial_payment('96f00000-0000-4000-8000-000000000011', 40, 'cash')$q$);
  if r is not null then
    raise exception 'CC3a FAIL (control +): add_partial_payment pe RO respins: %', r;
  end if;

  -- (b) advance_order mark_paid
  r := pg_temp.cc_catch($q$select public.advance_order('96f00000-0000-4000-8000-000000000022', 'mark_paid', 100, 'cash', 0, null)$q$);
  if r is distinct from '23514/feature_disabled' then
    raise exception 'CC3b FAIL: mark_paid pe DE → % (așteptat respins feature_disabled — bani fără bon)', r;
  end if;
  if (select status from public.orders where id = '96f00000-0000-4000-8000-000000000022') <> 'served' then
    raise exception 'CC3b FAIL: comanda DE a ieșit din served';
  end if;
  r := pg_temp.cc_catch($q$select public.advance_order('96f00000-0000-4000-8000-000000000012', 'mark_paid', 100, 'cash', 0, null)$q$);
  if r is not null then
    raise exception 'CC3b FAIL (control +): mark_paid pe RO respins: %', r;
  end if;

  -- (c) UPDATE direct →paid (ocolește RPC-ul): trigger-ul din mig 124
  r := pg_temp.cc_catch($q$update public.orders set status = 'paid', paid_amount = 100, payment_method = 'cash'
                           where id = '96f00000-0000-4000-8000-000000000023'$q$);
  if r is distinct from '23514/feature_disabled' then
    raise exception 'CC3c FAIL: UPDATE direct →paid pe DE → % (așteptat respins de trigger-ul 124)', r;
  end if;

  -- (d) INSERT în pending_receipts (gate 133)
  r := pg_temp.cc_catch($q$insert into public.pending_receipts (restaurant_id, order_id, status, payload)
                           values ('96b00000-0000-4000-8000-000000000002','96f00000-0000-4000-8000-000000000023','pending','x')$q$);
  if r is distinct from '23514/feature_disabled' then
    raise exception 'CC3d FAIL: bon fiscal în coadă pentru un restaurant DE → % (așteptat gate 133)', r;
  end if;

  -- (e) coerență: închiderea NEfiscală e permisă pe DE, respinsă pe RO (263)
  r := pg_temp.cc_catch($q$select public.advance_order('96f00000-0000-4000-8000-000000000024', 'close_order', null, null, 0, null)$q$);
  if r is not null then
    raise exception 'CC3e FAIL: close_order respins pe DE (comanda n-ar mai avea nicio ieșire): %', r;
  end if;
  if (select status from public.orders where id = '96f00000-0000-4000-8000-000000000024') <> 'closed' then
    raise exception 'CC3e FAIL: close_order pe DE nu a închis comanda';
  end if;
  r := pg_temp.cc_catch($q$select public.advance_order('96f00000-0000-4000-8000-000000000013', 'close_order', null, null, 0, null)$q$);
  if r is null or r not like '%fiscal_plan_requires_payment' then
    raise exception 'CC3e FAIL (control): close_order pe RO Plan 3 → % (așteptat fiscal_plan_requires_payment)', r;
  end if;
  raise notice 'CC3 OK: bani pe DE respinși (parțial, mark_paid, PATCH direct, coadă fiscală); RO neschimbat';
end $$;

-- ── CC4: CHECK pe formă ──────────────────────────────────────────────────────
do $$
declare
  v text;
  r text;
begin
  foreach v in array array['de', 'DEU', '', 'D1', ' RO'] loop
    r := pg_temp.cc_catch(format(
      'update public.restaurants set country = %L where id = %L', v, '96b00000-0000-4000-8000-000000000002'));
    if r is distinct from '23514/' then
      raise exception 'CC4 FAIL: country=% → % (așteptat CHECK 23514)', quote_literal(v), r;
    end if;
  end loop;
  r := pg_temp.cc_catch($q$update public.restaurants set country = null where id = '96b00000-0000-4000-8000-000000000002'$q$);
  if r is distinct from '23502/' then
    raise exception 'CC4 FAIL: country=NULL → % (așteptat NOT NULL 23502)', r;
  end if;
  raise notice 'CC4 OK: doar ISO alpha-2 în majuscule, NOT NULL';
end $$;

-- ── CC5: owner-only, sub rolul REAL authenticated ────────────────────────────
do $$
declare
  r text;
begin
  perform set_config('role', 'authenticated', true);

  -- managerul: alte coloane DA (control), țara NU
  perform set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
  r := pg_temp.cc_catch($q$update public.restaurants set tagline = 'cc' where id = '96b00000-0000-4000-8000-000000000001'$q$);
  if r is not null then
    perform set_config('role', 'none', true);
    raise exception 'CC5 FAIL (control +): managerul nu poate edita tagline: %', r;
  end if;
  r := pg_temp.cc_catch($q$update public.restaurants set country = 'DE' where id = '96b00000-0000-4000-8000-000000000001'$q$);
  if r is distinct from '42501/country_owner_only' then
    perform set_config('role', 'none', true);
    raise exception 'CC5 FAIL: managerul a schimbat țara unui local RO pe Plan 3 → %', r;
  end if;
  -- UPDATE care NU schimbă țara (formularul de setări trimite tot rândul)
  r := pg_temp.cc_catch($q$update public.restaurants set country = 'RO', name = 'CC Ro' where id = '96b00000-0000-4000-8000-000000000001'$q$);
  if r is not null then
    perform set_config('role', 'none', true);
    raise exception 'CC5 FAIL: un UPDATE fără schimbare de țară e respins pentru manager: %', r;
  end if;

  -- owner-ul: DA
  perform set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
  r := pg_temp.cc_catch($q$update public.restaurants set country = 'AT' where id = '96b00000-0000-4000-8000-000000000002'$q$);
  if r is not null then
    perform set_config('role', 'none', true);
    raise exception 'CC5 FAIL (control +): owner-ul nu poate schimba țara: %', r;
  end if;

  perform set_config('role', 'none', true);
  if (select country from public.restaurants where id = '96b00000-0000-4000-8000-000000000001') is distinct from 'RO'
     or (select country from public.restaurants where id = '96b00000-0000-4000-8000-000000000002') is distinct from 'AT' then
    raise exception 'CC5 FAIL: starea finală a țărilor e greșită';
  end if;
  raise notice 'CC5 OK: țara o schimbă doar owner-ul (sub authenticated real)';
end $$;

-- ── CC6: clichet de clasă — cine citește plan_features DIRECT ────────────────
do $$
declare
  v_registry text[] := array[
    -- cele trei puncte de trecere (poartă gate-ul de țară)
    'enforce_feature_for_restaurant', 'get_restaurant_features', 'restaurant_has_feature',
    -- gate-uri care NU ating niciun feature românesc (verificat la mig 296)
    'enforce_ordering_enabled', 'enforce_team_member_limit', 'enforce_team_member_limit_stmt',
    'enqueue_sms', 'fn_normalize_hide_branding', 'get_sms_usage', 'resolve_qr_token'
  ];
  v_found text[];
  v_ro_leak text;
begin
  select array_agg(x order by x collate "C") into v_found
    from (select distinct p.proname::text as x
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosrc like '%plan_features%') d;
  if v_found is null or array_length(v_found, 1) < 3 then
    raise exception 'CC6 FAIL (anti-vacuitate): descoperirea vede % funcții', coalesce(array_length(v_found, 1), 0);
  end if;
  if v_found is distinct from
     (select array_agg(x order by x collate "C") from unnest(v_registry) x) then
    raise exception E'CC6 FAIL: setul funcțiilor care citesc plan_features direct s-a schimbat.\n'
      'găsit:    %\nregistru: %\nO funcție nouă trebuie să treacă prin restaurant_has_feature / '
      'enforce_feature_for_restaurant (altfel ocolește gate-ul de țară din mig 296) — sau intră '
      'în registru cu motiv.', v_found, v_registry;
  end if;

  -- și niciun cititor direct din afara celor trei nu numește un feature românesc
  select string_agg(p.proname, ', ') into v_ro_leak
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%plan_features%'
     and p.proname not in ('enforce_feature_for_restaurant', 'get_restaurant_features', 'restaurant_has_feature')
     and p.prosrc ~ '''(fiscal_receipt|online_payments|split_bill|shifts|reports_vat)''';
  if v_ro_leak is not null then
    raise exception 'CC6 FAIL: % citesc plan_features direct pentru un feature românesc', v_ro_leak;
  end if;
  raise notice 'CC6 OK: % cititori direcți ai plan_features, toți în registru', array_length(v_found, 1);
end $$;

-- ── CC7: catalog ─────────────────────────────────────────────────────────────
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.feature_requires_ro(text)', 'execute') then
      raise exception 'CC7 FAIL: % poate executa helperul intern feature_requires_ro', v_role;
    end if;
    if has_function_privilege(v_role, 'public.enforce_restaurant_country_owner_only()', 'execute') then
      raise exception 'CC7 FAIL: % poate executa funcția de trigger (RP13)', v_role;
    end if;
    if v_role = 'anon' and (
         has_function_privilege('anon', 'public.restaurant_has_feature(uuid,text)', 'execute')
      or has_function_privilege('anon', 'public.enforce_feature_for_restaurant(uuid,text)', 'execute')
      or has_function_privilege('anon', 'public.get_restaurant_features(uuid)', 'execute')) then
      raise exception 'CC7 FAIL: anon poate executa un punct de trecere';
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.get_restaurant_features(uuid)', 'execute') then
    raise exception 'CC7 FAIL: authenticated a pierdut get_restaurant_features (useFeatures)';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.restaurants'::regclass
       and t.tgname = 'trg_restaurants_country_owner_only'
       and t.tgtype = 19 and t.tgenabled = 'O'
       and t.tgfoid = 'public.enforce_restaurant_country_owner_only()'::regprocedure
  ) then
    raise exception 'CC7 FAIL: trigger-ul owner-only lipsește sau are altă formă (așteptat tgtype 19)';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.enforce_restaurant_country_owner_only()'::regprocedure) then
    raise exception 'CC7 FAIL: funcția owner-only a devenit DEFINER (ar vedea postgres, nu apelantul)';
  end if;
  raise notice 'CC7 OK: helper intern închis, ACL-uri păstrate, trigger owner-only în formă';
end $$;

-- ── CC8: white-label — menuvia.com rezervat ──────────────────────────────────
do $$
declare
  v_aff uuid;
  v_dom text;
  v jsonb;
begin
  insert into public.affiliates (profile_id, referral_code, status)
  values ('96000000-0000-4000-8000-000000000003', 'ccwl96', 'active')
  returning id into v_aff;
  perform set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000003', true);
  foreach v_dom in array array['menuvia.com', 'www.menuvia.com', 'https://app.menuvia.com/x', 'menuvia.ro'] loop
    v := public.admin_set_affiliate_branding(v_aff, v_dom, 'Agenție', null);
    if v ->> 'error' is distinct from 'reserved_domain' then
      raise exception 'CC8 FAIL: domeniul % nu e rezervat: %', v_dom, v;
    end if;
  end loop;
  v := public.admin_set_affiliate_branding(v_aff, 'meniu.agentie-cc.ro', 'Agenție', null);
  if (v ->> 'ok')::boolean is distinct from true then
    raise exception 'CC8 FAIL (control +): un domeniu de agenție valid e respins: %', v;
  end if;
  raise notice 'CC8 OK: menuvia.com + subdomenii rezervate; domeniul de agenție trece';
end $$;

rollback;

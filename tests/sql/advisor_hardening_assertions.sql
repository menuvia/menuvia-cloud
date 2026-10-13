-- tests/sql/advisor_hardening_assertions.sql
-- =============================================================================
-- Mig 297: cele trei clase din advisor-ul Supabase, ținute ca CLICHETE pe
-- starea FINALĂ a lanțului (asserțiile din corpul migrației se evaluează o
-- singură dată, la poziția 297 — aici rulează la fiecare CI).
-- Self-contained, ROLLBACK la final.
--
--   AH1  CLICHET DE CLASĂ: setul funcțiilor SECURITY DEFINER din `public`
--        executabile de `anon` (privilegiu EFECTIV, `has_function_privilege`
--        pe OID — nu text de ACL) e EGAL cu allowlist-ul de mai jos, fiecare
--        intrare cu motivul ei. O funcție DEFINER nouă apelabilă de anon face
--        CI roșu până primește o decizie (aici + în mig/raport). Comparat ca
--        mulțime, ordonat `collate "C"`. `rls_auto_enable` (event-trigger de
--        PLATFORMĂ, doar pe prod, RP5) e tolerat explicit.
--   AH2  Control POZITIV al lui AH1: o funcție DEFINER creată acum în `public`
--        (PUBLIC are EXECUTE implicit; pe stack-ul Supabase și default
--        privileges) e DETECTATĂ — altfel AH1 ar putea fi vacuu.
--   AH3  Apelul REAL ca anon: cele 9 funcții revocate pică pe ACL-ul FUNCȚIEI
--        (42501 + „for function", nu pe schemă/corp); control pozitiv: anon
--        cheamă `is_restaurant_active` și CITEȘTE produsele unui local activ
--        (politica publică evaluează helper-ul sub anon — un revoke greșit ar
--        omorî meniul); `authenticated` NU pică pe ACL la cele 7 păstrate.
--   AH4  CLICHET DE CLASĂ: nicio politică din `public` nu cheamă `auth.*()` /
--        `current_setting()` ne-înfășurat în `(select …)` (auth_rls_initplan);
--        control pozitiv al detectorului pe expresii literale; control
--        COMPORTAMENTAL sub rolul REAL `authenticated`: profiles_self_select /
--        _update văd și scriu DOAR rândul propriu după rescriere.
--   AH5  CLICHET DE CLASĂ: niciun FK din `public` fără index acoperitor
--        (coloanele FK-ului = primele coloane ale indexului, ca mulțime; un
--        index parțial contează DOAR cu predicatul `(col IS NOT NULL)`).
--   AH6  Control POZITIV al lui AH5: o tabelă nouă cu FK fără index e
--        DETECTATĂ; cu index pe coloană, nu; cu index parțial pe alt
--        predicat, DA.
-- =============================================================================

begin;

-- ── Detectoarele (sursă unică pentru clichet ȘI controalele lui) ─────────────
create function pg_temp.ah_anon_definer() returns setof text
language sql stable as $$
  select (p.proname || '(' || array_to_string(array(
            select format_type(t.typ, null)
              from unnest(p.proargtypes::oid[]) with ordinality t(typ, ord)
             order by t.ord), ',') || ')')::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname <> 'rls_auto_enable'
$$;

create function pg_temp.ah_unwrapped(p_expr text) returns boolean
language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(p_expr, ''),
           '\( SELECT auth\.[a-z_]+\(\) AS [a-z_]+\)', '', 'g'),
           '\( SELECT current_setting\([^()]*\) AS [a-z_]+\)', '', 'g')
         ~ '(\mauth\.[a-z_]+\(|\mcurrent_setting\()'
$$;

create function pg_temp.ah_uncovered_fks() returns setof text
language sql stable as $$
  select c.conname::text
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where c.contype = 'f' and n.nspname = 'public'
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indisvalid
          and (select array_agg(i.indkey[g]) from generate_series(0, cardinality(c.conkey) - 1) g) @> c.conkey
          and (select array_agg(i.indkey[g]) from generate_series(0, cardinality(c.conkey) - 1) g) <@ c.conkey
          and (i.indpred is null
               or (cardinality(c.conkey) = 1
                   and pg_get_expr(i.indpred, i.indrelid) = format('(%I IS NOT NULL)',
                         (select attname from pg_attribute
                           where attrelid = c.conrelid and attnum = c.conkey[1])))))
$$;

-- ── AH1: allowlist-ul DEFINER apelabil de anon ───────────────────────────────
do $$
declare
  v_actual text[];
  v_expect text[];
begin
  select array_agg(x order by x collate "C") into v_expect from (values
    -- bridge: cheia anon + device_secret (bridge/menuvia-bridge.js); gardă pe secret în corp
    ('bridge_claim_receipt(text,uuid)'),
    ('bridge_claim_ticket(text,uuid)'),
    ('bridge_confirm_receipt(text,uuid,boolean,text,text,text)'),
    ('bridge_confirm_ticket(text,uuid,boolean,text,text)'),
    ('bridge_get_pending(text)'),                       -- bridge vechi (fără p_limit)
    ('bridge_get_pending(text,integer)'),
    ('bridge_get_pending_tickets(text,integer)'),
    ('bridge_heartbeat(text)'),
    ('bridge_validate_device(text)'),
    -- oaspete QR / pickup, fără cont (QrMenuPage, OrderTracker, PaymentConfirmedScreen)
    ('call_waiter(uuid,text,numeric)'),                 -- lib/orders.ts, QrMenuPage
    ('create_order(uuid,text,uuid,uuid,text,jsonb,uuid,timestamp with time zone,text,text,uuid)'), -- QR + pickup
    ('get_loyalty_state(uuid,text,text)'),              -- lib/loyalty.ts (rate-limit 258)
    ('get_menu_by_slug(text)'),                         -- /m/:slug (245)
    ('get_menu_for_restaurant(uuid)'),                  -- meniul pe un RTT (212→253)
    ('get_order_public_status(uuid,uuid)'),             -- OrderTracker
    ('get_restaurant_by_slug(text)'),                   -- proiecție publică (217/219/281)
    ('loyalty_attach_order(uuid,uuid,text,text)'),      -- lib/loyalty.ts
    ('open_table_session(text)'),                       -- sesiunea de masă QR (088)
    ('public_happy_hour_now(uuid)'),                    -- badge HH pe meniu
    ('record_page_view(uuid,uuid)'),                    -- analytics anon, plafonat (261)
    ('record_qr_scan(uuid,uuid)'),                      -- metrica de activare (283)
    ('request_fiscal_receipt(uuid,uuid)'),              -- oaspetele cere bonul
    ('resolve_qr_menu(text)'),                          -- scanare QR pe 1 RTT (245)
    ('resolve_qr_token(text)'),                         -- fallback-ul în doi pași
    ('submit_order_feedback(uuid,text,integer,text,uuid)'), -- PaymentConfirmedScreen
    -- evaluate în politici RLS pe rolul anon (products/categories/modifier_*/reservation_settings)
    ('is_module_enabled(uuid,text)'),                   -- + lib/payments.ts (butonul de plată online)
    ('is_restaurant_active(uuid)'),
    ('modifier_group_is_published(uuid)'),
    -- rezervări publice (ReservePage / ReservationSheet)
    ('cancel_reservation_by_code(text,text)'),          -- anulare pe cod (256)
    ('create_reservation_public(text,text,text,smallint,timestamp with time zone,text,text,smallint,text,uuid,uuid)'),
    ('get_public_floor_plan(text)'),                    -- harta publică (199/200)
    ('get_tables_availability(text,timestamp with time zone,timestamp with time zone,smallint)'),
    -- vizitator nelogat: afiliere, white-label, invitații
    ('get_affiliate_program_status()'),                 -- AfiliatIntroPage (295)
    ('get_affiliate_public_defaults()'),                -- LandingPage / AfiliatIntroPage (189)
    ('preview_invite(text)'),                           -- InviteAcceptPage înainte de login (lockdown 096)
    ('preview_referral(text)'),                         -- design anon plafonat (261); azi fără apelant în src/
    ('record_affiliate_touch(text,text)'),              -- lib/affiliate.ts, ?ref=
    ('resolve_agency_branding(text)'),                  -- lib/whiteLabel.ts (236)
    ('resolve_referral_code(text)')                     -- lib/affiliate.ts (295)
  ) v(x);

  select coalesce(array_agg(x order by x collate "C"), '{}') into v_actual
    from pg_temp.ah_anon_definer() x;

  if cardinality(v_expect) <> 39 then
    raise exception 'AH1: allowlist-ul are % intrări, se așteptau 39 (editare accidentală?)', cardinality(v_expect);
  end if;
  if v_actual is distinct from v_expect then
    raise exception 'AH1 FAIL: setul DEFINER apelabil de anon a derivat. în plus (decide: revoke sau allowlist cu motiv): %; lipsă (apelant public rupt?): %',
      (select array_agg(a order by a collate "C") from unnest(v_actual) a where a <> all (v_expect)),
      (select array_agg(e order by e collate "C") from unnest(v_expect) e where e <> all (v_actual));
  end if;
  raise notice 'AH1 OK: % funcții DEFINER apelabile de anon = allowlist', cardinality(v_actual);
end $$;

-- ── AH2: controlul pozitiv al detectorului AH1 ──────────────────────────────
do $$
begin
  begin
    create function public._ah2_probe() returns int
      language sql security definer set search_path = public, pg_temp as 'select 1';
    if not exists (select 1 from pg_temp.ah_anon_definer() x where x = '_ah2_probe()') then
      raise exception 'AH2 FAIL: o funcție DEFINER nouă, executabilă de anon, NU e detectată — AH1 e vacuu';
    end if;
    revoke execute on function public._ah2_probe() from public, anon;
    if exists (select 1 from pg_temp.ah_anon_definer() x where x = '_ah2_probe()') then
      raise exception 'AH2 FAIL: după revoke funcția e încă raportată (detectorul nu citește privilegiul efectiv)';
    end if;
    raise exception using errcode = 'P0A97', message = 'ah2_rollback';
  exception when sqlstate 'P0A97' then null;
  end;
  if to_regprocedure('public._ah2_probe()') is not null then
    raise exception 'AH2: sonda a rămas în schemă';
  end if;
  raise notice 'AH2 OK: o funcție DEFINER nouă apelabilă de anon e detectată; revocată, nu';
end $$;

-- ── Seed pentru AH3/AH4 ──────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('97000000-0000-4000-8000-000000000001','ah-owner@ah.test'),
  ('97000000-0000-4000-8000-000000000002','ah-other@ah.test');
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('97b00000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','AH Bistro','ah-bistro','Cluj',true);
insert into public.categories (id, restaurant_id, name) values
  ('97c00000-0000-4000-8000-000000000001','97b00000-0000-4000-8000-000000000001','Supe');
insert into public.products (id, restaurant_id, category_id, name, price, is_active, is_draft) values
  ('97d00000-0000-4000-8000-000000000001','97b00000-0000-4000-8000-000000000001',
   '97c00000-0000-4000-8000-000000000001','Ciorbă',20,true,false);

-- ── AH3: apelul real — revocate pică pe ACL, păstratele merg ────────────────
do $$
declare
  v_sql   text;
  v_state text;
  v_msg   text;
  v_n     int;
  v_ok    boolean;
begin
  -- (a) catalog: cele 9 nu mai sunt la anon; 7 rămân la authenticated, 2 helperi la nimeni
  foreach v_sql in array array[
    'public.adjust_stock_manual(uuid,numeric,text)', 'public.receive_purchase_order(uuid)',
    'public.rotate_qr_token(uuid)', 'public.save_floor_layout(uuid,jsonb)',
    'public.resolve_waiter_call(uuid)', 'public.get_order_payments(uuid)',
    'public.check_availability(uuid,timestamptz,timestamptz,smallint,text)',
    'public.check_qr_order_rate_limit(uuid)', 'public.check_pickup_order_rate_limit(uuid,text)'] loop
    if has_function_privilege('anon', v_sql::regprocedure, 'execute') then
      raise exception 'AH3 FAIL: anon are EXECUTE pe %', v_sql; end if;
    if (v_sql like '%rate_limit%') = has_function_privilege('authenticated', v_sql::regprocedure, 'execute') then
      raise exception 'AH3 FAIL: authenticated pe % — helperii interni NU, staff-only DA', v_sql; end if;
  end loop;

  -- (b) apelul REAL ca anon pică pe FUNCȚIE (nu pe schemă, nu în corp)
  foreach v_sql in array array[
    $q$select public.rotate_qr_token('00000000-0000-4000-8000-000000000000')$q$,
    $q$select public.get_order_payments('00000000-0000-4000-8000-000000000000')$q$,
    $q$select public.resolve_waiter_call('00000000-0000-4000-8000-000000000000')$q$,
    $q$select public.save_floor_layout('00000000-0000-4000-8000-000000000000', '{}'::jsonb)$q$,
    $q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000000', 1, 'x')$q$,
    $q$select public.receive_purchase_order('00000000-0000-4000-8000-000000000000')$q$,
    $q$select public.check_qr_order_rate_limit('00000000-0000-4000-8000-000000000000')$q$,
    $q$select public.check_pickup_order_rate_limit('00000000-0000-4000-8000-000000000000', '0722000000')$q$,
    $q$select * from public.check_availability('00000000-0000-4000-8000-000000000000', now(), now() + interval '1 hour', 2::smallint, null)$q$] loop
    v_state := null; v_msg := null;
    perform set_config('role', 'anon', true);
    begin
      execute v_sql;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    end;
    perform set_config('role', 'none', true);
    if not (v_state = '42501' and v_msg like '%for function%') then
      raise exception 'AH3 FAIL: ca anon, „%” nu a picat pe ACL-ul funcției (state=%, msg=%)', v_sql, v_state, v_msg;
    end if;
  end loop;

  -- (c) control POZITIV sub anon: helper-ul de politică + citirea meniului public
  perform set_config('role', 'anon', true);
  v_ok := public.is_restaurant_active('97b00000-0000-4000-8000-000000000001');
  select count(*) into v_n from public.products where restaurant_id = '97b00000-0000-4000-8000-000000000001';
  perform set_config('role', 'none', true);
  if v_ok is not true or v_n is distinct from 1 then
    raise exception 'AH3 FAIL (control +): anon nu mai citește meniul public (is_restaurant_active=%, produse=%)', v_ok, v_n;
  end if;

  -- (d) control POZITIV sub authenticated: staff-only nu pică pe ACL
  perform set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
  foreach v_sql in array array[
    $q$select public.get_order_payments('00000000-0000-4000-8000-000000000000')$q$,
    $q$select public.rotate_qr_token('00000000-0000-4000-8000-000000000000')$q$,
    $q$select public.resolve_waiter_call('00000000-0000-4000-8000-000000000000')$q$] loop
    v_state := null; v_msg := null;
    perform set_config('role', 'authenticated', true);
    begin
      execute v_sql;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    end;
    perform set_config('role', 'none', true);
    if v_state = '42501' and v_msg like '%for function%' then
      raise exception 'AH3 FAIL (control +): authenticated a pierdut EXECUTE pe „%” (%)', v_sql, v_msg;
    end if;
  end loop;
  raise notice 'AH3 OK: 9 revocate pică ca anon pe ACL-ul funcției; anon citește meniul; staff-ul își păstrează RPC-urile';
end $$;

-- ── AH4: auth_rls_initplan ──────────────────────────────────────────────────
do $$
declare
  v_bad  text;
  v_n    int;
  v_upd  int;
  v_upd2 int;
begin
  -- control pozitiv al detectorului (formele exacte randate de pg_get_expr)
  if not pg_temp.ah_unwrapped('(auth.uid() = id)')
     or not pg_temp.ah_unwrapped('((auth.jwt() ->> ''role''::text) = ''x''::text)')
     or not pg_temp.ah_unwrapped('(current_setting(''request.jwt.claims''::text, true) IS NOT NULL)')
     or not pg_temp.ah_unwrapped('((( SELECT auth.uid() AS uid) = id) OR (auth.uid() = owner_id))') then
    raise exception 'AH4 FAIL (control): detectorul nu prinde un apel ne-înfășurat';
  end if;
  if pg_temp.ah_unwrapped('(( SELECT auth.uid() AS uid) = id)')
     or pg_temp.ah_unwrapped('((( SELECT auth.jwt() AS jwt) ->> ''role''::text) = ''x''::text)')
     or pg_temp.ah_unwrapped('(( SELECT current_setting(''request.jwt.claims''::text, true) AS current_setting) IS NOT NULL)')
     or pg_temp.ah_unwrapped('is_member(restaurant_id)') then
    raise exception 'AH4 FAIL (control): detectorul semnalează o formă înfășurată / un helper';
  end if;

  -- clichetul de clasă
  select string_agg(format('%s."%s"', c.relname, pol.polname), ', ' order by c.relname collate "C", pol.polname collate "C")
    into v_bad
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and pg_temp.ah_unwrapped(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
                              coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''));
  if v_bad is not null then
    raise exception 'AH4 FAIL: politici cu auth.*()/current_setting() ne-înfășurat (re-evaluat per rând; scrie (select auth.uid())): %', v_bad;
  end if;
  -- anti-vacuitate: cele 21 rescrise de 297 poartă forma înfășurată
  select count(*) into v_n
    from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
         like '%( SELECT auth.uid() AS uid)%';
  if v_n < 21 then
    raise exception 'AH4 FAIL: doar % politici cu ( SELECT auth.uid() ), se așteptau ≥21', v_n;
  end if;

  -- comportament sub rolul REAL authenticated: doar rândul propriu
  perform set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.profiles
   where id in ('97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000002');
  update public.profiles set full_name = 'AH propriu' where id = '97000000-0000-4000-8000-000000000001';
  get diagnostics v_upd = row_count;
  update public.profiles set full_name = 'AH străin' where id = '97000000-0000-4000-8000-000000000002';
  get diagnostics v_upd2 = row_count;
  perform set_config('role', 'none', true);
  if v_n is distinct from 1 then
    raise exception 'AH4 FAIL: authenticated vede % profiluri din 2 (profiles_self_select)', v_n; end if;
  if v_upd is distinct from 1 or v_upd2 is distinct from 0 then
    raise exception 'AH4 FAIL: profiles_self_update propriu=% străin=% (așteptat 1/0)', v_upd, v_upd2; end if;
  if (select full_name from public.profiles where id = '97000000-0000-4000-8000-000000000002')
       is not distinct from 'AH străin' then
    raise exception 'AH4 FAIL: profilul străin a fost modificat'; end if;
  raise notice 'AH4 OK: zero politici cu auth.*() ne-înfășurat; % înfășurate; self_select/_update țin rândul propriu', 21;
end $$;

-- ── AH5: FK fără index acoperitor ───────────────────────────────────────────
do $$
declare v_bad text;
begin
  select string_agg(x, ', ' order by x collate "C") into v_bad from pg_temp.ah_uncovered_fks() x;
  if v_bad is not null then
    raise exception 'AH5 FAIL: FK-uri fără index acoperitor (create index <tabelă>_<col>_fkey_idx): %', v_bad;
  end if;
  raise notice 'AH5 OK: toate FK-urile din public au index acoperitor';
end $$;

-- ── AH6: controlul pozitiv al detectorului AH5 ──────────────────────────────
do $$
begin
  begin
    create table public._ah6_probe (
      id uuid primary key,
      restaurant_id uuid not null references public.restaurants(id),
      kind text);
    if not exists (select 1 from pg_temp.ah_uncovered_fks() x where x = '_ah6_probe_restaurant_id_fkey') then
      raise exception 'AH6 FAIL: FK nou fără index NU e detectat — AH5 e vacuu'; end if;
    create index _ah6_probe_partial on public._ah6_probe (restaurant_id) where kind = 'x';
    if not exists (select 1 from pg_temp.ah_uncovered_fks() x where x = '_ah6_probe_restaurant_id_fkey') then
      raise exception 'AH6 FAIL: un index parțial pe alt predicat e socotit acoperitor'; end if;
    create index _ah6_probe_full on public._ah6_probe (restaurant_id, kind);
    if exists (select 1 from pg_temp.ah_uncovered_fks() x where x = '_ah6_probe_restaurant_id_fkey') then
      raise exception 'AH6 FAIL: index cu FK-ul pe prima coloană NU e socotit acoperitor'; end if;
    raise exception using errcode = 'P0A97', message = 'ah6_rollback';
  exception when sqlstate 'P0A97' then null;
  end;
  if to_regclass('public._ah6_probe') is not null then
    raise exception 'AH6: sonda a rămas în schemă'; end if;
  raise notice 'AH6 OK: FK fără index detectat; parțial pe alt predicat nu acoperă; index cu prefixul FK acoperă';
end $$;

rollback;

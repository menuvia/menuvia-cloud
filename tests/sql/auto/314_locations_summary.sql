-- tests/sql/auto/314_locations_summary.sql
-- =============================================================================
-- LS1–LS6 — clichetul PERMANENT al mig 314: `get_locations_summary()`, sursa
-- ecranului „Toate locațiile”. Rulează din tests/sql/auto/ pe AMBELE medii
-- (Postgres gol din sql-verify + stack-ul Supabase din E2E). Autonom, ROLLBACK
-- la final.
--
-- Apelurile se fac SUB rolul REAL `authenticated` (helperul ls_rows), prin
-- `execute` DINAMIC: ca `postgres` RLS-ul și EXECUTE sunt ocolite, deci un
-- INVOKER promovat la DEFINER sau o politică lărgită ar trece nevăzute (clasa
-- PM8/TP24/VS11), iar un apel static își cachează verificarea EXECUTE per
-- tranzacție (capcana TS4 din 312).
--
--   LS1  A e PROPRIETAR la R1 (pro) și MANAGER la R2 (growth) → exact 2 rânduri,
--        cu cifrele zilei: R1 = 3 comenzi azi (fără cea anulată și fără cea de
--        acum 2 zile), 2 deschise (new + served), ultima comandă = acum.
--        R2 = 0 azi, 1 deschisă (una `preparing` de acum 5 zile — „deschise”
--        NU se filtrează pe zi), ultima comandă = cea `closed` de acum 3 zile
--        (cea anulată, mai nouă, nu contează).
--        [PICĂ: `status <> 'cancelled'` scos din orders_today (R1 = 4) sau din
--         last_order_at (R2 = acum 2 zile); open_orders filtrat pe zi (R2 = 0);
--         rolul `manager` scos din filtrul de membership (R2 dispare)]
--   LS2  ospătarul NU vede localul: A e și OSPĂTAR la R3 → R3 nu apare în lista
--        lui A; W (doar ospătar la R1) primește 0 rânduri.
--        [PICĂ (întâi în LS1 — R3 apare ca a treia locație): filtrul de rol din
--         helper lărgit la orice membership ȘI
--         `is_admin` înlocuit cu `is_member` (doar lărgirea helperului e
--         mascată de `is_admin` — defense-in-depth, verificat)]
--   LS3  un cont autentificat fără nicio membership → 0 rânduri; FONDATORUL
--        (is_platform_admin, fără membership) → tot 0 rânduri: „Toate
--        locațiile” sunt localurile MELE, nu toată platforma.
--        [PICĂ: filtrul pe membership scos (rămâne doar `is_admin`, care are
--         escape-ul fondatorului 186 → fondatorul vede R1, R2, R3)]
--   LS4  BANII: R1 (pro, fiscal_receipt) → revenue_today = 50.00 (încasarea de
--        azi; cea de acum 2 zile nu intră); R2 (growth, fără fiscal_receipt,
--        cu o comandă `closed` cu paid_amount) → NULL, NU 0. Control pozitiv
--        în același bloc: R1 nu e NULL (altfel „NULL peste tot” ar trece).
--        [PICĂ: CASE-ul pe restaurant_has_feature scos (R2 = 0); suma luată
--         direct din orders fără zi (R1 = 70)]
--   LS5  suprafața, pe catalog: O SINGURĂ semnătură, SECURITY INVOKER, STABLE,
--        `search_path = public, pg_temp`; anon și service_role fără EXECUTE,
--        authenticated cu EXECUTE; apel REAL ca anon → 42501 pe FUNCȚIE (nu pe
--        schemă). [PICĂ: `security definer` (cifrele rămân identice — doar
--        catalogul vede clasa); `grant execute … to anon`]
--   LS6  control pozitiv pe RLS: aceeași interogare ca postgres (fără JWT)
--        întoarce 0 rânduri — funcția e legată de `auth.uid()`, nu de rolul
--        care o execută; iar B (proprietarul R2) vede DOAR R2.
--        [PICĂ: lista construită din `restaurants` fără auth.uid()]
-- =============================================================================

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
--   A  proprietar R1 (pro), manager R2, ospătar R3
--   B  proprietar R2 (growth)
--   C  proprietar R3 (growth)
--   W  ospătar R1
--   X  cont autentificat străin
--   F  fondator (is_platform_admin), fără membership
insert into auth.users (id, email) values
  ('31400000-0000-4000-8000-0000000000a1', 'ls-a@ls314.test'),
  ('31400000-0000-4000-8000-0000000000b1', 'ls-b@ls314.test'),
  ('31400000-0000-4000-8000-0000000000c1', 'ls-c@ls314.test'),
  ('31400000-0000-4000-8000-0000000000e1', 'ls-w@ls314.test'),
  ('31400000-0000-4000-8000-0000000000d1', 'ls-x@ls314.test'),
  ('31400000-0000-4000-8000-0000000000f1', 'ls-f@ls314.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'ls-%@ls314.test'
  on conflict (id) do nothing;
update public.profiles set plan = 'pro'    where id = '31400000-0000-4000-8000-0000000000a1';
update public.profiles set plan = 'growth' where id in ('31400000-0000-4000-8000-0000000000b1',
                                                         '31400000-0000-4000-8000-0000000000c1');
update public.profiles set is_platform_admin = true
 where id = '31400000-0000-4000-8000-0000000000f1';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('314b0000-0000-4000-8000-000000000001', '31400000-0000-4000-8000-0000000000a1', 'LS Unu',  'ls314-unu',  'Cluj', true),
  ('314b0000-0000-4000-8000-000000000002', '31400000-0000-4000-8000-0000000000b1', 'LS Doi',  'ls314-doi',  'Cluj', true),
  ('314b0000-0000-4000-8000-000000000003', '31400000-0000-4000-8000-0000000000c1', 'LS Trei', 'ls314-trei', 'Cluj', true);
-- Membership-ul `owner` vine din trigger-ul restaurants_bootstrap_owner_membership.
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('314b0000-0000-4000-8000-000000000002', '31400000-0000-4000-8000-0000000000a1', 'manager'),
  ('314b0000-0000-4000-8000-000000000003', '31400000-0000-4000-8000-0000000000a1', 'waiter'),
  ('314b0000-0000-4000-8000-000000000001', '31400000-0000-4000-8000-0000000000e1', 'waiter');

-- R1 (pro): azi — paid 50 (cash), served, new, cancelled; acum 2 zile — paid 20.
insert into public.orders (id, restaurant_id, source, status, payment_method, paid_amount, created_at, paid_at) values
  ('314a0000-0000-4000-8000-000000000001', '314b0000-0000-4000-8000-000000000001',
   'waiter', 'paid', 'cash', 50, now(), now()),
  ('314a0000-0000-4000-8000-000000000002', '314b0000-0000-4000-8000-000000000001',
   'waiter', 'paid', 'cash', 20, now() - interval '2 days', now() - interval '2 days');
insert into public.orders (id, restaurant_id, source, status, created_at) values
  ('314a0000-0000-4000-8000-000000000003', '314b0000-0000-4000-8000-000000000001', 'waiter', 'served',    now()),
  ('314a0000-0000-4000-8000-000000000004', '314b0000-0000-4000-8000-000000000001', 'waiter', 'new',       now()),
  ('314a0000-0000-4000-8000-000000000005', '314b0000-0000-4000-8000-000000000001', 'waiter', 'cancelled', now());
-- R2 (growth): closed cu bani acum 3 zile, cancelled acum 2 zile, preparing acum 5 zile.
insert into public.orders (id, restaurant_id, source, status, paid_amount, created_at) values
  ('314a0000-0000-4000-8000-000000000011', '314b0000-0000-4000-8000-000000000002',
   'waiter', 'closed', 30, now() - interval '3 days');
insert into public.orders (id, restaurant_id, source, status, created_at) values
  ('314a0000-0000-4000-8000-000000000012', '314b0000-0000-4000-8000-000000000002', 'waiter', 'cancelled', now() - interval '2 days'),
  ('314a0000-0000-4000-8000-000000000013', '314b0000-0000-4000-8000-000000000002', 'waiter', 'preparing', now() - interval '5 days');
-- R3: o comandă de azi (dacă R3 ar scăpa în lista lui A, s-ar vedea).
insert into public.orders (id, restaurant_id, source, status, created_at) values
  ('314a0000-0000-4000-8000-000000000021', '314b0000-0000-4000-8000-000000000003', 'waiter', 'new', now());

-- Rândurile funcției SUB rolul indicat, ca utilizatorul dat, ca jsonb ordonat
-- pe nume (sau {raised, sqlstate, error}). `set_config('role')` stă ÎN AFARA
-- sub-blocului cu excepție (altfel s-ar derula odată cu el).
create function pg_temp.ls_rows(p_role text, p_uid uuid) returns jsonb
language plpgsql as $f$
declare v jsonb; v_state text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute $q$ select coalesce(jsonb_agg(to_jsonb(s) order by s.name), '[]'::jsonb)
                  from public.get_locations_summary() s $q$ into v;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v := jsonb_build_object('raised', true, 'sqlstate', v_state, 'error', sqlerrm);
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return v;
end $f$;

-- Rândul unui restaurant din rezultat (NULL dacă lipsește).
create function pg_temp.ls_row(p_rows jsonb, p_id uuid) returns jsonb
language sql as $f$
  select e from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) e
   where e->>'id' = p_id::text
$f$;

-- ═══════ LS1: A vede R1 + R2, cu cifrele zilei ═══════
do $$
declare v jsonb; r1 jsonb; r2 jsonb;
begin
  v := pg_temp.ls_rows('authenticated', '31400000-0000-4000-8000-0000000000a1');
  if jsonb_typeof(v) is distinct from 'array' then
    raise exception 'LS1 FAIL: apelul a eșuat: %', v; end if;
  if jsonb_array_length(v) <> 2 then
    raise exception 'LS1 FAIL: A trebuia să vadă 2 locații, a văzut %: %', jsonb_array_length(v), v; end if;
  r1 := pg_temp.ls_row(v, '314b0000-0000-4000-8000-000000000001');
  r2 := pg_temp.ls_row(v, '314b0000-0000-4000-8000-000000000002');
  if r1 is null or r2 is null then
    raise exception 'LS1 FAIL: lipsește R1 (proprietar) sau R2 (manager): %', v; end if;
  if r1->>'name' is distinct from 'LS Unu' or r1->>'slug' is distinct from 'ls314-unu' then
    raise exception 'LS1 FAIL: nume/slug greșit pe R1: %', r1; end if;
  if (r1->>'orders_today')::int is distinct from 3 then
    raise exception 'LS1 FAIL: R1 orders_today = % (aștepta 3: fără anulată, fără cea de acum 2 zile)', r1->>'orders_today'; end if;
  if (r1->>'open_orders')::int is distinct from 2 then
    raise exception 'LS1 FAIL: R1 open_orders = % (aștepta 2: new + served)', r1->>'open_orders'; end if;
  if (r1->>'last_order_at')::timestamptz is distinct from now() then
    raise exception 'LS1 FAIL: R1 last_order_at = % (aștepta acum)', r1->>'last_order_at'; end if;
  if (r2->>'orders_today')::int is distinct from 0 then
    raise exception 'LS1 FAIL: R2 orders_today = % (aștepta 0)', r2->>'orders_today'; end if;
  if (r2->>'open_orders')::int is distinct from 1 then
    raise exception 'LS1 FAIL: R2 open_orders = % (aștepta 1 — „deschise” nu se filtrează pe zi)', r2->>'open_orders'; end if;
  if (r2->>'last_order_at')::timestamptz is distinct from now() - interval '3 days' then
    raise exception 'LS1 FAIL: R2 last_order_at = % (aștepta comanda closed de acum 3 zile, nu cea anulată)', r2->>'last_order_at'; end if;
  raise notice 'LS1 PASS';
end $$;

-- ═══════ LS2: ospătarul nu vede localul ═══════
do $$
declare v jsonb;
begin
  v := pg_temp.ls_rows('authenticated', '31400000-0000-4000-8000-0000000000a1');
  if pg_temp.ls_row(v, '314b0000-0000-4000-8000-000000000003') is not null then
    raise exception 'LS2 FAIL: A vede R3, unde e doar ospătar: %', v; end if;
  v := pg_temp.ls_rows('authenticated', '31400000-0000-4000-8000-0000000000e1');
  if v is distinct from '[]'::jsonb then
    raise exception 'LS2 FAIL: ospătarul W vede locații: %', v; end if;
  raise notice 'LS2 PASS';
end $$;

-- ═══════ LS3: străinul și fondatorul → 0 rânduri ═══════
do $$
declare v jsonb;
begin
  v := pg_temp.ls_rows('authenticated', '31400000-0000-4000-8000-0000000000d1');
  if v is distinct from '[]'::jsonb then
    raise exception 'LS3 FAIL: străinul vede locații: %', v; end if;
  v := pg_temp.ls_rows('authenticated', '31400000-0000-4000-8000-0000000000f1');
  if v is distinct from '[]'::jsonb then
    raise exception 'LS3 FAIL: fondatorul fără membership vede % locații (escape-ul is_admin a scăpat lista)',
      case when jsonb_typeof(v) = 'array' then jsonb_array_length(v)::text else v::text end; end if;
  raise notice 'LS3 PASS';
end $$;

-- ═══════ LS4: banii — valoare pe Planul 3, NULL fără fiscal_receipt ═══════
do $$
declare v jsonb; r1 jsonb; r2 jsonb;
begin
  v := pg_temp.ls_rows('authenticated', '31400000-0000-4000-8000-0000000000a1');
  r1 := pg_temp.ls_row(v, '314b0000-0000-4000-8000-000000000001');
  r2 := pg_temp.ls_row(v, '314b0000-0000-4000-8000-000000000002');
  if r1 is null or r2 is null then
    raise exception 'LS4 FAIL: rânduri lipsă: %', v; end if;
  -- Control pozitiv: pe planul cu bani suma EXISTĂ.
  if jsonb_typeof(r1->'revenue_today') is distinct from 'number' then
    raise exception 'LS4 FAIL: R1 (pro) revenue_today nu e număr: %', r1; end if;
  if (r1->>'revenue_today')::numeric is distinct from 50.00 then
    raise exception 'LS4 FAIL: R1 revenue_today = % (aștepta 50.00 — doar încasarea de azi)', r1->>'revenue_today'; end if;
  if jsonb_typeof(r2->'revenue_today') is distinct from 'null' then
    raise exception 'LS4 FAIL: R2 (growth, fără fiscal_receipt) revenue_today = % (aștepta NULL, nu 0)', r2->'revenue_today'; end if;
  raise notice 'LS4 PASS';
end $$;

-- ═══════ LS5: suprafața, pe catalog + apel real ca anon ═══════
do $$
declare v_n int; v_oid oid; v_def boolean; v_vol "char"; v_cfg text[]; v jsonb;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_locations_summary';
  if v_n <> 1 then
    raise exception 'LS5 FAIL: % semnături pentru get_locations_summary (trebuie 1)', v_n; end if;
  select p.oid, p.prosecdef, p.provolatile, p.proconfig into v_oid, v_def, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_locations_summary';
  if v_def then
    raise exception 'LS5 FAIL: get_locations_summary e SECURITY DEFINER (trebuie INVOKER — RLS-ul decide)'; end if;
  if v_vol <> 's' then
    raise exception 'LS5 FAIL: volatilitate % (trebuie STABLE)', v_vol; end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'LS5 FAIL: search_path %', v_cfg; end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'LS5 FAIL: anon are EXECUTE'; end if;
  if has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'LS5 FAIL: service_role are EXECUTE'; end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'LS5 FAIL: authenticated NU are EXECUTE'; end if;
  v := pg_temp.ls_rows('anon', null);
  if (v->>'sqlstate') is distinct from '42501' or v->>'error' not like '%for function%' then
    raise exception 'LS5 FAIL: anon a apelat funcția (sau eroare pe altceva): %', v; end if;
  raise notice 'LS5 PASS';
end $$;

-- ═══════ LS6: legată de auth.uid(); B vede doar R2 ═══════
do $$
declare v jsonb; v_n int;
begin
  -- Ca postgres, fără JWT: auth.uid() e NULL → nicio membership → 0 rânduri.
  perform set_config('request.jwt.claim.sub', '', true);
  select count(*) into v_n from public.get_locations_summary();
  if v_n <> 0 then
    raise exception 'LS6 FAIL: fără utilizator funcția întoarce % rânduri', v_n; end if;
  v := pg_temp.ls_rows('authenticated', '31400000-0000-4000-8000-0000000000b1');
  if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) <> 1
     or pg_temp.ls_row(v, '314b0000-0000-4000-8000-000000000002') is null then
    raise exception 'LS6 FAIL: B trebuia să vadă doar R2: %', v; end if;
  raise notice 'LS6 PASS';
end $$;

rollback;

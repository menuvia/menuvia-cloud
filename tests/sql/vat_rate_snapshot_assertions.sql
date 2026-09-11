-- tests/sql/vat_rate_snapshot_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 272 — audit v3 RES-20: cota TVA a unei linii
-- de comandă e cea de la VÂNZARE, nu cea curentă a grupei/produsului.
--
-- Rulează ca `postgres` (ocolește RLS) — testăm LOGICA cititorilor și a
-- trigger-ului, nu identitatea (vat_report_daily e security_invoker; RLS-ul
-- lui e testat în rls_scoping_batch2 / report_revenue_gate).
--
--   VS1  trigger-ul completează snapshot-ul (grupă + cotă) la INSERT, pe
--        restaurantul COMENZII, pentru orice scriitor (aici: INSERT direct).
--   VS2  cota grupei se schimbă DUPĂ vânzare (11 → 9) → raportul TVA ține
--        11 (vat_rate_percent ȘI vat_amount); eticheta rămâne cea curentă.
--        [PICĂ pe codul vechi: raportul urma cota curentă, 9]
--   VS3  produsul e RECLASIFICAT după vânzare (grupa 1 → 2) → raportul ține
--        grupa 1 / 11.  [PICĂ pe codul vechi: linia sărea în grupa 2 / 21]
--   VS4  același scenariu pe bonul FiscalNet regenerat (retry): linia S^ poartă
--        grupa casei a grupei INTERNE de la vânzare (1), nu a produsului
--        curent (2).  [PICĂ pe codul vechi: ^buc^2^1]
--   VS4b maparea grupă-internă → grupă-pe-casă (vat_rates.fiscalnet_group)
--        rămâne LIVE: o corecție de instalator (1 → 5) se aplică și la retry.
--        Snapshot-ul e GRUPA INTERNĂ, nu grupa casei.  [PICĂ pe codul vechi]
--   VS5  produsul e ȘTERS după vânzare (FK set null) → raportul și bonul își
--        păstrează grupa/cota din snapshot.  [PICĂ pe codul vechi: cădea pe
--        grupa 1 / 11 pentru orice produs șters]
--   VS6  rând FĂRĂ snapshot (istoric, produs șters înainte de backfill) → cade
--        pe cota CURENTĂ a grupei — comportamentul de dinainte, DOCUMENTAT.
--   VS7  editarea unei comenzi NE-plătite (update_order_items = DELETE+INSERT)
--        RE-snapshot-uiește la cota curentă: momentul fiscal e bonul, nu
--        scrierea inițială a liniei.
--   VS8  clichete structurale (DP6): trigger BEFORE INSERT ROW exact (tgtype 7),
--        view-ul citește snapshot-ul, forma view-ului e înghețată, payload-ul
--        citește snapshot-ul, DEFINER + pg_temp, suprafață doar service_role.
--   VS9  scripts/recover_orphan_vat_snapshots.sql (rulat MANUAL, nu e în lanț):
--        liniile orfane (produs șters înainte de mig 272, fără product_id și
--        fără snapshot) își recuperează grupa din audit_log DELETE pe products,
--        potrivind pe (restaurant, product_name_snapshot). Un nume care a purtat
--        VREODATĂ grupe diferite — produse distincte SAU același produs
--        reclasificat înainte de ștergere — e ambiguu și se SARE; unul fără
--        potrivire rămâne NULL.
--
-- Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('72000000-0000-4000-8000-000000000001', 'vs-owner@vs.test');
update public.profiles set plan = 'pro' where id = '72000000-0000-4000-8000-000000000001';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('72b00000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001',
   'VS Bistro', 'vs-bistro', 'Cluj', true);

-- Trigger-ul din mig 029/102 a creat vat_rates 11/21/11/0 cu fiscalnet_group
-- pe default 1 (mig 030); mapăm 1:1 ca grupa casei să fie distinctă per grupă.
update public.vat_rates set fiscalnet_group = vat_group
 where restaurant_id = '72b00000-0000-4000-8000-000000000001';

insert into public.categories (id, restaurant_id, name) values
  ('72c00000-0000-4000-8000-000000000001', '72b00000-0000-4000-8000-000000000001', 'VS Cat');
insert into public.products (id, restaurant_id, category_id, name, price, vat_group, is_active, is_draft) values
  ('72d00000-0000-4000-8000-000000000001', '72b00000-0000-4000-8000-000000000001',
   '72c00000-0000-4000-8000-000000000001', 'VS Supă',  100, 1, true, false),
  ('72d00000-0000-4000-8000-000000000002', '72b00000-0000-4000-8000-000000000001',
   '72c00000-0000-4000-8000-000000000001', 'VS Bere',   50, 2, true, false);

-- Două comenzi PLĂTITE (pro: gate-ul 124 trece; fără bridge → enqueue-ul 259
-- sare) + una deschisă pentru testul de editare. Itemii se inserează FĂRĂ
-- coloanele de snapshot — exact ca create_order (191) / update_order_items (192).
insert into public.orders (id, restaurant_id, source, status, total, paid_at, paid_amount, payment_method) values
  ('72f00000-0000-4000-8000-000000000001', '72b00000-0000-4000-8000-000000000001', 'waiter', 'paid', 100, now(), 100, 'cash'),
  ('72f00000-0000-4000-8000-000000000002', '72b00000-0000-4000-8000-000000000001', 'waiter', 'paid',  50, now(),  50, 'cash');
insert into public.orders (id, restaurant_id, source, status, total) values
  ('72f00000-0000-4000-8000-000000000003', '72b00000-0000-4000-8000-000000000001', 'waiter', 'new', 100);

insert into public.order_items (id, order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total) values
  ('72e00000-0000-4000-8000-000000000001', '72f00000-0000-4000-8000-000000000001',
   '72d00000-0000-4000-8000-000000000001', 'VS Supă', 1, 100, 100),
  ('72e00000-0000-4000-8000-000000000002', '72f00000-0000-4000-8000-000000000002',
   '72d00000-0000-4000-8000-000000000002', 'VS Bere', 1, 50, 50),
  ('72e00000-0000-4000-8000-000000000003', '72f00000-0000-4000-8000-000000000003',
   '72d00000-0000-4000-8000-000000000001', 'VS Supă', 1, 100, 100);

-- ── VS1: trigger-ul completează snapshot-ul la INSERT ────────────────────────
do $$
declare v_g smallint; v_r numeric;
begin
  select vat_group_snapshot, vat_rate_snapshot into v_g, v_r
    from public.order_items where id = '72e00000-0000-4000-8000-000000000001';
  if v_g is distinct from 1 or v_r is distinct from 11.00 then
    raise exception 'VS1 FAIL: linia grupei 1 are snapshot (%, %) — așteptat (1, 11.00)', v_g, v_r; end if;
  select vat_group_snapshot, vat_rate_snapshot into v_g, v_r
    from public.order_items where id = '72e00000-0000-4000-8000-000000000002';
  if v_g is distinct from 2 or v_r is distinct from 21.00 then
    raise exception 'VS1 FAIL: linia grupei 2 are snapshot (%, %) — așteptat (2, 21.00)', v_g, v_r; end if;
  raise notice 'VS1 OK: trigger-ul a snapshot-uit grupa + cota la INSERT (1/11, 2/21)';
end $$;

-- ── VS2: cota grupei se schimbă după vânzare → raportul ține cota de la vânzare ──
do $$
declare v_rate numeric; v_vat numeric; v_label text; v_n int;
begin
  update public.vat_rates set rate_percent = 9.00
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;

  select count(*), max(vat_rate_percent), max(round(vat_amount, 2)), max(vat_label)
    into v_n, v_rate, v_vat, v_label
    from public.vat_report_daily
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;
  if v_n <> 1 then
    raise exception 'VS2 FAIL: % rânduri pentru grupa 1 (așteptat 1)', v_n; end if;
  if v_rate is distinct from 11.00 then
    raise exception 'VS2 FAIL: raportul arată cota % pentru o vânzare la 11%% (a urmat cota CURENTĂ)', v_rate; end if;
  -- 100 × 11/111 = 9.91 (la 9%%: 8.26)
  if v_vat is distinct from 9.91 then
    raise exception 'VS2 FAIL: vat_amount=% (așteptat 9.91 la cota de la vânzare)', v_vat; end if;
  if v_label is distinct from 'Mâncare' then
    raise exception 'VS2 FAIL: eticheta grupei nu mai vine din vat_rates (%)', v_label; end if;

  update public.vat_rates set rate_percent = 11.00
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;
  raise notice 'VS2 OK: cota 11 → 9 după vânzare; raportul ține 11 (TVA 9.91)';
end $$;

-- ── VS3: produsul e reclasificat după vânzare → raportul ține grupa de la vânzare ──
do $$
declare v_rate numeric; v_gross numeric; v_n int;
begin
  update public.products set vat_group = 2 where id = '72d00000-0000-4000-8000-000000000001';

  select count(*), max(vat_rate_percent), max(gross_total) into v_n, v_rate, v_gross
    from public.vat_report_daily
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;
  if v_n <> 1 or v_gross is distinct from 100.00 then
    raise exception 'VS3 FAIL: vânzarea de 100 nu mai e în grupa 1 (rânduri=%, brut=%) — a urmat grupa CURENTĂ a produsului', v_n, v_gross; end if;
  if v_rate is distinct from 11.00 then
    raise exception 'VS3 FAIL: cota raportată % (așteptat 11)', v_rate; end if;
  -- lăsăm produsul reclasificat pentru VS4
  raise notice 'VS3 OK: reclasificare 1 → 2 după vânzare; raportul ține grupa 1 / 11';
end $$;

-- ── VS4: bonul FiscalNet regenerat poartă grupa de la vânzare ────────────────
do $$
declare v_payload text;
begin
  -- produsul e ÎNCĂ în grupa 2 (VS3). Regenerarea = ce face bridge_retry_receipt.
  v_payload := public.build_fiscalnet_payload('72f00000-0000-4000-8000-000000000001');
  if position('^buc^1^1' in v_payload) = 0 then
    raise exception 'VS4 FAIL: linia S^ nu poartă grupa casei 1 (grupa internă de la vânzare): %', v_payload; end if;
  if position('^buc^2^1' in v_payload) > 0 then
    raise exception 'VS4 FAIL: linia S^ a urmat grupa CURENTĂ a produsului (2): %', v_payload; end if;
  raise notice 'VS4 OK: retry după reclasificare → S^…^buc^1^1 (grupa de la vânzare)';
end $$;

-- ── VS4b: maparea pe casă rămâne LIVE (snapshot-ul e grupa INTERNĂ) ───────────
do $$
declare v_payload text;
begin
  update public.vat_rates set fiscalnet_group = 5
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;
  v_payload := public.build_fiscalnet_payload('72f00000-0000-4000-8000-000000000001');
  if position('^buc^5^1' in v_payload) = 0 then
    raise exception 'VS4b FAIL: remaparea instalatorului (grupa 1 → casa 5) nu s-a aplicat la retry: %', v_payload; end if;
  update public.vat_rates set fiscalnet_group = 1
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;
  update public.products set vat_group = 1 where id = '72d00000-0000-4000-8000-000000000001';
  raise notice 'VS4b OK: maparea grupă-internă → grupă-pe-casă e live; snapshot-ul e grupa internă';
end $$;

-- ── VS5: produsul e ȘTERS după vânzare → raportul și bonul își păstrează grupa ──
do $$
declare v_rate numeric; v_gross numeric; v_n int; v_payload text; v_pid uuid;
begin
  delete from public.products where id = '72d00000-0000-4000-8000-000000000002';
  select product_id into v_pid from public.order_items where id = '72e00000-0000-4000-8000-000000000002';
  if v_pid is not null then
    raise exception 'VS5: precondiție — FK-ul on delete set null nu a golit product_id'; end if;

  select count(*), max(vat_rate_percent), max(gross_total) into v_n, v_rate, v_gross
    from public.vat_report_daily
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 2;
  if v_n <> 1 or v_gross is distinct from 50.00 or v_rate is distinct from 21.00 then
    raise exception 'VS5 FAIL: vânzarea produsului șters nu mai e în grupa 2 / 21 (rânduri=%, brut=%, cotă=%) — a căzut pe grupa 1', v_n, v_gross, v_rate; end if;

  v_payload := public.build_fiscalnet_payload('72f00000-0000-4000-8000-000000000002');
  if position('^buc^2^1' in v_payload) = 0 then
    raise exception 'VS5 FAIL: bonul produsului șters a pierdut grupa 2: %', v_payload; end if;
  raise notice 'VS5 OK: produs șters după vânzare → raport 2/21 și bon ^buc^2^1 din snapshot';
end $$;

-- ── VS6: rând FĂRĂ snapshot → cota CURENTĂ (fallback documentat, ca înainte) ──
do $$
declare v_gross numeric; v_n int;
begin
  update public.order_items set vat_group_snapshot = null, vat_rate_snapshot = null
   where id = '72e00000-0000-4000-8000-000000000002';
  -- fără produs ȘI fără snapshot → grupa 1 (coalesce-ul istoric) la cota CURENTĂ a
  -- grupei 1 (11) → se contopește cu linia de 100 (snapshot 1/11) într-un singur
  -- rând de 150.
  select count(*), max(gross_total) into v_n, v_gross
    from public.vat_report_daily
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;
  if v_n <> 1 or v_gross is distinct from 150.00 then
    raise exception 'VS6 FAIL: rândul fără snapshot nu cade pe grupa 1 / cota curentă (rânduri=%, brut=%)', v_n, v_gross; end if;
  -- Cota grupei 1 se schimbă (11 → 9): linia CU snapshot rămâne la 11 (100), cea
  -- FĂRĂ snapshot urmează cota curentă (9, 50) → grupa 1 se SPARGE în două rânduri.
  update public.vat_rates set rate_percent = 9.00
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;
  select count(*) into v_n from public.vat_report_daily
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;
  if v_n <> 2 then
    raise exception 'VS6 FAIL: grupa 1 are % rânduri (așteptat 2: 11%%/100 din snapshot + 9%%/50 fallback)', v_n; end if;
  if not exists (select 1 from public.vat_report_daily
                  where restaurant_id = '72b00000-0000-4000-8000-000000000001'
                    and vat_group = 1 and vat_rate_percent = 9.00 and gross_total = 50.00) then
    raise exception 'VS6 FAIL: rândul fără snapshot nu urmează cota curentă (9%% / 50)'; end if;
  if not exists (select 1 from public.vat_report_daily
                  where restaurant_id = '72b00000-0000-4000-8000-000000000001'
                    and vat_group = 1 and vat_rate_percent = 11.00 and gross_total = 100.00) then
    raise exception 'VS6 FAIL: rândul cu snapshot nu mai ține 11%% / 100'; end if;
  update public.vat_rates set rate_percent = 11.00
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;
  update public.order_items set vat_group_snapshot = 2, vat_rate_snapshot = 21.00
   where id = '72e00000-0000-4000-8000-000000000002';
  raise notice 'VS6 OK: rând fără snapshot → cota curentă (fallback documentat); rândurile cu snapshot rămân la cota lor';
end $$;

-- ── VS7: editarea unei comenzi NE-plătite re-snapshot-uiește la cota curentă ──
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
do $$
declare v_r numeric; v_n int;
begin
  update public.vat_rates set rate_percent = 9.00
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;
  perform public.update_order_items(
    '72f00000-0000-4000-8000-000000000003',
    '[{"product_id": "72d00000-0000-4000-8000-000000000001", "quantity": 2}]'::jsonb,
    null);
  select count(*), max(vat_rate_snapshot) into v_n, v_r
    from public.order_items where order_id = '72f00000-0000-4000-8000-000000000003';
  if v_n <> 1 or v_r is distinct from 9.00 then
    raise exception 'VS7 FAIL: linia rescrisă la editare are snapshot % (așteptat 9.00, cota curentă la editare)', v_r; end if;
  update public.vat_rates set rate_percent = 11.00
   where restaurant_id = '72b00000-0000-4000-8000-000000000001' and vat_group = 1;
  raise notice 'VS7 OK: editarea pre-plată rescrie liniile cu cota curentă (momentul fiscal e bonul)';
end $$;

-- ── VS8: clichete structurale ────────────────────────────────────────────────
do $$
declare v_type smallint; v_def text; v_src text; v_cfg text[]; v_cols text[];
begin
  select tgtype into v_type from pg_trigger
   where tgrelid = 'public.order_items'::regclass and tgname = 'trg_snapshot_order_item_vat' and not tgisinternal;
  if v_type is distinct from 7 then
    raise exception 'VS8 FAIL: trg_snapshot_order_item_vat trebuie BEFORE INSERT ROW (tgtype 7), găsit %', v_type; end if;

  v_def := pg_get_viewdef('public.vat_report_daily'::regclass, true);
  if v_def not ilike '%vat_rate_snapshot%' or v_def not ilike '%vat_group_snapshot%' then
    raise exception 'VS8 FAIL: vat_report_daily nu mai citește snapshot-ul'; end if;
  if v_def not ilike '%restaurant_has_feature%' or v_def not ilike '%NULLIF%' then
    raise exception 'VS8 FAIL: vat_report_daily a pierdut gate-ul fiscal (150) sau factorul de discount (238)'; end if;
  select array_agg(a.attname::text order by a.attnum) into v_cols
    from pg_attribute a where a.attrelid = 'public.vat_report_daily'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from array['restaurant_id','report_date','vat_group','vat_rate_percent','vat_label',
                                   'orders_count','gross_total','vat_amount','net_total'] then
    raise exception 'VS8 FAIL: forma vat_report_daily s-a schimbat (VatReportTab face select *): %', v_cols; end if;

  select pg_get_functiondef(p.oid), p.proconfig into v_src, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'build_fiscalnet_payload';
  if position('vat_group_snapshot' in v_src) = 0 then
    raise exception 'VS8 FAIL: build_fiscalnet_payload nu mai citește snapshot-ul'; end if;
  if position('security definer' in lower(v_src)) = 0 or not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'VS8 FAIL: build_fiscalnet_payload nu e DEFINER cu search_path=public, pg_temp'; end if;
  if has_function_privilege('anon', 'public.build_fiscalnet_payload(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.build_fiscalnet_payload(uuid)', 'EXECUTE') then
    raise exception 'VS8 FAIL: build_fiscalnet_payload executabil de roluri client'; end if;
  if has_function_privilege('anon', 'public.snapshot_order_item_vat()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.snapshot_order_item_vat()', 'EXECUTE') then
    raise exception 'VS8 FAIL: snapshot_order_item_vat executabil de roluri client'; end if;
  raise notice 'VS8 OK: trigger tgtype 7, view + payload citesc snapshot-ul, forma view-ului înghețată, suprafață OK';
end $$;

-- ── VS9: recuperarea orfanilor din jurnalul de audit (scripts/, rulat manual) ─
-- Liniile al căror produs a fost șters ÎNAINTE de mig 272 nu au nici product_id,
-- nici snapshot → cad pe grupa 1. `scripts/recover_orphan_vat_snapshots.sql` le
-- recuperează grupa din `audit_log` DELETE pe products (old_data poartă numele +
-- vat_group), potrivind pe (restaurant, product_name_snapshot). Un nume purtat de
-- produse cu grupe DIFERITE e ambiguu și se SARE — a ghici într-un jurnal fiscal
-- e mai rău decât a lăsa fallback-ul documentat.
--   [PICĂ fără filtrul de ambiguitate: linia ambiguă primește o grupă ghicită]
--   [PICĂ fără script / fără potrivirea pe nume: linia unică rămâne NULL]
insert into public.orders (id, restaurant_id, source, status, total, paid_at, paid_amount, payment_method) values
  ('72f00000-0000-4000-8000-000000000009', '72b00000-0000-4000-8000-000000000001', 'waiter', 'paid', 90, now(), 90, 'cash');

-- Trei linii ORFANE (product_id NULL = produs șters înaintea migrației).
insert into public.order_items
  (id, order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, item_total) values
  ('72e00000-0000-4000-8000-000000000091', '72f00000-0000-4000-8000-000000000009', null, 'VS Vin pahar', 30, 1, 30),
  ('72e00000-0000-4000-8000-000000000092', '72f00000-0000-4000-8000-000000000009', null, 'VS Ambiguu',   30, 1, 30),
  ('72e00000-0000-4000-8000-000000000093', '72f00000-0000-4000-8000-000000000009', null, 'VS Necunoscut',30, 1, 30),
  ('72e00000-0000-4000-8000-000000000094', '72f00000-0000-4000-8000-000000000009', null, 'VS Reclasificat',30, 1, 30);

-- Jurnalul ștergerilor: „VS Vin pahar" a fost grupa 2 (o singură ștergere),
-- „VS Ambiguu" a purtat grupele 2 și 3, „VS Necunoscut" nu apare deloc.
insert into public.audit_log (table_name, operation, row_id, restaurant_id, old_data) values
  ('products', 'DELETE', '72d00000-0000-4000-8000-000000000091', '72b00000-0000-4000-8000-000000000001',
   jsonb_build_object('name', 'VS Vin pahar', 'vat_group', 2)),
  ('products', 'DELETE', '72d00000-0000-4000-8000-000000000092', '72b00000-0000-4000-8000-000000000001',
   jsonb_build_object('name', 'VS Ambiguu', 'vat_group', 2)),
  ('products', 'DELETE', '72d00000-0000-4000-8000-000000000093', '72b00000-0000-4000-8000-000000000001',
   jsonb_build_object('name', 'VS Ambiguu', 'vat_group', 3));

-- „VS Reclasificat": UN SINGUR produs, mutat din grupa 1 în 2 și abia apoi șters.
-- Rândul DELETE spune 2, dar vânzarea putea fi făcută cât timp era 1 — deci
-- istoricul are 2 grupe și linia trebuie SĂRITĂ. Dacă recuperarea s-ar uita doar
-- la ștergere (ca în prima variantă a scriptului), ar scrie 2 cu aparență de
-- certitudine: fix defectul pe care îl repară mig 272, strecurat înapoi.
insert into public.audit_log (table_name, operation, row_id, restaurant_id, old_data, new_data) values
  ('products', 'UPDATE', '72d00000-0000-4000-8000-000000000094', '72b00000-0000-4000-8000-000000000001',
   jsonb_build_object('name', 'VS Reclasificat', 'vat_group', 1),
   jsonb_build_object('name', 'VS Reclasificat', 'vat_group', 2));
insert into public.audit_log (table_name, operation, row_id, restaurant_id, old_data) values
  ('products', 'DELETE', '72d00000-0000-4000-8000-000000000094', '72b00000-0000-4000-8000-000000000001',
   jsonb_build_object('name', 'VS Reclasificat', 'vat_group', 2));

do $$
declare v_g smallint; v_r numeric;
begin
  -- precondiție: trigger-ul NU a inventat un snapshot pentru linii fără produs
  if exists (select 1 from public.order_items
              where id in ('72e00000-0000-4000-8000-000000000091',
                           '72e00000-0000-4000-8000-000000000092',
                           '72e00000-0000-4000-8000-000000000093',
                           '72e00000-0000-4000-8000-000000000094')
                and vat_group_snapshot is not null) then
    raise exception 'VS9 precondiție FAIL: o linie fără produs a primit snapshot la INSERT'; end if;
end $$;

\ir ../../scripts/recover_orphan_vat_snapshots.sql

do $$
declare v_g smallint; v_r numeric;
begin
  select vat_group_snapshot, vat_rate_snapshot into v_g, v_r
    from public.order_items where id = '72e00000-0000-4000-8000-000000000091';
  if v_g is distinct from 2::smallint or v_r is distinct from 21.00 then
    raise exception 'VS9 FAIL: linia orfană cu potrivire UNICĂ nu a fost recuperată la grupa 2 / 21 (găsit %, %)', v_g, v_r; end if;

  select vat_group_snapshot into v_g
    from public.order_items where id = '72e00000-0000-4000-8000-000000000092';
  if v_g is not null then
    raise exception 'VS9 FAIL: linia AMBIGUĂ (nume cu grupe 2 și 3) a primit grupa % — trebuia SĂRITĂ', v_g; end if;

  select vat_group_snapshot into v_g
    from public.order_items where id = '72e00000-0000-4000-8000-000000000093';
  if v_g is not null then
    raise exception 'VS9 FAIL: linia FĂRĂ potrivire în jurnal a primit grupa %', v_g; end if;

  select vat_group_snapshot into v_g
    from public.order_items where id = '72e00000-0000-4000-8000-000000000094';
  if v_g is not null then
    raise exception 'VS9 FAIL: produsul RECLASIFICAT înainte de ștergere (1 → 2) a primit grupa % — istoricul are două grupe, linia trebuia SĂRITĂ', v_g; end if;

  -- idempotență: a doua rulare nu rescrie nimic (se atinge doar snapshot NULL)
  raise notice 'VS9 OK: orfan cu potrivire unică → grupa 2/21 din jurnal; ambiguul, reclasificatul și necunoscutul rămân pe fallback';
end $$;

select 'VAT RATE SNAPSHOT ASSERTIONS: VS1–VS9 PASS' as result;

rollback;

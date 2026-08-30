-- tests/sql/anon_rate_limit_assertions.sql
-- =============================================================================
-- Aserții pentru mig 261 (plafoane pe scrierile/citirile anon de analytics).
-- Self-contained, ROLLBACK la final. now() e fix în tranzacție → toate
-- apelurile cad în ACELAȘI bucket de rate-limit → plafoanele sunt deterministe.
--
--   AR1  record_qr_scan: token valid → rând în qr_scans (control pozitiv);
--        token străin/greșit → skip tăcut, zero rânduri.
--   AR2  record_qr_scan: peste plafonul 300/15min per restaurant → inserturile
--        se opresc TĂCUT la 300 (fără eroare).
--   AR3  record_page_view: product_id al ALTUI restaurant → view-ul se scrie
--        cu product_id NULL (semnal păstrat, poluare cross-tenant moartă);
--        product_id propriu → se scrie intact.
--   AR4  preview_referral: sub plafon răspunde valid/invalid normal; peste
--        plafonul global 600/15min → {valid:false, rate_limited:true}, fără
--        să dezvăluie dacă codul există.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('61000000-0000-4000-8000-000000000001','ar-owner1@ar.test'),
  ('61000000-0000-4000-8000-000000000002','ar-owner2@ar.test');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('61b00000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','AR One','ar-one','Cluj',true),
  ('61b00000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002','AR Two','ar-two','Cluj',true);

insert into public.tables (id, restaurant_id, name, slug, is_active) values
  ('61c00000-0000-4000-8000-000000000001','61b00000-0000-4000-8000-000000000001','Masa AR1','masa-ar1',true);
insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
  ('61d00000-0000-4000-8000-000000000001','61b00000-0000-4000-8000-000000000001',
   '61c00000-0000-4000-8000-000000000001','tok_ar_one',true);

insert into public.categories (id, restaurant_id, name) values
  ('61e00000-0000-4000-8000-000000000001','61b00000-0000-4000-8000-000000000001','AR Cat 1'),
  ('61e00000-0000-4000-8000-000000000002','61b00000-0000-4000-8000-000000000002','AR Cat 2');
insert into public.products (id, restaurant_id, category_id, name, price) values
  ('61f00000-0000-4000-8000-000000000001','61b00000-0000-4000-8000-000000000001',
   '61e00000-0000-4000-8000-000000000001','Produs propriu',10),
  ('61f00000-0000-4000-8000-000000000002','61b00000-0000-4000-8000-000000000002',
   '61e00000-0000-4000-8000-000000000002','Produs străin',20);

-- ── AR1: token valid → rând; token invalid → skip tăcut ─────────────────────
do $$
declare v_cnt int;
begin
  perform public.record_qr_scan('61b00000-0000-4000-8000-000000000001',
                                '61d00000-0000-4000-8000-000000000001');
  select count(*) into v_cnt from public.qr_scans
   where restaurant_id = '61b00000-0000-4000-8000-000000000001';
  if v_cnt <> 1 then
    raise exception 'AR1 FAIL: scanarea validă nu a scris rândul (%)', v_cnt; end if;

  -- Token care nu aparține restaurantului → skip fără eroare.
  perform public.record_qr_scan('61b00000-0000-4000-8000-000000000002',
                                '61d00000-0000-4000-8000-000000000001');
  select count(*) into v_cnt from public.qr_scans
   where restaurant_id = '61b00000-0000-4000-8000-000000000002';
  if v_cnt <> 0 then
    raise exception 'AR1 FAIL: token străin a produs rând (%)', v_cnt; end if;
  raise notice 'AR1 OK: scan valid scrie, token străin = skip tăcut';
end $$;

-- ── AR2: plafonul 300/15min per restaurant, depășire TĂCUTĂ ─────────────────
do $$
declare v_cnt int; i int;
begin
  -- Deja 1 scan din AR1 → mai chemăm 320; plafonul trebuie să taie la 300.
  for i in 1..320 loop
    perform public.record_qr_scan('61b00000-0000-4000-8000-000000000001',
                                  '61d00000-0000-4000-8000-000000000001');
  end loop;
  select count(*) into v_cnt from public.qr_scans
   where restaurant_id = '61b00000-0000-4000-8000-000000000001';
  if v_cnt <> 300 then
    raise exception 'AR2 FAIL: plafonul nu a tăiat la 300 (rânduri: %)', v_cnt; end if;
  raise notice 'AR2 OK: 321 apeluri → exact 300 rânduri, fără nicio eroare';
end $$;

-- ── AR3: product_id cross-tenant se anulează; cel propriu rămâne ────────────
do $$
declare v_cnt int;
begin
  -- Produs PROPRIU → view cu product_id intact.
  perform public.record_page_view('61b00000-0000-4000-8000-000000000001',
                                  '61f00000-0000-4000-8000-000000000001');
  select count(*) into v_cnt from public.page_views
   where restaurant_id = '61b00000-0000-4000-8000-000000000001'
     and product_id = '61f00000-0000-4000-8000-000000000001';
  if v_cnt <> 1 then
    raise exception 'AR3 FAIL: view-ul cu produs propriu nu s-a scris intact'; end if;

  -- Produs al ALTUI restaurant → view-ul se scrie, dar product_id devine NULL.
  perform public.record_page_view('61b00000-0000-4000-8000-000000000001',
                                  '61f00000-0000-4000-8000-000000000002');
  select count(*) into v_cnt from public.page_views
   where restaurant_id = '61b00000-0000-4000-8000-000000000001'
     and product_id = '61f00000-0000-4000-8000-000000000002';
  if v_cnt <> 0 then
    raise exception 'AR3 FAIL: product_id cross-tenant a supraviețuit (poluare!)'; end if;
  select count(*) into v_cnt from public.page_views
   where restaurant_id = '61b00000-0000-4000-8000-000000000001'
     and product_id is null;
  if v_cnt <> 1 then
    raise exception 'AR3 FAIL: view-ul cu produs străin nu s-a scris cu NULL (%)', v_cnt; end if;
  raise notice 'AR3 OK: produs propriu intact, produs străin anulat la NULL';
end $$;

-- ── AR4: preview_referral — normal sub plafon, marker peste plafonul global ──
do $$
declare v jsonb; i int;
begin
  v := public.preview_referral('cod-inexistent');
  if (v->>'valid')::boolean is not false or v ? 'rate_limited' then
    raise exception 'AR4 FAIL: răspunsul normal sub plafon e greșit (%)', v; end if;

  -- Epuizăm plafonul global (600/15min; 1 apel consumat mai sus).
  for i in 1..599 loop
    perform public.preview_referral('scan-'||i);
  end loop;
  v := public.preview_referral('cod-inexistent');
  if (v->>'rate_limited')::boolean is not true then
    raise exception 'AR4 FAIL: apelul 601 nu e rate_limited (%)', v; end if;
  if (v->>'valid')::boolean is not false then
    raise exception 'AR4 FAIL: răspunsul rate_limited trebuie să rămână valid:false'; end if;
  raise notice 'AR4 OK: plafonul global anti-enumerare taie la 600, degradare grațioasă';
end $$;

select 'ANON RATE LIMIT ASSERTIONS: AR1–AR4 PASS' as result;

rollback;

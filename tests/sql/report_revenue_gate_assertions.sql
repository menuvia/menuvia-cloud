-- tests/sql/report_revenue_gate_assertions.sql
-- =============================================================================
-- Asserții pentru mig 122: rapoartele report_by_* gate-uiesc VENITUL pe Plan 3.
-- Un membru Plan 2 (growth) primește structura operațională, dar venitul = 0.
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
--
--   RG1  growth: report_by_waiter → total_revenue = 0 (gate), order_count păstrat
--   RG2  pro:    report_by_waiter → total_revenue = real (control pozitiv)
--   RG3  report_by_hour/category: venit 0 pe growth, real pe pro
--   RG4  restaurant_has_feature: false pe growth, true pe pro
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('a1a1a1a1-1111-4111-8111-111111111111','rgrowth@rep.test'),
  ('a2a2a2a2-2222-4222-8222-222222222222','rpro@rep.test');
update public.profiles set plan='growth' where id='a1a1a1a1-1111-4111-8111-111111111111';
update public.profiles set plan='pro'    where id='a2a2a2a2-2222-4222-8222-222222222222';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b1b1b1b1-1111-4111-8111-111111111111','a1a1a1a1-1111-4111-8111-111111111111','Rg','rg-rep','Cluj',true),
  ('b2b2b2b2-2222-4222-8222-222222222222','a2a2a2a2-2222-4222-8222-222222222222','Rp','rp-rep','Cluj',true);

-- Comenzi 'served' atribuite owner-ului (served_by), total 100.
insert into public.orders (restaurant_id, source, status, total, served_by, created_by) values
  ('b1b1b1b1-1111-4111-8111-111111111111','qr','served',100,
   'a1a1a1a1-1111-4111-8111-111111111111','a1a1a1a1-1111-4111-8111-111111111111'),
  ('b2b2b2b2-2222-4222-8222-222222222222','qr','served',100,
   'a2a2a2a2-2222-4222-8222-222222222222','a2a2a2a2-2222-4222-8222-222222222222');

-- ── RG4: helper boolean ──────────────────────────────────────────────────────
do $$
begin
  if public.restaurant_has_feature('b1b1b1b1-1111-4111-8111-111111111111','fiscal_receipt') then
    raise exception 'RG4 FAIL: growth NU ar trebui să aibă fiscal_receipt'; end if;
  if not public.restaurant_has_feature('b2b2b2b2-2222-4222-8222-222222222222','fiscal_receipt') then
    raise exception 'RG4 FAIL: pro ar trebui să aibă fiscal_receipt'; end if;
  raise notice 'RG4 OK: restaurant_has_feature(growth)=false, (pro)=true';
end $$;

-- ── RG1: growth → venit gate-uit, structură păstrată ─────────────────────────
do $$
declare v_rev numeric; v_cnt bigint;
begin
  perform set_config('request.jwt.claim.sub','a1a1a1a1-1111-4111-8111-111111111111', true);
  select coalesce(sum(total_revenue),0), coalesce(sum(order_count),0)
    into v_rev, v_cnt
    from public.report_by_waiter('b1b1b1b1-1111-4111-8111-111111111111', now() - interval '1 day', now() + interval '1 day');
  if v_cnt < 1 then raise exception 'RG1 FAIL: order_count operațional pierdut (%)', v_cnt; end if;
  if v_rev <> 0 then raise exception 'RG1 FAIL: LEAK — growth vede venit % (așteptat 0)', v_rev; end if;
  raise notice 'RG1 OK: growth → total_revenue=0, order_count=% (structură păstrată)', v_cnt;
end $$;

-- ── RG2: pro → venit real (control pozitiv) ──────────────────────────────────
do $$
declare v_rev numeric;
begin
  perform set_config('request.jwt.claim.sub','a2a2a2a2-2222-4222-8222-222222222222', true);
  select coalesce(sum(total_revenue),0) into v_rev
    from public.report_by_waiter('b2b2b2b2-2222-4222-8222-222222222222', now() - interval '1 day', now() + interval '1 day');
  if v_rev <> 100 then raise exception 'RG2 FAIL: pro venit % (așteptat 100)', v_rev; end if;
  raise notice 'RG2 OK: pro → total_revenue=100 (control pozitiv)';
end $$;

-- ── RG3: report_by_hour + report_by_category gate-uiesc venitul pe growth ─────
do $$
declare v_hour numeric; v_cat numeric;
begin
  perform set_config('request.jwt.claim.sub','a1a1a1a1-1111-4111-8111-111111111111', true);
  select coalesce(sum(total_revenue),0) into v_hour
    from public.report_by_hour('b1b1b1b1-1111-4111-8111-111111111111', now() - interval '1 day', now() + interval '1 day');
  if v_hour <> 0 then raise exception 'RG3 FAIL: report_by_hour venit % pe growth (așteptat 0)', v_hour; end if;
  select coalesce(sum(total_revenue),0) into v_cat
    from public.report_by_category('b1b1b1b1-1111-4111-8111-111111111111', now() - interval '1 day', now() + interval '1 day');
  if v_cat <> 0 then raise exception 'RG3 FAIL: report_by_category venit % pe growth (așteptat 0)', v_cat; end if;
  raise notice 'RG3 OK: report_by_hour + report_by_category → venit 0 pe growth';
end $$;

do $$ begin raise notice '════ report revenue gate assertions: ALL PASS ════'; end $$;

rollback;

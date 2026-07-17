-- tests/sql/white_label_benchmark_assertions.sql
-- =============================================================================
-- Aserții pentru mig 236/237 (white-label v1 + benchmark lunar founder):
--   WB1  admin_set_affiliate_branding: normalizează domeniul (protocol/case/
--        cale), respinge domeniile rezervate și formatele invalide; non-admin
--        e respins.
--   WB2  resolve_agency_branding (anon): răspunde case-insensitive DOAR pentru
--        afiliați activi — pending nu răspunde; whitelist de 2 câmpuri.
--   WB3  admin_list_affiliates (lanț →236) include câmpurile de branding.
--   WB4  admin_monthly_benchmark: comenzile se numără pe TOATE planurile,
--        banii DOAR pe fiscal_receipt (growth → revenue null); non-admin
--        respins.
--   WB5  Unicitatea domeniului: al doilea afiliat cu același domeniu →
--        domain_taken.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1b10000-0000-4000-8000-0000000000e5','wb-admin@wb.test'),
  ('a1b20000-0000-4000-8000-0000000000e6','wb-agency@wb.test'),
  ('a1b30000-0000-4000-8000-0000000000e7','wb-pending@wb.test'),
  ('a1b40000-0000-4000-8000-0000000000e8','wb-owner-pro@wb.test'),
  ('a1b50000-0000-4000-8000-0000000000e9','wb-owner-growth@wb.test');

update public.profiles set is_platform_admin = true
 where id = 'a1b10000-0000-4000-8000-0000000000e5';
update public.profiles set plan = 'pro'
 where id = 'a1b40000-0000-4000-8000-0000000000e8';
update public.profiles set plan = 'growth'
 where id = 'a1b50000-0000-4000-8000-0000000000e9';

-- Afiliați: unul activ (default-ul coloanei), unul pending.
insert into public.affiliates (id, profile_id, referral_code) values
  ('b2c10000-0000-4000-8000-0000000000e5','a1b20000-0000-4000-8000-0000000000e6','wbagency1');
insert into public.affiliates (id, profile_id, referral_code, status) values
  ('b2c20000-0000-4000-8000-0000000000e6','a1b30000-0000-4000-8000-0000000000e7','wbpend01','pending');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('c3d10000-0000-4000-8000-0000000000e5','a1b40000-0000-4000-8000-0000000000e8',
   'WB Pro','wb-pro-slug','Cluj',true),
  ('c3d20000-0000-4000-8000-0000000000e6','a1b50000-0000-4000-8000-0000000000e9',
   'WB Growth','wb-growth-slug','Cluj',true);

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('c3d10000-0000-4000-8000-0000000000e5','a1b40000-0000-4000-8000-0000000000e8','owner'),
  ('c3d20000-0000-4000-8000-0000000000e6','a1b50000-0000-4000-8000-0000000000e9','owner')
on conflict (restaurant_id, user_id) do nothing;

-- Comenzi în luna curentă: pro = 3 (2 QR, din care 2 plătite 100+50);
-- growth = 2 (1 QR, niciuna paid — fluxul growth se termină în closed).
insert into public.orders (id, restaurant_id, source, status, total, paid_amount, paid_at) values
  ('d4e10000-0000-4000-8000-0000000000e5','c3d10000-0000-4000-8000-0000000000e5','qr','paid',100,100,now()),
  ('d4e20000-0000-4000-8000-0000000000e6','c3d10000-0000-4000-8000-0000000000e5','qr','paid',50,50,now()),
  ('d4e30000-0000-4000-8000-0000000000e7','c3d10000-0000-4000-8000-0000000000e5','waiter','served',30,null,null),
  ('d4e40000-0000-4000-8000-0000000000e8','c3d20000-0000-4000-8000-0000000000e6','qr','closed',40,null,null),
  ('d4e50000-0000-4000-8000-0000000000e9','c3d20000-0000-4000-8000-0000000000e6','waiter','closed',25,null,null);

-- ── WB1: normalizare + validare + gate founder ───────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'a1b10000-0000-4000-8000-0000000000e5';

do $$
declare v jsonb;
begin
  v := public.admin_set_affiliate_branding(
    'b2c10000-0000-4000-8000-0000000000e5',
    'https://Menu.Agentia.RO/vreo/cale', 'Agentia Digital', 'https://cdn.agentia.ro/logo.png');
  if (v->>'ok')::boolean is not true or v->>'brand_domain' <> 'menu.agentia.ro' then
    raise exception 'WB1 FAIL: normalizarea domeniului a eșuat (%)', v;
  end if;

  v := public.admin_set_affiliate_branding(
    'b2c20000-0000-4000-8000-0000000000e6', 'app.menuvia.ro', 'X', null);
  if v->>'error' <> 'reserved_domain' then
    raise exception 'WB1 FAIL: domeniul platformei nu a fost respins (%)', v;
  end if;

  v := public.admin_set_affiliate_branding(
    'b2c20000-0000-4000-8000-0000000000e6', 'nu e domeniu', 'X', null);
  if v->>'error' <> 'invalid_domain' then
    raise exception 'WB1 FAIL: formatul invalid nu a fost respins (%)', v;
  end if;
  raise notice 'WB1 OK: normalizare + validare + rezervate';
end $$;

-- non-admin → respins
set local request.jwt.claim.sub = 'a1b40000-0000-4000-8000-0000000000e8';
do $$
begin
  begin
    perform public.admin_set_affiliate_branding(
      'b2c10000-0000-4000-8000-0000000000e5', 'alt.domeniu.ro', 'X', null);
    raise exception 'WB1 FAIL: non-admin a setat branding';
  exception when others then
    if sqlerrm not ilike '%interzis%' then raise; end if;
  end;
  raise notice 'WB1 OK: non-admin respins';
end $$;

reset role;

-- Domeniu și pe afiliatul pending (direct, ca postgres — RPC-ul refuză doar
-- domeniile invalide, statusul îl filtrează resolve-ul).
update public.affiliates set brand_domain = 'pending.agentia.ro', brand_name = 'Pending SRL'
 where id = 'b2c20000-0000-4000-8000-0000000000e6';

-- ── WB2: resolve anon — doar activi, case-insensitive ────────────────────────
set local role anon;

do $$
declare v_name text;
begin
  select rb.brand_name into v_name
    from public.resolve_agency_branding('MENU.AGENTIA.RO') rb;
  if v_name is distinct from 'Agentia Digital' then
    raise exception 'WB2 FAIL: resolve nu a întors brandingul activ (%)', v_name;
  end if;

  if exists (select 1 from public.resolve_agency_branding('pending.agentia.ro')) then
    raise exception 'WB2 FAIL: afiliatul PENDING răspunde la resolve';
  end if;

  if exists (select 1 from public.resolve_agency_branding('inexistent.ro')) then
    raise exception 'WB2 FAIL: domeniu inexistent a întors rânduri';
  end if;
  raise notice 'WB2 OK: resolve doar pe activi, case-insensitive';
end $$;

reset role;

-- ── WB3: admin_list_affiliates include brandingul ────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'a1b10000-0000-4000-8000-0000000000e5';

do $$
declare v jsonb;
begin
  select elem into v
    from jsonb_array_elements(public.admin_list_affiliates()) elem
   where elem->>'affiliate_id' = 'b2c10000-0000-4000-8000-0000000000e5';
  if v->>'brand_domain' <> 'menu.agentia.ro' or v->>'brand_name' <> 'Agentia Digital' then
    raise exception 'WB3 FAIL: admin_list_affiliates fără branding (%)', v;
  end if;
  raise notice 'WB3 OK: listarea founder include brandingul';
end $$;

-- ── WB4: benchmark lunar — comenzi pe toate planurile, bani doar fiscal ──────
do $$
declare
  v jsonb;
  v_pro jsonb;
  v_growth jsonb;
begin
  v := public.admin_monthly_benchmark();
  if v->>'month' !~ '^\d{4}-\d{2}$' then
    raise exception 'WB4 FAIL: luna lipsă/formatată greșit (%)', v->>'month';
  end if;

  select elem into v_pro from jsonb_array_elements(v->'rows') elem
   where elem->>'restaurant_id' = 'c3d10000-0000-4000-8000-0000000000e5';
  select elem into v_growth from jsonb_array_elements(v->'rows') elem
   where elem->>'restaurant_id' = 'c3d20000-0000-4000-8000-0000000000e6';

  if (v_pro->>'orders')::int <> 3 or (v_growth->>'orders')::int <> 2 then
    raise exception 'WB4 FAIL: numărul de comenzi greșit (pro=%, growth=%)',
      v_pro->>'orders', v_growth->>'orders';
  end if;
  if (v_pro->>'revenue')::numeric <> 150 or (v_pro->>'avg_ticket')::numeric <> 75 then
    raise exception 'WB4 FAIL: venitul pro greșit (%)', v_pro;
  end if;
  -- Regula de aur: growth nu are câmpuri de bani.
  if v_growth->'revenue' <> 'null'::jsonb or v_growth->'avg_ticket' <> 'null'::jsonb then
    raise exception 'WB4 FAIL: growth are câmpuri de bani în benchmark (%)', v_growth;
  end if;
  if (v_pro->>'qr_share_pct')::int <> 67 or (v_growth->>'qr_share_pct')::int <> 50 then
    raise exception 'WB4 FAIL: qr_share greșit (pro=%, growth=%)',
      v_pro->>'qr_share_pct', v_growth->>'qr_share_pct';
  end if;
  if (v->'platform'->>'avg_orders') is null then
    raise exception 'WB4 FAIL: media platformei lipsește';
  end if;
  raise notice 'WB4 OK: benchmark corect + regula de aur pe bani';
end $$;

-- non-admin → respins
set local request.jwt.claim.sub = 'a1b40000-0000-4000-8000-0000000000e8';
do $$
begin
  begin
    perform public.admin_monthly_benchmark();
    raise exception 'WB4 FAIL: non-admin a citit benchmark-ul';
  exception when others then
    if sqlerrm not ilike '%interzis%' then raise; end if;
  end;
  raise notice 'WB4 OK: non-admin respins';
end $$;

-- ── WB5: unicitatea domeniului ───────────────────────────────────────────────
set local request.jwt.claim.sub = 'a1b10000-0000-4000-8000-0000000000e5';
do $$
declare v jsonb;
begin
  v := public.admin_set_affiliate_branding(
    'b2c20000-0000-4000-8000-0000000000e6', 'menu.agentia.ro', 'Copiator SRL', null);
  if v->>'error' <> 'domain_taken' then
    raise exception 'WB5 FAIL: domeniul duplicat nu a fost respins (%)', v;
  end if;
  raise notice 'WB5 OK: un domeniu = o agenție';
end $$;

reset role;

select 'WHITE-LABEL + BENCHMARK ASSERTIONS: WB1–WB5 PASS' as result;

rollback;

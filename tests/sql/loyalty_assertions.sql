-- tests/sql/loyalty_assertions.sql
-- =============================================================================
-- Aserții pentru mig 226 (Loyalty v1): puncte per comandă + prag → recompensă.
--
--   LY1  Gate de plan: restaurant pe 'starter' (modul ON + program activ) →
--        get_loyalty_state întoarce enabled=false (loyalty e growth+).
--   LY2  Attach: loyalty_attach_order cu anon_id pe o comandă proaspătă →
--        ok + short_code; orders.loyalty_wallet_id setat; re-attach → already_attached.
--   LY3  Earn: tranziția status→'closed' (fluxul growth — 'paid' e gate-uit
--        fiscal pe Plan 3!) acordă floor(total × points_per_leu) puncte,
--        exact UN event 'earn' per comandă (idempotent la retrigger).
--   LY4  Upgrade identitate: telefonul upgrade-ază wallet-ul anonim (punctele
--        se păstrează), iar un „alt browser" doar cu telefonul regăsește
--        ACELAȘI wallet. Telefonul NU e stocat brut (doar md5).
--   LY5  Redeem: staff-ul răscumpără pe short_code (punctele scad cu pragul,
--        event 'redeem' logat); sub prag → not_enough_points.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('11a1a1a1-1111-4111-8111-aaaaaaaaaaaa','ly-owner-growth@ly.test'),
  ('12a2a2a2-2222-4222-8222-aaaaaaaaaaaa','ly-owner-starter@ly.test');

update public.profiles set plan = 'growth'
 where id = '11a1a1a1-1111-4111-8111-aaaaaaaaaaaa';
update public.profiles set plan = 'starter'
 where id = '12a2a2a2-2222-4222-8222-aaaaaaaaaaaa';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('21b1b1b1-1111-4111-8111-bbbbbbbbbbbb','11a1a1a1-1111-4111-8111-aaaaaaaaaaaa',
   'LY Growth','ly-growth-slug','Cluj',true),
  ('22b2b2b2-2222-4222-8222-bbbbbbbbbbbb','12a2a2a2-2222-4222-8222-aaaaaaaaaaaa',
   'LY Starter','ly-starter-slug','Cluj',true);

-- Membership pentru redeem (is_member) — de regulă e creat automat de
-- trigger la INSERT-ul restaurantului; on conflict acoperă ambele lumi.
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('21b1b1b1-1111-4111-8111-bbbbbbbbbbbb','11a1a1a1-1111-4111-8111-aaaaaaaaaaaa','owner')
on conflict (restaurant_id, user_id) do nothing;

insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('21b1b1b1-1111-4111-8111-bbbbbbbbbbbb','loyalty',true),
  ('22b2b2b2-2222-4222-8222-bbbbbbbbbbbb','loyalty',true);

insert into public.loyalty_programs (restaurant_id, points_per_leu, reward_threshold, reward_description) values
  ('21b1b1b1-1111-4111-8111-bbbbbbbbbbbb', 1, 30, 'Un desert din partea casei'),
  ('22b2b2b2-2222-4222-8222-bbbbbbbbbbbb', 1, 30, 'O cafea');

insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('31c1c1c1-1111-4111-8111-cccccccccccc','21b1b1b1-1111-4111-8111-bbbbbbbbbbbb','Masa LY1','masa-ly1',4,true),
  ('32c2c2c2-2222-4222-8222-cccccccccccc','22b2b2b2-2222-4222-8222-bbbbbbbbbbbb','Masa LYS','masa-lys',4,true);

insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
  ('41d1d1d1-1111-4111-8111-dddddddddddd','21b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
   '31c1c1c1-1111-4111-8111-cccccccccccc','tok_ly_growth',true),
  ('42d2d2d2-2222-4222-8222-dddddddddddd','22b2b2b2-2222-4222-8222-bbbbbbbbbbbb',
   '32c2c2c2-2222-4222-8222-cccccccccccc','tok_ly_starter',true);

insert into public.orders (id, restaurant_id, source, status, total, table_id, qr_token_id) values
  ('51f1f1f1-1111-4111-8111-ffffffffffff','21b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',30,
   '31c1c1c1-1111-4111-8111-cccccccccccc','41d1d1d1-1111-4111-8111-dddddddddddd'),
  ('52f2f2f2-2222-4222-8222-ffffffffffff','21b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',20,
   '31c1c1c1-1111-4111-8111-cccccccccccc','41d1d1d1-1111-4111-8111-dddddddddddd'),
  ('53f3f3f3-3333-4333-8333-ffffffffffff','21b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',10,
   '31c1c1c1-1111-4111-8111-cccccccccccc','41d1d1d1-1111-4111-8111-dddddddddddd');

-- ── LY1: gate de plan — starter cu modul ON + program activ → enabled=false ──
do $$
declare v jsonb;
begin
  v := public.get_loyalty_state('42d2d2d2-2222-4222-8222-dddddddddddd', 'anon_ly_starter_1');
  if (v->>'enabled')::boolean is not false then
    raise exception 'LY1 FAIL: loyalty activ pe starter (%)', v;
  end if;
  raise notice 'LY1 OK: gate de plan (starter → enabled=false)';
end $$;

-- ── LY2: attach cu anon_id → wallet nou + comanda legată; re-attach respins ──
do $$
declare v jsonb; v_wid uuid;
begin
  v := public.loyalty_attach_order('51f1f1f1-1111-4111-8111-ffffffffffff',
        '41d1d1d1-1111-4111-8111-dddddddddddd', 'anon_ly_client_1');
  if (v->>'ok')::boolean is not true or v->>'short_code' !~ '^[A-Z0-9]{6}$' then
    raise exception 'LY2 FAIL: attach valid respins (%)', v;
  end if;
  select loyalty_wallet_id into v_wid from public.orders
   where id = '51f1f1f1-1111-4111-8111-ffffffffffff';
  if v_wid is null then
    raise exception 'LY2 FAIL: comanda nu a fost legată de wallet';
  end if;
  v := public.loyalty_attach_order('51f1f1f1-1111-4111-8111-ffffffffffff',
        '41d1d1d1-1111-4111-8111-dddddddddddd', 'anon_ly_client_1');
  if v->>'reason' is distinct from 'already_attached' then
    raise exception 'LY2 FAIL: re-attach nesemnalat (%)', v;
  end if;
  raise notice 'LY2 OK: attach + comanda legată + re-attach respins';
end $$;

-- ── LY3: earn la închiderea comenzii (growth) — 30 puncte, UN singur event ──
-- 'paid' ar fi respins de enforce_paid_status_gate (fiscal = Plan 3), deci
-- fluxul real pe growth e status → 'closed' (mig 085).
do $$
declare v_pts int; v_events int;
begin
  update public.orders set status = 'closed'
   where id = '51f1f1f1-1111-4111-8111-ffffffffffff';
  select w.points into v_pts from public.loyalty_wallets w
   where w.restaurant_id = '21b1b1b1-1111-4111-8111-bbbbbbbbbbbb'
     and w.anon_id = 'anon_ly_client_1';
  if v_pts is distinct from 30 then
    raise exception 'LY3 FAIL: puncte după closed ar trebui 30, sunt: %', v_pts;
  end if;
  -- Retrigger pe aceeași comandă deja închisă → nimic nou (guard old terminal).
  update public.orders set status = 'closed'
   where id = '51f1f1f1-1111-4111-8111-ffffffffffff';
  select count(*) into v_events from public.loyalty_events
   where order_id = '51f1f1f1-1111-4111-8111-ffffffffffff' and kind = 'earn';
  if v_events <> 1 then
    raise exception 'LY3 FAIL: % evenimente earn pe aceeași comandă', v_events;
  end if;
  raise notice 'LY3 OK: earn 30 puncte la closed, exact 1 event (idempotent)';
end $$;

-- ── LY4: telefonul upgrade-ază wallet-ul anonim; alt device îl regăsește ────
do $$
declare v jsonb; v_hash text; v_raw int;
begin
  -- A doua comandă: același anon_id + telefon → upgrade pe ACELAȘI wallet.
  v := public.loyalty_attach_order('52f2f2f2-2222-4222-8222-ffffffffffff',
        '41d1d1d1-1111-4111-8111-dddddddddddd', 'anon_ly_client_1', '0712 345 678');
  if (v->>'ok')::boolean is not true or (v->>'points')::int is distinct from 30 then
    raise exception 'LY4 FAIL: upgrade-ul a pierdut punctele (%)', v;
  end if;
  select phone_hash into v_hash from public.loyalty_wallets
   where restaurant_id = '21b1b1b1-1111-4111-8111-bbbbbbbbbbbb'
     and anon_id = 'anon_ly_client_1';
  if v_hash is distinct from md5('0712345678') then
    raise exception 'LY4 FAIL: phone_hash lipsă/greșit după upgrade';
  end if;
  -- Telefonul NU apare brut nicăieri în wallet.
  select count(*) into v_raw from public.loyalty_wallets
   where phone_hash like '%0712%' or anon_id like '%0712%' or short_code like '%0712%';
  if v_raw <> 0 then
    raise exception 'LY4 FAIL: telefon stocat brut!';
  end if;
  -- „Alt browser": doar telefonul → același wallet (fără dublură).
  v := public.loyalty_attach_order('53f3f3f3-3333-4333-8333-ffffffffffff',
        '41d1d1d1-1111-4111-8111-dddddddddddd', null, '+40 712-345-678');
  if (v->>'ok')::boolean is not true or (v->>'points')::int is distinct from 30 then
    raise exception 'LY4 FAIL: lookup pe telefon nu regăsește wallet-ul (%)', v;
  end if;
  if (select count(*) from public.loyalty_wallets
      where restaurant_id = '21b1b1b1-1111-4111-8111-bbbbbbbbbbbb') <> 1 then
    raise exception 'LY4 FAIL: wallet duplicat pe același client';
  end if;
  raise notice 'LY4 OK: upgrade telefon + regăsire cross-device, fără telefon brut';
end $$;

-- ── LY5: redeem staff-only pe short_code ─────────────────────────────────────
do $$
declare v jsonb; v_code text; v_pts int;
begin
  perform set_config('request.jwt.claim.sub', '11a1a1a1-1111-4111-8111-aaaaaaaaaaaa', true);
  select short_code into v_code from public.loyalty_wallets
   where restaurant_id = '21b1b1b1-1111-4111-8111-bbbbbbbbbbbb'
     and anon_id = 'anon_ly_client_1';
  -- 30 puncte, prag 30 → redeem trece; punctele ajung 0.
  v := public.redeem_loyalty_reward('21b1b1b1-1111-4111-8111-bbbbbbbbbbbb', lower(v_code));
  if (v->>'ok')::boolean is not true
     or v->>'reward_description' is distinct from 'Un desert din partea casei' then
    raise exception 'LY5 FAIL: redeem valid respins (%)', v;
  end if;
  select points into v_pts from public.loyalty_wallets
   where restaurant_id = '21b1b1b1-1111-4111-8111-bbbbbbbbbbbb'
     and anon_id = 'anon_ly_client_1';
  if v_pts <> 0 then
    raise exception 'LY5 FAIL: punctele după redeem ar trebui 0, sunt %', v_pts;
  end if;
  -- Sub prag → refuz clar, punctele neatinse.
  v := public.redeem_loyalty_reward('21b1b1b1-1111-4111-8111-bbbbbbbbbbbb', v_code);
  if v->>'reason' is distinct from 'not_enough_points' then
    raise exception 'LY5 FAIL: redeem sub prag acceptat (%)', v;
  end if;
  if (select count(*) from public.loyalty_events le
      join public.loyalty_wallets w on w.id = le.wallet_id
      where w.restaurant_id = '21b1b1b1-1111-4111-8111-bbbbbbbbbbbb'
        and le.kind = 'redeem') <> 1 then
    raise exception 'LY5 FAIL: evenimentul de redeem nelogat/duplicat';
  end if;
  raise notice 'LY5 OK: redeem pe cod (case-insensitive) + refuz sub prag';
end $$;

do $$ begin raise notice '════ loyalty assertions: ALL PASS ════'; end $$;

rollback;

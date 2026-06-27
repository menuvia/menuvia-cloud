-- tests/sql/platform_security_assertions.sql
-- =============================================================================
-- Asserții pentru fix-urile de securitate ale platformei (mig 111 + 112), găsite
-- la auditul critic Plan 1+2. Self-contained, ROLLBACK la final.
--
--   PS1  add_partial_payment pe growth (fără fiscal_receipt) → BLOCAT (regula de aur)
--   PS2  add_partial_payment ca rol 'kitchen' → BLOCAT (rol insuficient)
--   PS3  add_partial_payment pe pro + owner → OK, comanda devine 'paid' (control +)
--   PS4  ingredients_low_stock: un user fără membership NU vede ingrediente (security_invoker)
--   PS5  qr_tokens: owner-ul restaurantului A NU vede token-urile restaurantului B (RLS)
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Setup (ca postgres; handle_new_user creează profilurile) ─────────────────
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','og@plat.test'),
  ('22222222-2222-2222-2222-222222222222','op@plat.test'),
  ('33333333-3333-3333-3333-333333333333','ok@plat.test'),
  ('44444444-4444-4444-4444-444444444444','ox@plat.test'),
  ('55555555-5555-5555-5555-555555555555','oa@plat.test'),
  ('66666666-6666-6666-6666-666666666666','ob@plat.test');

update public.profiles set plan='growth' where id='11111111-1111-1111-1111-111111111111';
update public.profiles set plan='pro'    where id='22222222-2222-2222-2222-222222222222';
update public.profiles set plan='pro'    where id='55555555-5555-5555-5555-555555555555';
update public.profiles set plan='pro'    where id='66666666-6666-6666-6666-666666666666';

-- Restaurante (trigger bootstrap creează owner membership + VAT defaults).
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('a1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','Rg','rg-plat','Cluj',true),
  ('b2222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','Rp','rp-plat','Cluj',true),
  ('c5555555-5555-5555-5555-555555555555','55555555-5555-5555-5555-555555555555','Ra','ra-plat','Cluj',true),
  ('d6666666-6666-6666-6666-666666666666','66666666-6666-6666-6666-666666666666','Rb','rb-plat','Cluj',true);

-- Membru kitchen pe restaurantul pro.
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('b2222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','kitchen')
  on conflict do nothing;

-- Comenzi 'served' (Gate A permite ordering pe growth/pro).
insert into public.orders (id, restaurant_id, source, status, total) values
  ('f1111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','qr','served',100),
  ('f2222222-2222-2222-2222-222222222222','b2222222-2222-2222-2222-222222222222','qr','served',100),
  ('f3333333-3333-3333-3333-333333333333','b2222222-2222-2222-2222-222222222222','qr','served',100);

-- Ingredient pentru testul de view (pe restaurantul pro).
insert into public.ingredients (restaurant_id, name, unit) values
  ('b2222222-2222-2222-2222-222222222222','Făină','kg');

-- Mese + token-uri QR pentru testul cross-tenant.
insert into public.tables (id, restaurant_id, name, slug, is_active) values
  ('e5555555-5555-5555-5555-555555555555','c5555555-5555-5555-5555-555555555555','MasaA','masa-a',true),
  ('e6666666-6666-6666-6666-666666666666','d6666666-6666-6666-6666-666666666666','MasaB','masa-b',true);
insert into public.qr_tokens (restaurant_id, table_id, is_active) values
  ('c5555555-5555-5555-5555-555555555555','e5555555-5555-5555-5555-555555555555',true),
  ('d6666666-6666-6666-6666-666666666666','e6666666-6666-6666-6666-666666666666',true);

-- ── PS1: growth nu poate încasa (gate fiscal) ────────────────────────────────
do $$
declare v_blocked boolean := false;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  begin
    perform public.add_partial_payment('f1111111-1111-1111-1111-111111111111', 100, 'cash');
  exception when others then
    if sqlerrm ilike '%disponibil%' or sqlerrm ilike '%feature%' or sqlerrm ilike '%plan%' or sqlerrm ilike '%Plan 3%'
      then v_blocked := true; else raise exception 'PS1: eroare neașteptată: %', sqlerrm; end if;
  end;
  if not v_blocked then raise exception 'PS1 FAIL: growth a putut încasa (gate fiscal absent)'; end if;
  if (select status from public.orders where id='f1111111-1111-1111-1111-111111111111') = 'paid' then
    raise exception 'PS1 FAIL: comanda growth a ajuns paid'; end if;
  raise notice 'PS1 OK: growth blocat la încasare (regula de aur)';
end $$;

-- ── PS2: rol kitchen nu poate încasa ─────────────────────────────────────────
do $$
declare v_blocked boolean := false;
begin
  perform set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
  begin
    perform public.add_partial_payment('f3333333-3333-3333-3333-333333333333', 100, 'cash');
  exception when others then
    if sqlerrm ilike '%drept%' or sqlerrm ilike '%rol%' or sqlerrm ilike '%acces%'
      then v_blocked := true; else raise exception 'PS2: eroare neașteptată: %', sqlerrm; end if;
  end;
  if not v_blocked then raise exception 'PS2 FAIL: kitchen a putut încasa'; end if;
  raise notice 'PS2 OK: rol kitchen blocat la încasare';
end $$;

-- ── PS3: control pozitiv — pro + owner încasează → paid ──────────────────────
do $$
begin
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  perform public.add_partial_payment('f2222222-2222-2222-2222-222222222222', 100, 'cash');
  if (select status from public.orders where id='f2222222-2222-2222-2222-222222222222') <> 'paid' then
    raise exception 'PS3 FAIL: pro+owner nu a ajuns paid'; end if;
  raise notice 'PS3 OK: pro+owner încasează (control pozitiv)';
end $$;

-- ── PS6: comanda nu poate refere masa altui restaurant (mig 113) ─────────────
do $$
declare v_blocked boolean := false;
begin
  begin
    -- restaurant A (Ra/pro) cu masa restaurantului B → trebuie respins.
    insert into public.orders (restaurant_id, source, status, total, table_id)
    values ('c5555555-5555-5555-5555-555555555555','waiter','served',50,
            'e6666666-6666-6666-6666-666666666666');
  exception when others then
    if sqlerrm ilike '%aparține%' or sqlerrm ilike '%restaurant%' then v_blocked := true;
    else raise exception 'PS6: eroare neașteptată: %', sqlerrm; end if;
  end;
  if not v_blocked then raise exception 'PS6 FAIL: comandă cu masa altui restaurant acceptată'; end if;
  -- control pozitiv: masa proprie trece.
  insert into public.orders (restaurant_id, source, status, total, table_id)
  values ('c5555555-5555-5555-5555-555555555555','waiter','served',50,
          'e5555555-5555-5555-5555-555555555555');
  raise notice 'PS6 OK: masă străină respinsă, masă proprie acceptată';
end $$;

-- ── PS4 + PS5: izolare multi-tenant ca rol authenticated ─────────────────────
set local role authenticated;

do $$
declare n int;
begin
  -- PS4: user fără membership nu vede ingrediente prin view (security_invoker).
  perform set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444', true);
  select count(*) into n from public.ingredients_low_stock;
  if n <> 0 then raise exception 'PS4 FAIL: LEAK — non-membru vede % ingrediente', n; end if;
  raise notice 'PS4 OK: ingredients_low_stock invizibil pentru non-membru (security_invoker)';

  -- PS5: owner-ul A vede token-urile lui A, NU pe ale lui B.
  perform set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555', true);
  select count(*) into n from public.qr_tokens where restaurant_id='d6666666-6666-6666-6666-666666666666';
  if n <> 0 then raise exception 'PS5 FAIL: LEAK — owner A vede % token-uri ale lui B', n; end if;
  select count(*) into n from public.qr_tokens where restaurant_id='c5555555-5555-5555-5555-555555555555';
  if n < 1 then raise exception 'PS5 FAIL: owner A nu-și vede propriile token-uri (% )', n; end if;
  raise notice 'PS5 OK: token-urile QR ale altui restaurant ascunse de RLS';
end $$;

reset role;
do $$ begin raise notice '════ platform security assertions: ALL PASS ════'; end $$;

rollback;

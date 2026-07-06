-- ═══════════════════════════════════════════════════════════════
-- DEMO SEED — Tinctura Café
-- ═══════════════════════════════════════════════════════════════
-- Folosit DOAR pentru dezvoltare / QA local.
-- NU rula pe production.
--
-- Cum rulezi:
--   psql $DATABASE_URL -f supabase/scripts/seed_tinctura_demo.sql
-- sau
--   supabase db execute -f supabase/scripts/seed_tinctura_demo.sql
--
-- Idempotent: on conflict do nothing (rulează sigur de mai multe ori).
-- Necesită migrațiile 049 + 050 aplicate (pentru câmpurile editorial).
--
-- După rulare: deschide http://localhost:5173/m/tinctura

do $$
declare
  v_owner_id   uuid;
  v_rest_id    uuid;
  v_cat_cafea  uuid;
  v_cat_mancare uuid;
  v_cat_desert uuid;
  v_cat_cocktail uuid;
begin
  -- 1. Owner placeholder (folosim primul profil disponibil sau un fake UUID)
  select id into v_owner_id from public.profiles limit 1;
  if v_owner_id is null then
    -- Niciun profil în DB → folosim un UUID hardcoded pentru demo
    v_owner_id := '00000000-0000-0000-0000-000000000001'::uuid;
    insert into public.profiles (id, email, full_name)
      values (v_owner_id, 'demo@tinctura.cafe', 'Tinctura Demo Owner')
      on conflict (id) do nothing;
  end if;

  -- 2. Restaurant
  insert into public.restaurants (
    owner_id, name, slug, tagline, description, address, phone, hours,
    primary_color, language, currency, is_active,
    amenities, hours_structured, wifi_password, timezone,
    socials, theme_settings, pickup_settings
  ) values (
    v_owner_id,
    'Tinctura Café',
    'tinctura',
    'O cafenea cu suflet',
    'Cafenea de specialitate cu preparate de casă, în inima orașului.',
    'Strada Lipscani 23, București',
    '0721 234 567',
    'Lun–Vin 08:00–23:00 · Sâm–Dum 09:00–24:00',
    '#C56B5A',
    'ro',
    'RON',
    true,
    array['wifi', 'vegan_options', 'outdoor_seating', 'cards', 'pet_friendly'],
    jsonb_build_object(
      'mon', jsonb_build_object('open', '08:00', 'close', '23:00', 'closed', false),
      'tue', jsonb_build_object('open', '08:00', 'close', '23:00', 'closed', false),
      'wed', jsonb_build_object('open', '08:00', 'close', '23:00', 'closed', false),
      'thu', jsonb_build_object('open', '08:00', 'close', '23:00', 'closed', false),
      'fri', jsonb_build_object('open', '08:00', 'close', '24:00', 'closed', false),
      'sat', jsonb_build_object('open', '09:00', 'close', '24:00', 'closed', false),
      'sun', jsonb_build_object('open', '09:00', 'close', '22:00', 'closed', false)
    ),
    'tinctura2026',
    'Europe/Bucharest',
    jsonb_build_object(
      'instagram', '@tinctura.cafe',
      'facebook', 'facebook.com/tinctura',
      'tiktok', null,
      'website', 'https://tinctura.cafe'
    ),
    jsonb_build_object('preset_id', 'cafe', 'accent_override', null),
    null
  )
  on conflict (slug) do nothing
  returning id into v_rest_id;

  if v_rest_id is null then
    select id into v_rest_id from public.restaurants where slug = 'tinctura';
  end if;

  -- 2b. Owner membership — invariantul mig 096 cere exact 1 owner membership
  -- aliniat cu restaurants.owner_id, iar dashboard-ul (E2E) vede restaurantul
  -- prin membership. Doar dacă owner-ul e user REAL din auth.users (fallback-ul
  -- cu UUID fals n-ar trece FK-ul pe user_id).
  if exists (select 1 from auth.users where id = v_owner_id) then
    insert into public.restaurant_memberships (restaurant_id, user_id, role)
      values (v_rest_id, v_owner_id, 'owner')
      on conflict (restaurant_id, user_id) do nothing;
  end if;

  -- 3. Categories — 4 buc cu meta_text editorial
  insert into public.categories (restaurant_id, name, emoji, display_order, meta_text)
  values
    (v_rest_id, 'Cafea',     '☕', 0, 'Boabe prăjite săptămânal'),
    (v_rest_id, 'Mâncare',   '🥐', 1, 'Servit până la ora 13:00'),
    (v_rest_id, 'Deserturi', '🍰', 2, 'Făcute zilnic în bucătărie'),
    (v_rest_id, 'Cocktail',  '🍸', 3, 'Doar după ora 17:00')
  on conflict do nothing;

  select id into v_cat_cafea     from public.categories where restaurant_id = v_rest_id and name = 'Cafea';
  select id into v_cat_mancare   from public.categories where restaurant_id = v_rest_id and name = 'Mâncare';
  select id into v_cat_desert    from public.categories where restaurant_id = v_rest_id and name = 'Deserturi';
  select id into v_cat_cocktail  from public.categories where restaurant_id = v_rest_id and name = 'Cocktail';

  -- 4. Products — 10 buc cu dietary_tags editorial
  insert into public.products (
    restaurant_id, category_id, name, description, price, emoji,
    is_active, dietary_tags, allergens, display_order
  )
  values
    (v_rest_id, v_cat_cafea, 'Espresso Tinctura',
     'Blend signature, note de ciocolată neagră și caise uscate',
     12.00, '☕', true, array['signature'], array[]::text[], 0),
    (v_rest_id, v_cat_cafea, 'Flat White',
     'Latte cu microfoam dens, espresso dublu',
     16.00, '☕', true, array[]::text[], array['lapte'], 1),
    (v_rest_id, v_cat_cafea, 'Cold Brew',
     'Infuzat 18 ore, servit cu cuburi de cafea',
     18.00, '🧊', true, array['nou', 'vegan'], array[]::text[], 2),
    (v_rest_id, v_cat_mancare, 'Croissant Pain au Chocolat',
     'Aluat foietaj cu unt francez și ciocolată neagră 70%',
     14.00, '🥐', true, array['vegetarian'], array['gluten', 'lapte', 'oua'], 0),
    (v_rest_id, v_cat_mancare, 'Avocado Toast',
     'Pâine cu maia, avocado proaspăt, lime, ardei iute',
     32.50, '🥑', true, array['signature', 'vegan'], array['gluten'], 1),
    (v_rest_id, v_cat_mancare, 'Bowl cu quinoa',
     'Quinoa, naut, legume coapte, hummus, zeamă de lămâie',
     38.00, '🥗', true, array['vegan', 'fara-gluten'], array[]::text[], 2),
    (v_rest_id, v_cat_desert, 'Cheesecake cu vișine',
     'Crustă de biscuiți cu unt, cremă fină de brânză, sirop de vișine',
     22.00, '🍰', true, array['vegetarian'], array['gluten', 'lapte', 'oua'], 0),
    (v_rest_id, v_cat_desert, 'Brownie raw',
     'Curmale, cacao, nuci pecan — fără cuptor, fără gluten',
     19.00, '🍫', true, array['vegan', 'fara-gluten', 'raw'], array['nuci'], 1),
    (v_rest_id, v_cat_cocktail, 'Negroni clasic',
     'Gin, Campari, vermouth dulce, coajă de portocală',
     28.00, '🍸', true, array['signature'], array['sulfiti'], 0),
    (v_rest_id, v_cat_cocktail, 'Spritz de elder',
     'Prosecco, lichior de soc, apă tonică, mentă proaspătă',
     26.00, '🥂', true, array['nou'], array['sulfiti'], 1)
  on conflict do nothing;
end$$;

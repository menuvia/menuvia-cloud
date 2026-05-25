-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 034 — Quick Setup Wizard (presets pentru lansare rapidă)
-- ═══════════════════════════════════════════════════════════════
-- Owner-ul accesează un tab "Setup Asistent" în dashboard pentru a-și
-- popula rapid restaurantul cu date demo realiste, în loc să adauge
-- manual fiecare categorie, produs, masă etc.
--
-- Adaugă:
--   • restaurants.business_type — tipul localului (cafenea/bar/...)
--   • apply_business_type_preset() — seed atomic categorii + produse
--   • apply_vat_preset() — seed atomic vat_rates (preserves products refs)
--   • bulk_create_tables() — bulk insert mese pe zone

-- ── Coloană business_type ─────────────────────────────────────
alter table public.restaurants
  add column if not exists business_type text
  check (business_type is null or business_type in (
    'cafenea', 'bar', 'restaurant', 'pizzerie', 'cocktail_bar', 'altul'
  ));

comment on column public.restaurants.business_type is
  'Tipul localului — folosit pentru a sugera presets de categorii/produse/TVA. Selectat în Quick Setup.';

-- ═══════════════════════════════════════════════════════════════
-- 1) apply_business_type_preset
-- ═══════════════════════════════════════════════════════════════
-- Atomic seed de categorii + produse pe baza tipului de local.
-- Idempotent: dacă există deja categorii, NU duplică (returnează 'skipped').
-- Folosit doar la onboarding inițial sau în Quick Setup pentru restaurant gol.
create or replace function public.apply_business_type_preset(
  p_restaurant_id  uuid,
  p_business_type  text,
  p_force          boolean default false  -- true: adaugă chiar dacă există cat-uri
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat_id        uuid;
  v_existing_cats int;
  v_inserted_cats int := 0;
  v_inserted_prods int := 0;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Not admin of this restaurant';
  end if;

  if p_business_type not in ('cafenea', 'bar', 'restaurant', 'pizzerie', 'cocktail_bar', 'altul') then
    raise exception 'Invalid business_type: %', p_business_type;
  end if;

  -- Salvează tipul
  update public.restaurants set business_type = p_business_type where id = p_restaurant_id;

  -- Idempotenți: verifică categorii existente
  select count(*) into v_existing_cats from public.categories where restaurant_id = p_restaurant_id;
  if v_existing_cats > 0 and not p_force then
    return jsonb_build_object(
      'status',          'skipped',
      'reason',          'categories_exist',
      'existing_categories', v_existing_cats
    );
  end if;

  -- ── Seed în funcție de tip ───────────────────────────────────
  case p_business_type
    when 'cafenea' then
      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Cafele', '☕', 0) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Espresso',         8.00,  '☕', 1, 0),
        (p_restaurant_id, v_cat_id, 'Espresso dublu', 12.00,  '☕', 1, 1),
        (p_restaurant_id, v_cat_id, 'Cappuccino',     14.00,  '☕', 1, 2),
        (p_restaurant_id, v_cat_id, 'Latte Macchiato', 16.00, '🥛', 1, 3),
        (p_restaurant_id, v_cat_id, 'Flat White',      16.00, '🥛', 1, 4);
      v_inserted_prods := v_inserted_prods + 5;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Ceaiuri', '🍵', 1) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Ceai negru',   10.00, '🍵', 1, 0),
        (p_restaurant_id, v_cat_id, 'Ceai verde',   10.00, '🍵', 1, 1),
        (p_restaurant_id, v_cat_id, 'Ceai fructe',  12.00, '🍵', 1, 2);
      v_inserted_prods := v_inserted_prods + 3;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Băuturi reci', '🥤', 2) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Limonadă',         14.00, '🍋', 1, 0),
        (p_restaurant_id, v_cat_id, 'Smoothie fructe',  18.00, '🥤', 1, 1),
        (p_restaurant_id, v_cat_id, 'Apă plată 0.5L',    5.00, '💧', 1, 2),
        (p_restaurant_id, v_cat_id, 'Apă minerală 0.5L', 5.00, '💧', 1, 3);
      v_inserted_prods := v_inserted_prods + 4;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Prăjituri', '🍰', 3) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Cheesecake', 16.00, '🍰', 1, 0),
        (p_restaurant_id, v_cat_id, 'Tiramisu',   18.00, '🍰', 1, 1),
        (p_restaurant_id, v_cat_id, 'Brownie',    14.00, '🍫', 1, 2);
      v_inserted_prods := v_inserted_prods + 3;

      v_inserted_cats := 4;

    when 'bar' then
      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Bere', '🍺', 0) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Bere draft 0.5L',   14.00, '🍺', 2, 0),
        (p_restaurant_id, v_cat_id, 'Bere PET 0.33L',    12.00, '🍺', 2, 1),
        (p_restaurant_id, v_cat_id, 'Bere artizanală',   18.00, '🍻', 2, 2);
      v_inserted_prods := v_inserted_prods + 3;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Tării', '🥃', 1) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Whiskey',     22.00, '🥃', 2, 0),
        (p_restaurant_id, v_cat_id, 'Vodka',       16.00, '🍸', 2, 1),
        (p_restaurant_id, v_cat_id, 'Tequila shot', 14.00, '🥃', 2, 2),
        (p_restaurant_id, v_cat_id, 'Rachiu',      12.00, '🥃', 2, 3);
      v_inserted_prods := v_inserted_prods + 4;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Vin', '🍷', 2) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Vin alb pahar',   18.00, '🍷', 2, 0),
        (p_restaurant_id, v_cat_id, 'Vin roșu pahar',  18.00, '🍷', 2, 1);
      v_inserted_prods := v_inserted_prods + 2;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Cocktailuri', '🍹', 3) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Mojito',         22.00, '🍹', 2, 0),
        (p_restaurant_id, v_cat_id, 'Negroni',        28.00, '🍸', 2, 1),
        (p_restaurant_id, v_cat_id, 'Aperol Spritz',  24.00, '🥂', 2, 2);
      v_inserted_prods := v_inserted_prods + 3;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Soft drinks', '🥤', 4) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Cola 0.33L',     8.00, '🥤', 1, 0),
        (p_restaurant_id, v_cat_id, 'Apă plată',      5.00, '💧', 1, 1);
      v_inserted_prods := v_inserted_prods + 2;

      v_inserted_cats := 5;

    when 'restaurant' then
      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Aperitive', '🥗', 0) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Salată Caesar',      24.00, '🥗', 1, 0),
        (p_restaurant_id, v_cat_id, 'Bruschetta',         18.00, '🍞', 1, 1),
        (p_restaurant_id, v_cat_id, 'Platou brânzeturi',  38.00, '🧀', 1, 2);
      v_inserted_prods := v_inserted_prods + 3;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Fel principal', '🍝', 1) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Paste Carbonara',     32.00, '🍝', 1, 0),
        (p_restaurant_id, v_cat_id, 'Pui Curry',           38.00, '🍛', 1, 1),
        (p_restaurant_id, v_cat_id, 'Saramură de pește',   45.00, '🐟', 1, 2);
      v_inserted_prods := v_inserted_prods + 3;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Desert', '🍰', 2) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Tort casa',     18.00, '🍰', 1, 0),
        (p_restaurant_id, v_cat_id, 'Înghețată',     12.00, '🍨', 1, 1);
      v_inserted_prods := v_inserted_prods + 2;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Băuturi', '🥤', 3) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Apă plată',     5.00, '💧', 1, 0),
        (p_restaurant_id, v_cat_id, 'Cola',          8.00, '🥤', 1, 1),
        (p_restaurant_id, v_cat_id, 'Cafea',         8.00, '☕', 1, 2),
        (p_restaurant_id, v_cat_id, 'Vin pahar',    18.00, '🍷', 2, 3);
      v_inserted_prods := v_inserted_prods + 4;

      v_inserted_cats := 4;

    when 'pizzerie' then
      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Pizza', '🍕', 0) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Margherita',          28.00, '🍕', 1, 0),
        (p_restaurant_id, v_cat_id, 'Diavola',             34.00, '🍕', 1, 1),
        (p_restaurant_id, v_cat_id, 'Capricciosa',         38.00, '🍕', 1, 2),
        (p_restaurant_id, v_cat_id, 'Quattro Formaggi',    36.00, '🍕', 1, 3),
        (p_restaurant_id, v_cat_id, 'Prosciutto',          36.00, '🍕', 1, 4);
      v_inserted_prods := v_inserted_prods + 5;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Paste', '🍝', 1) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Bolognese',     28.00, '🍝', 1, 0),
        (p_restaurant_id, v_cat_id, 'Carbonara',     30.00, '🍝', 1, 1);
      v_inserted_prods := v_inserted_prods + 2;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Salate', '🥗', 2) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Caesar',         24.00, '🥗', 1, 0),
        (p_restaurant_id, v_cat_id, 'Grecească',      22.00, '🥗', 1, 1);
      v_inserted_prods := v_inserted_prods + 2;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Băuturi', '🥤', 3) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Cola',          8.00, '🥤', 1, 0),
        (p_restaurant_id, v_cat_id, 'Apă plată',     5.00, '💧', 1, 1),
        (p_restaurant_id, v_cat_id, 'Bere PET',     12.00, '🍺', 2, 2);
      v_inserted_prods := v_inserted_prods + 3;

      v_inserted_cats := 4;

    when 'cocktail_bar' then
      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Signature Cocktails', '🍸', 0) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Whiskey Sour',     32.00, '🍸', 2, 0),
        (p_restaurant_id, v_cat_id, 'Negroni',          32.00, '🍸', 2, 1),
        (p_restaurant_id, v_cat_id, 'Old Fashioned',    38.00, '🥃', 2, 2),
        (p_restaurant_id, v_cat_id, 'Espresso Martini', 32.00, '🍸', 2, 3);
      v_inserted_prods := v_inserted_prods + 4;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Spirits', '🥃', 1) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Whiskey single malt',  35.00, '🥃', 2, 0),
        (p_restaurant_id, v_cat_id, 'Gin & Tonic',          28.00, '🍸', 2, 1),
        (p_restaurant_id, v_cat_id, 'Rum',                  24.00, '🥃', 2, 2);
      v_inserted_prods := v_inserted_prods + 3;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Vin', '🍷', 2) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Sparkling pahar',  35.00, '🥂', 2, 0),
        (p_restaurant_id, v_cat_id, 'Vin roșu pahar',   28.00, '🍷', 2, 1);
      v_inserted_prods := v_inserted_prods + 2;

      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Bites', '🍫', 3) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Olives mix',          18.00, '🫒', 1, 0),
        (p_restaurant_id, v_cat_id, 'Platou brânzeturi',   45.00, '🧀', 1, 1);
      v_inserted_prods := v_inserted_prods + 2;

      v_inserted_cats := 4;

    when 'altul' then
      -- Generic: minim viabil
      insert into public.categories (restaurant_id, name, emoji, position) values
        (p_restaurant_id, 'Produse', '🍽️', 0) returning id into v_cat_id;
      insert into public.products (restaurant_id, category_id, name, price, emoji, vat_group, position) values
        (p_restaurant_id, v_cat_id, 'Produs exemplu', 10.00, '🍽️', 1, 0);
      v_inserted_cats := 1;
      v_inserted_prods := 1;
  end case;

  return jsonb_build_object(
    'status',           'success',
    'business_type',    p_business_type,
    'categories_added', v_inserted_cats,
    'products_added',   v_inserted_prods
  );
end;
$$;

revoke all on function public.apply_business_type_preset(uuid, text, boolean) from public;
grant execute on function public.apply_business_type_preset(uuid, text, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2) apply_vat_preset
-- ═══════════════════════════════════════════════════════════════
-- UPSERT vat_rates pe baza preset-ului ales. Păstrează grupurile
-- existente referențiate de produse — nu șterge niciodată row-uri.
-- Doar adaugă/actualizează.
create or replace function public.apply_vat_preset(
  p_restaurant_id uuid,
  p_preset        text  -- 'simple_19' | 'food_9' | 'tourism_5'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Not admin of this restaurant';
  end if;

  if p_preset not in ('simple_19', 'food_9', 'tourism_5') then
    raise exception 'Invalid preset: %', p_preset;
  end if;

  case p_preset
    when 'simple_19' then
      -- O singură cotă: 19% pe toate
      insert into public.vat_rates (restaurant_id, vat_group, rate_percent, label, description, fiscalnet_group)
      values
        (p_restaurant_id, 1, 19.00, 'Cotă standard 19%', 'Cota standard de TVA (mâncare, băuturi, servicii)', 1)
      on conflict (restaurant_id, vat_group) do update set
        rate_percent = excluded.rate_percent,
        label        = excluded.label,
        description  = excluded.description,
        fiscalnet_group = excluded.fiscalnet_group,
        is_active    = true,
        updated_at   = now();
      v_count := 1;

    when 'food_9' then
      -- 19% standard (alcool, țigări) + 9% redusă (mâncare, băuturi nealc.)
      insert into public.vat_rates (restaurant_id, vat_group, rate_percent, label, description, fiscalnet_group)
      values
        (p_restaurant_id, 1, 9.00,  'Cotă redusă 9%',  'Mâncare, băuturi nealcoolice servite în local',  2),
        (p_restaurant_id, 2, 19.00, 'Cotă standard 19%', 'Alcool, țigări, băuturi importate',           1)
      on conflict (restaurant_id, vat_group) do update set
        rate_percent = excluded.rate_percent,
        label        = excluded.label,
        description  = excluded.description,
        fiscalnet_group = excluded.fiscalnet_group,
        is_active    = true,
        updated_at   = now();
      v_count := 2;

    when 'tourism_5' then
      -- 19% standard + 9% restaurant + 5% cazare
      insert into public.vat_rates (restaurant_id, vat_group, rate_percent, label, description, fiscalnet_group)
      values
        (p_restaurant_id, 1, 9.00,  'Cotă restaurant 9%', 'Restaurant și catering',                       2),
        (p_restaurant_id, 2, 19.00, 'Cotă standard 19%',  'Alcool, alte vânzări',                        1),
        (p_restaurant_id, 3, 5.00,  'Cotă turism 5%',     'Cazare turistică, agroturism',                3)
      on conflict (restaurant_id, vat_group) do update set
        rate_percent = excluded.rate_percent,
        label        = excluded.label,
        description  = excluded.description,
        fiscalnet_group = excluded.fiscalnet_group,
        is_active    = true,
        updated_at   = now();
      v_count := 3;
  end case;

  return jsonb_build_object(
    'status', 'success',
    'preset', p_preset,
    'rates_applied', v_count
  );
end;
$$;

revoke all on function public.apply_vat_preset(uuid, text) from public;
grant execute on function public.apply_vat_preset(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3) bulk_create_tables
-- ═══════════════════════════════════════════════════════════════
-- Generează N mese × M zone într-o singură tranzacție. Convenție nume:
--   • Cu zone:    "Interior 1", "Interior 2", ..., "Terasă 1", "Terasă 2"
--   • Fără zone:  "Masa 1", "Masa 2", ..., "Masa N"
-- Slug-ul e generat automat din nume (lowercase + dash). Skip dacă există.
create or replace function public.bulk_create_tables(
  p_restaurant_id uuid,
  p_zones         text[],  -- ex: ARRAY['Interior', 'Terasă']. Empty array → fără zone.
  p_per_zone      int      -- mese per zonă (sau total dacă zones gol)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zone   text;
  v_i      int;
  v_name   text;
  v_slug   text;
  v_inserted int := 0;
  v_skipped  int := 0;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Not admin of this restaurant';
  end if;

  if p_per_zone < 1 or p_per_zone > 200 then
    raise exception 'per_zone trebuie între 1 și 200';
  end if;

  -- Fără zone: doar "Masa N"
  if p_zones is null or array_length(p_zones, 1) is null then
    for v_i in 1..p_per_zone loop
      v_name := 'Masa ' || v_i;
      v_slug := 'masa-' || v_i;
      begin
        insert into public.tables (restaurant_id, name, slug, seats)
        values (p_restaurant_id, v_name, v_slug, 4);
        v_inserted := v_inserted + 1;
      exception
        when unique_violation then
          v_skipped := v_skipped + 1;
      end;
    end loop;
  else
    -- Cu zone: "Zone N"
    foreach v_zone in array p_zones loop
      if length(trim(v_zone)) = 0 then continue; end if;
      for v_i in 1..p_per_zone loop
        v_name := trim(v_zone) || ' ' || v_i;
        -- slug: lowercase, fără diacritice, fără spații
        v_slug := lower(translate(
          trim(v_zone) || '-' || v_i,
          'ăâîșțĂÂÎȘȚ ',
          'aaistAAIST-'
        ));
        v_slug := regexp_replace(v_slug, '[^a-z0-9-]+', '-', 'g');
        v_slug := regexp_replace(v_slug, '-+', '-', 'g');
        v_slug := trim(both '-' from v_slug);
        begin
          insert into public.tables (restaurant_id, name, slug, seats)
          values (p_restaurant_id, v_name, v_slug, 4);
          v_inserted := v_inserted + 1;
        exception
          when unique_violation then
            v_skipped := v_skipped + 1;
        end;
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'status', 'success',
    'inserted', v_inserted,
    'skipped',  v_skipped
  );
end;
$$;

revoke all on function public.bulk_create_tables(uuid, text[], int) from public;
grant execute on function public.bulk_create_tables(uuid, text[], int) to authenticated;

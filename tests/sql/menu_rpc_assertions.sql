-- ═══════════════════════════════════════════════════════════════
-- get_menu_for_restaurant — meniul QR într-un singur RTT (mig 212)
-- ═══════════════════════════════════════════════════════════════
-- Self-contained (begin/rollback). Verifică forma jsonb și, mai important,
-- filtrele de VIZIBILITATE anon scrise explicit în RPC (SECURITY DEFINER
-- ocolește RLS, deci corectitudinea vizibilității e responsabilitatea lui):
--   MR1 — restaurant activ întoarce DOAR categoriile/produsele publicate,
--          în forma Category[] (products/modifier_groups/extras/pairings);
--   MR2 — produsul draft/inactiv NU apare; opțiunea/extra indisponibilă NU apare;
--   MR3 — produsul ALTUI restaurant NU apare (fără scurgere cross-tenant);
--   MR4 — restaurant inactiv → '[]' (paritate cu categories_public_read);
--   MR5 — modifier_groups agregate corect pe produs (nume + opțiuni disponibile).
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_owner uuid := '51111111-2222-3333-4444-555555555501'::uuid;
  v_rest  uuid := '51111111-2222-3333-4444-555555555502'::uuid;
  v_rest2 uuid := '51111111-2222-3333-4444-555555555503'::uuid;
  v_inact uuid := '51111111-2222-3333-4444-555555555504'::uuid;
  v_cat   uuid := '51111111-2222-3333-4444-555555555510'::uuid;
  v_p_pub uuid := '51111111-2222-3333-4444-555555555520'::uuid;
  v_p_drf uuid := '51111111-2222-3333-4444-555555555521'::uuid;  -- draft
  v_p_ina uuid := '51111111-2222-3333-4444-555555555522'::uuid;  -- inactive
  v_p_oth uuid := '51111111-2222-3333-4444-555555555523'::uuid;  -- alt restaurant
  v_grp   uuid := '51111111-2222-3333-4444-555555555530'::uuid;
  v_menu  jsonb;
  v_prod  jsonb;
  v_grpj  jsonb;
begin
  insert into auth.users (id, email) values (v_owner, 'menu-rpc@tp.test');
  -- Owner pe enterprise: 3 restaurante depășesc limita planului free (mig 131).
  update public.profiles set plan = 'enterprise' where id = v_owner;
  insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
    (v_rest,  v_owner, 'MenuRPC Activ',   'menurpc-activ',   'Cluj', true),
    (v_rest2, v_owner, 'MenuRPC Vecin',   'menurpc-vecin',   'Cluj', true),
    (v_inact, v_owner, 'MenuRPC Inactiv', 'menurpc-inactiv', 'Cluj', false);

  insert into public.categories (id, restaurant_id, name, display_order) values
    (v_cat, v_rest, 'Feluri principale', 0);

  -- Produs publicat (cu extra disponibil + indisponibil + pairing) + draft + inactiv.
  insert into public.products (id, restaurant_id, category_id, name, price, is_active, is_draft, display_order) values
    (v_p_pub, v_rest,  v_cat, 'Ciorbă',   18, true,  false, 0),
    (v_p_drf, v_rest,  v_cat, 'Ciornă',   20, true,  true,  1),
    (v_p_ina, v_rest,  v_cat, 'Ciolan',   22, false, false, 2),
    (v_p_oth, v_rest2, null,  'Din vecini',30, true, false, 0);

  insert into public.product_extras (product_id, name, price, display_order, is_available) values
    (v_p_pub, 'Extra smântână', 2, 0, true),
    (v_p_pub, 'Extra ardei',    1, 1, false);  -- indisponibil → NU apare

  insert into public.product_pairings (product_id, paired_product_id, display_order) values
    (v_p_pub, v_p_oth, 0);

  -- Grup de modificatori cu 2 opțiuni (una indisponibilă).
  insert into public.modifier_groups (id, restaurant_id, name, selection_type, is_required, min_select, display_order)
    values (v_grp, v_rest, 'Pâine', 'single', false, 0, 0);
  insert into public.modifier_options (modifier_group_id, name, price_delta, is_available, display_order) values
    (v_grp, 'Cu pâine',  0, true,  0),
    (v_grp, 'Fără pâine',0, false, 1);  -- indisponibil → NU apare
  insert into public.product_modifier_groups (product_id, modifier_group_id, display_order)
    values (v_p_pub, v_grp, 0);

  -- ── Rulează RPC-ul ─────────────────────────────────────────────────────────
  v_menu := public.get_menu_for_restaurant(v_rest);

  -- MR1: o categorie, un singur produs publicat.
  if jsonb_array_length(v_menu) <> 1 then
    raise exception 'MR1 FAIL: aștept 1 categorie, am % (%)', jsonb_array_length(v_menu), v_menu;
  end if;
  if jsonb_array_length(v_menu->0->'products') <> 1 then
    raise exception 'MR2 FAIL: draft/inactiv nu au fost filtrate (% produse)', jsonb_array_length(v_menu->0->'products');
  end if;
  v_prod := v_menu->0->'products'->0;
  if v_prod->>'name' <> 'Ciorbă' then
    raise exception 'MR1 FAIL: produsul vizibil greșit (%)', v_prod->>'name';
  end if;

  -- MR2: extra indisponibil filtrat (rămâne doar 1), pairing prezent.
  if jsonb_array_length(v_prod->'extras') <> 1
     or v_prod->'extras'->0->>'name' <> 'Extra smântână' then
    raise exception 'MR2 FAIL: extras filtrate greșit (%)', v_prod->'extras';
  end if;
  if jsonb_array_length(v_prod->'pairings') <> 1 then
    raise exception 'MR2 FAIL: pairing lipsă (%)', v_prod->'pairings';
  end if;

  -- MR5: grup de modificatori cu DOAR opțiunea disponibilă.
  if jsonb_array_length(v_prod->'modifier_groups') <> 1 then
    raise exception 'MR5 FAIL: aștept 1 grup de modificatori (%)', v_prod->'modifier_groups';
  end if;
  v_grpj := v_prod->'modifier_groups'->0;
  if v_grpj->>'name' <> 'Pâine'
     or jsonb_array_length(v_grpj->'modifier_options') <> 1
     or v_grpj->'modifier_options'->0->>'name' <> 'Cu pâine' then
    raise exception 'MR5 FAIL: grupul/opțiunile greșite (%)', v_grpj;
  end if;

  -- MR3: produsul altui restaurant NU apare nicăieri în arbore.
  if v_menu::text ilike '%Din vecini%' then
    raise exception 'MR3 FAIL: scurgere cross-tenant (produsul vecinului în meniu)';
  end if;

  -- MR4: restaurant inactiv → '[]'.
  if public.get_menu_for_restaurant(v_inact) <> '[]'::jsonb then
    raise exception 'MR4 FAIL: restaurantul inactiv nu întoarce []';
  end if;

  raise notice 'MR1-MR5 OK: meniul RPC întoarce doar ce e vizibil anon, în forma Category[]';
end $$;

rollback;

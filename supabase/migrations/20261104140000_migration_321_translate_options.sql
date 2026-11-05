-- =============================================================================
-- Migration 321: opțiunile, grupurile și extra-urile se pot traduce (lotul O6b,
-- audit nov 2026 OPT-5 / MENU-13)
-- =============================================================================
-- Doar `products` și `categories` aveau `translations` (mig 197): un oaspete
-- englez pe un meniu tradus complet vedea în continuare „Mărime”, „Mică/Mare”
-- și „Brânză extra” în română. Aceeași coloană jsonb pe `modifier_groups`,
-- `modifier_options` și `product_extras` (forma {cod: {name}}), cu un CHECK că
-- e obiect (un array sau un scalar ar strica `->` în client).
--
-- `get_menu_for_restaurant` (lanț 212→246→253→**321**) = corpul VIU din 253 +
-- cheia `translations` pe grup, opțiune și extra + departajare pe nume la
-- produse și categorii (lotul O5b: importul CSV vechi le dădea tuturor
-- display_order 0, iar ordinea era nedefinită). Filtrele anon NEATINSE
-- (restaurant activ, produse is_active AND NOT is_draft, opțiuni/extra-uri
-- is_available, perechi gate-uite pe produsul pereche), aceeași semnătură, DEFINER
-- `public, pg_temp`, grant anon + authenticated. `get_menu_version` (318) e pe
-- conținutul rândului, deci vede traducerile fără redefinire.
--
-- Fallback-ul pe straturi (`fetchMenuLayered`, qr.ts) NU cere coloana nouă,
-- deliberat: el rulează doar pe o bază fără RPC — adică una mai veche decât
-- această migrație, pe care coloana n-ar exista și selectul ar pica.
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

alter table public.modifier_groups  add column if not exists translations jsonb not null default '{}'::jsonb;
alter table public.modifier_options add column if not exists translations jsonb not null default '{}'::jsonb;
alter table public.product_extras   add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.modifier_groups  drop constraint if exists modifier_groups_translations_object;
alter table public.modifier_groups  add constraint modifier_groups_translations_object
  check (jsonb_typeof(translations) = 'object');
alter table public.modifier_options drop constraint if exists modifier_options_translations_object;
alter table public.modifier_options add constraint modifier_options_translations_object
  check (jsonb_typeof(translations) = 'object');
alter table public.product_extras   drop constraint if exists product_extras_translations_object;
alter table public.product_extras   add constraint product_extras_translations_object
  check (jsonb_typeof(translations) = 'object');

create or replace function public.get_menu_for_restaurant(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
with pub_products as (
  select p.*
    from public.products p
   where p.restaurant_id = p_restaurant_id
     and p.is_active = true
     and p.is_draft = false
),
group_options as (
  -- mig 246: opțiunile unui grup, agregate O dată per grup.
  select mo.modifier_group_id,
         jsonb_agg(jsonb_build_object(
                  'id', mo.id,
                  'modifier_group_id', mo.modifier_group_id,
                  'name', mo.name,
                  'price_delta', mo.price_delta,
                  'is_available', mo.is_available,
                  'display_order', mo.display_order,
                  'translations', coalesce(mo.translations, '{}'::jsonb))
                order by mo.display_order) as opts
    from public.modifier_options mo
    join public.modifier_groups mg2 on mg2.id = mo.modifier_group_id
   where mg2.restaurant_id = p_restaurant_id
     and mo.is_available = true
   group by mo.modifier_group_id
),
prod_groups_json as (
  -- mig 253: grupurile agregate O dată per PRODUS (înainte: CTE ne-agregat
  -- re-scanat per produs = O(N²) pe meniuri mari).
  select pmg.product_id,
         jsonb_agg(jsonb_build_object(
           'id', mg.id,
           'restaurant_id', mg.restaurant_id,
           'name', mg.name,
           'selection_type', mg.selection_type,
           'is_required', mg.is_required,
           'min_select', mg.min_select,
           'max_select', mg.max_select,
           'display_order', mg.display_order,
           'translations', coalesce(mg.translations, '{}'::jsonb),
           'modifier_options', coalesce(go.opts, '[]'::jsonb)
         ) order by pmg.display_order) as groups
    from public.product_modifier_groups pmg
    join public.modifier_groups mg on mg.id = pmg.modifier_group_id
    left join group_options go on go.modifier_group_id = mg.id
   where pmg.product_id in (select id from pub_products)
   group by pmg.product_id
),
prod_extras as (
  select e.product_id,
         jsonb_agg(jsonb_build_object(
                  'id', e.id, 'name', e.name, 'price', e.price,
                  'emoji', e.emoji, 'display_order', e.display_order,
                  'is_available', e.is_available,
                  'translations', coalesce(e.translations, '{}'::jsonb))
                order by e.display_order) as extras
    from public.product_extras e
   where e.is_available = true
     and e.product_id in (select id from pub_products)
   group by e.product_id
),
prod_pairings as (
  select pr.product_id,
         jsonb_agg(jsonb_build_object(
                  'id', pr.id, 'paired_product_id', pr.paired_product_id,
                  'display_order', pr.display_order)
                order by pr.display_order) as pairings
    from public.product_pairings pr
   where pr.product_id in (select id from pub_products)
     -- Gate pe produsul PERECHE (paritate RLS mig 023) — mig 246, păstrat.
     and exists (
       select 1 from public.products pp
        where pp.id = pr.paired_product_id
          and pp.is_active = true
          and pp.is_draft = false
          and pp.is_sold_out = false)
   group by pr.product_id
),
prod_json as (
  select p.category_id,
         p.display_order,
         p.name,
         jsonb_build_object(
           'id', p.id,
           'restaurant_id', p.restaurant_id,
           'category_id', p.category_id,
           'name', p.name,
           'description', p.description,
           'price', p.price,
           'image_url', p.image_url,
           'is_sold_out', p.is_sold_out,
           'is_draft', p.is_draft,
           'is_daily_special', p.is_daily_special,
           'display_order', p.display_order,
           'allergens', coalesce(to_jsonb(p.allergens), '[]'::jsonb),
           'dietary_tags', coalesce(to_jsonb(p.dietary_tags), '[]'::jsonb),
           'prep_time_minutes', p.prep_time_minutes,
           'portion_size', p.portion_size,
           'vat_group', p.vat_group,
           'calories', p.calories,
           'protein_g', p.protein_g,
           'carbs_g', p.carbs_g,
           'fat_g', p.fat_g,
           'ai_generated_fields', coalesce(to_jsonb(p.ai_generated_fields), '[]'::jsonb),
           'translations', coalesce(p.translations, '{}'::jsonb),
           'modifier_groups', coalesce(pgj.groups, '[]'::jsonb),
           'extras', coalesce(pe.extras, '[]'::jsonb),
           'pairings', coalesce(pp2.pairings, '[]'::jsonb)
         ) as prod
    from pub_products p
    left join prod_groups_json pgj on pgj.product_id = p.id
    left join prod_extras pe on pe.product_id = p.id
    left join prod_pairings pp2 on pp2.product_id = p.id
),
cat_products as (
  select pj.category_id,
         jsonb_agg(pj.prod order by pj.display_order, pj.name) as products
    from prod_json pj
   group by pj.category_id
)
select case
  when not public.is_restaurant_active(p_restaurant_id) then '[]'::jsonb
  else coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id,
             'name', c.name,
             'display_order', c.display_order,
             'restaurant_id', c.restaurant_id,
             'meta_text', c.meta_text,
             'translations', coalesce(c.translations, '{}'::jsonb),
             'products', coalesce(cp.products, '[]'::jsonb))
           order by c.display_order, c.name)
      from public.categories c
      left join cat_products cp on cp.category_id = c.id
     where c.restaurant_id = p_restaurant_id
  ), '[]'::jsonb)
end;
$function$;

revoke all on function public.get_menu_for_restaurant(uuid) from public;
grant execute on function public.get_menu_for_restaurant(uuid) to anon, authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.get_menu_for_restaurant(uuid)'::regprocedure;
  if v_src !~ 'mo.translations' or v_src !~ 'mg.translations' or v_src !~ 'e.translations' then
    raise exception 'mig 321: meniul nu poartă traducerile opțiunilor/grupurilor/extra-urilor';
  end if;
  if v_src !~ 'mo.is_available = true' or v_src !~ 'e.is_available = true'
     or v_src !~ 'p.is_draft = false' or v_src !~ 'is_restaurant_active' or v_src !~ 'pp.is_sold_out = false' then
    raise exception 'mig 321: get_menu_for_restaurant a pierdut un filtru anon din 253';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.get_menu_for_restaurant(uuid)'::regprocedure)
     or not has_function_privilege('anon', 'public.get_menu_for_restaurant(uuid)', 'execute') then
    raise exception 'mig 321: meniul public trebuie DEFINER și apelabil de anon';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_menu_for_restaurant') <> 1 then
    raise exception 'mig 321: get_menu_for_restaurant trebuie să aibă O semnătură';
  end if;
end $$;

commit;

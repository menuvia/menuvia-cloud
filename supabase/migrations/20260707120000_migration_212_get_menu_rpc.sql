-- ═══════════════════════════════════════════════════════════════════
-- Migration 212: get_menu_for_restaurant — meniul QR într-un singur RTT
-- ─────────────────────────────────────────────────────────────────────
-- fetchMenuForRestaurant (src/lib/qr.ts) rula 3 straturi SERIALE de
-- query-uri PostgREST (categories+products → pmg+extras+pairings →
-- modifier_groups+options) = 300–600ms latență pură pe 4G la FIECARE
-- scanare de QR — cea mai fierbinte pagină. RPC-ul asamblează tot arborele
-- server-side: 1 round-trip.
--
-- SECURITY DEFINER ⇒ vizibilitatea anon se scrie EXPLICIT (nu prin RLS):
--   • restaurant inactiv → '[]' (paritate cu categories_public_read /
--     is_restaurant_active, mig 153);
--   • produse: is_active AND NOT is_draft (products: public read active,
--     mig 008) — sold-out-urile SE afișează (ca în client);
--   • modifier_groups/options: doar cele atinse prin pmg de la produsele
--     publicate ale restaurantului (mai strict decât politica anon din
--     mig 140, care permite orice grup publicat) + opțiuni is_available;
--   • extras: is_available (mig 023); pairings: toate ale produsului.
-- Forma jsonb = EXACT Category[] din qr.ts (fallback-ul pe straturi rămâne
-- în client pentru frontend deployat înaintea migrației).
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.get_menu_for_restaurant(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with pub_products as (
  select p.*
    from public.products p
   where p.restaurant_id = p_restaurant_id
     and p.is_active = true
     and p.is_draft = false
),
prod_groups as (
  -- Grupurile per produs, cu opțiunile disponibile deja agregate (sortate).
  select pmg.product_id,
         pmg.display_order as pmg_order,
         jsonb_build_object(
           'id', mg.id,
           'restaurant_id', mg.restaurant_id,
           'name', mg.name,
           'selection_type', mg.selection_type,
           'is_required', mg.is_required,
           'min_select', mg.min_select,
           'max_select', mg.max_select,
           'display_order', mg.display_order,
           'modifier_options', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', mo.id,
                      'modifier_group_id', mo.modifier_group_id,
                      'name', mo.name,
                      'price_delta', mo.price_delta,
                      'is_available', mo.is_available,
                      'display_order', mo.display_order)
                    order by mo.display_order)
               from public.modifier_options mo
              where mo.modifier_group_id = mg.id
                and mo.is_available = true
           ), '[]'::jsonb)
         ) as grp
    from public.product_modifier_groups pmg
    join public.modifier_groups mg on mg.id = pmg.modifier_group_id
   where pmg.product_id in (select id from pub_products)
),
prod_json as (
  select p.category_id,
         p.display_order,
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
           'modifier_groups', coalesce((
             select jsonb_agg(g.grp order by g.pmg_order)
               from prod_groups g
              where g.product_id = p.id
           ), '[]'::jsonb),
           'extras', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', e.id,
                      'name', e.name,
                      'price', e.price,
                      'emoji', e.emoji,
                      'display_order', e.display_order,
                      'is_available', e.is_available)
                    order by e.display_order)
               from public.product_extras e
              where e.product_id = p.id
                and e.is_available = true
           ), '[]'::jsonb),
           'pairings', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', pr.id,
                      'paired_product_id', pr.paired_product_id,
                      'display_order', pr.display_order)
                    order by pr.display_order)
               from public.product_pairings pr
              where pr.product_id = p.id
                -- Gate pe produsul PERECHE (paritate cu RLS `pairings: public read`,
                -- mig 023): nu scurgem id-ul unui produs draft/inactiv/sold-out —
                -- inclusiv al altui restaurant (admin manage verifică doar
                -- product_id, nu paired_product_id).
                and exists (
                  select 1 from public.products pp
                   where pp.id = pr.paired_product_id
                     and pp.is_active = true
                     and pp.is_draft = false
                     and pp.is_sold_out = false
                )
           ), '[]'::jsonb)
         ) as prod
    from pub_products p
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
             'products', coalesce((
               select jsonb_agg(pj.prod order by pj.display_order)
                 from prod_json pj
                where pj.category_id = c.id
             ), '[]'::jsonb))
           order by c.display_order)
      from public.categories c
     where c.restaurant_id = p_restaurant_id
  ), '[]'::jsonb)
end;
$$;

-- Meniul public: anon + authenticated (același contract ca resolve_qr_token /
-- get_restaurant_by_slug). PUBLIC tăiat întâi, ca la tot lockdown-ul.
revoke all on function public.get_menu_for_restaurant(uuid) from public;
grant execute on function public.get_menu_for_restaurant(uuid) to anon, authenticated;

comment on function public.get_menu_for_restaurant(uuid) is
  $$Meniul complet (Category[] cu products/modifier_groups/extras/pairings)
într-un singur apel, pentru meniul QR/public (mig 212). Vizibilitatea anon e
scrisă explicit: restaurant activ, produse publicate, opțiuni disponibile.
Teste: tests/sql/menu_rpc_assertions.sql.$$;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.get_menu_for_restaurant(uuid)'::regprocedure);
  if position('is_draft' in v_def) = 0
     or position('is_available' in v_def) = 0
     or position('is_restaurant_active' in v_def) = 0 then
    raise exception 'ASSERT FAIL: get_menu_for_restaurant fără filtrele de vizibilitate anon';
  end if;
  -- Gate pe produsul pereche (paritate RLS pairings): produsul pereche trebuie
  -- verificat, altfel se scurge id-ul unui produs nepublicat/cross-tenant.
  if position('is_sold_out' in v_def) = 0 then
    raise exception 'ASSERT FAIL: get_menu_for_restaurant fără gate-ul pe produsul pereche (pairings leak)';
  end if;
  if position('search_path' in v_def) = 0 then
    raise exception 'ASSERT FAIL: get_menu_for_restaurant fără search_path fixat';
  end if;
  -- Meniul e public: anon TREBUIE să aibă EXECUTE (invers față de lockdown-ul RPC).
  if not has_function_privilege('anon', 'public.get_menu_for_restaurant(uuid)', 'execute') then
    raise exception 'ASSERT FAIL: anon fără EXECUTE pe get_menu_for_restaurant (meniul public mort)';
  end if;
end $$;

commit;

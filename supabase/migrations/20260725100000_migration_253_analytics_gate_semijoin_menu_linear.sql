-- Migration 253 — perf MĂSURATĂ empiric (lab local PG16, 198k comenzi seed):
--
-- A. Gate-ul fiscal din view-urile de analytics devine SEMI-JOIN (nu per rând).
--    `restaurant_has_feature(o.restaurant_id, 'fiscal_receipt')` e STABLE și
--    CONSTANT per restaurant, dar pus direct în WHERE planner-ul îl execută o
--    dată PE FIECARE RÂND din orders/order_items. Măsurat pe un tenant cu 100k
--    comenzi: **2.031ms → 10ms (197×)** cu forma semi-join
--    `o.restaurant_id in (select r.id from restaurants r where restaurant_has_feature(...))`
--    — gate-ul se evaluează o dată per RESTAURANT și se hash-uiește. Semantica e
--    IDENTICĂ pentru orice viewer: view-urile sunt security_invoker, iar RLS-ul
--    pe `restaurants` (members read + escape-urile founder/partener din mig
--    186/187) face vizibil exact setul de restaurante ale căror comenzi trec
--    oricum de RLS-ul pe `orders`. View-uri atinse (fiecare = copia EXACTĂ a
--    ultimei definiții din lanț, doar predicatul rescris):
--      v_daily_orders        007→022→116→159→232→253
--      v_product_performance 007→116→159→253
--      v_waiter_performance  007→116→159→253
--      vat_report_daily      028→029→031→125→150→238→253
--
-- B. get_menu_for_restaurant (lanț 212→246→253): CTE-ul `prod_groups` era
--    NE-agregat și re-scanat o dată per produs (O(N²) pe CTE — aceeași boală pe
--    care mig 246 a tratat-o pentru opțiuni, un nivel mai sus); extras/pairings
--    erau subquery-uri corelate per produs; produsele se re-agregau per
--    categorie tot prin scanarea CTE-ului. Totul devine agregat O DATĂ per
--    cheie + LEFT JOIN — plan liniar. Ieșirea e BYTE-IDENTICĂ (verificat
--    empiric `::text =` pe două meniuri diferite, 150 și 1200 de produse);
--    filtrele de vizibilitate anon (mig 212/246) sunt păstrate integral.
--    Măsurat: 430ms→300ms pe meniul extrem de 1200 produse (~5MB jsonb —
--    restul e costul inerent de serializare); la 150 de produse ~35ms→32ms.
--
-- C. Backfill-ul mig 252 măsurat pe 129k comenzi terminale: 2.2s — confortabil
--    sub statement_timeout-ul lui de 120s. (Doar notă de calibrare, fără DDL.)

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── A1. v_daily_orders (copia mig 232 + semi-join) ───────────────────────────
create or replace view public.v_daily_orders
with (security_invoker = true) as
  SELECT restaurant_id,
     date_trunc('day'::text, (created_at AT TIME ZONE 'Europe/Bucharest'::text))::date AS day,
     count(*) AS total_orders,
     count(*) FILTER (WHERE source = 'qr'::order_source) AS qr_orders,
     count(*) FILTER (WHERE source = 'waiter'::order_source) AS waiter_orders,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status), 0::numeric) AS revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'cash'::payment_method), 0::numeric) AS cash_revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'card_pos'::payment_method), 0::numeric) AS card_revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'meal_voucher'::payment_method), 0::numeric) AS voucher_revenue
    FROM orders o
   WHERE status <> 'cancelled'::order_status
     AND o.restaurant_id IN (SELECT r.id FROM restaurants r
                              WHERE public.restaurant_has_feature(r.id, 'fiscal_receipt'))
   GROUP BY restaurant_id, (date_trunc('day'::text, (created_at AT TIME ZONE 'Europe/Bucharest'::text))::date);

-- ── A2. v_product_performance (copia mig 159 + semi-join) ────────────────────
create or replace view public.v_product_performance
with (security_invoker = true) as
  SELECT o.restaurant_id,
     oi.product_id,
     oi.product_name_snapshot AS product_name,
     sum(oi.quantity) AS total_quantity,
     count(DISTINCT oi.order_id) AS order_appearances,
     sum(oi.item_total) AS revenue
    FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
   WHERE o.status <> 'cancelled'::order_status
     AND o.restaurant_id IN (SELECT r.id FROM restaurants r
                              WHERE public.restaurant_has_feature(r.id, 'fiscal_receipt'))
   GROUP BY o.restaurant_id, oi.product_id, oi.product_name_snapshot;

-- ── A3. v_waiter_performance (copia mig 159 + semi-join) ─────────────────────
create or replace view public.v_waiter_performance
with (security_invoker = true) as
  SELECT restaurant_id,
     created_by AS user_id,
     count(*) FILTER (WHERE source = 'waiter'::order_source) AS orders_entered,
     count(*) FILTER (WHERE served_by = created_by AND (status = ANY (ARRAY['served'::order_status, 'paid'::order_status]))) AS orders_served,
     COALESCE(sum(paid_amount) FILTER (WHERE paid_by = created_by AND status = 'paid'::order_status), 0::numeric) AS revenue_collected
    FROM orders o
   WHERE created_by IS NOT NULL
     AND o.restaurant_id IN (SELECT r.id FROM restaurants r
                              WHERE public.restaurant_has_feature(r.id, 'fiscal_receipt'))
   GROUP BY restaurant_id, created_by;

-- ── A4. vat_report_daily (copia mig 238 + semi-join; factorul de discount NEATINS) ──
create or replace view public.vat_report_daily
with (security_invoker = true) as
  WITH order_sub AS (
    SELECT oi2.order_id, sum(oi2.item_total) AS subtotal
      FROM order_items oi2
     GROUP BY oi2.order_id
  )
  SELECT o.restaurant_id,
     date_trunc('day'::text, o.paid_at)::date AS report_date,
     COALESCE(p.vat_group::integer, 1) AS vat_group,
     COALESCE(vr.rate_percent, 0::numeric) AS vat_rate_percent,
     COALESCE(vr.label, '?'::text) AS vat_label,
     count(DISTINCT o.id) AS orders_count,
     sum(oi.item_total * COALESCE(o.total / NULLIF(os.subtotal, 0), 1)) AS gross_total,
     sum(oi.item_total * COALESCE(o.total / NULLIF(os.subtotal, 0), 1)
         * (COALESCE(vr.rate_percent, 0::numeric) / (100.0 + COALESCE(vr.rate_percent, 0::numeric)))) AS vat_amount,
     sum(oi.item_total * COALESCE(o.total / NULLIF(os.subtotal, 0), 1)
         * (100.0 / (100.0 + COALESCE(vr.rate_percent, 0::numeric)))) AS net_total
    FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN order_sub os ON os.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN vat_rates vr ON vr.restaurant_id = o.restaurant_id AND vr.vat_group = COALESCE(p.vat_group::integer, 1)
   WHERE o.status = 'paid'::order_status
     AND o.paid_at IS NOT NULL
     AND o.restaurant_id IN (SELECT r.id FROM restaurants r
                              WHERE public.restaurant_has_feature(r.id, 'fiscal_receipt'))
   GROUP BY o.restaurant_id, (date_trunc('day'::text, o.paid_at)::date), (COALESCE(p.vat_group::integer, 1)), (COALESCE(vr.rate_percent, 0::numeric)), (COALESCE(vr.label, '?'::text));

grant select on public.v_daily_orders        to authenticated;
grant select on public.v_product_performance to authenticated;
grant select on public.v_waiter_performance  to authenticated;
grant select on public.vat_report_daily      to authenticated;

-- ── B. get_menu_for_restaurant — plan liniar, ieșire byte-identică ───────────
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
group_options as (
  -- mig 246: opțiunile unui grup, agregate O dată per grup.
  select mo.modifier_group_id,
         jsonb_agg(jsonb_build_object(
                  'id', mo.id,
                  'modifier_group_id', mo.modifier_group_id,
                  'name', mo.name,
                  'price_delta', mo.price_delta,
                  'is_available', mo.is_available,
                  'display_order', mo.display_order)
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
                  'is_available', e.is_available)
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
         jsonb_agg(pj.prod order by pj.display_order) as products
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
           order by c.display_order)
      from public.categories c
      left join cat_products cp on cp.category_id = c.id
     where c.restaurant_id = p_restaurant_id
  ), '[]'::jsonb)
end;
$$;

revoke all on function public.get_menu_for_restaurant(uuid) from public;
grant execute on function public.get_menu_for_restaurant(uuid) to anon, authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_name text;
  v_def  text;
begin
  -- Toate cele 4 view-uri: semi-join prezent, gate-ul fiscal încă numit,
  -- security_invoker păstrat, per-row-ul vechi ELIMINAT.
  foreach v_name in array array['v_daily_orders','v_product_performance',
                                'v_waiter_performance','vat_report_daily'] loop
    v_def := pg_get_viewdef(('public.'||v_name)::regclass);
    if v_def not ilike '%restaurant_has_feature%' or v_def not ilike '%fiscal_receipt%' then
      raise exception 'mig 253: % a pierdut gate-ul fiscal', v_name;
    end if;
    -- pg_get_viewdef pretty-printează („IN ( SELECT") → verificări pe REGEX,
    -- insensibile la spații, nu pe literal.
    if v_def !~* 'IN\s*\(\s*SELECT r\.id' then
      raise exception 'mig 253: % nu folosește forma semi-join', v_name;
    end if;
    if v_def ~* 'restaurant_has_feature\s*\(\s*o?\.?restaurant_id' then
      raise exception 'mig 253: % a păstrat gate-ul per-rând (197× mai lent)', v_name;
    end if;
    if not exists (
      select 1 from pg_class c
       where c.oid = ('public.'||v_name)::regclass
         and coalesce(c.reloptions::text,'') like '%security_invoker=true%'
    ) then
      raise exception 'mig 253: % și-a pierdut security_invoker', v_name;
    end if;
  end loop;

  -- Invariante specifice moștenite: voucher_revenue (mig 232) + factorul de
  -- discount (mig 238).
  if pg_get_viewdef('public.v_daily_orders'::regclass) not ilike '%voucher_revenue%' then
    raise exception 'mig 253: v_daily_orders a pierdut voucher_revenue (mig 232)';
  end if;
  v_def := pg_get_viewdef('public.vat_report_daily'::regclass);
  if v_def not ilike '%NULLIF%' or v_def not ilike '%subtotal%' then
    raise exception 'mig 253: vat_report_daily a pierdut factorul de discount (mig 238)';
  end if;

  -- Meniul: agregările liniare + toate filtrele anon (mig 212/246).
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='get_menu_for_restaurant';
  if v_def not ilike '%prod_groups_json%' or v_def not ilike '%cat_products%'
     or v_def not ilike '%group_options%' then
    raise exception 'mig 253: get_menu_for_restaurant fără agregările liniare';
  end if;
  if v_def not ilike '%is_restaurant_active%' or v_def not ilike '%is_draft%'
     or v_def not ilike '%is_available%' or v_def not ilike '%is_sold_out%' then
    raise exception 'mig 253: filtrele de vizibilitate anon (mig 212/246) s-au pierdut';
  end if;

  raise notice 'mig 253: semi-join analytics (197× măsurat) + meniu liniar OK';
end $$;

commit;

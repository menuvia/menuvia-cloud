-- Migration 246: performanță SQL pe căile fierbinți (OPT-7d)
-- ─────────────────────────────────────────────────────────────────────
-- 1. Index parțial reservations(starts_at) WHERE status='confirmed' —
--    reclaim-ul din claim_reservation_reminders (lanț 057→215→234) și
--    auto_mark_reservation_no_show (mig 234) filtrează pe confirmed +
--    interval de starts_at, dar indexurile existente sunt pe OPUSUL
--    predicatului (reminder_sent_at IS NULL) sau pe chei de egalitate —
--    fiecare tick de cron făcea seq scan pe toată tabela reservations.
-- 2. get_tables_availability (lanț 199→200→246): predicatul OVERLAPS e
--    ne-sargable — idx_reservations_availability se folosea doar pe prefixul
--    de egalitate și fiecare apel PUBLIC (anon, harta de rezervare) citea
--    toate rezervările vii ale mesei din istoric. Înlocuit cu echivalentul
--    sargabil `r.starts_at < p_ends_at and r.ends_at > p_starts_at`
--    (OVERLAPS pe intervale half-open [s,e) e exact s1<e2 AND e1>s2) + guard
--    extins pe NULL (echivalența cu semantica trivalentă a OVERLAPS).
-- 3. get_menu_for_restaurant (lanț 212→246): opțiunile unui grup de
--    modificatori se agregau per PERECHE (produs, grup) — un grup partajat
--    de 40 de produse însemna 40 de agregări identice. CTE `group_options`
--    le agregă O dată per grup. Forma jsonb rămâne IDENTICĂ (doctrina
--    mig 212: tipurile din qr.ts + teste MR1–MR5); toate filtrele de
--    vizibilitate anon rămân EXPLICITE (restaurant activ, produse
--    is_active/NOT is_draft, opțiuni/extras is_available, gate pairings).
-- ─────────────────────────────────────────────────────────────────────
begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Index parțial pentru scanurile de cron pe confirmed ───────────
create index if not exists idx_reservations_confirmed_starts
  on public.reservations (starts_at)
  where status = 'confirmed';
comment on index public.idx_reservations_confirmed_starts is
  'Reclaim remindere (mig 234) + auto no-show: confirmed pe interval de starts_at (mig 246).';

-- ── 2. get_tables_availability — fereastră sargabilă + guard NULL ────
create or replace function public.get_tables_availability(
  p_slug       text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_party_size smallint default 1
)
returns table (
  table_id     uuid,
  table_name   text,
  seats        smallint,
  zone         text,
  is_available boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_restaurant_id uuid;
begin
  -- Guard extins (mig 246): pe NULL, vechiul `<=` nu se declanșa și
  -- semantica trivalentă a OVERLAPS putea diferi de AND-ul sargabil.
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'ends_at trebuie să fie după starts_at';
  end if;

  select id into v_restaurant_id
  from public.restaurants
  where lower(slug) = lower(p_slug) and is_active = true;
  if v_restaurant_id is null then
    raise exception 'Restaurantul nu a fost găsit';
  end if;

  -- ★ Gate modul: fără rezervări activate, nu expunem ocuparea meselor.
  if not public.is_module_enabled(v_restaurant_id, 'reservations') then
    raise exception 'Rezervările nu sunt activate pentru acest restaurant'
      using errcode = 'check_violation', hint = 'module_disabled';
  end if;

  return query
  select
    t.id, t.name, t.seats, t.zone,
    (t.seats is not null
     and t.seats >= greatest(p_party_size, 1)
     and not exists (
       select 1 from public.reservations r
       where r.restaurant_id = v_restaurant_id
         and r.table_id = t.id
         and r.status not in ('cancelled','no_show')
         -- Echivalent sargabil al vechiului operator de suprapunere pe
         -- [starts, ends): indexul idx_reservations_availability se
         -- folosește acum și pe interval, nu doar pe prefixul de egalitate.
         and r.starts_at < p_ends_at
         and r.ends_at > p_starts_at
     )) as is_available
  from public.tables t
  where t.restaurant_id = v_restaurant_id
    and t.is_active = true
  order by t.name;
end;
$$;

grant execute on function public.get_tables_availability(text, timestamptz, timestamptz, smallint)
  to anon, authenticated;

-- ── 3. get_menu_for_restaurant — group_options agregate O dată/grup ──
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
  -- mig 246: opțiunile unui grup, agregate O SINGURĂ dată per grup (înainte:
  -- subquery corelat per pereche produs×grup — 40 de produse cu același grup
  -- însemnau 40 de agregări identice).
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
           'modifier_options', coalesce(go.opts, '[]'::jsonb)
         ) as grp
    from public.product_modifier_groups pmg
    join public.modifier_groups mg on mg.id = pmg.modifier_group_id
    left join group_options go on go.modifier_group_id = mg.id
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

revoke all on function public.get_menu_for_restaurant(uuid) from public;
grant execute on function public.get_menu_for_restaurant(uuid) to anon, authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_src text;
begin
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='idx_reservations_confirmed_starts') then
    raise exception 'mig 246: idx_reservations_confirmed_starts lipsește'; end if;

  -- get_tables_availability: gate-ul de modul rămâne, OVERLAPS a dispărut.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_tables_availability';
  if v_src is null or position('is_module_enabled' in v_src) = 0 then
    raise exception 'mig 246: gate-ul de modul (mig 200) s-a pierdut din get_tables_availability'; end if;
  if position(') overlaps (' in lower(v_src)) > 0 then
    raise exception 'mig 246: operatorul OVERLAPS ne-sargabil a reapărut în get_tables_availability'; end if;

  -- get_menu_for_restaurant: filtrele de vizibilitate anon + CTE-ul nou.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_menu_for_restaurant';
  if v_src is null then raise exception 'mig 246: get_menu_for_restaurant lipsește'; end if;
  if position('group_options' in v_src) = 0 then
    raise exception 'mig 246: CTE-ul group_options lipsește'; end if;
  if position('is_restaurant_active' in v_src) = 0
     or position('is_draft' in v_src) = 0
     or position('is_available' in v_src) = 0 then
    raise exception 'mig 246: filtrele de vizibilitate anon (mig 212) s-au pierdut'; end if;

  raise notice 'mig 246: perf SQL (index confirmed + fereastră sargabilă + group_options) OK';
end $$;

commit;

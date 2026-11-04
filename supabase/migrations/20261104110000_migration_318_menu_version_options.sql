-- =============================================================================
-- Migration 318: versiunea meniului acoperă opțiunile, extra-urile și
-- asocierile (lotul O4a, audit nov 2026 MENU-09 / OPT-2)
-- =============================================================================
-- `get_menu_version` (mig 313) era un hash peste produse și categorii. Dar
-- meniul oaspetelui (`get_menu_for_restaurant`, mig 253) mai poartă grupurile
-- de opțiuni, opțiunile, legăturile produs↔grup, extra-urile și asocierile, iar
-- niciuna nu intra în versiune. Personalul marca o opțiune indisponibilă, făcea
-- un grup obligatoriu sau scotea un extra; oaspetele cu meniul deschis revenea
-- în tab, versiunea era aceeași, meniul nu se reîncărca, iar comanda pica la
-- nesfârșit pe `invalid_options` / `missing_required_group` cu aceleași opțiuni
-- vechi pe ecran, până reîncărca pagina (și pierdea coșul).
--
-- Același corp ca în 313, plus cinci termeni. Pe tabelele noi hash-ul e pe
-- CONȚINUTUL rândului (`to_jsonb(rând)`), nu pe `updated_at`: `product_extras`
-- și `product_pairings` n-au `updated_at`, `product_modifier_groups` n-are nici
-- măcar id, iar o coloană adăugată mai târziu (traducerile, lotul O6b) intră în
-- versiune fără o nouă redefinire. Ștergerile schimbă mulțimea de rânduri,
-- deci schimbă și hash-ul.
--
-- Scope: doar rândurile restaurantului (grupurile pe `restaurant_id`, restul
-- prin produsele lui), ca un local să nu-și schimbe versiunea din cauza altuia.
-- Suprafața rămâne a lui 313: aceeași semnătură, STABLE, DEFINER
-- `public, pg_temp`, grant anon + authenticated (AH1 o listează), NULL pe
-- restaurant inactiv/inexistent.
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

create or replace function public.get_menu_version(p_restaurant_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_restaurant_id is null or not public.is_restaurant_active(p_restaurant_id) then null
    else md5(
      coalesce((
        select string_agg(
                 p.id::text || ':' || coalesce(p.is_sold_out, false)::text
                 || ':' || coalesce(p.is_active, false)::text
                 || ':' || coalesce(p.is_draft, false)::text
                 || ':' || coalesce(extract(epoch from p.updated_at)::text, ''),
                 ',' order by p.id)
          from public.products p
         where p.restaurant_id = p_restaurant_id), '')
      || '|' ||
      coalesce((
        select string_agg(
                 c.id::text || ':' || coalesce(c.display_order, 0)::text || ':'
                 || md5(coalesce(c.name, '') || '~' || coalesce(c.meta_text, '')
                        || '~' || coalesce(c.translations::text, '')),
                 ',' order by c.id)
          from public.categories c
         where c.restaurant_id = p_restaurant_id), '')
      -- Lotul O4a: tot ce mai poartă meniul oaspetelui.
      || '|g:' ||
      coalesce((
        select md5(string_agg(to_jsonb(mg)::text, ',' order by mg.id))
          from public.modifier_groups mg
         where mg.restaurant_id = p_restaurant_id), '')
      || '|o:' ||
      coalesce((
        select md5(string_agg(to_jsonb(mo)::text, ',' order by mo.id))
          from public.modifier_options mo
          join public.modifier_groups mg on mg.id = mo.modifier_group_id
         where mg.restaurant_id = p_restaurant_id), '')
      || '|pg:' ||
      coalesce((
        select md5(string_agg(to_jsonb(pmg)::text, ','
                              order by pmg.product_id, pmg.modifier_group_id))
          from public.product_modifier_groups pmg
          join public.products p on p.id = pmg.product_id
         where p.restaurant_id = p_restaurant_id), '')
      || '|e:' ||
      coalesce((
        select md5(string_agg(to_jsonb(pe)::text, ',' order by pe.id))
          from public.product_extras pe
          join public.products p on p.id = pe.product_id
         where p.restaurant_id = p_restaurant_id), '')
      || '|pp:' ||
      coalesce((
        select md5(string_agg(to_jsonb(pp)::text, ',' order by pp.id))
          from public.product_pairings pp
          join public.products p on p.id = pp.product_id
         where p.restaurant_id = p_restaurant_id), '')
    )
  end;
$$;

revoke all on function public.get_menu_version(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_menu_version(uuid) to anon, authenticated;

comment on function public.get_menu_version(uuid) is
  'Versiunea meniului public (mig 313, lărgită în 318): hash care se schimbă la orice epuizare/deblocare și la orice editare de produse, categorii, grupuri de opțiuni, opțiuni, legături produs-grup, extra-uri sau asocieri. NULL = restaurant inactiv/inexistent.';

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_cfg text;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_menu_version') <> 1 then
    raise exception 'mig 318: get_menu_version trebuie să aibă O singură semnătură';
  end if;
  select p.prosrc, array_to_string(p.proconfig, ',') into v_src, v_cfg
    from pg_proc p where p.oid = 'public.get_menu_version(uuid)'::regprocedure;
  if v_src !~ 'modifier_options' or v_src !~ 'product_modifier_groups'
     or v_src !~ 'product_extras' or v_src !~ 'product_pairings' or v_src !~ 'modifier_groups mg' then
    raise exception 'mig 318: get_menu_version nu acoperă opțiunile/extra-urile/asocierile';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.get_menu_version(uuid)'::regprocedure) then
    raise exception 'mig 318: get_menu_version trebuie să rămână SECURITY DEFINER';
  end if;
  if coalesce(v_cfg, '') !~ 'search_path=public, ?pg_temp' then
    raise exception 'mig 318: search_path = %', v_cfg;
  end if;
  if not has_function_privilege('anon', 'public.get_menu_version(uuid)', 'execute') then
    raise exception 'mig 318: meniul public (anon) trebuie să poată cere versiunea';
  end if;
end $$;

commit;

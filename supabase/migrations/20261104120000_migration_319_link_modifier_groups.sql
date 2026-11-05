-- =============================================================================
-- Migration 319: grupurile de opțiuni se pot lega de produse (lotul O1b, audit
-- nov 2026 MENU-02)
-- =============================================================================
-- Meniul oaspetelui (`get_menu_for_restaurant` 253), fallback-ul pe straturi și
-- fișa ospătarului construiesc opțiunile unui produs DOAR din
-- `product_modifier_groups`. Nimic din aplicație nu scria în tabela asta: pe
-- producție avea 0 rânduri, deci grupurile create în Meniu → Opțiuni n-au
-- ajuns niciodată la vreun produs, iar regulile de grup obligatoriu din
-- create_order nu s-au aplicat niciodată.
--
-- Două RPC-uri care ÎNLOCUIESC atomic o mulțime de legături (o singură
-- tranzacție: un eșec la mijloc nu lasă produsul cu jumătate din grupuri):
--   set_product_modifier_groups(produs, grupuri[])  — fișa produsului; ordinea
--     din listă devine `display_order` (ordinea grupurilor în fișa oaspetelui);
--   set_modifier_group_products(grup, produse[])     — „Alege produsele” din
--     Meniu → Opțiuni; o legătură nouă intră ULTIMA în fișa produsului, una
--     existentă își păstrează locul.
--
-- SECURITY INVOKER, deliberat: politica „pmg: admin write” (proprietar /
-- manager / fondator, partenerul cu acces acordat) cere deja ca grupul și
-- produsul să fie ale ACELUIAȘI restaurant. Un DEFINER ar ocoli-o și ar trebui
-- s-o rescrie aici — exact tiparul care a produs gate-uri moarte în 267.
-- RLS face un DELETE nepermis să afecteze 0 rânduri FĂRĂ eroare, deci
-- funcțiile numără ce trebuia șters și refuză cu 42501 (hint `not_allowed`)
-- dacă s-a șters mai puțin; un INSERT/UPDATE nepermis aruncă singur.
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

create or replace function public.set_product_modifier_groups(p_product_id uuid, p_group_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ids      uuid[] := coalesce(p_group_ids, '{}'::uuid[]);
  v_expected int;
  v_deleted  int;
begin
  if p_product_id is null then
    raise exception 'Produs lipsă' using errcode = '22023', hint = 'product_not_found';
  end if;
  if array_position(v_ids, null) is not null
     or (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then
    raise exception 'Lista de grupuri are elemente goale sau repetate'
      using errcode = '22023', hint = 'duplicate_groups';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Produsul nu există' using errcode = 'P0002', hint = 'product_not_found';
  end if;

  select count(*) into v_expected
    from public.product_modifier_groups
   where product_id = p_product_id and not (modifier_group_id = any (v_ids));
  delete from public.product_modifier_groups
   where product_id = p_product_id and not (modifier_group_id = any (v_ids));
  get diagnostics v_deleted = row_count;
  if v_deleted < v_expected then
    raise exception 'Nu ai drepturi să modifici opțiunile acestui produs'
      using errcode = '42501', hint = 'not_allowed';
  end if;

  insert into public.product_modifier_groups (product_id, modifier_group_id, display_order)
  select p_product_id, t.gid, (t.ord - 1)::smallint
    from unnest(v_ids) with ordinality as t(gid, ord)
  on conflict (product_id, modifier_group_id)
  do update set display_order = excluded.display_order
   where product_modifier_groups.display_order is distinct from excluded.display_order;

  return jsonb_build_object('ok', true, 'product_id', p_product_id, 'linked', cardinality(v_ids));
end;
$$;

create or replace function public.set_modifier_group_products(p_group_id uuid, p_product_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ids      uuid[] := coalesce(p_product_ids, '{}'::uuid[]);
  v_expected int;
  v_deleted  int;
begin
  if p_group_id is null then
    raise exception 'Grup lipsă' using errcode = '22023', hint = 'group_not_found';
  end if;
  if array_position(v_ids, null) is not null
     or (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then
    raise exception 'Lista de produse are elemente goale sau repetate'
      using errcode = '22023', hint = 'duplicate_products';
  end if;
  if not exists (select 1 from public.modifier_groups where id = p_group_id) then
    raise exception 'Grupul nu există' using errcode = 'P0002', hint = 'group_not_found';
  end if;

  select count(*) into v_expected
    from public.product_modifier_groups
   where modifier_group_id = p_group_id and not (product_id = any (v_ids));
  delete from public.product_modifier_groups
   where modifier_group_id = p_group_id and not (product_id = any (v_ids));
  get diagnostics v_deleted = row_count;
  if v_deleted < v_expected then
    raise exception 'Nu ai drepturi să modifici acest grup de opțiuni'
      using errcode = '42501', hint = 'not_allowed';
  end if;

  -- O legătură nouă intră ULTIMA în fișa produsului; una existentă rămâne.
  insert into public.product_modifier_groups (product_id, modifier_group_id, display_order)
  select t.pid, p_group_id,
         coalesce((select max(x.display_order) + 1 from public.product_modifier_groups x
                    where x.product_id = t.pid), 0)::smallint
    from unnest(v_ids) as t(pid)
  on conflict (product_id, modifier_group_id) do nothing;

  return jsonb_build_object('ok', true, 'group_id', p_group_id, 'linked', cardinality(v_ids));
end;
$$;

revoke all on function public.set_product_modifier_groups(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.set_modifier_group_products(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.set_product_modifier_groups(uuid, uuid[]) to authenticated;
grant execute on function public.set_modifier_group_products(uuid, uuid[]) to authenticated;

comment on function public.set_product_modifier_groups(uuid, uuid[]) is
  'Lotul O1b (mig 319): înlocuiește atomic grupurile de opțiuni ale unui produs; ordinea din listă = ordinea în fișă. INVOKER: politica pmg: admin write decide (același restaurant, admin/partener).';
comment on function public.set_modifier_group_products(uuid, uuid[]) is
  'Lotul O1b (mig 319): înlocuiește atomic produsele care folosesc un grup de opțiuni; legăturile noi intră ultimele în fișa produsului. INVOKER: politica pmg: admin write decide.';

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_sig text;
  v_cfg text;
begin
  foreach v_sig in array array[
    'public.set_product_modifier_groups(uuid, uuid[])',
    'public.set_modifier_group_products(uuid, uuid[])'] loop
    if (select prosecdef from pg_proc where oid = v_sig::regprocedure) then
      raise exception 'mig 319: % trebuie SECURITY INVOKER (RLS-ul pmg e autoritatea)', v_sig;
    end if;
    select lower(regexp_replace(coalesce(array_to_string(proconfig, ','), ''), '[[:space:]]+', '', 'g'))
      into v_cfg from pg_proc where oid = v_sig::regprocedure;
    if v_cfg !~ '(^|,)search_path=public,pg_temp(,|$)' then
      raise exception 'mig 319: % search_path = %', v_sig, v_cfg;
    end if;
    if has_function_privilege('anon', v_sig, 'execute')
       or not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'mig 319: % trebuie apelabilă doar de authenticated', v_sig;
    end if;
  end loop;
end $$;

commit;

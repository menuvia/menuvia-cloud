-- mig 161 — închidere găuri de scriere cross-tenant (P2 round-5)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-5 (db-tenant-integrity + stocks + team). Patru suprafețe de scriere nu
-- impuneau apartenența la același restaurant a entităților legate:
--
--   #A order_items: authenticated avea INSERT/DELETE direct prin PostgREST, fără WITH CHECK
--      de tenant → un waiter putea insera/șterge order_items direct (ocolind pricing-ul
--      server-authoritative din create_order/update_order_items). Toate căile legitime trec
--      prin RPC-uri SECURITY DEFINER (rulează ca owner), deci REVOCĂM INSERT+DELETE de la
--      anon/authenticated (oglindă mig 134 care a revocat UPDATE). SELECT rămâne.
--   #B recipes: RLS verifica doar is_admin(product.restaurant_id), nu și că ingredient_id
--      aparține aceluiași restaurant → un admin putea lega reteta de ingredientul altui
--      restaurant (corupere cost/stoc cross-tenant). Trigger BEFORE INSERT/UPDATE.
--   #C waiter_table_assignments: politica `wta: admin full access` valida doar restaurant_id,
--      nu și că table_id/user_id aparțin restaurantului → referințe cross-tenant. Trigger.
--   #D purchase_orders.supplier_id: fără verificare same-tenant → PO cu furnizorul altui
--      restaurant. Trigger BEFORE INSERT/UPDATE.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── #A order_items: revocă INSERT/DELETE direct (toate căile trec prin RPC definer) ──
revoke insert, delete on public.order_items from anon, authenticated;

-- ── #B recipes: ingredient + product același restaurant ──────────────────────
create or replace function public.enforce_recipe_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_p uuid; v_i uuid;
begin
  select restaurant_id into v_p from public.products    where id = new.product_id;
  select restaurant_id into v_i from public.ingredients where id = new.ingredient_id;
  if v_p is null or v_i is null or v_p <> v_i then
    raise exception 'Reteta: produsul si ingredientul trebuie sa fie din acelasi restaurant'
      using errcode = 'P0001', hint = 'recipe_cross_tenant';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_recipe_tenant() from public;
drop trigger if exists trg_recipes_tenant on public.recipes;
create trigger trg_recipes_tenant
  before insert or update on public.recipes
  for each row execute function public.enforce_recipe_tenant();

-- ── #C waiter_table_assignments: table_id + user_id apartin restaurantului ───
create or replace function public.enforce_wta_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.tables t
                  where t.id = new.table_id and t.restaurant_id = new.restaurant_id) then
    raise exception 'Alocare: masa nu apartine restaurantului'
      using errcode = 'P0001', hint = 'wta_table_cross_tenant';
  end if;
  if not exists (select 1 from public.restaurant_memberships m
                  where m.user_id = new.user_id and m.restaurant_id = new.restaurant_id) then
    raise exception 'Alocare: userul nu e membru al restaurantului'
      using errcode = 'P0001', hint = 'wta_user_not_member';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_wta_tenant() from public;
drop trigger if exists trg_wta_tenant on public.waiter_table_assignments;
create trigger trg_wta_tenant
  before insert or update on public.waiter_table_assignments
  for each row execute function public.enforce_wta_tenant();

-- ── #D purchase_orders.supplier_id same-tenant ───────────────────────────────
create or replace function public.enforce_po_supplier_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.supplier_id is not null
     and not exists (select 1 from public.suppliers s
                      where s.id = new.supplier_id and s.restaurant_id = new.restaurant_id) then
    raise exception 'Comanda aprovizionare: furnizorul nu apartine restaurantului'
      using errcode = 'P0001', hint = 'po_supplier_cross_tenant';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_po_supplier_tenant() from public;
drop trigger if exists trg_po_supplier_tenant on public.purchase_orders;
create trigger trg_po_supplier_tenant
  before insert or update on public.purchase_orders
  for each row execute function public.enforce_po_supplier_tenant();

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('authenticated','public.order_items','INSERT')
     or has_table_privilege('authenticated','public.order_items','DELETE') then
    raise exception 'mig 161: order_items inca are INSERT/DELETE pt authenticated (#A)'; end if;
  if not exists (select 1 from pg_trigger where tgname='trg_recipes_tenant' and not tgisinternal) then
    raise exception 'mig 161: trg_recipes_tenant lipseste (#B)'; end if;
  if not exists (select 1 from pg_trigger where tgname='trg_wta_tenant' and not tgisinternal) then
    raise exception 'mig 161: trg_wta_tenant lipseste (#C)'; end if;
  if not exists (select 1 from pg_trigger where tgname='trg_po_supplier_tenant' and not tgisinternal) then
    raise exception 'mig 161: trg_po_supplier_tenant lipseste (#D)'; end if;
  raise notice 'mig 161: multi-tenant write guards (order_items/recipes/wta/po_supplier) OK';
end $$;

commit;

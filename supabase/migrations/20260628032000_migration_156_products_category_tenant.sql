-- mig 156 — products.category_id trebuie să fie din același restaurant (#26)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-4 (#26). Nu exista nicio garanție că products.category_id aparține aceluiași
-- restaurant ca produsul → un admin putea seta category_id la o categorie a ALTUI restaurant
-- (cross-tenant: produsul ar apărea sub o categorie străină / ar strica gruparea în meniu).
--
-- Trigger BEFORE INSERT OR UPDATE NULL-safe (B4): category_id e nullable (on delete set null),
-- deci validăm DOAR când e NOT NULL. Oglindă mig 113 (tenant trigger pe orders).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

create or replace function public.enforce_product_category_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.category_id is not null
     and not exists (
       select 1 from public.categories c
        where c.id = new.category_id
          and c.restaurant_id = new.restaurant_id
     ) then
    raise exception 'Categoria nu aparține aceluiași restaurant ca produsul'
      using errcode = 'P0001', hint = 'category_wrong_restaurant';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_product_category_tenant() from public;

drop trigger if exists trg_products_category_tenant on public.products;
create trigger trg_products_category_tenant
  before insert or update on public.products
  for each row
  execute function public.enforce_product_category_tenant();

-- ── Asserție fail-closed ─────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_products_category_tenant'
                  and tgrelid='public.products'::regclass and not tgisinternal) then
    raise exception 'mig 156: triggerul tenant pe products.category_id lipsește';
  end if;
  raise notice 'mig 156: products.category_id same-tenant (#26) OK';
end $$;

commit;

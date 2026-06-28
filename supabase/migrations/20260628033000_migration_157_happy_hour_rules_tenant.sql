-- mig 157 — happy_hour_rules: category_id/product_id din același restaurant (#28)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-4 (#28, M8). O regulă de happy hour cu scope='category'/'product' nu verifica
-- dacă category_id/product_id aparțin restaurantului regulii → un admin putea ținti categoria/
-- produsul ALTUI restaurant (cross-tenant: reducere aplicată pe baza unei entități străine).
--
-- Trigger BEFORE INSERT OR UPDATE NULL-safe: scope='all' are category_id ȘI product_id NULL
-- (trebuie să TREACĂ). Validăm fiecare câmp DOAR când e NOT NULL.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

create or replace function public.enforce_happy_hour_tenant()
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
    raise exception 'Categoria happy hour nu aparține aceluiași restaurant'
      using errcode = 'P0001', hint = 'hh_category_wrong_restaurant';
  end if;

  if new.product_id is not null
     and not exists (
       select 1 from public.products p
        where p.id = new.product_id
          and p.restaurant_id = new.restaurant_id
     ) then
    raise exception 'Produsul happy hour nu aparține aceluiași restaurant'
      using errcode = 'P0001', hint = 'hh_product_wrong_restaurant';
  end if;

  return new;
end;
$$;
revoke all on function public.enforce_happy_hour_tenant() from public;

drop trigger if exists trg_happy_hour_tenant on public.happy_hour_rules;
create trigger trg_happy_hour_tenant
  before insert or update on public.happy_hour_rules
  for each row
  execute function public.enforce_happy_hour_tenant();

-- ── Asserție fail-closed ─────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_happy_hour_tenant'
                  and tgrelid='public.happy_hour_rules'::regclass and not tgisinternal) then
    raise exception 'mig 157: triggerul tenant pe happy_hour_rules lipsește';
  end if;
  raise notice 'mig 157: happy_hour_rules category/product same-tenant (#28) OK';
end $$;

commit;

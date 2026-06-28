-- mig 164 — product_extras/product_pairings: read scopat pe restaurant activ (P3 round-5)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-5 (db-rls). Politicile de read pe product_extras/product_pairings verificau
-- doar produsul (is_active/is_draft), nu și că restaurantul e activ — inconsecvent cu mig 153
-- (categories/restaurant_modules scopate pe restaurant activ). Adăugăm is_restaurant_active
-- (helper SECURITY DEFINER din mig 153) în EXISTS-ul pe products, aliniind comportamentul.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

drop policy if exists "extras: public read" on public.product_extras;
create policy "extras: public read"
  on public.product_extras for select
  using (
    is_available = true
    and exists (
      select 1 from public.products p
      where p.id = product_extras.product_id
        and p.is_active = true and p.is_draft = false
        and public.is_restaurant_active(p.restaurant_id)
    )
  );

drop policy if exists "pairings: public read" on public.product_pairings;
create policy "pairings: public read"
  on public.product_pairings for select
  using (
    exists (
      select 1 from public.products p
      where p.id = product_pairings.product_id
        and p.is_active = true and p.is_draft = false
        and public.is_restaurant_active(p.restaurant_id)
    )
    and exists (
      select 1 from public.products p
      where p.id = product_pairings.paired_product_id
        and p.is_active = true and p.is_draft = false and p.is_sold_out = false
        and public.is_restaurant_active(p.restaurant_id)
    )
  );

do $$
begin
  if (select pg_get_expr(polqual, polrelid) from pg_policy
       where polname='extras: public read' and polrelid='public.product_extras'::regclass)
     not like '%is_restaurant_active%' then
    raise exception 'mig 164: extras read nescopat pe restaurant activ';
  end if;
  if (select pg_get_expr(polqual, polrelid) from pg_policy
       where polname='pairings: public read' and polrelid='public.product_pairings'::regclass)
     not like '%is_restaurant_active%' then
    raise exception 'mig 164: pairings read nescopat pe restaurant activ';
  end if;
  raise notice 'mig 164: extras/pairings read scopat pe restaurant activ OK';
end $$;

commit;

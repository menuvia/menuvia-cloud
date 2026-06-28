-- mig 152 — product_modifier_groups: admin-write re-scopat pe AMBELE tenanturi (#13)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-4 (#13). Politica `pmg: admin write` (ALL) verifica DOAR tenantul
-- grupului de modificatori: `is_admin(mg.restaurant_id)`. Nu verifica și că PRODUSUL
-- (`product_id`) aparține aceluiași restaurant. Un admin al restaurantului A putea astfel
-- lega un modifier_group al lui A de un PRODUS al restaurantului B (cross-tenant link →
-- prețuri/opțiuni injectate pe meniul altui restaurant prin product_modifier_groups).
--
-- Fix: USING + WITH CHECK cer ca grupul ȘI produsul să aparțină ACELUIAȘI restaurant, iar
-- caller-ul să fie admin al acelui restaurant. Re-scopat `to authenticated` (era PUBLIC).
-- Politica de citire anon (meniul public are nevoie de link-uri) rămâne neatinsă.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

drop policy if exists "pmg: admin write" on public.product_modifier_groups;
create policy "pmg: admin write"
  on public.product_modifier_groups
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.modifier_groups mg
      join public.products p on p.restaurant_id = mg.restaurant_id
      where mg.id = product_modifier_groups.modifier_group_id
        and p.id  = product_modifier_groups.product_id
        and public.is_admin(mg.restaurant_id)
    )
  )
  with check (
    exists (
      select 1
      from public.modifier_groups mg
      join public.products p on p.restaurant_id = mg.restaurant_id
      where mg.id = product_modifier_groups.modifier_group_id
        and p.id  = product_modifier_groups.product_id
        and public.is_admin(mg.restaurant_id)
    )
  );

-- ── Asserție fail-closed ─────────────────────────────────────────────────────
do $$
declare v_chk text;
begin
  select pg_get_expr(polwithcheck, polrelid) into v_chk
    from pg_policy
   where polname = 'pmg: admin write'
     and polrelid = 'public.product_modifier_groups'::regclass;
  if v_chk is null then
    raise exception 'mig 152: politica pmg admin write lipsește';
  end if;
  if position('products p' in v_chk) = 0 then
    raise exception 'mig 152: WITH CHECK nu validează tenantul produsului (#13)';
  end if;
  raise notice 'mig 152: pmg admin-write re-scopat pe ambele tenanturi (#13) OK';
end $$;

commit;

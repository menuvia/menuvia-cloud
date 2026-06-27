-- mig 140 — Fix P2 (leak cross-tenant): scopare read pe modifier_groups/options (MOD-READ-1)
--
-- Auditul rundei 3 (products_menu). Politicile "anon read" pe modifier_groups si
-- modifier_options erau `using(true)` => orice client putea citi modificatorii TUTUROR
-- restaurantelor, inclusiv cei atasati produselor draft/inactive (nepublicate). Fix:
--   • anon: doar modificatori atasati unui produs PUBLICAT (is_active and not is_draft).
--   • authenticated: doar restaurantul propriu (is_member).
--
-- Verificarile se fac prin functii SECURITY DEFINER (bypass RLS pe tabelele interogate),
-- ca sa NU declanseze recursie infinita de politici (policy pe modifier_groups care
-- interogheaza product_modifier_groups care la randul ei are RLS ce atinge modifier_groups).

begin;
set local lock_timeout = '10s';

-- Helper-e fail-safe (definer): exista grupul atasat unui produs publicat? / membru?
create or replace function public.modifier_group_is_published(p_group_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp stable
as $$
  select exists (
    select 1 from public.product_modifier_groups pmg
    join public.products p on p.id = pmg.product_id
    where pmg.modifier_group_id = p_group_id and p.is_active and not p.is_draft
  );
$$;
revoke all on function public.modifier_group_is_published(uuid) from public;
grant execute on function public.modifier_group_is_published(uuid) to anon, authenticated;

create or replace function public.is_member_of_modifier_group(p_group_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp stable
as $$
  select exists (
    select 1 from public.modifier_groups mg
    where mg.id = p_group_id and public.is_member(mg.restaurant_id)
  );
$$;
revoke all on function public.is_member_of_modifier_group(uuid) from public;
grant execute on function public.is_member_of_modifier_group(uuid) to authenticated;

-- ── modifier_groups ──────────────────────────────────────────────────────────
drop policy if exists "modifier_groups: anon read" on public.modifier_groups;
create policy "modifier_groups: anon read published"
  on public.modifier_groups for select to anon
  using (public.modifier_group_is_published(id));
create policy "modifier_groups: member read"
  on public.modifier_groups for select to authenticated
  using (public.is_member(restaurant_id));

-- ── modifier_options ─────────────────────────────────────────────────────────
drop policy if exists "modifier_options: anon read" on public.modifier_options;
create policy "modifier_options: anon read published"
  on public.modifier_options for select to anon
  using (public.modifier_group_is_published(modifier_group_id));
create policy "modifier_options: member read"
  on public.modifier_options for select to authenticated
  using (public.is_member_of_modifier_group(modifier_group_id));

-- Scopam politicile de scriere la `authenticated` (un admin e mereu autentificat). Altfel,
-- fiind `for all` la PUBLIC, ele se evaluau si pe SELECT-ul anon si apelau is_admin
-- (permission denied pt anon) — efect secundar al scoaterii politicii anon constante.
drop policy if exists "modifier_groups: admin write" on public.modifier_groups;
create policy "modifier_groups: admin write"
  on public.modifier_groups for all to authenticated
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

drop policy if exists "modifier_options: admin write" on public.modifier_options;
create policy "modifier_options: admin write"
  on public.modifier_options for all to authenticated
  using (exists (select 1 from public.modifier_groups mg
                  where mg.id = modifier_options.modifier_group_id and public.is_admin(mg.restaurant_id)))
  with check (exists (select 1 from public.modifier_groups mg
                  where mg.id = modifier_options.modifier_group_id and public.is_admin(mg.restaurant_id)));

do $$ begin
  if exists (select 1 from pg_policy where polname='modifier_groups: anon read'
              and polrelid='public.modifier_groups'::regclass) then
    raise exception 'mig 140: politica veche using(true) inca exista'; end if;
  raise notice 'mig 140: read modifier_groups/options scopat (anon=publicat, auth=membru) OK';
end $$;
commit;

-- mig 153 — RLS reads scopate: categories (#18/#22), vat_rates (#29), restaurant_modules (#30)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-4 (M7). Trei tabele aveau politici de citire blunt `using(true)` /
-- `public read` care expuneau rânduri indiferent de restaurant:
--
--   #18/#22 categories: DOUĂ politici `using(true)` (PUBLIC) → categoriile ORICĂRUI
--     restaurant (inclusiv inactiv/suspendat) erau citibile de oricine. Scopăm pe
--     restaurant ACTIV (meniul public are nevoie doar de restaurante active). FĂRĂ filtru pe
--     categories.is_active (ascunderea categoriilor inactive e gestionată în UI/RPC).
--     Owner/staff continuă să citească prin politica admin-write (FOR ALL, is_admin),
--     deci dashboardul unui restaurant inactiv nu e afectat.
--
--   #29 vat_rates: `public read using(is_active)` (PUBLIC) — cotele TVA sunt config intern,
--     NU sunt necesare meniului public anon. Scoatem anon; păstrăm DOAR ramura
--     `to authenticated using(is_member)`. Admin manage rămâne neatins.
--
--   #30 restaurant_modules: `using(true)` (anon+auth) → modulele oricărui restaurant.
--     Scopăm pe restaurant ACTIV, PĂSTRÂND `to anon` (qr.ts / PublicMenuPage citesc
--     modulele active pentru a ști ce e activat). Admin write rămâne neatins.
--
-- EXISTS direct pe restaurants (fără recursie RLS). Idempotent (drop if exists pe toate
-- numele istorice).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

-- ── helper SECURITY DEFINER: restaurant activ ────────────────────────────────
-- anon NU are SELECT pe public.restaurants; un `exists(select from restaurants)` direct
-- în politică ar rula ca rolul apelant → permission denied pe meniul public. Helperul
-- definer evaluează verificarea ca owner-ul funcției (bypass grant), exact ca is_admin/is_member.
create or replace function public.is_restaurant_active(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.restaurants r
    where r.id = p_restaurant_id and r.is_active = true
  );
$$;
revoke all on function public.is_restaurant_active(uuid) from public;
grant execute on function public.is_restaurant_active(uuid) to anon, authenticated;

-- ── categories (#18/#22): un singur read scopat pe restaurant activ ──────────
drop policy if exists "categories_public_read" on public.categories;
drop policy if exists "categories: anon read"  on public.categories;
create policy "categories_public_read"
  on public.categories
  for select
  to anon, authenticated
  using (public.is_restaurant_active(restaurant_id));

-- Re-scopăm admin-write `to authenticated`: era PUBLIC și aplica și lui anon la SELECT.
-- Cu fostul read `using(true)` OR-ul scurtcircuita și is_admin nu se evalua; acum, cu un
-- predicat ne-constant, anon ar evalua is_admin (fără EXECUTE) → permission denied. Adminii
-- sunt mereu authenticated, deci restrângerea e corectă funcțional.
drop policy if exists "categories: admin write" on public.categories;
create policy "categories: admin write"
  on public.categories
  for all
  to authenticated
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

-- ── vat_rates (#29): scoate anon; doar membrii autentificați citesc ──────────
drop policy if exists "vat_rates: public read" on public.vat_rates;
drop policy if exists "vat_rates_public_read"  on public.vat_rates;
create policy "vat_rates: member read"
  on public.vat_rates
  for select
  to authenticated
  using (public.is_member(restaurant_id));

-- ── restaurant_modules (#30): read scopat pe restaurant activ, păstrând anon ──
drop policy if exists "modules_public_read" on public.restaurant_modules;
create policy "modules_public_read"
  on public.restaurant_modules
  for select
  to anon, authenticated
  using (public.is_restaurant_active(restaurant_id));

-- ── Asserții fail-closed: nicio politică de read `using(true)`/PUBLIC pe cele 3 ──
do $$
declare
  r record;
begin
  for r in
    select c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid) as q, p.polroles
      from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname in ('categories','vat_rates','restaurant_modules')
       and p.polcmd in ('r','*')
  loop
    -- read-uri publice (anon) nu mai au voie să fie `true`
    if r.q = 'true' and (0 = any(r.polroles) or array_length(r.polroles,1) is null) then
      raise exception 'mig 153: politică read `using(true)` PUBLIC rămasă pe % (%)', r.relname, r.polname;
    end if;
  end loop;

  -- vat_rates nu mai e citibil de anon
  if exists (
    select 1 from pg_policy p
     where p.polrelid='public.vat_rates'::regclass and p.polcmd in ('r','*')
       and 'anon'::regrole = any(p.polroles)
  ) then
    raise exception 'mig 153: vat_rates încă citibil de anon (#29)';
  end if;

  raise notice 'mig 153: RLS reads scopate (categories/vat_rates/restaurant_modules) OK';
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 018 — Floor Layout (arhitectura restaurant)
-- Rulează în Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Adaugă coloana floor_layout pe tabelul restaurants
-- JSON schema: { floors: Floor[], version: number, savedAt: string }
alter table public.restaurants
  add column if not exists floor_layout jsonb default null;

-- Index GIN pentru queries pe JSON (util pentru viitor: cautare mese dupa label etc.)
create index if not exists idx_restaurants_floor_layout
  on public.restaurants using gin (floor_layout);

-- RLS: coloana e protejată de politicile existente pe restaurants.
-- Owner poate update (politica "restaurants: owner update" deja existentă).
-- Nu sunt necesare politici noi.

-- Funcție RPC pentru save floor layout (owner/manager only)
-- Separat de update generic ca să limiteze suprafața de atac
create or replace function public.save_floor_layout(
  p_restaurant_id uuid,
  p_layout        jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- Verifică că user-ul curent e owner sau manager
  select role into v_role
  from restaurant_memberships
  where restaurant_id = p_restaurant_id
    and user_id = auth.uid()
  limit 1;

  if v_role is null then
    -- poate fi owner direct
    if not exists (
      select 1 from restaurants
      where id = p_restaurant_id and owner_id = auth.uid()
    ) then
      raise exception 'Acces interzis: nu ești owner/manager al acestui restaurant';
    end if;
  elsif v_role not in ('owner', 'manager') then
    raise exception 'Acces interzis: doar owner/manager pot edita layout-ul';
  end if;

  -- Salvează layout
  update restaurants
  set floor_layout = p_layout,
      updated_at   = now()
  where id = p_restaurant_id;
end;
$$;

-- Grant execuție pentru authenticated users
grant execute on function public.save_floor_layout(uuid, jsonb) to authenticated;

comment on column public.restaurants.floor_layout is
  'JSON arhitectura restaurant: { floors: [{ id, name, tables, walls, decos, zones }], version, savedAt }';

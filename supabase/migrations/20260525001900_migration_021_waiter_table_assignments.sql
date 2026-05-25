-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 021 — Alocare mese pe ospătari (Waiter Table Assignments)
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.waiter_table_assignments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id       uuid not null references public.profiles(id)    on delete cascade,
  table_id      uuid not null references public.tables(id)      on delete cascade,
  assigned_at   timestamptz not null default now(),
  assigned_by   uuid references public.profiles(id) on delete set null,

  unique (user_id, table_id)
);

-- Index pentru lookup rapid per ospătar sau per restaurant
create index if not exists idx_wta_user_restaurant
  on public.waiter_table_assignments (user_id, restaurant_id);

create index if not exists idx_wta_restaurant
  on public.waiter_table_assignments (restaurant_id);

-- RLS
alter table public.waiter_table_assignments enable row level security;

-- Owner/Manager: pot citi și modifica toate alocările restaurantului lor
create policy "wta: admin full access"
  on public.waiter_table_assignments for all
  using  (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

-- Ospătar: poate citi PROPRIILE alocări (să știe ce mese are)
create policy "wta: waiter read own"
  on public.waiter_table_assignments for select
  using (user_id = auth.uid());

comment on table public.waiter_table_assignments is
  'Alocarea meselor pe ospătari per tură. Un ospătar vede doar comenzile
   de la mesele lui. Dacă nu are nicio alocare, vede toate comenzile
   (backward compatible). Owner/Manager pot modifica alocările oricând.';

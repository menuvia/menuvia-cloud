-- ============================================================================
-- Migration 049 — Activează Supabase Realtime pentru sincronizare cross-device
-- ============================================================================
-- Fix bug critic: comenzile plasate de clienți nu ajung în timp real la
-- KDS bucătărie / pagina ospătarului / casierie. Codul frontend
-- (`useOrdersQuery`, `subscribeToOrders`, `subscribeToWaiterCalls`,
-- KitchenPage, WaiterPage, DashboardPage) se abonează cu succes la
-- `postgres_changes` pe tabelele `orders` / `order_items` / `waiter_calls`,
-- dar NICIUN event nu sosește.
--
-- Cauza: publicația `supabase_realtime` (mecanismul prin care Postgres
-- publishează evenimente de INSERT/UPDATE/DELETE pentru ascultătorii
-- Supabase Realtime) e GOALĂ. În Supabase trebuie adăugate explicit
-- tabelele dorite — by default nu e nimic în ea.
--
-- Efectul fără această migrație: comandă plasată → DB e actualizat dar
-- KDS/Ospătar vede comanda DOAR după ce TanStack Query expiră `staleTime`
-- (60s) sau după refresh manual. Pare că "nu se trimite comanda".
--
-- După aplicare: evenimentele ajung instant (~100-300ms) la toate
-- dispozitivele abonate.
-- ============================================================================

do $$
declare
  t text;
  tables_to_publish text[] := array['orders', 'order_items', 'waiter_calls'];
begin
  -- Skip silent în medii non-Supabase (ex. CI cu Postgres curat) — publicația
  -- `supabase_realtime` e creată automat de Supabase la provisioning.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Skipping: publication "supabase_realtime" not found (likely non-Supabase environment).';
    return;
  end if;

  foreach t in array tables_to_publish loop
    -- Idempotent: skip dacă tabela e deja în publicație
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'Added public.% to supabase_realtime', t;
    else
      raise notice 'Skipped public.% (already in publication)', t;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- REPLICA IDENTITY FULL pentru a primi valoarea VECHE a rândului în UPDATE
-- events. Frontend-ul compară uneori old vs new (ex. status transition
-- detection în KDS, "comandă marcată ca livrată"). Default-ul Postgres
-- trimite doar PK + coloane modificate; FULL trimite întreg rândul.
--
-- Idempotent: re-rulare nu produce schimbări dacă deja e FULL.
-- ----------------------------------------------------------------------------
alter table public.orders        replica identity full;
alter table public.order_items   replica identity full;
alter table public.waiter_calls  replica identity full;

-- ============================================================================
-- Verificare post-deploy (Supabase SQL Editor):
--
--   SELECT schemaname, tablename
--   FROM   pg_publication_tables
--   WHERE  pubname = 'supabase_realtime'
--     AND  schemaname = 'public'
--   ORDER  BY tablename;
--
-- Trebuie să apară (minim) cele 3 rânduri:
--   public | order_items
--   public | orders
--   public | waiter_calls
--
-- ȘI replica identity FULL pentru cele 3 tabele:
--
--   SELECT relname, relreplident
--   FROM   pg_class
--   WHERE  relname IN ('orders','order_items','waiter_calls')
--     AND  relnamespace = 'public'::regnamespace;
--
-- relreplident trebuie să fie 'f' (FULL) pentru toate cele 3.
-- ============================================================================

-- Migration 078: garantează realtime pe orders + waiter_calls
-- ─────────────────────────────────────────────────────────────────────
-- PROBLEMĂ: useOrders (WaiterPage/KitchenPage) se abonează la
-- `postgres_changes` pe public.orders, iar WaiterPage și la public.waiter_calls.
-- DAR niciuna dintre aceste tabele nu era adăugată în publication-ul
-- `supabase_realtime` printr-o migrație — doar `reservations` (mig 073).
--
-- Publication-ul `supabase_realtime` pornește GOL într-un proiect Supabase.
-- Realtime-ul pe orders funcționa doar dacă cineva apăsa manual toggle-ul în
-- Dashboard (Database → Replication) — fragil, ne-reproductibil pe deploy nou,
-- și ușor de pierdut la un reset. Rezultat: comenzile noi NU apar live la
-- ospătar până la refresh manual.
--
-- FIX: adaugă explicit ambele tabele în publication. Idempotent (do/exception
-- pentru runs repetate sau publication absentă pe instanțe self-managed).
--
-- NOTĂ replica identity: pentru INSERT/UPDATE, payload-ul `new` conține toate
-- coloanele → filter-ul `restaurant_id=eq.X` din client funcționează. Comenzile
-- nu se șterg (se anulează prin status), deci edge-case-ul DELETE (unde `old`
-- ar avea doar PK cu replica identity default) e irelevant aici.

do $$
begin
  alter publication supabase_realtime add table public.orders;
exception
  when duplicate_object then null;  -- deja adăugată
  when undefined_object then null;  -- publication inexistentă (managed/self-host)
end $$;

do $$
begin
  alter publication supabase_realtime add table public.waiter_calls;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

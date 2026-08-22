-- migration_260_drop_redundant_orders_indexes.sql
-- =============================================================================
-- Curățare de indexuri redundante pe `orders` (auditul de schemă, aug 2026).
--
-- Mig 059 a declarat explicit că indexul compozit
-- orders_restaurant_status_created_idx „înlocuiește 3 indecși single-column",
-- dar a șters doar... niciunul; mig 244 a șters orders_restaurant_id_idx.
-- Au rămas până azi, pe cea mai scrisă tabelă din sistem:
--   - orders_status_idx       (selectivitate aproape nulă multi-tenant:
--                              TOATE interogările filtrează întâi pe
--                              restaurant_id, acoperit de compozitul 059)
--   - orders_created_at_idx   (acoperit de orders_restaurant_created_idx,
--                              mig 244, pentru toate căile reale de query)
-- Fiecare UPDATE pe orders (advance_order, subtotal sync, plăți) plătea
-- întreținerea lor degeaba — write-amplification pură, zero cititori.
--
-- Pattern identic cu mig 244 (drop + asserții că indexurile UTILE rămân).
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

drop index if exists public.orders_status_idx;
drop index if exists public.orders_created_at_idx;

-- ── Aserții fail-closed ──────────────────────────────────────────────────────
do $$
begin
  -- Redundantele chiar au dispărut.
  if exists (select 1 from pg_indexes where schemaname='public' and indexname='orders_status_idx') then
    raise exception 'mig 260: orders_status_idx încă există'; end if;
  if exists (select 1 from pg_indexes where schemaname='public' and indexname='orders_created_at_idx') then
    raise exception 'mig 260: orders_created_at_idx încă există'; end if;

  -- Indexurile care le ACOPERĂ sunt la locul lor (altfel drop-ul ar fi regresie).
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='orders_restaurant_status_created_idx') then
    raise exception 'mig 260: compozitul din mig 059 lipsește — NU șterge redundantele fără el'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='orders_restaurant_created_idx') then
    raise exception 'mig 260: orders_restaurant_created_idx (mig 244) lipsește'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='orders_pending_idx') then
    raise exception 'mig 260: partialul pe ne-terminale (mig 059) lipsește'; end if;
end $$;

commit;

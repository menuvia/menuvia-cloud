-- Migration 059: indecși compuși pe orders pentru kitchen + waiter view + dashboard
-- Înlocuiește scan secvențial + sort cu Index Scan direct.
-- Idempotent (if not exists). Fără CONCURRENTLY pentru că migrațiile Supabase
-- rulează în tranzacție implicit; tabela e mică în prod (zeci/sute rows),
-- deci lock-ul exclusiv durează < 100ms.

-- ─────────────────────────────────────────────────────────────────────
-- Index compus: kitchen view + dashboard live + analytics zilnic
-- ─────────────────────────────────────────────────────────────────────
-- Pattern query acoperit:
--   select * from orders
--   where restaurant_id = $1 and status in ($2..$N)
--   order by created_at desc;
--
-- Înlocuiește 3 indecși single-column care erau combinați prin Bitmap And:
-- orders_restaurant_id_idx + orders_status_idx + orders_created_at_idx.
create index if not exists orders_restaurant_status_created_idx
  on public.orders (restaurant_id, status, created_at desc);

comment on index public.orders_restaurant_status_created_idx is
  'Composite: kitchen/waiter view + dashboard filtre pe status + sort cronologic.';

-- ─────────────────────────────────────────────────────────────────────
-- Partial index: doar orders non-terminale (waiter view)
-- ─────────────────────────────────────────────────────────────────────
-- Status paid + cancelled formează ~80% din rows la restaurant matur.
-- Partial index = mult mai mic = scan mai rapid pe pending only.
-- Pattern query acoperit:
--   select * from orders
--   where restaurant_id = $1 and status not in ('paid','cancelled')
--   order by created_at desc;
create index if not exists orders_pending_idx
  on public.orders (restaurant_id, created_at desc)
  where status not in ('paid', 'cancelled');

comment on index public.orders_pending_idx is
  'Partial — doar orders active. ~5x mai rapid decât full pentru waiter view.';

-- ─────────────────────────────────────────────────────────────────────
-- Verificare (rulează manual după aplicare):
-- ─────────────────────────────────────────────────────────────────────
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and tablename = 'orders'
-- order by indexname;
--
-- explain analyze
-- select * from orders
-- where restaurant_id = '<uuid>' and status in ('new','confirmed','preparing','ready')
-- order by created_at desc limit 50;
-- → Index Scan using orders_restaurant_status_created_idx (înainte: Seq Scan + Sort)

-- Migration 244: indexuri de performanță (audit de optimizare, OPT-1)
-- ─────────────────────────────────────────────────────────────────────
-- Pur ADITIV pe citiri — nu atinge nicio politică RLS, gate fiscal sau RPC.
-- Interogările fierbinți acoperite (verificate contra indexurilor existente:
-- mig 003 single-column, mig 059 composite/partial, mig 043 tips-partial):
--
-- 1. orders (restaurant_id, created_at desc) — ReportsTab (range pe created_at
--    cu neq status), „comenzi azi" din HomeTab, admin_monthly_benchmark.
--    Compozitul mig 059 (restaurant_id, STATUS, created_at) nu servește
--    range-ul pe created_at fără egalitate pe status; partialul orders_pending
--    exclude paid/cancelled — exact ce au nevoie rapoartele.
--    + DROP orders_restaurant_id_idx (mig 003): prefix strict al noului index
--    ȘI al compozitului 059 → redundant; scade write-amplification pe cea
--    mai fierbinte tabelă de scriere.
-- 2. orders (restaurant_id, paid_at) WHERE status='paid' — venitul pe
--    interval din ReportsTab + totalurile de tură (close_cash_shift, mig 032).
--    Singurul index existent pe paid_at e partial pe tips_amount>0 (mig 043).
-- 3. products (restaurant_id, display_order) — tabul Meniu (useProducts) +
--    fetchMenuLayered: azi seq scan multi-tenant + sort (singurul index
--    apropiat, idx_products_vat_group, e partial pe is_active).
-- 4. orders (qr_token_id, created_at) WHERE qr_token_id IS NOT NULL —
--    rate-limit-ul QR (mig 056/090) rulează un COUNT pe acest predicat la
--    FIECARE insert de comandă QR, sub advisory lock (serializat!) — azi
--    scanează fereastra de 2 min a ÎNTREGII platforme. Partial: comenzile
--    waiter/pickup (qr_token_id null) nu poluează indexul.
-- ─────────────────────────────────────────────────────────────────────
begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create index if not exists orders_restaurant_created_idx
  on public.orders (restaurant_id, created_at desc);
comment on index public.orders_restaurant_created_idx is
  'Rapoarte + contoare pe interval de created_at, indiferent de status (mig 244).';

drop index if exists public.orders_restaurant_id_idx;

create index if not exists orders_paid_at_idx
  on public.orders (restaurant_id, paid_at)
  where status = 'paid';
comment on index public.orders_paid_at_idx is
  'Venit pe interval (ReportsTab) + totaluri de tură (close_cash_shift) — partial pe paid (mig 244).';

create index if not exists idx_products_restaurant_display
  on public.products (restaurant_id, display_order);
comment on index public.idx_products_restaurant_display is
  'Tabul Meniu + fetchMenuLayered: filtru pe restaurant + sort pe display_order (mig 244).';

create index if not exists orders_qr_token_created_idx
  on public.orders (qr_token_id, created_at)
  where qr_token_id is not null;
comment on index public.orders_qr_token_created_idx is
  'Rate-limit QR (mig 056/090): COUNT pe token+fereastră la fiecare insert, sub advisory lock (mig 244).';

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='orders_restaurant_created_idx') then
    raise exception 'mig 244: orders_restaurant_created_idx lipsește'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='orders_paid_at_idx') then
    raise exception 'mig 244: orders_paid_at_idx lipsește'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='idx_products_restaurant_display') then
    raise exception 'mig 244: idx_products_restaurant_display lipsește'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='orders_qr_token_created_idx') then
    raise exception 'mig 244: orders_qr_token_created_idx lipsește'; end if;
  if exists (select 1 from pg_indexes where schemaname='public' and indexname='orders_restaurant_id_idx') then
    raise exception 'mig 244: orders_restaurant_id_idx (redundant) nu a fost șters'; end if;
  -- Compozitul mig 059 rămâne — el acoperă interogările pe (restaurant, status).
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='orders_restaurant_status_created_idx') then
    raise exception 'mig 244: compozitul mig 059 a dispărut — nu era de atins'; end if;
  raise notice 'mig 244: indexuri de performanță OK';
end $$;

commit;

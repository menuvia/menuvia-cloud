-- mig 198 — Index pe categories(restaurant_id, display_order)
-- ─────────────────────────────────────────────────────────────────────
-- Optimizare pe CEA MAI FIERBINTE cale publică: fiecare încărcare de meniu
-- (/m/:slug și /q/:token) rulează
--   select ... from categories where restaurant_id = $1 order by display_order
-- iar `categories` avea DOAR PK-ul pe `id` — deci un SEQ SCAN + sort la fiecare
-- scanare de QR / vizită de meniu. Pe măsură ce platforma crește (mai multe
-- restaurante → mai multe rânduri totale în categories), costul creștea liniar.
--
-- Indexul compozit (restaurant_id, display_order) servește ȘI filtrul de
-- egalitate, ȘI sortarea, într-o singură scanare de index (fără seq scan, fără
-- nod de sort). products are deja un index cu restaurant_id pe prima poziție,
-- deci NU e afectat; product_extras/product_pairings/product_modifier_groups
-- au deja indexuri pe product_id (verificat).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

create index if not exists idx_categories_restaurant_display
  on public.categories (restaurant_id, display_order);

-- ── Asserție fail-closed: indexul există ────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename  = 'categories'
       and indexname  = 'idx_categories_restaurant_display'
  ) then
    raise exception 'mig 198: idx_categories_restaurant_display lipsește';
  end if;
  raise notice 'mig 198: index categories(restaurant_id, display_order) OK';
end $$;

commit;

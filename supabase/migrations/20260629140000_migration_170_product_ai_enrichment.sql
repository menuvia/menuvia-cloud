-- mig 170 — Îmbogățire produse cu AI (imagini + macronutrienți)
-- ─────────────────────────────────────────────────────────────────────
-- Adaugă pe `products` coloane de nutriție (estimabile cu AI) + un marker
-- `ai_generated_fields` (lista câmpurilor generate de AI și NEverificate încă).
-- UI-ul afișează un badge „generat de AI — verifică" pentru fiecare câmp din
-- listă; la prima editare manuală a câmpului, owner-ul îl scoate din listă.
--
-- Extinde și constrângerea `ai_usage.feature` cu noile feature-uri de metering:
-- 'image_gen' (generare imagine) și 'nutrition' (estimare macronutrienți).
--
-- Coloanele moștenesc grant-urile table-level existente pe `products` (nu există
-- grant column-level) → anon le citește pentru meniul public, owner/manager le
-- scriu sub RLS. Idempotent; asserții fail-closed.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Coloane nutriție + marker AI ─────────────────────────────────
alter table public.products
  add column if not exists calories            integer,
  add column if not exists protein_g           numeric(6, 2),
  add column if not exists carbs_g             numeric(6, 2),
  add column if not exists fat_g               numeric(6, 2),
  add column if not exists ai_generated_fields text[] not null default '{}';

-- ── 2. Extinde feature-urile de metering AI ─────────────────────────
-- Constrângerea inline din mig 168 se numește implicit `ai_usage_feature_check`.
alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in ('chat', 'menu_import', 'image_gen', 'nutrition'));

-- ── Asserții fail-closed ────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='products' and column_name='calories') then
    raise exception 'mig 170: products.calories lipsește'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='products' and column_name='ai_generated_fields') then
    raise exception 'mig 170: products.ai_generated_fields lipsește'; end if;

  -- Noua constrângere acceptă image_gen/nutrition
  begin
    insert into public.ai_usage (restaurant_id, feature)
      values ('00000000-0000-0000-0000-000000000000', 'image_gen');
    raise exception 'mig 170: insert de test a trecut (nu ar fi trebuit — FK restaurant)';
  exception
    when foreign_key_violation then
      null; -- OK: constrângerea de feature a trecut, doar FK-ul a picat (așteptat)
    when check_violation then
      raise exception 'mig 170: feature image_gen respins de check (constrângere neactualizată)';
  end;

  raise notice 'mig 170: product AI enrichment OK';
end $$;

commit;

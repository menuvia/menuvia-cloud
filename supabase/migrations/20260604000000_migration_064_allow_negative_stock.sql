-- Migration 064: stoc poate fi negativ — alerting în loc de blocare
-- ─────────────────────────────────────────────────────────────────────
-- BUG (P0 production-breaker): ingredients.current_stock are constraint
--   check (current_stock >= 0)
-- iar trigger-ul de la trecerea order → paid (migration 026:341) face
--   update ingredients set current_stock = current_stock - consumption
-- Când produsul are rețetă și stocul ar trece sub 0, UPDATE-ul violează
-- constraint-ul → trigger eșuează → tranziția la 'paid' eșuează → casierul
-- NU POATE ÎNCHIDE BONUL. În ora de vârf = pierdere de venit + chaos.
--
-- Realitatea HoReCa: stocul teoretic e des greșit (preparator a uitat să
-- înregistreze receipt-ul, gramaj real ≠ rețetă, pierdere la preparare).
-- Sistemul TREBUIE să permită vânzarea când POS-ul fizic confirmă bonul,
-- și să alerteze ownerul că trebuie reconciliere stoc.
--
-- Fix:
--   1. Drop constraint check (current_stock >= 0)
--   2. Trigger-ul existent continuă să scadă (nu schimb logica) — DOAR
--      că acum nu mai e blocat de constraint
--   3. Audit suplimentar în stock_movements când rezultatul e < 0 →
--      ownerul vede în feed-ul de mișcări care ingrediente sunt below_zero
--
-- min_stock_alert păstrează `>= 0` (threshold, nu valoare de stoc).

-- ── 1. Drop constraint pe ingredients.current_stock ─────────────
-- Numele default Postgres pentru column check: <tabel>_<coloană>_check
alter table public.ingredients
  drop constraint if exists ingredients_current_stock_check;

comment on column public.ingredients.current_stock is
  'Stoc curent în unitatea declarată. Poate fi negativ când vânzarea ' ||
  'depășește stocul teoretic — semn de reconciliere necesară (preparator ' ||
  'a uitat receipt, gramaj real ≠ rețetă, pierdere). UI afișează badge ' ||
  '"reconciliere necesară" când <0.';

-- ── 2. Extinde CHECK-urile pe stock_movements pentru below_zero_alert ──
-- stock_movements.reason are check (in 'purchase','sale','waste',
-- 'inventory','manual') și reference_type (in 'order','purchase_order',
-- 'manual'). Audit event-ul de mai jos folosește reason='below_zero_alert'
-- și reference_type='system', deci extindem ambele constraints.
alter table public.stock_movements
  drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements
  add constraint stock_movements_reason_check
  check (reason in ('purchase', 'sale', 'waste', 'inventory', 'manual', 'below_zero_alert'));

alter table public.stock_movements
  drop constraint if exists stock_movements_reference_type_check;
alter table public.stock_movements
  add constraint stock_movements_reference_type_check
  check (reference_type is null or reference_type in ('order', 'purchase_order', 'manual', 'system'));

-- ── 3. Trigger care log-uiește tranziția stoc >=0 → <0 ──────────
-- Trigger-ul de scădere stoc din migration 026 face deja insert cu
-- reason='sale'. Adăugăm un trigger AFTER UPDATE care detectează prima
-- trecere sub zero și inserează un event distinct, ușor de query-uit
-- pentru "ce ingrediente au nevoie de reconciliere".

create or replace function public.trg_log_stock_below_zero()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Doar tranziția 0+ → negativ (nu spam pe fiecare update sub zero)
  if OLD.current_stock >= 0 and NEW.current_stock < 0 then
    insert into public.stock_movements (
      ingredient_id, change_amount, reason, reference_type, reference_id, notes
    ) values (
      NEW.id,
      NEW.current_stock - OLD.current_stock,
      'below_zero_alert',
      'system',
      null,
      format(
        'Stoc trecut sub 0 pentru %s: %s → %s. Verifică receipt-urile și ' ||
        'reconciliază înainte de raportul Z.',
        NEW.name, OLD.current_stock::text, NEW.current_stock::text
      )
    );
  end if;
  return null;
end;
$$;

drop trigger if exists trg_log_stock_below_zero on public.ingredients;
create trigger trg_log_stock_below_zero
  after update of current_stock on public.ingredients
  for each row execute function public.trg_log_stock_below_zero();

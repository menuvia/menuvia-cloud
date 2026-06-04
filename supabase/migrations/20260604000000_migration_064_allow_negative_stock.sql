-- Migration 064: stoc poate fi negativ (deblochează închiderea bonului)
-- ─────────────────────────────────────────────────────────────────────
-- BUG (P0 production-breaker): ingredients.current_stock are constraint
--   check (current_stock >= 0)
-- iar trigger-ul de la trecerea order → paid (migration 026:341) face
--   update ingredients set current_stock = current_stock - consumption
-- Când produsul are rețetă și stocul ar trece sub 0, UPDATE violează
-- constraint → trigger eșuează → tranziția la 'paid' eșuează → casierul
-- NU POATE ÎNCHIDE BONUL. În ora de vârf = pierdere de venit + chaos.
--
-- Realitatea HoReCa: stocul teoretic e des greșit (preparator a uitat să
-- înregistreze receipt-ul, gramaj real ≠ rețetă, pierdere la preparare).
-- Sistemul TREBUIE să permită vânzarea când POS-ul fizic confirmă bonul.
--
-- Fix: drop constraint pe ingredients.current_stock. Trigger-ul existent
-- din mig 026 continuă să scadă fără să mai fie blocat. min_stock_alert
-- păstrează `>= 0` (threshold, nu valoare de stoc).
--
-- Alerting („ce ingrediente au nevoie de reconciliere") se rezolvă în UI
-- printr-un query simplu `where current_stock < 0` când vom avea cerere
-- reală. Nu construim alerting speculativ acum.

alter table public.ingredients
  drop constraint if exists ingredients_current_stock_check;

comment on column public.ingredients.current_stock is
  $$Stoc curent în unitatea declarată. Poate fi negativ când vânzarea depășește stocul teoretic — semn de reconciliere necesară (preparator a uitat receipt, gramaj real ≠ rețetă, pierdere). UI poate afișa badge "reconciliere necesară" prin query: where current_stock < 0.$$;

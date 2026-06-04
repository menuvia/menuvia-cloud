-- Migration 071: enterprise = aproape nelimitat la tot, AI imports plafonat
-- ─────────────────────────────────────────────────────────────────────
-- Feedback tester: enterprise avea 99999 produse/99 restaurante/999 mese,
-- valori finite care nu reflectă semantica „enterprise = unlimited".
-- Ridic la valori absurde (1B) ca să fie effectively unlimited fără
-- modificare de schemă (max_* sunt NOT NULL).
--
-- AI imports rămâne plafonat (5000/lună): are cost real per request
-- la provider AI extern → enterprise plătește mai mult, dar nu nelimitat.
-- Dacă ai nevoie de mai mult, ridicăm pe contract.

update public.plan_limits
set
  max_products     = 1000000000,  -- 1B
  max_restaurants  = 1000000000,
  max_tables       = 1000000000,
  ai_imports_month = 5000
where plan = 'enterprise';

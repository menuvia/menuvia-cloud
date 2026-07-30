-- ═══════════════════════════════════════════════════════════════════
-- Migration 213: ai_usage — adaugă 'translate' la feature-urile permise
-- ─────────────────────────────────────────────────────────────────────
-- BUG (review adversarial AI): ai-proxy.js și lib/ai.ts acceptă feature-ul
-- 'translate' (traducerea meniului), dar constrângerea ai_usage_feature_check
-- (mig 168 → rescrisă mig 170) NU-l include: 'chat','menu_import','image_gen',
-- 'nutrition'. Consecință: ai_record_usage('translate') → INSERT respins de
-- CHECK → RPC-ul aruncă → metering-ul NU scade cota → ai-proxy tratează ca
-- „cost suportat, cotă nescăzută" și întoarce 200. Traducerile de meniu erau
-- GRATUITE și NELIMITATE pe cheia platformei (PLATFORM_OPENAI_KEY), invizibile
-- în admin_ai_overview. Fix: extinde constrângerea.
--
-- Capcană generală: orice feature nou adăugat în lib/ai.ts + ai-proxy.js
-- TREBUIE adăugat AICI simultan, altfel metering-ul lui se rupe tăcut.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in ('chat', 'menu_import', 'image_gen', 'nutrition', 'translate'));

-- ── Asserție fail-closed ─────────────────────────────────────────────
do $$
begin
  -- 'translate' trebuie să treacă acum constrângerea (metering funcțional).
  if not exists (
    select 1 from pg_constraint
     where conname = 'ai_usage_feature_check'
       and pg_get_constraintdef(oid) like '%translate%'
  ) then
    raise exception 'ASSERT FAIL: ai_usage_feature_check nu include translate';
  end if;
end $$;

commit;

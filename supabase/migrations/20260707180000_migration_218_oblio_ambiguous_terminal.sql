-- ═══════════════════════════════════════════════════════════════════
-- Migration 218: Oblio — eșec AMBIGUU (timeout/rețea) devine TERMINAL, nu se re-face
-- ─────────────────────────────────────────────────────────────────────
-- BUG (audit fiscal, HIGH): la un eșec ambiguu în timpul POST-ului către Oblio
-- (AbortError/timeout/ECONNRESET — Oblio POATE fi creat deja factura, dar
-- răspunsul s-a pierdut), oblio-generator.js scria doar un avertisment în
-- last_error și apela `bridge_oblio_mark_failed`. Dar acela re-pune `status='queued'`
-- cât timp failed_attempts+1 < 3 → cron-ul (la 2 min) RE-CLAIM-uiește automat și
-- face din nou POST /docs/invoice. Dacă primul POST chiar a creat factura, al doilea
-- creează un al DOILEA document fiscal REAL (Oblio nu dedup pe internalNote) —
-- risc fiscal/ANAF. Mitigarea „founderul verifică înainte de retry" din comentariu
-- NU era forțată nicăieri: retry-ul era automat.
--
-- Fix (fail-safe, aliniat cu regula de aur fiscală): un eșec ambiguu marchează
-- factura TERMINAL (`status='failed'`, `next_attempt_at=null`) de la PRIMA apariție
-- → cron-ul NU o mai reia (bridge_oblio_get_queued ia doar 'queued'). Founderul o
-- vede în lista de facturi eșuate cu mesajul „POSIBIL DUPLICAT — verifică în Oblio",
-- iar `admin_retry_invoice` (mig 186, reset status→queued) rămâne calea de retry
-- MANUAL după confirmarea umană. Erorile 4xx clare (factură sigur necreată) trec în
-- continuare prin `bridge_oblio_mark_failed` (retry automat sigur).
--
-- Funcție NOUĂ (nu editez bridge_oblio_mark_failed) — service_role-only, ca surorile ei.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.bridge_oblio_mark_ambiguous(
  p_invoice_id uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.invoices
     set failed_attempts = failed_attempts + 1,
         last_error = left(p_error, 1000),
         -- TERMINAL de la prima apariție: fără auto-requeue (risc de duplicat fiscal).
         status = 'failed'::invoice_status,
         next_attempt_at = null
   where id = p_invoice_id;

  return found;
end;
$$;

revoke all on function public.bridge_oblio_mark_ambiguous(uuid, text) from public;
-- Service role only (identic cu bridge_oblio_mark_failed / mig 181 — fără grant explicit).

-- ── Asserție fail-closed: terminal + service_role-only ───────────────
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.bridge_oblio_mark_ambiguous(uuid, text)'::regprocedure);
  if position($q$status = 'failed'::invoice_status$q$ in v_def) = 0
     or position('next_attempt_at = null' in v_def) = 0 then
    raise exception 'ASSERT FAIL: bridge_oblio_mark_ambiguous trebuie să fie TERMINAL (mig 218)';
  end if;
  if has_function_privilege('anon', 'public.bridge_oblio_mark_ambiguous(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.bridge_oblio_mark_ambiguous(uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL: bridge_oblio_mark_ambiguous trebuie să rămână service_role-only';
  end if;
end $$;

commit;

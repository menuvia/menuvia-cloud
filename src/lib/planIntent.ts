// ─────────────────────────────────────────────────────────────
// planIntent.ts — Helperi pentru păstrarea planului-țintă între
// pricing → /auth → checkout. Mutat din AuthPage.tsx ca fișierul de
// componente să respecte regula react-refresh/only-export-components.
// ─────────────────────────────────────────────────────────────

const PLAN_INTENT_KEY = 'menuvia.plan_intent'

export function readPlanIntent(): string | null {
  try {
    return sessionStorage.getItem(PLAN_INTENT_KEY)
  } catch {
    return null
  }
}

export function clearPlanIntent(): void {
  try {
    sessionStorage.removeItem(PLAN_INTENT_KEY)
  } catch {
    /* ignore (private mode) */
  }
}

export function writePlanIntent(plan: string): void {
  try {
    sessionStorage.setItem(PLAN_INTENT_KEY, plan)
  } catch {
    /* ignore (private mode) */
  }
}

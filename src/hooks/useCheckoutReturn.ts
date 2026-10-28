// ─────────────────────────────────────────────────────────────
// useCheckoutReturn — ce vede omul când se întoarce din Stripe.
//
// `?checkout=success` → „Activăm planul…": planul NU e activ în momentul
// redirectului (îl scrie webhook-ul `stripe-webhook.js` în `profiles.plan`,
// asincron), deci reîncărcăm profilul la fiecare 2 s, cel mult 30 s, și ne
// oprim când profilul are PLANUL CUMPĂRAT (`checkout_plan=` din success_url)
// → „Planul tău e activ". Fără parametru (funcție veche): la prima SCHIMBARE.
// Peste 30 s fără schimbare → `slow` (mesaj onest, fără buclă infinită).
// `?checkout=cancelled` → mesaj pe /pricing.
//
// În ambele cazuri parametrul se ȘTERGE din URL (history.replaceState) și
// intenția de plan se consumă — altfel un refresh ar re-afișa bannerul, iar o
// intenție rămasă ar trimite omul înapoi în Stripe la următorul login.
//
// Planul citit aici e `profiles.plan` (cel pe care îl scrie Stripe), NU un gate
// de UI — pentru gating rămâne `useFeatures(restaurantId)` (regula 3).
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react'
import { clearPlanIntent } from '../lib/planIntent'
import {
  checkoutActivated,
  readCheckoutPlanParam,
  readCheckoutReturnParam,
  stripCheckoutParam,
} from '../lib/checkoutReturn'

export type CheckoutReturnStatus = 'idle' | 'activating' | 'active' | 'slow' | 'cancelled'

export const CHECKOUT_POLL_INTERVAL_MS = 2000
export const CHECKOUT_POLL_MAX_MS = 30000

export interface CheckoutReturnInput {
  /** Există sesiune? Fără ea `refreshProfile` nu are ce reîncărca. */
  hasUser: boolean
  /** `profiles.plan` curent; null = profil încă necunoscut. */
  plan: string | null
  refreshProfile: () => Promise<void>
}

export interface CheckoutReturnState {
  status: CheckoutReturnStatus
  dismiss: () => void
}

export function useCheckoutReturn({
  hasUser,
  plan,
  refreshProfile,
}: CheckoutReturnInput): CheckoutReturnState {
  // Citit SINCRON la montare: întoarcerea din Stripe e o încărcare completă de
  // pagină, deci URL-ul de la montare e cel care contează.
  const [status, setStatus] = useState<CheckoutReturnStatus>(() => {
    const p = readCheckoutReturnParam(window.location.search)
    if (p === 'success') return 'activating'
    if (p === 'cancelled') return 'cancelled'
    return 'idle'
  })
  // Planul cumpărat, citit tot la montare (URL-ul e curățat imediat după).
  const [purchased] = useState(() => readCheckoutPlanParam(window.location.search))

  // `refreshProfile` din AuthContext e o funcție NOUĂ la fiecare randare; prin
  // ref, intervalul nu se repornește (și nu-și resetează ritmul) la fiecare.
  const refreshRef = useRef(refreshProfile)
  useEffect(() => {
    refreshRef.current = refreshProfile
  }, [refreshProfile])

  // Curățarea URL-ului + consumarea intenției: o singură dată, la montare.
  useEffect(() => {
    if (readCheckoutReturnParam(window.location.search) === null) return
    clearPlanIntent()
    try {
      window.history.replaceState(window.history.state, '', stripCheckoutParam(window.location.href))
    } catch {
      /* URL nemodificabil (sandbox) — bannerul rămâne corect oricum */
    }
  }, [])

  // Planul de referință = primul plan CUNOSCUT după întoarcere (folosit doar
  // fără `checkout_plan`). „Activ" = profilul are planul CUMPĂRAT — inclusiv
  // când webhook-ul a ajuns ÎNAINTEA paginii; un plan plătit oarecare (ex. unul
  // manual) nu e dovada (`checkoutActivated`).
  const baselineRef = useRef<string | null>(null)
  useEffect(() => {
    if (status !== 'activating' || plan == null) return
    if (baselineRef.current == null) baselineRef.current = plan
    if (checkoutActivated(purchased, baselineRef.current, plan)) setStatus('active')
  }, [status, plan, purchased])

  // Plafonul de 30 s curge de la întoarcere, indiferent de sesiune: dacă
  // sesiunea nu apare deloc, omul primește tot un mesaj, nu un spinner etern.
  useEffect(() => {
    if (status !== 'activating') return
    const t = setTimeout(() => setStatus('slow'), CHECKOUT_POLL_MAX_MS)
    return () => clearTimeout(t)
  }, [status])

  // Bucla de reîmprospătare: doar cu sesiune, oprită de cleanup la `active`,
  // `slow`, `dismiss` sau demontare.
  useEffect(() => {
    if (status !== 'activating' || !hasUser) return
    const id = setInterval(() => {
      void refreshRef.current().catch(() => undefined)
    }, CHECKOUT_POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [status, hasUser])

  const dismiss = useCallback(() => setStatus('idle'), [])

  return { status, dismiss }
}

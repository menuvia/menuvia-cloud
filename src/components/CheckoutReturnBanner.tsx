// Bannerul de întoarcere din Stripe (`?checkout=success|cancelled`).
//
// DELIBERAT nu e un `role="dialog"` și nu stă fixat JOS: overlay-urile de jos
// interceptează click-urile pe bara de navigare mobilă (clasa documentată în
// CLAUDE.md, cookie banner / cardurile PWA). E o bandă `role="status"` sus,
// care se poate închide și nu blochează nimic sub ea.
import { useAuth } from '../contexts/AuthContext'
import { useCheckoutReturn, type CheckoutReturnStatus } from '../hooks/useCheckoutReturn'
import { D } from '../lib/constants'
import { chromeT, type ChromeKey } from '../i18n/chrome'
import { useChrome } from '../i18n/useChromeLang'

// Copy NEUTRU pe bani: pe Meniu Digital / Meniu + Comenzi primele 30 de zile
// sunt GRATUITE (trial), deci la întoarcerea din Stripe nu s-a încasat nimic —
// „Plata a fost primită" ar fi fost fals exact pe planurile cu trial. Testul
// CB1 păzește clasa (orice formulare care pretinde o încasare), în toate
// limbile.
//
// Textele stau în `chrome.ts` (micro-tabelul fără importuri al intrării), nu
// într-un namespace din `src/i18n/ns/`: bannerul e montat global, deci în
// graful intrării (SK4). Limba e a PAGINII (`<html lang>`): pe /dashboard o
// pune `StaffDocumentLang` (limba personalului — Stripe Checkout urmează deja
// `ui_lang`, deci omul se întoarce din plata în germană pe un banner în
// germană), pe /pricing rămâne a site-ului.
const COPY: Record<Exclude<CheckoutReturnStatus, 'idle'>, { title: ChromeKey; body: ChromeKey }> = {
  activating: { title: 'checkout_activating_title', body: 'checkout_activating_body' },
  active: { title: 'checkout_active_title', body: 'checkout_active_body' },
  slow: { title: 'checkout_slow_title', body: 'checkout_slow_body' },
  cancelled: { title: 'checkout_cancelled_title', body: 'checkout_cancelled_body' },
}

export default function CheckoutReturnBanner() {
  const { user, profile, refreshProfile } = useAuth()
  const { lang, fallback } = useChrome()
  const { status, dismiss } = useCheckoutReturn({
    hasUser: user != null,
    plan: profile?.plan ?? null,
    refreshProfile,
  })

  if (status === 'idle') return null
  const copy = COPY[status]
  const tone =
    status === 'active'
      ? { bg: D.greenA, border: D.green }
      : status === 'cancelled' || status === 'slow'
        ? { bg: D.amberA, border: D.amber }
        : { bg: D.infoA, border: D.info }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="checkout-return-banner"
      lang={fallback}
      style={{
        position: 'fixed',
        top: 12,
        left: 16,
        right: 16,
        zIndex: 9000,
        maxWidth: 560,
        margin: '0 auto',
        background: D.s1,
        backgroundImage: `linear-gradient(${tone.bg}, ${tone.bg})`,
        border: `1px solid ${tone.border}`,
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        fontFamily: D.fontBody,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: D.t1, fontWeight: 700, fontSize: '0.95rem' }}>{chromeT(lang, copy.title)}</div>
        <div style={{ color: D.t2, fontSize: '0.85rem', marginTop: 2, lineHeight: 1.45 }}>
          {chromeT(lang, copy.body)}
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={chromeT(lang, 'checkout_close')}
        style={{
          background: 'transparent',
          border: 'none',
          color: D.t2,
          fontSize: '1.1rem',
          lineHeight: 1,
          cursor: 'pointer',
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  )
}

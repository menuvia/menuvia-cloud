import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { hasConsent } from './lib/cookieConsent'
import { initAnalytics } from './lib/analytics'
import { captureReferralFromUrl } from './lib/affiliate'
// Ordinea contează: tokens (variabile) → global (reset+body) → animații
import './styles/tokens.css'
import './styles/global.css'
import './styles/animations.css'

// Captură referral DE AFILIERE înainte de orice randare: dacă URL-ul e
// `/r/:cod`, salvăm codul în cookie și rescriem la `/`. Trebuie să ruleze
// înaintea router-ului (parsePath) ca să nu cadă pe ruta `notfound`.
captureReferralFromUrl()

function removeAppLoader() {
  document.getElementById('app-loader')?.remove()
}

// ─────────────────────────────────────────────────────────────────
// Sentry init — DOAR cu consent + cu PII filtrat (GDPR-compliant)
// ─────────────────────────────────────────────────────────────────
// Referință la modulul Sentry încărcat LAZY. Rămâne null cât timp userul nu
// a dat consent (perf) — clientul anonim de la masă NU descarcă chunk-ul
// Sentry pe calea critică a meniului QR. Error-boundary-ul de mai jos îi
// trimite erorile doar dacă a fost inițializat.
let sentryApi: typeof import('@sentry/react') | null = null

async function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  // Import dinamic: scoate @sentry/react din graful STATIC al entry-ului →
  // chunk-ul vendor-sentry se descarcă abia aici (idle + consent), nu la load.
  const Sentry = await import('@sentry/react')
  sentryApi = Sentry

  Sentry.init({
    dsn,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
    environment: import.meta.env.MODE,

    // ✅ GDPR: nu trimite IP, user-agent extins, sau cookies
    sendDefaultPii: false,

    // ✅ Filtrează datele înainte de transmitere la Sentry US
    beforeSend(event) {
      // Elimină query strings care pot conține tokens/parole
      if (event.request?.url) {
        event.request.url = event.request.url.split('?')[0]
      }
      // Elimină headers sensibile
      if (event.request?.headers) {
        delete event.request.headers['Authorization']
        delete event.request.headers['Cookie']
      }
      // Elimină extra context care poate conține date utilizator
      if (event.extra?.email) delete event.extra.email
      if (event.extra?.phone) delete event.extra.phone
      return event
    },

    beforeSendTransaction(event) {
      if (event.request?.url) {
        event.request.url = event.request.url.split('?')[0]
      }
      return event
    },
  })
}

// Defer-uim inițializarea Sentry + analytics după primul paint ca să nu
// blocăm main thread la încărcare. `requestIdleCallback` execută când
// browser-ul e idle; fallback la setTimeout dacă API-ul nu există (Safari).
type IdleScheduler = (cb: () => void) => void
const scheduleIdle: IdleScheduler =
  typeof (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ===
  'function'
    ? (cb) => {
        const w = window as unknown as { requestIdleCallback: (cb: () => void) => number }
        w.requestIdleCallback(cb)
      }
    : (cb) => {
        setTimeout(cb, 1)
      }

if (hasConsent('performance')) {
  scheduleIdle(() => {
    void initSentry()
    initAnalytics()
  })
}

// Re-inițializare când utilizatorul schimbă consent — fără defer, e răspuns
// direct la acțiunea utilizatorului
window.addEventListener('consent-updated', () => {
  if (hasConsent('performance')) {
    void initSentry()
    initAnalytics()
  }
})

// ─────────────────────────────────────────────────────────────────
// Error boundary lightweight (fără dependență de Sentry pe calea critică).
// Redă un fallback prietenos și, DACĂ Sentry s-a încărcat (consent), îi
// trimite excepția — best-effort, fără să blocheze randarea.
// ─────────────────────────────────────────────────────────────────
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    sentryApi?.captureException(error, {
      extra: { componentStack: info.componentStack },
    })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            color: '#999',
            fontFamily: 'sans-serif',
          }}
        >
          A apărut o eroare. Reîncarcă pagina.
        </div>
      )
    }
    return this.props.children
  }
}

// Register Service Worker for Web Push Notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('SW registration failed:', err))
  })
}

try {
  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('Root element #root not found')

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>,
  )
  removeAppLoader()
} catch (err) {
  removeAppLoader()
  throw err
}

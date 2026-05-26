import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App'
import { hasConsent } from './lib/cookieConsent'
import { initAnalytics } from './lib/analytics'
import './index.css'

function removeAppLoader() {
  document.getElementById('app-loader')?.remove()
}

// ─────────────────────────────────────────────────────────────────
// Sentry init — DOAR cu consent + cu PII filtrat (GDPR-compliant)
// ─────────────────────────────────────────────────────────────────
function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

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
        ;(
          window as unknown as { requestIdleCallback: (cb: () => void) => number }
        ).requestIdleCallback(cb)
      }
    : (cb) => {
        setTimeout(cb, 1)
      }

if (hasConsent('performance')) {
  scheduleIdle(() => {
    initSentry()
    initAnalytics()
  })
}

// Re-inițializare când utilizatorul schimbă consent — fără defer, e răspuns
// direct la acțiunea utilizatorului
window.addEventListener('consent-updated', () => {
  if (hasConsent('performance')) {
    initSentry()
    initAnalytics()
  }
})

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
      <Sentry.ErrorBoundary
        fallback={
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
        }
      >
        <App />
      </Sentry.ErrorBoundary>
    </React.StrictMode>,
  )
  removeAppLoader()
} catch (err) {
  removeAppLoader()
  throw err
}

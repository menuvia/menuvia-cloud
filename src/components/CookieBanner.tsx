// src/components/CookieBanner.tsx
// ─────────────────────────────────────────────────────────────────
// Cookie consent banner — GDPR + Legea 506/2004 compliant
//
// Funcționează standalone fără biblioteci externe.
// Setări persistente în localStorage. Trigger evenimente custom
// pentru ca Sentry/PostHog să se inițializeze/oprească dinamic.
// ─────────────────────────────────────────────────────────────────
import { useState, useEffect, type CSSProperties } from 'react'
import { D } from '../lib/constants'
import { getConsent, saveConsent } from '../lib/cookieConsent'

export default function CookieBanner() {
  const [visible, setVisible] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [perf, setPerf] = useState(false)
  const [func, setFunc] = useState(false)

  useEffect(() => {
    // Arată banner-ul doar dacă nu a fost setat consimțământ
    const existing = getConsent()
    if (!existing) {
      // Mic delay pentru UX (nu apare instant)
      setTimeout(() => setVisible(true), 800)
    }
    // Redeschidere la cerere („Setări cookies" din LegalFooter): /cookies promite
    // retragerea consimțământului „prin banner", deci bannerul trebuie să poată fi
    // rechemat după alegere — altfel promisiunea era falsă (GDPR).
    const reopen = () => {
      const c = getConsent()
      if (c) {
        setPerf(c.performance)
        setFunc(c.functional)
      }
      setShowDetails(true)
      setVisible(true)
    }
    window.addEventListener('menuvia:open-cookie-settings', reopen)
    return () => window.removeEventListener('menuvia:open-cookie-settings', reopen)
  }, [])

  function acceptAll() {
    saveConsent({
      necessary: true,
      performance: true,
      functional: true,
      timestamp: Date.now(),
    })
    setVisible(false)
  }

  function rejectAll() {
    saveConsent({
      necessary: true,
      performance: false,
      functional: false,
      timestamp: Date.now(),
    })
    setVisible(false)
  }

  function saveCustom() {
    saveConsent({
      necessary: true,
      performance: perf,
      functional: func,
      timestamp: Date.now(),
    })
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        right: 16,
        maxWidth: 560,
        margin: '0 auto',
        background: D.s1,
        border: `1px solid ${D.border}`,
        borderRadius: 14,
        padding: 20,
        zIndex: 9999,
        boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
        fontFamily: 'DM Sans, sans-serif',
      }}
      role="dialog"
      aria-labelledby="cookie-banner-title"
    >
      <div
        id="cookie-banner-title"
        style={{
          fontFamily: 'Fraunces, serif',
          fontSize: 17,
          color: D.t1,
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        Cookies
      </div>
      <p style={{ fontSize: 13, color: D.t2, lineHeight: 1.6, margin: 0, marginBottom: 14 }}>
        Folosim cookies strict necesare pentru funcționare. Cu acordul tău, folosim și cookies de
        performanță (Sentry + analytics) și funcționale (notificări).{' '}
        <a href="/cookies" style={{ color: D.gold, textDecoration: 'underline' }}>
          Detalii
        </a>
      </p>

      {showDetails && (
        <div style={{ background: D.s2, borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <ToggleRow
            label="Strict necesare"
            desc="Autentificare, sesiune. Nu pot fi dezactivate."
            checked
            disabled
          />
          <ToggleRow
            label="Performanță"
            desc="Sentry (monitorizare erori) + PostHog (analytics anonim)."
            checked={perf}
            onChange={setPerf}
          />
          <ToggleRow
            label="Funcționale"
            desc="Push notifications, temă, preferințe avansate."
            checked={func}
            onChange={setFunc}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={acceptAll} style={btnPrimary}>
          Acceptă toate
        </button>
        <button onClick={rejectAll} style={btnSecondary}>
          Doar necesare
        </button>
        {!showDetails && (
          <button onClick={() => setShowDetails(true)} style={btnTertiary}>
            Personalizează
          </button>
        )}
        {showDetails && (
          <button onClick={saveCustom} style={btnSecondary}>
            Salvează preferințele
          </button>
        )}
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  label: string
  desc: string
  checked: boolean
  disabled?: boolean
  onChange?: (v: boolean) => void
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '8px 0',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <div>
        <div style={{ fontSize: 13, color: D.t1, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 12, color: D.t3 }}>{desc}</div>
      </div>
    </label>
  )
}

const btnPrimary: CSSProperties = {
  background: D.gold,
  color: '#000',
  border: 'none',
  borderRadius: 8,
  padding: '10px 18px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'DM Sans, sans-serif',
}

const btnSecondary: CSSProperties = {
  background: 'transparent',
  color: D.t1,
  border: `1px solid ${D.border}`,
  borderRadius: 8,
  padding: '10px 18px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'DM Sans, sans-serif',
}

const btnTertiary: CSSProperties = {
  background: 'transparent',
  color: D.t3,
  border: 'none',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'DM Sans, sans-serif',
  textDecoration: 'underline',
}

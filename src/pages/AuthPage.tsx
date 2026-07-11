// ─────────────────────────────────────────────────────────────
// AuthPage — punctul de conversie al funnel-ului (Val 1, DESIGN_SPEC.md).
// Vizual: lumea caldă-luminoasă (ca landing/pricing), NU paleta de dashboard.
// Dacă userul a venit din pricing cu un plan ales, pill-ul de plan intent
// îi confirmă alegerea — nu aterizează pe un login generic.
// Logica de auth (signup/login/reset/confirm email) e neschimbată.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getPlanByInternalId } from '../lib/plans'
import { useIsMobile } from '../hooks/useIsMobile'

// Prefetch: start loading DashboardPage in the background while the user
// types credentials. By the time login completes, the chunk is cached.
const _prefetch = import('../pages/DashboardPage').catch(() => {
  /* ignore */
})
void _prefetch // prevent unused-var lint

// Paleta caldă-luminoasă (aliniată cu M din App.tsx — marketing funnel)
const A = {
  bg: '#FAF9F6',
  panel: '#F5F1EA',
  surface: '#FFFFFF',
  text: '#1A1208',
  text2: '#5C4A2A',
  text3: '#9A8C7A',
  border: '#E8E0D2',
  accent: '#C8963C',
  accentSoft: '#FAF3E5',
  error: '#B3403F',
  errorBg: 'rgba(179,64,63,0.08)',
  errorBorder: 'rgba(179,64,63,0.3)',
}

const inp: React.CSSProperties = {
  width: '100%',
  background: A.surface,
  border: `1px solid ${A.border}`,
  borderRadius: 10,
  padding: '12px 14px',
  fontSize: '0.95rem',
  color: A.text,
  outline: 'none',
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}

const label: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  color: A.text2,
  marginBottom: 6,
  fontWeight: 500,
}

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? A.border : A.accent,
  color: disabled ? A.text3 : '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '14px 0',
  fontFamily: 'DM Sans,sans-serif',
  fontSize: 15,
  fontWeight: 700,
  cursor: disabled ? 'not-allowed' : 'pointer',
  boxShadow: disabled ? 'none' : '0 4px 14px rgba(200,150,60,0.25)',
})

// Helperii readPlanIntent/clearPlanIntent/writePlanIntent + cheia au fost
// mutați în ../lib/planIntent ca să respecte react-refresh/only-export-components.
import { readPlanIntent, writePlanIntent } from '../lib/planIntent'

function readIntentFromUrlOrSession(): 'starter' | 'growth' | 'pro' | null {
  const m = window.location.search.match(/[?&]plan=(starter|growth|pro)\b/)
  if (m) return m[1] as 'starter' | 'growth' | 'pro'
  const s = readPlanIntent()
  if (s === 'starter' || s === 'growth' || s === 'pro') return s
  return null
}

// Subcopy comercial per plan — copy, nu date (numele/emoji vin din plans.ts).
const INTENT_SUBCOPY: Record<'starter' | 'growth' | 'pro', string> = {
  starter: 'Plan pentru meniu QR, fără comenzi.',
  growth: 'Plan recomandat pentru comenzi de la masă.',
  pro: 'Se activează cu verificare inițială — te contactăm noi.',
}

function PlanIntentPill({ intent }: { intent: 'starter' | 'growth' | 'pro' }) {
  const plan = getPlanByInternalId(intent)
  return (
    <div
      style={{
        background: A.accentSoft,
        border: `1px solid ${A.accent}55`,
        borderRadius: 12,
        padding: '12px 16px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span style={{ fontSize: '1.3rem' }}>{plan.emoji}</span>
      <div>
        <div style={{ color: A.text, fontSize: '0.9rem', fontWeight: 700 }}>
          Continui cu {plan.name}
        </div>
        <div style={{ color: A.text2, fontSize: '0.76rem', marginTop: 2 }}>
          {INTENT_SUBCOPY[intent]}
        </div>
      </div>
    </div>
  )
}

// Cardul centrat folosit de sub-ecranele reset/confirm (păstrează layoutul
// simplu cu o singură coloană — acolo nu e nevoie de panoul de brand).
function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: A.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        fontFamily: 'DM Sans,sans-serif',
      }}
    >
      <div
        style={{
          background: A.surface,
          border: `1px solid ${A.border}`,
          borderRadius: 18,
          padding: 36,
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 8px 32px rgba(26,18,8,0.06)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

export default function AuthPage({ onSuccess }: { onSuccess: () => void }) {
  // Intent-ul e citit SINCRON (URL > session) ca pill-ul să apară din primul
  // render, fără flash. Effect-ul de mai jos doar persistă URL-ul în session.
  const [planIntent] = useState<'starter' | 'growth' | 'pro' | null>(readIntentFromUrlOrSession)
  const isMobile = useIsMobile()

  // Persistăm planul-țintă dacă /auth a fost deschisă din /pricing cu ?plan=...
  // Citim direct URL-ul (nu folosim router) ca să nu adăugăm dependență.
  useEffect(() => {
    const m = window.location.search.match(/[?&]plan=(starter|growth|pro)\b/)
    if (m) writePlanIntent(m[1])
  }, [])

  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // FIX: separate state for "signup needs email confirmation" case
  const [confirmEmail, setConfirmEmail] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetEmail, setResetEmail] = useState('')

  // Erorile Supabase vin în ENGLEZĂ (Invalid login credentials etc.) — publicul
  // e non-tehnic și român. Mapăm mesajele cunoscute pe română; necunoscutele cad
  // pe un mesaj generic acționabil (nu textul brut englez).
  const translateAuthError = (msg: string): string => {
    const m = msg.toLowerCase()
    if (m.includes('invalid login credentials')) return 'Email sau parolă greșită.'
    if (m.includes('already registered') || m.includes('already been registered'))
      return 'Există deja un cont cu acest email. Încearcă autentificarea sau resetarea parolei.'
    if (m.includes('email not confirmed'))
      return 'Emailul nu e confirmat încă. Verifică inbox-ul (și spam-ul) pentru linkul de confirmare.'
    if (m.includes('password should be') || m.includes('password is too short'))
      return 'Parola e prea scurtă — folosește minim 6 caractere.'
    if (m.includes('rate limit') || m.includes('too many requests'))
      return 'Prea multe încercări. Așteaptă un minut și reîncearcă.'
    if (m.includes('invalid email') || m.includes('unable to validate email'))
      return 'Adresa de email nu pare validă. Verific-o și reîncearcă.'
    if (m.includes('network') || m.includes('fetch') || m.includes('failed to'))
      return 'Problemă de conexiune. Verifică internetul și reîncearcă.'
    return 'Nu am putut procesa cererea. Verifică datele și reîncearcă.'
  }

  const handle = async (evt: React.FormEvent) => {
    evt.preventDefault()
    setLoading(true)
    setError(null)

    if (mode === 'signup') {
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      })
      if (signUpErr) {
        setError(translateAuthError(signUpErr.message))
        setLoading(false)
        return
      }

      // If Supabase requires email confirmation, session is null — don't call onSuccess()
      if (!data.session) {
        setConfirmEmail(true)
        setLoading(false)
        return
      }
      onSuccess()
      return
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
    if (signInErr) {
      setError(translateAuthError(signInErr.message))
      setLoading(false)
      return
    }
    onSuccess()
  }

  const handleReset = async () => {
    // Email gol = feedback explicit, nu no-op tăcut (click-ul părea mort).
    if (!resetEmail.trim()) {
      setError('Scrie adresa de email a contului.')
      return
    }
    setLoading(true)
    setError(null)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: (import.meta.env.VITE_APP_URL || window.location.origin) + '/reset-password',
    })
    if (resetErr) {
      setError(translateAuthError(resetErr.message))
      setLoading(false)
      return
    }
    setResetSent(true)
    setLoading(false)
  }

  if (showReset) {
    if (resetSent) {
      return (
        <CenteredCard>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>✉️</div>
            <h2
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: '1.4rem',
                color: A.text,
                marginBottom: 12,
              }}
            >
              Verifică emailul
            </h2>
            <p style={{ color: A.text2, marginBottom: 24, lineHeight: 1.6 }}>
              Am trimis un link de resetare la <strong style={{ color: A.text }}>{resetEmail}</strong>
              .
            </p>
            <button
              onClick={() => {
                setShowReset(false)
                setResetSent(false)
                setMode('login')
              }}
              style={primaryBtn(false)}
            >
              Înapoi la autentificare
            </button>
          </div>
        </CenteredCard>
      )
    }
    return (
      <CenteredCard>
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.1rem',
            color: A.accent,
            marginBottom: 24,
            fontWeight: 700,
          }}
        >
          Menuvia
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.5rem',
            color: A.text,
            marginBottom: 6,
          }}
        >
          Resetează parola
        </h1>
        <p style={{ color: A.text3, fontSize: '0.85rem', marginBottom: 28 }}>
          Introdu emailul și vei primi un link de resetare.
        </p>
        {/* <form> real: Enter trimite (ca formularul principal de login). */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleReset()
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div>
            <label htmlFor="reset-email" style={label}>
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder="email@restaurant.ro"
              style={inp}
            />
          </div>
          {error && (
            <div
              role="alert"
              style={{
                background: A.errorBg,
                border: `1px solid ${A.errorBorder}`,
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                color: A.error,
              }}
            >
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} style={primaryBtn(loading)}>
            {loading ? 'Se procesează...' : 'Trimite link de resetare'}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowReset(false)
              setError(null)
            }}
            style={{
              background: 'none',
              border: 'none',
              color: A.text3,
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontFamily: 'DM Sans,sans-serif',
              marginTop: 4,
            }}
          >
            ← Înapoi la autentificare
          </button>
        </form>
      </CenteredCard>
    )
  }

  // FIX: show "check email" screen instead of proceeding with broken state
  if (confirmEmail) {
    return (
      <CenteredCard>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>📬</div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.4rem',
              color: A.text,
              marginBottom: 12,
            }}
          >
            Verifică emailul
          </h2>
          <p style={{ color: A.text2, marginBottom: 24, lineHeight: 1.6 }}>
            Am trimis un link de confirmare la <strong style={{ color: A.text }}>{email}</strong>.
            <br />
            Confirmă contul, apoi revino să te autentifici.
          </p>
          <button
            onClick={() => {
              setConfirmEmail(false)
              setMode('login')
            }}
            style={primaryBtn(false)}
          >
            Înapoi la autentificare
          </button>
        </div>
      </CenteredCard>
    )
  }

  // ── Panoul de brand (stânga pe desktop / header compact pe mobil) ──
  const brandPanel = isMobile ? (
    <div style={{ padding: '28px 24px 4px', textAlign: 'center' }}>
      <div
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: '1.6rem',
          color: A.accent,
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        Menuvia
      </div>
      <p style={{ color: A.text2, fontSize: '0.9rem', lineHeight: 1.5 }}>
        Configurezi restaurantul în câteva minute.
      </p>
    </div>
  ) : (
    <div
      style={{
        flex: '1 1 380px',
        background: A.panel,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '56px 48px',
      }}
    >
      <div
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: '1.5rem',
          color: A.accent,
          fontWeight: 700,
          marginBottom: 36,
        }}
      >
        Menuvia
      </div>
      <h2
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: 'clamp(1.5rem, 2.6vw, 2rem)',
          color: A.text,
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: '-0.02em',
          marginBottom: 12,
        }}
      >
        Configurezi restaurantul în câteva minute.
      </h2>
      <p style={{ color: A.text2, fontSize: '1rem', lineHeight: 1.6, marginBottom: 28 }}>
        Adaugi meniul, generezi QR-urile și poți primi comenzi direct de la masă.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 36 }}>
        {[
          'Meniu QR gata de folosit',
          'QR-uri pentru mese generate automat',
          'Poți porni simplu și activa comenzi când ai nevoie',
        ].map((t) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: '#E8F2EC',
                border: '1.5px solid #2D8659',
                color: '#2D8659',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7rem',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              ✓
            </span>
            <span style={{ color: A.text, fontSize: '0.92rem' }}>{t}</span>
          </div>
        ))}
      </div>
      <div style={{ color: A.text3, fontSize: '0.82rem' }}>
        30 de zile gratuite. Anulezi oricând.
      </div>
    </div>
  )

  return (
    <div
      style={{
        minHeight: '100vh',
        background: A.bg,
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        fontFamily: 'DM Sans,sans-serif',
      }}
    >
      {brandPanel}

      {/* Panoul de formular */}
      <div
        style={{
          flex: '1 1 420px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: isMobile ? '16px 20px 40px' : '40px 32px',
        }}
      >
        <div
          style={{
            background: A.surface,
            border: `1px solid ${A.border}`,
            borderRadius: 18,
            padding: isMobile ? '28px 22px' : 36,
            width: '100%',
            maxWidth: 420,
            boxShadow: '0 8px 32px rgba(26,18,8,0.06)',
          }}
        >
          {planIntent && <PlanIntentPill intent={planIntent} />}

          <h1
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.5rem',
              color: A.text,
              marginBottom: 6,
              letterSpacing: '-0.02em',
            }}
          >
            {mode === 'login' ? 'Bun venit înapoi' : 'Creează cont gratuit'}
          </h1>
          <p style={{ color: A.text3, fontSize: '0.85rem', marginBottom: 24 }}>
            {mode === 'login'
              ? 'Intră în contul tău Menuvia.'
              : 'Începi cu meniul digital în 30 de secunde.'}
          </p>

          <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'signup' && (
              <div>
                <label htmlFor="auth-name" style={label}>
                  Nume
                </label>
                <input
                  id="auth-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Numele tău"
                  style={inp}
                  onFocus={(e) => (e.target.style.borderColor = A.accent)}
                  onBlur={(e) => (e.target.style.borderColor = A.border)}
                />
              </div>
            )}
            <div>
              <label htmlFor="auth-email" style={label}>
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@restaurant.ro"
                required
                style={inp}
                onFocus={(e) => (e.target.style.borderColor = A.accent)}
                onBlur={(e) => (e.target.style.borderColor = A.border)}
              />
            </div>
            <div>
              <label htmlFor="auth-password" style={label}>
                Parolă
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 caractere"
                required
                minLength={8}
                style={inp}
                onFocus={(e) => (e.target.style.borderColor = A.accent)}
                onBlur={(e) => (e.target.style.borderColor = A.border)}
              />
            </div>

            {error && (
              <div
                style={{
                  background: A.errorBg,
                  border: `1px solid ${A.errorBorder}`,
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 13,
                  color: A.error,
                }}
              >
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{ ...primaryBtn(loading), marginTop: 4 }}>
              {loading ? 'Se procesează...' : mode === 'login' ? 'Intră în cont' : 'Creează cont'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 20, fontSize: '0.85rem', color: A.text3 }}>
            {mode === 'login' && (
              <button
                onClick={() => {
                  setShowReset(true)
                  setResetEmail(email)
                  setError(null)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: A.text3,
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                  fontFamily: 'DM Sans,sans-serif',
                  marginBottom: 8,
                  display: 'block',
                  width: '100%',
                }}
              >
                Ai uitat parola?
              </button>
            )}
            {mode === 'login' ? 'Nu ai cont?' : 'Ai deja cont?'}{' '}
            <button
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login')
                setError(null)
              }}
              style={{
                background: 'none',
                border: 'none',
                color: A.accent,
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
                fontFamily: 'DM Sans,sans-serif',
              }}
            >
              {mode === 'login' ? 'Creează unul' : 'Intră în cont'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

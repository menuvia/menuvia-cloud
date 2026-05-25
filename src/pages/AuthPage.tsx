import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'

// Prefetch: start loading DashboardPage in the background while the user
// types credentials. By the time login completes, the chunk is cached.
const _prefetch = import('../pages/DashboardPage').catch(() => {
  /* ignore */
})
void _prefetch // prevent unused-var lint

const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '12px 14px',
  fontSize: '0.95rem',
  color: D.t1,
  outline: 'none',
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}

export default function AuthPage({ onSuccess }: { onSuccess: () => void }) {
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
        setError(signUpErr.message)
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
      setError(signInErr.message)
      setLoading(false)
      return
    }
    onSuccess()
  }

  const handleReset = async () => {
    if (!resetEmail.trim()) return
    setLoading(true)
    setError(null)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: (import.meta.env.VITE_APP_URL || window.location.origin) + '/reset-password',
    })
    if (resetErr) {
      setError(resetErr.message)
      setLoading(false)
      return
    }
    setResetSent(true)
    setLoading(false)
  }

  if (showReset) {
    if (resetSent) {
      return (
        <div
          style={{
            minHeight: '100vh',
            background: D.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              background: D.s1,
              border: '1px solid ' + D.border,
              borderRadius: 18,
              padding: 36,
              width: '100%',
              maxWidth: 420,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>\u2709\ufe0f</div>
            <h2
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: '1.4rem',
                color: D.t1,
                marginBottom: 12,
              }}
            >
              Verific\u0103 emailul
            </h2>
            <p style={{ color: D.t2, marginBottom: 24, lineHeight: 1.6 }}>
              Am trimis un link de resetare la <strong style={{ color: D.t1 }}>{resetEmail}</strong>
              .
            </p>
            <button
              onClick={() => {
                setShowReset(false)
                setResetSent(false)
                setMode('login')
              }}
              style={{
                background: D.gold,
                color: '#000',
                border: 'none',
                borderRadius: 9,
                padding: '12px 24px',
                fontFamily: 'DM Sans,sans-serif',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              \xcenapoi la autentificare
            </button>
          </div>
        </div>
      )
    }
    return (
      <div
        style={{
          minHeight: '100vh',
          background: D.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        <div
          style={{
            background: D.s1,
            border: '1px solid ' + D.border,
            borderRadius: 18,
            padding: 36,
            width: '100%',
            maxWidth: 420,
          }}
        >
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.1rem',
              color: D.gold,
              marginBottom: 24,
            }}
          >
            Menuvia
          </div>
          <h1
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.5rem',
              color: D.t1,
              marginBottom: 6,
            }}
          >
            Reseteaz\u0103 parola
          </h1>
          <p style={{ color: D.t3, fontSize: '0.85rem', marginBottom: 28 }}>
            Introdu emailul \u0219i vei primi un link de resetare.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label
                style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}
              >
                Email
              </label>
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="email@restaurant.ro"
                style={inp}
              />
            </div>
            {error && (
              <div
                style={{
                  background: 'rgba(224,85,85,0.1)',
                  border: '1px solid rgba(224,85,85,0.3)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 13,
                  color: '#E05555',
                }}
              >
                {error}
              </div>
            )}
            <button
              onClick={() => {
                void handleReset()
              }}
              disabled={loading}
              style={{
                background: loading ? D.s3 : D.gold,
                color: loading ? D.t3 : '#000',
                border: 'none',
                borderRadius: 9,
                padding: '14px 0',
                fontFamily: 'DM Sans,sans-serif',
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Se proceseaz\u0103...' : 'Trimite link de resetare'}
            </button>
            <button
              onClick={() => {
                setShowReset(false)
                setError(null)
              }}
              style={{
                background: 'none',
                border: 'none',
                color: D.t3,
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontFamily: 'DM Sans,sans-serif',
                marginTop: 4,
              }}
            >
              \u2190 \xcenapoi la autentificare
            </button>
          </div>
        </div>
      </div>
    )
  }

  // FIX: show "check email" screen instead of proceeding with broken state
  if (confirmEmail) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: D.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        <div
          style={{
            background: D.s1,
            border: `1px solid ${D.border}`,
            borderRadius: 18,
            padding: 36,
            width: '100%',
            maxWidth: 420,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>📬</div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.4rem',
              color: D.t1,
              marginBottom: 12,
            }}
          >
            Verifică emailul
          </h2>
          <p style={{ color: D.t2, marginBottom: 24, lineHeight: 1.6 }}>
            Am trimis un link de confirmare la <strong style={{ color: D.t1 }}>{email}</strong>.
            <br />
            Confirmă contul, apoi revino să te autentifici.
          </p>
          <button
            onClick={() => {
              setConfirmEmail(false)
              setMode('login')
            }}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 9,
              padding: '12px 24px',
              fontFamily: 'DM Sans,sans-serif',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Înapoi la autentificare
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: D.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          background: D.s1,
          border: `1px solid ${D.border}`,
          borderRadius: 18,
          padding: 36,
          width: '100%',
          maxWidth: 420,
        }}
      >
        <div
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.1rem',
            color: D.gold,
            marginBottom: 24,
          }}
        >
          Menuvia
        </div>
        <h1
          style={{ fontFamily: 'Fraunces,serif', fontSize: '1.5rem', color: D.t1, marginBottom: 6 }}
        >
          {mode === 'login' ? 'Bun venit înapoi' : 'Creează cont gratuit'}
        </h1>
        <p style={{ color: D.t3, fontSize: '0.85rem', marginBottom: 28 }}>
          {mode === 'login'
            ? 'Autentifică-te în contul Menuvia'
            : 'Începe cu meniul digital în 30 de secunde'}
        </p>

        <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'signup' && (
            <div>
              <label
                style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}
              >
                Nume
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Numele tău"
                style={inp}
                onFocus={(e) => (e.target.style.borderColor = D.gold)}
                onBlur={(e) => (e.target.style.borderColor = D.border)}
              />
            </div>
          )}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@restaurant.ro"
              required
              style={inp}
              onFocus={(e) => (e.target.style.borderColor = D.gold)}
              onBlur={(e) => (e.target.style.borderColor = D.border)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
              Parolă
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 caractere"
              required
              minLength={8}
              style={inp}
              onFocus={(e) => (e.target.style.borderColor = D.gold)}
              onBlur={(e) => (e.target.style.borderColor = D.border)}
            />
          </div>

          {error && (
            <div
              style={{
                background: 'rgba(224,85,85,0.1)',
                border: `1px solid rgba(224,85,85,0.3)`,
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                color: '#E05555',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: loading ? D.s3 : D.gold,
              color: loading ? D.t3 : '#000',
              border: 'none',
              borderRadius: 9,
              padding: '14px 0',
              fontFamily: 'DM Sans,sans-serif',
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: 4,
            }}
          >
            {loading ? 'Se procesează...' : mode === 'login' ? 'Autentifică-te' : 'Creează cont'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: '0.85rem', color: D.t3 }}>
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
                color: D.t3,
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
              color: D.gold,
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            {mode === 'login' ? 'Înregistrează-te' : 'Autentifică-te'}
          </button>
        </div>
      </div>
    </div>
  )
}

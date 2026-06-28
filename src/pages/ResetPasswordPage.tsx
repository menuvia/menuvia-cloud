import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'

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

// Simple password strength: 0=weak, 1=ok, 2=strong
function passwordStrength(p: string): 0 | 1 | 2 {
  if (p.length < 8) return 0
  const hasNum = /\d/.test(p)
  const hasSym = /[^a-zA-Z0-9]/.test(p)
  const hasUpper = /[A-Z]/.test(p)
  const score = (hasNum ? 1 : 0) + (hasSym ? 1 : 0) + (hasUpper ? 1 : 0)
  // O parolă lungă dar dintr-o singură clasă (ex. doar litere mici) NU e "Acceptabilă":
  // cere cel puțin o clasă (cifră/simbol/majusculă) sau lungime ≥12 pentru nivelul 1.
  if (score >= 2) return 2
  if (score >= 1 || p.length >= 12) return 1
  return 0
}

const STRENGTH_META = {
  0: { label: 'Slabă', color: D.red, width: '25%' },
  1: { label: 'Acceptabilă', color: D.amber, width: '60%' },
  2: { label: 'Puternică', color: D.green, width: '100%' },
}

export default function ResetPasswordPage({ navigate }: { navigate: (p: string) => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // null = checking token, true = valid, false = invalid/expired
  const [tokenState, setTokenState] = useState<null | true | false>(null)

  useEffect(() => {
    // Dacă URL-ul nu conține DELOC un token de recovery, e clar invalid → marcăm imediat.
    // Dacă tokenul E prezent dar SDK-ul e lent (rețea proastă / cold start), NU marcăm
    // invalid prematur (audit P2: 4s era prea agresiv) — failsafe generos de 12s.
    const hash = typeof window !== 'undefined' ? window.location.hash || '' : ''
    const search = typeof window !== 'undefined' ? window.location.search || '' : ''
    const hasRecoveryToken =
      /access_token=|type=recovery|[?&]code=/.test(hash) || /[?&]code=|type=recovery/.test(search)

    if (!hasRecoveryToken) {
      setTokenState(false)
      return
    }

    // PASSWORD_RECOVERY fires when Supabase detects the recovery token in the URL hash.
    const timeout = setTimeout(() => {
      setTokenState((prev) => (prev === null ? false : prev))
    }, 12000)

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        clearTimeout(timeout)
        setTokenState(true)
      }
    })

    // NU validăm pe baza unei sesiuni existente (audit P2): pe un device partajat/deja
    // logat, orice sesiune ar fi fost tratată drept token de recovery valid → schimbare
    // parolă fără re-autentificare (account takeover). Validarea se bazează EXCLUSIV pe
    // evenimentul PASSWORD_RECOVERY (emis de Supabase la detectarea token-ului din URL);
    // dacă nu apare în 4s → link invalid/expirat.

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async () => {
    setError(null)
    if (password.length < 8) {
      setError('Parola trebuie să aibă cel puțin 8 caractere.')
      return
    }
    if (password !== confirm) {
      setError('Parolele nu coincid.')
      return
    }
    setLoading(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    if (updateErr) {
      setError(updateErr.message)
      setLoading(false)
      return
    }
    setDone(true)
    setLoading(false)
  }

  const strength = password.length > 0 ? passwordStrength(password) : null
  const strengthMeta = strength !== null ? STRENGTH_META[strength] : null

  // ─── Checking token ───────────────────────────────────────
  if (tokenState === null) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: D.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          fontFamily: 'DM Sans,sans-serif',
        }}
      >
        <div style={{ textAlign: 'center', color: D.t3 }}>
          <div style={{ fontSize: '1.5rem', marginBottom: 12, opacity: 0.5 }}>⏳</div>
          <div style={{ fontSize: '0.875rem' }}>Se verifică link-ul...</div>
        </div>
      </div>
    )
  }

  // ─── Token invalid / expired ──────────────────────────────
  if (tokenState === false) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: D.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          fontFamily: 'DM Sans,sans-serif',
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
          <div style={{ fontSize: '2rem', marginBottom: 16 }}>⚠️</div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.3rem',
              color: D.t1,
              marginBottom: 10,
            }}
          >
            Link invalid sau expirat
          </h2>
          <p style={{ color: D.t2, fontSize: '0.875rem', lineHeight: 1.6, marginBottom: 24 }}>
            Link-urile de resetare sunt valabile 1 oră și pot fi folosite o singură dată. Solicită
            un link nou dacă ai nevoie.
          </p>
          <button
            onClick={() => navigate('/auth')}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 9,
              padding: '12px 24px',
              fontFamily: 'DM Sans,sans-serif',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Solicită link nou
          </button>
        </div>
      </div>
    )
  }

  // ─── Done ─────────────────────────────────────────────────
  if (done) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: D.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          fontFamily: 'DM Sans,sans-serif',
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
          <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>✅</div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.3rem',
              color: D.green,
              marginBottom: 10,
            }}
          >
            Parolă schimbată
          </h2>
          <p style={{ color: D.t2, fontSize: '0.875rem', marginBottom: 24 }}>
            Noua parolă a fost salvată. Poți intra în dashboard.
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 9,
              padding: '12px 24px',
              fontFamily: 'DM Sans,sans-serif',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Intră în dashboard →
          </button>
        </div>
      </div>
    )
  }

  // ─── Form ─────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: '100vh',
        background: D.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        fontFamily: 'DM Sans,sans-serif',
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
            fontSize: '1rem',
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
            letterSpacing: '-0.02em',
          }}
        >
          Parolă nouă
        </h1>
        <p style={{ color: D.t3, fontSize: '0.85rem', marginBottom: 28, lineHeight: 1.6 }}>
          Alege o parolă sigură pentru contul tău.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Password field */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
              Parolă nouă
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 caractere"
              autoFocus
              style={inp}
              onFocus={(e) => (e.target.style.borderColor = D.gold)}
              onBlur={(e) => (e.target.style.borderColor = D.border)}
            />
            {/* Strength meter */}
            {password.length > 0 && strengthMeta && (
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    height: 3,
                    background: D.s3,
                    borderRadius: 2,
                    overflow: 'hidden',
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      borderRadius: 2,
                      background: strengthMeta.color,
                      width: strengthMeta.width,
                      transition: 'width .3s, background .3s',
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.7rem', color: strengthMeta.color, fontWeight: 500 }}>
                  {strengthMeta.label}
                </div>
              </div>
            )}
          </div>

          {/* Confirm field */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
              Confirmă parola
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repetă parola"
              style={{
                ...inp,
                borderColor:
                  confirm.length > 0 ? (confirm === password ? D.green : D.red) : D.border,
              }}
              onFocus={(e) => (e.target.style.borderColor = confirm === password ? D.green : D.red)}
              onBlur={(e) =>
                (e.target.style.borderColor =
                  confirm.length > 0 ? (confirm === password ? D.green : D.red) : D.border)
              }
            />
            {confirm.length > 0 && confirm !== password && (
              <div style={{ fontSize: '0.72rem', color: D.red, marginTop: 4 }}>
                Parolele nu coincid
              </div>
            )}
            {confirm.length > 0 && confirm === password && (
              <div style={{ fontSize: '0.72rem', color: D.green, marginTop: 4 }}>
                ✓ Parolele coincid
              </div>
            )}
          </div>

          {error && (
            <div
              style={{
                background: D.redA,
                border: `1px solid rgba(224,85,85,.3)`,
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: '0.82rem',
                color: D.red,
              }}
            >
              {error}
            </div>
          )}

          <button
            onClick={() => {
              void handleSubmit()
            }}
            disabled={loading || password.length < 8 || password !== confirm}
            style={{
              background: loading || password.length < 8 || password !== confirm ? D.s3 : D.gold,
              color: loading || password.length < 8 || password !== confirm ? D.t3 : '#000',
              border: 'none',
              borderRadius: 9,
              padding: '14px 0',
              fontFamily: 'DM Sans,sans-serif',
              fontSize: '0.95rem',
              fontWeight: 700,
              cursor:
                loading || password.length < 8 || password !== confirm ? 'not-allowed' : 'pointer',
              marginTop: 4,
              transition: 'background .2s',
            }}
          >
            {loading ? 'Se salvează...' : 'Salvează parola'}
          </button>

          <button
            onClick={() => navigate('/auth')}
            style={{
              background: 'none',
              border: 'none',
              color: D.t3,
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontFamily: 'DM Sans,sans-serif',
              marginTop: -4,
            }}
          >
            ← Înapoi la autentificare
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import type { MemberRole } from '../lib/constants'

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  waiter: 'Ospătar',
  kitchen: 'Bucătărie',
}

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

interface InviteData {
  email: string
  role: MemberRole
  restaurant_name: string
  expires_at: string
}

type Step = 'loading' | 'invalid' | 'error' | 'expired' | 'form' | 'confirm-email' | 'done'

export default function InviteAcceptPage({
  token,
  navigate,
}: {
  token: string
  navigate: (p: string) => void
}) {
  const [invite, setInvite] = useState<InviteData | null>(null)
  const [step, setStep] = useState<Step>('loading')
  const [isNew, setIsNew] = useState(true)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  // Sesiunea existentă (dacă e): userul deja logat cu emailul invitat acceptă
  // dintr-un click, fără să-și rebage parola; alt email → avertisment clar
  // (accept_invite ar respinge oricum cu email_mismatch, dar abia DUPĂ formular).
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setStep('invalid')
      return
    }
    let cancelled = false
    async function loadInvite() {
      try {
        // preview_invite RPC: returns only what the UI needs.
        // Does NOT expose internal IDs, invited_by, or raw token.
        const { data, error } = await supabase.rpc('preview_invite', { p_token: token })
        if (cancelled) return
        if (error) {
          // Eroare de infra (rețea/RLS) — NU „link invalid" (supabase-js nu aruncă).
          // Blipul nu trebuie să pară token stricat: oferim „Reîncearcă".
          setStep('error')
          return
        }
        if (!data) {
          setStep('invalid')
          return
        }
        const d = data as {
          status: string
          email?: string
          role?: string
          restaurant_name?: string
          expires_at?: string
        }
        if (d.status === 'expired' || d.status === 'used') {
          setStep('expired')
          return
        }
        if (d.status !== 'valid' || !d.email) {
          setStep('invalid')
          return
        }
        setInvite({
          email: d.email,
          role: d.role as MemberRole,
          restaurant_name: d.restaurant_name ?? '',
          expires_at: d.expires_at ?? '',
        })
        setStep('form')
      } catch (err) {
        console.error('[InviteAcceptPage] load invite error:', err)
        if (!cancelled) setStep('error')
      }
    }
    loadInvite()
    // Best-effort, în paralel cu preview-ul: o eroare aici lasă doar fluxul
    // clasic cu parolă (nu blochează nimic).
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) setSessionEmail(data.session?.user?.email ?? null)
      })
      .catch(() => {
        /* fluxul cu parolă rămâne disponibil */
      })
    return () => {
      cancelled = true
    }
  }, [token, reloadTick])

  // Acceptarea propriu-zisă (RPC accept_invite + maparea motivelor de refuz) —
  // comună fluxului cu parolă și celui cu sesiune existentă.
  const acceptInvite = async (): Promise<void> => {
    const { data: result, error: rpcError } = await supabase.rpc('accept_invite', {
      p_token: token,
    })
    if (rpcError) throw rpcError

    const r = result as { ok?: boolean; reason?: string } | null
    if (!r?.ok) {
      switch (r?.reason) {
        case 'already_accepted':
          setFormError('Această invitație a fost deja folosită.')
          break
        case 'expired':
          setStep('expired')
          break
        case 'email_mismatch':
          setFormError(
            'Emailul contului tău nu corespunde cu emailul pentru care a fost trimisă invitația.',
          )
          break
        case 'invalid':
          setStep('invalid')
          break
        default:
          setFormError('Nu am putut accepta invitația. Încearcă din nou.')
      }
      setSubmitting(false)
      return
    }
    setStep('done')
  }

  // Userul e deja logat cu emailul invitat → un click, fără parolă.
  const handleDirectAccept = async () => {
    setSubmitting(true)
    setFormError(null)
    try {
      await acceptInvite()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Eroare. Încearcă din nou.')
      setSubmitting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setFormError('Parola trebuie să aibă cel puțin 8 caractere.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      if (isNew) {
        const { data, error } = await supabase.auth.signUp({
          email: invite!.email,
          password,
          options: { data: { full_name: name } },
        })
        if (error) throw error

        // signUp may not return a session if email confirmation is required
        if (!data.session || !data.user) {
          setStep('confirm-email')
          setSubmitting(false)
          return
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: invite!.email, password })
        if (error) throw error
      }

      // Server-side RPC: validates token, email match, inserts membership
      // with role from DB (not client-supplied), marks token as accepted.
      // SECURITY DEFINER — bypasses RLS, runs atomically. Maparea motivelor
      // de refuz (mig 096A) e în acceptInvite, comună cu fluxul fără parolă.
      await acceptInvite()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Eroare. Încearcă din nou.'
      setFormError(msg)
      setSubmitting(false)
    }
  }

  const card: React.CSSProperties = {
    background: D.s1,
    border: `1px solid ${D.border}`,
    borderRadius: 18,
    padding: 36,
    width: '100%',
    maxWidth: 420,
  }
  const wrap: React.CSSProperties = {
    minHeight: '100vh',
    background: D.bg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  }

  if (step === 'loading')
    return (
      <div style={wrap}>
        <div style={{ color: D.t2 }}>Se verifică invitația...</div>
      </div>
    )
  if (step === 'invalid')
    return (
      <div style={wrap}>
        <div style={card}>
          <div
            style={{ fontFamily: 'Fraunces,serif', fontSize: 22, color: D.t1, marginBottom: 12 }}
          >
            Link invalid
          </div>
          <p style={{ color: D.t2, marginBottom: 24 }}>
            Acest link nu există sau a fost deja folosit.
          </p>
          <button
            onClick={() => navigate('/')}
            style={{
              background: D.s3,
              color: D.t2,
              border: `1px solid ${D.border}`,
              borderRadius: 9,
              padding: '10px 20px',
              cursor: 'pointer',
            }}
          >
            Acasă
          </button>
        </div>
      </div>
    )
  if (step === 'error')
    return (
      <div style={wrap}>
        <div style={card}>
          <div
            style={{ fontFamily: 'Fraunces,serif', fontSize: 22, color: D.t1, marginBottom: 12 }}
          >
            Nu am putut verifica invitația
          </div>
          <p style={{ color: D.t2, marginBottom: 24 }}>
            Pare o problemă de conexiune, nu un link greșit. Reîncearcă.
          </p>
          <button
            onClick={() => {
              setStep('loading')
              setReloadTick((t) => t + 1)
            }}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 9,
              padding: '10px 20px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reîncearcă
          </button>
        </div>
      </div>
    )
  if (step === 'expired')
    return (
      <div style={wrap}>
        <div style={card}>
          <div
            style={{ fontFamily: 'Fraunces,serif', fontSize: 22, color: D.t1, marginBottom: 12 }}
          >
            Invitație expirată
          </div>
          <p style={{ color: D.t2, marginBottom: 24 }}>
            Cere un nou link de invitație de la managerul restaurantului.
          </p>
          <button
            onClick={() => navigate('/')}
            style={{
              background: D.s3,
              color: D.t2,
              border: `1px solid ${D.border}`,
              borderRadius: 9,
              padding: '10px 20px',
              cursor: 'pointer',
            }}
          >
            Acasă
          </button>
        </div>
      </div>
    )
  if (step === 'confirm-email')
    return (
      <div style={wrap}>
        <div style={card}>
          <div
            style={{ fontFamily: 'Fraunces,serif', fontSize: 22, color: D.t1, marginBottom: 12 }}
          >
            Verifică emailul
          </div>
          <p style={{ color: D.t2, marginBottom: 24 }}>
            Ți-am trimis un link de confirmare la{' '}
            <strong style={{ color: D.t1 }}>{invite?.email}</strong>. Confirmă contul, apoi revino
            la acest link pentru a-ți accepta invitația.
          </p>
        </div>
      </div>
    )
  if (step === 'done')
    return (
      <div style={wrap}>
        <div style={card}>
          <div
            style={{ fontFamily: 'Fraunces,serif', fontSize: 22, color: D.green, marginBottom: 12 }}
          >
            ✓ Invitație acceptată
          </div>
          <p style={{ color: D.t2, marginBottom: 24 }}>
            Acum faci parte din echipa{' '}
            <strong style={{ color: D.t1 }}>{invite?.restaurant_name}</strong>.
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 9,
              padding: '12px 24px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            Intră în dashboard
          </button>
        </div>
      </div>
    )

  return (
    <div style={wrap}>
      <div style={card}>
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
          style={{ fontFamily: 'Fraunces,serif', fontSize: '1.4rem', color: D.t1, marginBottom: 6 }}
        >
          Invitație la {invite?.restaurant_name}
        </h1>
        <p style={{ color: D.t3, fontSize: '0.85rem', marginBottom: 20 }}>
          Ai fost invitat ca{' '}
          <strong style={{ color: D.gold }}>{invite ? ROLE_LABELS[invite.role] : ''}</strong> la{' '}
          <strong style={{ color: D.t1 }}>{invite?.restaurant_name}</strong>.
        </p>

        {/* Deja logat cu emailul invitat → accept dintr-un click, fără parolă. */}
        {sessionEmail != null &&
        invite != null &&
        sessionEmail.toLowerCase() === invite.email.toLowerCase() ? (
          <div>
            <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 16, lineHeight: 1.5 }}>
              Ești conectat ca <strong style={{ color: D.t1 }}>{sessionEmail}</strong> — exact
              contul invitat. Nu mai e nevoie de parolă.
            </p>
            {formError && (
              <div
                style={{
                  background: D.redA,
                  color: D.red,
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: '0.82rem',
                  marginBottom: 12,
                }}
              >
                {formError}
              </div>
            )}
            <button
              onClick={() => void handleDirectAccept()}
              disabled={submitting}
              style={{
                width: '100%',
                background: D.gold,
                color: '#000',
                border: 'none',
                borderRadius: 9,
                padding: '13px 0',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? 'Se acceptă…' : 'Acceptă invitația →'}
            </button>
          </div>
        ) : sessionEmail != null && invite != null ? (
          /* Logat cu ALT cont: accept_invite ar respinge cu email_mismatch —
             îi spunem înainte, cu deconectare la un click. */
          <div>
            <div
              style={{
                background: D.s3,
                borderRadius: 10,
                padding: '12px 14px',
                fontSize: '0.82rem',
                color: D.t2,
                lineHeight: 1.55,
                marginBottom: 14,
              }}
            >
              Ești conectat ca <strong style={{ color: D.t1 }}>{sessionEmail}</strong>, dar
              invitația e pentru <strong style={{ color: D.t1 }}>{invite.email}</strong>.
              Deconectează-te și acceptă invitația cu contul potrivit.
            </div>
            <button
              onClick={() => {
                void supabase.auth.signOut().then(() => setSessionEmail(null))
              }}
              style={{
                width: '100%',
                background: D.s3,
                color: D.t1,
                border: `1px solid ${D.border}`,
                borderRadius: 9,
                padding: '12px 0',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
              }}
            >
              Deconectează-mă
            </button>
          </div>
        ) : (
          <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {['Cont nou', 'Am deja cont'].map((label, i) => (
            <button
              key={label}
              onClick={() => setIsNew(i === 0)}
              style={{
                flex: 1,
                padding: '10px 0',
                background: isNew === (i === 0) ? D.goldA : D.s3,
                border: `1px solid ${isNew === (i === 0) ? D.gold : D.border}`,
                borderRadius: 8,
                color: isNew === (i === 0) ? D.gold : D.t2,
                fontFamily: 'DM Sans,sans-serif',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
              Email
            </label>
            <input
              value={invite?.email ?? ''}
              disabled
              style={{ ...inp, opacity: 0.6, cursor: 'not-allowed' }}
            />
          </div>

          {isNew && (
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
              />
            </div>
          )}

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
            />
          </div>

          {formError && (
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
              {formError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              background: submitting ? D.s3 : D.gold,
              color: submitting ? D.t3 : '#000',
              border: 'none',
              borderRadius: 9,
              padding: '14px 0',
              fontFamily: 'DM Sans,sans-serif',
              fontSize: 15,
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              marginTop: 4,
            }}
          >
            {submitting
              ? 'Se procesează...'
              : isNew
                ? 'Creează cont și acceptă'
                : 'Autentifică-te și acceptă'}
          </button>
        </form>
          </>
        )}
      </div>
    </div>
  )
}

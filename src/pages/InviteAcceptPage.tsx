import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import type { MemberRole } from '../lib/constants'
import { Icon } from '../components/ui/Icon'
import { FunnelLangProvider } from '../i18n/UiLangContext'
import { useT } from '../i18n/useT'
import { fillNodes } from '../i18n/fillNodes'
import { staffLocale } from '../i18n/format'
import { inviteNs } from '../i18n/ns/invite'

const ROLE_KEYS = {
  owner: 'roleOwner',
  manager: 'roleManager',
  waiter: 'roleWaiter',
  kitchen: 'roleKitchen',
} as const satisfies Record<MemberRole, string>

type InviteErrorKey =
  | 'errInvalidCredentials'
  | 'errAlreadyRegistered'
  | 'errPasswordShort'
  | 'errEmailNotConfirmed'
  | 'errRateLimit'
  | 'errGeneric'

// Mesajele AuthError de la supabase-js vin în engleză („Invalid login
// credentials", „User already registered"…) — le mapăm pe clase, cu textul
// lor în limba omului (dicționarul `invite`); fallback generic pentru orice
// altceva (eroarea brută rămâne în console pentru diagnoză).
function authErrorKey(err: unknown): InviteErrorKey {
  const msg = err instanceof Error ? err.message : ''
  if (/invalid login credentials/i.test(msg)) return 'errInvalidCredentials'
  if (/already (registered|exists)/i.test(msg)) return 'errAlreadyRegistered'
  if (/password should be at least/i.test(msg)) return 'errPasswordShort'
  if (/email not confirmed/i.test(msg)) return 'errEmailNotConfirmed'
  if (/rate limit|too many requests/i.test(msg)) return 'errRateLimit'
  return 'errGeneric'
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

type InviteAcceptProps = { token: string; navigate: (p: string) => void }

// Limba: `FunnelLangProvider` (lotul L2b), ca pe /auth — omul invitat e adesea
// personal (ospătar, bucătar) și poate fi străin.
export default function InviteAcceptPage(props: InviteAcceptProps) {
  return (
    <FunnelLangProvider>
      <InviteAcceptScreen {...props} />
    </FunnelLangProvider>
  )
}

function InviteAcceptScreen({ token, navigate }: InviteAcceptProps) {
  const { t, lang } = useT(inviteNs)
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
          setFormError(t('alreadyUsed'))
          break
        case 'expired':
          setStep('expired')
          break
        case 'email_mismatch':
          setFormError(t('emailMismatch'))
          break
        case 'invalid':
          setStep('invalid')
          break
        default:
          setFormError(t('acceptFailed'))
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
      console.error('[InviteAcceptPage] direct accept error:', err)
      setFormError(t(authErrorKey(err)))
      setSubmitting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setFormError(t('errPasswordShort'))
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
      console.error('[InviteAcceptPage] submit error:', err)
      setFormError(t(authErrorKey(err)))
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
  // Termenul invitației (aceleași date le afișează și TeamManager la „expiră …");
  // string gol / dată invalidă → nu afișăm rândul deloc.
  const expiresDate = invite?.expires_at ? new Date(invite.expires_at) : null
  const expiresLabel =
    expiresDate && !Number.isNaN(expiresDate.getTime())
      ? expiresDate.toLocaleDateString(staffLocale(lang), { day: 'numeric', month: 'long', year: 'numeric' })
      : null

  if (step === 'loading')
    return (
      <div style={wrap}>
        <div style={{ color: D.t2 }}>{t('checking')}</div>
      </div>
    )
  if (step === 'invalid')
    return (
      <div style={wrap}>
        <div style={card}>
          <div
            style={{ fontFamily: 'Fraunces,serif', fontSize: 22, color: D.t1, marginBottom: 12 }}
          >
            {t('invalidTitle')}
          </div>
          <p style={{ color: D.t2, marginBottom: 24 }}>
            {t('invalidBody')}
          </p>
          <button
            onClick={() => navigate('/')}
            style={{
              background: D.s3,
              color: D.t2,
              border: `1px solid ${D.border}`,
              borderRadius: 9,
              padding: '10px 20px',
              minHeight: 44,
              cursor: 'pointer',
            }}
          >
            {t('home')}
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
            {t('errorTitle')}
          </div>
          <p style={{ color: D.t2, marginBottom: 24 }}>
            {t('errorBody')}
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
              minHeight: 44,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {t('retry')}
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
            {t('expiredTitle')}
          </div>
          <p style={{ color: D.t2, marginBottom: 24 }}>
            {t('expiredBody')}
          </p>
          <button
            onClick={() => navigate('/')}
            style={{
              background: D.s3,
              color: D.t2,
              border: `1px solid ${D.border}`,
              borderRadius: 9,
              padding: '10px 20px',
              minHeight: 44,
              cursor: 'pointer',
            }}
          >
            {t('home')}
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
            {t('confirmTitle')}
          </div>
          <p style={{ color: D.t2, marginBottom: 24 }}>
            {fillNodes(t('confirmBody'), {
              email: <strong style={{ color: D.t1 }}>{invite?.email}</strong>,
            })}
          </p>
          <button
            onClick={() => {
              // După confirmare, contul EXISTĂ deja → revenim pe formular
              // preselectat pe „Am deja cont" (sau direct pe accept dintr-un
              // click, dacă sesiunea a apărut între timp în același browser).
              setIsNew(false)
              setFormError(null)
              setStep('loading')
              setReloadTick((t) => t + 1)
            }}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 9,
              padding: '10px 20px',
              minHeight: 44,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            {t('confirmContinue')}
          </button>
        </div>
      </div>
    )
  if (step === 'done')
    return (
      <div style={wrap}>
        <div style={card}>
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: 22,
              color: D.green,
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Icon name="check" size={22} color={D.green} />
            {t('doneTitle')}
          </div>
          <p style={{ color: D.t2, marginBottom: 24 }}>
            {fillNodes(t('doneBody'), {
              restaurant: <strong style={{ color: D.t1 }}>{invite?.restaurant_name}</strong>,
            })}
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 9,
              padding: '12px 24px',
              minHeight: 44,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            {t('goToPanel')}
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
          {t('brand')}
        </div>
        <h1
          style={{ fontFamily: 'Fraunces,serif', fontSize: '1.4rem', color: D.t1, marginBottom: 6 }}
        >
          {t('title', { restaurant: invite?.restaurant_name ?? '' })}
        </h1>
        <p style={{ color: D.t3, fontSize: '0.85rem', marginBottom: expiresLabel ? 6 : 20 }}>
          {fillNodes(t('invitedAs'), {
            role: (
              <strong style={{ color: D.gold }}>
                {/* Rol neprevăzut din RPC → afișăm valoarea brută, nu string gol
                    (același fallback ca WaiterAssignments). */}
                {invite ? (invite.role in ROLE_KEYS ? t(ROLE_KEYS[invite.role]) : invite.role) : ''}
              </strong>
            ),
            restaurant: <strong style={{ color: D.t1 }}>{invite?.restaurant_name}</strong>,
          })}
        </p>
        {expiresLabel && (
          <p style={{ color: D.t3, fontSize: '0.78rem', marginBottom: 20 }}>
            {t('expiresOn', { date: expiresLabel })}
          </p>
        )}

        {/* Deja logat cu emailul invitat → accept dintr-un click, fără parolă. */}
        {sessionEmail != null &&
        invite != null &&
        sessionEmail.toLowerCase() === invite.email.toLowerCase() ? (
          <div>
            <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: 16, lineHeight: 1.5 }}>
              {fillNodes(t('signedInAsInvited'), {
                email: <strong style={{ color: D.t1 }}>{sessionEmail}</strong>,
              })}
            </p>
            {formError && (
              <div
                style={{
                  background: D.redA,
                  color: D.redText,
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
                minHeight: 44,
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? t('accepting') : t('acceptBtn')}
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
              {fillNodes(t('signedInAsOther'), {
                email: <strong style={{ color: D.t1 }}>{sessionEmail}</strong>,
                invited: <strong style={{ color: D.t1 }}>{invite.email}</strong>,
              })}
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
                minHeight: 44,
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                fontFamily: 'DM Sans,sans-serif',
              }}
            >
              {t('signOutBtn')}
            </button>
          </div>
        ) : (
          <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {[t('tabNew'), t('tabExisting')].map((label, i) => (
            <button
              key={label}
              type="button"
              aria-pressed={isNew === (i === 0)}
              onClick={() => {
                setIsNew(i === 0)
                // Eroarea de la modul precedent nu are sens sub celălalt formular.
                setFormError(null)
              }}
              style={{
                flex: 1,
                padding: '10px 0',
                minHeight: 44,
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
            <label
              htmlFor="invite-email"
              style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}
            >
              {t('emailLabel')}
            </label>
            <input
              id="invite-email"
              value={invite?.email ?? ''}
              disabled
              style={{ ...inp, opacity: 0.6, cursor: 'not-allowed' }}
            />
          </div>

          {isNew && (
            <div>
              <label
                htmlFor="invite-name"
                style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}
              >
                {t('nameLabel')}
              </label>
              <input
                id="invite-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                autoComplete="name"
                style={inp}
              />
            </div>
          )}

          <div>
            <label
              htmlFor="invite-password"
              style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}
            >
              {t('passwordLabel')}
            </label>
            <input
              id="invite-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('passwordPlaceholder')}
              autoComplete={isNew ? 'new-password' : 'current-password'}
              required
              minLength={8}
              style={inp}
            />
          </div>

          {formError && (
            <div
              style={{
                background: D.redA,
                border: `1px solid ${D.red}`,
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                color: D.redText,
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
            {submitting ? t('processing') : isNew ? t('submitNew') : t('submitExisting')}
          </button>
        </form>
          </>
        )}
      </div>
    </div>
  )
}

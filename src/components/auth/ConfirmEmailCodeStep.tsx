// src/components/auth/ConfirmEmailCodeStep.tsx
// Ecranul „Verifică emailul" după înscriere (S1): codul de 6 cifre se scrie în
// ACELAȘI tab (`verifyOtp`), cu „Retrimite" (`resend`) și cooldown vizibil de 60 s.
// Linkul din email rămâne ca rezervă — codul funcționează doar după ce șablonul
// „Confirm signup" din Supabase conține `{{ .Token }}`; până atunci omul apasă
// linkul, iar textul de mai jos îl lasă să aleagă.
//
// Consimțământul la Termeni NU se atinge aici: intenția legată de email e deja
// păstrată de AuthPage la signup, iar `TermsAcceptanceGate` o consemnează la
// prima sesiune — inclusiv cea creată de `verifyOtp`.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Icon } from '../ui/Icon'
import { MKT } from '../../lib/marketing'
import { D } from '../../lib/constants'
import {
  OTP_LENGTH,
  RESEND_COOLDOWN_S,
  classifyAuthError,
  isOtpComplete,
  resendCooldownLeft,
  sanitizeOtpInput,
} from '../../lib/otp'
import { useT } from '../../i18n/useT'
import { authNs } from '../../i18n/ns/auth'

const ERROR = '#B3403F'
const ERROR_BG = 'rgba(179,64,63,0.08)'
const ERROR_BORDER = 'rgba(179,64,63,0.3)'

export default function ConfirmEmailCodeStep({
  email,
  redirectTo,
  onVerified,
  onBack,
}: {
  email: string
  /** Aceeași destinație ca linkul de la signup (cu `?plan=` când există). */
  redirectTo: string
  /** Sesiunea a apărut (codul a fost bun): AuthPage continuă ca după un login. */
  onVerified: (email: string) => void
  onBack: () => void
}) {
  // Limba vine din `FunnelLangProvider`-ul paginii (AuthPage).
  const { t } = useT(authNs)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Emailul inițial tocmai a plecat (signUp) → cooldown-ul pornește la montare.
  const [sentAt, setSentAt] = useState<number>(() => Date.now())
  const [now, setNow] = useState<number>(() => Date.now())

  const left = resendCooldownLeft(sentAt, now, RESEND_COOLDOWN_S)

  // Bate ceasul doar cât cooldown-ul e activ (fără interval degeaba după aceea).
  const ticking = left > 0
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])

  const handleVerify = async (evt: React.FormEvent) => {
    evt.preventDefault()
    if (busy) return
    setNotice(null)
    if (!isOtpComplete(code)) {
      setError(t('confirmIncomplete'))
      return
    }
    setBusy(true)
    setError(null)
    const { data, error: verifyErr } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'signup',
    })
    if (verifyErr || !data.session) {
      setError(t(`otpVerify_${classifyAuthError(verifyErr)}`))
      setBusy(false)
      return
    }
    setBusy(false)
    onVerified(email)
  }

  const handleResend = async () => {
    if (resending || resendCooldownLeft(sentAt, Date.now()) > 0) return
    setResending(true)
    setError(null)
    setNotice(null)
    const { error: resendErr } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: redirectTo },
    })
    setResending(false)
    const stamp = Date.now()
    if (resendErr) {
      const kind = classifyAuthError(resendErr)
      setError(t(`otpResend_${kind}`))
      // Rate-limit-ul serverului: nu lăsăm butonul să lovească din nou imediat.
      if (kind === 'rate_limit') {
        setSentAt(stamp)
        setNow(stamp)
      }
      return
    }
    setSentAt(stamp)
    setNow(stamp)
    setCode('')
    setNotice(t('confirmResent'))
  }

  const resendDisabled = resending || left > 0

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ marginBottom: 16 }}>
        <Icon name="mail" size={40} color={MKT.accent} />
      </div>
      <h2
        style={{
          fontFamily: D.fontDisplay,
          fontSize: '1.4rem',
          color: MKT.text,
          marginBottom: 12,
        }}
      >
        {t('confirmTitle')}
      </h2>
      <p style={{ color: MKT.text2, marginBottom: 20, lineHeight: 1.6 }}>
        {t('confirmSentPrefix')} <strong style={{ color: MKT.text }}>{email}</strong>.
        <br />
        {t('confirmInstructions')}
      </p>

      <form
        onSubmit={(e) => {
          void handleVerify(e)
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}
      >
        <div>
          <label
            htmlFor="auth-otp"
            style={{
              display: 'block',
              fontSize: '0.78rem',
              color: MKT.text2,
              marginBottom: 6,
              fontWeight: 500,
            }}
          >
            {t('confirmCodeLabel')}
          </label>
          <input
            id="auth-otp"
            value={code}
            onChange={(e) => {
              setCode(sanitizeOtpInput(e.target.value))
              setError(null)
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={OTP_LENGTH + 4}
            placeholder="123456"
            autoFocus
            style={{
              width: '100%',
              background: MKT.surface,
              border: `1px solid ${error ? ERROR : MKT.border}`,
              borderRadius: 10,
              padding: '14px',
              fontSize: '1.4rem',
              letterSpacing: '0.35em',
              textAlign: 'center',
              color: MKT.text,
              outline: 'none',
              fontFamily: D.fontBody,
              boxSizing: 'border-box',
            }}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              background: ERROR_BG,
              border: `1px solid ${ERROR_BORDER}`,
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              color: ERROR,
            }}
          >
            {error}
          </div>
        )}
        {notice && (
          <div role="status" style={{ fontSize: 13, color: MKT.success, textAlign: 'center' }}>
            {notice}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            background: busy ? MKT.border : MKT.accent,
            color: busy ? MKT.text3 : MKT.onAccent,
            border: 'none',
            borderRadius: 10,
            padding: '14px 0',
            fontFamily: D.fontBody,
            fontSize: 15,
            fontWeight: 700,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? t('confirmVerifying') : t('confirmVerifyBtn')}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          void handleResend()
        }}
        disabled={resendDisabled}
        aria-live="polite"
        style={{
          background: 'none',
          border: 'none',
          // text2 (#5C4A2A) = 8,5:1 pe alb; aurul-cerneală (#A57A28) are doar 3,9:1.
          color: resendDisabled ? MKT.text3 : MKT.text2,
          textDecoration: resendDisabled ? 'none' : 'underline',
          cursor: resendDisabled ? 'not-allowed' : 'pointer',
          fontSize: '0.88rem',
          fontWeight: 600,
          fontFamily: D.fontBody,
          marginTop: 12,
          padding: '12px 8px',
          minHeight: 44,
        }}
      >
        {resending ? t('confirmResending') : left > 0 ? t('confirmResendIn', { s: left }) : t('confirmResend')}
      </button>
      <div>
        <button
          type="button"
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: MKT.text3,
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontFamily: D.fontBody,
            padding: '12px 8px',
            minHeight: 44,
          }}
        >
          {t('confirmBack')}
        </button>
      </div>
    </div>
  )
}

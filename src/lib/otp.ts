// src/lib/otp.ts
// Codul de 6 cifre din emailul de confirmare (S1): omul îl scrie în ACELAȘI tab,
// fără să mai deschidă linkul în alt tab/dispozitiv. Logica pură de aici
// (sanitizare, clasificarea erorilor GoTrue, mesaje RO/EN, cooldown) e testată
// fără rețea; apelurile `verifyOtp` / `resend` stau în componentă.
//
// Codul funcționează doar după ce șablonul „Confirm signup" din Supabase conține
// `{{ .Token }}` (vezi raportul pachetului 7); până atunci omul folosește linkul,
// care rămâne rezerva.

export const OTP_LENGTH = 6
/** Cât trebuie să aștepte omul între două retrimiteri (Supabase impune ~60 s oricum). */
export const RESEND_COOLDOWN_S = 60

export type OtpLang = 'ro' | 'en'
export type OtpErrorKind = 'invalid' | 'rate_limit' | 'network' | 'other'

/** Doar cifre, maximum OTP_LENGTH (lipirea „123 456" sau „123-456" devine 123456). */
export function sanitizeOtpInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, OTP_LENGTH)
}

export function isOtpComplete(value: string): boolean {
  return new RegExp('^\\d{' + OTP_LENGTH + '}$').test(value)
}

export interface AuthErrorLike {
  message?: string
  code?: string
  status?: number
}

/**
 * Clasifică o eroare GoTrue după COD (stabil) și, în lipsă, după mesaj.
 *   invalid    — cod greșit / expirat / deja folosit (`otp_expired`, „Token has
 *                expired or is invalid")
 *   rate_limit — prea multe încercări sau retrimiteri (`over_request_rate_limit`,
 *                `over_email_send_rate_limit`, HTTP 429)
 *   network    — nu am ajuns la server
 *   other      — orice altceva (nu afișăm textul englezesc brut)
 */
export function classifyAuthError(err: AuthErrorLike | null | undefined): OtpErrorKind {
  if (!err) return 'other'
  const code = (err.code ?? '').toLowerCase()
  const msg = (err.message ?? '').toLowerCase()
  if (code.includes('rate_limit') || err.status === 429) return 'rate_limit'
  if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('security purposes')) {
    return 'rate_limit'
  }
  if (code === 'otp_expired' || code === 'otp_disabled' || code === 'validation_failed') return 'invalid'
  if (msg.includes('expired') || msg.includes('invalid') || msg.includes('token')) return 'invalid'
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to')) return 'network'
  return 'other'
}

const VERIFY_MESSAGES: Record<OtpLang, Record<OtpErrorKind, string>> = {
  ro: {
    invalid:
      'Codul e greșit sau a expirat. Verifică ultimul email primit sau cere unul nou cu „Retrimite”.',
    rate_limit: 'Prea multe încercări. Așteaptă puțin și încearcă din nou.',
    network: 'Problemă de conexiune. Verifică internetul și reîncearcă.',
    other: 'Nu am putut verifica codul. Reîncearcă sau folosește linkul din email.',
  },
  en: {
    invalid: 'The code is wrong or has expired. Check the latest email or request a new one with “Resend”.',
    rate_limit: 'Too many attempts. Wait a little and try again.',
    network: 'Connection problem. Check your internet and try again.',
    other: 'We couldn’t verify the code. Try again or use the link in the email.',
  },
}

const RESEND_MESSAGES: Record<OtpLang, Record<OtpErrorKind, string>> = {
  ro: {
    invalid: 'Nu am putut retrimite emailul. Reîncearcă peste un minut.',
    rate_limit: 'Ai cerut prea multe coduri. Așteaptă puțin și încearcă din nou.',
    network: 'Problemă de conexiune. Verifică internetul și reîncearcă.',
    other: 'Nu am putut retrimite emailul. Reîncearcă peste un minut.',
  },
  en: {
    invalid: 'We couldn’t resend the email. Try again in a minute.',
    rate_limit: 'You requested too many codes. Wait a little and try again.',
    network: 'Connection problem. Check your internet and try again.',
    other: 'We couldn’t resend the email. Try again in a minute.',
  },
}

export function verifyOtpErrorMessage(kind: OtpErrorKind, lang: OtpLang): string {
  return VERIFY_MESSAGES[lang][kind]
}

export function resendErrorMessage(kind: OtpErrorKind, lang: OtpLang): string {
  return RESEND_MESSAGES[lang][kind]
}

/**
 * Secundele rămase până la următoarea retrimitere (0 = poate retrimite).
 * `sentAt`/`now` în milisecunde. Un `sentAt` din viitor (ceas dat înapoi) sau
 * invalid nu poate bloca butonul peste durata totală.
 */
export function resendCooldownLeft(
  sentAt: number | null,
  now: number,
  totalSeconds: number = RESEND_COOLDOWN_S,
): number {
  if (sentAt === null || !Number.isFinite(sentAt) || !Number.isFinite(now)) return 0
  const elapsedMs = now - sentAt
  if (elapsedMs < 0) return totalSeconds
  const left = Math.ceil(totalSeconds - elapsedMs / 1000)
  return left > 0 ? left : 0
}

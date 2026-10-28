// Codul de 6 cifre din emailul de confirmare (S1): sanitizare, clasificarea
// erorilor GoTrue, mesajele românești și cooldown-ul „Retrimite".
//
//   OT1  sanitizeOtpInput: doar cifre, max 6 („123 456", „123-456", litere)
//   OT2  isOtpComplete: exact 6 cifre
//   OT3  classifyAuthError pe COD (otp_expired, rate limit, 429) — stabil
//   OT4  classifyAuthError pe MESAJ când codul lipsește („Token has expired or
//        is invalid", „email rate limit exceeded", „Failed to fetch")
//   OT5  rate-limit bate „invalid" (un mesaj poate conține ambele cuvinte)
//   OT6  CLICHET: pentru fiecare tip și limbă există mesaj, iar cel românesc nu
//        scurge textul englezesc brut al lui GoTrue
//   OT7  resendCooldownLeft: 60 → 0, rotunjit în sus, fără blocare peste total
//   OT8  resendCooldownLeft: lipsă/ceas în urmă/NaN nu blochează butonul degeaba
import { describe, it, expect } from 'vitest'
import {
  OTP_LENGTH,
  RESEND_COOLDOWN_S,
  classifyAuthError,
  isOtpComplete,
  resendCooldownLeft,
  resendErrorMessage,
  sanitizeOtpInput,
  verifyOtpErrorMessage,
  type OtpErrorKind,
} from '../otp'

describe('sanitizeOtpInput / isOtpComplete', () => {
  it('OT1 păstrează doar cifrele, maximum 6', () => {
    expect(sanitizeOtpInput('123456')).toBe('123456')
    expect(sanitizeOtpInput('123 456')).toBe('123456')
    expect(sanitizeOtpInput('123-456')).toBe('123456')
    expect(sanitizeOtpInput('12ab34')).toBe('1234')
    expect(sanitizeOtpInput('1234567890')).toBe('123456')
    expect(sanitizeOtpInput('')).toBe('')
    expect(OTP_LENGTH).toBe(6)
  })

  it('OT2 complet = exact 6 cifre', () => {
    expect(isOtpComplete('123456')).toBe(true)
    expect(isOtpComplete('12345')).toBe(false)
    expect(isOtpComplete('1234567')).toBe(false)
    expect(isOtpComplete('12345a')).toBe(false)
    expect(isOtpComplete('')).toBe(false)
  })
})

describe('classifyAuthError', () => {
  it('OT3 după cod', () => {
    expect(classifyAuthError({ code: 'otp_expired', message: 'x' })).toBe('invalid')
    expect(classifyAuthError({ code: 'over_request_rate_limit' })).toBe('rate_limit')
    expect(classifyAuthError({ code: 'over_email_send_rate_limit' })).toBe('rate_limit')
    expect(classifyAuthError({ status: 429 })).toBe('rate_limit')
  })

  it('OT4 după mesaj, când codul lipsește', () => {
    expect(classifyAuthError({ message: 'Token has expired or is invalid' })).toBe('invalid')
    expect(classifyAuthError({ message: 'email rate limit exceeded' })).toBe('rate_limit')
    expect(
      classifyAuthError({ message: 'For security purposes, you can only request this after 45 seconds.' }),
    ).toBe('rate_limit')
    expect(classifyAuthError({ message: 'Failed to fetch' })).toBe('network')
    expect(classifyAuthError({ message: 'NetworkError when attempting to fetch resource.' })).toBe('network')
    expect(classifyAuthError({ message: 'something else entirely' })).toBe('other')
    expect(classifyAuthError(null)).toBe('other')
    expect(classifyAuthError(undefined)).toBe('other')
  })

  it('OT5 rate-limit bate „invalid" când mesajul le conține pe ambele', () => {
    expect(classifyAuthError({ message: 'Too many requests: token invalid' })).toBe('rate_limit')
    expect(classifyAuthError({ code: 'over_request_rate_limit', message: 'Token has expired' })).toBe(
      'rate_limit',
    )
  })
})

describe('mesaje', () => {
  const KINDS: OtpErrorKind[] = ['invalid', 'rate_limit', 'network', 'other']

  it('OT6 fiecare tip are mesaj în ambele limbi; cel RO nu scurge engleza GoTrue', () => {
    for (const kind of KINDS) {
      for (const lang of ['ro', 'en'] as const) {
        expect(verifyOtpErrorMessage(kind, lang).length, `verify ${kind}/${lang}`).toBeGreaterThan(10)
        expect(resendErrorMessage(kind, lang).length, `resend ${kind}/${lang}`).toBeGreaterThan(10)
      }
      expect(verifyOtpErrorMessage(kind, 'ro')).not.toMatch(/token|expired|rate limit|failed to fetch/i)
      expect(resendErrorMessage(kind, 'ro')).not.toMatch(/token|expired|rate limit|failed to fetch/i)
    }
    // Limita serverului poate fi mai lungă de un minut (SMTP-ul built-in:
    // câteva emailuri pe oră): mesajele de rate-limit nu promit nicio durată.
    for (const lang of ['ro', 'en'] as const) {
      expect(verifyOtpErrorMessage('rate_limit', lang), `verify ${lang}`).not.toMatch(/\d|minut|minute|second|secund/i)
      expect(resendErrorMessage('rate_limit', lang), `resend ${lang}`).not.toMatch(/\d|minut|minute|second|secund/i)
    }
    // Cod greșit: mesajul trimite spre „Retrimite" (acțiunea de recuperare).
    expect(verifyOtpErrorMessage('invalid', 'ro')).toMatch(/Retrimite/)
    expect(verifyOtpErrorMessage('invalid', 'ro')).not.toBe(verifyOtpErrorMessage('rate_limit', 'ro'))
  })
})

describe('resendCooldownLeft', () => {
  const T0 = 1_760_000_000_000

  it('OT7 numără de la 60 la 0, rotunjit în sus', () => {
    expect(RESEND_COOLDOWN_S).toBe(60)
    expect(resendCooldownLeft(T0, T0)).toBe(60)
    expect(resendCooldownLeft(T0, T0 + 1)).toBe(60) // 59,999 s → 60
    expect(resendCooldownLeft(T0, T0 + 1000)).toBe(59)
    expect(resendCooldownLeft(T0, T0 + 59_000)).toBe(1)
    expect(resendCooldownLeft(T0, T0 + 59_001)).toBe(1)
    expect(resendCooldownLeft(T0, T0 + 60_000)).toBe(0)
    expect(resendCooldownLeft(T0, T0 + 3_600_000)).toBe(0)
    expect(resendCooldownLeft(T0, T0 + 10_000, 30)).toBe(20)
  })

  it('OT8 fără moment trimis, ceas dat înapoi sau NaN → fără blocaj peste durata totală', () => {
    expect(resendCooldownLeft(null, T0)).toBe(0)
    expect(resendCooldownLeft(Number.NaN, T0)).toBe(0)
    expect(resendCooldownLeft(T0, Number.NaN)).toBe(0)
    // „now" înaintea momentului trimis (ceas dat înapoi): cel mult durata totală
    expect(resendCooldownLeft(T0 + 5_000_000, T0)).toBe(60)
  })
})

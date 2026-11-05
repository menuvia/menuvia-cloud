// Erorile GoTrue ale formularului de autentificare, pe clase (lotul L2a).
//   AE1  fiecare mesaj GoTrue cunoscut → clasa lui; necunoscut/gol → 'other'.
//   AE2  ordinea e cea de dinainte: un mesaj cu două cuvinte-cheie ia PRIMA clasă.
//   AE3  româna rămâne BYTE-identică cu textele de dinainte de L2a (fluxul RO nu
//        se schimbă), iar fiecare clasă are text în toate cele patru limbi.
import { describe, expect, it } from 'vitest'
import { AUTH_FORM_ERROR_KEYS, classifyAuthFormError, type AuthFormErrorKind } from '../authErrors'
import ro from '../../i18n/ns/auth/ro'
import en from '../../i18n/ns/auth/en'
import fr from '../../i18n/ns/auth/fr'
import de from '../../i18n/ns/auth/de'

describe('classifyAuthFormError', () => {
  it('AE1 mesajele cunoscute', () => {
    const cases: [string, AuthFormErrorKind][] = [
      ['Invalid login credentials', 'invalid_credentials'],
      ['User already registered', 'already_registered'],
      ['A user with this email address has already been registered', 'already_registered'],
      ['Email not confirmed', 'email_not_confirmed'],
      ['Password should be at least 6 characters.', 'password_short'],
      ['email rate limit exceeded', 'rate_limit'],
      ['Too many requests', 'rate_limit'],
      ['Unable to validate email address: invalid format', 'invalid_email'],
      ['Failed to fetch', 'network'],
      ['Database error granting user', 'other'],
      ['', 'other'],
    ]
    for (const [msg, kind] of cases) expect(classifyAuthFormError(msg), msg).toBe(kind)
    expect(classifyAuthFormError(null)).toBe('other')
    expect(classifyAuthFormError(undefined)).toBe('other')
  })

  it('AE2 prima clasă câștigă', () => {
    expect(classifyAuthFormError('Invalid login credentials (network)')).toBe('invalid_credentials')
    expect(classifyAuthFormError('rate limit: invalid email')).toBe('rate_limit')
  })

  it('AE3 româna de dinainte, text în toate limbile', () => {
    expect(ro[AUTH_FORM_ERROR_KEYS.invalid_credentials]).toBe('Email sau parolă greșită.')
    expect(ro[AUTH_FORM_ERROR_KEYS.already_registered]).toBe(
      'Există deja un cont cu acest email. Încearcă autentificarea sau resetarea parolei.',
    )
    expect(ro[AUTH_FORM_ERROR_KEYS.network]).toBe('Problemă de conexiune. Verifică internetul și reîncearcă.')
    expect(ro.errorGeneric).toBe('Nu am putut procesa cererea. Verifică datele și reîncearcă.')
    for (const key of Object.values(AUTH_FORM_ERROR_KEYS)) {
      for (const [lang, d] of Object.entries({ ro, en, fr, de })) {
        expect(d[key].length, `${lang}.${key}`).toBeGreaterThan(10)
      }
      expect(en[key]).not.toBe(ro[key])
    }
  })
})

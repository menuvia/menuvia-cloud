// src/lib/authErrors.ts — erorile GoTrue ale formularului de autentificare,
// pe CLASE (lotul L2a). GoTrue răspunde în engleză („Invalid login
// credentials"), iar publicul funnel-ului e non-tehnic: fiecare clasă are textul
// ei în dicționarul `auth`, în limba omului. Ordinea verificărilor e EXACT cea
// de dinainte de L2a (un mesaj poate conține două cuvinte-cheie).
export type AuthFormErrorKind =
  | 'invalid_credentials'
  | 'already_registered'
  | 'email_not_confirmed'
  | 'password_short'
  | 'rate_limit'
  | 'invalid_email'
  | 'network'
  | 'other'

export function classifyAuthFormError(message: string | null | undefined): AuthFormErrorKind {
  const m = (message ?? '').toLowerCase()
  if (m.includes('invalid login credentials')) return 'invalid_credentials'
  if (m.includes('already registered') || m.includes('already been registered')) return 'already_registered'
  if (m.includes('email not confirmed')) return 'email_not_confirmed'
  if (m.includes('password should be') || m.includes('password is too short')) return 'password_short'
  if (m.includes('rate limit') || m.includes('too many requests')) return 'rate_limit'
  if (m.includes('invalid email') || m.includes('unable to validate email')) return 'invalid_email'
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to')) return 'network'
  return 'other'
}

/** Cheia din dicționarul `auth` pentru fiecare clasă cunoscută. */
export const AUTH_FORM_ERROR_KEYS = {
  invalid_credentials: 'errInvalidCredentials',
  already_registered: 'errAlreadyRegistered',
  email_not_confirmed: 'errEmailNotConfirmed',
  password_short: 'errPasswordShort',
  rate_limit: 'errRateLimit',
  invalid_email: 'errInvalidEmail',
  network: 'errNetwork',
} as const satisfies Record<Exclude<AuthFormErrorKind, 'other'>, string>

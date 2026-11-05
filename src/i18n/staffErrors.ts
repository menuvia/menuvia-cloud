// src/i18n/staffErrors.ts — mesajul unei erori pentru personal, în limba lui
// (lotul L0b). Regula e cea din plan:
//   1. un `hint` cunoscut de apelant → textul lui (deja tradus, din namespace-ul
//      ecranului) — contractul cu serverul e HINT-ul, nu textul (convenția de
//      la mig 290; de la 323 încolo, orice `raise` nou poartă hint);
//   2. în ROMÂNĂ: exact `toUserMessage` de azi (inclusiv textul românesc al
//      serverului afișat ca atare) — migrarea unui ecran nu schimbă nimic;
//   3. în altă limbă: clasa erorii (drepturi, rețea, duplicat…) → textul ei
//      din `common`; un text românesc de la server NU se afișează (ar face
//      ecranul amestecat), cade pe mesajul de rezervă al contextului.
import { MSG_GENERIC, toUserMessage, userErrorKind } from '../lib/userMessages'
import type { Translator } from './core'
import type commonRo from './ns/common/ro'

export interface StaffErrorOpts {
  /** Textul de rezervă al contextului (deja tradus); implicit `err_generic`. */
  fallback?: string
  /** hint → text deja tradus, pentru refuzurile de business ale ecranului. */
  hints?: Readonly<Record<string, string>>
}

function hintOf(err: unknown): string | null {
  if (err == null || typeof err !== 'object') return null
  const h = (err as { hint?: unknown }).hint
  return typeof h === 'string' && h ? h : null
}

export function describeStaffError(
  err: unknown,
  tc: Translator<typeof commonRo>,
  opts: StaffErrorOpts = {},
): string {
  const hint = hintOf(err)
  if (hint && opts.hints && Object.prototype.hasOwnProperty.call(opts.hints, hint)) return opts.hints[hint]
  if (tc.lang === 'ro') return toUserMessage(err, opts.fallback ?? MSG_GENERIC)
  const fallback = opts.fallback ?? tc.t('err_generic')
  const k = userErrorKind(err)
  switch (k.kind) {
    case 'permission':
      return tc.t('err_permission')
    case 'not_found':
      return tc.t('err_not_found')
    case 'duplicate':
      return tc.t('err_duplicate')
    case 'network':
      return tc.t('err_network')
    case 'forbidden':
      return tc.t('err_forbidden')
    case 'romanian':
    case 'unknown':
      return fallback
  }
}

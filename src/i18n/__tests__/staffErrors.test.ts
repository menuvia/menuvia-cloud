// Erorile pentru personal, în limba lui (lotul L0b).
//   SE1  română: EXACT `toUserMessage` (inclusiv textul românesc al serverului).
//   SE2  altă limbă: clasa erorii → textul din `common`, niciodată textul
//        românesc al serverului (ecran amestecat) — cade pe rezerva contextului.
//   SE3  un hint cunoscut de apelant câștigă în orice limbă.
//   SE4  necunoscut → rezerva contextului, apoi `err_generic`.
//   SE5  textele `err_*` românești sunt identice cu MSG_* (o singură sursă).
//   SE6  `describeFunctionError` (lotul L8d, erorile funcțiilor Netlify
//        `{ error, code }`): în ROMÂNĂ = `toUserMessage`, iar `codes` NU se
//        consultă (textul românesc al serverului rămâne, engleza internă cade
//        pe rezervă); în altă limbă un `code` cunoscut → textul lui, unul
//        necunoscut → clasa erorii / rezerva, niciodată textul serverului; un
//        SQLSTATE nu se potrivește din greșeală. Mutațiile care pică: `codes`
//        consultat și în română; `codes` ignorat în celelalte limbi.
import { describe, it, expect } from 'vitest'
import { describeFunctionError, describeStaffError } from '../staffErrors'
import { makeTranslator } from '../core'
import ro from '../ns/common/ro'
import fr from '../ns/common/fr'
import {
  MSG_DUPLICATE,
  MSG_FORBIDDEN,
  MSG_GENERIC,
  MSG_NETWORK,
  MSG_NOT_FOUND,
  MSG_NO_PERMISSION,
  toUserMessage,
} from '../../lib/userMessages'

const tRo = makeTranslator(ro, 'ro')
const tFr = makeTranslator<typeof ro>(fr, 'fr')
const SAMPLES: unknown[] = [
  { code: '42501', message: 'permission denied for table orders' },
  { code: 'PGRST116', message: 'no rows' },
  { code: '23505', message: 'duplicate key value' },
  new TypeError('Failed to fetch'),
  { message: 'Comanda e deja plătită.' },
  { status: 403, message: 'forbidden' },
  { message: 'something exploded' },
  null,
  'Masa nu există',
]

describe('describeStaffError', () => {
  it('SE1 română = toUserMessage', () => {
    for (const e of SAMPLES) expect(describeStaffError(e, tRo)).toBe(toUserMessage(e))
    expect(describeStaffError({ message: 'x' }, tRo, { fallback: 'Nu s-a salvat.' })).toBe('Nu s-a salvat.')
  })

  it('SE2 franceză: clasa erorii, niciodată textul românesc', () => {
    expect(describeStaffError(SAMPLES[0], tFr)).toBe(fr.err_permission)
    expect(describeStaffError(SAMPLES[3], tFr)).toBe(fr.err_network)
    expect(describeStaffError(SAMPLES[4], tFr)).toBe(fr.err_generic)
    expect(describeStaffError('Masa nu există', tFr, { fallback: 'Échec.' })).toBe('Échec.')
    for (const e of SAMPLES) expect(describeStaffError(e, tFr)).not.toMatch(/[ăâîșț]/i)
  })

  it('SE3 hint-ul cunoscut câștigă', () => {
    const err = { message: 'Comanda e deja plătită.', hint: 'order_paid' }
    expect(describeStaffError(err, tFr, { hints: { order_paid: 'Commande déjà payée.' } })).toBe('Commande déjà payée.')
    expect(describeStaffError(err, tRo, { hints: { order_paid: 'Deja plătită.' } })).toBe('Deja plătită.')
    expect(describeStaffError(err, tFr, { hints: { other: 'x' } })).toBe(fr.err_generic)
  })

  it('SE4 rezerva contextului', () => {
    expect(describeStaffError(SAMPLES[6], tFr, { fallback: 'Échec.' })).toBe('Échec.')
    expect(describeStaffError(SAMPLES[6], tFr)).toBe(fr.err_generic)
  })

  it('SE5 textele românești err_* = MSG_*', () => {
    expect([ro.err_permission, ro.err_not_found, ro.err_duplicate, ro.err_network, ro.err_forbidden, ro.err_generic]).toEqual([
      MSG_NO_PERMISSION,
      MSG_NOT_FOUND,
      MSG_DUPLICATE,
      MSG_NETWORK,
      MSG_FORBIDDEN,
      MSG_GENERIC,
    ])
  })

  it('SE6 describeFunctionError: româna neschimbată, celelalte limbi pe cod', () => {
    const codes = { portal_unavailable: 'Portail indisponible.', rate_limited: 'Trop de tentatives.' }
    const roServer = Object.assign(new Error('Portalul de facturare nu e disponibil momentan.'), { code: 'portal_unavailable' })
    const enInternal = Object.assign(new Error('Stripe not configured'), { code: 'server_config' })
    // Română: EXACT toUserMessage, oricare ar fi codul (harta nu se consultă).
    for (const e of [roServer, enInternal, ...SAMPLES]) {
      expect(describeFunctionError(e, tRo, { fallback: 'Rezervă.', codes })).toBe(toUserMessage(e, 'Rezervă.'))
    }
    expect(describeFunctionError(roServer, tRo, { codes })).toBe('Portalul de facturare nu e disponibil momentan.')
    // Franceză: codul cunoscut → textul lui; necunoscut → rezerva; rețeaua → clasa.
    expect(describeFunctionError(roServer, tFr, { fallback: 'Échec.', codes })).toBe('Portail indisponible.')
    expect(describeFunctionError(enInternal, tFr, { fallback: 'Échec.', codes })).toBe('Échec.')
    expect(describeFunctionError(new TypeError('Failed to fetch'), tFr, { codes })).toBe(fr.err_network)
    // Un SQLSTATE nu e în hartă: rămâne clasa lui (drepturi).
    expect(describeFunctionError({ code: '42501', message: 'permission denied' }, tFr, { codes })).toBe(fr.err_permission)
    for (const e of [roServer, enInternal, ...SAMPLES]) {
      expect(describeFunctionError(e, tFr, { codes })).not.toMatch(/[ăâîșț]/i)
    }
  })
})

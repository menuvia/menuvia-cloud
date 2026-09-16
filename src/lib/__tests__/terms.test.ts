// Teste pe consemnarea consimțământului la Termeni (audit v3).
//
// Defectul reparat: RPC-ul era chemat imediat după `signUp`, când sesiunea e
// null prin construcție (confirmarea de email e pornită pe prod), iar eșecul
// era un `console.warn` — 0 din 7 conturi aveau `terms_accepted_at`.
//
//   TM1  intenția se păstrează și se recitește (altfel confirmarea de email,
//        care vine în alt tab la ore distanță, pierde bifa);
//   TM2  intenția e LEGATĂ DE EMAIL — pe un dispozitiv partajat, contul lui B
//        nu moștenește bifa lui A;
//   TM3  storage-ul căzut (private mode) nu aruncă niciodată;
//   TM4  succesul curăță intenția, ca a doua sesiune să nu re-consemneze;
//   TM5  eroarea RPC ajunge sus ca `Error` REAL, cu `code`/`hint` păstrate
//        (tiparul `createOrder`) — nu mai poate fi înghițită;
//   TM6  tristate: profil necunoscut NU înseamnă „nu a acceptat" (un blip de
//        rețea nu are voie să blocheze dashboard-ul).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import {
  TERMS_VERSION,
  clearPendingTermsConsent,
  needsTermsAcceptance,
  pendingConsentMatches,
  readPendingTermsConsent,
  recordTermsAcceptance,
  storePendingTermsConsent,
} from '../terms'

const KEY = 'menuvia.terms_pending'

beforeEach(() => {
  localStorage.clear()
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ error: null })
})

describe('intenția de consimțământ', () => {
  it('TM1: se păstrează și se recitește identic', () => {
    storePendingTermsConsent('Ana@Example.COM', TERMS_VERSION)
    expect(readPendingTermsConsent()).toEqual({ version: TERMS_VERSION, email: 'ana@example.com' })
  })

  it('TM2: nu se moștenește între conturi pe același dispozitiv', () => {
    storePendingTermsConsent('a@x.test')
    const pending = readPendingTermsConsent()
    expect(pendingConsentMatches(pending, 'a@x.test')).toBe(true)
    expect(pendingConsentMatches(pending, 'A@X.TEST')).toBe(true)
    expect(pendingConsentMatches(pending, 'b@x.test')).toBe(false)
    expect(pendingConsentMatches(pending, null)).toBe(false)
    expect(pendingConsentMatches(null, 'a@x.test')).toBe(false)
  })

  it('TM3: storage indisponibil sau corupt nu aruncă', () => {
    localStorage.setItem(KEY, '{nu e json')
    expect(readPendingTermsConsent()).toBeNull()

    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    expect(() => storePendingTermsConsent('a@x.test')).not.toThrow()
    spy.mockRestore()
  })

  it('TM4: consemnarea reușită curăță intenția', async () => {
    storePendingTermsConsent('a@x.test')
    await recordTermsAcceptance(TERMS_VERSION)
    expect(rpcMock).toHaveBeenCalledWith('record_terms_acceptance', { p_version: TERMS_VERSION })
    expect(readPendingTermsConsent()).toBeNull()
  })

  it('clearPendingTermsConsent șterge explicit', () => {
    storePendingTermsConsent('a@x.test')
    clearPendingTermsConsent()
    expect(readPendingTermsConsent()).toBeNull()
  })
})

describe('recordTermsAcceptance()', () => {
  it('TM5: eroarea RPC devine Error real, cu code și hint', async () => {
    rpcMock.mockResolvedValue({
      error: { message: 'Autentificare necesară', code: 'P0001', hint: 'auth_required' },
    })
    storePendingTermsConsent('a@x.test')

    await expect(recordTermsAcceptance(TERMS_VERSION)).rejects.toThrow('Autentificare necesară')
    // Intenția NU se pierde pe eșec: gate-ul o va folosi la următoarea sesiune.
    expect(readPendingTermsConsent()).not.toBeNull()

    try {
      await recordTermsAcceptance(TERMS_VERSION)
      expect.unreachable('trebuia să arunce')
    } catch (e) {
      const err = e as Error & { code?: string; hint?: string }
      expect(err).toBeInstanceOf(Error)
      expect(err.code).toBe('P0001')
      expect(err.hint).toBe('auth_required')
    }
  })
})

describe('needsTermsAcceptance()', () => {
  it('TM6: tristate — necunoscutul nu e „nu a acceptat"', () => {
    expect(needsTermsAcceptance(null)).toBe(false)
    expect(needsTermsAcceptance(undefined)).toBe(false)
    expect(needsTermsAcceptance({ terms_accepted_at: null })).toBe(true)
    expect(needsTermsAcceptance({ terms_accepted_at: '2026-09-16T10:00:00Z' })).toBe(false)
  })
})

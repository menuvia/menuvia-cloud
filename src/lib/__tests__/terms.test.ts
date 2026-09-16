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
  it('TM1: se păstrează și se recitește, cu emailul normalizat', () => {
    storePendingTermsConsent('Ana@Example.COM', TERMS_VERSION)
    expect(readPendingTermsConsent('ana@example.com')).toEqual({
      version: TERMS_VERSION,
      email: 'ana@example.com',
    })
    // Citirea e case-insensitive, ca sesiunea să se potrivească oricum vine.
    expect(readPendingTermsConsent('ANA@EXAMPLE.COM')).not.toBeNull()
  })

  it('TM2: nu se moștenește între conturi și nu se suprascriu între ele', () => {
    storePendingTermsConsent('a@x.test')
    storePendingTermsConsent('b@x.test')
    // Două înregistrări din taburi diferite: a doua NU o distruge pe prima
    // (înainte exista un singur slot, deci primul om vedea ecranul degeaba).
    expect(readPendingTermsConsent('a@x.test')).not.toBeNull()
    expect(readPendingTermsConsent('b@x.test')).not.toBeNull()
    expect(readPendingTermsConsent('c@x.test')).toBeNull()
    expect(readPendingTermsConsent('')).toBeNull()
  })

  it('TM2b: numărul de intenții e mărginit (localStorage nu crește la nesfârșit)', () => {
    for (let i = 0; i < 8; i++) storePendingTermsConsent(`u${i}@x.test`)
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>
    expect(Object.keys(stored).length).toBeLessThanOrEqual(5)
    // Cele mai noi supraviețuiesc.
    expect(readPendingTermsConsent('u7@x.test')).not.toBeNull()
  })

  it('TM3: storage indisponibil sau corupt nu aruncă', () => {
    localStorage.setItem(KEY, '{nu e json')
    expect(readPendingTermsConsent('a@x.test')).toBeNull()

    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    expect(() => storePendingTermsConsent('a@x.test')).not.toThrow()
    spy.mockRestore()
  })

  it('TM4: consemnarea reușită curăță DOAR intenția contului consemnat', async () => {
    storePendingTermsConsent('a@x.test')
    storePendingTermsConsent('b@x.test')
    await recordTermsAcceptance(TERMS_VERSION, 'a@x.test')
    expect(rpcMock).toHaveBeenCalledWith('record_terms_acceptance', { p_version: TERMS_VERSION })
    expect(readPendingTermsConsent('a@x.test')).toBeNull()
    expect(readPendingTermsConsent('b@x.test')).not.toBeNull()
  })

  it('clearPendingTermsConsent șterge un cont sau tot', () => {
    storePendingTermsConsent('a@x.test')
    storePendingTermsConsent('b@x.test')
    clearPendingTermsConsent('a@x.test')
    expect(readPendingTermsConsent('a@x.test')).toBeNull()
    expect(readPendingTermsConsent('b@x.test')).not.toBeNull()
    clearPendingTermsConsent()
    expect(readPendingTermsConsent('b@x.test')).toBeNull()
  })
})

describe('recordTermsAcceptance()', () => {
  it('TM5: eroarea RPC devine Error real, cu code și hint', async () => {
    rpcMock.mockResolvedValue({
      error: { message: 'Autentificare necesară', code: 'P0001', hint: 'auth_required' },
    })
    storePendingTermsConsent('a@x.test')

    await expect(recordTermsAcceptance(TERMS_VERSION, 'a@x.test')).rejects.toThrow(
      'Autentificare necesară',
    )
    // Intenția NU se pierde pe eșec: gate-ul o va folosi la următoarea sesiune.
    expect(readPendingTermsConsent('a@x.test')).not.toBeNull()

    try {
      await recordTermsAcceptance(TERMS_VERSION, 'a@x.test')
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

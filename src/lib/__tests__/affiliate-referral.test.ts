// Teste pe linkul de referral (mig 295 §3) și pe cifrele afiliatului (§2).
//
//   RF1  `/r/:cod` → codul, URL rescris la `/` (contractul vechi)
//   RF2  `?ref=COD` pe orice rută → DESTINAȚIA și ceilalți parametri rămân
//   RF3  vanity cu CRATIMĂ supraviețuiește normalizării (vechiul sanitizeCode
//        o ștergea: „ion-pop" → „ionpop", care nu potrivea nimic)
//   RF4  URL fără referral → null (nimic de curățat)
//   RF5  captura unui vanity: cookie-ul primește codul CANONIC de la server,
//        touch-ul pleacă tot cu codul canonic
//   RF6  RPC indisponibil (DB fără 295) + cod clasic → contractul vechi: cookie
//        imediat, touch cu codul brut
//   RF7  valoare malformată → URL curățat, NIMIC stocat, niciun RPC
//   AE1  rezumatul panoului preferă cifrele NETE ale serverului
//   AE2  fără mig 295 → calculul vechi (confirmat − plătit)
//   AE3  calculatorul: în primele 12 luni intră activarea + 11 recurente
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import {
  parseReferralFromLocation,
  captureReferralFromUrl,
  getStoredReferral,
} from '../affiliate'
import { summarizeEarnings, estimateAffiliateEarnings } from '../affiliateEarnings'

function clearCookies() {
  for (const name of ['mv_ref', 'mv_vid']) {
    document.cookie = `${name}=; Max-Age=0; Path=/`
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('parseReferralFromLocation (pur)', () => {
  it('RF1: /r/:cod → cod, destinație `/`', () => {
    expect(parseReferralFromLocation('/r/AbC12345', '', '')).toEqual({ raw: 'abc12345', cleanUrl: '/' })
  })

  it('RF2: ?ref= pe orice rută păstrează destinația și ceilalți parametri', () => {
    expect(parseReferralFromLocation('/pricing', '?ref=abc12345&plan=growth', '#top')).toEqual({
      raw: 'abc12345',
      cleanUrl: '/pricing?plan=growth#top',
    })
  })

  it('RF3: vanity cu cratimă rămâne intact', () => {
    expect(parseReferralFromLocation('/r/Ion-Pop/', '?x=1', '')).toEqual({ raw: 'ion-pop', cleanUrl: '/?x=1' })
    expect(parseReferralFromLocation('/afiliat', '?ref=ion-pop', '')?.raw).toBe('ion-pop')
  })

  it('RF4: fără referral → null', () => {
    expect(parseReferralFromLocation('/pricing', '?plan=growth', '')).toBeNull()
    expect(parseReferralFromLocation('/', '', '')).toBeNull()
  })
})

describe('captureReferralFromUrl', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    clearCookies()
  })

  it('RF5: vanity → cookie cu codul CANONIC + touch cu codul canonic', async () => {
    rpcMock.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'resolve_referral_code'
          ? { data: { referral_code: 'a1b2c3d4' }, error: null }
          : { data: { ok: true }, error: null },
      ),
    )
    window.history.replaceState(null, '', '/pricing?ref=ion-pop&plan=growth')
    expect(captureReferralFromUrl()).toBe('ion-pop')
    expect(window.location.pathname + window.location.search).toBe('/pricing?plan=growth')
    await flush()
    expect(rpcMock).toHaveBeenCalledWith('resolve_referral_code', { p_code: 'ion-pop' })
    expect(getStoredReferral()).toBe('a1b2c3d4')
    const touch = rpcMock.mock.calls.find((c) => c[0] === 'record_affiliate_touch')
    expect(touch?.[1]).toMatchObject({ p_referral_code: 'a1b2c3d4' })
  })

  it('RF6: RPC lipsă + cod clasic → cookie imediat, touch cu codul brut', async () => {
    rpcMock.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'resolve_referral_code'
          ? { data: null, error: { code: 'PGRST202', message: 'not found' } }
          : { data: { ok: true }, error: null },
      ),
    )
    window.history.replaceState(null, '', '/r/abc12345')
    captureReferralFromUrl()
    expect(getStoredReferral()).toBe('abc12345')
    expect(window.location.pathname).toBe('/')
    await flush()
    const touch = rpcMock.mock.calls.find((c) => c[0] === 'record_affiliate_touch')
    expect(touch?.[1]).toMatchObject({ p_referral_code: 'abc12345' })
  })

  it('RF7: malformat → URL curățat, nimic stocat, niciun RPC', async () => {
    window.history.replaceState(null, '', '/pricing?ref=nu%20e%20bun!&plan=pro')
    expect(captureReferralFromUrl()).toBeNull()
    expect(window.location.search).toBe('?plan=pro')
    await flush()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(getStoredReferral()).toBeNull()
  })
})

describe('cifrele afiliatului', () => {
  const base = { confirmed_cents: 10000, pending_cents: 3000, paid_cents: 2000, total_cents: 15000 }

  it('AE1: serverul (mig 295) e sursa: disponibil/net/în așteptare nete', () => {
    const s = summarizeEarnings({
      ...base,
      available_cents: 4000,
      net_earned_cents: 12000,
      pending_net_cents: 2000,
      in_progress_cents: 4000,
      min_payout_cents: 5000,
    })
    expect(s).toMatchObject({
      availableCents: 4000,
      netEarnedCents: 12000,
      pendingCents: 2000,
      inProgressCents: 4000,
      belowMinimum: true,
      serverNet: true,
    })
  })

  it('AE2: fără mig 295 → calculul vechi', () => {
    expect(summarizeEarnings(base)).toMatchObject({
      availableCents: 8000,
      netEarnedCents: 15000,
      pendingCents: 3000,
      serverNet: false,
      belowMinimum: false,
    })
  })

  it('AE3: primul an = activare + 11 recurente; total = activare + 12', () => {
    const e = estimateAffiliateEarnings({
      count: 1,
      priceMonthly: 249,
      setupBps: 3000,
      recurringBps: 1000,
      capInvoices: 12,
    })
    expect(e.recurringInFirstYear).toBe(11)
    expect(e.firstYear).toBeCloseTo(348.6, 2)
    expect(e.lifetime).toBeCloseTo(373.5, 2)
  })
})

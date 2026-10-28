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
//   RF8  vanity + RPC picat → rămâne ÎN AȘTEPTARE; încărcarea următoare (fără
//        referral în URL) îl rezolvă → cookie canonic, așteptarea ștearsă
//   RF9  vanity + plafon global → înainte de checkout resolvePendingReferral
//        îl rezolvă (recenzie #286: înainte, atribuirea se pierdea tăcut)
//   RF10 RPC agățat → resolvePendingReferral iese la timeout, nu blochează
//        checkout-ul; vanity-ul rămâne pentru data viitoare
//   RF11 serverul spune „necunoscut" → așteptarea se șterge, nimic stocat
//   RF12 ultimul link câștigă: un cod clasic nou șterge vanity-ul vechi
//   RF13 cookie de așteptare malformat → ignorat, niciun RPC
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
  resolvePendingReferral,
} from '../affiliate'
import { summarizeEarnings, estimateAffiliateEarnings } from '../affiliateEarnings'

function clearCookies() {
  for (const name of ['mv_ref', 'mv_vid', 'mv_ref_pending']) {
    document.cookie = `${name}=; Max-Age=0; Path=/`
  }
}

function readPendingCookie(): string | null {
  const hit = document.cookie.split('; ').find((p) => p.startsWith('mv_ref_pending='))
  return hit ? decodeURIComponent(hit.slice('mv_ref_pending='.length)) : null
}

type RpcResult = { data: unknown; error: unknown }

function rpcWith(resolve: () => RpcResult) {
  return (fn: string) =>
    Promise.resolve(fn === 'resolve_referral_code' ? resolve() : { data: { ok: true }, error: null })
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

describe('vanity în așteptare (recenzie #286)', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    clearCookies()
  })

  it('RF8: RPC picat → în așteptare; încărcarea următoare îl rezolvă', async () => {
    rpcMock.mockImplementation(rpcWith(() => ({ data: null, error: { code: '500', message: 'down' } })))
    window.history.replaceState(null, '', '/r/ion-pop')
    expect(captureReferralFromUrl()).toBe('ion-pop')
    await flush()
    expect(getStoredReferral()).toBeNull()
    expect(readPendingCookie()).toBe('ion-pop')
    expect(rpcMock.mock.calls.some((c) => c[0] === 'record_affiliate_touch')).toBe(false)

    rpcMock.mockReset()
    rpcMock.mockImplementation(rpcWith(() => ({ data: { referral_code: 'a1b2c3d4' }, error: null })))
    window.history.replaceState(null, '', '/pricing')
    expect(captureReferralFromUrl()).toBeNull()
    await flush()
    expect(rpcMock).toHaveBeenCalledWith('resolve_referral_code', { p_code: 'ion-pop' })
    expect(getStoredReferral()).toBe('a1b2c3d4')
    expect(readPendingCookie()).toBeNull()
    const touch = rpcMock.mock.calls.find((c) => c[0] === 'record_affiliate_touch')
    expect(touch?.[1]).toMatchObject({ p_referral_code: 'a1b2c3d4' })
  })

  it('RF9: plafon global → rezolvat înainte de checkout', async () => {
    rpcMock.mockImplementation(rpcWith(() => ({ data: { rate_limited: true }, error: null })))
    window.history.replaceState(null, '', '/pricing?ref=ion-pop')
    captureReferralFromUrl()
    await flush()
    expect(getStoredReferral()).toBeNull()
    expect(readPendingCookie()).toBe('ion-pop')

    rpcMock.mockImplementation(rpcWith(() => ({ data: { referral_code: 'a1b2c3d4' }, error: null })))
    await resolvePendingReferral(1000)
    expect(getStoredReferral()).toBe('a1b2c3d4')
    expect(readPendingCookie()).toBeNull()
  })

  it('RF10: RPC agățat → resolvePendingReferral iese la timeout', async () => {
    let release: (r: RpcResult) => void = () => undefined
    rpcMock.mockImplementation((fn: string) =>
      fn === 'resolve_referral_code'
        ? new Promise<RpcResult>((resolve) => {
            release = resolve
          })
        : Promise.resolve({ data: { ok: true }, error: null }),
    )
    window.history.replaceState(null, '', '/r/ion-pop')
    captureReferralFromUrl()
    const started = Date.now()
    await resolvePendingReferral(30)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(getStoredReferral()).toBeNull()
    expect(readPendingCookie()).toBe('ion-pop')
    // eliberăm rezolvarea agățată (eșec) ca să nu rămână în zbor pentru testele următoare
    release({ data: null, error: { code: '500', message: 'down' } })
    await flush()
    expect(readPendingCookie()).toBe('ion-pop')
  })

  it('RF11: serverul spune „necunoscut" → așteptarea se șterge', async () => {
    rpcMock.mockImplementation(rpcWith(() => ({ data: { referral_code: null }, error: null })))
    window.history.replaceState(null, '', '/r/nu-exista')
    captureReferralFromUrl()
    await flush()
    expect(getStoredReferral()).toBeNull()
    expect(readPendingCookie()).toBeNull()
  })

  it('RF12: un cod clasic nou șterge vanity-ul vechi în așteptare', async () => {
    rpcMock.mockImplementation(rpcWith(() => ({ data: null, error: { code: '500', message: 'down' } })))
    window.history.replaceState(null, '', '/r/ion-pop')
    captureReferralFromUrl()
    await flush()
    expect(readPendingCookie()).toBe('ion-pop')
    window.history.replaceState(null, '', '/r/abc12345')
    captureReferralFromUrl()
    await flush()
    expect(readPendingCookie()).toBeNull()
    expect(getStoredReferral()).toBe('abc12345')
  })

  it('RF13: cookie de așteptare malformat → ignorat, niciun RPC', async () => {
    document.cookie = `mv_ref_pending=${encodeURIComponent('nu e bun!')}; Path=/`
    window.history.replaceState(null, '', '/pricing')
    captureReferralFromUrl()
    await resolvePendingReferral(30)
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

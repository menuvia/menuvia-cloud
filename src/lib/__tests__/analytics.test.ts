// Comportamentul lui lib/analytics.ts cu posthog-js înlocuit (vi.doMock): ce
// promit politicile (menuvia-pack/03 §3.1, §3.2.a, §6; 04 §3.2, §4), DPA-ul
// (05 §3.4) și bannerul.
//   AN0  posthog-js NU e în graful static (doar `import type` + import dinamic).
//         Mutația care pică: `import posthog from 'posthog-js'`.
//   AN1  fără cheie (preview, branch deploy, local): nimic, nici cu acord.
//   AN2  fără consimțământ: nu se încarcă nimic, iar un eveniment de dinainte
//         NU se trimite retroactiv după acord. Mutația: coada fără verificarea
//         consimțământului.
//   AN3  cu consimțământ: init o dată, cu configurația de confidențialitate
//         ÎNGHEȚATĂ (setul exact de chei + valorile). Mutațiile: autocapture
//         pornit, `advanced_disable_flags` scos, `opt_out_persistence_by_default`
//         scos, `ip` readus (fără efect în 1.440).
//   AN4  before_send: scrubber + `$geoip_disable` pe orice eveniment + aruncă
//         evenimentele de pe suprafețele oaspeților. Mutațiile: filtrul de
//         oaspeți scos, `$geoip_disable` scos.
//   AN5  identitatea se aplică la init, DOAR pentru contul care a consimțit:
//         identify(id) cu UN SINGUR argument + super-proprietăți fără PII.
//   AN6  coada de dinainte de încărcare: trimisă în ordine, DUPĂ identify.
//   AN7  ieșire / schimbare de cont: reset(true) (identitate ȘI dispozitiv noi);
//         un cont care NU a consimțit nu se identifică. Mutația: reset() fără true.
//   AN8  revocare: reset(true) ÎNAINTE de opt_out, urmele `ph_*` șterse din
//         ambele storage-uri, refuzul SDK-ului PĂSTRAT cât instanța trăiește.
//         Mutațiile: ordinea inversată; reset() fără true; purjarea scoasă;
//         refuzul SDK-ului șters și el (SDK-ul l-ar citi „în așteptare” = captură).
//   AN9  reacordare în aceeași pagină: opt_in fără `$opt_in`, fără al doilea init.
//   AN10 storage care ARUNCĂ (RESID-15): fail-closed, fără init.
//   AN11 identitate rămasă sub alt cont / sesiune expirată: reset(true) la pornire.
//   AN12 contul intern (fondatorul): setInternalOrTestUser o dată, doar pentru
//         contul curent; un marcaj pentru alt cont nu se reportează.
//   AN13 sendInstantly → `send_instantly: true`.
//   AN14 consimțământ retras cât se descărca chunk-ul: fără init (cu control
//         pozitiv că importul s-a terminat — `analyticsSettledForTests`).
//   AN15 (PH-R1) PostHog așteaptă răspunsul AuthContext; contul încă logat NU
//         primește reset() la pornire. Mutația: pornirea fără să aștepte.
//   AN16 (PH-R2) refuzul SDK-ului rămas de la o vizită anterioară se șterge
//         ÎNAINTE de init: page view-ul inițial nu mai pleacă înaintea
//         super-proprietăților. Mutația: ștergerea scoasă.
//   AN17 (PH-RST-1) revocare fără PostHog încărcat: urmele `ph_*` tot se șterg,
//         dar refuzul SDK-ului RĂMÂNE (un tab vecin poate avea o instanță vie
//         care îl recitește). Mutațiile: ieșirea timpurie când clientul lipsește;
//         refuzul șters și el.
//   AN18 (PH-CONS-1) acordul e al CONTULUI: pe o tabletă partajată contul
//         următor nu e identificat pe acordul celui dinainte; acordul dat fără
//         cont îl preia primul cont din pagină, nu unul de după o reîncărcare.
//         Mutația: identify pe orice cont logat.
//   AN19 (PH-DPA-1) pagina de intrare e a oaspeților: PostHog nu se încarcă.
//   AN20 (BV3) contextul panoului (local, plan, rol) ca super-proprietăți,
//         scos la ieșire, repus după reset.
//   AN21 (BV4) `utm_*` ai paginii de intrare, din memorie, la pornire.
//   AN22 prefixele oaspeților sunt EXACT rutele `qr`/`menu`/`reserve` din App.tsx.
//   AN23 revocarea din ALT tab (evenimentul `storage`): captura se oprește și
//         aici, iar ieșirea din cont propagată după ea NU mai face reset() (care
//         ar șterge refuzul comun și ar reporni captura). Mutația: ascultătorul
//         `storage` scos.
//   AN24 aceeași revocare fără evenimentul `storage` (ratat): verificarea
//         acordului dinaintea oricărui apel care poate face reset() o prinde.
//         Mutația: garda scoasă din setAnalyticsUser.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AnalyticsModule = typeof import('../analytics')

const h = vi.hoisted(() => {
  const log: string[] = []
  const rec =
    (name: string) =>
    (...args: unknown[]): void => {
      log.push(name)
      void args
    }
  const client = {
    init: vi.fn(),
    capture: vi.fn(rec('capture')),
    identify: vi.fn(rec('identify')),
    reset: vi.fn(rec('reset')),
    register: vi.fn(rec('register')),
    unregister: vi.fn(rec('unregister')),
    opt_in_capturing: vi.fn(rec('opt_in_capturing')),
    opt_out_capturing: vi.fn(rec('opt_out_capturing')),
    has_opted_out_capturing: vi.fn(() => false),
    setInternalOrTestUser: vi.fn(rec('setInternalOrTestUser')),
  }
  return { log, rec, client, factoryCalls: 0, sdkConsentAtInit: 'unset' as string | null }
})

const KEY = 'phc_test_only_not_a_real_key'
const CONSENT_KEY = 'menuvia_cookie_consent'
const OWNER = 'ph_menuvia_identity_owner'
const CONSENT_OWNER = 'ph_menuvia_consent_uid'
const SDK_CONSENT = 'ph_menuvia_consent'

function setConsent(performance: boolean): void {
  localStorage.setItem(
    CONSENT_KEY,
    JSON.stringify({ necessary: true, performance, functional: false, timestamp: 1 }),
  )
}

/** Acordul dat în banner (evenimentul real al lui saveConsent). */
function announce(performance: boolean): void {
  setConsent(performance)
  window.dispatchEvent(
    new CustomEvent('consent-updated', {
      detail: { necessary: true, performance, functional: false, timestamp: 2 },
    }),
  )
}

/** Acord dat ANTERIOR de contul `uid` (încărcare nouă a paginii). */
function grantedEarlierBy(uid: string): void {
  setConsent(true)
  localStorage.setItem(CONSENT_OWNER, uid)
}

async function flush(): Promise<void> {
  // Importul dinamic al posthog-js se așteaptă EXPLICIT: sub vitest real,
  // rezolvarea modulului mock-uit trece prin procesul principal (RPC), deci
  // câteva ticuri fixe nu o garantează (PH-R3) — testele pozitive ar fi
  // instabile, iar cele negative ar trece înainte să se fi importat ceva.
  await a.analyticsSettledForTests()
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

function initConfig(): Record<string, unknown> {
  const call = h.client.init.mock.calls[0] as unknown[] | undefined
  expect(call).toBeDefined()
  return (call as unknown[])[1] as Record<string, unknown>
}

function resetArgs(): unknown[] {
  return h.client.reset.mock.calls.map((c) => (c as unknown[])[0])
}

// Copia INDEPENDENTĂ a configurației promise de politici: o schimbare în
// analytics.ts care nu e și aici (deci nici în politici) pică AN3.
const EXPECTED_PRIVACY: Record<string, unknown> = {
  person_profiles: 'identified_only',
  persistence: 'localStorage',
  opt_out_capturing_persistence_type: 'localStorage',
  consent_persistence_name: 'ph_menuvia_consent',
  opt_out_persistence_by_default: true,
  respect_dnt: true,
  capture_pageview: 'history_change',
  capture_pageleave: true,
  disable_capture_url_hashes: true,
  mask_personal_data_properties: true,
  autocapture: false,
  rageclick: false,
  capture_dead_clicks: false,
  capture_heatmaps: false,
  capture_exceptions: false,
  capture_performance: false,
  capture_webmcp: false,
  disable_session_recording: true,
  enable_recording_console_log: false,
  logs: { captureConsoleLogs: false },
  disable_surveys: true,
  disable_product_tours: true,
  disable_conversations: true,
  disable_web_experiments: true,
  opt_in_site_apps: false,
  disable_external_dependency_loading: true,
  advanced_disable_flags: true,
}

let a: AnalyticsModule

async function freshModule(): Promise<AnalyticsModule> {
  vi.resetModules()
  return import('../analytics')
}

beforeEach(async () => {
  h.log.length = 0
  h.factoryCalls = 0
  h.sdkConsentAtInit = 'unset'
  for (const fn of Object.values(h.client)) fn.mockClear()
  // Implementările suprascrise de un test (AN9, AN16) revin la cele implicite.
  h.client.has_opted_out_capturing.mockImplementation(() => false)
  h.client.opt_in_capturing.mockImplementation(h.rec('opt_in_capturing'))
  // Ca SDK-ul real: `loaded` rulează sincron, în interiorul lui init().
  h.client.init.mockImplementation((_key: string, cfg: { loaded?: (c: unknown) => void }) => {
    h.log.push('init')
    h.sdkConsentAtInit = localStorage.getItem(SDK_CONSENT)
    cfg.loaded?.(h.client)
    return h.client
  })
  vi.doMock('posthog-js', () => {
    h.factoryCalls++
    return { default: h.client }
  })
  localStorage.clear()
  sessionStorage.clear()
  window.history.pushState({}, '', '/')
  vi.stubEnv('VITE_POSTHOG_KEY', KEY)
  vi.stubEnv('VITE_POSTHOG_HOST', '')
  vi.stubEnv('VITE_APP_ENV', 'production')
  a = await freshModule()
})

afterEach(async () => {
  // O încărcare încă în zbor s-ar termina în testul URMĂTOR, pe același mock.
  await a.analyticsSettledForTests()
  a.resetAnalyticsForTests()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.doUnmock('posthog-js')
  localStorage.clear()
  sessionStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('analytics — încărcarea și consimțământul', () => {
  it('AN0 posthog-js nu intră în graful static al intrării', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/analytics.ts'), 'utf8')
    const staticImports = src
      .split('\n')
      .filter((l) => /^import\s+(?!type\b).*['"]posthog-js['"]/.test(l))
    expect(staticImports).toEqual([])
    expect(src).toContain("import('posthog-js')")
  })

  it('AN1 fără cheie nu se încarcă nimic, nici cu acord', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '')
    setConsent(true)
    a.setAnalyticsUser(null)
    a.initAnalytics()
    a.track('login_completed', { mfa: false })
    await flush()
    expect(h.client.init).not.toHaveBeenCalled()
    expect(h.client.capture).not.toHaveBeenCalled()
  })

  it('AN2 fără consimțământ: nimic încărcat, nimic trimis retroactiv', async () => {
    a.setAnalyticsUser(null)
    a.initAnalytics()
    a.track('login_completed', { mfa: false })
    await flush()
    expect(h.client.init).not.toHaveBeenCalled()
    expect(h.factoryCalls).toBe(0)
    announce(true)
    await flush()
    expect(h.client.init).toHaveBeenCalledTimes(1)
    expect(h.client.capture).not.toHaveBeenCalled()
  })

  it('AN3 cu consimțământ: init o dată, cu configurația înghețată', async () => {
    setConsent(true)
    a.setAnalyticsUser(null)
    a.initAnalytics()
    a.initAnalytics()
    await flush()
    expect(h.client.init).toHaveBeenCalledTimes(1)
    expect(h.client.init.mock.calls[0]?.[0]).toBe(KEY)
    const cfg = initConfig()
    expect(cfg.api_host).toBe('https://eu.i.posthog.com')
    expect(cfg.before_send).toBe(a.minimizeCaptureResult)
    expect(typeof cfg.loaded).toBe('function')
    const { api_host: _h, before_send: _b, loaded: _l, ...privacy } = cfg
    void _h
    void _b
    void _l
    expect(privacy).toEqual(EXPECTED_PRIVACY)
    expect(a.POSTHOG_PRIVACY_CONFIG).toEqual(EXPECTED_PRIVACY)
    expect('ip' in cfg).toBe(false)
  })

  it('AN4 before_send: token-uri redactate, fără GeoIP, nimic de pe paginile oaspeților', () => {
    const send = a.minimizeCaptureResult
    expect(send(null)).toBeNull()
    const ev = (properties: Record<string, unknown>) =>
      ({ uuid: 'x', event: '$pageview', properties }) as Parameters<typeof send>[0]
    const out = send(
      ev({
        $pathname: '/dashboard',
        $current_url: 'https://site.test/dashboard?payment_intent_client_secret=pi_1_secret_S',
        $referrer: 'https://site.test/invite/SECRET_INVITE_TOKEN',
      }),
    )
    expect(out).not.toBeNull()
    const props = out?.properties ?? {}
    expect(props.$referrer).toBe('https://site.test/invite/:token')
    expect(String(props.$current_url)).not.toContain('pi_1_secret_S')
    // GeoIP: transformarea proiectului citește flagul din proprietăți.
    expect(props.$geoip_disable).toBe(true)
    // Suprafețele oaspeților (DPA 05 §3.4): aruncate, pe cale SAU pe URL.
    for (const path of ['/q/TOKEN', '/m/pizzeria', '/rezervare/pizzeria']) {
      expect(send(ev({ $pathname: path })), path).toBeNull()
    }
    expect(send(ev({ $current_url: 'https://site.test/m/pizzeria?lang=en' }))).toBeNull()
    // Rutele care doar SEAMĂNĂ rămân.
    for (const path of ['/m', '/mapa', '/rezervari', '/dashboard', '/']) {
      expect(send(ev({ $pathname: path })), path).not.toBeNull()
    }
  })

  it('AN10 storage care aruncă: fail-closed, fără init', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    a.setAnalyticsUser(null)
    a.initAnalytics()
    a.track('order_placed', { item_count: 1 })
    await flush()
    expect(h.client.init).not.toHaveBeenCalled()
    expect(h.client.capture).not.toHaveBeenCalled()
  })

  it('AN14 acordul retras cât se descărca chunk-ul: fără init', async () => {
    setConsent(true)
    a.setAnalyticsUser(null)
    a.initAnalytics()
    setConsent(false)
    await flush()
    // Control pozitiv: chunk-ul chiar s-a descărcat (altfel „fără init” ar fi
    // adevărat și cu re-verificarea acordului scoasă din doInit).
    expect(h.factoryCalls).toBe(1)
    expect(h.client.init).not.toHaveBeenCalled()
  })

  it('AN15 (PH-R1) PostHog așteaptă AuthContext; contul încă logat nu primește reset()', async () => {
    grantedEarlierBy('user-1')
    localStorage.setItem(OWNER, 'user-1')
    a.initAnalytics()
    a.track('subscription_started', { plan: 'growth' })
    await flush()
    // Sesiunea nerezolvată (refresh de token pe rețea): nimic descărcat încă.
    expect(h.factoryCalls).toBe(0)
    expect(h.client.init).not.toHaveBeenCalled()
    a.setAnalyticsUser('user-1')
    await flush()
    expect(h.client.init).toHaveBeenCalledTimes(1)
    expect(h.client.reset).not.toHaveBeenCalled()
    expect(h.client.identify.mock.calls).toEqual([['user-1']])
    // Evenimentul din coadă pleacă DUPĂ identitate.
    expect(h.log.indexOf('identify')).toBeLessThan(h.log.indexOf('capture'))
  })

  it('AN16 (PH-R2) refuzul SDK-ului de la o vizită anterioară se șterge înainte de init', async () => {
    // Ca SDK-ul real: refuzul se citește din storage; pe o instanță NOUĂ,
    // opt_in_capturing trimite page view-ul inițial pe loc.
    localStorage.setItem(SDK_CONSENT, '0')
    h.client.has_opted_out_capturing.mockImplementation(
      () => localStorage.getItem(SDK_CONSENT) === '0',
    )
    h.client.opt_in_capturing.mockImplementation(() => {
      h.log.push('opt_in_capturing')
      h.log.push('capture')
    })
    a.setAnalyticsUser(null)
    a.initAnalytics()
    announce(true)
    await flush()
    expect(h.client.init).toHaveBeenCalledTimes(1)
    expect(h.sdkConsentAtInit).toBeNull()
    expect(h.client.opt_in_capturing).not.toHaveBeenCalled()
    expect(h.log).not.toContain('capture')
    expect(h.log.indexOf('register')).toBeGreaterThan(h.log.indexOf('init'))
  })

  it('AN19 (PH-DPA-1) pe paginile oaspeților PostHog nu se încarcă, nici cu acord', async () => {
    for (const path of ['/q/TOKEN', '/m/pizzeria', '/rezervare/pizzeria']) {
      a.resetAnalyticsForTests()
      a = await freshModule()
      window.history.pushState({}, '', path)
      setConsent(true)
      a.setAnalyticsUser(null)
      a.initAnalytics()
      announce(true)
      await flush()
      expect(h.factoryCalls, path).toBe(0)
      expect(h.client.init, path).not.toHaveBeenCalled()
    }
    // Control pozitiv: pe o pagină Menuvia pornește.
    a.resetAnalyticsForTests()
    a = await freshModule()
    window.history.pushState({}, '', '/pricing')
    a.setAnalyticsUser(null)
    a.initAnalytics()
    await flush()
    expect(h.client.init).toHaveBeenCalledTimes(1)
  })

  it('AN22 prefixele oaspeților = rutele qr/menu/reserve din parsePath (App.tsx)', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const re =
      /const (qrMatch|menuMatch|reserveMatch) = p\.match\(\/\^\\\/([a-z-]+)\\\/\(\.\+\)\$\/\)/g
    const found = Array.from(app.matchAll(re), (m) => `/${m[2]}/`)
    expect(found).toHaveLength(3)
    expect([...found].sort()).toEqual([...a.GUEST_SURFACE_PREFIXES].sort())
    expect(app).toContain("if (qrMatch) return { view: 'qr'")
    expect(app).toContain("if (menuMatch) return { view: 'menu'")
    expect(app).toContain("if (reserveMatch) return { view: 'reserve'")
  })
})

describe('analytics — identitatea pseudonimă, per cont', () => {
  it('AN5 identitatea se aplică la init, doar cu id-ul intern al contului care a consimțit', async () => {
    a.setAnalyticsUser('user-1')
    a.initAnalytics()
    announce(true)
    await flush()
    expect(h.client.identify).toHaveBeenCalledTimes(1)
    expect(h.client.identify.mock.calls[0]).toEqual(['user-1'])
    expect(h.client.register).toHaveBeenCalledWith({ app_env: 'production', site: 'ro' })
    expect(localStorage.getItem(OWNER)).toBe('user-1')
    expect(localStorage.getItem(CONSENT_OWNER)).toBe('user-1')
  })

  it('AN6 coada de dinainte de încărcare pleacă în ordine, după identify', async () => {
    grantedEarlierBy('user-1')
    a.setAnalyticsUser('user-1')
    a.track('subscription_started', { plan: 'growth' })
    a.track('plan_upsell_viewed', { target: 'payments' })
    a.initAnalytics()
    await flush()
    expect(h.client.capture.mock.calls.map((c) => c[0])).toEqual([
      'subscription_started',
      'plan_upsell_viewed',
    ])
    expect(h.client.capture.mock.calls[0]?.[1]).toEqual({ plan: 'growth' })
    expect(h.log.indexOf('identify')).toBeLessThan(h.log.indexOf('capture'))
  })

  it('AN7 ieșirea și schimbarea contului trec prin reset(true)', async () => {
    grantedEarlierBy('user-1')
    a.setAnalyticsUser('user-1')
    a.initAnalytics()
    await flush()
    h.log.length = 0
    a.setAnalyticsUser(null)
    expect(h.log).toEqual(['reset', 'register'])
    expect(localStorage.getItem(OWNER)).toBeNull()
    // user-2 nu a consimțit în acest browser: anonim (fără identify).
    a.setAnalyticsUser('user-2')
    expect(h.log).toEqual(['reset', 'register'])
    a.setAnalyticsUser('user-3')
    expect(h.log).toEqual(['reset', 'register', 'reset', 'register'])
    // Contul care a consimțit revine: identitatea lui, pe un dispozitiv nou.
    a.setAnalyticsUser('user-1')
    expect(h.client.identify.mock.calls.map((c) => c[0])).toEqual(['user-1', 'user-1'])
    expect(resetArgs()).toEqual([true, true, true])
    // Același cont (TOKEN_REFRESHED): nimic.
    a.setAnalyticsUser('user-1')
    expect(h.client.identify).toHaveBeenCalledTimes(2)
  })

  it('AN11 identitatea rămasă sub alt cont: reset(true) la pornire', async () => {
    localStorage.setItem(OWNER, 'user-old')
    setConsent(true)
    a.setAnalyticsUser(null)
    a.initAnalytics()
    await flush()
    expect(resetArgs()).toEqual([true])
    expect(h.client.identify).not.toHaveBeenCalled()
    expect(localStorage.getItem(OWNER)).toBeNull()
  })

  it('AN12 contul intern se marchează o dată, doar pentru contul curent', async () => {
    grantedEarlierBy('founder')
    a.setAnalyticsUser('founder')
    a.initAnalytics()
    await flush()
    a.markAnalyticsInternalUser('someone-else')
    expect(h.client.setInternalOrTestUser).not.toHaveBeenCalled()
    a.markAnalyticsInternalUser('founder')
    a.markAnalyticsInternalUser('founder')
    expect(h.client.setInternalOrTestUser).toHaveBeenCalledTimes(1)
    a.setAnalyticsUser('staff')
    expect(h.client.setInternalOrTestUser).toHaveBeenCalledTimes(1)
    // Un marcaj sosit pentru ALT cont (răspuns întârziat) nu se reportează când
    // acel cont devine curent. Mutația care pică: garda din mark scoasă.
    a.markAnalyticsInternalUser('late')
    a.setAnalyticsUser('late')
    expect(h.client.setInternalOrTestUser).toHaveBeenCalledTimes(1)
  })

  it('AN18 (PH-CONS-1) acordul e al contului, nu al tabletei', async () => {
    // (a) ospătarul A acceptă logat; pleacă; colegul B intră pe aceeași tabletă.
    a.setAnalyticsUser('waiter-a')
    a.initAnalytics()
    announce(true)
    await flush()
    expect(h.client.identify.mock.calls).toEqual([['waiter-a']])
    a.setAnalyticsUser(null)
    a.setAnalyticsUser('waiter-b')
    expect(h.client.identify.mock.calls).toEqual([['waiter-a']])
    // B își dă propriul acord din „Setări cookies” → abia acum e identificat.
    announce(true)
    expect(h.client.identify.mock.calls).toEqual([['waiter-a'], ['waiter-b']])
    expect(localStorage.getItem(CONSENT_OWNER)).toBe('waiter-b')

    // (b) acord dat FĂRĂ cont: îl preia primul cont autentificat în pagină.
    a.resetAnalyticsForTests()
    localStorage.clear()
    h.client.identify.mockClear()
    a = await freshModule()
    a.setAnalyticsUser(null)
    a.initAnalytics()
    announce(true)
    await flush()
    a.setAnalyticsUser('new-owner')
    expect(h.client.identify.mock.calls).toEqual([['new-owner']])

    // (c) acord dat fără cont, apoi pagina reîncărcată: nu se mai leagă.
    a.resetAnalyticsForTests()
    localStorage.clear()
    h.client.identify.mockClear()
    a = await freshModule()
    a.setAnalyticsUser(null)
    a.initAnalytics()
    announce(true)
    await flush()
    a.resetAnalyticsForTests()
    a = await freshModule()
    a.setAnalyticsUser('someone')
    a.initAnalytics()
    await flush()
    expect(h.client.identify).not.toHaveBeenCalled()
  })
})

describe('analytics — revocarea', () => {
  it('AN8 revocare: reset(true) ÎNAINTE de opt_out, urmele ph_* șterse, refuzul SDK păstrat', async () => {
    grantedEarlierBy('user-1')
    a.setAnalyticsUser('user-1')
    a.initAnalytics()
    await flush()
    // Ce ar fi scris SDK-ul real: persistența, sesiunea tab-ului, refuzul.
    localStorage.setItem(`ph_${KEY}_posthog`, '{"$device_id":"D"}')
    sessionStorage.setItem(`ph_${KEY}_window_id`, 'w')
    localStorage.setItem(SDK_CONSENT, '0')
    localStorage.setItem('menuvia_active_restaurant', 'r1')
    h.log.length = 0
    announce(false)
    expect(h.log).toEqual(['reset', 'opt_out_capturing'])
    expect(resetArgs()).toEqual([true])
    for (const k of [OWNER, CONSENT_OWNER, `ph_${KEY}_posthog`]) {
      expect(localStorage.getItem(k), k).toBeNull()
    }
    expect(sessionStorage.getItem(`ph_${KEY}_window_id`)).toBeNull()
    // Instanța trăiește și RECITEȘTE refuzul la fiecare eveniment.
    expect(localStorage.getItem(SDK_CONSENT)).toBe('0')
    expect(localStorage.getItem('menuvia_active_restaurant')).toBe('r1')
    a.track('order_placed', { item_count: 1 })
    expect(h.client.capture).not.toHaveBeenCalled()
  })

  it('AN9 reacordarea în aceeași pagină: opt_in fără `$opt_in`, fără al doilea init', async () => {
    grantedEarlierBy('user-1')
    a.setAnalyticsUser('user-1')
    a.initAnalytics()
    await flush()
    announce(false)
    h.client.has_opted_out_capturing.mockImplementation(() => true)
    announce(true)
    await flush()
    expect(h.client.init).toHaveBeenCalledTimes(1)
    expect(h.client.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false })
    expect(h.client.identify.mock.calls.map((c) => c[0])).toEqual(['user-1', 'user-1'])
    a.track('login_completed', { mfa: true })
    expect(h.client.capture).toHaveBeenCalledTimes(1)
  })

  it('AN17 (PH-RST-1) revocarea fără PostHog încărcat tot șterge urmele din browser', async () => {
    localStorage.setItem(OWNER, 'user-1')
    localStorage.setItem(CONSENT_OWNER, 'user-1')
    localStorage.setItem(`ph_${KEY}_posthog`, '{"$device_id":"D"}')
    localStorage.setItem(SDK_CONSENT, '0')
    sessionStorage.setItem(`ph_${KEY}_window_id`, 'w')
    localStorage.setItem('menuvia_active_restaurant', 'r1')
    a.installAnalyticsConsentListener()
    announce(false)
    await flush()
    expect(h.client.init).not.toHaveBeenCalled()
    for (const k of [OWNER, CONSENT_OWNER, `ph_${KEY}_posthog`]) {
      expect(localStorage.getItem(k), k).toBeNull()
    }
    expect(sessionStorage.getItem(`ph_${KEY}_window_id`)).toBeNull()
    // Refuzul (fără identificator) rămâne: o instanță vie dintr-un tab vecin îl
    // RECITEȘTE — șters de aici, acolo captura ar reporni.
    expect(localStorage.getItem(SDK_CONSENT)).toBe('0')
    expect(localStorage.getItem('menuvia_active_restaurant')).toBe('r1')
  })

  it('AN23 revocarea din alt tab (`storage`) oprește captura și aici, fără reset la ieșire', async () => {
    grantedEarlierBy('user-1')
    a.setAnalyticsUser('user-1')
    a.initAnalytics()
    await flush()
    localStorage.setItem(`ph_${KEY}_posthog`, '{"$device_id":"D"}')
    h.log.length = 0
    // O scriere oarecare în celălalt tab, cu acordul încă valabil: nimic.
    window.dispatchEvent(Object.assign(new Event('storage'), { key: 'menuvia_active_restaurant' }))
    window.dispatchEvent(Object.assign(new Event('storage'), { key: CONSENT_KEY }))
    expect(h.log).toEqual([])
    // Celălalt tab a debifat „Performanță” (consent-updated NU trece între tab-uri).
    setConsent(false)
    window.dispatchEvent(Object.assign(new Event('storage'), { key: CONSENT_KEY }))
    expect(h.log).toEqual(['reset', 'opt_out_capturing'])
    expect(resetArgs()).toEqual([true])
    expect(localStorage.getItem(`ph_${KEY}_posthog`)).toBeNull()
    // Ieșirea din cont, propagată de Supabase și în acest tab: fără un nou reset().
    h.log.length = 0
    a.setAnalyticsUser(null)
    a.setAnalyticsUser('user-2')
    a.track('login_completed', { mfa: false })
    expect(h.log).toEqual([])
    expect(h.client.capture).not.toHaveBeenCalled()
  })

  it('AN24 revocarea din alt tab fără `storage`: garda acordului o prinde la primul apel', async () => {
    // Fiecare cale care poate atinge SDK-ul, pe rând, într-o „pagină” nouă.
    const paths: ReadonlyArray<[string, () => void]> = [
      ['setAnalyticsUser', () => a.setAnalyticsUser('user-2')],
      ['track', () => a.track('login_completed', { mfa: false })],
      ['setAnalyticsContext', () =>
        a.setAnalyticsContext({ restaurant_id: 'r2', plan_tier: 2, staff_role: 'owner' })],
      ['markAnalyticsInternalUser', () => a.markAnalyticsInternalUser('user-1')],
    ]
    for (const [name, call] of paths) {
      a.resetAnalyticsForTests()
      localStorage.clear()
      for (const fn of Object.values(h.client)) fn.mockClear()
      a = await freshModule()
      grantedEarlierBy('user-1')
      a.setAnalyticsUser('user-1')
      a.initAnalytics()
      await flush()
      h.log.length = 0
      setConsent(false)
      call()
      // Revocare (reset + opt_out), NU un reset/identify/register/capture sub
      // acordul retras.
      expect(h.log, name).toEqual(['reset', 'opt_out_capturing'])
      expect(h.client.capture, name).not.toHaveBeenCalled()
      expect(h.client.setInternalOrTestUser, name).not.toHaveBeenCalled()
    }
  })
})

describe('analytics — trimiterea și contextul', () => {
  it('AN13 sendInstantly ajunge ca `send_instantly`; implicit nu', async () => {
    setConsent(true)
    a.setAnalyticsUser(null)
    a.initAnalytics()
    await flush()
    a.track('checkout_started', { plan: 'growth' }, { sendInstantly: true })
    a.track('order_placed')
    expect(h.client.capture.mock.calls[0]).toEqual([
      'checkout_started',
      { plan: 'growth' },
      { send_instantly: true },
    ])
    expect(h.client.capture.mock.calls[1]).toEqual(['order_placed', undefined, undefined])
  })

  it('AN20 (BV3) contextul panoului: înregistrat, scos la ieșire, repus după reset', async () => {
    const ctx = { restaurant_id: 'r1', plan_tier: 2, staff_role: 'owner' }
    // Setat ÎNAINTE de încărcare: intră în super-proprietățile de pornire.
    a.setAnalyticsContext(ctx)
    grantedEarlierBy('owner-1')
    a.setAnalyticsUser('owner-1')
    a.initAnalytics()
    await flush()
    expect(h.client.register).toHaveBeenCalledWith({
      app_env: 'production',
      site: 'ro',
      restaurant_id: 'r1',
      plan_tier: 2,
      staff_role: 'owner',
    })
    h.client.register.mockClear()
    a.setAnalyticsContext({ ...ctx })
    expect(h.client.register).not.toHaveBeenCalled()
    a.setAnalyticsContext({ ...ctx, plan_tier: 3 })
    expect(h.client.register).toHaveBeenCalledWith({ ...ctx, plan_tier: 3 })
    // Ieșirea din cont: reset(true) golește tot, contextul curent revine.
    h.client.register.mockClear()
    a.setAnalyticsUser(null)
    expect(h.client.register).toHaveBeenCalledWith({
      app_env: 'production',
      site: 'ro',
      ...ctx,
      plan_tier: 3,
    })
    a.setAnalyticsContext(null)
    expect(h.client.unregister.mock.calls.map((c) => c[0])).toEqual([
      'restaurant_id',
      'plan_tier',
      'staff_role',
    ])
  })

  it('AN21 (BV4) `utm_*` ai paginii de intrare, din memorie, la pornire', async () => {
    a.rememberEntryCampaign('?utm_source=menu&utm_medium=badge&ref=COD&utm_campaign=%20&x=1')
    // Navigarea din SPA a scos query-ul înainte de acord.
    setConsent(true)
    a.setAnalyticsUser(null)
    a.initAnalytics()
    await flush()
    expect(h.client.register).toHaveBeenCalledWith({ utm_source: 'menu', utm_medium: 'badge' })
    // Nimic în storage: instantaneul trăiește doar în memorie.
    const stored = Array.from({ length: localStorage.length }, (_, i) => {
      const k = localStorage.key(i) ?? ''
      return `${k}=${localStorage.getItem(k) ?? ''}`
    }).join('|')
    expect(stored).not.toContain('badge')
  })
})

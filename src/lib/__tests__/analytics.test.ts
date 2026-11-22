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
//         scos, `ip` readus (fără efect în 1.440), `request_batching` scos.
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
//   AN20 (BV3, CR-M5) contextul panoului: PER EVENIMENT, niciodată persistat în
//         SDK; cheile persistate de versiunea anterioară se scot la pornire, iar
//         o valoare restaurată de SDK nu ajunge pe eveniment. Fake-ul SDK-ului ține
//         persistența în localStorage, ca SDK-ul real (CR-m1). Mutațiile:
//         `register(context)` readus; ștergerea din before_send scoasă;
//         `unregister` de la pornire scos.
//   AN21 (BV4, CR-m3) `utm_*` ai paginii de intrare: pe evenimentele ACESTUI
//         document, doar identificatori, nimic în storage, absenți la intrarea
//         directă următoare. Mutația: `register(entryCampaign)` readus.
//   AN22 prefixele oaspeților sunt EXACT rutele `qr`/`menu`/`reserve` din App.tsx.
//   AN23 revocarea din ALT tab (evenimentul `storage`): captura se oprește și
//         aici, iar ieșirea din cont propagată după ea NU mai face reset() (care
//         ar șterge refuzul comun și ar reporni captura). Mutația: ascultătorul
//         `storage` scos.
//   AN24 aceeași revocare fără evenimentul `storage` (ratat): verificarea
//         acordului dinaintea oricărui apel care poate face reset() o prinde.
//         Mutația: garda scoasă din setAnalyticsUser.
//   AN25 (CR-M3, R7) câmpurile pe care SDK-ul le DERIVĂ dintr-o pagină de oaspete
//         (`$prev_pageview_*`, `$session_entry_*`, `$initial_*` și copia FĂRĂ
//         prefix a intrării în sesiune din `$set_once` — forma reală din 1.440)
//         se scot; între pagini eligibile rămân. Mutațiile: `dropGuestDerived`
//         scos; `dropGuestSessionEntrySetOnce` scos.
//   AN26 (CR-M4, R2) campania: doar identificatori, și în proprietățile SDK-ului
//         (`$session_entry_utm_*`, `$set_once.$initial_utm_*`), și în URL-uri; un
//         telefon e respins și scris cu `.`/`-`/`_` între cifre. Mutațiile:
//         allowlist-ul pe chei scos; curățarea URL-urilor scoasă; numărarea
//         cifrelor fără separatori (`\d{9,}` pe valoarea brută).
//   AN27 (CR-M6) coada păstrează contextul de la emitere și aruncă ce s-a emis
//         sub alt cont. Mutațiile: contextul de la golire; filtrul pe cont scos.
//   AN28 (CR-M7) după retragere nu mai pleacă nimic din SDK: fără loturi și
//         before_send închis cât modulul nu capturează. Mutația: garda scoasă.
//   AN29 (CR-M8) retragere + reacordare în alt tab (generație nouă a acordului):
//         evenimentele SDK-ului se opresc, reset(true) înaintea evenimentului
//         următor; o re-salvare în ACEST tab nu resetează. Mutațiile: verificarea
//         generației scoasă (din before_send / din garda de acord / din
//         `storage`); generația neadoptată la re-salvare.
//   AN30 (MY-3) acordul dat în alt tab pornește/reia captura aici (prin
//         `storage` sau, ratat, la primul track). Mutațiile: `storage` doar
//         pentru retragere; track() fără reluare.
//   AN31 (MY-5) retragerea scoate SDK-ul din captură ori de câte ori instanța
//         trăiește. Mutația: opt-out doar cu `capturing`.
//   AN32 (MY-4) un cont logat care NU e al acordului nu e capturat deloc, nici
//         anonim. Mutațiile: garda de cont scoasă din before_send / din send.
//   AN33 (CR-m2) pornirea sărită pe o pagină de oaspete se reîncearcă la
//         schimbarea rutei, fără campania linkului meniului. Mutațiile:
//         ascultătorul de rută scos; campania reținută și pe intrarea de oaspete.
//   AN34 (CR-m4) `sendInstantly` cu PostHog neîncărcat: predat documentului
//         următor din același tab, trimis o singură dată, cu momentul real.
//         Mutațiile: fără predare; predarea necitită o singură dată.
//   AN35 (CR-m4) predarea e legată de cont, de acord și de vârstă (24 h); în
//         același document nu se dublează. Mutațiile: fiecare verificare scoasă.
//   AN36 (R3) marcajul redirectului spre Stripe (`noteCheckoutRedirect` /
//         `takeCheckoutRedirect`): scris DOAR cu acord (servește doar statisticii),
//         șters la retragere (`ph_`), plan, cont, 24 h, citit o singură dată,
//         storage care aruncă = false. Mutațiile: garda de acord scoasă; cheia
//         fără `ph_`; fiecare verificare scoasă.
//   AN37 (R1) o proveniență (`$referrer`, `$session_entry_referrer`,
//         `$initial_referrer` + domeniile lor, și în `$set_once`) de pe o pagină de
//         oaspete devine `$direct`; una externă rămâne octet cu octet. Mutația:
//         înlocuirea scoasă.
//   AN38 (R4) `getSession` eșuat: ce se emite DUPĂ semnal intră în coadă ca
//         „nimeni logat” și nu e preluat de contul care intră apoi; ce s-a emis
//         înainte și ce se emite după autentificare pleacă. Mutația: fără marcaj.
//   AN39 (R6) acordul dat fără cont + înregistrare fără sesiune (confirmarea
//         emailului pornită): contul NOU îl preia și în documentul deschis din
//         link; fără efect pe un acord deja legat sau deja preluat. Mutația:
//         `bindPendingConsentToAccount` gol (preluarea doar în memorie).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTE_CHANGE_EVENT } from '../routeEvents'

type AnalyticsModule = typeof import('../analytics')

/** Evenimentul așa cum ar pleca spre rețea (după before_send). */
interface SentEvent {
  uuid: string
  event: string
  properties: Record<string, unknown>
  $set?: Record<string, unknown>
  $set_once?: Record<string, unknown>
}

interface FakeConfig {
  loaded?: (c: unknown) => void
  before_send?: (r: SentEvent) => SentEvent | null
}

const h = vi.hoisted(() => {
  const log: string[] = []
  const rec =
    (name: string) =>
    (...args: unknown[]): void => {
      log.push(name)
      void args
    }
  // Persistența SDK-ului real (`ph_<cheie>_posthog` în localStorage): register /
  // unregister / reset o scriu, iar capture îmbină super-proprietățile în
  // eveniment și îl trece prin before_send-ul configurat (CR-m1). Fără ea, un
  // `register` persistent arăta în teste la fel ca o proprietate per eveniment.
  const PERSIST = 'ph_phc_test_only_not_a_real_key_posthog'
  const readPersist = (): Record<string, unknown> => {
    const raw = localStorage.getItem(PERSIST)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  }
  const state = {
    log,
    rec,
    PERSIST,
    factoryCalls: 0,
    sdkConsentAtInit: 'unset' as string | null,
    cfg: null as FakeConfig | null,
    sent: [] as SentEvent[],
    fakeCapture: (event: string, props?: Record<string, unknown> | null): void => {
      log.push('capture')
      const result: SentEvent = {
        uuid: 'evt',
        event,
        properties: {
          $pathname: window.location.pathname,
          $current_url: window.location.href,
          ...readPersist(),
          ...(props ?? {}),
        },
      }
      const out = state.cfg?.before_send ? state.cfg.before_send(result) : result
      if (out) state.sent.push(out)
    },
    fakeRegister: (props: Record<string, unknown>): void => {
      log.push('register')
      localStorage.setItem(PERSIST, JSON.stringify({ ...readPersist(), ...props }))
    },
    fakeUnregister: (key: string): void => {
      log.push('unregister')
      const next = readPersist()
      delete next[key]
      localStorage.setItem(PERSIST, JSON.stringify(next))
    },
    fakeReset: (...args: unknown[]): void => {
      log.push('reset')
      void args
      localStorage.removeItem(PERSIST)
    },
  }
  const client = {
    init: vi.fn(),
    capture: vi.fn(state.fakeCapture),
    identify: vi.fn(rec('identify')),
    reset: vi.fn(state.fakeReset),
    register: vi.fn(state.fakeRegister),
    unregister: vi.fn(state.fakeUnregister),
    opt_in_capturing: vi.fn(rec('opt_in_capturing')),
    opt_out_capturing: vi.fn(rec('opt_out_capturing')),
    has_opted_out_capturing: vi.fn(() => false),
    setInternalOrTestUser: vi.fn(rec('setInternalOrTestUser')),
  }
  return Object.assign(state, { client })
})

const KEY = 'phc_test_only_not_a_real_key'
const CONSENT_KEY = 'menuvia_cookie_consent'
const OWNER = 'ph_menuvia_identity_owner'
const CONSENT_OWNER = 'ph_menuvia_consent_uid'
const SDK_CONSENT = 'ph_menuvia_consent'
const HANDOFF = 'ph_menuvia_handoff'
const REDIRECT = 'ph_menuvia_checkout_redirect'
const LEGACY_KEYS = [
  'restaurant_id',
  'plan_tier',
  'staff_role',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
]

/** Înregistrarea bannerului; `timestamp` diferit = altă salvare (altă generație). */
function setConsent(performance: boolean, timestamp = 1): void {
  localStorage.setItem(
    CONSENT_KEY,
    JSON.stringify({ necessary: true, performance, functional: false, timestamp }),
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

/** O scriere în localStorage făcută de ALT tab (singurul semnal: `storage`). */
function otherTabStorage(key: string = CONSENT_KEY): void {
  window.dispatchEvent(Object.assign(new Event('storage'), { key }))
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

type BeforeSendInput = Parameters<AnalyticsModule['minimizeCaptureResult']>[0]

/** Un eveniment generat de SDK (page view, page leave…), de dat lui before_send. */
function ev(
  event: string,
  properties: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): BeforeSendInput {
  return { uuid: 'x', event, properties, ...extra } as BeforeSendInput
}

function lastSent(): SentEvent {
  const e = h.sent[h.sent.length - 1]
  expect(e).toBeDefined()
  return e as SentEvent
}

/** Tot conținutul ambelor storage-uri, ca text (chei și valori). */
function allStorage(): string {
  const dump = (s: Storage): string =>
    Array.from({ length: s.length }, (_, i) => {
      const k = s.key(i) ?? ''
      return `${k}=${s.getItem(k) ?? ''}`
    }).join('|')
  return `${dump(localStorage)}||${dump(sessionStorage)}`
}

/** Captură pornită fără cont logat (vizitatorul cu acord dat). */
async function startAnonymousCapture(): Promise<void> {
  setConsent(true)
  a.setAnalyticsUser(null)
  a.initAnalytics()
  await flush()
}

/** O pagină nouă în ACELAȘI tab (sessionStorage și localStorage rămân). */
async function nextDocument(): Promise<void> {
  a.resetAnalyticsForTests()
  a = await freshModule()
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
  request_batching: false,
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
  h.cfg = null
  h.sent.length = 0
  for (const fn of Object.values(h.client)) fn.mockClear()
  // Implementările suprascrise de un test (AN9, AN16, AN30, AN31) revin la cele
  // implicite; fake-urile SDK-ului se repun explicit.
  h.client.has_opted_out_capturing.mockImplementation(() => false)
  h.client.opt_in_capturing.mockImplementation(h.rec('opt_in_capturing'))
  h.client.capture.mockImplementation(h.fakeCapture)
  h.client.register.mockImplementation(h.fakeRegister)
  h.client.unregister.mockImplementation(h.fakeUnregister)
  h.client.reset.mockImplementation(h.fakeReset)
  // Ca SDK-ul real: `loaded` rulează sincron, în interiorul lui init().
  h.client.init.mockImplementation((_key: string, cfg: FakeConfig) => {
    h.log.push('init')
    h.sdkConsentAtInit = localStorage.getItem(SDK_CONSENT)
    h.cfg = cfg
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

  it('AN4 before_send: token-uri redactate, fără GeoIP, nimic de pe paginile oaspeților', async () => {
    // before_send lasă să treacă doar captura PORNITĂ de modul (AN28).
    await startAnonymousCapture()
    const send = a.minimizeCaptureResult
    expect(send(null)).toBeNull()
    const pv = (properties: Record<string, unknown>) => ev('$pageview', properties)
    const out = send(
      pv({
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
      expect(send(pv({ $pathname: path })), path).toBeNull()
    }
    expect(send(pv({ $current_url: 'https://site.test/m/pizzeria?lang=en' }))).toBeNull()
    // Rutele care doar SEAMĂNĂ rămân.
    for (const path of ['/m', '/mapa', '/rezervari', '/dashboard', '/']) {
      expect(send(pv({ $pathname: path })), path).not.toBeNull()
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

  it('AN20 (BV3, CR-M5) contextul panoului: per eveniment, nepersistat; cheile vechi se scot', async () => {
    // Ce persistase versiunea anterioară (`register`): localul și planul de ATUNCI.
    localStorage.setItem(
      h.PERSIST,
      JSON.stringify({ restaurant_id: 'rest-old', plan_tier: 1, staff_role: 'waiter', utm_source: 'oldcamp' }),
    )
    const ctx = { restaurant_id: 'rest-ctx-1', plan_tier: 2, staff_role: 'owner' }
    // Setat ÎNAINTE de încărcare: ajunge și pe primele evenimente.
    a.setAnalyticsContext(ctx)
    grantedEarlierBy('owner-1')
    a.setAnalyticsUser('owner-1')
    a.initAnalytics()
    await flush()
    expect(h.client.unregister.mock.calls.map((c) => c[0])).toEqual(LEGACY_KEYS)
    expect(localStorage.getItem(h.PERSIST) ?? '').not.toContain('rest-old')
    expect(localStorage.getItem(h.PERSIST) ?? '').not.toContain('oldcamp')
    a.track('dashboard_tab_viewed', { tab: 'home' })
    let p = lastSent().properties
    expect(p.restaurant_id).toBe('rest-ctx-1')
    expect(p.plan_tier).toBe(2)
    expect(p.staff_role).toBe('owner')
    expect(p.tab).toBe('home')
    a.setAnalyticsContext({ ...ctx, plan_tier: 3 })
    a.track('dashboard_tab_viewed', { tab: 'menu' })
    expect(lastSent().properties.plan_tier).toBe(3)
    // Un `restaurant_id` dat EXPLICIT de apelant (tura, comanda) bate contextul.
    a.track('shift_opened', { restaurant_id: 'rest-own' })
    expect(lastSent().properties.restaurant_id).toBe('rest-own')
    expect(lastSent().properties.plan_tier).toBe(3)
    // O valoare restaurată de SDK din persistență nu bate contextul paginii…
    localStorage.setItem(h.PERSIST, JSON.stringify({ restaurant_id: 'rest-stale', plan_tier: 1 }))
    a.track('dashboard_tab_viewed', { tab: 'orders' })
    expect(lastSent().properties.restaurant_id).toBe('rest-ctx-1')
    // …și nu apare după ieșirea din panou.
    a.setAnalyticsContext(null)
    a.track('dashboard_tab_viewed', { tab: 'orders' })
    p = lastSent().properties
    for (const k of ['restaurant_id', 'plan_tier', 'staff_role']) expect(k in p, k).toBe(false)
    // Fără panou (ospătarul, bucătăria): cel explicit rămâne.
    a.track('order_placed', { restaurant_id: 'rest-own', item_count: 2 })
    expect(lastSent().properties.restaurant_id).toBe('rest-own')
    // Contextul n-a intrat niciodată în SDK, nici în storage.
    expect(JSON.stringify(h.client.register.mock.calls)).not.toContain('rest-ctx-1')
    expect(allStorage()).not.toContain('rest-ctx-1')
    // Încărcare nouă fără panou (/pricing): fără localul de data trecută.
    await nextDocument()
    window.history.pushState({}, '', '/pricing')
    a.setAnalyticsUser('owner-1')
    a.initAnalytics()
    await flush()
    a.track('plan_upsell_viewed', { target: 'payments' })
    expect('restaurant_id' in lastSent().properties).toBe(false)
  })

  it('AN21 (BV4, CR-m3) campania paginii de intrare: pe documentul ei, nepersistată, doar identificatori', async () => {
    a.rememberEntryCampaign(
      '?utm_source=FbAds&utm_medium=badge&utm_content=ion.pop%40mail.ro&utm_term=ion%20pop&utm_campaign=%20&ref=COD&x=1',
    )
    // Navigarea din SPA a scos query-ul înainte de acord.
    await startAnonymousCapture()
    a.track('plan_upsell_viewed', { target: 'payments' })
    const p = lastSent().properties
    expect(p.utm_source).toBe('fbads')
    expect(p.utm_medium).toBe('badge')
    for (const k of ['utm_content', 'utm_term', 'utm_campaign']) expect(k in p, k).toBe(false)
    expect(JSON.stringify(h.sent)).not.toContain('mail.ro')
    // Nimic în SDK și nimic în storage: instantaneul trăiește doar în memorie.
    expect(JSON.stringify(h.client.register.mock.calls)).not.toContain('badge')
    expect(allStorage()).not.toContain('badge')
    // Intrarea DIRECTĂ următoare (fără utm): fără campania veche.
    await nextDocument()
    a.rememberEntryCampaign('')
    a.setAnalyticsUser(null)
    a.initAnalytics()
    await flush()
    a.track('plan_upsell_viewed', { target: 'payments' })
    expect('utm_source' in lastSent().properties).toBe(false)
    expect('utm_medium' in lastSent().properties).toBe(false)
  })
})

describe('analytics — câmpurile derivate și campania (before_send)', () => {
  it('AN25 (CR-M3) câmpurile derivate dintr-o pagină de oaspete nu ajung pe evenimentele panoului', async () => {
    await startAnonymousCapture()
    const send = a.minimizeCaptureResult
    // Page view-ul de după meniul /m/ (al cărui page view a fost aruncat): SDK-ul
    // își notase totuși pagina, durata și derularea ei.
    const out = send(
      ev(
        '$pageview',
        {
          $pathname: '/dashboard',
          $current_url: 'https://site.test/dashboard',
          $pageview_id: 'p3',
          $prev_pageview_id: 'p2',
          $prev_pageview_pathname: '/m/pizzeria',
          $prev_pageview_duration: 41,
          $prev_pageview_max_scroll: 900,
          $prev_pageview_max_scroll_percentage: 0.8,
          $session_entry_url: 'https://site.test/q/TOKEN',
          $session_entry_pathname: '/q/TOKEN',
          $session_entry_referrer: 'https://social.example.test/',
        },
        {
          // Forma REALĂ din posthog-js 1.440 (`_calculate_set_once_properties`):
          // prima vizită cu prefix + intrarea în sesiune FĂRĂ prefix, deci
          // `$set_once.$pathname` e chiar `$session_entry_pathname` (R7).
          $set_once: {
            $initial_pathname: '/rezervare/pizzeria',
            $initial_current_url: 'https://site.test/rezervare/pizzeria',
            $initial_referrer: '$direct',
            $current_url: 'https://site.test/q/TOKEN',
            $host: 'site.test',
            $pathname: '/q/TOKEN',
            $referrer: 'https://social.example.test/',
            $referring_domain: 'social.example.test',
            utm_source: 'fb',
            gclid: 'click-1',
          },
        },
      ),
    )
    expect(out).not.toBeNull()
    const p = out?.properties ?? {}
    const derived = Object.keys(p).filter(
      (k) => k.startsWith('$prev_pageview_') || k.startsWith('$session_entry_'),
    )
    expect(derived).toEqual([])
    expect(p.$pageview_id).toBe('p3')
    // Mutația care pică: copia fără prefix a intrării în sesiune lăsată în
    // `$set_once` (ancorele vechi vedeau doar grupurile cu prefix).
    expect(Object.keys(out?.$set_once ?? {})).toEqual([])
    expect(JSON.stringify(out)).not.toContain('/q/')
    // Control pozitiv: între pagini ELIGIBILE câmpurile rămân.
    const ok = send(
      ev(
        '$pageview',
        {
          $pathname: '/dashboard',
          $prev_pageview_id: 'p1',
          $prev_pageview_pathname: '/pricing',
          $prev_pageview_duration: 12,
          $session_entry_url: 'https://site.test/pricing',
          $session_entry_pathname: '/pricing',
        },
        {
          $set_once: {
            $initial_pathname: '/',
            $initial_current_url: 'https://site.test/',
            $current_url: 'https://site.test/pricing',
            $pathname: '/pricing',
          },
        },
      ),
    )
    expect(ok?.properties.$prev_pageview_pathname).toBe('/pricing')
    expect(ok?.properties.$prev_pageview_duration).toBe(12)
    expect(ok?.properties.$session_entry_pathname).toBe('/pricing')
    expect(ok?.$set_once?.$initial_pathname).toBe('/')
    expect(ok?.$set_once?.$pathname).toBe('/pricing')
    expect(ok?.$set_once?.$current_url).toBe('https://site.test/pricing')
  })

  it('AN37 (R1) proveniența de pe o pagină de oaspete devine `$direct`, oriunde ar fi reținută', async () => {
    await startAnonymousCapture()
    // „Powered by Menuvia” de pe rezervare → `/`: aceeași origine, deci browserul
    // trimite adresa întreagă, iar SDK-ul o reține pe tab, pe sesiune și pe prima vizită.
    const guest = 'https://site.test/rezervare/pizzeria?cancel=X'
    const out = a.minimizeCaptureResult(
      ev(
        '$pageview',
        {
          $pathname: '/',
          $current_url: 'https://site.test/',
          $referrer: guest,
          $referring_domain: 'site.test',
          $session_entry_url: 'https://site.test/',
          $session_entry_pathname: '/',
          $session_entry_referrer: guest,
          $session_entry_referring_domain: 'site.test',
        },
        {
          $set_once: {
            $initial_current_url: 'https://site.test/',
            $initial_pathname: '/',
            $initial_referrer: guest,
            $initial_referring_domain: 'site.test',
            $current_url: 'https://site.test/',
            $pathname: '/',
            $referrer: guest,
            $referring_domain: 'site.test',
          },
        },
      ),
    )
    expect(out).not.toBeNull()
    const p = out?.properties ?? {}
    const so = out?.$set_once ?? {}
    // Mutația care pică: fără înlocuirea provenienței (ancorele de pagină sunt
    // toate eligibile, deci nimic altceva nu atinge câmpurile).
    for (const k of [
      '$referrer',
      '$referring_domain',
      '$session_entry_referrer',
      '$session_entry_referring_domain',
    ]) {
      expect(p[k], k).toBe('$direct')
    }
    for (const k of [
      '$initial_referrer',
      '$initial_referring_domain',
      '$referrer',
      '$referring_domain',
    ]) {
      expect(so[k], k).toBe('$direct')
    }
    expect(JSON.stringify(out)).not.toContain('rezervare')
    // Restul paginii eligibile rămâne.
    expect(p.$session_entry_pathname).toBe('/')
    expect(so.$pathname).toBe('/')
    // Control pozitiv: o proveniență EXTERNĂ rămâne octet cu octet.
    const ext = a.minimizeCaptureResult(
      ev(
        '$pageview',
        {
          $pathname: '/',
          $referrer: 'https://social.example.test/post?id=1',
          $referring_domain: 'social.example.test',
        },
        {
          $set_once: {
            $initial_referrer: 'https://social.example.test/post?id=1',
            $initial_referring_domain: 'social.example.test',
          },
        },
      ),
    )
    expect(ext?.properties.$referrer).toBe('https://social.example.test/post?id=1')
    expect(ext?.properties.$referring_domain).toBe('social.example.test')
    expect(ext?.$set_once?.$initial_referrer).toBe('https://social.example.test/post?id=1')
    expect(ext?.$set_once?.$initial_referring_domain).toBe('social.example.test')
  })

  it('AN26 (CR-M4) campania: doar identificatori, în proprietățile SDK-ului și în URL-uri', async () => {
    await startAnonymousCapture()
    const out = a.minimizeCaptureResult(
      ev(
        '$pageview',
        {
          $pathname: '/pricing',
          $current_url:
            'https://site.test/pricing?utm_source=fb&utm_content=ion.pop%40mail.ro&plan=growth&utm_term=ion+pop',
          $referrer: 'https://l.example.test/out?utm_campaign=0722123456',
          // Ce înregistrează SDK-ul singur din URL (pe sesiune).
          utm_source: 'fb',
          utm_content: 'ion.pop@mail.ro',
          $session_entry_utm_source: 'News_2026',
          $session_entry_utm_content: 'ion.pop@mail.ro',
          $session_entry_url: 'https://site.test/pricing?utm_content=ion.pop%40mail.ro',
        },
        {
          $set_once: {
            $initial_utm_source: 'fb',
            $initial_utm_content: 'ion.pop@mail.ro',
            $initial_utm_medium: null,
            $initial_current_url: 'https://site.test/?utm_content=ion.pop%40mail.ro',
          },
        },
      ),
    )
    expect(out).not.toBeNull()
    const p = out?.properties ?? {}
    expect(p.$current_url).toBe('https://site.test/pricing?utm_source=fb&plan=growth')
    expect(p.$referrer).toBe('https://l.example.test/out')
    expect(p.$session_entry_utm_source).toBe('news_2026')
    expect('$session_entry_utm_content' in p).toBe(false)
    expect(p.$session_entry_url).toBe('https://site.test/pricing')
    // `utm_*` simple = campania DOCUMENTULUI (aici: niciuna), nu cele ținute de SDK.
    expect('utm_source' in p).toBe(false)
    expect('utm_content' in p).toBe(false)
    const so = out?.$set_once ?? {}
    expect(so.$initial_utm_source).toBe('fb')
    expect('$initial_utm_content' in so).toBe(false)
    expect(so.$initial_utm_medium).toBeNull()
    expect(so.$initial_current_url).toBe('https://site.test/')
    const all = JSON.stringify(out)
    for (const bad of ['mail.ro', '%40', '0722123456', 'ion+pop']) expect(all, bad).not.toContain(bad)
    // Regula, pe cazurile-limită: aruncat, nu trunchiat.
    expect(a.normalizeCampaignValue('  Spring_2026.ro ')).toBe('spring_2026.ro')
    expect(a.normalizeCampaignValue('a'.repeat(64))).toBe('a'.repeat(64))
    expect(a.normalizeCampaignValue('20261122')).toBe('20261122')
    for (const bad of ['ion@x.ro', 'ion pop', '0722123456', 'a'.repeat(65), '', '-x', 'x/y', 5, null]) {
      expect(a.normalizeCampaignValue(bad), String(bad)).toBeNull()
    }
    // (R2) Telefonul scris cu separatori între cifre e tot un telefon. Mutația
    // care pică: `\d{9,}` pe valoarea brută (cea mai lungă secvență aici: 4 cifre).
    for (const phone of ['0722-123-456', '0722.123.456', '40-722-123-456', '0722_123_456']) {
      expect(a.normalizeCampaignValue(phone), phone).toBeNull()
    }
    // Control pozitiv: o dată și un identificator cu an trec în continuare.
    expect(a.normalizeCampaignValue('2026-11-22')).toBe('2026-11-22')
    expect(a.normalizeCampaignValue('spring_2026')).toBe('spring_2026')
    // Și în URL: parametrul cu telefon se scoate, restul rămâne.
    const url = a.minimizeCaptureResult(
      ev('$pageview', {
        $pathname: '/pricing',
        $current_url: 'https://site.test/pricing?utm_content=0722-123-456&plan=growth',
      }),
    )
    expect(url?.properties.$current_url).toBe('https://site.test/pricing?plan=growth')
    // Numele parametrului CODIFICAT (`%75%74%6d` = `utm`): decis pe numele decodat,
    // nu pe textul literal. Mutația care pică: pre-verificarea `/utm/i` înaintea decodării.
    const encoded = a.minimizeCaptureResult(
      ev('$pageview', {
        $pathname: '/pricing',
        $current_url: 'https://site.test/pricing?%75%74%6d_content=ion.pop%40mail.ro&plan=growth',
      }),
    )
    expect(encoded?.properties.$current_url).toBe('https://site.test/pricing?plan=growth')
  })
})

describe('analytics — coada, retragerea și celelalte tab-uri', () => {
  it('AN27 (CR-M6) coada: contextul și contul de la EMITERE', async () => {
    const ctxA = { restaurant_id: 'rest-a', plan_tier: 2, staff_role: 'owner' }
    const ctxB = { restaurant_id: 'rest-b', plan_tier: 3, staff_role: 'manager' }
    grantedEarlierBy('u1')
    a.setAnalyticsUser('u1')
    a.setAnalyticsContext(ctxA)
    // PostHog încă neîncărcat: evenimentul așteaptă; între timp localul se schimbă.
    a.track('dashboard_tab_viewed', { tab: 'orders' })
    a.setAnalyticsContext(ctxB)
    a.initAnalytics()
    await flush()
    expect(h.sent.map((e) => e.event)).toEqual(['dashboard_tab_viewed'])
    expect(h.sent[0]?.properties.restaurant_id).toBe('rest-a')
    expect(h.sent[0]?.properties.plan_tier).toBe(2)
    // Evenimentele de după golire poartă contextul de ACUM.
    a.track('dashboard_tab_viewed', { tab: 'menu' })
    expect(lastSent().properties.restaurant_id).toBe('rest-b')

    // Contul se schimbă înaintea golirii: evenimentele contului vechi nu pleacă
    // sub cel nou (nici dacă noul cont își are propriul acord) și nici nu țin
    // ocupată coada (plafon 20), în care evenimentul noului cont n-ar mai încăpea.
    a.resetAnalyticsForTests()
    localStorage.clear()
    for (const fn of Object.values(h.client)) fn.mockClear()
    a = await freshModule()
    grantedEarlierBy('u1')
    a.setAnalyticsUser('u1')
    for (let i = 0; i < 20; i++) a.track('dashboard_tab_viewed', { tab: 'orders' })
    localStorage.setItem(CONSENT_OWNER, 'u2')
    a.setAnalyticsUser('u2')
    a.track('login_completed', { mfa: false })
    a.initAnalytics()
    await flush()
    // Control pozitiv: evenimentul contului nou pleacă.
    expect(h.client.capture.mock.calls.map((c) => c[0])).toEqual(['login_completed'])
  })

  it('AN28 (CR-M7) după retragere nu mai pleacă nimic din SDK', async () => {
    await startAnonymousCapture()
    // Fără loturi: niciun eveniment capturat înainte nu mai așteaptă în SDK.
    expect(initConfig().request_batching).toBe(false)
    const pageview = () => a.minimizeCaptureResult(ev('$pageview', { $pathname: '/pricing' }))
    expect(pageview()).not.toBeNull()
    announce(false)
    // Un eveniment generat de SDK după retragere (oricare ar fi starea lui).
    expect(pageview()).toBeNull()
    // Și înaintea oricărei porniri.
    await nextDocument()
    expect(a.minimizeCaptureResult(ev('$pageview', { $pathname: '/pricing' }))).toBeNull()
  })

  it('AN29 (CR-M8) retragere + reacordare în alt tab: identitate SDK nouă înainte de evenimentul următor', async () => {
    grantedEarlierBy('user-1')
    a.setAnalyticsUser('user-1')
    a.initAnalytics()
    await flush()
    h.log.length = 0
    h.client.reset.mockClear()
    h.client.identify.mockClear()
    // Celălalt tab a debifat și a bifat din nou; notificările n-au ajuns aici.
    setConsent(true, 50)
    // Evenimentele proprii ale SDK-ului (page view la navigare) nu pleacă pe
    // identitatea de dinainte (control pozitiv: AN4 — aceeași cale trece).
    expect(a.minimizeCaptureResult(ev('$pageview', { $pathname: '/dashboard' }))).toBeNull()
    a.track('login_completed', { mfa: false })
    expect(resetArgs()).toEqual([true])
    expect(h.log.indexOf('reset')).toBeGreaterThan(-1)
    expect(h.log.indexOf('reset')).toBeLessThan(h.log.indexOf('capture'))
    // Contul acordului, re-identificat pe identitatea nouă.
    expect(h.client.identify.mock.calls).toEqual([['user-1']])
    expect(h.client.capture).toHaveBeenCalledTimes(1)
    // Generația nouă e adoptată: evenimentul următor nu mai resetează, iar
    // evenimentele SDK-ului pleacă din nou.
    a.track('login_completed', { mfa: true })
    expect(h.client.reset).toHaveBeenCalledTimes(1)
    expect(a.minimizeCaptureResult(ev('$pageview', { $pathname: '/dashboard' }))).not.toBeNull()
    // Și când ajunge evenimentul `storage` al unei noi reacordări.
    setConsent(true, 51)
    otherTabStorage()
    expect(h.client.reset).toHaveBeenCalledTimes(2)
    // Controale: o scriere fără schimbarea acordului și o re-salvare în ACEST tab
    // nu resetează.
    otherTabStorage('menuvia_active_restaurant')
    announce(true)
    a.track('login_completed', { mfa: false })
    expect(h.client.reset).toHaveBeenCalledTimes(2)
  })

  it('AN30 (MY-3) acordul dat în ALT tab pornește (sau reia) captura aici', async () => {
    // (a) PostHog neîncărcat: pornește la evenimentul `storage`.
    a.setAnalyticsUser(null)
    a.initAnalytics()
    await flush()
    expect(h.client.init).not.toHaveBeenCalled()
    setConsent(true)
    otherTabStorage()
    await flush()
    expect(h.client.init).toHaveBeenCalledTimes(1)
    // (b) captura oprită aici, reacordată în celălalt tab.
    announce(false)
    h.client.has_opted_out_capturing.mockImplementation(() => true)
    setConsent(true, 7)
    otherTabStorage()
    expect(h.client.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false })
    a.track('login_completed', { mfa: false })
    expect(h.client.capture).toHaveBeenCalledTimes(1)
    // (c) `storage` ratat: primul track() o reia, nu umple o coadă moartă.
    announce(false)
    h.client.capture.mockClear()
    h.client.opt_in_capturing.mockClear()
    setConsent(true, 8)
    a.track('login_completed', { mfa: true })
    expect(h.client.opt_in_capturing).toHaveBeenCalledTimes(1)
    expect(h.client.capture).toHaveBeenCalledTimes(1)
  })

  it('AN31 (MY-5) retragerea scoate SDK-ul din captură ori de câte ori instanța trăiește', async () => {
    await startAnonymousCapture()
    announce(false)
    expect(h.client.opt_out_capturing).toHaveBeenCalledTimes(1)
    // Alt tab a pornit PostHog cu un acord nou și a șters refuzul comun: SDK-ul
    // de aici citește „în așteptare” = captură, deși modulul nu mai capturează.
    h.client.has_opted_out_capturing.mockImplementation(() => false)
    h.log.length = 0
    announce(false)
    expect(h.log).toEqual(['reset', 'opt_out_capturing'])
    // Control: cu refuzul încă în loc, o nouă retragere nu mai atinge SDK-ul.
    h.client.has_opted_out_capturing.mockImplementation(() => true)
    h.log.length = 0
    announce(false)
    expect(h.log).toEqual([])
  })

  it('AN32 (MY-4) un cont logat care NU e al acordului nu e capturat deloc, nici anonim', async () => {
    grantedEarlierBy('owner-1')
    a.setAnalyticsUser('colleague')
    a.track('login_completed', { mfa: false })
    a.initAnalytics()
    await flush()
    expect(h.client.init).toHaveBeenCalledTimes(1)
    expect(h.client.identify).not.toHaveBeenCalled()
    a.track('dashboard_tab_viewed', { tab: 'home' })
    expect(h.client.capture).not.toHaveBeenCalled()
    // Nici evenimentele SDK-ului (page view, page leave).
    expect(a.minimizeCaptureResult(ev('$pageview', { $pathname: '/dashboard' }))).toBeNull()
    // Control pozitiv: contul acordului revine → capturat și identificat.
    a.setAnalyticsUser('owner-1')
    a.track('dashboard_tab_viewed', { tab: 'home' })
    expect(h.client.capture).toHaveBeenCalledTimes(1)
    expect(h.client.identify.mock.calls).toEqual([['owner-1']])
    expect(a.minimizeCaptureResult(ev('$pageview', { $pathname: '/dashboard' }))).not.toBeNull()
    // Fără cont logat (vizitatorul de pe /pricing): ajunge acordul browserului.
    a.setAnalyticsUser(null)
    expect(a.minimizeCaptureResult(ev('$pageview', { $pathname: '/pricing' }))).not.toBeNull()
  })

  it('AN33 (CR-m2) pornirea sărită pe o pagină de oaspete se reîncearcă la schimbarea rutei', async () => {
    window.history.pushState({}, '', '/m/pizzeria')
    // Campania linkului meniului nu e reținută (control pozitiv: AN21).
    a.rememberEntryCampaign('?utm_source=qrcamp&utm_medium=table')
    await startAnonymousCapture()
    expect(h.factoryCalls).toBe(0)
    // Altă pagină de oaspete: tot nimic.
    window.history.pushState({}, '', '/q/TOKEN')
    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT))
    await flush()
    expect(h.factoryCalls).toBe(0)
    // Control: navigarea fără anunț nu pornește nimic.
    window.history.pushState({}, '', '/pricing')
    await flush()
    expect(h.factoryCalls).toBe(0)
    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT))
    await flush()
    expect(h.client.init).toHaveBeenCalledTimes(1)
    a.track('plan_upsell_viewed', { target: 'payments' })
    expect(lastSent().properties.$pathname).toBe('/pricing')
    expect('utm_source' in lastSent().properties).toBe(false)
    expect('utm_medium' in lastSent().properties).toBe(false)
  })
})

describe('analytics — redirectul spre Stripe', () => {
  function checkoutCalls(name = 'checkout_started'): unknown[][] {
    return h.client.capture.mock.calls.filter((c) => c[0] === name) as unknown[][]
  }

  it('AN34 (CR-m4) evenimentul de dinaintea redirectului, cu PostHog neîncărcat, pleacă din documentul următor', async () => {
    grantedEarlierBy('u1')
    a.setAnalyticsUser('u1')
    // Client „rece”: idle-ul n-a venit, PostHog nu e încărcat.
    a.track('checkout_started', { plan: 'growth' }, { sendInstantly: true })
    expect(h.client.capture).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(HANDOFF)).not.toBeNull()
    // Redirectul: pagina pleacă (coada din memorie moare); întoarcerea din
    // Stripe e un document NOU în același tab.
    await nextDocument()
    const before = Date.now()
    a.setAnalyticsUser('u1')
    a.initAnalytics()
    await flush()
    const calls = checkoutCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[1]).toEqual({ plan: 'growth' })
    const opts = calls[0]?.[2] as { send_instantly?: boolean; timestamp?: unknown } | undefined
    expect(opts?.send_instantly).toBe(true)
    // Momentul REAL al emiterii (din documentul anterior), nu al trimiterii.
    const at = opts?.timestamp
    expect(at instanceof Date).toBe(true)
    expect(at instanceof Date ? at.getTime() : Number.NaN).toBeLessThan(before + 1)
    expect(h.sent.map((e) => e.event)).toEqual(['checkout_started'])
    expect(sessionStorage.getItem(HANDOFF)).toBeNull()
    // O SINGURĂ dată: documentul următor nu-l mai trimite.
    await nextDocument()
    a.setAnalyticsUser('u1')
    a.initAnalytics()
    await flush()
    expect(checkoutCalls()).toHaveLength(1)
  })

  it('AN35 (CR-m4) predarea e legată de cont, acord și vârstă; în același document nu se dublează', async () => {
    const ageHandoff = (ms: number): void => {
      const list = JSON.parse(sessionStorage.getItem(HANDOFF) ?? '[]') as Array<{ at: number }>
      sessionStorage.setItem(HANDOFF, JSON.stringify(list.map((e) => ({ ...e, at: e.at - ms }))))
    }
    const scenarios: ReadonlyArray<[string, () => void]> = [
      ['alt cont', () => {
        localStorage.setItem(CONSENT_OWNER, 'u2')
        a.setAnalyticsUser('u2')
      }],
      ['acord retras și redat între timp', () => {
        setConsent(true, 99)
        a.setAnalyticsUser('u1')
      }],
      ['mai vechi de 24 h', () => {
        ageHandoff(25 * 3600 * 1000)
        a.setAnalyticsUser('u1')
      }],
    ]
    for (const [name, beforeStart] of scenarios) {
      a.resetAnalyticsForTests()
      localStorage.clear()
      sessionStorage.clear()
      for (const fn of Object.values(h.client)) fn.mockClear()
      a = await freshModule()
      grantedEarlierBy('u1')
      a.setAnalyticsUser('u1')
      a.track('checkout_started', { plan: 'growth' }, { sendInstantly: true })
      await nextDocument()
      beforeStart()
      a.initAnalytics()
      await flush()
      // Control: pornirea chiar a avut loc (altfel „nimic trimis” ar fi gratuit).
      expect(h.client.init, name).toHaveBeenCalledTimes(1)
      expect(checkoutCalls(), name).toHaveLength(0)
      expect(sessionStorage.getItem(HANDOFF), name).toBeNull()
    }
    // În ACELAȘI document (mailto, fereastră nouă): o singură dată, din memorie,
    // iar documentul următor nu-l mai retrimite.
    a.resetAnalyticsForTests()
    localStorage.clear()
    sessionStorage.clear()
    for (const fn of Object.values(h.client)) fn.mockClear()
    a = await freshModule()
    grantedEarlierBy('u1')
    a.setAnalyticsUser('u1')
    a.track('plan_quote_requested', { plan: 'pro' }, { sendInstantly: true })
    a.initAnalytics()
    await flush()
    expect(checkoutCalls('plan_quote_requested')).toHaveLength(1)
    await nextDocument()
    a.setAnalyticsUser('u1')
    a.initAnalytics()
    await flush()
    expect(checkoutCalls('plan_quote_requested')).toHaveLength(1)
  })

  it('AN36 marcajul redirectului: doar cu acord, plan, cont, 24 h, citit o singură dată', () => {
    // (R3) Fără acord nu se scrie NIMIC: marcajul servește doar statisticii
    // (deduplicarea lui `subscription_started`). Mutația care pică: garda scoasă.
    a.setAnalyticsUser('u1')
    a.noteCheckoutRedirect('growth')
    expect(sessionStorage.getItem(REDIRECT)).toBeNull()
    // Control pozitiv: cu acord (PostHog tot neîncărcat) marcajul se scrie.
    setConsent(true)
    a.noteCheckoutRedirect('growth')
    const marker = JSON.parse(sessionStorage.getItem(REDIRECT) ?? 'null') as {
      plan?: unknown
      uid?: unknown
      at?: unknown
    } | null
    expect(marker?.plan).toBe('growth')
    expect(marker?.uid).toBe('u1')
    expect(typeof marker?.at).toBe('number')
    expect(a.takeCheckoutRedirect('growth')).toBe(true)
    expect(sessionStorage.getItem(REDIRECT)).toBeNull()
    // O singură dată.
    expect(a.takeCheckoutRedirect('growth')).toBe(false)
    // Alt plan: false, iar marcajul e consumat.
    a.noteCheckoutRedirect('growth')
    expect(a.takeCheckoutRedirect('starter')).toBe(false)
    expect(sessionStorage.getItem(REDIRECT)).toBeNull()
    // Alt cont la întoarcere.
    a.noteCheckoutRedirect('growth')
    a.setAnalyticsUser('u2')
    expect(a.takeCheckoutRedirect('growth')).toBe(false)
    // Fără cont la ambele capete.
    a.setAnalyticsUser(null)
    a.noteCheckoutRedirect('growth')
    expect(a.takeCheckoutRedirect('growth')).toBe(true)
    // Vârsta: 23 h da, peste 24 h nu.
    const write = (ageMs: number, uid: unknown = null): void =>
      sessionStorage.setItem(REDIRECT, JSON.stringify({ plan: 'growth', uid, at: Date.now() - ageMs }))
    write(23 * 3600 * 1000)
    expect(a.takeCheckoutRedirect('growth')).toBe(true)
    write(24 * 3600 * 1000 + 60 * 1000)
    expect(a.takeCheckoutRedirect('growth')).toBe(false)
    // Formă greșită.
    write(0, 5)
    expect(a.takeCheckoutRedirect('growth')).toBe(false)
    sessionStorage.setItem(REDIRECT, '{nu e json')
    expect(a.takeCheckoutRedirect('growth')).toBe(false)
    // La retragere marcajul dispare cu celelalte urme `ph_*`. Mutația care pică:
    // cheia fără prefixul `ph_` (cum era).
    a.noteCheckoutRedirect('growth')
    expect(sessionStorage.getItem(REDIRECT)).not.toBeNull()
    a.installAnalyticsConsentListener()
    announce(false)
    expect(sessionStorage.getItem(REDIRECT)).toBeNull()
    // Storage care aruncă (RESID-15): no-op la scriere, false la citire.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    a.noteCheckoutRedirect('growth')
    expect(a.takeCheckoutRedirect('growth')).toBe(false)
  })
})

describe('analytics — sesiunea neaflată și contul nou', () => {
  it('AN38 (R4) getSession eșuat: ce se emite după nu e preluat de contul care intră apoi', async () => {
    // Tableta partajată: acordul e al lui B. La pornire refresh-ul de token pică
    // (rețea): AuthContext nu publică nimic, ecranul arată /auth.
    grantedEarlierBy('owner-b')
    a.initAnalytics()
    // Emis ÎNAINTEA semnalului (primele milisecunde ale încărcării): al sesiunii
    // care se rezolvă.
    a.track('plan_upsell_viewed', { target: 'payments' })
    a.setAnalyticsAuthUnresolved()
    // X își face cont nou; cu confirmarea pornită `signUp` nu dă sesiune.
    a.track('signup_completed', { email_confirmation_required: true, plan_intent: null })
    // Apoi B se autentifică pe aceeași tabletă.
    a.setAnalyticsUser('owner-b')
    await flush()
    // Control: pornirea a avut loc (altfel „nimic trimis” ar fi gratuit).
    expect(h.client.init).toHaveBeenCalledTimes(1)
    // Mutația care pică: fără marcaj, intrarea lui X e preluată drept a lui B.
    expect(h.sent.map((e) => e.event)).toEqual(['plan_upsell_viewed'])
    // Control pozitiv: ce emite B după autentificare pleacă.
    a.track('login_completed', { mfa: false })
    expect(lastSent().event).toBe('login_completed')
    // Semnalul nu mai are efect după primul răspuns.
    a.setAnalyticsAuthUnresolved()
    a.track('dashboard_tab_viewed', { tab: 'orders' })
    expect(lastSent().event).toBe('dashboard_tab_viewed')
  })

  it('AN39 (R6) acordul dat fără cont trece la contul CREAT în pagină, și după confirmarea emailului', async () => {
    // Landing, nelogat: bannerul acceptat (acord nelegat, în memorie).
    a.setAnalyticsUser(null)
    a.initAnalytics()
    announce(true)
    await flush()
    // AuthPage, după `signUp` fără sesiune: contul nou preia acordul.
    a.bindPendingConsentToAccount('new-owner')
    expect(localStorage.getItem(CONSENT_OWNER)).toBe('new-owner')
    // Preluat o singură dată: un al doilea cont creat în pagină nu-l mută.
    a.bindPendingConsentToAccount('someone-else')
    expect(localStorage.getItem(CONSENT_OWNER)).toBe('new-owner')
    // Linkul de confirmare: document NOU, contul nou e logat.
    await nextDocument()
    a.setAnalyticsUser('new-owner')
    a.initAnalytics()
    await flush()
    // Mutația care pică: preluarea doar în memorie (contul nu e nici identificat,
    // nici capturat — AN32).
    expect(h.client.identify.mock.calls).toEqual([['new-owner']])
    a.track('onboarding_started', { source: 'signup' })
    expect(lastSent().event).toBe('onboarding_started')
    // Control: alt cont pe același browser rămâne necapturat (AN32 neschimbat).
    a.setAnalyticsUser('other-account')
    a.track('login_completed', { mfa: false })
    expect(lastSent().event).toBe('onboarding_started')

    // Fără efect pe un acord LEGAT de un cont: A acceptă logat, iese, iar pe
    // aceeași tabletă se face un cont nou. Mutația care pică: preluarea fără
    // verificarea acordului nelegat din pagină.
    await nextDocument()
    localStorage.clear()
    a.setAnalyticsUser('waiter-a')
    a.initAnalytics()
    announce(true)
    await flush()
    a.setAnalyticsUser(null)
    a.bindPendingConsentToAccount('new-owner')
    expect(localStorage.getItem(CONSENT_OWNER)).toBe('waiter-a')
  })
})

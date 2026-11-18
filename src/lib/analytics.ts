// src/lib/analytics.ts
// ─────────────────────────────────────────────────────────────────
// PostHog — analytics de produs, DOAR cu consimțământul „Performanță”.
//
// Contractul (politicile din menuvia-pack/03 §3.1, §3.2.a, §4, §6 și 04 §3.2,
// §4 îl promit; testele AN0–AN24 din __tests__/analytics.test.ts îl țin):
//   • fără consimțământ nu se descarcă nimic — posthog-js e importat DINAMIC,
//     abia la init (chunk separat, nu intră în entry-ul meniului QR);
//   • fără cheie (deploy preview, branch deploy, local) analytics e oprit:
//     VITE_POSTHOG_KEY e setată DOAR în contextul de producție (netlify.toml +
//     deploy-vps.yml, clichetul PE1–PE6 din tests/functions/posthog-env.test.js);
//   • tot ce nu folosim e OPRIT explicit în POSTHOG_PRIVACY_CONFIG, iar
//     `advanced_disable_flags` taie configurarea de la distanță: un comutator
//     din proiectul PostHog nu poate deschide un canal nou (înregistrări,
//     heatmap-uri, captură de consolă, web vitals) peste ce scrie aici;
//   • suprafețele OASPEȚILOR (meniul QR /q/, meniul /m/, rezervarea /rezervare/)
//     nu trimit NIMIC la PostHog, nici cu consimțământ: acolo Menuvia e persoana
//     împuternicită a restaurantului, iar DPA-ul (05 §3.4 + Anexa 2) nu cunoaște
//     PostHog. PostHog nu se încarcă dacă pagina de intrare e una dintre ele, iar
//     `before_send` aruncă orice eveniment de pe ele (navigarea SPA din panou);
//   • oaspeții rămân anonimi (`person_profiles: 'identified_only'`). Personalul e
//     PSEUDONIM — doar `user.id` (UUID intern) — și DOAR contul care și-a dat
//     acordul: consimțământul e per browser, identitatea per cont
//     (`ph_menuvia_consent_uid`), deci pe o tabletă partajată contul următor nu
//     e asociat pe acordul celui dinainte;
//   • PostHog pornește abia după ce AuthContext a răspuns (`setAnalyticsUser`):
//     înainte, „sesiune încă nerezolvată” arăta ca „nimeni logat”, iar contul
//     încă logat primea reset() la fiecare pornire, cu page view-ul inițial
//     anonim, înaintea identității;
//   • locația nu se derivă din IP: `$geoip_disable` pe FIECARE eveniment
//     (proiectul are transformarea GeoIP pornită, iar `anonymize_ips` n-o
//     oprește — IP-ul e folosit înainte să fie eliminat);
//   • la revocare: reset(true) ÎNAINTE de opt_out_capturing() — în posthog-js
//     1.440 reset() șterge și consimțământul stocat de SDK, deci ordinea inversă
//     REPORNEA captura; `true` schimbă și `$device_id` (fără el, același UUID per
//     browser lega istoricul de dinainte de revocare de cel de după), iar urmele
//     `ph_*` se șterg din browser, și când PostHog nu e încărcat în pagină;
//   • o revocare din ALT tab se aude (evenimentul `storage` + verificarea
//     acordului înaintea oricărui apel care poate face reset()): altfel tab-ul
//     vecin trimitea mai departe, iar ieșirea din cont repornea captura.
//
// Adresa IP nu se controlează din client: opțiunea `ip` a SDK-ului nu mai are
// niciun efect (marcată „THIS OPTION HAS NO EFFECT” în tipurile 1.440), iar
// eliminarea IP-ului la ingestie e setarea proiectului (`anonymize_ips`).
//
// Catalogul evenimentelor (când, unde, proprietăți, ce întrebare de afacere
// răspund): docs/ANALYTICS_EVENTS.md (clichetul AE7 îl ține egal cu codul).
// ─────────────────────────────────────────────────────────────────
// Import doar de TIP (zero cod la runtime); modulul real stă în `ph`.
import type { CaptureResult, PostHog, PostHogConfig } from 'posthog-js'
import { scrubTokenPathsDeep } from './telemetryScrub'
import { browserSite } from './domain'

/**
 * Evenimentele de afacere. Fiecare membru are cel puțin un `track()` real în
 * `src/` (clichetul AE1 din __tests__/analyticsEvents.test.ts): un nume fără
 * emițător e un grafic gol în PostHog care pare „zero utilizatori”.
 */
export type AppEvent =
  | 'signup_completed'
  | 'login_completed'
  | 'onboarding_started'
  | 'onboarding_step_completed'
  | 'onboarding_completed'
  | 'product_created'
  | 'product_imported_ai'
  | 'order_placed'
  | 'checkout_started'
  | 'subscription_started'
  | 'plan_upsell_viewed'
  | 'plan_upsell_clicked'
  | 'plan_quote_requested'
  | 'dashboard_tab_viewed'
  | 'shift_opened'
  | 'shift_closed'
  | 'invoice_requested'
  | 'export_data_requested'
  | 'account_deletion_requested'

/** Doar valori primitive: un obiect (user, comandă, restaurant) nu încape. */
export type AnalyticsValue = string | number | boolean | null
export type AnalyticsProps = Readonly<Record<string, AnalyticsValue>>

export interface TrackOptions {
  /**
   * Trimite imediat, nu în lotul următor — pentru evenimentul de dinaintea
   * unei navigări care părăsește aplicația (checkout-ul Stripe, mailto).
   */
  sendInstantly?: boolean
}

/**
 * Contextul panoului, ca super-proprietăți de segmentare (fără PII): localul,
 * nivelul planului (din `planTier()`, regula 3 — NU `profile.plan`) și rolul
 * în local. `null` pe câmp = încă necunoscut.
 */
export interface AnalyticsContext {
  restaurant_id: string
  plan_tier: number | null
  staff_role: string | null
}

/** Cheia bannerului de cookie-uri (lib/cookieConsent.ts). */
const CONSENT_STORAGE_KEY = 'menuvia_cookie_consent'

/**
 * Contul sub care a fost folosită identitatea PostHog din acest browser
 * (identificat sau nu). Fără el, o sesiune expirată cât aplicația era închisă
 * (tableta ospătarului) lăsa evenimentele de după pe identitatea ultimului
 * cont. Prefixul `ph_` ține adevărată politica de cookie-uri („chei ph_*”).
 */
export const IDENTITY_OWNER_KEY = 'ph_menuvia_identity_owner'

/**
 * Contul care și-a dat acordul „Performanță” în acest browser. Identificarea
 * (`identify`) se face DOAR pentru el: acordul unui ospătar nu se întinde pe
 * contul colegului care se autentifică după el pe aceeași tabletă.
 */
export const CONSENT_OWNER_KEY = 'ph_menuvia_consent_uid'

/** Unde își ține SDK-ul refuzul (`consent_persistence_name`). */
export const SDK_CONSENT_KEY = 'ph_menuvia_consent'

/** Plafonul cozii de dinainte de încărcare (evenimente cu consimțământ dat). */
const QUEUE_LIMIT = 20

/**
 * Prefixele rutelor OASPEȚILOR (`parsePath` din App.tsx: `qr`, `menu`,
 * `reserve` — AN22 le ține sincron): acolo PostHog nu trimite nimic.
 */
export const GUEST_SURFACE_PREFIXES: readonly string[] = ['/q/', '/m/', '/rezervare/']

/** Parametrii de campanie ai paginii de INTRARE, ținuți în memorie (BV4). */
const CAMPAIGN_KEYS: readonly string[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
]
const CAMPAIGN_VALUE_MAX = 200

const CONTEXT_KEYS: ReadonlyArray<keyof AnalyticsContext> = [
  'restaurant_id',
  'plan_tier',
  'staff_role',
]

/**
 * Configurația de confidențialitate, ÎNGHEȚATĂ de testul AN3. Doar chei care
 * există în tipurile posthog-js 1.440 (`satisfies` pică la compilare pe o cheie
 * inventată). Ce nu folosim e oprit EXPLICIT, nu lăsat pe implicit/remote.
 */
export const POSTHOG_PRIVACY_CONFIG = {
  // Identitate și stocare
  person_profiles: 'identified_only',
  persistence: 'localStorage',
  opt_out_capturing_persistence_type: 'localStorage',
  consent_persistence_name: 'ph_menuvia_consent',
  // La opt-out SDK-ul își șterge și persistența (`ph_<cheie>_posthog`), nu doar
  // captura — altfel identitatea rămânea scrisă în browser după revocare.
  opt_out_persistence_by_default: true,
  respect_dnt: true,
  // Page view-uri: cel inițial + fiecare schimbare de cale din SPA
  // (`navigate()` din App face pushState; SDK-ul îl interceptează și
  // deduplică pe pathname, deci page view-ul inițial nu se dublează).
  capture_pageview: 'history_change',
  capture_pageleave: true,
  // Fragmentul (#access_token=… din linkul de resetare) nu pleacă nicăieri;
  // id-urile de click publicitar (gclid, fbclid…) se maschează în URL.
  disable_capture_url_hashes: true,
  mask_personal_data_properties: true,
  // Oprite: tot ce ar captura comportament sau conținut fără să-l cerem
  autocapture: false,
  rageclick: false,
  capture_dead_clicks: false,
  capture_heatmaps: false,
  capture_exceptions: false, // erorile le raportează Sentry
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
  // Niciun script extern (recorder, surveys, toolbar, site apps) și nicio
  // configurare de la distanță / feature flags (nu le folosim).
  disable_external_dependency_loading: true,
  advanced_disable_flags: true,
} as const satisfies Partial<PostHogConfig>

interface QueuedEvent {
  event: AppEvent
  properties: AnalyticsProps | undefined
  sendInstantly: boolean
}

let ph: PostHog | null = null
let initInFlight = false
/** PostHog e încărcat ȘI captura e pornită (consimțământ valid). */
let capturing = false
let listenerInstalled = false
/** Pornirea e permisă: `initAnalytics` (la idle) sau un acord dat ACUM. */
let armed = false
/**
 * Contul curent din AuthContext: `undefined` = AuthContext n-a răspuns încă
 * (sesiune nerezolvată), `null` = nimeni logat. PostHog nu pornește pe
 * `undefined` — altfel contul încă logat arăta „nimeni” și primea reset().
 */
let desiredUserId: string | null | undefined = undefined
/** Contul identificat efectiv în PostHog, în captura curentă. */
let appliedUserId: string | null = null
/** Contul sub care e folosită identitatea curentă a SDK-ului (null = niciunul). */
let identityOwner: string | null = null
/** Contul marcat intern (fondatorul), ca să-și poată filtra propriul trafic. */
let internalUserId: string | null = null
let internalAppliedFor: string | null = null
/** Acord dat fără cont logat: îl preia PRIMUL cont autentificat în această pagină. */
let pendingConsentOwner = false
let entryCampaign: Record<string, string> = {}
let dashboardContext: AnalyticsContext | null = null
/** Contextul panoului e înregistrat acum ca super-proprietăți în SDK. */
let contextOnClient = false
let queue: QueuedEvent[] = []
/**
 * Încărcarea SDK-ului pornită acum (rezolvată dacă nu e niciuna). Ținută ca
 * testele să aștepte importul REAL, nu un număr fix de ticuri (PH-R3).
 */
let initPromise: Promise<void> = Promise.resolve()

interface AnalyticsEnv {
  key: string
  host: string
}

function readEnv(): AnalyticsEnv | null {
  const key = ((import.meta.env.VITE_POSTHOG_KEY as string | undefined) ?? '').trim()
  if (!key) return null
  const host =
    ((import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? '').trim() ||
    'https://eu.i.posthog.com'
  return { key, host }
}

// Storage-ul poate ARUNCA (Safari cu „Block All Cookies”, RESID-15): fiecare
// acces e păzit. Pentru consimțământ, orice eroare = fără acord (fail-closed).
function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* fail-open: marcajele sunt doar plase pentru încărcarea următoare */
  }
}

function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* idem */
  }
}

function hasPerformanceConsent(): boolean {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { performance?: boolean } | null
    return parsed?.performance === true
  } catch {
    return false
  }
}

/** Șterge cheile `ph_*` dintr-un storage, în afara refuzului SDK-ului (RESID-15: fail-open). */
function purgeStore(getStore: () => Storage): void {
  try {
    const store = getStore()
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k === null || !k.startsWith('ph_')) continue
      if (k === SDK_CONSENT_KEY) continue
      keys.push(k)
    }
    for (const k of keys) store.removeItem(k)
  } catch {
    /* RESID-15 */
  }
}

/**
 * Urmele PostHog din browser (`ph_*`: identitatea SDK-ului, `$device_id`,
 * marcajele noastre), din localStorage și sessionStorage. Refuzul SDK-ului
 * (`ph_menuvia_consent`, fără niciun identificator) RĂMÂNE mereu: orice
 * instanță vie — din pagina asta sau din ALT tab, același localStorage — îl
 * RECITEȘTE la fiecare eveniment, iar fără el opt-out-ul ar redeveni „în
 * așteptare”, adică captură. Îl șterge `doInit`, la acordul următor.
 */
function purgeAnalyticsStorage(): void {
  purgeStore(() => localStorage)
  purgeStore(() => sessionStorage)
}

function currentPathname(): string {
  try {
    return typeof window === 'undefined' ? '' : window.location.pathname
  } catch {
    return ''
  }
}

/** O cale de pe suprafața oaspeților (meniul QR, /m/, rezervarea publică)? */
export function isGuestSurfacePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return GUEST_SURFACE_PREFIXES.some((p) => pathname.startsWith(p) && pathname.length > p.length)
}

function eventPathname(properties: Record<string, unknown> | undefined): string | null {
  const path = properties?.['$pathname']
  if (typeof path === 'string') return path
  const url = properties?.['$current_url']
  if (typeof url !== 'string') return null
  try {
    return new URL(url).pathname
  } catch {
    return null
  }
}

/**
 * `before_send`: ultimul filtru înaintea rețelei, pentru FIECARE eveniment.
 *   1. un eveniment de pe suprafața oaspeților se aruncă (DPA, 05 §3.4);
 *   2. token-urile din URL (/q/, /invite/, /echipa/, /sef-vanzari/, ?next=…,
 *      parametrii Stripe de revenire) trec prin scrubber (telemetryScrub.ts);
 *   3. `$geoip_disable`: transformarea GeoIP a proiectului nu derivă orașul,
 *      codul poștal și coordonatele din IP (o citește din proprietățile
 *      evenimentului). Pus aici, nu prin `register`, ca să nu depindă de
 *      ordinea în care SDK-ul trimite primul page view.
 */
export function minimizeCaptureResult(result: CaptureResult | null): CaptureResult | null {
  if (result === null) return null
  if (isGuestSurfacePath(eventPathname(result.properties))) return null
  const out = scrubTokenPathsDeep(result)
  out.properties = { ...out.properties, $geoip_disable: true }
  return out
}

/**
 * Parametrii `utm_*` ai paginii de INTRARE, ținuți în MEMORIE (nu în storage —
 * fără consimțământ nu pleacă nicăieri). Main.tsx îl cheamă la boot, înainte ca
 * o navigare din SPA (care păstrează doar calea) să-i scoată din URL; se
 * înregistrează o dată, la pornirea capturii.
 */
export function rememberEntryCampaign(search: string): void {
  const out: Record<string, string> = {}
  try {
    const params = new URLSearchParams(search)
    for (const key of CAMPAIGN_KEYS) {
      const value = params.get(key)?.trim()
      if (value) out[key] = value.slice(0, CAMPAIGN_VALUE_MAX)
    }
  } catch {
    /* un query malformat nu are voie să oprească pornirea aplicației */
  }
  entryCampaign = out
}

/** Super-proprietăți (pe fiecare eveniment): mediul, site-ul, contextul panoului. */
function registerContext(client: PostHog): void {
  client.register({
    app_env: ((import.meta.env.VITE_APP_ENV as string | undefined) ?? '').trim() || 'unknown',
    site: browserSite(),
    ...(dashboardContext ?? {}),
  })
  contextOnClient = dashboardContext !== null
}

/** Contul pentru care avem voie să identificăm: cel logat, DACĂ el a consimțit. */
function identityTarget(): string | null {
  if (typeof desiredUserId !== 'string') return null
  return readLocal(CONSENT_OWNER_KEY) === desiredUserId ? desiredUserId : null
}

/**
 * Aliniază identitatea din PostHog cu contul din AuthContext. Alt cont sau
 * ieșirea din cont → reset(true) întâi (identitate ȘI dispozitiv noi): nici
 * profilul, nici `$device_id`-ul vechi nu au voie să primească evenimentele
 * celui nou (dispozitive partajate în restaurant). Apoi `identify` DOAR dacă
 * acordul e al contului logat.
 */
function applyIdentity(client: PostHog): void {
  try {
    const account = desiredUserId ?? null
    if (identityOwner !== null && identityOwner !== account) {
      client.reset(true)
      appliedUserId = null
      internalAppliedFor = null
      identityOwner = null
      removeLocal(IDENTITY_OWNER_KEY)
      registerContext(client)
    }
    if (identityOwner === null && account !== null) {
      identityOwner = account
      writeLocal(IDENTITY_OWNER_KEY, account)
    }
    const target = identityTarget()
    if (target !== null && appliedUserId !== target) {
      // DOAR id-ul intern: fără e-mail, nume, telefon sau alte proprietăți.
      client.identify(target)
      appliedUserId = target
    }
    if (
      appliedUserId !== null &&
      internalUserId === appliedUserId &&
      internalAppliedFor !== appliedUserId
    ) {
      client.setInternalOrTestUser()
      internalAppliedFor = appliedUserId
    }
  } catch (err) {
    console.warn('[analytics] identity failed:', err)
  }
}

function send(client: PostHog, item: QueuedEvent): void {
  try {
    client.capture(
      item.event,
      item.properties ? { ...item.properties } : undefined,
      item.sendInstantly ? { send_instantly: true } : undefined,
    )
  } catch (err) {
    // Analytics nu are voie să strice aplicația.
    console.warn('[analytics] track failed:', err)
  }
}

/** Captura pornește (prima încărcare sau reacordarea consimțământului). */
function startCapturing(client: PostHog): void {
  try {
    // Sursa de adevăr e bannerul nostru: un opt-out rămas în SDK de la o
    // revocare în ACEASTĂ pagină ar ține captura oprită peste un acord nou
    // (pe o încărcare nouă refuzul vechi e șters de doInit, PH-R2). DNT/GPC
    // rămân mai tari (SDK-ul le verifică înaintea consimțământului stocat).
    if (client.has_opted_out_capturing()) client.opt_in_capturing({ captureEventName: false })
    capturing = true
    appliedUserId = null
    internalAppliedFor = null
    // Identitatea rămasă de la o încărcare anterioară, folosită sub ALT cont
    // decât cel logat acum (sesiune expirată, alt cont): identitate nouă.
    identityOwner = readLocal(IDENTITY_OWNER_KEY)
    if (identityOwner !== null && identityOwner !== (desiredUserId ?? null)) {
      client.reset(true)
      identityOwner = null
      removeLocal(IDENTITY_OWNER_KEY)
    }
    registerContext(client)
    if (Object.keys(entryCampaign).length > 0) client.register({ ...entryCampaign })
    applyIdentity(client)
    const pending = queue
    queue = []
    for (const item of pending) send(client, item)
  } catch (err) {
    console.warn('[analytics] start failed:', err)
  }
}

async function doInit(env: AnalyticsEnv): Promise<void> {
  if (ph || initInFlight) return
  initInFlight = true
  let posthog: PostHog
  try {
    // Chunk separat, descărcat DOAR cu consimțământ — nu pe calea critică a meniului.
    posthog = (await import('posthog-js')).default
  } catch (err) {
    console.warn('[analytics] posthog-js load failed:', err)
    initInFlight = false
    return
  }
  initInFlight = false
  // Consimțământul poate fi retras cât se descărca chunk-ul.
  if (!hasPerformanceConsent()) {
    queue = []
    return
  }
  // Un refuz rămas în SDK de la o revocare la o vizită ANTERIOARĂ: bannerul
  // nostru tocmai a spus „da”. Lăsat pe loc, `opt_in_capturing` din `loaded`
  // trimitea page view-ul inițial SINCRON, înaintea super-proprietăților și a
  // identității (PH-R2); fără el, page view-ul pleacă după `loaded`.
  removeLocal(SDK_CONSENT_KEY)
  ph = posthog
  posthog.init(env.key, {
    ...POSTHOG_PRIVACY_CONFIG,
    api_host: env.host,
    before_send: minimizeCaptureResult,
    // `loaded` rulează ÎNAINTEA page view-ului inițial (SDK-ul îl amână un
    // tick), deci identitatea și super-proprietățile ajung și pe el.
    loaded: () => startCapturing(posthog),
  })
}

/** Pornește PostHog dacă TOATE condițiile sunt îndeplinite (idempotentă). */
function maybeStart(): void {
  if (!armed) return
  const env = readEnv()
  if (!env || !hasPerformanceConsent()) return
  if (desiredUserId === undefined) return
  if (ph) {
    if (!capturing) startCapturing(ph)
    return
  }
  // Pe o pagină de oaspete nu se descarcă nimic: n-ar avea ce trimite.
  if (isGuestSurfacePath(currentPathname())) return
  if (initInFlight) return
  initPromise = doInit(env).catch((err: unknown) => {
    // Analytics nu are voie să strice aplicația (nici ca respingere netratată).
    console.warn('[analytics] init failed:', err)
  })
}

function revoke(): void {
  queue = []
  pendingConsentOwner = false
  const client = ph
  if (client && capturing) {
    try {
      // ORDINEA contează: reset() șterge și consimțământul stocat de SDK, deci
      // opt_out_capturing() trebuie să vină DUPĂ el, altfel captura repornește.
      client.reset(true)
      client.opt_out_capturing()
    } catch (err) {
      console.warn('[analytics] opt-out failed:', err)
    }
  }
  capturing = false
  appliedUserId = null
  internalAppliedFor = null
  identityOwner = null
  contextOnClient = false
  // Și fără PostHog încărcat în pagina asta (revocare înaintea idle-ului, chunk
  // încă nedescărcat): urmele unei vizite anterioare se șterg din browser. Și
  // atunci refuzul SDK-ului rămâne: un tab vecin poate avea o instanță vie.
  purgeAnalyticsStorage()
}

/**
 * Acordul poate fi retras în ALT tab (același localStorage, dar
 * `consent-updated` nu trece dintr-un tab în altul). Fără verificarea asta,
 * tab-ul de aici rămânea „în captură”: trimitea evenimente după revocare, iar
 * un reset() al lui (ieșirea din cont, pe care Supabase o propagă în toate
 * tab-urile) ȘTERGEA refuzul comun al SDK-ului și repornea captura și în
 * celelalte. Întoarce false dacă a revocat aici.
 */
function stillConsented(): boolean {
  if (hasPerformanceConsent()) return true
  revoke()
  return false
}

/**
 * Revocarea din alt tab, aflată imediat: evenimentul `storage` vine doar din
 * ALTE tab-uri (inclusiv `clear()` / ștergerea datelor site-ului), iar fără
 * acord revocarea e idempotentă — fără SDK aici doar golește coada și urmele.
 */
function handleStorage(): void {
  if (!hasPerformanceConsent()) revoke()
}

/** Acordul dat ACUM se leagă de contul de ACUM (sau, fără cont, de primul care intră). */
function bindConsentOwner(): void {
  if (typeof desiredUserId === 'string') {
    writeLocal(CONSENT_OWNER_KEY, desiredUserId)
    pendingConsentOwner = false
  } else {
    removeLocal(CONSENT_OWNER_KEY)
    pendingConsentOwner = true
  }
}

function handleConsentUpdate(event: Event): void {
  const detail = (event as CustomEvent<{ performance?: boolean } | null | undefined>).detail
  const granted =
    typeof detail?.performance === 'boolean' ? detail.performance : hasPerformanceConsent()
  if (!granted) {
    revoke()
    return
  }
  bindConsentOwner()
  // Un acord dat acum e un răspuns la acțiunea omului: fără așteptarea idle-ului.
  armed = true
  if (ph && capturing) {
    applyIdentity(ph)
    return
  }
  maybeStart()
}

/**
 * Instalează (o singură dată) ascultătorul de `consent-updated`. Main.tsx îl
 * cheamă SINCRON la boot: un acord sau o revocare de dinaintea idle-ului nu
 * are voie să treacă neauzit (un ascultător adăugat în timpul dispecerizării
 * nu primește evenimentul curent).
 */
export function installAnalyticsConsentListener(): void {
  if (listenerInstalled || typeof window === 'undefined') return
  window.addEventListener('consent-updated', handleConsentUpdate)
  window.addEventListener('storage', handleStorage)
  listenerInstalled = true
}

/**
 * Pornirea (main.tsx o cheamă la idle): ascultătorul de consimțământ + PostHog,
 * dacă acordul e deja dat și AuthContext a răspuns. Fără acord nu descarcă
 * nimic. Idempotentă.
 */
export function initAnalytics(): void {
  installAnalyticsConsentListener()
  armed = true
  maybeStart()
}

/**
 * Contul curent (din AuthContext): `user.id` la autentificare, `null` la ieșire
 * sau fără sesiune. Primul răspuns deblochează pornirea; după, identitatea se
 * realiniază. Fără consimțământ nu ajunge nicăieri.
 */
export function setAnalyticsUser(userId: string | null): void {
  if (userId === desiredUserId) return
  const firstAnswer = desiredUserId === undefined
  desiredUserId = userId
  if (internalUserId !== userId) internalUserId = null
  if (userId !== null && pendingConsentOwner) {
    pendingConsentOwner = false
    if (hasPerformanceConsent()) writeLocal(CONSENT_OWNER_KEY, userId)
  }
  if (ph && capturing) {
    if (stillConsented()) applyIdentity(ph)
    return
  }
  if (firstAnswer) maybeStart()
}

/**
 * Marchează contul curent ca intern (`$internal_or_test_user`), ca traficul
 * fondatorului să poată fi filtrat. Un răspuns întârziat pentru alt cont e
 * ignorat.
 */
export function markAnalyticsInternalUser(userId: string): void {
  if (userId !== desiredUserId) return
  internalUserId = userId
  if (ph && capturing && stillConsented()) applyIdentity(ph)
}

function sameContext(a: AnalyticsContext | null, b: AnalyticsContext | null): boolean {
  if (a === null || b === null) return a === b
  return CONTEXT_KEYS.every((k) => a[k] === b[k])
}

/**
 * Contextul panoului (DashboardPage): localul, nivelul planului și rolul, ca
 * super-proprietăți — fără ele nu se pot separa proprietarii de ospătari,
 * Planul 1 de Planul 2/3, sau locațiile unui owner cu mai multe localuri.
 * `null` la ieșirea din panou le scoate de pe evenimentele următoare.
 */
export function setAnalyticsContext(context: AnalyticsContext | null): void {
  if (sameContext(context, dashboardContext)) return
  dashboardContext = context === null ? null : { ...context }
  const client = ph
  if (!client || !capturing || !stillConsented()) return
  try {
    if (dashboardContext !== null) {
      client.register({ ...dashboardContext })
      contextOnClient = true
    } else if (contextOnClient) {
      for (const key of CONTEXT_KEYS) client.unregister(key)
      contextOnClient = false
    }
  } catch (err) {
    console.warn('[analytics] context failed:', err)
  }
}

/**
 * Emite un eveniment de afacere. No-op fără consimțământ sau fără cheie; cu
 * consimțământ dat dar PostHog încă neîncărcat, evenimentul așteaptă în coadă
 * (întoarcerea din Stripe se poate confirma înaintea încărcării). Proprietăți
 * DOAR non-PII (clichetul AE2): id-uri interne, plan, sursă, numere.
 */
export function track(event: AppEvent, properties?: AnalyticsProps, options?: TrackOptions): void {
  const item: QueuedEvent = { event, properties, sendInstantly: options?.sendInstantly === true }
  if (ph && capturing) {
    if (stillConsented()) send(ph, item)
    return
  }
  if (!readEnv() || !hasPerformanceConsent()) return
  if (queue.length >= QUEUE_LIMIT) return
  queue.push(item)
}

/**
 * DOAR pentru teste: așteaptă încărcarea SDK-ului pornită acum. Sub vitest,
 * importul dinamic al unui modul mock-uit trece prin rezolvarea lui în procesul
 * principal, deci câteva ticuri fixe nu sunt o garanție — iar o aserțiune
 * negativă („fără init”) făcută înaintea importului ar trece din întâmplare.
 */
export function analyticsSettledForTests(): Promise<void> {
  return initPromise
}

/** DOAR pentru teste: starea modulului înapoi la zero, fără ascultători. */
export function resetAnalyticsForTests(): void {
  if (listenerInstalled && typeof window !== 'undefined') {
    window.removeEventListener('consent-updated', handleConsentUpdate)
    window.removeEventListener('storage', handleStorage)
  }
  ph = null
  initInFlight = false
  capturing = false
  listenerInstalled = false
  armed = false
  desiredUserId = undefined
  appliedUserId = null
  identityOwner = null
  internalUserId = null
  internalAppliedFor = null
  pendingConsentOwner = false
  entryCampaign = {}
  dashboardContext = null
  contextOnClient = false
  queue = []
  initPromise = Promise.resolve()
}

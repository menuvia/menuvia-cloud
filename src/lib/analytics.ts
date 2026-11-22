// src/lib/analytics.ts
// ─────────────────────────────────────────────────────────────────
// PostHog — analytics de produs, DOAR cu consimțământul „Performanță”.
//
// Contractul (politicile din menuvia-pack/03 §3.1, §3.2.a, §4, §6 și 04 §3.2,
// §4 îl promit; testele AN0–AN39 din __tests__/analytics.test.ts îl țin):
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
//     PostHog. PostHog nu se încarcă dacă pagina de intrare e una dintre ele
//     (pornirea se reevaluează la fiecare schimbare de rută, ca o navigare SPA
//     spre o pagină Menuvia să-l poată porni), `before_send` aruncă orice
//     eveniment de pe ele, iar câmpurile pe care SDK-ul le DERIVĂ dintr-o pagină
//     de oaspete (`$prev_pageview_*`, `$session_entry_*`, `$initial_*`, copia
//     fără prefix a intrării în sesiune din `$set_once`) se scot de pe
//     evenimentele de pe paginile eligibile, iar o proveniență (`$referrer` &
//     co.) de pe o pagină de oaspete devine `$direct`;
//   • oaspeții rămân anonimi (`person_profiles: 'identified_only'`). Personalul e
//     PSEUDONIM — doar `user.id` (UUID intern) — și DOAR contul care și-a dat
//     acordul: consimțământul e per browser, identitatea per cont
//     (`ph_menuvia_consent_uid`): contul logat la acord sau, cu acordul dat fără
//     cont, primul cont autentificat ori CREAT în aceeași pagină (și după
//     confirmarea emailului, în alt document). Un cont logat care NU e al
//     acordului nu e capturat deloc, nici anonim (tableta partajată din restaurant);
//   • PostHog pornește abia după ce AuthContext a răspuns (`setAnalyticsUser`):
//     înainte, „sesiune încă nerezolvată” arăta ca „nimeni logat”, iar contul
//     încă logat primea reset() la fiecare pornire, cu page view-ul inițial
//     anonim, înaintea identității. Un `getSession` eșuat lasă analytics
//     nerezolvat, iar ce se emite după aparține ecranului fără cont (nu e
//     preluat de contul care intră apoi);
//   • contextul panoului (local, plan, rol) și campania paginii de intrare se
//     atașează PER EVENIMENT, din starea paginii — nu ca super-proprietăți
//     persistate (o încărcare nouă fără panou ar fi moștenit localul vechi, o
//     intrare directă campania veche); cheile persistate de versiunea
//     anterioară se scot la pornire. Din campanie pleacă doar valori-
//     identificator (litere mici, cifre, `-_.`, cel mult 64), oriunde ar apărea
//     (proprietăți, `$set`/`$set_once`, URL-uri);
//   • locația nu se derivă din IP: `$geoip_disable` pe FIECARE eveniment
//     (proiectul are transformarea GeoIP pornită, iar `anonymize_ips` n-o
//     oprește — IP-ul e folosit înainte să fie eliminat);
//   • la revocare: reset(true) ÎNAINTE de opt_out_capturing() — în posthog-js
//     1.440 reset() șterge și consimțământul stocat de SDK, deci ordinea inversă
//     REPORNEA captura; `true` schimbă și `$device_id` (fără el, același UUID per
//     browser lega istoricul de dinainte de revocare de cel de după), iar urmele
//     `ph_*` se șterg din browser, și când PostHog nu e încărcat în pagină.
//     Fără loturi în SDK (`request_batching: false`): un lot neplecat ar fi ieșit
//     la timer sau la închiderea paginii, DUPĂ retragere;
//   • acordul schimbat în ALT tab se aude (evenimentul `storage` + verificarea
//     acordului înaintea oricărui apel care poate face reset()): o retragere
//     oprește captura și aici, o acordare o pornește, iar o retragere urmată de
//     reacordare (o „generație” nouă a acordului) dă o identitate SDK nouă.
//
// Adresa IP nu se controlează din client: opțiunea `ip` a SDK-ului nu mai are
// niciun efect (marcată „THIS OPTION HAS NO EFFECT” în tipurile 1.440), iar
// eliminarea IP-ului la ingestie e setarea proiectului (`anonymize_ips`).
//
// Rezidual consemnat: o cerere care a EȘUAT în rețea înainte de retragere stă
// în coada de reîncercare a SDK-ului (RetryQueue), care nu reverifică acordul.
//
// Catalogul evenimentelor (când, unde, proprietăți, ce întrebare de afacere
// răspund): docs/ANALYTICS_EVENTS.md (clichetul AE7 îl ține egal cu codul).
// ─────────────────────────────────────────────────────────────────
// Import doar de TIP (zero cod la runtime); modulul real stă în `ph`.
import type { CaptureResult, PostHog, PostHogConfig } from 'posthog-js'
import { scrubTokenPathsDeep } from './telemetryScrub'
import { browserSite } from './domain'
import { ROUTE_CHANGE_EVENT } from './routeEvents'

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
   * Evenimentul de dinaintea unei navigări care părăsește aplicația (checkout-ul
   * Stripe, mailto): trimis imediat, iar dacă PostHog nu e încă încărcat, predat
   * documentului următor din același tab (sessionStorage, același cont și același
   * acord, cel mult 24 h).
   */
  sendInstantly?: boolean
}

/**
 * Contextul panoului, atașat fiecărui eveniment (fără PII): localul, nivelul
 * planului (din `planTier()`, regula 3 — NU `profile.plan`) și rolul în local.
 * `null` pe câmp = încă necunoscut.
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
 * Contul care și-a dat acordul „Performanță” în acest browser. Captura unui cont
 * LOGAT (și identificarea lui) se face DOAR pentru el: acordul unui ospătar nu se
 * întinde pe contul colegului care se autentifică după el pe aceeași tabletă.
 */
export const CONSENT_OWNER_KEY = 'ph_menuvia_consent_uid'

/** Unde își ține SDK-ul refuzul (`consent_persistence_name`). */
export const SDK_CONSENT_KEY = 'ph_menuvia_consent'

/**
 * Evenimentele `sendInstantly` rămase în coadă când pagina pleacă (sessionStorage,
 * același tab). Prefixul `ph_` le face parte din urmele șterse la revocare.
 */
export const HANDOFF_STORAGE_KEY = 'ph_menuvia_handoff'
const HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Marcajul local „am trimis omul în Stripe pentru planul X” (sessionStorage). Nu
 * pleacă nicăieri, dar singurul lui rost e statistica (deduplicarea lui
 * `subscription_started`), deci se scrie DOAR cu acordul „Performanță”; prefixul
 * `ph_` îl face parte din urmele șterse la retragere.
 */
export const CHECKOUT_REDIRECT_KEY = 'ph_menuvia_checkout_redirect'
const CHECKOUT_REDIRECT_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Toleranța la un ceas dat puțin înapoi între plecare și întoarcere. */
const CLOCK_SKEW_MS = 5 * 60 * 1000

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

/**
 * Valoare de campanie admisă: un IDENTIFICATOR, nu text liber. Un e-mail, un
 * text cu spațiu, un telefon (9+ cifre la rând, numărate și peste `.`/`-`/`_`
 * dintre ele: `0722-123-456`) se ARUNCĂ, nu se trunchiază — o valoare trunchiată
 * tot ar purta începutul datei personale. Un nume scris FĂRĂ spațiu
 * (`ion.popescu`) arată ca un identificator și nu se poate deosebi.
 */
const CAMPAIGN_VALUE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
const PHONE_LIKE_RE = /\d{9,}/
const DIGIT_SEPARATOR_RE = /[._-]/g

const CONTEXT_KEYS: ReadonlyArray<keyof AnalyticsContext> = [
  'restaurant_id',
  'plan_tier',
  'staff_role',
]
const CONTEXT_KEY_SET: ReadonlySet<string> = new Set<string>(CONTEXT_KEYS)

/**
 * Super-proprietățile pe care versiunea anterioară le PERSISTA în SDK
 * (`register`): se scot la fiecare pornire, ca valorile scrise atunci să nu mai
 * plece pe evenimentele de azi.
 */
const LEGACY_SUPER_PROPERTY_KEYS: readonly string[] = [...CONTEXT_KEYS, ...CAMPAIGN_KEYS]

/**
 * Grupurile de câmpuri pe care SDK-ul le DERIVĂ dintr-o pagină anterioară
 * (pagina de dinainte, intrarea în sesiune, prima vizită). Dacă pagina-sursă e
 * a oaspeților, tot grupul se scoate: evenimentul de acolo a fost aruncat, dar
 * SDK-ul își notase deja calea, durata și derularea.
 */
const DERIVED_PAGE_GROUPS: ReadonlyArray<{ prefix: string; anchors: readonly string[] }> = [
  { prefix: '$prev_pageview_', anchors: ['$prev_pageview_pathname'] },
  { prefix: '$session_entry_', anchors: ['$session_entry_url', '$session_entry_pathname'] },
  { prefix: '$initial_', anchors: ['$initial_current_url', '$initial_pathname'] },
]

/**
 * Pagina DE PROVENIENȚĂ (`document.referrer`), reținută de SDK pe tab, pe intrarea
 * în sesiune și pe prima vizită, fiecare cu domeniul ei. Un link obișnuit de pe o
 * pagină de oaspete spre site (`<a href="/">`) o trimite întreagă (aceeași origine,
 * `strict-origin-when-cross-origin`), deci evenimentele de pe pagina eligibilă ar fi
 * purtat calea meniului / a rezervării: devine `$direct`, ca o intrare directă.
 */
const REFERRER_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['$referrer', '$referring_domain'],
  ['$session_entry_referrer', '$session_entry_referring_domain'],
  ['$initial_referrer', '$initial_referring_domain'],
]
const DIRECT_REFERRER = '$direct'

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
  // Fără loturi: fiecare eveniment pleacă la capture. Lotul SDK-ului (3 s)
  // pleca la timer sau la închiderea paginii FĂRĂ să reverifice acordul, deci
  // după o retragere mai ieșeau evenimentele capturate înaintea ei.
  request_batching: false,
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
  /** Unic per document (`<document>:<n>`): predarea nu dublează un eveniment. */
  id: string
  event: AppEvent
  properties: AnalyticsProps | undefined
  sendInstantly: boolean
  /** Contul la emitere: `undefined` = AuthContext încă nerezolvat. */
  uid: string | null | undefined
  /** Contextul panoului la emitere — pleacă cu el, nu cu cel de la golire. */
  context: AnalyticsContext | null
  /** Generația acordului la emitere (null = fără acord). */
  gen: string | null
  /** Momentul emiterii (ms). */
  at: number
}

let ph: PostHog | null = null
let initInFlight = false
/** PostHog e încărcat ȘI captura e pornită (consimțământ valid). */
let capturing = false
/** Generația acordului sub care a pornit captura curentă. */
let capturingGeneration: string | null = null
let listenerInstalled = false
/** Pornirea e permisă: `initAnalytics` (la idle) sau un acord dat ACUM. */
let armed = false
/**
 * Contul curent din AuthContext: `undefined` = AuthContext n-a răspuns încă
 * (sesiune nerezolvată), `null` = nimeni logat. PostHog nu pornește pe
 * `undefined` — altfel contul încă logat arăta „nimeni” și primea reset().
 */
let desiredUserId: string | null | undefined = undefined
/**
 * AuthContext n-a putut afla sesiunea (`getSession` cu eroare): pe ecran nu e
 * nimeni logat, dar analytics rămâne nerezolvat (vezi `setAnalyticsAuthUnresolved`).
 */
let authUnresolvedAfterError = false
/** Contul identificat efectiv în PostHog, în captura curentă. */
let appliedUserId: string | null = null
/** Contul sub care e folosită identitatea curentă a SDK-ului (null = niciunul). */
let identityOwner: string | null = null
/** Contul marcat intern (fondatorul), ca să-și poată filtra propriul trafic. */
let internalUserId: string | null = null
let internalAppliedFor: string | null = null
/**
 * Acord dat fără cont logat: îl preia PRIMUL cont autentificat sau creat
 * (`bindPendingConsentToAccount`) în această pagină.
 */
let pendingConsentOwner = false
let entryCampaign: Record<string, string> = {}
let dashboardContext: AnalyticsContext | null = null
/**
 * Evenimentul aplicației trimis ACUM (citit sincron de before_send): contextul de
 * la emitere și proprietățile date explicit de apelant.
 */
let captureOverride: {
  context: AnalyticsContext | null
  own: AnalyticsProps | undefined
} | null = null
let queue: QueuedEvent[] = []
/** Identificatorul documentului (nu e secret: doar deosebește paginile). */
const DOCUMENT_ID = Math.random().toString(36).slice(2, 10)
let eventSeq = 0
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

/**
 * Generația acordului „Performanță”: înregistrarea bannerului, exact cum e
 * scrisă (`timestamp` diferă la fiecare salvare), sau null fără acord. Două
 * citiri diferite = acordul a fost salvat din nou între timp.
 */
function consentGeneration(): string | null {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { performance?: boolean } | null
    return parsed?.performance === true ? raw : null
  } catch {
    return null
  }
}

function hasPerformanceConsent(): boolean {
  return consentGeneration() !== null
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
 * marcajele noastre, evenimentele predate), din localStorage și sessionStorage.
 * Refuzul SDK-ului (`ph_menuvia_consent`, fără niciun identificator) RĂMÂNE
 * mereu: orice instanță vie — din pagina asta sau din ALT tab, același
 * localStorage — îl RECITEȘTE la fiecare eveniment, iar fără el opt-out-ul ar
 * redeveni „în așteptare”, adică captură. Îl șterge `doInit`, la acordul următor.
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

/** O cale (`/m/x`) sau un URL absolut al unei pagini de oaspete? */
function isGuestLocation(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false
  if (value.startsWith('/')) return isGuestSurfacePath(value)
  try {
    return isGuestSurfacePath(new URL(value).pathname)
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Valoarea unui parametru de campanie, normalizată (litere mici), sau null dacă
 * nu e un identificator (e-mail, spațiu, telefon, prea lungă, ne-text).
 */
export function normalizeCampaignValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (!CAMPAIGN_VALUE_RE.test(v)) return null
  if (PHONE_LIKE_RE.test(v.replace(DIGIT_SEPARATOR_RE, ''))) return null
  return v
}

/** Parametru de campanie: `utm_source`, `$initial_utm_source`, `$session_entry_utm_source`… */
function isCampaignKey(key: string): boolean {
  const base = key.startsWith('$initial_')
    ? key.slice('$initial_'.length)
    : key.startsWith('$session_entry_')
      ? key.slice('$session_entry_'.length)
      : key
  return base.toLowerCase().startsWith('utm_')
}

function decodeParam(raw: string): string | null {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return null
  }
}

/**
 * Scoate din query-ul unui URL parametrii `utm_*` a căror valoare nu e un
 * identificator (restul URL-ului rămâne neatins, octet cu octet). Așa un e-mail
 * pus în `utm_content` nu se întoarce prin `$current_url`/`$referrer`/
 * `$initial_current_url` după ce a fost respins ca proprietate.
 */
function stripRejectedCampaignParams(value: string): string {
  const q = value.indexOf('?')
  if (q < 0 || !/utm/i.test(value)) return value
  const hash = value.indexOf('#', q)
  const end = hash < 0 ? value.length : hash
  const pairs = value.slice(q + 1, end).split('&')
  const kept = pairs.filter((pair) => {
    const eq = pair.indexOf('=')
    const rawName = eq < 0 ? pair : pair.slice(0, eq)
    const name = (decodeParam(rawName) ?? rawName).trim().toLowerCase()
    if (!name.startsWith('utm_')) return true
    return normalizeCampaignValue(decodeParam(eq < 0 ? '' : pair.slice(eq + 1))) !== null
  })
  if (kept.length === pairs.length) return value
  return value.slice(0, q) + (kept.length > 0 ? `?${kept.join('&')}` : '') + value.slice(end)
}

/** Scoate grupurile derivate dintr-o pagină de oaspete (vezi DERIVED_PAGE_GROUPS). */
function dropGuestDerived(container: Record<string, unknown>): void {
  for (const group of DERIVED_PAGE_GROUPS) {
    if (!group.anchors.some((a) => isGuestLocation(container[a]))) continue
    for (const k of Object.keys(container)) if (k.startsWith(group.prefix)) delete container[k]
  }
}

/**
 * `$set_once` = prima vizită (`$initial_*`) + intrarea în sesiune FĂRĂ prefix
 * (`$current_url`, `$host`, `$pathname`, `$referrer`, `$referring_domain`, `utm_*`,
 * id-urile de click — `getSetOnceProps` în posthog-js 1.440; aplicația nu pune nimic
 * acolo). Când intrarea în sesiune e o pagină de oaspete, tot ce nu e `$initial_*` se
 * scoate: altfel, la fiecare încărcare a panoului din sesiunea începută pe meniu,
 * profilul primea calea meniului.
 */
function dropGuestSessionEntrySetOnce(container: Record<string, unknown>): void {
  if (!isGuestLocation(container['$current_url']) && !isGuestLocation(container['$pathname'])) {
    return
  }
  for (const k of Object.keys(container)) if (!k.startsWith('$initial_')) delete container[k]
}

/** Proveniența de pe o pagină de oaspete devine `$direct` (vezi REFERRER_PAIRS). */
function neutralizeGuestReferrers(container: Record<string, unknown>): void {
  for (const [referrer, domain] of REFERRER_PAIRS) {
    if (!isGuestLocation(container[referrer])) continue
    container[referrer] = DIRECT_REFERRER
    if (domain in container) container[domain] = DIRECT_REFERRER
  }
}

type ContainerKind = 'event' | '$set' | '$set_once'

/**
 * Proprietățile unui eveniment sau ale unei persoane (`$set`/`$set_once`):
 * parametrii de campanie doar ca identificatori, URL-urile fără parametri de
 * campanie respinși, fără câmpurile derivate dintr-o pagină de oaspete și fără
 * proveniența de pe una.
 */
function sanitizeContainer(
  input: Record<string, unknown>,
  kind: ContainerKind,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (isCampaignKey(key)) {
      if (value === null || value === undefined) {
        out[key] = value
      } else {
        const v = normalizeCampaignValue(value)
        if (v !== null) out[key] = v
      }
    } else if (typeof value === 'string') {
      out[key] = stripRejectedCampaignParams(value)
    } else if ((key === '$set' || key === '$set_once') && isRecord(value)) {
      out[key] = sanitizeContainer(value, key)
    } else {
      out[key] = value
    }
  }
  dropGuestDerived(out)
  if (kind === '$set_once') dropGuestSessionEntrySetOnce(out)
  neutralizeGuestReferrers(out)
  return out
}

/** Avem voie să capturăm: fără cont logat, oricine; cu cont, doar contul acordului. */
function accountMayCapture(): boolean {
  if (typeof desiredUserId !== 'string') return true
  return readLocal(CONSENT_OWNER_KEY) === desiredUserId
}

/**
 * `before_send`: ultimul filtru înaintea rețelei, pentru FIECARE eveniment.
 *   1. nimic nu pleacă dacă modulul nu a PORNIT captura (un SDK viu în alt
 *      tab poate șterge refuzul comun), dacă acordul s-a schimbat de atunci în
 *      alt tab (retragere, eventual reacordare, încă neauzite aici: evenimentele
 *      proprii ale SDK-ului — page view, page leave — ar pleca pe identitatea de
 *      dinainte) sau dacă contul logat nu e al acordului;
 *   2. un eveniment de pe suprafața oaspeților se aruncă (DPA, 05 §3.4);
 *   3. token-urile din URL (/q/, /invite/, /echipa/, /sef-vanzari/, ?next=…,
 *      parametrii Stripe de revenire) trec prin scrubber (telemetryScrub.ts);
 *   4. câmpurile derivate dintr-o pagină de oaspete și valorile de campanie
 *      care nu sunt identificatori se scot (și din `$set`/`$set_once`);
 *   5. contextul panoului și campania paginii de intrare se pun din starea
 *      paginii (cele persistate de SDK se scot întâi);
 *   6. `$geoip_disable`: transformarea GeoIP a proiectului nu derivă orașul,
 *      codul poștal și coordonatele din IP (o citește din proprietățile
 *      evenimentului).
 */
export function minimizeCaptureResult(result: CaptureResult | null): CaptureResult | null {
  if (result === null) return null
  if (!capturing || consentGeneration() !== capturingGeneration) return null
  if (!accountMayCapture()) return null
  if (isGuestSurfacePath(eventPathname(result.properties))) return null
  const out = scrubTokenPathsDeep(result)
  const props = sanitizeContainer(out.properties, 'event')
  for (const key of Object.keys(props)) {
    if (CONTEXT_KEY_SET.has(key) || key.startsWith('utm_')) delete props[key]
  }
  const context = captureOverride ? captureOverride.context : dashboardContext
  // Un `restaurant_id` dat EXPLICIT de apelant (tura, comanda de la ospătar,
  // factura) bate contextul panoului — ca înainte peste super-proprietăți.
  const own: Record<string, AnalyticsValue> = {}
  const explicit = captureOverride?.own
  if (explicit) for (const key of CONTEXT_KEYS) if (key in explicit) own[key] = explicit[key]
  out.properties = {
    ...props,
    ...(context ?? {}),
    ...entryCampaign,
    ...own,
    $geoip_disable: true,
  }
  if (out.$set) out.$set = sanitizeContainer(out.$set, '$set')
  if (out.$set_once) out.$set_once = sanitizeContainer(out.$set_once, '$set_once')
  return out
}

/**
 * Parametrii `utm_*` ai paginii de INTRARE, ținuți în MEMORIE (nu în storage —
 * fără consimțământ nu pleacă nicăieri). Main.tsx îl cheamă la boot, înainte ca
 * o navigare din SPA (care păstrează doar calea) să-i scoată din URL. Se pun pe
 * evenimentele ACESTUI document; doar valorile-identificator, celelalte se
 * aruncă. Pe o pagină de intrare a OASPEȚILOR nu se reține nimic: o navigare
 * SPA spre o pagină Menuvia n-are voie să ducă mai departe campania meniului.
 */
export function rememberEntryCampaign(search: string): void {
  const out: Record<string, string> = {}
  if (isGuestSurfacePath(currentPathname())) {
    entryCampaign = out
    return
  }
  try {
    const params = new URLSearchParams(search)
    for (const key of CAMPAIGN_KEYS) {
      const value = normalizeCampaignValue(params.get(key))
      if (value !== null) out[key] = value
    }
  } catch {
    /* un query malformat nu are voie să oprească pornirea aplicației */
  }
  entryCampaign = out
}

/** Super-proprietăți stabile ale build-ului (pe fiecare eveniment): mediul și site-ul. */
function registerContext(client: PostHog): void {
  client.register({
    app_env: ((import.meta.env.VITE_APP_ENV as string | undefined) ?? '').trim() || 'unknown',
    site: browserSite(),
  })
}

/** Contul pentru care avem voie să identificăm: cel logat, DACĂ el a consimțit. */
function identityTarget(): string | null {
  if (typeof desiredUserId !== 'string') return null
  return accountMayCapture() ? desiredUserId : null
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

/**
 * Trimite un eveniment al aplicației cu contextul de la EMITERE (before_send îl
 * citește sincron din `captureOverride`). `handedOff` = predat de documentul
 * anterior: pleacă cu momentul real al emiterii.
 */
function send(client: PostHog, item: QueuedEvent, handedOff: boolean): void {
  if (!accountMayCapture()) return
  const props = item.properties ? { ...item.properties } : undefined
  captureOverride = { context: item.context, own: item.properties }
  try {
    if (handedOff) {
      client.capture(item.event, props, {
        ...(item.sendInstantly ? { send_instantly: true } : {}),
        timestamp: new Date(item.at),
      })
    } else {
      client.capture(item.event, props, item.sendInstantly ? { send_instantly: true } : undefined)
    }
  } catch (err) {
    // Analytics nu are voie să strice aplicația.
    console.warn('[analytics] track failed:', err)
  } finally {
    captureOverride = null
  }
}

/** Un eveniment din coadă pleacă doar pe contul ȘI sub acordul de la emitere. */
function stillValid(item: QueuedEvent): boolean {
  return item.gen === capturingGeneration && item.uid === (desiredUserId ?? null)
}

function parseProps(value: unknown): AnalyticsProps | undefined | false {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) return false
  const out: Record<string, AnalyticsValue> = {}
  for (const [k, v] of Object.entries(value)) {
    if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      return false
    }
    out[k] = v
  }
  return out
}

function parseContext(value: unknown): AnalyticsContext | null | false {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return false
  const { restaurant_id, plan_tier, staff_role } = value
  if (typeof restaurant_id !== 'string') return false
  if (plan_tier !== null && typeof plan_tier !== 'number') return false
  if (staff_role !== null && typeof staff_role !== 'string') return false
  return { restaurant_id, plan_tier, staff_role }
}

/** Un eveniment predat, citit din storage (orice altă formă se aruncă). */
function parseQueued(value: unknown): QueuedEvent | null {
  if (!isRecord(value)) return null
  const { id, event, properties, sendInstantly, uid, context, gen, at } = value
  if (typeof id !== 'string' || typeof event !== 'string' || !/^[a-z0-9_]+$/.test(event)) {
    return null
  }
  if (typeof gen !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return null
  if (uid !== null && typeof uid !== 'string') return null
  const props = parseProps(properties)
  const ctx = parseContext(context)
  if (props === false || ctx === false) return null
  // Forma e verificată; numele vine din aceeași aplicație (aceeași origine).
  return {
    id,
    event: event as AppEvent,
    properties: props,
    sendInstantly: sendInstantly === true,
    uid,
    context: ctx,
    gen,
    at,
  }
}

/** Evenimentele predate de documentul anterior, citite O SINGURĂ dată (citire + ștergere). */
function takeHandoff(): QueuedEvent[] {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(HANDOFF_STORAGE_KEY)
    if (raw === null) return []
    // Fără ștergere reușită nu se trimite nimic: altfel ar pleca din nou data viitoare.
    sessionStorage.removeItem(HANDOFF_STORAGE_KEY)
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(parseQueued).filter((x): x is QueuedEvent => x !== null)
  } catch {
    return []
  }
}

/**
 * Predă documentului următor (același tab) un eveniment care precede o
 * navigare în afara aplicației: altfel coada din memorie moare cu pagina.
 * Doar cu cont și acord CUNOSCUTE la emitere — fără ele nu poate fi încadrat.
 */
function handOff(item: QueuedEvent): void {
  if (item.uid === undefined || item.gen === null) return
  try {
    const raw = sessionStorage.getItem(HANDOFF_STORAGE_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : []
    if (list.length >= QUEUE_LIMIT) return
    list.push(item)
    sessionStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* RESID-15: fără predare — evenimentul rămâne doar în memorie */
  }
}

/**
 * Golește cozile la pornirea capturii: întâi evenimentele predate de documentul
 * anterior (cel mult 24 h, același cont, același acord), apoi coada din memorie
 * (doar cele emise pe contul de acum și sub acordul de acum).
 */
function drainQueues(client: PostHog): void {
  const pending = queue
  queue = []
  const inMemory = new Set(pending.map((item) => item.id))
  const now = Date.now()
  for (const item of takeHandoff()) {
    if (inMemory.has(item.id) || !stillValid(item)) continue
    const age = now - item.at
    if (age < -CLOCK_SKEW_MS || age > HANDOFF_MAX_AGE_MS) continue
    send(client, item, true)
  }
  for (const item of pending) if (stillValid(item)) send(client, item, false)
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
    capturingGeneration = consentGeneration()
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
    // Contextul panoului și campania le persista versiunea anterioară: scoase,
    // ca o încărcare fără panou să nu plece cu localul (sau campania) de atunci.
    for (const key of LEGACY_SUPER_PROPERTY_KEYS) client.unregister(key)
    registerContext(client)
    applyIdentity(client)
    drainQueues(client)
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
  if (client) {
    try {
      // Opt-out ori de câte ori instanța TRĂIEȘTE, nu doar cu captura pornită
      // aici: un `doInit` din alt tab șterge refuzul comun, iar SDK-ul de aici
      // trece singur pe „în așteptare”, adică pe captură. ORDINEA contează:
      // reset() șterge și consimțământul stocat de SDK, deci opt_out_capturing()
      // trebuie să vină DUPĂ el, altfel captura repornește.
      if (capturing || !client.has_opted_out_capturing()) {
        client.reset(true)
        client.opt_out_capturing()
      }
    } catch (err) {
      console.warn('[analytics] opt-out failed:', err)
    }
  }
  capturing = false
  capturingGeneration = null
  appliedUserId = null
  internalAppliedFor = null
  identityOwner = null
  // Și fără PostHog încărcat în pagina asta (revocare înaintea idle-ului, chunk
  // încă nedescărcat): urmele unei vizite anterioare se șterg din browser. Și
  // atunci refuzul SDK-ului rămâne: un tab vecin poate avea o instanță vie.
  purgeAnalyticsStorage()
}

/**
 * Acordul salvat din nou în ALT tab de la pornirea capturii de aici (retragere +
 * reacordare, ale căror notificări n-au ajuns încă): identitatea SDK de dinainte
 * NU continuă sub acordul nou — reset(true), apoi captura repornește curat.
 */
function syncConsentGeneration(client: PostHog): void {
  const gen = consentGeneration()
  if (gen === null || gen === capturingGeneration) return
  try {
    client.reset(true)
  } catch (err) {
    console.warn('[analytics] reset failed:', err)
  }
  identityOwner = null
  appliedUserId = null
  internalAppliedFor = null
  capturing = false
  startCapturing(client)
}

/**
 * Acordul poate fi retras sau reacordat în ALT tab (același localStorage, dar
 * `consent-updated` nu trece dintr-un tab în altul). Fără verificarea asta,
 * tab-ul de aici rămânea „în captură”: trimitea evenimente după revocare, iar
 * un reset() al lui (ieșirea din cont, pe care Supabase o propagă în toate
 * tab-urile) ȘTERGEA refuzul comun al SDK-ului și repornea captura și în
 * celelalte. Întoarce true dacă se poate captura acum.
 */
function stillConsented(): boolean {
  if (!hasPerformanceConsent()) {
    revoke()
    return false
  }
  if (ph && capturing) syncConsentGeneration(ph)
  return capturing
}

/**
 * Schimbarea acordului din alt tab, aflată imediat: evenimentul `storage` vine
 * doar din ALTE tab-uri (inclusiv `clear()` / ștergerea datelor site-ului).
 * Retragerea e idempotentă; o acordare pornește (sau reia) captura și aici — fără
 * ea, `track()` umplea o coadă pe care n-o golea nimeni.
 */
function handleStorage(): void {
  if (!hasPerformanceConsent()) {
    revoke()
    return
  }
  if (ph && capturing) {
    syncConsentGeneration(ph)
    return
  }
  maybeStart()
}

/**
 * Ruta s-a schimbat în același document: pornirea sărită pe o pagină de oaspete
 * (meniul deschis primul) se reîncearcă pe o pagină Menuvia. Garda de oaspete
 * rămâne în `maybeStart`.
 */
function handleRouteChange(): void {
  maybeStart()
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
    // Salvat din nou în ACEST tab, fără retragere între timp (o retragere de aici
    // ar fi oprit captura): aceeași identitate, generația nouă devine cea curentă.
    capturingGeneration = consentGeneration()
    applyIdentity(ph)
    return
  }
  maybeStart()
}

/**
 * Instalează (o singură dată) ascultătorii: `consent-updated` (acest tab),
 * `storage` (alte tab-uri) și schimbarea de rută. Main.tsx îl cheamă SINCRON la
 * boot: un acord sau o revocare de dinaintea idle-ului nu are voie să treacă
 * neauzit (un ascultător adăugat în timpul dispecerizării nu primește
 * evenimentul curent).
 */
export function installAnalyticsConsentListener(): void {
  if (listenerInstalled || typeof window === 'undefined') return
  window.addEventListener('consent-updated', handleConsentUpdate)
  window.addEventListener('storage', handleStorage)
  window.addEventListener(ROUTE_CHANGE_EVENT, handleRouteChange)
  listenerInstalled = true
}

/**
 * Pornirea (main.tsx o cheamă la idle): ascultătorii + PostHog, dacă acordul e
 * deja dat și AuthContext a răspuns. Fără acord nu descarcă nimic. Idempotentă.
 */
export function initAnalytics(): void {
  installAnalyticsConsentListener()
  armed = true
  maybeStart()
}

/**
 * Contul curent (din AuthContext): `user.id` la autentificare, `null` la ieșire
 * sau fără sesiune. Primul răspuns deblochează pornirea; după, identitatea se
 * realiniază. Evenimentele din coadă emise sub alt cont se aruncă. Fără
 * consimțământ nu ajunge nicăieri.
 */
export function setAnalyticsUser(userId: string | null): void {
  if (userId === desiredUserId) return
  const firstAnswer = desiredUserId === undefined
  desiredUserId = userId
  // Ce s-a emis înaintea primului răspuns aparține sesiunii care s-a rezolvat;
  // ce s-a emis sub ALT cont nu pleacă sub cel de acum.
  queue = queue
    .map((item) => (item.uid === undefined ? { ...item, uid: userId } : item))
    .filter((item) => item.uid === userId)
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
 * AuthContext n-a putut afla sesiunea (`getSession` cu eroare sau aruncat): pe
 * ecran nu e nimeni logat, dar analytics rămâne NErezolvat — un `null` ar face
 * reset() și un page view anonim pentru un cont poate încă logat. Ce se emite DE
 * ACUM aparține ecranului fără cont, nu sesiunii care se va rezolva: intră în
 * coadă ca „nimeni logat”, deci contul care intră apoi (alt om, pe aceeași
 * tabletă) nu-l preia drept al lui. Ce s-a emis ÎNAINTE (primele milisecunde ale
 * încărcării) rămâne al sesiunii care se rezolvă. Fără efect după primul răspuns.
 */
export function setAnalyticsAuthUnresolved(): void {
  if (desiredUserId === undefined) authUnresolvedAfterError = true
}

/**
 * Acordul dat în această pagină FĂRĂ cont trece la contul tocmai CREAT aici
 * (AuthPage, după `signUp`). Cu confirmarea emailului pornită `signUp` nu dă
 * sesiune, deci în pagina asta nu se autentifică nimeni, iar contul nou se
 * deschide din link într-un document NOU, unde acordul nelegat nu mai poate fi
 * preluat — contul n-ar fi fost măsurat deloc. Fără efect dacă acordul nu e
 * nelegat din această pagină (dat de un cont logat, la o vizită anterioară, sau
 * deja preluat).
 */
export function bindPendingConsentToAccount(userId: string): void {
  if (!pendingConsentOwner || typeof desiredUserId === 'string') return
  pendingConsentOwner = false
  if (hasPerformanceConsent()) writeLocal(CONSENT_OWNER_KEY, userId)
}

/**
 * Marchează contul curent ca intern (`$internal_or_test_user`), ca traficul
 * fondatorului să poată fi filtrat. Un răspuns întârziat pentru alt cont e
 * ignorat. (Un cont care nu e al acordului nu e capturat deloc, deci nici
 * traficul nemarcat al fondatorului nu pleacă.)
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
 * Contextul panoului (DashboardPage): localul, nivelul planului și rolul — fără
 * ele nu se pot separa proprietarii de ospătari, Planul 1 de Planul 2/3, sau
 * locațiile unui owner cu mai multe localuri. Ținut în memorie și atașat
 * fiecărui eveniment de before_send (NU persistat în SDK); `null` la ieșirea din
 * panou îl scoate de pe evenimentele următoare.
 */
export function setAnalyticsContext(context: AnalyticsContext | null): void {
  if (sameContext(context, dashboardContext)) return
  dashboardContext = context === null ? null : { ...context }
  // Garda de acord: calea poate fi prima după o revocare din alt tab (AN24).
  if (ph && capturing) stillConsented()
}

function makeItem(
  event: AppEvent,
  properties: AnalyticsProps | undefined,
  sendInstantly: boolean,
): QueuedEvent {
  eventSeq += 1
  return {
    id: `${DOCUMENT_ID}:${eventSeq}`,
    event,
    properties,
    sendInstantly,
    // După un `getSession` eșuat, ecranul arată „nimeni logat”: evenimentul e al lui.
    uid: desiredUserId === undefined && authUnresolvedAfterError ? null : desiredUserId,
    context: dashboardContext === null ? null : { ...dashboardContext },
    gen: consentGeneration(),
    at: Date.now(),
  }
}

/**
 * Emite un eveniment de afacere. No-op fără consimțământ, fără cheie sau pe un
 * cont care nu e al acordului; cu consimțământ dat dar PostHog încă neîncărcat,
 * evenimentul așteaptă în coadă (cu contul, contextul și acordul de acum) —
 * întoarcerea din Stripe se poate confirma înaintea încărcării. Proprietăți
 * DOAR non-PII (clichetul AE2): id-uri interne, plan, sursă, numere.
 */
export function track(event: AppEvent, properties?: AnalyticsProps, options?: TrackOptions): void {
  const item = makeItem(event, properties, options?.sendInstantly === true)
  if (ph && capturing) {
    if (stillConsented()) send(ph, item, false)
    return
  }
  if (!readEnv() || item.gen === null || !accountMayCapture()) return
  if (queue.length >= QUEUE_LIMIT) return
  queue.push(item)
  if (item.sendInstantly) handOff(item)
  // Acordul poate fi dat în alt tab fără ca `storage` să fi ajuns aici.
  maybeStart()
}

function currentUid(): string | null {
  return typeof desiredUserId === 'string' ? desiredUserId : null
}

/**
 * Chemat imediat înainte de redirectul spre Stripe Checkout: notează planul,
 * contul curent (sau null) și momentul, în sessionStorage. Fără acordul
 * „Performanță” nu scrie nimic: marcajul servește doar statisticilor, iar fără
 * acord `subscription_started` nu pleacă oricum. Eșecul storage-ului = no-op.
 */
export function noteCheckoutRedirect(plan: string): void {
  if (!hasPerformanceConsent()) return
  try {
    sessionStorage.setItem(
      CHECKOUT_REDIRECT_KEY,
      JSON.stringify({ plan, uid: currentUid(), at: Date.now() }),
    )
  } catch {
    /* RESID-15: fără marcaj, întoarcerea nu se poate deduplica */
  }
}

/**
 * Citește ȘI șterge marcajul lui `noteCheckoutRedirect`. Adevărat doar dacă
 * există, e pentru ACELAȘI plan, pentru ACELAȘI cont ca acum (sau ambele null)
 * și are cel mult 24 h. Contul de acum = ultimul publicat de AuthContext (înainte
 * de primul răspuns contează ca null). Orice eroare de storage = false.
 */
export function takeCheckoutRedirect(plan: string): boolean {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_REDIRECT_KEY)
    if (raw === null) return false
    sessionStorage.removeItem(CHECKOUT_REDIRECT_KEY)
    const marker = JSON.parse(raw) as unknown
    if (!isRecord(marker) || marker.plan !== plan) return false
    const uid = marker.uid
    if (uid !== null && typeof uid !== 'string') return false
    if (uid !== currentUid()) return false
    if (typeof marker.at !== 'number' || !Number.isFinite(marker.at)) return false
    const age = Date.now() - marker.at
    return age >= -CLOCK_SKEW_MS && age <= CHECKOUT_REDIRECT_MAX_AGE_MS
  } catch {
    return false
  }
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
    window.removeEventListener(ROUTE_CHANGE_EVENT, handleRouteChange)
  }
  ph = null
  initInFlight = false
  capturing = false
  capturingGeneration = null
  listenerInstalled = false
  armed = false
  desiredUserId = undefined
  authUnresolvedAfterError = false
  appliedUserId = null
  identityOwner = null
  internalUserId = null
  internalAppliedFor = null
  pendingConsentOwner = false
  entryCampaign = {}
  dashboardContext = null
  captureOverride = null
  queue = []
  initPromise = Promise.resolve()
}

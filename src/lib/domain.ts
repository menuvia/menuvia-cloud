// src/lib/domain.ts
// ─────────────────────────────────────────────────────────────
// Site-ul curent (menuvia.ro vs un host .com) și domeniile platformei —
// sursa UNICĂ pe client. Decizie de fondator: UN cod, UN deploy; site-ul se
// alege la RUNTIME pe `window.location.hostname` (Netlify servește același
// bundle pe orice domeniu atașat, ca la white-label).
//
//   'ro'  → menuvia.ro: română, RON, toate cele 3 planuri. ORICE host care nu
//           e explicit .com cade aici (localhost, deploy preview-uri,
//           *.netlify.app, staging, domeniile de agenție) — comportamentul de
//           azi rămâne neschimbat peste tot unde nu s-a cerut altfel.
//   'com' → un host .com al platformei: engleză unde există copy EN, EUR,
//           DOAR Planurile 1–2 (Plan 3 = fiscalizare RO).
//
// DOMENIUL .com NU ne aparține (decizia D3, docs/dosar/04): hostul .com e
// recunoscut DOAR pentru DETECȚIE (ce limbă/piață afișăm dacă bundle-ul ajunge
// vreodată pe un asemenea host). NICIUN URL generat de aplicație — QR, link de
// meniu, referral, redirect de autentificare, PDF — nu duce spre el: baza lor
// cade pe menuvia.ro (`siteOrigin()`/`siteHost()` nu mai primesc un site).
//
// Funcțiile sunt PURE (primesc hostname-ul), ca să fie testabile fără DOM.
// `browserSite()` e singurul punct care citește `window`.
// ─────────────────────────────────────────────────────────────

export type Site = 'ro' | 'com'

export const SITE_HOSTS: Readonly<Record<Site, string>> = {
  ro: 'menuvia.ro',
  com: 'menuvia.com',
}

/** Domeniile-rădăcină ale platformei (pe ele NU se face white-label). */
export const MENUVIA_ROOT_DOMAINS: readonly string[] = [SITE_HOSTS.ro, SITE_HOSTS.com]

// Adresele de contact afișate în UI. Rămân pe domeniul .ro pe ambele site-uri:
// e singurul domeniu cu email configurat (Resend + MX).
export const CONTACT_EMAIL = `contact@${SITE_HOSTS.ro}`
export const PILOT_EMAIL = `pilot@${SITE_HOSTS.ro}`

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '')
}

function isUnder(host: string, root: string): boolean {
  return host === root || host.endsWith('.' + root)
}

/** Site-ul pentru un hostname. Tot ce nu e un host .com al platformei → 'ro'. */
export function currentSite(hostname: string): Site {
  return isUnder(normalizeHost(hostname), SITE_HOSTS.com) ? 'com' : 'ro'
}

/**
 * Hostname-ul public al platformei (fără protocol), ex. pentru „menuvia.ro/m/slug”.
 * Mereu .ro: nu există un hostname public .com pe care să-l tipărim.
 */
export function siteHost(): string {
  return SITE_HOSTS.ro
}

/** Originea canonică a platformei — mereu .ro (vezi nota de sus). */
export function siteOrigin(): string {
  return `https://${SITE_HOSTS.ro}`
}

/** True pentru domeniile platformei (.ro și .com, DETECȚIE) și orice subdomeniu al lor. */
export function isMenuviaRootHost(hostname: string): boolean {
  const h = normalizeHost(hostname)
  return MENUVIA_ROOT_DOMAINS.some((root) => isUnder(h, root))
}

/** Limba implicită a interfeței de marketing/cont pe site (fără alegere explicită). */
export function defaultUiLang(site: Site): 'ro' | 'en' {
  return site === 'com' ? 'en' : 'ro'
}

/** Site-ul ferestrei curente; 'ro' fără DOM (teste, SSR). */
export function browserSite(): Site {
  if (typeof window === 'undefined' || !window.location) return 'ro'
  return currentSite(window.location.hostname)
}

// ── Baza link-urilor generate de aplicație ───────────────────
// `VITE_APP_URL` e fixat în netlify.toml pe contextul production la originea
// .ro. Pe 'ro' comportamentul rămâne EXACT cel de dinainte
// (`VITE_APP_URL || origin`). Pe un host 'com' baza NU e niciodată .com:
// `VITE_APP_URL` dacă e setat, altfel originea .ro. Funcții PURE: apelantul le
// dă hostname-ul, valoarea lui `import.meta.env.VITE_APP_URL` și
// `window.location.origin`.

function legacyBase(viteAppUrl: string | null | undefined, origin: string): string {
  return viteAppUrl || origin
}

/** Baza pe un host 'com': niciodată .com — VITE_APP_URL sau originea .ro. */
function comHostBase(viteAppUrl: string | null | undefined): string {
  return viteAppUrl || siteOrigin()
}

/**
 * Baza pentru redirect-urile de AUTENTIFICARE (confirmarea de signup, resetarea
 * parolei): pe 'ro' `VITE_APP_URL || origin`; pe un host 'com' tot .ro (nu
 * generăm redirect-uri spre .com).
 */
export function authRedirectBase(
  hostname: string,
  viteAppUrl: string | null | undefined,
  origin: string,
): string {
  return currentSite(hostname) === 'com' ? comHostBase(viteAppUrl) : legacyBase(viteAppUrl, origin)
}

/**
 * Baza pentru URL-urile PUBLICE tipărite/distribuite (QR-ul mesei, linkul
 * meniului): pe 'ro' `VITE_APP_URL || origin`; pe un host 'com' tot .ro — un QR
 * tipărit nu are voie să poarte domeniul .com (nu ne aparține) și nici un
 * subdomeniu întâmplător.
 */
export function publicBaseUrl(
  hostname: string,
  viteAppUrl: string | null | undefined,
  origin: string,
): string {
  return currentSite(hostname) === 'com' ? comHostBase(viteAppUrl) : legacyBase(viteAppUrl, origin)
}

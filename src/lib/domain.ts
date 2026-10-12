// src/lib/domain.ts
// ─────────────────────────────────────────────────────────────
// Site-ul curent (menuvia.ro vs menuvia.com) și domeniile platformei —
// sursa UNICĂ pe client. Decizie de fondator: UN cod, UN deploy; site-ul se
// alege la RUNTIME pe `window.location.hostname` (Netlify servește același
// bundle pe orice domeniu atașat, ca la white-label).
//
//   'ro'  → menuvia.ro: română, RON, toate cele 3 planuri. ORICE host care nu
//           e explicit .com cade aici (localhost, deploy preview-uri,
//           *.netlify.app, staging, domeniile de agenție) — comportamentul de
//           azi rămâne neschimbat peste tot unde nu s-a cerut altfel.
//   'com' → menuvia.com, www.menuvia.com, *.menuvia.com: engleză unde există
//           copy EN, EUR, DOAR Planurile 1–2 (Plan 3 = fiscalizare RO).
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

/** Site-ul pentru un hostname. Tot ce nu e menuvia.com (sau subdomeniu) → 'ro'. */
export function currentSite(hostname: string): Site {
  return isUnder(normalizeHost(hostname), SITE_HOSTS.com) ? 'com' : 'ro'
}

/** Hostname-ul public al site-ului (fără protocol), ex. pentru „menuvia.ro/m/slug”. */
export function siteHost(site: Site): string {
  return SITE_HOSTS[site]
}

/** Originea canonică a site-ului. */
export function siteOrigin(site: Site): string {
  return `https://${SITE_HOSTS[site]}`
}

/** True pentru menuvia.ro / menuvia.com și orice subdomeniu al lor. */
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

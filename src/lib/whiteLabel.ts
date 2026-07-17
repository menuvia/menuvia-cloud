// White-label v1 (mig 236) — detecția domeniului de agenție la runtime.
// Netlify servește ACELAȘI bundle pe orice domeniu atașat (CNAME), deci
// decizia se ia pe window.location.hostname la boot, nu la build
// (VITE_APP_URL e fix per deploy). Pe un domeniu non-Menuvia, meniul public
// înlocuiește badge-ul „Creat cu Menuvia" cu brandingul agenției, citit prin
// RPC-ul public resolve_agency_branding (doar afiliați activi).
import { supabase } from './supabase'

export interface AgencyBranding {
  name: string
  logoUrl: string | null
}

// Domeniile platformei — pe ele NU se face white-label niciodată.
function isMenuviaHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return true
  if (h === 'menuvia.ro' || h.endsWith('.menuvia.ro')) return true
  if (h.endsWith('.netlify.app')) return true
  // Hostname-ul din VITE_APP_URL (prod/staging/preview) e mereu „al nostru".
  try {
    const appHost = new URL(import.meta.env.VITE_APP_URL || 'https://menuvia.netlify.app').hostname
    if (h === appHost.toLowerCase()) return true
  } catch {
    /* VITE_APP_URL malformat — ne bazăm pe listele de mai sus */
  }
  return false
}

export function isCustomDomain(): boolean {
  return !isMenuviaHost(window.location.hostname)
}

// Cache pe durata sesiunii de tab: un singur RTT per domeniu, indiferent câte
// pagini de meniu se deschid. Promisiunea e memoizată la nivel de modul ca
// apelurile concurente (PublicMenuPage + QrMenuPage) să nu dubleze fetch-ul.
let cached: Promise<AgencyBranding | null> | null = null

export function fetchAgencyBranding(): Promise<AgencyBranding | null> {
  if (!isCustomDomain()) return Promise.resolve(null)
  if (cached) return cached
  const pending: Promise<AgencyBranding | null> = supabase
    .rpc('resolve_agency_branding', { p_domain: window.location.hostname })
    .then(({ data, error }) => {
      // Orice eroare (inclusiv migrația neaplicată încă) = fallback tăcut la
      // badge-ul Menuvia — brandingul e cosmetic, nu blochează meniul.
      if (error || !Array.isArray(data) || data.length === 0) return null
      const row = data[0] as { brand_name: string | null; brand_logo_url: string | null }
      if (!row.brand_name) return null
      return { name: row.brand_name, logoUrl: row.brand_logo_url }
    })
    .then(
      (v) => v,
      () => null,
    )
  cached = pending
  return pending
}

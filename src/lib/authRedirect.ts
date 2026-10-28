// src/lib/authRedirect.ts
// Parametrul `?next=` de pe /auth: „întoarce-mă unde eram după login".
//
// Un redirect pe valoare din URL este un open-redirect clasic dacă valoarea nu
// e strict o cale INTERNĂ. Aici se decide într-un singur loc (pur, testat):
// doar o cale relativă la origine, care începe cu UN singur `/`, fără schemă,
// fără `//` sau `/\` (browserul le tratează ca „același protocol, alt host"),
// fără caractere de control / spații / backslash (browserul scoate tab-urile
// și newline-urile din URL, deci `/\t/evil.com` devine `//evil.com`), fără
// variantele PERCENT-codificate ale aceleiași capcane și fără ruta /auth însăși
// (buclă). Orice altceva → null = „fără destinație cerută", se aplică
// destinația obișnuită pe roluri.

const MAX_NEXT_LENGTH = 300

/**
 * Caractere de control, spații sau backslash. Fără regex cu `\u0000-\u001f`:
 * `no-control-regex` (eslint:recommended) îl interzice, iar `--max-warnings 0`
 * ar face din asta o eroare de build.
 */
function hasUnsafeChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true
    if (/\s/.test(value[i])) return true
  }
  return false
}

function startsWithSecondSlash(path: string): boolean {
  return path[1] === '/' || path[1] === '\\'
}

/** Cale internă sigură sau null. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return null
  if (raw[0] !== '/') return null
  if (startsWithSecondSlash(raw)) return null
  if (hasUnsafeChars(raw)) return null

  // Aceleași reguli și pe forma DECODATĂ (de două ori: %252f%252f). Un
  // percent-encoding malformat la PRIMA decodare nu are ce căuta într-o cale a
  // noastră; la a doua (ex. `%25` rămas literal) înseamnă doar că nu mai e
  // nimic de decodat.
  let decoded = raw
  for (let i = 0; i < 2; i++) {
    try {
      decoded = decodeURIComponent(decoded)
    } catch {
      if (i === 0) return null
      break
    }
    if (decoded[0] !== '/' || startsWithSecondSlash(decoded)) return null
    if (hasUnsafeChars(decoded)) return null
  }

  // Plasa finală: rezolvată față de o origine fictivă, ținta rămâne pe ea.
  try {
    const base = 'https://next.invalid'
    if (new URL(raw, base).origin !== base) return null
  } catch {
    return null
  }

  const pathname = raw.split(/[?#]/)[0]
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return null
  return raw
}

/** `next` din query string (`?a=b&next=/x`), validat. */
export function nextFromSearch(search: string): string | null {
  try {
    return safeNextPath(new URLSearchParams(search).get('next'))
  } catch {
    return null
  }
}

/**
 * Calea spre /auth care readuce omul unde era. Rădăcina, /auth și /dashboard
 * FĂRĂ parametri nu merită `next`: primele nu au nimic de readus, iar /dashboard
 * e hub-ul implicit — acolo decide rolul (un agent fără restaurant ajunge pe
 * panoul lui, nu pe onboarding; lib/postLogin.ts). O cale nesigură cade pe /auth.
 */
export function authPathWithNext(pathname: string, search = ''): string {
  if (pathname === '/' || pathname === '') return '/auth'
  if (pathname === '/dashboard' && (search === '' || search === '?')) return '/auth'
  const next = safeNextPath(pathname + search)
  return next ? '/auth?next=' + encodeURIComponent(next) : '/auth'
}

// netlify/functions/lib/emailLang.js
// Limba și fusul unui email, rezolvate la TRIMITERE (lotul L8a).
//
// Oglinda serverului a regulilor din client:
//   • `STAFF_LANGS` / `ENABLED_STAFF_LANGS` / `FUNNEL_LANGS` = `src/i18n/langs.ts`
//     (testul EL5 le compară): un email NU apare într-o limbă pe care panoul
//     n-o oferă încă — patronul cu `ui_language = 'en'` primește româna cât timp
//     engleza nu e activată pentru personal, exact ca panoul lui.
//   • `GUEST_LANGS` = cele 7 limbi ale meniului (CHECK-ul `restaurants.language`
//     din mig 298 și `MENU_LANGS` din `src/lib/i18nMenu.ts`).
//   • `safeTimeZone` = `safeTimeZone` din `src/lib/dates.ts` (și
//     `safe_time_zone` din SQL): lipsă sau invalid → București.
//
// Interogările sunt TOLERANTE: orice eroare (inclusiv 42703 pe o bază fără
// mig 323 / 296) dă o hartă goală, adică româna + București — exact ce pleca
// înainte. Nu aruncă niciodată: un șablon care aruncă face rândul `failed`.
'use strict'

const STAFF_LANGS = Object.freeze(['ro', 'en', 'fr', 'de'])
// O limbă intră aici abia când intră și în `src/i18n/langs.ts` (EL5).
const ENABLED_STAFF_LANGS = Object.freeze(['ro'])
// Aceeași regulă ca în langs.ts: româna, engleza (funnel-ul /en) + orice limbă
// activată pentru personal.
const FUNNEL_LANGS = Object.freeze(
  STAFF_LANGS.filter((l) => l === 'ro' || l === 'en' || ENABLED_STAFF_LANGS.includes(l)),
)
const GUEST_LANGS = Object.freeze(['ro', 'en', 'de', 'fr', 'it', 'hu', 'es'])
const DEFAULT_TZ = 'Europe/Bucharest'
const LOCALES = Object.freeze({
  ro: 'ro-RO',
  en: 'en-GB',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  hu: 'hu-HU',
  es: 'es-ES',
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v)
}

/** Subeticheta primară, lowercase ('EN-gb' → 'en'); orice altceva → null. */
function primaryTag(v) {
  if (typeof v !== 'string') return null
  const m = /^([A-Za-z]{2,3})(?:[-_].*)?$/.exec(v.trim())
  return m ? m[1].toLowerCase() : null
}

/** Limba din `list`, sau null. */
function langIn(v, list) {
  const p = primaryTag(v)
  return p && list.includes(p) ? p : null
}

/** Limba personalului: doar o limbă ACTIVĂ; altfel română. */
function staffEmailLang(v, enabled = ENABLED_STAFF_LANGS) {
  return langIn(v, enabled) || 'ro'
}

/** Limba funnel-ului (welcome-email): ro/en + limbile active; altfel română. */
function funnelEmailLang(v) {
  return langIn(v, FUNNEL_LANGS) || 'ro'
}

/** Limba oaspetelui: una din cele 7 ale meniului; altfel română. */
function guestEmailLang(v) {
  return langIn(v, GUEST_LANGS) || 'ro'
}

/**
 * Limba unui mesaj către OASPETE (lotul L8b, SMS + reminderul pe email): cea
 * STOCATĂ pe rezervare (`reservations.guest_language`, mig 328 — limba în care a
 * văzut formularul) → limba de bază a localului → română. Doar cele 7 limbi ale
 * meniului; o valoare stocată necunoscută cade pe limba localului, nu pe română.
 */
function resolveGuestLang(stored, restaurantLanguage) {
  return langIn(stored, GUEST_LANGS) || langIn(restaurantLanguage, GUEST_LANGS) || 'ro'
}

/**
 * Limba invitației: alegerea INVITATULUI (dacă are deja cont), apoi a
 * invitatorului, apoi româna — toate pe limbile ACTIVE. O alegere explicită
 * 'ro' a invitatului câștigă (nu se confundă cu „fără alegere”).
 */
function resolveInviteLang({ invitee, inviter } = {}, enabled = ENABLED_STAFF_LANGS) {
  return langIn(invitee, enabled) || langIn(inviter, enabled) || 'ro'
}

/**
 * Eticheta BCP 47 a formatării: oglinda `staffLocale` din `src/i18n/format.ts`
 * (limbă + țară doar pe potrivire EXACTĂ a motorului, altfel varianta
 * europeană). Româna rămâne MEREU ro-RO: așa pleca orice email până acum, iar
 * oracolul byte (EO1) îl îngheață.
 */
function emailLocale(lang, country) {
  const base = LOCALES[lang] || LOCALES.ro
  if (lang === 'ro' || !LOCALES[lang]) return base
  const c = typeof country === 'string' && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null
  if (c) {
    const candidate = `${lang}-${c}`
    try {
      if (new Intl.DateTimeFormat(candidate).resolvedOptions().locale === candidate) return candidate
    } catch {
      /* etichetă respinsă de Intl — varianta implicită */
    }
  }
  return base
}

/** Fusul localului: lipsă sau invalid → București (oglinda clientului). */
function safeTimeZone(tz) {
  if (typeof tz !== 'string' || tz === '') return DEFAULT_TZ
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return DEFAULT_TZ
  }
}

function uniqueUuids(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(isUuid))]
}

/**
 * `profiles.ui_language` pentru id-urile date: `Map<id, ui_language>`.
 * Interogare SEPARATĂ (doar `id, ui_language`): pe o bază fără mig 323 coloana
 * lipsește (42703), iar un select comun cu alte coloane le-ar pierde și pe ele.
 */
async function fetchUiLanguages(supabase, ids) {
  const out = new Map()
  const list = uniqueUuids(ids)
  if (list.length === 0) return out
  try {
    const { data, error } = await supabase.from('profiles').select('id, ui_language').in('id', list)
    if (error) {
      console.warn('[emailLang] ui_language indisponibil, emailurile rămân în română:', error.code || error.message)
      return out
    }
    if (Array.isArray(data)) {
      for (const row of data) {
        if (row && isUuid(row.id)) out.set(row.id, row.ui_language)
      }
    }
  } catch (e) {
    console.warn('[emailLang] ui_language indisponibil, emailurile rămân în română:', e && e.message)
  }
  return out
}

/**
 * Fusul, limba de bază și țara restaurantelor: `Map<id, {timezone, language, country}>`.
 * Bază fără mig 296 (fără `country`) → a doua încercare fără coloană; a doua
 * eroare → hartă goală (București, română).
 */
async function fetchRestaurantsRegional(supabase, ids) {
  const out = new Map()
  const list = uniqueUuids(ids)
  if (list.length === 0) return out
  const attempt = async (cols) => {
    const { data, error } = await supabase.from('restaurants').select(cols).in('id', list)
    if (error) return { ok: false, error }
    if (Array.isArray(data)) {
      for (const row of data) {
        if (row && isUuid(row.id)) {
          out.set(row.id, {
            timezone: row.timezone,
            language: row.language,
            country: row.country === undefined ? null : row.country,
          })
        }
      }
    }
    return { ok: true }
  }
  try {
    let r = await attempt('id, timezone, language, country')
    if (!r.ok) r = await attempt('id, timezone, language')
    if (!r.ok) {
      console.warn('[emailLang] fusul restaurantelor indisponibil, orele rămân pe București:', r.error.code || r.error.message)
      out.clear()
    }
  } catch (e) {
    console.warn('[emailLang] fusul restaurantelor indisponibil, orele rămân pe București:', e && e.message)
    out.clear()
  }
  return out
}

module.exports = {
  STAFF_LANGS,
  ENABLED_STAFF_LANGS,
  FUNNEL_LANGS,
  GUEST_LANGS,
  DEFAULT_TZ,
  LOCALES,
  isUuid,
  staffEmailLang,
  funnelEmailLang,
  guestEmailLang,
  resolveGuestLang,
  resolveInviteLang,
  emailLocale,
  safeTimeZone,
  fetchUiLanguages,
  fetchRestaurantsRegional,
}

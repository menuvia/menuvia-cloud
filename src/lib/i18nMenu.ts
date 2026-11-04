// ─────────────────────────────────────────────────────────────
// i18nMenu — meniu multilingv (traduceri manuale)
//
// Originalul stă în coloanele `name` / `description` ale produselor și
// categoriilor, în LIMBA DE BAZĂ a restaurantului (`restaurants.language`,
// editabilă din mig 298; implicit `ro`). Lotul O6a: înainte româna era fixată
// ca bază peste tot, deci un local cu meniul scris în franceză apărea
// oaspeților ca „Română” și nu-și putea adăuga o traducere în română.
// Traducerile pentru celelalte limbi trăiesc în coloana jsonb `translations`
// (cheia = codul de limbă → { name?, description? }), inclusiv `ro` când
// baza e alta.
//
// Helper-ele de mai jos sunt PURE și fac fallback la original când
// traducerea lipsește sau e goală — clientul nu rămâne niciodată cu un
// câmp gol dacă restaurantul n-a tradus încă un produs.
// ─────────────────────────────────────────────────────────────

export interface MenuLang {
  code: string
  label: string
  flag: string
}

// Normalizare pentru căutare în meniu: fără diacritice, lowercase — ca un
// client care tastează „ciorba" să găsească „Ciorbă". Regex compilat o dată la
// nivel de modul. Partajat între meniul public și cel QR (consistență).
const MENU_DIACRITICS_RE = /\p{Diacritic}/gu
export function normalizeMenuSearch(s: string): string {
  return s.normalize('NFD').replace(MENU_DIACRITICS_RE, '').toLowerCase()
}

// Limbile cunoscute ale meniului (CHECK-ul din mig 298 are aceleași 7).
export const MENU_LANGS: MenuLang[] = [
  { code: 'ro', label: 'Română', flag: '🇷🇴' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'hu', label: 'Magyar', flag: '🇭🇺' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
]

/** Limba de bază a meniului: `restaurants.language` dacă e cunoscută, altfel `ro`. */
export function menuBaseLang(language: string | null | undefined): string {
  return MENU_LANGS.some((l) => l.code === language) ? (language as string) : 'ro'
}

// Structura coloanei `translations` (products/categories): cheia = cod de
// limbă (`en`, `de`, …), valoarea = câmpurile traduse (opționale).
// `meta_text` = subtitlul categoriei (lotul O6b; doar pe categorii).
export type Translations = Record<string, { name?: string; description?: string; meta_text?: string }>

// Întoarce numele localizat al unui produs/categorie pe limba cerută.
// Fallback la original (coloana `name`) pentru `ro`, lipsă traducere sau
// traducere goală (string gol după trim).
export function trName(
  item: { name: string; translations?: Translations | null },
  lang: string,
  base = 'ro',
): string {
  if (lang === base) return item.name
  const t = item.translations?.[lang]?.name
  if (typeof t === 'string' && t.trim().length > 0) return t
  return item.name
}

// Întoarce descrierea localizată. Fallback la original (`description`) pe
// aceeași regulă. Poate întoarce null dacă originalul e null și nu există
// traducere validă.
export function trDesc(
  item: { description: string | null; translations?: Translations | null },
  lang: string,
  base = 'ro',
): string | null {
  if (lang === base) return item.description
  const t = item.translations?.[lang]?.description
  if (typeof t === 'string' && t.trim().length > 0) return t
  return item.description
}

// Subtitlul localizat al unei categorii (lotul O6b): `translations[lang].meta_text`,
// altfel originalul.
export function trMeta(
  item: { meta_text: string | null; translations?: Translations | null },
  lang: string,
  base = 'ro',
): string | null {
  if (lang === base) return item.meta_text
  const t = item.translations?.[lang]?.meta_text
  if (typeof t === 'string' && t.trim().length > 0) return t
  return item.meta_text
}

// Limbile EXTRA (fără `ro`) în care meniul chiar e tradus — derivate din
// conținutul real, nu dintr-un flag de restaurant. Astfel switcher-ul de pe
// meniul clientului apare EXACT pentru limbile care au măcar o traducere
// nevidă (nume sau descriere) pe un produs/categorie. Evită dependența de o
// coloană expusă prin RPC și e mai onest cu clientul (nu oferă o limbă goală).
// Ordinea urmează MENU_LANGS. `categories` = catalogul deja adus în client.
// `allowed` (opțional) = `restaurant.menu_languages`: limbile pe care
// restaurantul le OFERĂ efectiv. Când e ne-vidă, intersectăm — o limbă
// DESELECTATĂ din setări (dar cu traduceri orfane rămase în `translations`) NU
// mai apare clienților. Când e vidă/null (restaurant care n-a configurat încă
// `menu_languages`), cădem pe derivarea din conținut (fără regresie).
export function availableMenuLangs(
  categories: {
    translations?: Translations | null
    products?: { translations?: Translations | null }[]
  }[],
  allowed?: string[] | null,
  base = 'ro',
): string[] {
  const allow = allowed && allowed.length > 0 ? new Set(allowed) : null
  const found = new Set<string>()
  const scan = (tr: Translations | null | undefined): void => {
    if (!tr) return
    for (const code of Object.keys(tr)) {
      if (code === base) continue
      const v = tr[code]
      if (
        (typeof v?.name === 'string' && v.name.trim().length > 0) ||
        (typeof v?.description === 'string' && v.description.trim().length > 0)
      ) {
        found.add(code)
      }
    }
  }
  for (const c of categories) {
    scan(c.translations)
    for (const p of c.products ?? []) scan(p.translations)
  }
  // Păstrează doar limbile cunoscute, în ordinea din MENU_LANGS (fără bază),
  // intersectate cu limbile oferite de restaurant dacă lista e configurată.
  return MENU_LANGS.filter(
    (l) => l.code !== base && found.has(l.code) && (!allow || allow.has(l.code)),
  ).map((l) => l.code)
}

// Detectează limba browserului turistului și o întoarce DOAR dacă meniul chiar
// e tradus în ea (e printre `available`). Astfel un client german care scanează
// QR-ul vede meniul direct în germană, fără să caute switcher-ul. `ro` nu se
// auto-selectează (e deja baza). Întoarce null dacă nicio potrivire.
export function detectBrowserLang(available: string[], base = 'ro'): string | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator as Navigator & { languages?: readonly string[] }
  const prefs = nav.languages && nav.languages.length > 0 ? nav.languages : [nav.language]
  const avail = new Set(available)
  for (const raw of prefs) {
    if (!raw) continue
    const code = raw.toLowerCase().split('-')[0] // 'de-DE' → 'de'
    // Prima preferință pe care meniul o are câștigă: dacă e chiar originalul,
    // oaspetele rămâne pe el (un francez pe un meniu francez nu e mutat pe a
    // doua lui limbă, engleza).
    if (code === base) return null
    if (avail.has(code)) return code
  }
  return null
}

// Limbile pentru care dashboard-ul oferă câmpuri de traducere: cele ACTIVE din
// `restaurant.menu_languages`, fără `ro` (originalul stă în coloana `name`),
// fără coduri necunoscute și fără duplicate, în ordinea din MENU_LANGS.
// Listă vidă/null → zero câmpuri (restaurantul n-a configurat limbi).
export function activeTranslationLangs(
  menuLanguages: readonly string[] | null | undefined,
  base = 'ro',
): string[] {
  if (!menuLanguages || menuLanguages.length === 0) return []
  const wanted = new Set(menuLanguages)
  return MENU_LANGS.filter((l) => l.code !== base && wanted.has(l.code)).map((l) => l.code)
}

// Editorul MANUAL de traduceri pentru categorii (CategoriesTab): aplică numele
// tastate pentru limbile ACTIVE peste `translations` existent, fără să piardă
// nimic din rest:
// - limbile care NU sunt active (deselectate din setări, dar cu traduceri deja
//   scrise — de mână sau de AI) rămân NEATINSE: o deselectare temporară a unei
//   limbi nu are voie să șteargă munca de traducere;
// - celelalte câmpuri ale unei intrări active (ex. `description`) se păstrează —
//   editorul scrie doar `name`;
// - un nume gol (după trim) șterge DOAR `name` din intrare; intrarea rămasă
//   goală dispare (clientul face fallback pe română, ca la produse);
// - numele trimise pentru limbi NEactive sunt ignorate (nu se scrie ce omul
//   n-a văzut pe ecran).
// Pură: nu mută `existing`. Diferită de merge-ul fill-only-gaps din
// AiBulkGenerate (acolo existentul câștigă; aici câștigă ce a tastat omul).
export function mergeTranslations(
  existing: Translations | null | undefined,
  names: Readonly<Record<string, string>>,
  activeLangs: readonly string[],
  base = 'ro',
): Translations {
  const out: Translations = {}
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    for (const [code, entry] of Object.entries(existing)) out[code] = entry
  }
  for (const code of activeLangs) {
    // Originalul stă în coloana `name`. Baza e a LOCALULUI (lotul O6a): cu
    // `'ro'` fix, o traducere ÎN română pe un meniu francez se pierdea tăcut.
    if (code === base) continue
    const prev = out[code]
    const entry: { name?: string; description?: string } =
      prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...prev } : {}
    const name = (names[code] ?? '').trim()
    if (name.length > 0) entry.name = name
    else delete entry.name
    if (Object.keys(entry).length === 0) delete out[code]
    else out[code] = entry
  }
  return out
}

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

// Câmpurile traductibile ale unui rând de meniu. `meta_text` = subtitlul
// categoriei (lotul O6b; doar pe categorii).
export type TranslatedField = 'name' | 'description' | 'meta_text'
const TRANSLATED_FIELDS: readonly TranslatedField[] = ['name', 'description', 'meta_text']

// O intrare de limbă din coloana `translations`. `ai_fields` (lotul O6c) =
// câmpurile completate de AI pe care niciun om nu le-a verificat încă: textul e
// PUBLICAT imediat (clientul îl vede), marcajul înseamnă doar „de verificat”.
// Cititorii oaspetelui (trName/trDesc/trMeta/availableMenuLangs, localizeProduct)
// citesc doar chei numite explicit, deci ignoră marcajul prin construcție.
export interface TranslationEntry {
  name?: string
  description?: string
  meta_text?: string
  ai_fields?: TranslatedField[]
}

// Structura coloanei `translations` (products, categories din mig 197;
// modifier_groups, modifier_options, product_extras din mig 321): cheia = cod
// de limbă (`en`, `de`, …), valoarea = câmpurile traduse (opționale).
export type Translations = Record<string, TranslationEntry>

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
    products?: {
      translations?: Translations | null
      // Lotul O6b (mig 321): o limbă tradusă doar pe grupuri / opțiuni /
      // extra-uri e tot o limbă a meniului (recenzia CodeRabbit pe #355).
      modifier_groups?: {
        translations?: Translations | null
        modifier_options?: { translations?: Translations | null }[]
      }[]
      extras?: { translations?: Translations | null }[]
    }[]
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
        (typeof v?.description === 'string' && v.description.trim().length > 0) ||
        (typeof v?.meta_text === 'string' && v.meta_text.trim().length > 0)
      ) {
        found.add(code)
      }
    }
  }
  for (const c of categories) {
    scan(c.translations)
    for (const p of c.products ?? []) {
      scan(p.translations)
      for (const g of p.modifier_groups ?? []) {
        scan(g.translations)
        for (const o of g.modifier_options ?? []) scan(o.translations)
      }
      for (const e of p.extras ?? []) scan(e.translations)
    }
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

// ── Scriitorii coloanei `translations` (lotul O6c) ─────────────────────
// Trei semantici DISTINCTE, deliberat neunificate:
//   - AI, fill-only-gaps (`mergeAiTranslations`): existentul câștigă, AI-ul
//     completează doar golurile și le marchează „de verificat”;
//   - rândul salvat din ecranul Traduceri (`applyManualEdit`): un om a salvat
//     rândul, deci câmpurile trimise își pierd marcajul;
//   - editoarele din fișe (`mergeTranslations`): marcajul cade doar când
//     textul s-a SCHIMBAT (o salvare a fișei pentru preț nu „verifică” nimic).
// Invariantul comun: `ai_fields` numește doar câmpuri prezente și nevide, o
// listă goală se șterge, o intrare rămasă goală (inclusiv doar cu marcaj)
// dispare, baza nu se scrie niciodată, limbile neatinse rămân neatinse, iar
// intrările nu se mută. Fără marcaje, ieșirea e cea de dinainte de O6c.

function isEntry(v: unknown): v is TranslationEntry {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function fieldText(entry: TranslationEntry | null | undefined, field: TranslatedField): string {
  const v = entry?.[field]
  return typeof v === 'string' ? v.trim() : ''
}

function copyTranslations(existing: Translations | null | undefined): Translations {
  const out: Translations = {}
  if (isEntry(existing)) {
    for (const [code, entry] of Object.entries(existing)) out[code] = entry
  }
  return out
}

/** Câmpurile marcate „de verificat” ale unei intrări: doar nume cunoscute, cu text nevid. */
export function aiFieldsOf(entry: TranslationEntry | null | undefined): TranslatedField[] {
  if (!isEntry(entry)) return []
  const raw: unknown = entry.ai_fields
  if (!Array.isArray(raw)) return []
  return TRANSLATED_FIELDS.filter((f) => raw.includes(f) && fieldText(entry, f).length > 0)
}

// Reface `ai_fields` după o editare: păstrează doar marcajele valide, minus
// `drop`. Intrarea fără cheia `ai_fields` rămâne exact cum era.
function settleFlags(entry: TranslationEntry, drop: readonly TranslatedField[]): void {
  if (!Object.prototype.hasOwnProperty.call(entry, 'ai_fields')) return
  const keep = aiFieldsOf(entry).filter((f) => !drop.includes(f))
  if (keep.length > 0) entry.ai_fields = keep
  else delete entry.ai_fields
}

function putEntry(out: Translations, code: string, entry: TranslationEntry): void {
  if (Object.keys(entry).length === 0) delete out[code]
  else out[code] = entry
}

/**
 * Traducerile AI peste cele existente, FILL-ONLY-GAPS: un câmp se scrie doar
 * când cel existent e gol (și spațiile goale contează ca gol), doar pentru
 * limbile cerute (fără bază) și doar pentru câmpurile permise de `fields`
 * (descrierea doar dacă originalul are una, subtitlul doar pe categoriile cu
 * subtitlu — un câmp halucinat se aruncă). Câmpurile completate intră în
 * `ai_fields`; textul existent și marcajele lui rămân neatinse. Idempotentă:
 * a doua aplicare completează 0 câmpuri.
 */
export function mergeAiTranslations(
  existing: Translations | null | undefined,
  ai: Translations | null | undefined,
  opts: {
    langs: readonly string[]
    base?: string
    fields: Partial<Record<TranslatedField, boolean>>
  },
): { translations: Translations; filled: number } {
  const out = copyTranslations(existing)
  let filled = 0
  if (!isEntry(ai)) return { translations: out, filled }
  const base = opts.base ?? 'ro'
  for (const code of opts.langs) {
    if (code === base) continue
    const src = ai[code]
    if (!isEntry(src)) continue
    const prev = out[code]
    const entry: TranslationEntry = isEntry(prev) ? { ...prev } : {}
    const marked = new Set<TranslatedField>(aiFieldsOf(prev))
    let changed = false
    for (const f of TRANSLATED_FIELDS) {
      if (opts.fields[f] !== true) continue
      const value = fieldText(src, f)
      if (value.length === 0 || fieldText(entry, f).length > 0) continue
      entry[f] = value
      marked.add(f)
      filled++
      changed = true
    }
    if (!changed) continue
    entry.ai_fields = TRANSLATED_FIELDS.filter((f) => marked.has(f))
    out[code] = entry
  }
  return { translations: out, filled }
}

/**
 * Rândul salvat din ecranul Traduceri: valorile trimise (cu trim; '' șterge
 * câmpul) intră pe limba dată, iar TOATE câmpurile trimise își pierd marcajul
 * „de verificat” — un om a salvat rândul. Restul câmpurilor și limbilor rămân.
 */
export function applyManualEdit(
  existing: Translations | null | undefined,
  lang: string,
  values: Partial<Record<TranslatedField, string>>,
  base = 'ro',
): Translations {
  const out = copyTranslations(existing)
  if (lang === base) return out
  const prev = out[lang]
  const entry: TranslationEntry = isEntry(prev) ? { ...prev } : {}
  const submitted: TranslatedField[] = []
  for (const f of TRANSLATED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(values, f)) continue
    const v = (values[f] ?? '').trim()
    if (v.length > 0) entry[f] = v
    else delete entry[f]
    submitted.push(f)
  }
  settleFlags(entry, submitted)
  putEntry(out, lang, entry)
  return out
}

/**
 * Ciornele de NUME ale unui rând salvat pe loc (extra-ul din fișa produsului;
 * cheie = limba) diferă de ce e salvat? Comparația e după trim, ca la scriere:
 * o ciornă egală cu textul salvat, sau doar cu spații pe un câmp gol, nu e
 * „nesalvată”.
 */
export function nameDraftsDirty(
  drafts: Readonly<Record<string, string>> | null | undefined,
  stored: Translations | null | undefined,
): boolean {
  if (!drafts) return false
  return Object.entries(drafts).some(([code, v]) => v.trim() !== fieldText(stored?.[code], 'name'))
}

/** „Am verificat”: scoate marcajul (tot, sau doar `fields`) pe o limbă, textul rămâne. */
export function markTranslationReviewed(
  existing: Translations | null | undefined,
  lang: string,
  fields?: readonly TranslatedField[],
): Translations {
  const out = copyTranslations(existing)
  const prev = out[lang]
  if (!isEntry(prev) || !Object.prototype.hasOwnProperty.call(prev, 'ai_fields')) return out
  const entry: TranslationEntry = { ...prev }
  settleFlags(entry, fields ?? TRANSLATED_FIELDS)
  putEntry(out, lang, entry)
  return out
}

/**
 * Tastarea LIVE într-o fișă (formularul produsului): exact '' șterge câmpul
 * (textul se păstrează netrimat cât omul scrie), iar câmpul atins își pierde
 * marcajul. Intrarea rămasă goală dispare.
 */
export function setTranslationValue(
  tr: Translations | null | undefined,
  lang: string,
  field: TranslatedField,
  value: string,
): Translations {
  const out = copyTranslations(tr)
  const prev = out[lang]
  const entry: TranslationEntry = isEntry(prev) ? { ...prev } : {}
  if (value.length === 0) delete entry[field]
  else entry[field] = value
  settleFlags(entry, [field])
  putEntry(out, lang, entry)
  return out
}

// Editorul MANUAL de traduceri din fișe (CategoriesTab, ModifiersTab): aplică
// valorile tastate pentru limbile ACTIVE peste `translations` existent, fără să
// piardă nimic din rest:
// - limbile care NU sunt active (deselectate din setări, dar cu traduceri deja
//   scrise — de mână sau de AI) rămân NEATINSE: o deselectare temporară a unei
//   limbi nu are voie să șteargă munca de traducere;
// - celelalte câmpuri ale unei intrări active (ex. `description`) se păstrează —
//   editorul scrie doar `field` (implicit `name`);
// - o valoare goală (după trim) șterge DOAR acel câmp; intrarea rămasă goală
//   dispare (clientul face fallback pe original, ca la produse);
// - valorile trimise pentru limbi NEactive sunt ignorate (nu se scrie ce omul
//   n-a văzut pe ecran);
// - marcajul „de verificat” al câmpului (lotul O6c) cade DOAR când textul s-a
//   schimbat sau a fost golit: o salvare a fișei pentru alt motiv nu înseamnă
//   că omul a citit traducerea AI.
// Pură: nu mută `existing`. Diferită de merge-ul fill-only-gaps AI
// (mergeAiTranslations: acolo existentul câștigă; aici câștigă ce a tastat omul).
export function mergeTranslations(
  existing: Translations | null | undefined,
  values: Readonly<Record<string, string>>,
  activeLangs: readonly string[],
  base = 'ro',
  field: TranslatedField = 'name',
): Translations {
  const out = copyTranslations(existing)
  for (const code of activeLangs) {
    // Originalul stă în coloana `name`. Baza e a LOCALULUI (lotul O6a): cu
    // `'ro'` fix, o traducere ÎN română pe un meniu francez se pierdea tăcut.
    if (code === base) continue
    const prev = out[code]
    const entry: TranslationEntry = isEntry(prev) ? { ...prev } : {}
    const stored = fieldText(entry, field)
    const value = (values[code] ?? '').trim()
    if (value.length > 0) entry[field] = value
    else delete entry[field]
    settleFlags(entry, value !== stored ? [field] : [])
    putEntry(out, code, entry)
  }
  return out
}

// ── Previzualizarea meniului într-o limbă (lotul O6c) ───────────────────
/** `?lang=xx` din URL: doar un cod din MENU_LANGS (lowercase), altfel null. */
export function langFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get('lang')
  if (!raw) return null
  const code = raw.trim().toLowerCase()
  return MENU_LANGS.some((l) => l.code === code) ? code : null
}

/** Limba cerută prin URL, dacă meniul chiar o oferă (și nu e baza); altfel null. */
export function requestedMenuLang(
  requested: string | null,
  available: readonly string[],
  base: string,
): string | null {
  return requested != null && requested !== base && available.includes(requested) ? requested : null
}

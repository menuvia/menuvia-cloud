// aiImportDraft.ts — importul AI al meniului nu mai pierde munca (pachetul 10).
//
// Extracția dintr-un meniu de 4 pagini costă timp și cotă AI. Până acum rândurile
// extrase trăiau DOAR în starea componentei: un tap pe fundalul modalului, o
// închidere de pagină sau un refresh le pierdea, iar omul plătea extracția a doua
// oară. Aici: (1) draftul rezultat se păstrează în sessionStorage, per
// restaurant, și (2) importul poate fi reluat; (3) plafonul planului se citește
// ÎNAINTE de salvare și produce UN singur mesaj; (4) promptul urmează moneda și
// limba de BAZĂ ale restaurantului, nu „prețuri în lei”.
//
// STORAGE-ul ARUNCĂ în unele contexte (Safari cu „Block All Cookies”, webview-uri):
// obiectul există, dar orice acces dă SecurityError (clasa RESID-15). Tot accesul
// e în try/catch și FAIL-OPEN: fără storage, importul merge ca înainte, doar că nu
// se mai poate relua. Funcțiile primesc `storage` ca parametru (implicit
// sessionStorage) ca să poată fi testate cu un storage care aruncă.

export interface ImportDraftProduct {
  name: string
  description: string
  price: number
  emoji: string
  // '' = fără categorie · uuid = categorie existentă · 'new:<nume>' = de creat
  category_id: string
  category_name: string
  include: boolean
}

export interface StoredImportDraft {
  drafts: ImportDraftProduct[]
  savedAt: number
}

const KEY_PREFIX = 'menuvia.ai_import_draft.'
// Draftul trăiește cât o sesiune de lucru; după 12 ore e considerat uitat.
export const IMPORT_DRAFT_TTL_MS = 12 * 60 * 60 * 1000
const MAX_DRAFT_ITEMS = 200
const CLOCK_SKEW_MS = 5 * 60 * 1000

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): MinimalStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null // accesul la obiect poate arunca
  }
}

const keyFor = (restaurantId: string): string => KEY_PREFIX + restaurantId

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function cleanItem(raw: unknown): ImportDraftProduct | null {
  if (!isObj(raw)) return null
  if (
    typeof raw.name !== 'string' ||
    typeof raw.description !== 'string' ||
    typeof raw.emoji !== 'string' ||
    typeof raw.category_id !== 'string' ||
    typeof raw.category_name !== 'string' ||
    typeof raw.include !== 'boolean' ||
    typeof raw.price !== 'number' ||
    !Number.isFinite(raw.price) ||
    raw.price < 0
  ) {
    return null
  }
  return {
    name: raw.name.slice(0, 200),
    description: raw.description.slice(0, 1000),
    price: raw.price,
    emoji: raw.emoji.slice(0, 8),
    category_id: raw.category_id.slice(0, 200),
    category_name: raw.category_name.slice(0, 80),
    include: raw.include,
  }
}

/** Salvează draftul (fail-open). Listă goală = șterge draftul. */
export function saveImportDraft(
  restaurantId: string,
  drafts: ImportDraftProduct[],
  now: number = Date.now(),
  storage: MinimalStorage | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    if (drafts.length === 0) {
      storage.removeItem(keyFor(restaurantId))
      return
    }
    storage.setItem(keyFor(restaurantId), JSON.stringify({ v: 1, savedAt: now, drafts }))
  } catch {
    /* quota / SecurityError — importul merge mai departe, doar fără reluare */
  }
}

/**
 * Citește draftul. `null` = nu există, a expirat, e corupt sau storage-ul
 * aruncă. Rândurile invalide se elimină; un draft rămas fără niciun rând valid
 * se șterge (nu rămâne un banner „Reia” fără conținut).
 */
export function loadImportDraft(
  restaurantId: string,
  now: number = Date.now(),
  storage: MinimalStorage | null = defaultStorage(),
): StoredImportDraft | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(keyFor(restaurantId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isObj(parsed) || parsed.v !== 1 || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.drafts)) {
      storage.removeItem(keyFor(restaurantId))
      return null
    }
    const age = now - parsed.savedAt
    if (!Number.isFinite(age) || age > IMPORT_DRAFT_TTL_MS || age < -CLOCK_SKEW_MS) {
      storage.removeItem(keyFor(restaurantId))
      return null
    }
    const drafts = parsed.drafts
      .slice(0, MAX_DRAFT_ITEMS)
      .map(cleanItem)
      .filter((d): d is ImportDraftProduct => d !== null)
    if (drafts.length === 0) {
      storage.removeItem(keyFor(restaurantId))
      return null
    }
    return { drafts, savedAt: parsed.savedAt }
  } catch {
    return null // JSON corupt sau storage care aruncă
  }
}

export function clearImportDraft(
  restaurantId: string,
  storage: MinimalStorage | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.removeItem(keyFor(restaurantId))
  } catch {
    /* fail-open */
  }
}

/**
 * La reluare, categoriile existente pot fi altele decât la extracție (șterse sau
 * redenumite între timp). Un id de categorie care nu mai există devine
 * `new:<nume>` (se re-potrivește pe nume la salvare) sau „fără categorie”.
 */
export function reconcileDraftCategories(
  drafts: ImportDraftProduct[],
  existingCategoryIds: ReadonlySet<string>,
): ImportDraftProduct[] {
  return drafts.map((d) => {
    if (!d.category_id || d.category_id.startsWith('new:') || existingCategoryIds.has(d.category_id)) return d
    return { ...d, category_id: d.category_name ? `new:${d.category_name}` : '' }
  })
}

/**
 * Draftul care trebuie păstrat după o încercare de salvare: EXACT produsele
 * nesalvate (eșuate sau neîncercate după atingerea plafonului) + rândurile pe care
 * omul nu le-a selectat, în ordinea inițială. Cele salvate dispar (o reluare le-ar
 * duplica). Nimic nesalvat → listă goală (draftul se șterge). Comparația e pe
 * REFERINȚĂ: `selected` și `unsaved` sunt elemente din `drafts`.
 */
export function remainingAfterImport(
  drafts: ImportDraftProduct[],
  selected: ImportDraftProduct[],
  unsaved: ImportDraftProduct[],
): ImportDraftProduct[] {
  if (unsaved.length === 0) return []
  const unsavedSet = new Set(unsaved)
  const selectedSet = new Set(selected)
  return drafts.filter((d) => unsavedSet.has(d) || !selectedSet.has(d))
}

/**
 * Poze noi NU se pot alege cât există un draft nesalvat (în memorie sau în
 * storage) sau cât rulează o extragere: o extragere nouă ar înlocui tăcut rândurile
 * deja extrase. Ieșirile sunt explicite: „Reia importul” sau „Renunță la draft”.
 */
export function uploadLocked(resumableCount: number, busy: boolean): boolean {
  return busy || resumableCount > 0
}

// ── Plafonul planului: UN singur mesaj, înainte de salvare ─────────────────────

/**
 * Eroarea de plafon a triggerului din DB (mig 038/126/290): hint `product_limit`
 * sau textul „Limită produse atinsă”. Inserarea în lot e ATOMICĂ (trigger la
 * nivel de instrucțiune), deci la această eroare nu s-a salvat nimic.
 */
export function isProductLimitError(err: unknown): boolean {
  if (!isObj(err)) return false
  if (err.hint === 'product_limit') return true
  const text = [err.message, err.details].filter((x): x is string => typeof x === 'string').join(' ')
  return /limit[ăa] produse|product_limit/i.test(text)
}

/**
 * Mesajul unic când selecția depășește locurile rămase pe plan, sau null.
 * `remaining` necunoscut (undefined) → null: decide serverul.
 */
export function describeProductLimit(selected: number, remaining: number | undefined): string | null {
  if (remaining === undefined || selected <= remaining) return null
  if (remaining <= 0) {
    return 'Ai atins limita de produse a planului — nu mai poți adăuga produse noi. Nimic nu a fost salvat. Treci la un plan superior sau șterge produse existente.'
  }
  const excess = selected - remaining
  return (
    `Planul tău mai permite ${remaining} ${remaining === 1 ? 'produs' : 'produse'}, iar tu ai selectat ${selected}. ` +
    `Debifează ${excess} ${excess === 1 ? 'produs' : 'produse'} sau treci la un plan superior. Nimic nu a fost salvat încă.`
  )
}

/** Rândul intră la salvare: bifat ȘI cu nume (aceeași regulă ca `confirmImport`). */
export function isSelectedDraft(d: ImportDraftProduct): boolean {
  return d.include && d.name.trim() !== ''
}

/**
 * Indicii rândurilor de DEBIFAT ca selecția să încapă în `remaining` locuri:
 * tot ce trece de primele `remaining` produse selectate, în ordinea din listă
 * (ordinea meniului fotografiat). Rândurile neselectate nu se ating. Un meniu
 * real de 25 de produse pe planul gratuit (15) cerea altfel 10 debifări de mână
 * înainte ca butonul de salvare să se deblocheze.
 */
export function overLimitIndices(drafts: ImportDraftProduct[], remaining: number): number[] {
  const keep = Math.max(0, Math.floor(remaining))
  const out: number[] = []
  let kept = 0
  drafts.forEach((d, i) => {
    if (!isSelectedDraft(d)) return
    if (kept < keep) kept++
    else out.push(i)
  })
  return out
}

// ── Promptul: moneda și limba de BAZĂ ale restaurantului ───────────────────────

const MENU_CURRENCY_CODES: readonly string[] = ['RON', 'EUR', 'HUF', 'BGN', 'MDL', 'USD', 'GBP']
const LANG_NAMES: Readonly<Record<string, string>> = {
  en: 'engleză',
  de: 'germană',
  fr: 'franceză',
  it: 'italiană',
  hu: 'maghiară',
  es: 'spaniolă',
}

/**
 * Textul cerut modelului de vision. Pentru un restaurant RON/ro e IDENTIC cu
 * promptul de dinainte („Prețurile în lei”); pentru alte monede / limbi de bază
 * se schimbă doar rândul de prețuri și apare o instrucțiune de a NU traduce.
 */
export function buildMenuImportPrompt(opts: {
  currency?: string | null
  language?: string | null
}): string {
  const code =
    typeof opts.currency === 'string' && MENU_CURRENCY_CODES.includes(opts.currency)
      ? opts.currency
      : 'RON'
  const priceLine =
    code === 'RON'
      ? 'Prețurile în lei (număr fără simbol). '
      : `Prețurile exact ca în poză, în moneda meniului (${code}), ca număr fără simbol și FĂRĂ conversie în altă monedă. `
  const langName = typeof opts.language === 'string' ? LANG_NAMES[opts.language] : undefined
  const langLine = langName
    ? `Meniul restaurantului este în limba ${langName}: păstrează numele, descrierile și secțiunile EXACT în limba din poză, fără să le traduci. `
    : ''
  return (
    'Extrage toate produsele din aceste poze de meniu (pot fi mai multe pagini ale ACELUIAȘI meniu). ' +
    'Returnează DOAR un JSON array, fără markdown, cu obiecte de forma ' +
    '{"name": string, "description": string|null, "price": number, "emoji": string, "category": string|null}. ' +
    priceLine +
    'Emoji relevant pentru fiecare produs. ' +
    '"category" = numele secțiunii din meniu în care apare produsul (ex. "Feluri principale", "Băuturi") — ' +
    'folosește EXACT același nume pentru toate produsele din aceeași secțiune; null dacă nu e clar.' +
    (langLine ? ' ' + langLine.trimEnd() : '')
  )
}

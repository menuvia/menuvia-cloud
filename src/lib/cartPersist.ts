// ─────────────────────────────────────────────────────────────
// Coșul oaspetelui supraviețuiește reîncărcării (lotul C8a).
//
// Pe telefon, calea cea mai comună de la masă e: oaspetele alege produse, pune
// telefonul în buzunar, iOS Safari scoate tab-ul din memorie, iar la revenire
// pagina se reîncarcă de la zero. Coșul trăia DOAR în state-ul React — pe
// meniul de la masă (QrMenuPage) și la ridicare pe /m/:slug (PublicMenuPage;
// acolo persista doar „Lista mea”, fără ridicare) —, deci produsele alese, cu
// opțiunile, extra-urile și notele lor, dispăreau. Snapshot-ul sesiunii
// (`lib/qrSession`) păstra comenzile TRIMISE, nu și coșul.
//
// Disciplina:
//   * `sessionStorage` (moare cu tab-ul), în același spațiu ca snapshot-ul
//     sesiunii și cheia de idempotență: coșul e al ACESTEI vizite, nu al
//     telefonului pe termen lung;
//   * TTL de 6 h, ca `lib/qrSession`;
//   * FIECARE linie se validează la citire: o linie stricată se aruncă, nu tot
//     coșul, și nu ajunge niciodată în React cu o formă pe care UI-ul n-o
//     așteaptă;
//   * TOATE accesele sunt în try/catch, fail-open (RESID-15): un storage care
//     aruncă `SecurityError` (Safari cu „Block All Cookies") lasă coșul doar în
//     memorie, ca înainte — nu omoară meniul;
//   * un coș rehidratat NU se trimite tăcut cu prețurile de ieri: paginile
//     rulează `repriceCart` după încărcarea meniului, iar foile de coș marchează
//     (`cartLineIssue`) liniile care nu mai corespund meniului (lotul O4a);
//   * coșul salvat se ȘTERGE la trimiterea reușită, lângă rotirea cheii de
//     idempotență: altfel o reîncărcare a ecranului de confirmare ar reînvia un
//     coș deja trimis, cu o cheie NOUĂ — adică exact comanda dublă pe care
//     cheia o previne. Invers, o trimitere al cărei răspuns s-a pierdut lasă
//     coșul ȘI cheia neatinse, deci retrimiterea coșului rehidratat e
//     deduplicată de server pe confirmarea originală.
//
// Limba aleasă EXPLICIT de oaspete stă în aceeași intrare (altfel un turist
// care a ales germana revedea meniul în limba de bază după reîncărcare).
// Funcții PURE peste storage, fără React.
// ─────────────────────────────────────────────────────────────
import { MAX_LINE_QTY, type CartItem, type SelectedExtra, type SelectedModifier } from './orders'
import { MENU_LANGS } from './i18nMenu'

/** Unde trăiește un coș: masa (token-ul QR) sau ridicarea (restaurantul). */
export type CartScope = { kind: 'qr'; token: string } | { kind: 'pickup'; restaurantId: string }

export interface SavedCart {
  cart: CartItem[]
  /** Limba aleasă explicit de oaspete; `null` = nimic ales (auto-detect / bază). */
  lang: string | null
}

interface StoredCart extends SavedCart {
  savedAt: number
}

const TTL_MS = 6 * 60 * 60 * 1000

function serialize(cart: CartItem[], lang: string | null): string {
  return JSON.stringify({ cart, lang, savedAt: Date.now() } satisfies StoredCart)
}

export function cartStorageKey(scope: CartScope): string {
  return scope.kind === 'qr'
    ? 'menuvia_qr_cart:' + scope.token
    : 'menuvia_pickup_cart:' + scope.restaurantId
}

// Fiecare cheie a lui `CartItem` trebuie să apară aici: o cheie NOUĂ (chiar
// opțională) dă eroare de compilare până când `toCartItem` o validează și o
// copiază — altfel reîncărcarea ar pierde-o tăcut din fiecare linie.
export const CART_ITEM_FIELDS: Record<keyof CartItem, true> = {
  _key: true,
  product_id: true,
  product_name_snapshot: true,
  unit_price_snapshot: true,
  quantity: true,
  selected_modifiers: true,
  notes: true,
  selected_extras: true,
  upsell_source: true,
}

const UPSELL_SOURCES: ReadonlyArray<NonNullable<CartItem['upsell_source']>> = [
  'extra',
  'pairing',
  'checkout_suggestion',
]

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function isText(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}
function isMoney(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

function toModifier(v: unknown): SelectedModifier | null {
  if (!isRecord(v)) return null
  const { group_id, group_name, option_id, option_name, price_delta } = v
  if (!isText(group_id) || typeof group_name !== 'string' || !isText(option_id)) return null
  if (typeof option_name !== 'string') return null
  // Un delta de opțiune poate fi negativ (varianta mai mică), dar e mereu finit.
  if (typeof price_delta !== 'number' || !Number.isFinite(price_delta)) return null
  return { group_id, group_name, option_id, option_name, price_delta }
}

function toExtra(v: unknown): SelectedExtra | null {
  if (!isRecord(v)) return null
  const { id, name, price } = v
  if (!isText(id) || typeof name !== 'string' || !isMoney(price)) return null
  return { id, name, price }
}

/** O linie validă din storage, reconstruită DOAR din câmpurile cunoscute. */
function toCartItem(v: unknown): CartItem | null {
  if (!isRecord(v)) return null
  const { _key, product_id, product_name_snapshot, unit_price_snapshot, quantity, notes } = v
  if (!isText(_key) || !isText(product_id) || typeof product_name_snapshot !== 'string') return null
  if (!isMoney(unit_price_snapshot)) return null
  // Plafonul serverului pe linie (create_order 191: 1–20).
  if (typeof quantity !== 'number' || !Number.isInteger(quantity)) return null
  if (quantity < 1 || quantity > MAX_LINE_QTY) return null
  // `JSON.stringify` scoate cheile `undefined`: o notă lipsă e „fără notă”.
  let note: string | null = null
  if (typeof notes === 'string') note = notes
  else if (notes != null) return null
  if (!Array.isArray(v.selected_modifiers)) return null
  const selected_modifiers: SelectedModifier[] = []
  for (const raw of v.selected_modifiers) {
    const m = toModifier(raw)
    // O opțiune stricată NU se aruncă singură: linia fără ea ar fi alt produs
    // (altă comandă decât cea aleasă). Se aruncă toată linia.
    if (m == null) return null
    selected_modifiers.push(m)
  }
  const item: CartItem = {
    _key,
    product_id,
    product_name_snapshot,
    unit_price_snapshot,
    quantity,
    selected_modifiers,
    notes: note,
  }
  if (v.selected_extras != null) {
    if (!Array.isArray(v.selected_extras)) return null
    const extras: SelectedExtra[] = []
    for (const raw of v.selected_extras) {
      const e = toExtra(raw)
      if (e == null) return null
      extras.push(e)
    }
    item.selected_extras = extras
  }
  if (v.upsell_source != null) {
    const src = UPSELL_SOURCES.find((s) => s === v.upsell_source)
    if (src === undefined) return null
    item.upsell_source = src
  }
  return item
}

/**
 * Liniile valide dintr-o valoare citită din storage. Liniile stricate și
 * dublurile de `_key` (cheia de randare React) se aruncă; restul rămân în
 * ordinea lor. Funcție PURĂ.
 */
export function sanitizeCart(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return []
  const out: CartItem[] = []
  const keys = new Set<string>()
  for (const entry of raw) {
    const item = toCartItem(entry)
    if (item == null || keys.has(item._key)) continue
    keys.add(item._key)
    out.push(item)
  }
  return out
}

function toLang(v: unknown): string | null {
  return typeof v === 'string' && MENU_LANGS.some((l) => l.code === v) ? v : null
}

/** Coșul salvat (null dacă lipsește, e corupt, expirat sau storage-ul aruncă). */
export function loadSavedCart(scope: CartScope): SavedCart | null {
  const key = cartStorageKey(scope)
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || typeof parsed.savedAt !== 'number') return null
    if (Date.now() - parsed.savedAt > TTL_MS) {
      sessionStorage.removeItem(key)
      return null
    }
    const cart = sanitizeCart(parsed.cart)
    const lang = toLang(parsed.lang)
    if (cart.length === 0 && lang === null) return null
    return { cart, lang }
  } catch {
    return null
  }
}

/** Scrie coșul; un coș gol FĂRĂ limbă aleasă șterge intrarea. */
export function saveCart(scope: CartScope, saved: SavedCart): void {
  const key = cartStorageKey(scope)
  try {
    if (saved.cart.length === 0 && saved.lang === null) {
      sessionStorage.removeItem(key)
      return
    }
    sessionStorage.setItem(key, serialize(saved.cart, saved.lang))
  } catch {
    /* storage indisponibil (private mode / cotă / SecurityError): coșul rămâne în memorie */
  }
}

/**
 * Golește coșul salvat (trimitere reușită, reset) și PĂSTREAZĂ limba aleasă —
 * e a oaspetelui, nu a comenzii.
 */
export function clearSavedCart(scope: CartScope): void {
  const key = cartStorageKey(scope)
  try {
    const raw = sessionStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    const lang = isRecord(parsed) ? toLang(parsed.lang) : null
    if (lang === null) {
      sessionStorage.removeItem(key)
      return
    }
    sessionStorage.setItem(key, serialize([], lang))
  } catch {
    try {
      sessionStorage.removeItem(key)
    } catch {
      /* storage complet indisponibil — nimic de șters */
    }
  }
}

/**
 * Limba salvată, aplicată după ce meniul s-a încărcat: `undefined` = nimic de
 * restaurat (nimic salvat, sau limba nu mai e oferită → auto-detectul normal);
 * `null` = baza aleasă explicit; altfel codul ales. Funcție PURĂ.
 */
export function restoredMenuLang(
  saved: string | null,
  available: readonly string[],
  base: string,
): string | null | undefined {
  if (saved == null) return undefined
  if (saved === base) return null
  return available.includes(saved) ? saved : undefined
}

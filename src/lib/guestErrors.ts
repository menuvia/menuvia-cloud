// ─────────────────────────────────────────────────────────────
// describeGuestError — eroarea unui apel al OASPETELUI → text în limba lui.
//
// Contractul: NICIODATĂ text brut de server. Mesajele Postgres sunt amestecate
// RO/EN („Product X is not available", „Masa a fost închisă…") și uneori
// interne; oaspetele vede doar o cheie T() din cele 7 limbi.
//
// Ordinea de citire: întâi `hint` (contractul STABIL al RPC-urilor, `using
// hint = '…'`), apoi `code`, apoi — pentru serverele/căile fără hint —
// tiparele cunoscute din mesaj (create_order mig 191, rate-limit mig 046,
// rezervări mig 115/201), apoi eroarea de rețea, apoi fallback-ul dat de
// apelant (contextul: comandă / ridicare / rezervare / plată). Pur, fără React.
// NU înlocuiește `describeCheckoutFailure` (abonamentul, dashboard).
// ─────────────────────────────────────────────────────────────
import { T, type PublicMenuStringKey } from './publicMenuStrings'

const HINT_KEYS: Readonly<Record<string, PublicMenuStringKey>> = {
  // create_order (mig 191)
  missing_required_group: 'err_missing_required_group',
  product_inactive: 'err_product_unavailable',
  product_not_found: 'err_product_unavailable',
  product_unavailable: 'err_product_unavailable',
  product_wrong_restaurant: 'err_product_unavailable',
  invalid_quantity: 'err_invalid_quantity',
  too_many_items: 'err_too_many_items',
  no_items: 'err_no_items',
  duplicate_options: 'err_invalid_options',
  invalid_options: 'err_invalid_options',
  too_many_in_group: 'err_invalid_options',
  duplicate_extras: 'err_invalid_options',
  notes_too_long: 'err_notes_too_long',
  item_notes_too_long: 'err_notes_too_long',
  // sesiunea mesei / tokenul QR (mig 088/092/191)
  session_required: 'err_session_closed',
  session_closed: 'err_session_closed',
  invalid_session: 'err_session_closed',
  missing_qr_token: 'err_session_closed',
  invalid_qr_token: 'err_session_closed',
  invalid_token: 'err_session_closed',
  qr_token_not_found: 'err_session_closed',
  qr_token_inactive: 'err_session_closed',
  qr_token_expired: 'err_session_closed',
  restaurant_inactive: 'err_restaurant_inactive',
  // ridicare (mig 046/191)
  pickup_disabled: 'err_pickup_disabled',
  pickup_rate_limit: 'err_rate_limit_order',
  pickup_time_too_soon: 'err_pickup_too_soon',
  pickup_time_too_far: 'err_pickup_too_far',
  missing_pickup_time: 'err_pickup_time_missing',
  missing_customer_name: 'err_name_required',
  invalid_customer_phone: 'phone_invalid',
  // rezervări (mig 115/199/200/256)
  table_unavailable: 'err_table_unavailable',
  reservation_rate_limit: 'err_rate_limit_reservation',
  invalid_code: 'err_invalid_code',
  // modul oprit (rezervări / plată online)
  module_disabled: 'err_module_disabled',
  feature_disabled: 'err_feature_disabled',
  // plata online / împărțirea notei (mig 202–231)
  not_connected: 'err_payments_not_ready',
  nothing_to_pay: 'err_nothing_to_pay',
  currency_not_supported: 'err_currency_not_supported',
  items_already_claimed: 'err_items_already_claimed',
  invalid_items: 'err_bill_changed',
  overpayment: 'err_amount_mismatch',
  underpayment: 'err_amount_mismatch',
}

// Tipare pe MESAJ — pentru căile fără hint (servere vechi, excepții brute).
// Ordinea contează: primul tipar potrivit câștigă.
const MESSAGE_PATTERNS: ReadonlyArray<{ re: RegExp; key: PublicMenuStringKey }> = [
  // Gate-ul de plan (`Featurea % nu e disponibilă pe planul curent`, raise-urile
  // de plan din SQL) vine FĂRĂ hint — table-payment.js îl pasează cu 403 și hint null.
  // Cheia generică; contextele plății o înlocuiesc prin overrides.
  { re: /^Featurea\b/i, key: 'err_feature_disabled' },
  { re: /masa a fost închisă|sesiunea (mesei )?(a expirat|lipsește)/i, key: 'err_session_closed' },
  { re: /cere cel puțin|required group/i, key: 'err_missing_required_group' },
  { re: /product .* (is not available|not found|does not belong)|product not found/i, key: 'err_product_unavailable' },
  { re: /invalid quantity/i, key: 'err_invalid_quantity' },
  { re: /too many lines|too many items/i, key: 'err_too_many_items' },
  { re: /at least one item/i, key: 'err_no_items' },
  { re: /modifier|opțiuni (modificatoare|selectate)|extra-uri duplicate/i, key: 'err_invalid_options' },
  { re: /notes too long/i, key: 'err_notes_too_long' },
  { re: /pickup.*(dezactivate|disabled)/i, key: 'err_pickup_disabled' },
  { re: /pickup time too soon/i, key: 'err_pickup_too_soon' },
  { re: /pickup time too far/i, key: 'err_pickup_too_far' },
  { re: /valid customer_phone/i, key: 'phone_invalid' },
  { re: /overlap|exclusion|se suprapune/i, key: 'err_reservation_overlap' },
  // create_reservation_public (mig 273) — mesaje fără hint
  { re: /nu acceptă rezervări|open_days/i, key: 'err_reservation_day_closed' },
  { re: /rezervările nu sunt activate/i, key: 'err_reservations_off' },
  { re: /în afara programului/i, key: 'err_reservation_outside_hours' },
  { re: /numărul maxim de persoane/i, key: 'err_party_too_large' },
  { re: /cu minim .* ore înainte/i, key: 'err_reservation_too_soon' },
  { re: /cu maxim .* zile înainte/i, key: 'err_reservation_too_far' },
  { re: /restaurantul nu a fost găsit/i, key: 'err_restaurant_not_found' },
  { re: /rate.?limit|too many|prea multe/i, key: 'err_rate_limit_order' },
]

export interface GuestErrorShape {
  message?: unknown
  hint?: unknown
  code?: unknown
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Eroare de rețea (fetch picat / offline) — aceeași detecție ca bucla de
 *  retry din QrMenuPage. */
export function isNetworkGuestError(err: unknown): boolean {
  if (err instanceof TypeError) return true
  const m = err != null && typeof err === 'object' ? str((err as GuestErrorShape).message) : str(err)
  return /failed to fetch|networkerror|network-error|network|fetch|offline|econnrefused|load failed/i.test(m)
}

export interface GuestErrorOptions {
  /** Cheia afișată când eroarea nu e recunoscută (implicit `err_generic`). */
  fallback?: PublicMenuStringKey
  /** Cheia pentru eroarea de rețea (implicit `err_network`). */
  network?: PublicMenuStringKey
  /** Înlocuiri per context, pe cheia rezultată (ex. rezervările spun
   *  „Rezervările nu sunt active" în loc de mesajul generic de modul oprit). */
  overrides?: Partial<Record<PublicMenuStringKey, PublicMenuStringKey>>
}

function rawKey(err: unknown): PublicMenuStringKey | null {
  const e: GuestErrorShape =
    err != null && typeof err === 'object' ? (err as GuestErrorShape) : { message: err }
  const hint = str(e.hint)
  if (hint && HINT_KEYS[hint]) return HINT_KEYS[hint]
  const code = str(e.code)
  if (code && HINT_KEYS[code]) return HINT_KEYS[code]
  const msg = str(e.message)
  // Unele căi pun hint-ul în mesaj (ex. `raise exception 'module_disabled'`).
  const inMsg = Object.keys(HINT_KEYS).find((h) => new RegExp(`\\b${h}\\b`).test(msg))
  if (inMsg) return HINT_KEYS[inMsg]
  for (const p of MESSAGE_PATTERNS) if (p.re.test(msg)) return p.key
  return null
}

/** Cheia T() pentru o eroare a oaspetelui (exportată pentru teste). */
export function guestErrorKey(err: unknown, opts: GuestErrorOptions = {}): PublicMenuStringKey {
  const k =
    rawKey(err) ?? (isNetworkGuestError(err) ? (opts.network ?? 'err_network') : (opts.fallback ?? 'err_generic'))
  return opts.overrides?.[k] ?? k
}

/** Textul erorii în limba oaspetelui — NICIODATĂ mesajul brut al serverului. */
export function describeGuestError(
  lang: string | null | undefined,
  err: unknown,
  opts: GuestErrorOptions = {},
): string {
  return T(lang ?? 'ro', guestErrorKey(err, opts))
}

// ── Opțiunile per context ale plății online a mesei ──
// Exportate ca să fie testabile fără React (GE8/GE9). Plafonul de încercări
// din table-payment.js (429, fără hint) cade pe tiparul generic „prea multe"
// → `err_rate_limit_order` („Prea multe comenzi"), fals pentru cine plătește
// nota; gate-ul de plan („Featurea…") → textul plății online.

/** PayTableSheet — inițierea plății întregii mese. */
export const PAY_TABLE_ERROR_OPTS: GuestErrorOptions = {
  fallback: 'err_payment_failed',
  overrides: {
    err_module_disabled: 'err_online_pay_off',
    err_feature_disabled: 'err_online_pay_off',
    err_rate_limit_order: 'err_rate_limit_payment',
  },
}

/** SplitBillSheet — încărcarea notei pentru împărțire. */
export const SPLIT_BILL_ERROR_OPTS: GuestErrorOptions = {
  fallback: 'err_bill_load_failed',
  overrides: {
    err_module_disabled: 'err_online_pay_off',
    err_feature_disabled: 'err_split_off',
    err_rate_limit_order: 'err_rate_limit_payment',
  },
}

import { supabase } from './supabase'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { createIdempotencyKeyStore } from './idempotency'
import { isNetworkError } from './networkError'
// Doar TIPURI (șterse la compilare): orders.ts e în graful paginilor oaspetelui,
// iar dicționarul personalului nu are voie să intre acolo (SK4).
import type { Translator } from '../i18n/core'
import type ordersRo from '../i18n/ns/orders/ro'
import type waiterRo from '../i18n/ns/waiter/ro'
import type paymentsRo from '../i18n/ns/payments/ro'

/** Traducătorul namespace-ului `orders` — textele helperilor de mai jos. */
export type OrdersTranslator = Translator<typeof ordersRo>
/** Traducătorul namespace-ului `waiter` (ecranul ospătarului, lotul L4b). */
export type WaiterTranslator = Translator<typeof waiterRo>
/** Traducătorul namespace-ului `payments` (încasarea și reducerea, lotul L4b). */
export type PaymentsTranslator = Translator<typeof paymentsRo>

export type OrderStatus =
  | 'new'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'closed'
  | 'paid'
  | 'cancelled'
export type OrderSource = 'qr' | 'waiter' | 'pickup'
export type PaymentMethod = 'cash' | 'card_pos' | 'other' | 'meal_voucher' | 'card_online'

// Plafoanele serverului pe o linie (create_order 191: cantitate 1–20, nota
// liniei ≤ 300, nota comenzii ≤ 500). Clientul le oglindește ca omul să afle
// înainte de trimitere, nu printr-un refuz al întregii comenzi.
export const MAX_LINE_QTY = 20
export const MAX_ITEM_NOTE = 300
export const MAX_ORDER_NOTE = 500

export interface SelectedExtra {
  id: string
  name: string
  price: number
}

export interface SelectedModifier {
  group_id: string
  group_name: string
  option_id: string
  option_name: string
  price_delta: number
}

export interface CartItem {
  _key: string
  product_id: string
  product_name_snapshot: string
  unit_price_snapshot: number
  quantity: number
  selected_modifiers: SelectedModifier[]
  notes: string | null
  selected_extras?: SelectedExtra[]
  upsell_source?: 'extra' | 'pairing' | 'checkout_suggestion'
}

// Totalul unei linii din coș: (preț unitar + opțiuni + extras) * cantitate.
// Extras se adună per-unitate, apoi se multiplică cu quantity — la fel ca
// serverul (mig 088: v_item_total = (unit + options + extras) * qty).
export function lineTotal(item: CartItem): number {
  const md = item.selected_modifiers.reduce((s, m) => s + m.price_delta, 0)
  const ex = (item.selected_extras ?? []).reduce((s, e) => s + e.price, 0)
  return (item.unit_price_snapshot + md + ex) * item.quantity
}

// Aceeași linie = același produs, aceleași opțiuni și extra-uri, aceeași notă,
// același preț și aceeași sursă de upsell (atribuirea rămâne corectă).
function cartLineIdentity(item: CartItem): string {
  return JSON.stringify([
    item.product_id,
    [...item.selected_modifiers.map((m) => m.option_id)].sort(),
    [...(item.selected_extras ?? []).map((e) => e.id)].sort(),
    (item.notes ?? '').trim(),
    Math.round(item.unit_price_snapshot * 100),
    item.upsell_source ?? null,
  ])
}

/**
 * Adaugă în coș; o linie IDENTICĂ își crește cantitatea în loc să apară a doua
 * oară (lotul O4b, OPT-8 — trei atingeri pe „+" la Espresso dădeau trei rânduri
 * „Espresso ×1", iar bucătăria vedea trei tichete-linie). Peste plafonul unei
 * linii (MAX_LINE_QTY, limita serverului) pornește o linie nouă, ca nimic să nu
 * se piardă tăcut.
 */
export function addOrMergeCartItem(cart: CartItem[], item: CartItem): CartItem[] {
  const id = cartLineIdentity(item)
  const i = cart.findIndex((c) => cartLineIdentity(c) === id && c.quantity + item.quantity <= MAX_LINE_QTY)
  if (i < 0) return [...cart, item]
  return cart.map((c, n) => (n === i ? { ...c, quantity: c.quantity + item.quantity } : c))
}

// ── Idempotență comanda QR (per token de masă) ──────────────────
// Cheia trăiește în sessionStorage ca să supraviețuiască refresh-urilor de
// pagină din TIMPUL unei comenzi (retry cu aceeași cheie = dedup pe server,
// index UNIQUE pe (restaurant_id, idempotency_key) — mig 088/145).
//
// RESID-15: implementarea veche atingea `sessionStorage` DIRECT, fără try/catch.
// În Safari cu „Block All Cookies" (și în unele webview-uri) obiectul EXISTĂ,
// dar orice acces ARUNCĂ `SecurityError` — iar `QrMenuPage` cheamă `get` în
// INIȚIALIZATORUL de `useState`, deci throw-ul venea la prima randare. Cum
// singurul `ErrorBoundary` (App.tsx) înfășoară tot arborele și nu există
// boundary pe rută, rezultatul nu era „o componentă crapă", ci ecranul de
// eroare ÎN LOCUL meniului, pentru un oaspete care tocmai scanase codul de pe
// masă. Acum trece prin aceeași fabrică ca PICKUP-ul și rezervarea publică.
//
// **Prefixul rămâne EXACT `menuvia_idem:`**: un prefix nou ar orfana cheile
// clienților aflați în mijlocul unei comenzi în momentul deploy-ului, iar
// retrimiterea lor ar ajunge la server cu o cheie NOUĂ → exact comanda dublă
// pe care mecanismul o previne.
const qrKeys = createIdempotencyKeyStore('menuvia_idem:')

export function getQrIdempotencyKey(token: string): string {
  return qrKeys.get(token)
}

// Rotește cheia de idempotență: generează una nouă ȘI o persistă imediat
// (aceeași cheie de storage folosită la citirea inițială din
// getQrIdempotencyKey). Dacă am scrie doar în state React, un refresh de
// pagină exact în timpul unei comenzi noi ar regenera cheia din citirea
// inițială (care ar recrea una veche/inexistentă), riscând submit duplicat.
// SE APELEAZĂ PE SUCCES (nu doar la reset) — altfel un coș NOU după refresh
// ar refolosi cheia comenzii deja trimise → dedup server → comandă pierdută.
export function rotateQrIdempotencyKey(token: string): string {
  return qrKeys.rotate(token)
}

// ── Idempotență comanda PICKUP (per restaurant) ──────────────────
// Aceeași disciplină ca la QR, dar peste fabrica din `lib/idempotency.ts`:
// cheia trăiește în sessionStorage ca să supraviețuiască închiderii
// sheet-ului/refresh-ului dintre un răspuns pierdut și retrimitere. Audit v3
// (FC-01): cheia stătea într-un useRef care murea cu sheet-ul → a doua
// trimitere avea cheie NOUĂ → comandă pickup DUBLĂ pregătită de restaurant.
// Se rotește DOAR pe succes. Fallback-ul din memorie și ștergerea cheii vechi
// când scrierea persistentă eșuează sunt în fabrică (aceeași implementare o
// folosește și rezervarea publică — mig 273).
const pickupKeys = createIdempotencyKeyStore('menuvia_idem_pickup:')

export function getPickupIdempotencyKey(scope: string): string {
  return pickupKeys.get(scope)
}

export function rotatePickupIdempotencyKey(scope: string): string {
  return pickupKeys.rotate(scope)
}

export interface RestaurantTable {
  id: string
  restaurant_id: string
  name: string
  slug: string
  seats: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string | null
  product_name_snapshot: string
  unit_price_snapshot: number
  quantity: number
  item_total: number
  selected_modifiers: SelectedModifier[]
  // Extra-urile plătite ale liniei, cum le scrie serverul (create_order 191,
  // update_order_items 313): {extra_id, extra_name, price}. Rândurile dinainte
  // de mig 088 au cheia `name`. Opțional: realtime-ul și fixture-urile vechi
  // nu îl au, iar ecranele îl tratează ca listă goală.
  extras_added?: OrderItemExtra[] | null
  notes: string | null
  created_at: string
}

export interface OrderItemExtra {
  extra_id?: string | null
  extra_name?: string | null
  /** Forma veche (înainte de mig 088). */
  name?: string | null
  price?: number | null
}

/** Numele opțiunilor alese pe o linie, fără intrările goale. */
export function orderItemOptionNames(item: Pick<OrderItem, 'selected_modifiers'>): string[] {
  const mods = Array.isArray(item.selected_modifiers) ? item.selected_modifiers : []
  return mods
    .map((m) => (m != null && typeof m.option_name === 'string' ? m.option_name.trim() : ''))
    .filter((n) => n !== '')
}

/**
 * Numele extra-urilor unei linii, în ordinea din comandă, fără intrările goale.
 * Aceeași regulă ca tichetul de bucătărie (mig 316): `extra_name`, apoi `name`.
 */
export function orderItemExtraNames(item: Pick<OrderItem, 'extras_added'>): string[] {
  const list = Array.isArray(item.extras_added) ? item.extras_added : []
  const names: string[] = []
  for (const x of list) {
    if (x == null || typeof x !== 'object') continue
    const raw =
      typeof x.extra_name === 'string' && x.extra_name.trim() !== ''
        ? x.extra_name
        : typeof x.name === 'string'
          ? x.name
          : ''
    const name = raw.trim()
    if (name !== '') names.push(name)
  }
  return names
}

export interface Order {
  id: string
  restaurant_id: string
  table_id: string | null
  qr_token_id: string | null
  source: OrderSource
  status: OrderStatus
  created_by: string | null
  served_by: string | null
  paid_by: string | null
  payment_method: PaymentMethod | null
  paid_amount: number | null
  total: number
  notes: string | null
  cancel_reason: string | null
  created_at: string
  confirmed_at: string | null
  preparing_at: string | null
  ready_at: string | null
  served_at: string | null
  paid_at: string | null
  cancelled_at: string | null
  pickup_time: string | null
  customer_name: string | null
  customer_phone: string | null
  // Sesiunea de masă (QR, mig 084) — `select('*')` o aduce deja; opțional ca
  // payload-urile vechi/mock-urile să rămână type-safe. Comenzile de ospătar n-o au.
  session_id?: string | null
  // Discount fields (migration 031)
  discount_type: 'percent' | 'amount' | null
  discount_value: number | null
  discount_amount: number
  discount_reason: string | null
  discount_applied_by: string | null
  discount_applied_at: string | null
  table: RestaurantTable | null
  order_items: OrderItem[]
  // Atribuire ospătar — neîncărcată momentan (vezi nota de la ORDER_SELECT).
  // Opțional ca să rămână type-safe când lipsește din payload.
  _created_by_profile?: { full_name: string | null } | null
  _served_by_profile?: { full_name: string | null } | null
}

export interface OrderConfirmationPayload {
  id: string
  short_id: string
  status: 'new'
  total: number
  created_at: string
}

export interface AdvanceOrderPayload {
  status: OrderStatus
  _currentStatus?: OrderStatus
  served_by?: string
  paid_by?: string
  payment_method?: PaymentMethod
  paid_amount?: number
  tips_amount?: number
  cancel_reason?: string
}

export interface OrderRealtimePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

// NU embeda `profiles` pe orders: `orders.created_by`/`served_by` referă
// `auth.users(id)`, NU `public.profiles` (vezi mig 003) — embed-ul
// `profiles!orders_created_by_fkey` e invalid și PostgREST întoarce
// „Could not find a relationship between 'orders' and 'profiles'", ceea ce
// pică ÎNTREAGA interogare → comenzile live nu se mai încărcau pe Ospătar.
// În plus, RLS `profiles_self` oricum ar fi întors doar numele user-ului curent.
// Atribuirea „Preluat de / Servit de" rămâne ascunsă până la un RPC/view dedicat.
const ORDER_SELECT = `
  *,
  table:tables(id, name, slug, seats),
  order_items(id, product_id, product_name_snapshot, unit_price_snapshot, quantity, item_total, selected_modifiers, extras_added, notes)
` as const

// Plafonul NOSTRU pe listele de staff (audit v3 RES-36). Fără `.limit()`,
// PostgREST trunchia TĂCUT la `max_rows` (1000 pe hosted) și, cu ORDER BY ASC,
// păstra cele mai VECHI comenzi — exact cele care nu mai contează — iar cele
// noi dispăreau fără niciun semnal. Acum: cele mai NOI N comenzi deschise
// (cerute DESC + LIMIT N+1, întoarse ASC/FIFO ca înainte) + flag `truncated`
// pe care paginile îl afișează. N+1 trebuie să rămână SUB max_rows, altfel
// flag-ul devine el însuși mort (max_rows e configurabil din Dashboard).
export const STAFF_ORDERS_FETCH_LIMIT = 500

export interface StaffOrdersPage {
  orders: Order[]
  /** true = existau mai multe comenzi deschise decât plafonul; lista e cele mai noi N. */
  truncated: boolean
}

/** Cele mai noi N comenzi deschise ale restaurantului (FIFO) + flag `truncated` când plafonul a fost atins. */
async function fetchStaffOrders(restaurantId: string, statuses: string[]): Promise<StaffOrdersPage> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('restaurant_id', restaurantId)
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(STAFF_ORDERS_FETCH_LIMIT + 1)
  // Aruncăm un Error REAL (nu obiectul Supabase) ca mesajul să ajungă în UI;
  // altfel `e instanceof Error` din useOrders e false și se afișează „Unknown error".
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as Order[]
  const truncated = rows.length > STAFF_ORDERS_FETCH_LIMIT
  // Contractul consumatorilor (KitchenPage/WaiterPage) rămâne ASC/FIFO.
  const orders = rows.slice(0, STAFF_ORDERS_FETCH_LIMIT).reverse()
  return { orders, truncated }
}

/** Comenzile pentru Bucătărie: doar cele de pregătit (fără `served`). */
export function fetchKitchenOrders(restaurantId: string): Promise<StaffOrdersPage> {
  return fetchStaffOrders(restaurantId, ['new', 'confirmed', 'preparing', 'ready'])
}

/** Comenzile pentru Ospătar: tot ce nu e terminal, inclusiv `served` neîncasate. */
export function fetchWaiterOrders(restaurantId: string): Promise<StaffOrdersPage> {
  // Statusurile „deschise" pentru ospătar = tot ce nu e paid/cancelled/closed.
  // Folosim lista POZITIVĂ `.in()` (ca fetchKitchenOrders, care funcționează) în
  // loc de `.not('status','in','(...)')` — acel pattern eșua, iar comenzile nu se
  // încărcau deloc (UI: „Unknown error" + 0 comenzi). Include `served` (ospătarul
  // vede și comenzile servite neîncasate), spre deosebire de bucătărie.
  return fetchStaffOrders(restaurantId, ['new', 'confirmed', 'preparing', 'ready', 'served'])
}

export async function fetchOrderById(orderId: string): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', orderId)
    .single()
  if (error) throw new Error(error.message)
  return data as unknown as Order
}

const STATUS_TO_ACTION: Record<string, string> = {
  'new→confirmed': 'confirm',
  'confirmed→preparing': 'start_preparing',
  'preparing→ready': 'mark_ready',
  'ready→served': 'mark_served',
  'served→closed': 'close_order', // Plan 2: non-fiscal close
  'served→paid': 'mark_paid', // Plan 3: fiscal close via bridge
}

export async function advanceOrderStatus(
  orderId: string,
  payload: AdvanceOrderPayload,
  // OPT-5: hydrate=false sare refetch-ul complet (join dublu) de după RPC —
  // folosit când canalul realtime e conectat și aduce oricum rândul
  // autoritativ prin evenimentul UPDATE. Default true = contractul existent.
  opts?: { hydrate?: boolean },
): Promise<Order | null> {
  const current = payload._currentStatus
  const target = payload.status
  let action: string
  if (target === 'cancelled') {
    action = 'cancel'
  } else if (current && STATUS_TO_ACTION[`${current}→${target}`]) {
    action = STATUS_TO_ACTION[`${current}→${target}`]
  } else {
    action =
      target === 'confirmed'
        ? 'confirm'
        : target === 'preparing'
          ? 'start_preparing'
          : target === 'ready'
            ? 'mark_ready'
            : target === 'served'
              ? 'mark_served'
              : target === 'closed'
                ? 'close_order'
                : target === 'paid'
                  ? 'mark_paid'
                  : target
  }
  const { error: rpcError } = await supabase.rpc('advance_order', {
    p_order_id: orderId,
    p_action: action,
    p_paid_amount: payload.paid_amount ?? null,
    p_payment_method: payload.payment_method ?? null,
    p_tips_amount: payload.tips_amount ?? null,
    p_cancel_reason: payload.cancel_reason ?? null,
  })
  if (rpcError) {
    // Eroare business (ex. cancel_over_payments, cancel_reason_required,
    // underpayment) → Error REAL cu hint/code păstrate, același contract ca
    // createOrder / get_order_audit_history. Obiectul PostgREST brut nu e
    // `instanceof Error`, deci consumatorii pierdeau hint-ul și afișau un
    // text generic („Verifică și reîncearcă") care nu spunea CE a refuzat
    // serverul (audit v3 RES-16/RES-25).
    const err = new Error(rpcError.message || 'Eroare la actualizarea comenzii') as Error & {
      hint?: string
      code?: string
    }
    err.hint = rpcError.hint ?? undefined
    err.code = rpcError.code ?? undefined
    throw err
  }
  if (opts?.hydrate === false) return null
  return fetchOrderById(orderId)
}

/**
 * Textul refuzului lui `advance_order` (ramura cancel) și al storno-ului, în
 * limba personalului (lotul L4b: `cancelRej_*` din namespace-ul `orders`).
 * Aceeași ordine a ramurilor și aceleași hint-uri ca înainte. În ROMÂNĂ
 * mesajul serverului primează exact ca înainte (are suma, mig 270); în altă
 * limbă un text românesc al serverului NU se arată (ecran amestecat), deci
 * rămâne textul hint-ului, iar un hint necunoscut cade pe textul generic.
 */
export function describeCancelRejection(err: unknown, tr: OrdersTranslator): string {
  const { t } = tr
  const hint = (err as { hint?: unknown } | null)?.hint
  const serverMsg = tr.lang === 'ro' && err instanceof Error && err.message ? err.message : ''
  switch (hint) {
    case 'cancel_over_payments':
      return serverMsg || t('cancelRej_overPayments')
    case 'cancel_reason_required':
      return t('cancelRej_reasonRequired')
    case 'void_reason_required':
      return t('cancelRej_voidReasonRequired')
    case 'role_insufficient':
      return t('cancelRej_role')
    case 'order_terminal':
      return t('cancelRej_terminal')
    default:
      // Un hint nou/necunoscut NU ascunde motivul real: în română mesajul
      // serverului primează, textul generic e doar pentru erori fără mesaj.
      if (serverMsg) return serverMsg
      if (tr.lang !== 'ro' && isNetworkError(err)) return t('cancelRej_network')
      return t('cancel_errGeneric')
  }
}

/**
 * Storno pe TOATE plățile comenzii + anulare, într-un singur RPC (o singură
 * tranzacție): un eșec oriunde rulează înapoi tot — nu există „stornat parțial
 * și comanda încă deschisă". Doar owner/manager, motiv obligatoriu.
 */
export async function voidPaymentsAndCancel(
  orderId: string,
  reason: string,
): Promise<{ order_id: string; voided_count: number; voided_amount: number }> {
  const { data, error } = await supabase.rpc('void_order_payments_and_cancel', {
    p_order_id: orderId,
    p_reason: reason,
  })
  if (error) {
    const err = new Error(error.message || 'Eroare la stornare/anulare') as Error & {
      hint?: string
      code?: string
    }
    err.hint = error.hint ?? undefined
    err.code = error.code ?? undefined
    throw err
  }
  return data as { order_id: string; voided_count: number; voided_amount: number }
}

/**
 * Textul refuzului lui `advance_order` (ramura mark_paid), în limba
 * personalului (lotul L4b: `payRej_*` din namespace-ul `payments`). Aceeași
 * ordine a ramurilor și aceleași hint-uri ca înainte. În ROMÂNĂ mesajul
 * serverului primează exact ca înainte (sumele pe under/overpayment, mig 264);
 * în altă limbă un text românesc al serverului NU se arată (ecran amestecat),
 * deci rămâne textul hint-ului, iar un hint necunoscut cade pe textul generic.
 */
export function describePayRejection(err: unknown, tr: PaymentsTranslator): string {
  const { t } = tr
  const hint = (err as { hint?: unknown } | null)?.hint
  const serverMsg = tr.lang === 'ro' && err instanceof Error && err.message ? err.message : ''
  switch (hint) {
    case 'underpayment':
    case 'overpayment':
      // Serverul spune exact suma și plafonul — e mesajul cel mai util (în română).
      return serverMsg || t('payRej_amountMismatch')
    case 'paid_amount_required':
      return t('payRej_amountRequired')
    case 'invalid_payment_method':
      return t('payRej_method')
    case 'fiscal_plan_requires_payment':
      return t('payRej_fiscal')
    case 'role_insufficient':
      return t('payRej_role')
    case 'order_terminal':
      return t('payRej_terminal')
    default:
      if (serverMsg) return t('payRej_withServer', { msg: serverMsg })
      if (tr.lang !== 'ro' && isNetworkError(err)) return t('payRej_network')
      return t('pay_errRejected')
  }
}

export interface CreateOrderArgs {
  restaurant_id: string
  source: 'qr' | 'waiter' | 'pickup'
  table_id: string | null
  qr_token_id: string | null
  notes: string | null
  cart: CartItem[]
  idempotency_key?: string
  pickup_time?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  session_id?: string | null
}

export async function createOrder(args: CreateOrderArgs): Promise<OrderConfirmationPayload> {
  const p_items = args.cart.map((item) => ({
    product_id: item.product_id,
    quantity: item.quantity,
    option_ids: item.selected_modifiers.map((m) => m.option_id),
    extra_ids: (item.selected_extras ?? []).map((e) => e.id),
    upsell_source: item.upsell_source ?? null,
    notes: item.notes ?? null,
  }))

  try {
    // Fast-path: dacă e evident offline și e comandă de ospătar, nu facem fetch inutil
    if (!navigator.onLine && args.source === 'waiter') {
      throw new TypeError('offline')
    }

    const { data, error } = await supabase.rpc('create_order', {
      p_restaurant_id: args.restaurant_id,
      p_source: args.source,
      p_table_id: args.table_id ?? null,
      p_qr_token_id: args.qr_token_id ?? null,
      p_notes: args.notes ?? null,
      p_items,
      p_idempotency_key: args.idempotency_key ?? null,
      p_pickup_time: args.pickup_time ?? null,
      p_customer_name: args.customer_name ?? null,
      p_customer_phone: args.customer_phone ?? null,
      p_session_id: args.session_id ?? null,
    })

    if (error) {
      // Eroare de rețea (edge down, timeout) → tratăm ca offline. supabase-js
      // NU aruncă la o cădere de rețea, întoarce mesajul fetch-ului în `error`
      // — iar pe iPhone acela e „TypeError: Load failed", pe care vechea
      // verificare (`includes('fetch')`) nu-l recunoștea: comanda ospătarului
      // nu intra în coada offline (lib/networkError.ts).
      if (isNetworkError(error) || error.code === '503') {
        throw new TypeError('network-error')
      }
      // Eroare business logic (ex. missing_required_group) → aruncă un Error
      // REAL: obiectul brut Supabase nu e `instanceof Error`, deci handlerele
      // (handleSubmit) îl tratau ca eroare generică și pierdeau mesajul specific.
      // Păstrăm mesajul uman + hint/code pentru orice logică programatică.
      const bizErr = new Error(error.message || 'Eroare la trimiterea comenzii') as Error & {
        hint?: string
        code?: string
      }
      bizErr.hint = error.hint ?? undefined
      bizErr.code = error.code ?? undefined
      throw bizErr
    }

    return data as OrderConfirmationPayload
  } catch (err) {
    // Offline sau eroare de rețea + comandă ospătar → salvăm în IndexedDB
    if (err instanceof TypeError && args.source === 'waiter') {
      console.warn(
        '[createOrder] Offline — comandă salvată local, va fi sincronizată când revine conexiunea',
      )
      const { savePendingOrder } = await import('./offlineSync')
      return savePendingOrder(args)
    }
    throw err // orice altceva (QR client offline, eroare business) → propagă
  }
}

// Istoric audit pentru o comandă: orders + order_items, prin RPC-ul
// get_order_audit_history (mig 080/081, SECURITY DEFINER), care refuză ORICE
// alt rol decât owner/manager. Ospătarul și bucătarul NU își văd nici măcar
// propriile acțiuni — de aceea WaiterPage nu le arată butonul „Vezi istoric".
// (Comentariul vechi de aici descria v_audit_recent cu RLS „waiter vede
// propriile acțiuni" — nu mai era adevărat de la mig 080.)
export interface AuditEntry {
  id: number
  created_at: string
  actor_id: string | null
  actor_name: string | null
  table_name: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  row_id: string
  changed_keys: string[] | null
  diff_short: Record<string, unknown> | null
}

// Umanizează o intrare de audit într-o frază scurtă, în limba personalului
// (lotul L4a: textele în namespace-ul `orders`, `audit_ev_*`). Funcție pură
// (fără I/O) — testabilă direct. Folosită de OrderAuditSheet.
export function describeAuditEntry(e: AuditEntry, tr: OrdersTranslator): string {
  const { t, tp } = tr
  if (e.table_name === 'orders') {
    if (e.operation === 'INSERT') return t('audit_ev_created')
    if (e.operation === 'DELETE') return t('audit_ev_deleted')
    if (e.changed_keys?.includes('status')) {
      const diff = e.diff_short as Record<string, { from?: string; to?: string }> | null
      const to = diff?.status?.to
      if (to === 'confirmed') return t('audit_ev_confirmed')
      if (to === 'preparing') return t('audit_ev_preparing')
      if (to === 'ready') return t('audit_ev_ready')
      if (to === 'served') return t('audit_ev_served')
      if (to === 'closed') return t('audit_ev_closed')
      if (to === 'paid') return t('audit_ev_paid')
      if (to === 'cancelled') return t('audit_ev_cancelled')
      return t('audit_ev_status', { status: String(to) })
    }
    if (e.changed_keys?.some((k) => k.startsWith('discount'))) {
      return t('audit_ev_discount')
    }
    if (e.changed_keys?.includes('total')) return t('audit_ev_total')
    return t('audit_ev_modified')
  }
  if (e.table_name === 'order_items') {
    // Audit-summary de la update_order_items: diff_short = {items:{from,to}, total:{from,to}}
    const diff = e.diff_short as {
      items?: { from?: unknown[]; to?: unknown[] }
      total?: { from?: number; to?: number }
    } | null
    if (e.operation === 'UPDATE' && (diff?.items || diff?.total)) {
      const fromCount = Array.isArray(diff?.items?.from) ? diff.items.from.length : null
      const toCount = Array.isArray(diff?.items?.to) ? diff.items.to.length : null
      const toTotal = diff?.total?.to
      const countPart =
        fromCount != null && toCount != null
          ? tp('audit_itemsCount', toCount, { from: fromCount })
          : t('audit_itemsUnknown')
      const totalPart = typeof toTotal === 'number' ? t('audit_totalPart', { amount: toTotal.toFixed(2) }) : ''
      return t('audit_ev_itemsChanged', { items: countPart, total: totalPart })
    }
    if (e.operation === 'INSERT' || e.operation === 'DELETE') {
      const item = e.diff_short as { product_name_snapshot?: string; quantity?: number } | null
      const vars = {
        product: item?.product_name_snapshot ?? t('audit_productFallback'),
        qty: item?.quantity ?? 1,
      }
      return t(e.operation === 'INSERT' ? 'audit_ev_itemAdded' : 'audit_ev_itemDeleted', vars)
    }
    return t('audit_ev_itemModified')
  }
  return `${e.table_name} · ${e.operation}`
}

export async function fetchOrderAuditHistory(orderId: string): Promise<AuditEntry[]> {
  // RPC SECURITY DEFINER cu role check (owner/manager only) — mig 080.
  // Pe RLS-ul direct pe audit_log filtrarea jsonb e fragilă; RPC-ul
  // joacă rolul de query unificat + permission gate.
  const { data, error } = await supabase.rpc('get_order_audit_history', {
    p_order_id: orderId,
  })
  // Aruncăm un Error REAL (nu obiectul PostgrestError brut) — altfel
  // OrderAuditSheet, care testează `e instanceof Error`, cade pe mesajul
  // generic „Eroare la încărcare" și ascunde cauza reală (ex. funcție
  // nedeployată, permisiune). Păstrăm code-ul pentru diagnoză.
  if (error) {
    const err = new Error(error.message || 'Nu s-a putut încărca istoricul comenzii') as Error & {
      code?: string
    }
    if (error.code) err.code = error.code
    throw err
  }
  return (data ?? []) as unknown as AuditEntry[]
}

export interface EditOrderItemPayload {
  product_id: string
  quantity: number
  option_ids: string[]
  notes: string | null
  // Lotul O3b (mig 320): linia din comandă din care provine. Cu ea, serverul
  // păstrează prețul, opțiunile și extra-urile liniei neschimbate, iar
  // extra-urile nu mai „sar” pe altă linie a aceluiași produs.
  source_item_id?: string
  // Extra-urile liniei (ale ei, pentru o linie existentă; cele alese, pentru
  // una nouă). Lipsă = serverul vechi le ghicea după produs.
  extra_ids?: string[]
}

/**
 * Ce află ospătarul după „Trimite comanda" (ux-staff-order-sent-feedback):
 * trimisă la bucătărie SAU salvată DOAR pe telefon — coada offline întoarce o
 * confirmare sintetică `LOCAL-…` (offlineSync.savePendingOrder). Înainte foaia
 * se închidea fără niciun semn, deci ospătarul nu știa că bucătăria NU a
 * primit comanda. Textul vine din namespace-ul `waiter` (lotul L4b).
 */
export function describeWaiterOrderSent(
  c: Pick<OrderConfirmationPayload, 'short_id'>,
  tr: WaiterTranslator,
): {
  kind: 'success' | 'warning'
  text: string
} {
  if (c.short_id.startsWith('LOCAL-')) {
    return { kind: 'warning', text: tr.t('sent_local', { id: c.short_id }) }
  }
  return { kind: 'success', text: tr.t('sent_ok', { id: c.short_id }) }
}

// Edit items pe comandă non-terminală, fără plăți parțiale.
// Server validează rol + status + plăți + produs/modificatori; client doar
// trimite snapshot-ul nou complet.
/**
 * Retipărește tichetul de bucătărie al comenzii (kitchen_ticket_reprint, mig
 * 227 — RPC-ul exista, dar n-avea niciun apelant). Nu aruncă pe refuzurile de
 * business: întoarce de ce n-a mers, ca ecranul să spună asta.
 */
export async function reprintKitchenTicket(
  orderId: string,
): Promise<'ok' | 'no_kitchen_printer' | 'not_found' | 'unavailable'> {
  const { data, error } = await supabase.rpc('kitchen_ticket_reprint', { p_order_id: orderId })
  if (error) return 'unavailable'
  const r = data as { ok?: boolean; reason?: string } | null
  if (r?.ok) return 'ok'
  if (r?.reason === 'no_kitchen_printer') return 'no_kitchen_printer'
  if (r?.reason === 'not_found') return 'not_found'
  return 'unavailable'
}

export async function updateOrderItems(
  orderId: string,
  items: EditOrderItemPayload[],
  expectedTotal?: number,
): Promise<{ id: string; total: number; discount_amount: number; items_count: number }> {
  const p_items = items.map((item) => ({
    product_id: item.product_id,
    quantity: item.quantity,
    option_ids: item.option_ids,
    notes: item.notes,
    ...(item.source_item_id ? { source_item_id: item.source_item_id } : {}),
    ...(item.extra_ids ? { extra_ids: item.extra_ids } : {}),
  }))
  const { data, error } = await supabase.rpc('update_order_items', {
    p_order_id: orderId,
    p_items,
    p_expected_total: expectedTotal ?? null,
  })
  if (error) {
    // Error REAL cu hint/code (ca advanceOrderStatus): obiectul PostgREST brut
    // nu e `instanceof Error`, iar EditOrderSheet afișa „Eroare la salvare" în
    // loc de motivul serverului (ex. „comanda a fost modificată între timp",
    // codul 40001 al lock-ului optimist din mig 146+).
    const err = new Error(error.message || 'Eroare la salvarea comenzii') as Error & {
      hint?: string
      code?: string
    }
    err.hint = error.hint ?? undefined
    err.code = error.code ?? undefined
    throw err
  }
  return data as { id: string; total: number; discount_amount: number; items_count: number }
}

function errorParts(err: unknown): { message: string; hint: string; code: string } {
  const o = err != null && typeof err === 'object' ? (err as Record<string, unknown>) : {}
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return { message: str(o.message), hint: str(o.hint), code: str(o.code) }
}

/**
 * Textul refuzului lui `update_order_items` (EditOrderSheet), în limba
 * personalului (lotul L4a: `edit_err*` din namespace-ul `orders`). Mesajele
 * serverului sunt prefixate `update_order_items:` și jumătate în engleză — nu
 * se arată brute; cele deja în română (grupe de opțiuni) se arată fără prefix,
 * dar DOAR în română: în altă limbă ar face ecranul amestecat, deci cad pe
 * textul tradus al clasei (`edit_errOptionGroup`).
 */
export function describeEditOrderError(err: unknown, tr: OrdersTranslator): string {
  const { t } = tr
  if (isNetworkError(err)) return t('edit_errNetwork')
  const { message, hint, code } = errorParts(err)
  const plain = message.replace(/^update_order_items:\s*/i, '').trim()
  // mig 320: fiecare salvare recreează liniile (id-uri noi). O editare
  // concurentă cu ACELAȘI total trece de lock-ul optimist, dar sursele trimise
  // nu mai există, iar reîncercarea ar pica identic: se redeschide comanda
  // (recenzia CodeRabbit pe #349).
  if (
    code === '40001' ||
    /modificată între timp/i.test(plain) ||
    hint === 'invalid_source_item' ||
    /linia sursă/i.test(plain)
  ) {
    return t('edit_errConcurrent')
  }
  if (
    hint === 'missing_required_group' ||
    hint === 'too_many_in_group' ||
    hint === 'duplicate_options'
  ) {
    return tr.lang === 'ro' ? plain : t('edit_errOptionGroup')
  }
  // mig 313: produsul s-a epuizat între timp; mig 320: sau a fost scos din
  // meniu / trecut în ciornă. Cantitatea DEJA comandată se poate păstra; doar
  // surplusul (sau un produs nou de felul ăsta) e respins. Fără ramura de
  // „scos din meniu”, mesajul cădea pe „Reîncearcă” și fiecare reîncercare
  // pica la fel (recenzia O3a).
  const soldOut = hint === 'product_sold_out' || /este epuizat/i.test(plain)
  const offMenu =
    hint === 'product_inactive' || hint === 'product_draft' || /nu mai e în meniu/i.test(plain)
  if (soldOut || offMenu) {
    const name = /"([^"]+)"/.exec(plain)?.[1]
    const kept = /\((\d+)\)\s*$/.exec(plain)?.[1]
    const who = name ? t('edit_errWhoNamed', { name }) : t('edit_errWhoUnknown')
    if (kept === '0') {
      return t(soldOut ? 'edit_errSoldOutNone' : 'edit_errOffMenuNone', { who })
    }
    const keep = kept != null ? t('edit_errKeepUpTo', { n: kept }) : t('edit_errKeepOnly')
    return t(soldOut ? 'edit_errSoldOutSome' : 'edit_errOffMenuSome', { who, keep })
  }
  if (/partial payments/i.test(plain)) {
    return t('edit_errPartialPayments')
  }
  if (/terminal state/i.test(plain)) return t('edit_errTerminal')
  if (/cannot edit orders|not a member/i.test(plain)) {
    return t('edit_errRole')
  }
  if (/order .* not found/i.test(plain)) return t('edit_errNotFound')
  if (/product .* not found|is inactive|does not belong/i.test(plain)) {
    return t('edit_errProductGone')
  }
  if (/invalid options|extras invalide/i.test(plain)) {
    return t('edit_errOptionGone')
  }
  if (hint === 'invalid_quantity' || /invalid quantity/i.test(plain)) {
    // Plafonul vine din mesajul serverului: 20 pe linie (mig 320), cantitatea
    // veche pentru o linie păstrată peste 20, 99 pe un server mai vechi.
    const cap = /invalid quantity \(1-(\d+)\)/i.exec(plain)?.[1] ?? String(MAX_LINE_QTY)
    return t('edit_errQuantity', { max: cap })
  }
  if (/too many items/i.test(plain)) return t('edit_errTooMany')
  return t('edit_errGeneric')
}

/**
 * Refuzul unei acțiuni rapide de staff (Confirmă / În pregătire / Gata /
 * Servit / Închide comanda), ca DATE (lotul L4c): `useOrders` ține asta pe
 * comandă, iar nota de pe card (ActionErrorNote) îl traduce la RANDARE, în
 * limba personalului — un text memorat în stare n-ar urma schimbarea limbii.
 * Mesajul serverului NU se păstrează: `advance_order` scrie în engleză
 * („Order not in a servable state (current: served)"), contractul stabil e
 * HINT-ul (și clasa „fără rețea").
 */
export interface StaffActionFailure {
  /** Hint-ul serverului (`invalid_transition`, `order_terminal`…), sau null. */
  hint: string | null
  /** Cererea n-a ajuns la server (fără conexiune). */
  network: boolean
}

export function staffActionFailure(err: unknown): StaffActionFailure {
  return { hint: errorParts(err).hint || null, network: isNetworkError(err) }
}

/**
 * Textul scurt al refuzului, în limba personalului (`actionErr_*` din
 * namespace-ul `orders`). Aceeași ordine ca înainte: rețeaua întâi, apoi
 * hint-ul; în română EXACT textele de dinainte.
 */
export function describeStaffActionError(f: StaffActionFailure, tr: OrdersTranslator): string {
  const { t } = tr
  if (f.network) return t('actionErr_network')
  switch (f.hint) {
    case 'invalid_transition':
      return t('actionErr_invalidTransition')
    case 'order_terminal':
      return t('actionErr_terminal')
    case 'order_not_found':
      return t('actionErr_notFound')
    case 'role_insufficient':
      return t('actionErr_role')
    case 'unauthorized':
      return t('actionErr_unauthorized')
    case 'auth_required':
      return t('actionErr_authRequired')
    case 'fiscal_plan_requires_payment':
      return t('actionErr_fiscalPlan')
    case 'action_in_progress':
      return t('actionErr_inProgress')
    default:
      return t('actionErr_generic')
  }
}

export async function fetchTables(restaurantId: string): Promise<RestaurantTable[]> {
  const { data, error } = await supabase
    .from('tables')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as RestaurantTable[]
}

export type RealtimeConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export function subscribeToOrders(
  restaurantId: string,
  onEvent: (payload: OrderRealtimePayload) => void,
  onStatus?: (status: RealtimeConnectionStatus) => void,
) {
  return supabase
    .channel(`orders:${restaurantId}`)
    .on<RealtimePostgresChangesPayload<Record<string, unknown>>>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
      (payload) => {
        onEvent({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          new: (payload.new ?? {}) as Record<string, unknown>,
          old: (payload.old ?? {}) as Record<string, unknown>,
        })
      },
    )
    .subscribe((status) => {
      if (!onStatus) return
      // Supabase realtime status: SUBSCRIBED | CHANNEL_ERROR | TIMED_OUT | CLOSED
      if (status === 'SUBSCRIBED') onStatus('connected')
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')
        onStatus('disconnected')
      else onStatus('connecting')
    })
}

// ── Waiter calls ──
export interface WaiterCall {
  id: string
  restaurant_id: string
  table_id: string | null
  // 'bill' = clientul cere nota; 'waiter' = chemare simplă (mig 091)
  call_type?: 'waiter' | 'bill'
  // Bacșiș PROPUS de client la „cere nota" (mig 223) — intenție, nu plată.
  tip_amount?: number | null
  status: 'pending' | 'resolved'
  created_at: string
  resolved_at: string | null
  table?: { name: string } | null
}

export async function fetchWaiterCalls(restaurantId: string): Promise<WaiterCall[]> {
  const { data, error } = await supabase
    .from('waiter_calls')
    .select('*, table:tables(name)')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as WaiterCall[]
}

export async function callWaiter(
  qrTokenId: string,
  callType: 'waiter' | 'bill' = 'waiter',
  // Bacșiș PROPUS de client la „cere nota" (mig 223) — intenție, nu plată;
  // ospătarul îl vede pe apel și îl introduce la încasare.
  tipAmount?: number | null,
): Promise<{ ok: boolean; message?: string }> {
  // 0 EXPLICIT se trimite (nu se aruncă la null): „Fără" după un bacșiș
  // anterior trebuie să RETRAGĂ suma de pe apelul pending (mig 223 face
  // UPDATE doar când v_tip nu e null) — altfel ospătarul vede bacșișul vechi.
  const { data, error } = await supabase.rpc('call_waiter', {
    p_qr_token_id: qrTokenId,
    p_call_type: callType,
    p_tip_amount: callType === 'bill' && tipAmount != null && tipAmount >= 0 ? tipAmount : null,
  })
  if (error) {
    // Fallback pe DB fără mig 223 (frontend înaintea migrației): semnătura
    // veche call_waiter(uuid,text) nu cunoaște p_tip_amount → PGRST202.
    // Fără fallback, „Cheamă ospătarul"/„Cere nota" ar muri complet —
    // retrimitem fără bacșiș (doar intenția se pierde, apelul ajunge).
    if ((error as { code?: string }).code === 'PGRST202') {
      const retry = await supabase.rpc('call_waiter', {
        p_qr_token_id: qrTokenId,
        p_call_type: callType,
      })
      if (retry.error) throw retry.error
      return retry.data as { ok: boolean; message?: string }
    }
    throw error
  }
  return data as { ok: boolean; message?: string }
}

export async function resolveWaiterCall(callId: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_waiter_call', { p_call_id: callId })
  if (error) throw error
}

export function subscribeToWaiterCalls(restaurantId: string, onEvent: () => void) {
  return supabase
    .channel(`waiter_calls:${restaurantId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'waiter_calls',
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      () => onEvent(),
    )
    .subscribe()
}

// ── Split bill ──
export async function addPartialPayment(
  orderId: string,
  amount: number,
  method: PaymentMethod,
): Promise<{ ok: boolean; total_paid: number; remaining: number; fully_paid: boolean }> {
  const { data, error } = await supabase.rpc('add_partial_payment', {
    p_order_id: orderId,
    p_amount: amount,
    p_method: method,
  })
  if (error) throw error
  return data as { ok: boolean; total_paid: number; remaining: number; fully_paid: boolean }
}

/** O linie din registrul de plăți al unei comenzi (order_payments), cum o întoarce get_order_payments. */
export interface OrderPaymentRow {
  id: string
  amount: number
  method: string
  created_at: string
}

/** Plățile deja înregistrate pe o comandă (parțiale cash/POS/tichete, split online). */
export async function getOrderPayments(orderId: string): Promise<OrderPaymentRow[]> {
  const { data, error } = await supabase.rpc('get_order_payments', { p_order_id: orderId })
  if (error) throw error
  return (data ?? []) as OrderPaymentRow[]
}

// ── Public order status (pentru QR tracking, clienți anon) ──
// FIX: OrderTracker/ActiveOrdersBanner se abonau la postgres_changes pe `orders`
// cu client anon, dar RLS blochează SELECT-ul → statusul nu se actualiza niciodată.
// Acum folosim un RPC SECURITY DEFINER + polling.
export interface PublicOrderStatus {
  id: string
  status: OrderStatus
  total: number
  tips_amount?: number
  paid_amount?: number
  payment_method?: string | null
  discount_amount?: number
  created_at: string
  confirmed_at?: string | null
  preparing_at?: string | null
  ready_at?: string | null
  served_at?: string | null
  paid_at?: string | null
  cancelled_at?: string | null
  fiscal_receipt_requested_at?: string | null
  restaurant?: {
    name: string
    slug: string
    google_review_url: string | null
  }
}

export async function getOrderPublicStatus(
  orderId: string,
  sessionId: string | null = null,
): Promise<PublicOrderStatus | null> {
  // Mig 092: fără sesiune validă, serverul întoarce payload MINIM
  // {id, short_id, status} — fără sume, fără timestamps.
  const { data, error } = await supabase.rpc('get_order_public_status', {
    p_order_id: orderId,
    p_session_id: sessionId,
  })
  if (error || data == null) return null
  return data as PublicOrderStatus
}

// ── Cerere bon fiscal (migration 043) ──
// Apelat de clientul final după plată. Marchează în DB că patronul trebuie
// să tipărească bonul fiscal pentru această comandă. Notificarea ajunge la
// ospătar prin Realtime subscribe.
export async function requestFiscalReceipt(
  orderId: string,
  sessionId: string | null = null,
): Promise<{ success: boolean; already_requested: boolean; requested_at: string } | null> {
  // Mig 092: write-ul cere sesiune validă pentru comenzile de la masă.
  const { data, error } = await supabase.rpc('request_fiscal_receipt', {
    p_order_id: orderId,
    p_session_id: sessionId,
  })
  if (error || data == null) return null
  return data as { success: boolean; already_requested: boolean; requested_at: string }
}

// ── Discount-uri pe comandă (migration 031) ──
// RPC apply_order_discount validează: doar admin/manager, comandă neplătită,
// valoare > 0, procent <= 100. Recalculează automat orders.total.
export async function applyOrderDiscount(
  orderId: string,
  type: 'percent' | 'amount',
  value: number,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('apply_order_discount', {
    p_order_id: orderId,
    p_type: type,
    p_value: value,
    p_reason: reason,
  })
  if (error) throw error
}

export async function removeOrderDiscount(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_order_discount', {
    p_order_id: orderId,
  })
  if (error) throw error
}

/**
 * Compute subtotal client-side din order_items (fallback când nu vine din server).
 * Folosit pentru afișare breakdown subtotal/discount/total în PayModal.
 */
export function orderSubtotal(order: Order): number {
  if (!order.order_items?.length) {
    // Fallback: total + discount_amount (reverse engineering)
    return order.total + (order.discount_amount || 0)
  }
  return order.order_items.reduce((sum, it) => sum + Number(it.item_total || 0), 0)
}

export async function closeSessionOrders(
  sessionId: string,
): Promise<{ closed_count: number; cancelled_count?: number; already_closed?: boolean }> {
  const { data, error } = await supabase.rpc('close_session_orders', { p_session_id: sessionId })
  if (error) {
    // Error REAL cu hint/code (ca advanceOrderStatus/createOrder): obiectul
    // PostgREST brut nu e `instanceof Error`, deci apelantul ar afișa un text
    // generic în loc de motivul serverului (ex. fiscal_plan_requires_payment).
    const err = new Error(error.message || 'Masa nu a putut fi închisă') as Error & {
      hint?: string
      code?: string
    }
    err.hint = error.hint ?? undefined
    err.code = error.code ?? undefined
    throw err
  }
  // `cancelled_count` (mig 288): rundele neservite anulate la închiderea mesei;
  // lipsește pe o bază fără 288 (deploy înaintea migrației) → opțional.
  return data as { closed_count: number; cancelled_count?: number; already_closed?: boolean }
}

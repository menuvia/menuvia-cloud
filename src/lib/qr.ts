import { supabase } from './supabase'
import type { Translations } from './i18nMenu'
import type { FloorLayout } from './floorPlan'

export interface Socials {
  instagram?: string | null
  facebook?: string | null
  tiktok?: string | null
  website?: string | null
}

export interface DayHours {
  open: string // HH:MM
  close: string // HH:MM
  closed: boolean
}

export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export type HoursStructured = Partial<Record<WeekDay, DayHours>>

export interface Restaurant {
  id: string
  name: string
  slug?: string
  tagline?: string | null
  description?: string | null
  address?: string | null
  phone?: string | null
  hours?: string | null
  primary_color: string
  logo_url: string | null
  cover_url?: string | null
  // Moneda meniului (mig 007; activată în 205, expusă pe QR în 206).
  currency?: string | null
  language?: string
  ordering_enabled?: boolean
  socials?: Socials | null
  amenities?: string[]
  hours_structured?: HoursStructured | null
  wifi_password?: string | null
  timezone?: string | null
  google_review_url?: string | null
  checkout_suggestion_settings?: {
    enabled: boolean
    categories: string[]
    max_suggestions: number
    message: string
  } | null
  theme_settings?: {
    preset_id: string
    accent_override?: string | null
    menu_layout?: 'list' | 'grid' | 'minimal' | 'photo' | 'flipbook' | null
    elements?: {
      cover?: boolean
      tagline?: boolean
      status?: boolean
      amenities?: boolean
      social?: boolean
    } | null
    flipbook_pages?: string[] | null
    // Ascunde badge-ul „Creat cu Menuvia" (E1) — citit de QrMenuPage prin
    // resolveHideBranding; scrierea e gate-uită în UI pe Plan 2+ (remove_branding).
    hide_branding?: boolean | null
  } | null
  pickup_settings?: {
    enabled: boolean
    min_lead_time_minutes: number
    slot_interval_minutes: number
    open_hours: { start: string; end: string }
    instructions: string | null
  } | null
  // Limbile expuse clientului (coduri, ex. ['en','de']). Româna e mereu baza.
  menu_languages: string[]
}

export interface QrToken {
  id: string
  restaurant_id: string
  table_id: string
  token: string
  is_active: boolean
  expires_at: string | null
  created_at: string
}

export interface Table {
  id: string
  restaurant_id: string
  name: string
  slug: string
  seats: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ModifierOption {
  id: string
  modifier_group_id: string
  name: string
  price_delta: number
  is_available: boolean
  display_order: number
}

export interface ModifierGroup {
  id: string
  restaurant_id: string
  name: string
  selection_type: 'single' | 'multiple'
  is_required: boolean
  min_select: number
  max_select: number | null
  display_order: number
  modifier_options: ModifierOption[]
}

// ── Reguli min/max pe grupurile de modificatori ──────────────────────
// Minimul EFECTIV de opțiuni cerute de un grup: `is_required` garantează
// cel puțin 1, iar `min_select > 0` obligă și fără `is_required` — în schemă
// (mig 002) cele două coloane sunt independente. Pe single-select plafonăm
// la 1: o singură opțiune e maximul fizic selectabil (serverul — mig 191 —
// aplică același plafon). 0 = grup cu adevărat opțional.
export function modifierGroupMin(
  g: Pick<ModifierGroup, 'selection_type' | 'is_required' | 'min_select'>,
): number {
  const min = Math.max(g.min_select, g.is_required ? 1 : 0)
  return g.selection_type === 'single' ? Math.min(min, 1) : min
}

// Microcopy RO afișat sub titlul grupului („Alege între…", „Alege cel puțin…",
// „Maxim…"). Doar pe grupurile multiple — pe single, radio-ul comunică singur
// regula „exact una".
export function modifierGroupHint(
  g: Pick<ModifierGroup, 'selection_type' | 'is_required' | 'min_select' | 'max_select'>,
): string | null {
  if (g.selection_type !== 'multiple') return null
  const min = modifierGroupMin(g)
  const max = g.max_select
  if (min > 0 && max != null) {
    return min === max ? `Alege exact ${min}` : `Alege între ${min} și ${max}`
  }
  if (min > 0) return `Alege cel puțin ${min}`
  if (max != null) return `Maxim ${max}`
  return null
}

// Quick-add („+" direct în coș, fără sheet) e permis DOAR dacă niciun grup
// nu are minim efectiv > 0 — altfel serverul (mig 191) respinge comanda.
export function hasMandatoryModifierGroups(groups: ModifierGroup[] | null | undefined): boolean {
  return (groups ?? []).some((g) => modifierGroupMin(g) > 0)
}

export interface ProductExtra {
  id: string
  name: string
  price: number
  emoji: string | null
  display_order: number
  is_available: boolean
}

export interface ProductPairing {
  id: string
  paired_product_id: string
  display_order: number
}

export interface Product {
  id: string
  restaurant_id: string
  category_id: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  is_sold_out: boolean
  is_draft: boolean
  is_daily_special: boolean
  display_order: number
  modifier_groups: ModifierGroup[]
  allergens: string[]
  dietary_tags: string[]
  prep_time_minutes: number | null
  portion_size: string | null
  vat_group: number
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  ai_generated_fields: string[]
  extras: ProductExtra[]
  pairings: ProductPairing[]
  // Traduceri manuale per limbă (cheia = cod de limbă). Vezi src/lib/i18nMenu.ts.
  translations?: Translations | null
}

export interface Category {
  id: string
  restaurant_id: string
  name: string
  display_order: number
  meta_text: string | null
  products: Product[]
  // Traduceri manuale per limbă (cheia = cod de limbă). Vezi src/lib/i18nMenu.ts.
  translations?: Translations | null
}

export interface ResolvedQrToken {
  token: QrToken
  table: Table
  restaurant: Restaurant
  orderingAllowed: boolean
}

// Coerce valoarea jsonb `menu_languages` (poate lipsi / fi null / array) la
// un string[] curat. Fail-safe: orice formă neașteptată → [] (switcher ascuns).
function parseMenuLanguages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

export async function resolveQrToken(rawToken: string): Promise<ResolvedQrToken | null> {
  // FIX: migration-015 a drop-at policy-ul public pe `restaurants`, ceea ce
  // făcea embed-ul `restaurant:restaurants(*)` să returneze null pentru anon.
  // Folosim acum RPC SECURITY DEFINER care expune doar câmpurile publice.
  const { data, error } = await supabase.rpc('resolve_qr_token', { p_token: rawToken })
  if (error || data == null) return null
  return mapResolvedQrPayload(data)
}

// Maparea payload-ului jsonb al resolve_qr_token → ResolvedQrToken. Partajată
// cu resolveQrMenu (mig 245, RPC-ul compus) — o singură sursă de adevăr.
function mapResolvedQrPayload(data: unknown): ResolvedQrToken | null {
  if (data == null || typeof data !== 'object') return null
  const payload = data as {
    token: QrToken
    table: Table
    restaurant: Record<string, unknown>
    orderingAllowed: boolean
  }
  const restaurant = payload.restaurant

  return {
    token: payload.token,
    table: payload.table,
    // Mapăm TOATE câmpurile publice pe care RPC-ul `resolve_qr_token` (mig 127)
    // le SELECTează: id, name, primary_color, logo_url, address, phone, hours,
    // checkout_suggestion_settings, theme_settings. Fără theme_settings /
    // checkout_suggestion_settings, QrMenuPage nu-și aplica tema/layout-ul
    // (resolveTheme/resolveMenuLayout) și nici upsell-ul de checkout.
    // Notă: RPC-ul NU întoarce `currency`/`ordering_enabled` pe obiectul
    // restaurant (semnalul de comandă vine separat prin `orderingAllowed`).
    restaurant: {
      id: restaurant.id as string,
      name: restaurant.name as string,
      primary_color: (restaurant.primary_color as string) ?? '#C8963C',
      logo_url: restaurant.logo_url as string | null,
      address: restaurant.address as string | null | undefined,
      phone: restaurant.phone as string | null | undefined,
      hours: restaurant.hours as string | null | undefined,
      checkout_suggestion_settings:
        restaurant.checkout_suggestion_settings as Restaurant['checkout_suggestion_settings'],
      theme_settings: restaurant.theme_settings as Restaurant['theme_settings'],
      // Limbile de meniu — expuse de RPC din mig 206; parseMenuLanguages rămâne
      // fail-safe ([] pe un RPC vechi nedeployat).
      menu_languages: parseMenuLanguages(restaurant.menu_languages),
      // mig 206 o expune; pe un RPC vechi rămâne undefined → fmtPrice cade pe RON.
      currency: (restaurant.currency as string | null | undefined) ?? null,
    },
    orderingAllowed: payload.orderingAllowed,
  }
}

// ── RPC compus (mig 245): scanarea QR pe UN SINGUR RTT ─────────────────
export interface ResolvedQrMenu {
  resolved: ResolvedQrToken
  menu: Category[] | null
}

let composedQrWarned = false

/**
 * resolve_qr_menu = resolve_qr_token + get_menu_for_restaurant compuse
 * server-side (mig 245). Fallback AUTOMAT pe fluxul în doi pași dacă RPC-ul
 * lipsește (frontend înaintea migrației) sau întoarce o formă neașteptată —
 * fallback-ul NU se șterge (aceeași disciplină ca fetchMenuForRestaurant).
 */
export async function resolveQrMenu(rawToken: string): Promise<ResolvedQrMenu | null> {
  const { data, error } = await supabase.rpc('resolve_qr_menu', { p_token: rawToken })
  if (!error && data != null && typeof data === 'object') {
    const payload = data as { resolved?: unknown; menu?: unknown }
    const resolved = mapResolvedQrPayload(payload.resolved)
    if (resolved) {
      return {
        resolved,
        menu: Array.isArray(payload.menu) ? (payload.menu as Category[]) : null,
      }
    }
  }
  if (error && !composedQrWarned) {
    composedQrWarned = true
    console.warn('[qr] resolve_qr_menu indisponibil, folosesc fluxul în doi pași:', error.message)
  }
  const resolved = await resolveQrToken(rawToken)
  if (!resolved) return null
  const menu = await fetchMenuForRestaurant(resolved.restaurant.id)
  return { resolved, menu }
}

/** Fetch restaurant by slug using SECURITY DEFINER RPC (no full-scan) */
export async function fetchRestaurantBySlug(slug: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc('get_restaurant_by_slug', { p_slug: slug })
  if (error) {
    // Observabilitate: fără log, o eroare reală de backend (rețea/RLS/DB) era
    // indistinctă de „slug inexistent" și dispărea complet.
    console.error('[qr] fetchRestaurantBySlug:', error)
    return null
  }
  // RPC returns setof — Supabase gives array. Take first row.
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined
  if (row == null) return null
  // Normalizăm menu_languages la string[] (RPC-ul îl expune doar dacă proiecția
  // lui îl include — fast-follow; până atunci rămâne []).
  return { ...row, menu_languages: parseMenuLanguages(row.menu_languages) }
}

// ── RPC compus (mig 245): /m/:slug pe UN SINGUR RTT ────────────────────
export interface MenuBySlug {
  restaurant: Record<string, unknown>
  menu: Category[] | null
}

let composedSlugWarned = false

/**
 * get_menu_by_slug = get_restaurant_by_slug + get_menu_for_restaurant compuse
 * server-side (mig 245). `null` fără eroare = slug inexistent (404-ul
 * existent). Pe eroare (ex. RPC nedeployat) cade pe fluxul în doi pași —
 * fallback-ul NU se șterge.
 */
export async function fetchMenuBySlug(slug: string): Promise<MenuBySlug | null> {
  const { data, error } = await supabase.rpc('get_menu_by_slug', { p_slug: slug })
  if (!error) {
    if (data == null) return null // slug inexistent (contractul RPC)
    if (typeof data === 'object') {
      const payload = data as { restaurant?: Record<string, unknown> | null; menu?: unknown }
      if (payload.restaurant && typeof payload.restaurant === 'object') {
        return {
          restaurant: {
            ...payload.restaurant,
            menu_languages: parseMenuLanguages(payload.restaurant.menu_languages),
          },
          menu: Array.isArray(payload.menu) ? (payload.menu as Category[]) : null,
        }
      }
    }
  }
  if (error && !composedSlugWarned) {
    composedSlugWarned = true
    console.warn('[qr] get_menu_by_slug indisponibil, folosesc fluxul în doi pași:', error.message)
  }
  const r = await fetchRestaurantBySlug(slug)
  if (!r) return null
  return { restaurant: r, menu: null } // meniul îl aduce apelantul separat
}

// ── Harta sălii publică + disponibilitate mese (rezervare cu alegere pe hartă) ──

/** Masă reală expusă public pentru maparea layout → tables. */
export interface PublicFloorTable {
  id: string
  name: string
  seats: number | null
  zone: string | null
}

export interface PublicFloorPlan {
  floor_layout: FloorLayout | null
  tables: PublicFloorTable[]
}

export interface TableAvailabilityRow {
  table_id: string
  table_name: string
  seats: number | null
  zone: string | null
  is_available: boolean
}

/**
 * Harta sălii publică pentru un restaurant (RPC get_public_floor_plan, mig 199).
 * Întoarce `floor_layout` (jsonb sau null) + lista meselor reale pentru mapare.
 * Supabase-js NU aruncă — verificăm `{error}` și degradăm grațios la layout null.
 */
export async function fetchPublicFloorPlan(slug: string): Promise<PublicFloorPlan> {
  const { data, error } = await supabase.rpc('get_public_floor_plan', { p_slug: slug })
  if (error) {
    console.error('[qr] fetchPublicFloorPlan:', error)
    return { floor_layout: null, tables: [] }
  }
  // RPC returnează un singur obiect jsonb (poate veni și ca array cu 1 rând).
  const row = (Array.isArray(data) ? data[0] : data) as
    | { floor_layout?: unknown; tables?: unknown }
    | null
    | undefined
  if (row == null) return { floor_layout: null, tables: [] }
  const layout = (row.floor_layout as FloorLayout | null | undefined) ?? null
  const tables = Array.isArray(row.tables) ? (row.tables as PublicFloorTable[]) : []
  return { floor_layout: layout, tables }
}

/**
 * Disponibilitatea meselor pentru un slot (RPC get_tables_availability, mig 199).
 * `startsAt`/`endsAt` = ISO timestamptz. Întoarce câte un rând per masă cu
 * `is_available`. Eroare → [] (harta nu se afișează, fluxul rămâne neschimbat).
 */
export async function fetchTablesAvailability(
  slug: string,
  startsAt: string,
  endsAt: string,
  partySize: number,
): Promise<TableAvailabilityRow[]> {
  const { data, error } = await supabase.rpc('get_tables_availability', {
    p_slug: slug,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_party_size: partySize,
  })
  if (error) {
    // Aruncă (nu întoarce []): un array gol „din eroare" era indistinct de un
    // array gol legitim, deci apelantul (ReservationSheet) nu putea afișa un
    // mesaj — harta apărea cu toate mesele neutre/neselectabile, tăcut. Acum
    // .catch-ul din efect setează mapError și cade grațios pe alocare automată.
    console.error('[qr] fetchTablesAvailability:', error)
    throw new Error(error.message || 'get_tables_availability a eșuat')
  }
  return (Array.isArray(data) ? data : []) as TableAvailabilityRow[]
}

interface RawCategoryRow {
  id: string
  restaurant_id: string
  name: string
  display_order: number
  meta_text: string | null
  translations: Translations | null
}
interface RawProductRow {
  id: string
  restaurant_id: string
  category_id: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  is_sold_out: boolean
  is_draft: boolean
  is_daily_special: boolean
  display_order: number
  allergens: string[]
  dietary_tags: string[]
  prep_time_minutes: number | null
  portion_size: string | null
  vat_group: number
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  ai_generated_fields: string[]
  extras: ProductExtra[]
  pairings: ProductPairing[]
  translations: Translations | null
}
interface RawPmgRow {
  product_id: string
  modifier_group_id: string
  display_order: number
}
interface RawModifierGroupRow {
  id: string
  restaurant_id: string
  name: string
  selection_type: 'single' | 'multiple'
  is_required: boolean
  min_select: number
  max_select: number | null
  display_order: number
}
interface RawModifierOptionRow {
  id: string
  modifier_group_id: string
  name: string
  price_delta: number
  is_available: boolean
  display_order: number
}

let menuRpcWarned = false

export async function fetchMenuForRestaurant(restaurantId: string): Promise<Category[]> {
  // Fast path: tot arborele într-un singur RTT (mig 212). Pe 4G de restaurant
  // asta taie 2 round-trip-uri dependente (~200-400ms) la FIECARE scanare.
  // Fallback pe implementarea pe straturi dacă RPC-ul lipsește (frontend
  // deployat înaintea migrației) sau întoarce o formă neașteptată.
  const { data, error } = await supabase.rpc('get_menu_for_restaurant', {
    p_restaurant_id: restaurantId,
  })
  if (!error && Array.isArray(data)) {
    return data as Category[]
  }
  if (error && !menuRpcWarned) {
    menuRpcWarned = true
    console.warn('[qr] get_menu_for_restaurant indisponibil, folosesc fallback-ul pe straturi:', error.message)
  }
  return fetchMenuLayered(restaurantId)
}

async function fetchMenuLayered(restaurantId: string): Promise<Category[]> {
  // ── Layer 1: categories + products în PARALEL ──────────────────
  // Ambele depind DOAR de restaurantId (nu una de alta). Serial degeaba →
  // pe 4G de restaurant, un round-trip Supabase e ~100-300ms. Rezultatul e
  // identic; păstrăm early-exit-urile de mai jos.
  const [catRes, prodRes] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, display_order, restaurant_id, meta_text, translations')
      .eq('restaurant_id', restaurantId)
      .order('display_order', { ascending: true }),
    supabase
      .from('products')
      .select(
        'id, restaurant_id, category_id, name, description, price, image_url, is_sold_out, is_draft, is_daily_special, display_order, allergens, dietary_tags, prep_time_minutes, portion_size, vat_group, calories, protein_g, carbs_g, fat_g, ai_generated_fields, translations',
      )
      .eq('restaurant_id', restaurantId)
      .eq('is_draft', false)
      .eq('is_active', true)
      .order('display_order', { ascending: true }),
  ])
  // PostgrestError brut nu trece de `instanceof Error` în UI (pattern orders.ts).
  if (catRes.error) throw new Error(catRes.error.message)
  const categories = (catRes.data ?? []) as RawCategoryRow[]
  if (categories.length === 0) return []
  if (prodRes.error) throw new Error(prodRes.error.message)
  const products = (prodRes.data ?? []) as RawProductRow[]
  if (products.length === 0) return categories.map((c) => ({ ...c, products: [] }))

  const productIds = products.map((p) => p.id)

  // ── Layer 2: pmg + extras + pairings în PARALEL ────────────────
  // Toate trei depind DOAR de productIds. pmg dă modifierGroupIds pentru
  // layer-ul 3; extras/pairings sunt complet independente de lanțul de
  // modificatori, deci nu au de ce să-l aștepte. (extras/pairings înghit
  // erorile intenționat — sunt „nice to have", ca înainte.)
  const [pmgRes, extrasRes, pairingsRes] = await Promise.all([
    supabase
      .from('product_modifier_groups')
      .select('product_id, modifier_group_id, display_order')
      .in('product_id', productIds),
    supabase
      .from('product_extras')
      .select('id, product_id, name, price, emoji, display_order, is_available')
      .in('product_id', productIds)
      .eq('is_available', true)
      .order('display_order', { ascending: true }),
    supabase
      .from('product_pairings')
      .select('id, product_id, paired_product_id, display_order')
      .in('product_id', productIds)
      .order('display_order', { ascending: true }),
  ])
  if (pmgRes.error) throw new Error(pmgRes.error.message)
  const pmgList = (pmgRes.data ?? []) as RawPmgRow[]
  const modifierGroupIds = [...new Set(pmgList.map((r) => r.modifier_group_id))]
  const extrasRows = extrasRes.data
  const pairingsRows = pairingsRes.data

  // ── Layer 3: modifier_groups + modifier_options în PARALEL ─────
  // Ambele depind DOAR de modifierGroupIds (nu una de alta).
  let modifierGroups: RawModifierGroupRow[] = []
  let modifierOptions: RawModifierOptionRow[] = []

  if (modifierGroupIds.length > 0) {
    const [mgRes, moRes] = await Promise.all([
      supabase
        .from('modifier_groups')
        .select(
          'id, restaurant_id, name, selection_type, is_required, min_select, max_select, display_order',
        )
        .in('id', modifierGroupIds),
      supabase
        .from('modifier_options')
        .select('id, modifier_group_id, name, price_delta, is_available, display_order')
        .in('modifier_group_id', modifierGroupIds)
        .eq('is_available', true)
        .order('display_order', { ascending: true }),
    ])
    if (mgRes.error) throw new Error(mgRes.error.message)
    modifierGroups = (mgRes.data ?? []) as RawModifierGroupRow[]
    if (moRes.error) throw new Error(moRes.error.message)
    modifierOptions = (moRes.data ?? []) as RawModifierOptionRow[]
  }

  const groupMap = new Map<string, ModifierGroup>()
  for (const mg of modifierGroups) {
    groupMap.set(mg.id, {
      ...mg,
      modifier_options: modifierOptions
        .filter((mo) => mo.modifier_group_id === mg.id)
        .sort((a, b) => a.display_order - b.display_order),
    })
  }

  const pmgByProduct = new Map<string, RawPmgRow[]>()
  for (const row of pmgList) {
    const existing = pmgByProduct.get(row.product_id) ?? []
    existing.push(row)
    pmgByProduct.set(row.product_id, existing)
  }

  // Build maps: product_id → ProductExtra[] and product_id → ProductPairing[]
  // (extrasRows / pairingsRows au fost aduse deja în Layer 2, în paralel.)
  const extrasByProduct = new Map<string, ProductExtra[]>()
  for (const row of (extrasRows ?? []) as Array<ProductExtra & { product_id: string }>) {
    const arr = extrasByProduct.get(row.product_id) ?? []
    arr.push({
      id: row.id,
      name: row.name,
      price: row.price,
      emoji: row.emoji,
      display_order: row.display_order,
      is_available: row.is_available,
    })
    extrasByProduct.set(row.product_id, arr)
  }

  const pairingsByProduct = new Map<string, ProductPairing[]>()
  for (const row of (pairingsRows ?? []) as Array<ProductPairing & { product_id: string }>) {
    const arr = pairingsByProduct.get(row.product_id) ?? []
    arr.push({
      id: row.id,
      paired_product_id: row.paired_product_id,
      display_order: row.display_order,
    })
    pairingsByProduct.set(row.product_id, arr)
  }

  const hydratedProducts: Product[] = products.map((p) => {
    const pmgForProduct = (pmgByProduct.get(p.id) ?? []).sort(
      (a, b) => a.display_order - b.display_order,
    )
    const productModifierGroups: ModifierGroup[] = pmgForProduct
      .map((r) => groupMap.get(r.modifier_group_id))
      .filter((g): g is ModifierGroup => g != null)
    return {
      ...p,
      modifier_groups: productModifierGroups,
      extras: extrasByProduct.get(p.id) ?? [],
      pairings: pairingsByProduct.get(p.id) ?? [],
      // Traduceri: null (produs netradus) → {} ca trName/trDesc să facă fallback la original.
      translations: p.translations ?? {},
    }
  })

  const productsByCategory = new Map<string, Product[]>()
  for (const p of hydratedProducts) {
    const existing = productsByCategory.get(p.category_id) ?? []
    existing.push(p)
    productsByCategory.set(p.category_id, existing)
  }

  return categories.map((cat) => ({
    ...cat,
    translations: cat.translations ?? {},
    products: (productsByCategory.get(cat.id) ?? []).sort(
      (a, b) => a.display_order - b.display_order,
    ),
  }))
}

// ── Happy Hour (afișare pe meniu public) ─────────────────────────
export interface HappyHourRule {
  id: string
  name: string
  scope: 'all' | 'category' | 'product'
  category_id: string | null
  product_id: string | null
  discount_type: 'percent' | 'amount'
  discount_value: number
  max_discount: number | null
}

/** Regulile Happy Hour active ACUM (server decide ora/zilele). Public/anon. */
export async function fetchActiveHappyHour(restaurantId: string): Promise<HappyHourRule[]> {
  const { data, error } = await supabase.rpc('public_happy_hour_now', {
    p_restaurant_id: restaurantId,
  })
  if (error || !data) return []
  return data as HappyHourRule[]
}

/**
 * Pentru afișare per-produs: cel mai bun discount PROCENTUAL aplicabil
 * produsului. Reducerile de tip 'amount' sunt la nivel de notă (nu per-unit),
 * deci nu le reflectăm în prețul unitar — apar doar în banner-ul de sus și se
 * aplică exact server-side la crearea comenzii. Întoarce procentul (0 = niciunul).
 */
export function happyHourPercentForProduct(
  product: Pick<Product, 'id' | 'category_id'>,
  rules: HappyHourRule[],
): number {
  let best = 0
  for (const r of rules) {
    if (r.discount_type !== 'percent') continue
    const applies =
      r.scope === 'all' ||
      (r.scope === 'category' && r.category_id === product.category_id) ||
      (r.scope === 'product' && r.product_id === product.id)
    if (applies && r.discount_value > best) best = r.discount_value
  }
  return best
}

/** Întoarce ziua + ora curentă în timezone-ul restaurantului. */
function nowInTimezone(timezone: string): { day: WeekDay; minutes: number } {
  // toLocaleString cu timeZone returnează exact ce vrem; parsăm cu Date
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  const map: Record<string, WeekDay> = {
    Sun: 'sun',
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
  }
  return { day: map[weekdayShort] ?? 'mon', minutes: hour * 60 + minute }
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10))
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/**
 * Întoarce true/false pe baza orelor structurate + timezone.
 * Întoarce null dacă lipsesc datele (hero pill complet ascuns,
 * NU "ÎNCHIS").
 */
export function computeIsOpen(
  hours: HoursStructured | null | undefined,
  timezone: string | null | undefined,
): boolean | null {
  if (!hours || Object.keys(hours).length === 0) return null
  const tz = timezone || 'Europe/Bucharest'
  let now
  try {
    now = nowInTimezone(tz)
  } catch {
    return null
  }
  const today = hours[now.day]
  if (!today || today.closed) return false
  const open = parseHHMM(today.open)
  const close = parseHHMM(today.close)
  // Program peste miezul nopții (ex: 18:00–02:00): deschis dacă ora curentă e
  // după open SAU înainte de close. open == close => 24/7.
  if (close <= open) return now.minutes >= open || now.minutes < close
  return now.minutes >= open && now.minutes < close
}

/** Întoarce program zi astăzi formatat "08:00–23:00" sau null. */
export function todayHoursLabel(
  hours: HoursStructured | null | undefined,
  timezone: string | null | undefined,
): string | null {
  if (!hours) return null
  const tz = timezone || 'Europe/Bucharest'
  let day: WeekDay
  try {
    day = nowInTimezone(tz).day
  } catch {
    return null
  }
  const today = hours[day]
  if (!today || today.closed) return null
  return today.open + '–' + today.close
}

export interface TableSessionResult {
  session_id: string
  table_id: string
  restaurant_id: string
  status: 'open'
  opened_at: string
  is_new: boolean
}

/** Deschide sau returnează sesiunea curentă a mesei. Apelat la scanarea QR. */
export async function openTableSession(token: string): Promise<TableSessionResult> {
  const { data, error } = await supabase.rpc('open_table_session', { p_token: token })
  // Error real, nu PostgrestError brut — callerii testează `instanceof Error`.
  if (error) throw new Error(error.message)
  return data as TableSessionResult
}

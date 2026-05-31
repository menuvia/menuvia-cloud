import { supabase } from './supabase'

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
  currency?: string
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
  theme_settings?: { preset_id: string; accent_override?: string | null } | null
  pickup_settings?: {
    enabled: boolean
    min_lead_time_minutes: number
    slot_interval_minutes: number
    open_hours: { start: string; end: string }
    instructions: string | null
  } | null
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
  extras: ProductExtra[]
  pairings: ProductPairing[]
}

export interface Category {
  id: string
  restaurant_id: string
  name: string
  display_order: number
  products: Product[]
}

export interface ResolvedQrToken {
  token: QrToken
  table: Table
  restaurant: Restaurant
  orderingAllowed: boolean
}

export async function resolveQrToken(rawToken: string): Promise<ResolvedQrToken | null> {
  // FIX: migration-015 a drop-at policy-ul public pe `restaurants`, ceea ce
  // făcea embed-ul `restaurant:restaurants(*)` să returneze null pentru anon.
  // Folosim acum RPC SECURITY DEFINER care expune doar câmpurile publice.
  const { data, error } = await supabase.rpc('resolve_qr_token', { p_token: rawToken })
  if (error || data == null) return null

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
    restaurant: {
      id: restaurant.id as string,
      name: restaurant.name as string,
      primary_color: (restaurant.primary_color as string) ?? '#C8963C',
      logo_url: restaurant.logo_url as string | null,
      currency: restaurant.currency as string | undefined,
      ordering_enabled: restaurant.ordering_enabled as boolean | undefined,
    },
    orderingAllowed: payload.orderingAllowed,
  }
}

/** Fetch restaurant by slug using SECURITY DEFINER RPC (no full-scan) */
export async function fetchRestaurantBySlug(slug: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc('get_restaurant_by_slug', { p_slug: slug })
  if (error) return null
  // RPC returns setof — Supabase gives array. Take first row.
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null
  return (data as Record<string, unknown>) ?? null
}

/** Fetch restaurant by QR token using SECURITY DEFINER RPC */
export async function fetchRestaurantByQrToken(
  token: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc('get_restaurant_by_qr_token', { p_token: token })
  if (error) return null
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null
  return (data as Record<string, unknown>) ?? null
}

interface RawCategoryRow {
  id: string
  restaurant_id: string
  name: string
  display_order: number
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
  extras: ProductExtra[]
  pairings: ProductPairing[]
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

export async function fetchMenuForRestaurant(restaurantId: string): Promise<Category[]> {
  const { data: catRows, error: catErr } = await supabase
    .from('categories')
    .select('id, name, display_order, restaurant_id')
    .eq('restaurant_id', restaurantId)
    .order('display_order', { ascending: true })
  if (catErr) throw catErr
  const categories = (catRows ?? []) as RawCategoryRow[]
  if (categories.length === 0) return []

  const { data: prodRows, error: prodErr } = await supabase
    .from('products')
    .select(
      'id, restaurant_id, category_id, name, description, price, image_url, is_sold_out, is_draft, is_daily_special, display_order, allergens, dietary_tags, prep_time_minutes, portion_size, vat_group',
    )
    .eq('restaurant_id', restaurantId)
    .eq('is_draft', false)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
  if (prodErr) throw prodErr
  const products = (prodRows ?? []) as RawProductRow[]
  if (products.length === 0) return categories.map((c) => ({ ...c, products: [] }))

  const productIds = products.map((p) => p.id)
  const { data: pmgRows, error: pmgErr } = await supabase
    .from('product_modifier_groups')
    .select('product_id, modifier_group_id, display_order')
    .in('product_id', productIds)
  if (pmgErr) throw pmgErr
  const pmgList = (pmgRows ?? []) as RawPmgRow[]
  const modifierGroupIds = [...new Set(pmgList.map((r) => r.modifier_group_id))]

  let modifierGroups: RawModifierGroupRow[] = []
  let modifierOptions: RawModifierOptionRow[] = []

  if (modifierGroupIds.length > 0) {
    const { data: mgRows, error: mgErr } = await supabase
      .from('modifier_groups')
      .select(
        'id, restaurant_id, name, selection_type, is_required, min_select, max_select, display_order',
      )
      .in('id', modifierGroupIds)
    if (mgErr) throw mgErr
    modifierGroups = (mgRows ?? []) as RawModifierGroupRow[]

    const { data: moRows, error: moErr } = await supabase
      .from('modifier_options')
      .select('id, modifier_group_id, name, price_delta, is_available, display_order')
      .in('modifier_group_id', modifierGroupIds)
      .eq('is_available', true)
      .order('display_order', { ascending: true })
    if (moErr) throw moErr
    modifierOptions = (moRows ?? []) as RawModifierOptionRow[]
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

  // Fetch extras + pairings for all products
  const { data: extrasRows } = await supabase
    .from('product_extras')
    .select('id, product_id, name, price, emoji, display_order, is_available')
    .in('product_id', productIds)
    .eq('is_available', true)
    .order('display_order', { ascending: true })

  const { data: pairingsRows } = await supabase
    .from('product_pairings')
    .select('id, product_id, paired_product_id, display_order')
    .in('product_id', productIds)
    .order('display_order', { ascending: true })

  // Build maps: product_id → ProductExtra[] and product_id → ProductPairing[]
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
    products: (productsByCategory.get(cat.id) ?? []).sort(
      (a, b) => a.display_order - b.display_order,
    ),
  }))
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
  if (close <= open) return now.minutes >= open // ore peste miezul nopții nu suportat — închidem la 24:00
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

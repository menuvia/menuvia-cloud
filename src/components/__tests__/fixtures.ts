// Fixture-uri comune pentru testele de componente pe fluxurile de bani.
// Construiesc obiecte complete (TS strict) cu override-uri punctuale.
import type { Product, Category, ModifierGroup, ModifierOption } from '../../lib/qr'
import type { CartItem, Order, OrderItem, RestaurantTable } from '../../lib/orders'

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

export function makeOption(overrides: Partial<ModifierOption> = {}): ModifierOption {
  const id = overrides.id ?? nextId('opt')
  return {
    id,
    modifier_group_id: 'g1',
    name: `Opțiune ${id}`,
    price_delta: 0,
    is_available: true,
    display_order: 0,
    ...overrides,
  }
}

export function makeGroup(overrides: Partial<ModifierGroup> = {}): ModifierGroup {
  const id = overrides.id ?? nextId('grp')
  return {
    id,
    restaurant_id: 'r1',
    name: `Grup ${id}`,
    selection_type: 'single',
    is_required: false,
    min_select: 0,
    max_select: null,
    display_order: 0,
    modifier_options: [],
    ...overrides,
  }
}

export function makeProduct(overrides: Partial<Product> = {}): Product {
  const id = overrides.id ?? nextId('prod')
  return {
    id,
    restaurant_id: 'r1',
    category_id: 'c1',
    name: `Produs ${id}`,
    description: null,
    price: 10,
    image_url: null,
    is_sold_out: false,
    is_draft: false,
    is_daily_special: false,
    display_order: 0,
    modifier_groups: [],
    allergens: [],
    dietary_tags: [],
    prep_time_minutes: null,
    portion_size: null,
    vat_group: 2,
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    ai_generated_fields: [],
    extras: [],
    pairings: [],
    ...overrides,
  }
}

export function makeCategory(overrides: Partial<Category> = {}): Category {
  const id = overrides.id ?? nextId('cat')
  return {
    id,
    restaurant_id: 'r1',
    name: `Categorie ${id}`,
    display_order: 0,
    meta_text: null,
    products: [],
    ...overrides,
  }
}

export function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    _key: nextId('key'),
    product_id: 'p1',
    product_name_snapshot: 'Cafea',
    unit_price_snapshot: 10,
    quantity: 1,
    selected_modifiers: [],
    notes: null,
    ...overrides,
  }
}

export function makeTable(overrides: Partial<RestaurantTable> = {}): RestaurantTable {
  const id = overrides.id ?? nextId('tbl')
  return {
    id,
    restaurant_id: 'r1',
    name: `Masa ${id}`,
    slug: id,
    seats: 4,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function makeOrderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  const id = overrides.id ?? nextId('oi')
  return {
    id,
    order_id: 'o1',
    product_id: 'p1',
    product_name_snapshot: 'Cafea',
    unit_price_snapshot: 10,
    quantity: 1,
    item_total: 10,
    selected_modifiers: [],
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    restaurant_id: 'r1',
    table_id: null,
    qr_token_id: null,
    source: 'waiter',
    status: 'new',
    created_by: null,
    served_by: null,
    paid_by: null,
    payment_method: null,
    paid_amount: null,
    total: 10,
    notes: null,
    cancel_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    confirmed_at: null,
    preparing_at: null,
    ready_at: null,
    served_at: null,
    paid_at: null,
    cancelled_at: null,
    pickup_time: null,
    customer_name: null,
    customer_phone: null,
    discount_type: null,
    discount_value: null,
    discount_amount: 0,
    discount_reason: null,
    discount_applied_by: null,
    discount_applied_at: null,
    table: null,
    order_items: [makeOrderItem()],
    ...overrides,
  }
}

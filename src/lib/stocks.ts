// ─────────────────────────────────────────────────────────────
// stocks.ts — Stocuri & Rețete (Menuvia gestiune simplu)
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'

export type IngredientUnit = 'g' | 'kg' | 'ml' | 'l' | 'buc' | 'pachet'

export interface Ingredient {
  id: string
  restaurant_id: string
  name: string
  unit: IngredientUnit
  current_stock: number
  min_stock_alert: number | null
  cost_per_unit: number
  vat_group: number // 1=9%, 2=19%, 3=5%, 4=0%
  emoji: string | null
  category: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Recipe {
  id: string
  product_id: string
  ingredient_id: string
  quantity: number
  notes: string | null
  created_at: string
}

export interface StockMovement {
  id: string
  ingredient_id: string
  change_amount: number
  reason: 'purchase' | 'sale' | 'waste' | 'inventory' | 'manual'
  reference_type: 'order' | 'purchase_order' | 'manual' | null
  reference_id: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

export interface Supplier {
  id: string
  restaurant_id: string
  name: string
  vat_id: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  payment_terms_days: number
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PurchaseOrder {
  id: string
  restaurant_id: string
  supplier_id: string | null
  invoice_number: string | null
  invoice_date: string | null
  status: 'draft' | 'received' | 'paid' | 'cancelled'
  subtotal: number
  vat_total: number
  total: number
  notes: string | null
  created_at: string
  received_at: string | null
  paid_at: string | null
}

export interface PurchaseOrderItem {
  id: string
  purchase_order_id: string
  ingredient_id: string
  quantity: number
  unit_price: number
  vat_rate: number
  line_total: number
}

export interface ProductProfitability {
  product_id: string
  restaurant_id: string
  name: string
  sell_price: number
  cost_price: number
  profit_amount: number
  margin_percent: number
}

// ── CRUD: Ingredients ──────────────────────────────────────────

export async function fetchIngredients(restaurantId: string): Promise<Ingredient[]> {
  const { data, error } = await supabase
    .from('ingredients')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as Ingredient[]
}

export async function createIngredient(
  restaurantId: string,
  fields: Partial<Ingredient>,
): Promise<Ingredient> {
  const { data, error } = await supabase
    .from('ingredients')
    .insert({
      restaurant_id: restaurantId,
      name: fields.name ?? '',
      unit: fields.unit ?? 'kg',
      current_stock: fields.current_stock ?? 0,
      min_stock_alert: fields.min_stock_alert ?? null,
      cost_per_unit: fields.cost_per_unit ?? 0,
      vat_group: fields.vat_group ?? 1,
      emoji: fields.emoji ?? null,
      category: fields.category ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Ingredient
}

export async function updateIngredient(id: string, fields: Partial<Ingredient>): Promise<void> {
  const updates: Record<string, unknown> = {}
  for (const k of [
    'name',
    'unit',
    'min_stock_alert',
    'cost_per_unit',
    'vat_group',
    'emoji',
    'category',
    'is_active',
  ] as const) {
    if (fields[k] !== undefined) updates[k] = fields[k]
  }
  updates.updated_at = new Date().toISOString()
  const { error } = await supabase.from('ingredients').update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteIngredient(id: string): Promise<void> {
  // Soft delete (set is_active=false)
  const { error } = await supabase
    .from('ingredients')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function adjustStockManual(
  ingredientId: string,
  newAmount: number,
  notes?: string,
): Promise<void> {
  const { error } = await supabase.rpc('adjust_stock_manual', {
    p_ingredient_id: ingredientId,
    p_new_amount: newAmount,
    p_notes: notes ?? null,
  })
  if (error) throw error
}

// ── CRUD: Recipes ──────────────────────────────────────────────

export async function fetchRecipesForProduct(productId: string): Promise<Recipe[]> {
  const { data, error } = await supabase.from('recipes').select('*').eq('product_id', productId)
  if (error) throw error
  return (data ?? []) as Recipe[]
}

export async function setRecipeItem(
  productId: string,
  ingredientId: string,
  quantity: number,
  notes?: string | null,
): Promise<void> {
  // Upsert: if exists, update; else insert
  const { error } = await supabase.from('recipes').upsert(
    {
      product_id: productId,
      ingredient_id: ingredientId,
      quantity,
      notes: notes ?? null,
    },
    { onConflict: 'product_id,ingredient_id' },
  )
  if (error) throw error
}

export async function removeRecipeItem(productId: string, ingredientId: string): Promise<void> {
  const { error } = await supabase
    .from('recipes')
    .delete()
    .eq('product_id', productId)
    .eq('ingredient_id', ingredientId)
  if (error) throw error
}

// ── CRUD: Stock movements (audit trail, read-only) ─────────────

export async function fetchStockMovements(
  ingredientId: string,
  limit = 50,
): Promise<StockMovement[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .eq('ingredient_id', ingredientId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as StockMovement[]
}

// ── CRUD: Suppliers ────────────────────────────────────────────

export async function fetchSuppliers(restaurantId: string): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as Supplier[]
}

export async function createSupplier(
  restaurantId: string,
  fields: Partial<Supplier>,
): Promise<Supplier> {
  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      restaurant_id: restaurantId,
      name: fields.name ?? '',
      vat_id: fields.vat_id ?? null,
      contact_name: fields.contact_name ?? null,
      phone: fields.phone ?? null,
      email: fields.email ?? null,
      address: fields.address ?? null,
      payment_terms_days: fields.payment_terms_days ?? 0,
      notes: fields.notes ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Supplier
}

export async function updateSupplier(id: string, fields: Partial<Supplier>): Promise<void> {
  const updates: Record<string, unknown> = {}
  for (const k of [
    'name',
    'vat_id',
    'contact_name',
    'phone',
    'email',
    'address',
    'payment_terms_days',
    'notes',
    'is_active',
  ] as const) {
    if (fields[k] !== undefined) updates[k] = fields[k]
  }
  updates.updated_at = new Date().toISOString()
  const { error } = await supabase.from('suppliers').update(updates).eq('id', id)
  if (error) throw error
}

// ── CRUD: Purchase Orders (NIR) ────────────────────────────────

export async function fetchPurchaseOrders(
  restaurantId: string,
  limit = 50,
): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as PurchaseOrder[]
}

export interface CreatePurchaseOrderArgs {
  restaurant_id: string
  supplier_id: string | null
  invoice_number: string | null
  invoice_date: string | null
  notes: string | null
  items: Array<{
    ingredient_id: string
    quantity: number
    unit_price: number
    vat_rate: number
  }>
}

export async function createPurchaseOrder(args: CreatePurchaseOrderArgs): Promise<string> {
  // Atomic: RPC face header + items într-o singură tranzacție SQL +
  // calculează subtotal/VAT server-side (anti-tamper). Anterior 2 cereri
  // separate puteau lăsa PO orfan fără items dacă a doua eșua.
  const { data, error } = await supabase.rpc('create_purchase_order_atomic', {
    p_restaurant_id: args.restaurant_id,
    p_supplier_id: args.supplier_id,
    p_invoice_number: args.invoice_number,
    p_invoice_date: args.invoice_date,
    p_notes: args.notes,
    p_items: args.items,
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || !('id' in data)) {
    throw new Error('Failed to create purchase order')
  }
  return (data as { id: string }).id
}

export async function receivePurchaseOrder(poId: string): Promise<void> {
  const { error } = await supabase.rpc('receive_purchase_order', { p_po_id: poId })
  if (error) throw error
}

// ── Profitability views ────────────────────────────────────────

export async function fetchProductProfitability(
  restaurantId: string,
): Promise<ProductProfitability[]> {
  const { data, error } = await supabase
    .from('product_profitability')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('margin_percent', { ascending: false })
  if (error) throw error
  return (data ?? []) as ProductProfitability[]
}

// ── Helpers ────────────────────────────────────────────────────

export function formatStock(amount: number, unit: IngredientUnit): string {
  // Auto-convert: 1500g → 1.5 kg, 1500ml → 1.5 L
  if (unit === 'g' && amount >= 1000) return `${(amount / 1000).toFixed(2)} kg`
  if (unit === 'ml' && amount >= 1000) return `${(amount / 1000).toFixed(2)} L`
  return `${amount.toFixed(amount % 1 === 0 ? 0 : 2)} ${unit}`
}

export function unitLabel(unit: IngredientUnit): string {
  const map: Record<IngredientUnit, string> = {
    g: 'grame',
    kg: 'kilograme',
    ml: 'mililitri',
    l: 'litri',
    buc: 'bucăți',
    pachet: 'pachete',
  }
  return map[unit]
}

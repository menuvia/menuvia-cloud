// ─────────────────────────────────────────────────────────────
// ManualOrderSheet — Comandă manuală pentru ospătar
// Ospătarul selectează masa + adaugă produse + trimite
// Funcționează pe telefon, tabletă sau laptop
// source: 'waiter', qr_token_id: null
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { createOrder } from '../lib/orders'
import type { CartItem } from '../lib/orders'
import { D } from '../lib/constants'

interface Table {
  id: string
  name: string
  seats: number | null
}
interface ModifierOption {
  id: string
  name: string
  price_delta: number
  is_available: boolean
}
interface ModifierGroup {
  id: string
  name: string
  selection_type: 'single' | 'multiple'
  is_required: boolean
  modifier_options: ModifierOption[]
}
interface Product {
  id: string
  name: string
  description: string | null
  price: number
  emoji: string
  is_active: boolean
  is_sold_out: boolean
  category_id: string | null
  modifier_groups: ModifierGroup[]
}
interface Category {
  id: string
  name: string
  emoji: string
  products: Product[]
}

interface Props {
  restaurantId: string
  onClose: () => void
  onOrderPlaced: (orderId: string, shortId: string) => void
}

const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: '0.875rem',
  color: D.t1,
  outline: 'none',
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}
const bPrimary: React.CSSProperties = {
  background: D.gold,
  color: '#000',
  border: 'none',
  borderRadius: 9,
  padding: '12px 0',
  fontFamily: 'DM Sans,sans-serif',
  fontSize: '0.9rem',
  fontWeight: 700,
  cursor: 'pointer',
  width: '100%',
}
const bSecondary: React.CSSProperties = {
  background: 'transparent',
  color: D.t2,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 0',
  fontFamily: 'DM Sans,sans-serif',
  fontSize: '0.875rem',
  cursor: 'pointer',
  width: '100%',
}

const genKey = () => Math.random().toString(36).slice(2, 10)

export default function ManualOrderSheet({ restaurantId, onClose, onOrderPlaced }: Props) {
  const [step, setStep] = useState<'table' | 'menu' | 'confirm'>('table')
  const [tables, setTables] = useState<Table[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedTable, setSelectedTable] = useState<Table | null>(null)
  const [activeCatId, setActiveCatId] = useState<string | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // For modifier selection per product
  const [pickingProduct, setPickingProduct] = useState<Product | null>(null)
  const [modSelections, setModSelections] = useState<Record<string, string | Set<string>>>({})
  // Key stabil per coș (reutilizat la retry) — vechiul genKey() per apel
  // făcea idempotency-ul inutil. Rotit după trimitere reușită.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID())

  // ─── Load tables + menu ─────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [tRes, catRes] = await Promise.all([
        supabase
          .from('tables')
          .select('id, name, seats')
          .eq('restaurant_id', restaurantId)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('categories')
          .select('id, name, emoji, display_order')
          .eq('restaurant_id', restaurantId)
          .order('display_order'),
      ])
      const tableList = (tRes.data ?? []) as Table[]
      setTables(tableList)

      const cats = (catRes.data ?? []) as unknown as Category[]
      if (cats.length === 0) {
        setLoading(false)
        return
      }

      // Load products + modifiers
      const { data: prods } = await supabase
        .from('products')
        .select(
          'id, name, description, price, emoji, is_active, is_sold_out, category_id, display_order',
        )
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .eq('is_draft', false)
        .order('display_order')

      const products = (prods ?? []) as unknown as Product[]
      if (products.length === 0) {
        setCategories(cats.map((c) => ({ ...c, products: [] })))
        setActiveCatId(cats[0]?.id ?? null)
        setLoading(false)
        return
      }

      // Load modifier groups
      const productIds = products.map((p) => p.id)
      const [pmgRes, mgRes, moRes] = await Promise.all([
        supabase
          .from('product_modifier_groups')
          .select('product_id, modifier_group_id, display_order')
          .in('product_id', productIds),
        supabase
          .from('modifier_groups')
          .select('id, name, selection_type, is_required, display_order')
          .eq('restaurant_id', restaurantId),
        supabase
          .from('modifier_options')
          .select('id, modifier_group_id, name, price_delta, is_available, display_order')
          .eq('restaurant_id', restaurantId)
          .eq('is_available', true),
      ])

      const pmgMap = new Map<string, string[]>()
      for (const pmg of (pmgRes.data ?? []) as Record<string, string>[]) {
        const arr = pmgMap.get(pmg.product_id) ?? []
        arr.push(pmg.modifier_group_id)
        pmgMap.set(pmg.product_id, arr)
      }

      const mgById = new Map(
        (mgRes.data ?? []).map((m: Record<string, unknown>) => [m.id as string, m]),
      )
      const optsByGroup = new Map<string, ModifierOption[]>()
      for (const opt of (moRes.data ?? []) as ModifierOption[]) {
        const arr =
          optsByGroup.get((opt as unknown as Record<string, string>).modifier_group_id) ?? []
        arr.push(opt)
        optsByGroup.set((opt as unknown as Record<string, string>).modifier_group_id, arr)
      }

      const enrichedProducts: Product[] = products.map((p) => ({
        ...p,
        modifier_groups: (pmgMap.get(p.id) ?? [])
          .map((mgId) => {
            const mg = mgById.get(mgId) as Record<string, unknown>
            if (!mg) return null
            return {
              id: mgId,
              name: mg.name as string,
              selection_type: mg.selection_type as 'single' | 'multiple',
              is_required: mg.is_required as boolean,
              modifier_options: optsByGroup.get(mgId) ?? [],
            }
          })
          .filter(Boolean) as ModifierGroup[],
      }))

      const catMap = new Map(cats.map((c) => [c.id, { ...c, products: [] as Product[] }]))
      for (const p of enrichedProducts) {
        if (p.category_id && catMap.has(p.category_id)) catMap.get(p.category_id)!.products.push(p)
      }
      const catList = Array.from(catMap.values()).filter((c) => c.products.length > 0)
      setCategories(catList)
      setActiveCatId(catList[0]?.id ?? null)
    } catch (e) {
      console.error('ManualOrderSheet load error', e)
    }
    setLoading(false)
  }, [restaurantId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // ─── Cart helpers ───────────────────────────────────────────
  function addToCart(product: Product, selections: Record<string, string | Set<string>>, qty = 1) {
    const mods = product.modifier_groups.flatMap((g) => {
      const sel = selections[g.id]
      if (!sel) return []
      if (g.selection_type === 'single' && typeof sel === 'string') {
        const opt = g.modifier_options.find((o) => o.id === sel)
        return opt
          ? [
              {
                group_id: g.id,
                group_name: g.name,
                option_id: opt.id,
                option_name: opt.name,
                price_delta: opt.price_delta,
              },
            ]
          : []
      }
      if (sel instanceof Set) {
        return g.modifier_options
          .filter((o) => sel.has(o.id))
          .map((o) => ({
            group_id: g.id,
            group_name: g.name,
            option_id: o.id,
            option_name: o.name,
            price_delta: o.price_delta,
          }))
      }
      return []
    })
    setCart((c) => [
      ...c,
      {
        _key: genKey(),
        product_id: product.id,
        product_name_snapshot: product.name,
        unit_price_snapshot: product.price,
        quantity: qty,
        selected_modifiers: mods,
        notes: null,
      },
    ])
  }

  function removeFromCart(key: string) {
    setCart((c) => c.filter((i) => i._key !== key))
  }
  function updateQty(key: string, d: number) {
    setCart((c) =>
      c.map((i) => (i._key === key ? { ...i, quantity: Math.max(1, i.quantity + d) } : i)),
    )
  }

  const cartTotal = cart.reduce(
    (s, i) =>
      s +
      (i.unit_price_snapshot + i.selected_modifiers.reduce((m, x) => m + x.price_delta, 0)) *
        i.quantity,
    0,
  )

  // ─── Submit ─────────────────────────────────────────────────
  async function handleSubmit() {
    if (cart.length === 0) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await createOrder({
        restaurant_id: restaurantId,
        source: 'waiter',
        table_id: selectedTable?.id ?? null,
        qr_token_id: null,
        notes: notes.trim() || null,
        cart,
        idempotency_key: idempotencyKeyRef.current,
      })
      idempotencyKeyRef.current = crypto.randomUUID()
      onOrderPlaced(result.id, result.short_id)
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Eroare la trimiterea comenzii')
      setSubmitting(false)
    }
  }

  const activeCat = categories.find((c) => c.id === activeCatId)

  // ─── Modifier picker ────────────────────────────────────────
  if (pickingProduct) {
    const requiredGroups = pickingProduct.modifier_groups.filter((g) => g.is_required)
    const canAdd = requiredGroups.every((g) => {
      const sel = modSelections[g.id]
      if (!sel) return false
      if (sel instanceof Set) return sel.size > 0
      return !!sel
    })
    return (
      <div
        onClick={() => {
          setPickingProduct(null)
          setModSelections({})
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          zIndex: 1100,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: D.s1,
            borderRadius: '16px 16px 0 0',
            width: '100%',
            maxWidth: 520,
            maxHeight: '80vh',
            overflowY: 'auto',
            padding: '20px 20px 32px',
          }}
        >
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.1rem',
              color: D.t1,
              marginBottom: 4,
            }}
          >
            {pickingProduct.emoji} {pickingProduct.name}
          </div>
          <div
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1rem',
              color: D.gold,
              marginBottom: 16,
            }}
          >
            {pickingProduct.price.toFixed(2)} lei
          </div>
          {pickingProduct.modifier_groups.map((g) => (
            <div key={g.id} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: D.t2, marginBottom: 7 }}>
                {g.name}{' '}
                {g.is_required && (
                  <span style={{ color: D.red, fontSize: '0.68rem' }}>*obligatoriu</span>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {g.modifier_options.map((opt) => {
                  const sel = modSelections[g.id]
                  const isActive =
                    g.selection_type === 'single'
                      ? sel === opt.id
                      : sel instanceof Set && sel.has(opt.id)
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setModSelections((prev) => {
                          if (g.selection_type === 'single') return { ...prev, [g.id]: opt.id }
                          const s = new Set<string>(
                            prev[g.id] instanceof Set ? (prev[g.id] as Set<string>) : [],
                          )
                          s.has(opt.id) ? s.delete(opt.id) : s.add(opt.id)
                          return { ...prev, [g.id]: s }
                        })
                      }}
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.82rem',
                        fontFamily: 'DM Sans,sans-serif',
                        cursor: 'pointer',
                        outline: 'none',
                        borderRadius: 8,
                        background: isActive ? D.goldA : D.s3,
                        color: isActive ? D.gold : D.t2,
                        border: `1px solid ${isActive ? D.gold + '55' : D.border}`,
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {opt.name}
                      {opt.price_delta > 0 && ` +${opt.price_delta.toFixed(2)}`}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              onClick={() => {
                setPickingProduct(null)
                setModSelections({})
              }}
              style={{ ...bSecondary, width: 'auto', padding: '10px 20px' }}
            >
              Anulează
            </button>
            <button
              onClick={() => {
                addToCart(pickingProduct, modSelections)
                setPickingProduct(null)
                setModSelections({})
              }}
              disabled={!canAdd}
              style={{ ...bPrimary, opacity: canAdd ? 1 : 0.5 }}
            >
              Adaugă în comandă
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.s1,
          width: '100%',
          maxWidth: 540,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Sheet header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${D.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div>
            <span style={{ fontFamily: 'Fraunces,serif', fontSize: '1.05rem', color: D.t1 }}>
              Comandă manuală
            </span>
            {selectedTable && (
              <span style={{ fontSize: '0.78rem', color: D.gold, marginLeft: 8 }}>
                • {selectedTable.name}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t3,
              cursor: 'pointer',
              fontSize: 18,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Step tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${D.border}`, flexShrink: 0 }}>
          {(['table', 'menu', 'confirm'] as const).map((s, i) => (
            <button
              key={s}
              onClick={() => {
                if (s === 'menu' && !activeCatId && categories.length === 0) return
                if (s === 'confirm' && cart.length === 0) return
                setStep(s)
              }}
              style={{
                flex: 1,
                padding: '10px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${step === s ? D.gold : 'transparent'}`,
                color: step === s ? D.gold : D.t3,
                fontSize: '0.8rem',
                fontFamily: 'DM Sans,sans-serif',
                fontWeight: step === s ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {i + 1}. {s === 'table' ? 'Masă' : s === 'menu' ? 'Produse' : 'Finalizare'}
            </button>
          ))}
        </div>

        {loading ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: D.t3,
            }}
          >
            Se încarcă meniul...
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* ── STEP 1: Table select ── */}
            {step === 'table' && (
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: '0.82rem', color: D.t2, marginBottom: 14 }}>
                  Selectează masa sau lasă liber pentru comandă fără masă.
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(100px,1fr))',
                    gap: 8,
                    marginBottom: 20,
                  }}
                >
                  <button
                    onClick={() => setSelectedTable(null)}
                    style={{
                      padding: '14px 8px',
                      borderRadius: 10,
                      background: !selectedTable ? D.goldA : D.s2,
                      border: `1px solid ${!selectedTable ? D.gold + '55' : D.border}`,
                      color: !selectedTable ? D.gold : D.t2,
                      fontFamily: 'DM Sans,sans-serif',
                      fontSize: '0.82rem',
                      fontWeight: !selectedTable ? 600 : 400,
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    📋 Fără masă
                  </button>
                  {tables.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTable(t)}
                      style={{
                        padding: '14px 8px',
                        borderRadius: 10,
                        background: selectedTable?.id === t.id ? D.goldA : D.s2,
                        border: `1px solid ${selectedTable?.id === t.id ? D.gold + '55' : D.border}`,
                        color: selectedTable?.id === t.id ? D.gold : D.t1,
                        fontFamily: 'DM Sans,sans-serif',
                        fontSize: '0.82rem',
                        fontWeight: selectedTable?.id === t.id ? 600 : 400,
                        cursor: 'pointer',
                        outline: 'none',
                        textAlign: 'center',
                      }}
                    >
                      🪑 {t.name}
                      {t.seats && (
                        <div style={{ fontSize: '0.68rem', color: D.t3, marginTop: 2 }}>
                          {t.seats} loc.
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <button onClick={() => setStep('menu')} style={bPrimary}>
                  Continuă la meniu →
                </button>
              </div>
            )}

            {/* ── STEP 2: Menu browse ── */}
            {step === 'menu' && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* Category tabs */}
                <div
                  style={{
                    display: 'flex',
                    overflowX: 'auto',
                    borderBottom: `1px solid ${D.border}`,
                    flexShrink: 0,
                    padding: '0 4px',
                  }}
                >
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCatId(cat.id)}
                      style={{
                        padding: '10px 14px',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: `2px solid ${activeCatId === cat.id ? D.gold : 'transparent'}`,
                        color: activeCatId === cat.id ? D.gold : D.t2,
                        fontFamily: 'DM Sans,sans-serif',
                        fontSize: '0.82rem',
                        fontWeight: activeCatId === cat.id ? 600 : 400,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cat.emoji} {cat.name}
                    </button>
                  ))}
                </div>
                {/* Products */}
                <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                  {(activeCat?.products ?? [])
                    .filter((p) => !p.is_sold_out)
                    .map((prod) => (
                      <button
                        key={prod.id}
                        onClick={() => {
                          if (prod.modifier_groups.length > 0) {
                            setPickingProduct(prod)
                            setModSelections({})
                          } else addToCart(prod, {})
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          width: '100%',
                          padding: '10px 12px',
                          background: 'transparent',
                          border: `1px solid ${D.border}`,
                          borderRadius: 10,
                          marginBottom: 6,
                          cursor: 'pointer',
                          textAlign: 'left',
                          outline: 'none',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = D.s2)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>{prod.emoji}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '0.875rem',
                              color: D.t1,
                              fontWeight: 500,
                              fontFamily: 'DM Sans,sans-serif',
                            }}
                          >
                            {prod.name}
                          </div>
                          {prod.description && (
                            <div
                              style={{
                                fontSize: '0.72rem',
                                color: D.t3,
                                marginTop: 2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {prod.description}
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: '0.9rem',
                            color: D.gold,
                            fontWeight: 600,
                            fontFamily: 'Fraunces,serif',
                            flexShrink: 0,
                          }}
                        >
                          {prod.price.toFixed(2)} lei
                        </div>
                        <span style={{ fontSize: '1rem', color: D.t3 }}>+</span>
                      </button>
                    ))}
                </div>
                {/* Cart bar */}
                {cart.length > 0 && (
                  <div
                    style={{
                      padding: '12px 16px',
                      borderTop: `1px solid ${D.border}`,
                      background: D.s2,
                      flexShrink: 0,
                    }}
                  >
                    <button onClick={() => setStep('confirm')} style={bPrimary}>
                      Finalizează comanda — {cartTotal.toFixed(2)} lei (
                      {cart.reduce((s, i) => s + i.quantity, 0)} produse)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 3: Confirm ── */}
            {step === 'confirm' && (
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: '0.78rem', color: D.t3, marginBottom: 14 }}>
                  {selectedTable ? `Masă: ${selectedTable.name}` : 'Fără masă specifică'}
                </div>
                {cart.map((item) => (
                  <div
                    key={item._key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 0',
                      borderBottom: `1px solid ${D.border}`,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 500 }}>
                        {item.product_name_snapshot}
                      </div>
                      {item.selected_modifiers.length > 0 && (
                        <div style={{ fontSize: '0.72rem', color: D.t3 }}>
                          {item.selected_modifiers.map((m) => m.option_name).join(', ')}
                        </div>
                      )}
                      <div style={{ fontSize: '0.78rem', color: D.gold, marginTop: 2 }}>
                        {(
                          (item.unit_price_snapshot +
                            item.selected_modifiers.reduce((s, m) => s + m.price_delta, 0)) *
                          item.quantity
                        ).toFixed(2)}{' '}
                        lei
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={() => updateQty(item._key, -1)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: D.s3,
                          border: `1px solid ${D.border}`,
                          color: D.t1,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1rem',
                        }}
                      >
                        −
                      </button>
                      <span
                        style={{
                          color: D.t1,
                          minWidth: 20,
                          textAlign: 'center',
                          fontFamily: 'DM Sans,sans-serif',
                        }}
                      >
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQty(item._key, 1)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: D.s3,
                          border: `1px solid ${D.border}`,
                          color: D.t1,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1rem',
                        }}
                      >
                        +
                      </button>
                      <button
                        onClick={() => removeFromCart(item._key)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: D.redA,
                          border: 'none',
                          color: D.red,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.85rem',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '14px 0',
                    borderBottom: `1px solid ${D.border}`,
                    marginBottom: 14,
                  }}
                >
                  <span style={{ fontFamily: 'Fraunces,serif', fontSize: '1rem', color: D.t1 }}>
                    Total
                  </span>
                  <span
                    style={{
                      fontFamily: 'Fraunces,serif',
                      fontSize: '1.1rem',
                      color: D.gold,
                      fontWeight: 700,
                    }}
                  >
                    {cartTotal.toFixed(2)} lei
                  </span>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label
                    style={{ display: 'block', fontSize: '0.75rem', color: D.t3, marginBottom: 5 }}
                  >
                    Mențiuni (opțional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Ex: fără ceapă, alergie la nuci..."
                    style={{ ...inp, height: 'auto', resize: 'none' }}
                  />
                </div>
                {submitError && (
                  <div
                    style={{
                      background: D.redA,
                      border: `1px solid rgba(224,85,85,.3)`,
                      borderRadius: 8,
                      padding: '10px 14px',
                      fontSize: '0.82rem',
                      color: D.red,
                      marginBottom: 10,
                    }}
                  >
                    {submitError}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    onClick={() => void handleSubmit()}
                    disabled={submitting || cart.length === 0}
                    style={{ ...bPrimary, opacity: submitting ? 0.7 : 1 }}
                  >
                    {submitting ? 'Se trimite...' : `Trimite comanda — ${cartTotal.toFixed(2)} lei`}
                  </button>
                  <button onClick={() => setStep('menu')} style={bSecondary}>
                    ← Înapoi la meniu
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

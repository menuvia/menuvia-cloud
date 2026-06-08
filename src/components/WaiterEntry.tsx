// =============================================================
// Menuvia — src/components/WaiterEntry.tsx
// Waiter manual order entry. Dark theme. No `any`.
// Flow: table selector → product browser → cart → submit
// =============================================================

import { useState, useEffect } from 'react'
import { fetchTables, createOrder } from '../lib/orders'
import { fetchMenuForRestaurant } from '../lib/qr'
import type { RestaurantTable, CartItem } from '../lib/orders'
import type { Category, Product } from '../lib/qr'
import { D } from '../lib/constants'
import ModifierSheet from './ModifierSheet'

// D imported from constants

interface Props {
  restaurantId: string
  onClose: () => void
  onOrderCreated: () => void
}

// ── WaiterEntry ───────────────────────────────────────────────

type Step = 'table' | 'menu'

export default function WaiterEntry({ restaurantId, onClose, onOrderCreated }: Props) {
  const [step, setStep] = useState<Step>('table')
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [activeCatId, setActiveCatId] = useState<string | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  const [showCart, setShowCart] = useState(false)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    fetchTables(restaurantId)
      .then(setTables)
      .catch(() => setLoadError('Nu s-au putut încărca mesele. Verifică conexiunea.'))
  }, [restaurantId])

  function goToMenu(table: RestaurantTable | null): void {
    setSelectedTable(table)
    setLoadError(null)
    fetchMenuForRestaurant(restaurantId)
      .then((cats) => {
        setCategories(cats)
        setActiveCatId(cats[0]?.id ?? null)
        setStep('menu')
      })
      .catch(() => setLoadError('Nu s-a putut încărca meniul. Verifică conexiunea.'))
  }

  function addToCart(item: CartItem): void {
    setCart((prev) => [...prev, item])
  }

  function updateQty(key: string, delta: number): void {
    setCart((prev) =>
      prev.map((i) => (i._key === key ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)),
    )
  }

  function removeFromCart(key: string): void {
    setCart((prev) => prev.filter((i) => i._key !== key))
  }

  function lineTotal(item: CartItem): number {
    const modD = item.selected_modifiers.reduce((s, m) => s + m.price_delta, 0)
    return (item.unit_price_snapshot + modD) * item.quantity
  }

  const cartTotal = cart.reduce((s, i) => s + lineTotal(i), 0)

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    setSubmitError(null)

    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await createOrder({
          restaurant_id: restaurantId,
          source: 'waiter',
          table_id: selectedTable?.id ?? null,
          qr_token_id: null,
          notes: notes.length > 0 ? notes : null,
          cart,
        })
        onOrderCreated()
        return
      } catch (e: unknown) {
        lastError = e
        const msg = e instanceof Error ? e.message : ''
        const isNetworkError =
          msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch')
        if (!isNetworkError || attempt === 2) break
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1000))
      }
    }

    const msg = lastError instanceof Error ? lastError.message : 'Eroare la trimiterea comenzii'
    const isOffline =
      msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch')
    setSubmitError(isOffline ? 'Conexiune slabă. Verifică internetul și încearcă din nou.' : msg)
    setSubmitting(false)
  }

  const activeProducts = categories.find((c) => c.id === activeCatId)?.products ?? []

  // ── Step: table selector ─────────────────────────────────────
  if (step === 'table') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: D.bg,
          zIndex: 400,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            background: D.s1,
            borderBottom: `1px solid ${D.s3}`,
            padding: '0 20px',
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 18,
              fontWeight: 700,
              color: D.t1,
            }}
          >
            Selectează masa
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: D.t2,
              fontSize: 22,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {loadError && (
            <div
              style={{
                width: '100%',
                background: 'rgba(224,85,85,0.1)',
                border: '1px solid rgba(224,85,85,0.25)',
                borderRadius: 10,
                padding: '12px 14px',
                textAlign: 'center',
                marginBottom: 4,
              }}
            >
              <div style={{ color: D.red, fontSize: 13, marginBottom: 8 }}>{loadError}</div>
              <button
                onClick={() => {
                  setLoadError(null)
                  fetchTables(restaurantId)
                    .then(setTables)
                    .catch(() => setLoadError('Încă nu merge. Verifică internetul.'))
                }}
                style={{
                  background: 'rgba(224,85,85,0.15)',
                  border: '1px solid rgba(224,85,85,0.3)',
                  borderRadius: 8,
                  color: D.red,
                  padding: '6px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Reîncearcă
              </button>
            </div>
          )}
          <button
            onClick={() => goToMenu(null)}
            style={{
              background: D.s2,
              border: `1px solid ${D.s3}`,
              borderRadius: 10,
              color: D.t2,
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              padding: '14px 20px',
              cursor: 'pointer',
            }}
          >
            Fără masă
          </button>
          {tables.map((t) => (
            <button
              key={t.id}
              onClick={() => goToMenu(t)}
              style={{
                background: D.s2,
                border: `1px solid ${D.s3}`,
                borderRadius: 10,
                color: D.t1,
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 15,
                fontWeight: 600,
                padding: '14px 20px',
                cursor: 'pointer',
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Step: menu browser ───────────────────────────────────────
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: D.bg,
        zIndex: 400,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          background: D.s1,
          borderBottom: `1px solid ${D.s3}`,
          padding: '0 20px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 16,
            fontWeight: 700,
            color: D.t1,
          }}
        >
          {selectedTable != null ? selectedTable.name : 'Fără masă'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {cart.length > 0 && (
            <button
              onClick={() => setShowCart(true)}
              style={{
                background: D.gold,
                color: D.bg,
                border: 'none',
                borderRadius: 8,
                padding: '6px 14px',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Coș ({cart.length})
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: D.t2,
              fontSize: 22,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Category tabs */}
      <div
        style={{
          display: 'flex',
          overflowX: 'auto',
          borderBottom: `1px solid ${D.s3}`,
          background: D.s1,
          flexShrink: 0,
        }}
      >
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCatId(cat.id)}
            style={{
              background: activeCatId === cat.id ? D.goldA : 'transparent',
              borderBottom:
                activeCatId === cat.id ? `2px solid ${D.gold}` : '2px solid transparent',
              border: 'none',
              padding: '12px 16px',
              color: activeCatId === cat.id ? D.gold : D.t2,
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Products */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {activeProducts.map((product) => (
          <button
            key={product.id}
            disabled={product.is_sold_out}
            onClick={() => {
              if (!product.is_sold_out) setActiveProduct(product)
            }}
            style={{
              background: D.s2,
              border: `1px solid ${D.s3}`,
              borderRadius: 10,
              padding: '14px 16px',
              cursor: product.is_sold_out ? 'not-allowed' : 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              opacity: product.is_sold_out ? 0.5 : 1,
              textAlign: 'left',
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 15,
                  fontWeight: 600,
                  color: D.t1,
                }}
              >
                {product.name}
                {product.is_sold_out && (
                  <span style={{ color: D.red, fontSize: 12, marginLeft: 8 }}>Epuizat</span>
                )}
              </div>
              {product.description != null && product.description.length > 0 && (
                <div style={{ fontSize: 12, color: D.t2, marginTop: 2 }}>{product.description}</div>
              )}
            </div>
            <div
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 16,
                fontWeight: 700,
                color: D.gold,
                whiteSpace: 'nowrap',
                marginLeft: 12,
              }}
            >
              {product.price.toFixed(2)} lei
            </div>
          </button>
        ))}
      </div>

      {/* Modifier sheet */}
      {activeProduct != null && (
        <ModifierSheet
          product={activeProduct}
          onAdd={addToCart}
          onClose={() => setActiveProduct(null)}
        />
      )}

      {/* Cart sheet */}
      {showCart && (
        <div
          onClick={() => setShowCart(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            zIndex: 500,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: D.s1,
              width: 360,
              maxWidth: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              padding: 20,
              gap: 16,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 20,
                fontWeight: 700,
                color: D.t1,
              }}
            >
              Coș
            </div>

            {cart.map((item) => (
              <div
                key={item._key}
                style={{
                  background: D.s2,
                  borderRadius: 10,
                  padding: '12px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ color: D.t1, fontSize: 14, fontWeight: 600 }}>
                    {item.product_name_snapshot}
                  </div>
                  <div style={{ color: D.gold, fontSize: 13 }}>
                    {lineTotal(item).toFixed(2)} lei
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => updateQty(item._key, -1)}
                    style={{
                      background: D.s3,
                      border: 'none',
                      color: D.t1,
                      borderRadius: '50%',
                      width: 28,
                      height: 28,
                      cursor: 'pointer',
                    }}
                  >
                    −
                  </button>
                  <span style={{ color: D.t1, minWidth: 16, textAlign: 'center' }}>
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => updateQty(item._key, 1)}
                    style={{
                      background: D.s3,
                      border: 'none',
                      color: D.t1,
                      borderRadius: '50%',
                      width: 28,
                      height: 28,
                      cursor: 'pointer',
                    }}
                  >
                    +
                  </button>
                  <button
                    onClick={() => removeFromCart(item._key)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: D.red,
                      fontSize: 16,
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            <div
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 22,
                fontWeight: 700,
                color: D.t1,
              }}
            >
              Total: {cartTotal.toFixed(2)} lei
            </div>

            <textarea
              placeholder="Mențiuni comandă (opțional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{
                background: D.s2,
                border: `1px solid ${D.s3}`,
                borderRadius: 8,
                color: D.t1,
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 14,
                padding: '10px 12px',
                resize: 'none',
              }}
            />

            {submitError != null && <div style={{ color: D.red, fontSize: 13 }}>{submitError}</div>}

            <button
              disabled={cart.length === 0 || submitting}
              onClick={() => {
                void handleSubmit()
              }}
              style={{
                background: cart.length > 0 && !submitting ? D.gold : D.s3,
                color: cart.length > 0 && !submitting ? D.bg : D.t3,
                border: 'none',
                borderRadius: 8,
                padding: '14px 0',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 15,
                fontWeight: 700,
                cursor: cart.length > 0 && !submitting ? 'pointer' : 'not-allowed',
              }}
            >
              {submitting ? 'Se trimite...' : 'Trimite comanda'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

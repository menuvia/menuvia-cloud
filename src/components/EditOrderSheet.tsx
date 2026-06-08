// =============================================================
// Menuvia — src/components/EditOrderSheet.tsx
// Sheet pentru editarea item-urilor unei comenzi non-terminale.
// Afișează lista curentă, permite ±cantitate, ștergere, adăugare
// produs cu modificatori. Submit → update_order_items RPC.
// =============================================================

import { useState, useEffect } from 'react'
import { updateOrderItems, type Order, type CartItem } from '../lib/orders'
import { fetchMenuForRestaurant, type Category, type Product } from '../lib/qr'
import { D } from '../lib/constants'
import ModifierSheet from './ModifierSheet'

interface Props {
  order: Order
  onClose: () => void
  onSaved: () => void
}

function orderItemsToCart(order: Order): CartItem[] {
  return order.order_items.map((it) => ({
    _key: it.id,
    product_id: it.product_id ?? '',
    product_name_snapshot: it.product_name_snapshot,
    unit_price_snapshot: it.unit_price_snapshot,
    quantity: it.quantity,
    selected_modifiers: it.selected_modifiers ?? [],
    notes: it.notes,
  }))
}

function lineTotal(item: CartItem): number {
  const modD = item.selected_modifiers.reduce((s, m) => s + m.price_delta, 0)
  return (item.unit_price_snapshot + modD) * item.quantity
}

export default function EditOrderSheet({ order, onClose, onSaved }: Props) {
  const [cart, setCart] = useState<CartItem[]>(() => orderItemsToCart(order))
  const [categories, setCategories] = useState<Category[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [activeCatId, setActiveCatId] = useState<string | null>(null)
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    fetchMenuForRestaurant(order.restaurant_id)
      .then((cats) => {
        setCategories(cats)
        setActiveCatId(cats[0]?.id ?? null)
      })
      .catch(() => setLoadError('Nu s-a putut încărca meniul'))
  }, [order.restaurant_id])

  function updateQty(key: string, delta: number): void {
    setCart((prev) =>
      prev.map((i) => (i._key === key ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)),
    )
  }

  function removeItem(key: string): void {
    setCart((prev) => prev.filter((i) => i._key !== key))
  }

  function addItem(item: CartItem): void {
    setCart((prev) => [...prev, item])
  }

  const cartTotal = cart.reduce((s, i) => s + lineTotal(i), 0)
  const activeProducts = categories.find((c) => c.id === activeCatId)?.products ?? []

  async function handleSave(): Promise<void> {
    if (cart.length === 0) {
      setSubmitError('Comanda trebuie să aibă cel puțin 1 produs. Pentru anulare folosește butonul „Anulează" din card.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await updateOrderItems(
        order.id,
        cart.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          option_ids: i.selected_modifiers.map((m) => m.option_id),
          notes: i.notes,
        })),
      )
      onSaved()
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Eroare la salvare')
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 250,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.bg,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 560,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px 12px',
            borderBottom: `1px solid ${D.s3}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 18,
                fontWeight: 700,
                color: D.t1,
              }}
            >
              Editează comanda
            </div>
            <div style={{ fontSize: 12, color: D.t3, marginTop: 2 }}>
              {order.table?.name ? `Masa ${order.table.name}` : 'Fără masă'} ·{' '}
              #{order.id.slice(-6).toUpperCase()}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t2,
              cursor: 'pointer',
              fontSize: 20,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Cart list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {cart.length === 0 ? (
            <div style={{ color: D.t3, fontSize: 14, textAlign: 'center', padding: 40 }}>
              Niciun produs în comandă. Adaugă cel puțin unul sau anulează comanda.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cart.map((item) => (
                <div
                  key={item._key}
                  style={{
                    background: D.s2,
                    border: `1px solid ${D.s3}`,
                    borderRadius: 10,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: D.t1, fontWeight: 600, fontSize: 14 }}>
                        {item.product_name_snapshot}
                      </div>
                      {item.selected_modifiers.length > 0 && (
                        <div style={{ fontSize: 11, color: D.t3, marginTop: 3 }}>
                          {item.selected_modifiers.map((m) => m.option_name).join(' · ')}
                        </div>
                      )}
                      {item.notes && (
                        <div
                          style={{
                            fontSize: 11,
                            color: D.amber,
                            marginTop: 3,
                            fontStyle: 'italic',
                          }}
                        >
                          „{item.notes}"
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: D.gold, fontWeight: 600, fontSize: 14 }}>
                        {lineTotal(item).toFixed(2)} lei
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => updateQty(item._key, -1)}
                        disabled={item.quantity <= 1}
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: D.s3,
                          border: 'none',
                          color: D.t1,
                          cursor: item.quantity <= 1 ? 'not-allowed' : 'pointer',
                          opacity: item.quantity <= 1 ? 0.4 : 1,
                          fontSize: 16,
                        }}
                      >
                        −
                      </button>
                      <span
                        style={{
                          color: D.t1,
                          fontWeight: 600,
                          minWidth: 24,
                          textAlign: 'center',
                          fontSize: 14,
                        }}
                      >
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQty(item._key, 1)}
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: D.s3,
                          border: 'none',
                          color: D.t1,
                          cursor: 'pointer',
                          fontSize: 16,
                        }}
                      >
                        +
                      </button>
                    </div>
                    <button
                      onClick={() => removeItem(item._key)}
                      title="Șterge"
                      style={{
                        background: 'transparent',
                        border: `1px solid ${D.red}55`,
                        borderRadius: 6,
                        color: D.red,
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Șterge
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {loadError && (
            <div style={{ color: D.red, fontSize: 12, marginTop: 12, textAlign: 'center' }}>
              {loadError}
            </div>
          )}

          <button
            onClick={() => setShowPicker(true)}
            disabled={categories.length === 0}
            style={{
              marginTop: 16,
              width: '100%',
              padding: '12px 0',
              background: 'transparent',
              border: `1px dashed ${D.gold}88`,
              borderRadius: 10,
              color: D.gold,
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              fontWeight: 600,
              cursor: categories.length === 0 ? 'not-allowed' : 'pointer',
              opacity: categories.length === 0 ? 0.5 : 1,
            }}
          >
            + Adaugă produs
          </button>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 20px 20px',
            borderTop: `1px solid ${D.s3}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ color: D.t2, fontSize: 13 }}>Subtotal nou</span>
            <span
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 22,
                fontWeight: 700,
                color: D.gold,
              }}
            >
              {cartTotal.toFixed(2)} lei
            </span>
          </div>
          {order.discount_amount != null && order.discount_amount > 0 && (
            <div style={{ fontSize: 11, color: D.t3, textAlign: 'right' }}>
              (reducerea de {Number(order.discount_amount).toFixed(2)} lei va fi recalculată)
            </div>
          )}
          {submitError && (
            <div
              style={{
                fontSize: 12,
                color: D.red,
                background: `${D.red}11`,
                padding: '8px 10px',
                borderRadius: 6,
              }}
            >
              {submitError}
            </div>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={submitting}
            style={{
              padding: '14px 0',
              background: D.gold,
              border: 'none',
              borderRadius: 10,
              color: D.bg,
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 15,
              fontWeight: 700,
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Se salvează…' : 'Salvează modificările'}
          </button>
        </div>
      </div>

      {/* Product picker overlay */}
      {showPicker && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            setShowPicker(false)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 280,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: D.bg,
              borderRadius: '16px 16px 0 0',
              width: '100%',
              maxWidth: 560,
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '14px 20px',
                borderBottom: `1px solid ${D.s3}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
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
                Alege produs
              </span>
              <button
                onClick={() => setShowPicker(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: D.t2,
                  cursor: 'pointer',
                  fontSize: 20,
                }}
              >
                ×
              </button>
            </div>
            {/* Category tabs */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                overflowX: 'auto',
                padding: '10px 16px',
                borderBottom: `1px solid ${D.s3}`,
              }}
            >
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCatId(c.id)}
                  style={{
                    background: c.id === activeCatId ? D.goldA : D.s3,
                    color: c.id === activeCatId ? D.gold : D.t2,
                    border: 'none',
                    borderRadius: 16,
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
            {/* Products grid */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 16,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 10,
              }}
            >
              {activeProducts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActiveProduct(p)}
                  style={{
                    background: D.s2,
                    border: `1px solid ${D.s3}`,
                    borderRadius: 10,
                    padding: 10,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ color: D.t1, fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                  <span style={{ color: D.gold, fontSize: 13 }}>{p.price.toFixed(2)} lei</span>
                </button>
              ))}
              {activeProducts.length === 0 && (
                <div style={{ color: D.t3, gridColumn: '1 / -1', textAlign: 'center', padding: 20 }}>
                  Nicio categorie cu produse
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeProduct && (
        <ModifierSheet
          product={activeProduct}
          onAdd={(item) => {
            addItem(item)
            setShowPicker(false)
          }}
          onClose={() => setActiveProduct(null)}
        />
      )}
    </div>
  )
}

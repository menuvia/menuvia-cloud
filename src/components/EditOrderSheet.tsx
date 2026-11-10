// =============================================================
// Menuvia — src/components/EditOrderSheet.tsx
// Sheet pentru editarea item-urilor unei comenzi non-terminale.
// Afișează lista curentă, permite ±cantitate, ștergere, adăugare
// produs cu modificatori. Submit → update_order_items RPC.
// =============================================================

import { useState, useEffect, useRef } from 'react'
import {
  updateOrderItems,
  fetchOrderById,
  describeEditOrderError,
  MAX_LINE_QTY,
  type Order,
  type CartItem,
} from '../lib/orders'
import { fetchMenuForRestaurant, type Category, type Product } from '../lib/qr'
import { createLatestGate } from '../lib/menuRefresh'
import { D } from '../lib/constants'
import ModifierSheet from './ModifierSheet'
import { OrderLineDetails } from './OrderLineDetails'
import { useT } from '../i18n/useT'
import { ordersNs } from '../i18n/ns/orders'
import { commonNs } from '../i18n/ns/common'

interface Props {
  order: Order
  onClose: () => void
  onSaved: () => void
}

// Extindem CartItem local cu flag pentru produse orfane (șterse din meniu).
// Acestea nu pot fi re-salvate via update_order_items (RPC validează că
// produsul există + e activ), deci le marcăm read-only și blocăm save-ul
// până când utilizatorul le elimină explicit.
interface EditCartItem extends CartItem {
  _orphan?: boolean
  // Prețul per unitate REAL (item_total/qty din server) — include extras,
  // pe care order_items nu le expune în selected_* (M1, mig 146). Fără el,
  // subtotalul afișat subevalua liniile cu extras (serverul salva corect).
  _unitWithAddons?: number
  // Extra-urile liniei venite din DB (lotul O2a). La salvare pleacă drept
  // `extra_ids`-urile EI (lotul O3b), nu sunt ghicite de server după produs.
  _extras?: Order['order_items'][number]['extras_added']
  // Lotul O3b (mig 320): linia din comandă și cantitatea ei la deschidere.
  // Serverul păstrează prețul liniei neschimbate; unitățile adăugate peste
  // `_srcQty` se taxează la prețul de azi.
  _sourceId?: string
  _srcQty?: number
}

function extraIdsOf(extras: EditCartItem['_extras']): string[] {
  return (extras ?? [])
    .map((e) => e.extra_id ?? null)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

function orderItemsToCart(order: Order): EditCartItem[] {
  return order.order_items.map((it) => ({
    _key: it.id,
    product_id: it.product_id ?? '',
    product_name_snapshot: it.product_name_snapshot,
    unit_price_snapshot: it.unit_price_snapshot,
    quantity: it.quantity,
    selected_modifiers: it.selected_modifiers ?? [],
    notes: it.notes,
    _orphan: it.product_id == null,
    _unitWithAddons: it.quantity > 0 ? it.item_total / it.quantity : it.unit_price_snapshot,
    _extras: it.extras_added ?? [],
    _sourceId: it.id,
    _srcQty: it.quantity,
  }))
}

// Prețul de AZI al unei unități (produs + opțiuni + extra-uri din meniul
// încărcat), pentru unitățile adăugate peste cantitatea veche — așa le
// taxează serverul (mig 320). Fără meniu: prețul liniei.
function todayUnit(item: EditCartItem, products: ReadonlyMap<string, Product>): number | null {
  const p = products.get(item.product_id)
  if (!p) return null
  const opts = item.selected_modifiers.reduce((s, m) => {
    const o = p.modifier_groups.flatMap((g) => g.modifier_options).find((x) => x.id === m.option_id)
    return s + (o ? o.price_delta : m.price_delta)
  }, 0)
  const ids = item._sourceId ? extraIdsOf(item._extras) : (item.selected_extras ?? []).map((e) => e.id)
  const extras = ids.reduce((s, id) => s + (p.extras.find((e) => e.id === id)?.price ?? 0), 0)
  return p.price + opts + extras
}

function lineTotal(item: EditCartItem, products: ReadonlyMap<string, Product>): number {
  // Liniile venite din DB au per-unit-ul real (cu extras) pentru cantitatea
  // lor de la deschidere; unitățile ADĂUGATE se taxează la prețul de azi.
  if (item._unitWithAddons != null) {
    const kept = Math.min(item.quantity, item._srcQty ?? item.quantity)
    const added = item.quantity - kept
    return item._unitWithAddons * kept + (todayUnit(item, products) ?? item._unitWithAddons) * added
  }
  const modD = item.selected_modifiers.reduce((s, m) => s + m.price_delta, 0)
  const exD = (item.selected_extras ?? []).reduce((s, e) => s + e.price, 0)
  return (item.unit_price_snapshot + modD + exD) * item.quantity
}

export default function EditOrderSheet({ order, onClose, onSaved }: Props) {
  const tr = useT(ordersNs)
  const { t } = tr
  const tc = useT(commonNs)
  const [cart, setCart] = useState<EditCartItem[]>(() => orderItemsToCart(order))
  const hasOrphan = cart.some((i) => i._orphan)
  const [categories, setCategories] = useState<Category[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [activeCatId, setActiveCatId] = useState<string | null>(null)
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  // Cât selectorul reîncarcă catalogul, produsele nu se pot alege: altfel
  // ospătarul putea deschide un produs pe care răspunsul tocmai îl marca
  // epuizat, iar serverul respingea apoi TOATĂ salvarea (product_sold_out).
  const [catalogRefreshing, setCatalogRefreshing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // 'dirty' = utilizatorul a atins deja coșul. Refetch-ul de la deschidere
  // NU suprascrie modificările in-progress (evită să-i ștergem munca).
  // useRef (nu useState): efectul de refetch de mai jos rulează o singură
  // dată (deps = [order.id]) și citea anterior un `dirty` din closure stale
  // — actualizat SINCRON aici, în updateQty/removeItem/addItem, reflectă
  // mereu starea curentă a coșului în interiorul efectului.
  const dirtyRef = useRef(false)
  // Totalul comenzii pe care s-a bazat coșul (baseline pentru optimistic
  // lock). Trimis la save; dacă DB-ul are alt total, alt user a editat între
  // timp → RPC respinge cu mesaj de redeschidere.
  const [baselineTotal, setBaselineTotal] = useState<number>(order.total)

  // Doar cel mai nou fetch al meniului scrie starea (încărcarea inițială și
  // reîmprospătarea de la deschiderea selectorului pot fi suprapuse).
  const menuGateRef = useRef(createLatestGate())

  useEffect(() => {
    const isLatest = menuGateRef.current.begin()
    fetchMenuForRestaurant(order.restaurant_id)
      .then((cats) => {
        if (!isLatest()) return
        setCategories(cats)
        setActiveCatId(cats[0]?.id ?? null)
      })
      .catch(() => {
        if (isLatest()) setLoadError(t('edit_errMenuLoad'))
      })
    // `t` e stabil cât limba nu se schimbă (traducătorul e memoizat pe limbă).
  }, [order.restaurant_id, t])

  // mig 313: disponibilitatea se schimbă cât editorul stă deschis (un produs
  // epuizat e deblocat de personal, sau invers). La FIECARE deschidere a
  // selectorului meniul se reface — doar catalogul: coșul și editările
  // nesalvate stau în `cart`, neatinse; categoria aleasă rămâne dacă există
  // încă. Un eșec lasă catalogul de dinainte (serverul respinge oricum un
  // produs epuizat cu product_sold_out).
  function openPicker(): void {
    setShowPicker(true)
    setCatalogRefreshing(true)
    const isLatest = menuGateRef.current.begin()
    fetchMenuForRestaurant(order.restaurant_id)
      .then((cats) => {
        if (!isLatest()) return
        setCategories(cats)
        setLoadError(null)
        setActiveCatId((prev) =>
          prev != null && cats.some((c) => c.id === prev) ? prev : (cats[0]?.id ?? null),
        )
        // Un produs deja deschis pe care catalogul nou îl dă epuizat (sau
        // scos din meniu) își închide foaia: nu mai poate fi adăugat.
        setActiveProduct((prev) => {
          if (!prev) return prev
          const fresh = cats.flatMap((c) => c.products).find((p) => p.id === prev.id)
          return fresh && !fresh.is_sold_out ? prev : null
        })
        setCatalogRefreshing(false)
      })
      .catch(() => {
        /* catalogul de dinainte rămâne */
        if (isLatest()) setCatalogRefreshing(false)
      })
  }

  // Refetch starea curentă a comenzii la deschidere — reduce fereastra de
  // lost-update (alt ospătar a adăugat ceva între render și deschidere).
  // Aplicăm doar dacă userul n-a început deja să editeze (dirtyRef.current=false).
  useEffect(() => {
    let cancelled = false
    fetchOrderById(order.id)
      .then((fresh) => {
        if (cancelled || dirtyRef.current) return
        setCart(orderItemsToCart(fresh))
        setBaselineTotal(fresh.total)
      })
      .catch(() => {
        /* păstrăm snapshot-ul din prop */
      })
    return () => {
      cancelled = true
    }
  }, [order.id])

  /** Plafonul serverului pe linie: 20, sau cantitatea veche a liniei păstrate. */
  function lineQtyCap(item: EditCartItem): number {
    return Math.max(MAX_LINE_QTY, item._srcQty ?? 0)
  }

  function updateQty(key: string, delta: number): void {
    dirtyRef.current = true
    setCart((prev) =>
      prev.map((i) =>
        i._key === key
          ? // Între 1 și plafonul serverului pe linie (mig 320): 20, iar o linie
            // păstrată își poate ține cantitatea veche chiar peste 20.
            { ...i, quantity: Math.min(lineQtyCap(i), Math.max(1, i.quantity + delta)) }
          : i,
      ),
    )
  }

  function removeItem(key: string): void {
    dirtyRef.current = true
    setCart((prev) => prev.filter((i) => i._key !== key))
  }

  function addItem(item: CartItem): void {
    dirtyRef.current = true
    setCart((prev) => [...prev, item])
  }

  const productsById = new Map(categories.flatMap((c) => c.products).map((p) => [p.id, p] as const))
  const cartTotal = cart.reduce((s, i) => s + lineTotal(i, productsById), 0)
  const activeProducts = categories.find((c) => c.id === activeCatId)?.products ?? []

  async function handleSave(): Promise<void> {
    if (cart.length === 0) {
      setSubmitError(t('edit_errEmpty'))
      return
    }
    if (hasOrphan) {
      setSubmitError(t('edit_errOrphan'))
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
          // Linia existentă: sursa + extra-urile EI; linia nouă: extra-urile
          // alese (mig 320 — fără ghicit pe produs).
          ...(i._sourceId
            ? { source_item_id: i._sourceId, extra_ids: extraIdsOf(i._extras) }
            : { extra_ids: (i.selected_extras ?? []).map((e) => e.id) }),
        })),
        baselineTotal,
      )
      onSaved()
    } catch (e: unknown) {
      // Motivul serverului, în română (ex. „comanda a fost modificată între
      // timp" — lock-ul optimist), nu „Eroare la salvare" generic.
      setSubmitError(describeEditOrderError(e, tr))
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
              {t('edit_title')}
            </div>
            <div style={{ fontSize: 12, color: D.t3, marginTop: 2 }}>
              {order.table?.name ? t('tableLabel', { table: order.table.name }) : t('noTable')} · #
              {order.id.slice(-6).toUpperCase()}
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
              {t('edit_emptyCart')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cart.map((item) => (
                <div
                  key={item._key}
                  style={{
                    background: D.s2,
                    border: `1px solid ${item._orphan ? D.red + '88' : D.s3}`,
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
                        {item._orphan && (
                          <span title={t('edit_orphanTitle')} style={{ marginRight: 6 }}>
                            ⚠
                          </span>
                        )}
                        {item.product_name_snapshot}
                      </div>
                      {item._orphan && (
                        <div style={{ fontSize: 11, color: D.red, marginTop: 3 }}>
                          {t('edit_orphanHint')}
                        </div>
                      )}
                      <OrderLineDetails
                        item={{
                          selected_modifiers: item.selected_modifiers,
                          notes: item.notes,
                          extras_added: item._extras,
                        }}
                      />
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: D.gold, fontWeight: 600, fontSize: 14 }}>
                        {t('money', { amount: lineTotal(item, productsById).toFixed(2) })}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => updateQty(item._key, -1)}
                        disabled={item._orphan || item.quantity <= 1}
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: D.s3,
                          border: 'none',
                          color: D.t1,
                          cursor: item._orphan || item.quantity <= 1 ? 'not-allowed' : 'pointer',
                          opacity: item._orphan || item.quantity <= 1 ? 0.4 : 1,
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
                        disabled={item._orphan || item.quantity >= lineQtyCap(item)}
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: D.s3,
                          border: 'none',
                          color: D.t1,
                          cursor: item._orphan || item.quantity >= lineQtyCap(item) ? 'not-allowed' : 'pointer',
                          opacity: item._orphan || item.quantity >= lineQtyCap(item) ? 0.4 : 1,
                          fontSize: 16,
                        }}
                      >
                        +
                      </button>
                    </div>
                    <button
                      onClick={() => removeItem(item._key)}
                      title={tc.t('delete')}
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
                      {tc.t('delete')}
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
            onClick={openPicker}
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
            {t('edit_addProduct')}
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
            <span style={{ color: D.t2, fontSize: 13 }}>{t('edit_newSubtotal')}</span>
            <span
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 22,
                fontWeight: 700,
                color: D.gold,
              }}
            >
              {t('money', { amount: cartTotal.toFixed(2) })}
            </span>
          </div>
          {order.discount_amount != null && order.discount_amount > 0 && (
            <div style={{ fontSize: 11, color: D.t3, textAlign: 'right' }}>
              {t('edit_discountRecalc', { amount: Number(order.discount_amount).toFixed(2) })}
            </div>
          )}
          {submitError && (
            <div
              role="alert"
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
            {submitting ? t('saving') : t('edit_saveChanges')}
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
                {t('edit_pickProduct')}
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
                // mig 313: un produs epuizat nu poate fi ADĂUGAT (serverul
                // respinge cu product_sold_out); cantitatea deja comandată
                // din el rămâne editabilă în coș.
                <button
                  key={p.id}
                  disabled={p.is_sold_out || catalogRefreshing}
                  aria-disabled={p.is_sold_out || catalogRefreshing}
                  aria-busy={catalogRefreshing || undefined}
                  onClick={() => {
                    if (!p.is_sold_out && !catalogRefreshing) setActiveProduct(p)
                  }}
                  style={{
                    background: D.s2,
                    border: `1px solid ${D.s3}`,
                    borderRadius: 10,
                    padding: 10,
                    cursor: p.is_sold_out || catalogRefreshing ? 'not-allowed' : 'pointer',
                    opacity: p.is_sold_out ? 0.5 : catalogRefreshing ? 0.7 : 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ color: D.t1, fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                  <span style={{ color: p.is_sold_out ? D.red : D.gold, fontSize: 13 }}>
                    {p.is_sold_out ? t('soldOut') : t('money', { amount: p.price.toFixed(2) })}
                  </span>
                </button>
              ))}
              {activeProducts.length === 0 && (
                <div
                  style={{ color: D.t3, gridColumn: '1 / -1', textAlign: 'center', padding: 20 }}
                >
                  {t('edit_noProducts')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeProduct && (
        <ModifierSheet
          product={activeProduct}
          // Lotul O3b: extra-urile plătite se pot adăuga și la editare (pleacă
          // drept extra_ids, validate de server).
          allowExtras
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

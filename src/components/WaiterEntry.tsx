// =============================================================
// Menuvia — src/components/WaiterEntry.tsx
// Waiter manual order entry. Dark theme. No `any`.
// Flow: table selector → product browser → cart → submit
// =============================================================

import { useState, useEffect, useRef } from 'react'
import {
  fetchTables,
  createOrder,
  lineTotal,
  MAX_LINE_QTY,
  MAX_ORDER_NOTE,
  type OrdersTranslator,
} from '../lib/orders'
import { invalidateStaffMenu, loadStaffMenu } from '../lib/staffMenuCache'
import type { RestaurantTable, CartItem, OrderConfirmationPayload } from '../lib/orders'
import type { Category, Product } from '../lib/qr'
import { D } from '../lib/constants'
import { isNetworkError } from '../lib/networkError'
import { describeGuestError, isStaleMenuGuestError } from '../lib/guestErrors'
import { toUserMessage } from '../lib/userMessages'
import ModifierSheet from './ModifierSheet'
import { OrderLineDetails } from './OrderLineDetails'
import { confirm as confirmDialog } from './ui/confirm'
import { useT } from '../i18n/useT'
import { ordersNs } from '../i18n/ns/orders'
import { commonNs } from '../i18n/ns/common'
import { describeStaffError } from '../i18n/staffErrors'
import type { Translator } from '../i18n/core'
import type commonRo from '../i18n/ns/common/ro'

// D imported from constants

// Refuzul lui `create_order`, pentru ospătar.
// În ROMÂNĂ: lanțul de dinainte, neatins — mesajul ROMÂNESC al serverului
// rămâne (numește produsul: „Produsul "Pizza" este epuizat", „Grupul … pentru
// produsul …"), deci ospătarul află CARE linie s-o scoată (recenzia #346); un
// mesaj englezesc sau intern („Invalid quantity: 24 (must be 1-20)") devine
// textul clar al cheii oaspetelui, nu ajunge brut.
// În altă limbă: un text românesc de la server NU ajunge pe ecran
// (`describeStaffError`): hint-ul cunoscut își are textul în `orders`, restul
// cade pe clasa erorii sau pe „Comanda nu a fost trimisă”.
function describeEntryError(
  err: unknown,
  tr: OrdersTranslator,
  tc: Translator<typeof commonRo>,
): string {
  if (tc.lang === 'ro') {
    return toUserMessage(err, '') || describeGuestError('ro', err, { fallback: 'err_order_not_sent' })
  }
  const { t } = tr
  const gone = t('entry_errProductGone')
  const options = t('entry_errOptions')
  const orderingOff = t('entry_errOrderingOff')
  const notes = t('entry_errNotesTooLong')
  return describeStaffError(err, tc, {
    fallback: t('entry_errNotSent'),
    hints: {
      missing_required_group: t('entry_errMissingGroup'),
      product_sold_out: t('entry_errSoldOut'),
      product_inactive: gone,
      product_draft: gone,
      product_not_found: gone,
      product_unavailable: gone,
      product_wrong_restaurant: gone,
      invalid_options: options,
      duplicate_options: options,
      too_many_in_group: options,
      duplicate_extras: options,
      invalid_extras: options,
      invalid_quantity: t('entry_errQuantity', { max: MAX_LINE_QTY }),
      too_many_items: t('entry_errTooMany'),
      notes_too_long: notes,
      item_notes_too_long: notes,
      restaurant_inactive: orderingOff,
      plan_upgrade_required: orderingOff,
    },
  })
}

interface Props {
  restaurantId: string
  onClose: () => void
  // Primește confirmarea: pagina îi spune ospătarului unde a ajuns comanda —
  // trimisă la bucătărie sau salvată DOAR pe telefon (`LOCAL-…`, coada offline).
  onOrderCreated: (confirmation: OrderConfirmationPayload) => void
  // Masă pre-selectată (din panoul „Stadiu mese" → „Adaugă la masă"): sare direct
  // la meniu pe masa aia, ca o rundă nouă pe aceeași masă, fără să mai alegi.
  initialTableId?: string | null
}

// ── WaiterEntry ───────────────────────────────────────────────

type Step = 'table' | 'menu'

export default function WaiterEntry({
  restaurantId,
  onClose,
  onOrderCreated,
  initialTableId,
}: Props) {
  const tr = useT(ordersNs)
  const { t, tp } = tr
  const tc = useT(commonNs)
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
  // Key stabil per sesiune de coș. Reutilizat la toate retry-urile (loop-ul
  // de mai jos + sync offline) → dublu-submit / răspuns pierdut nu creează
  // 2 comenzi (index UNIQUE pe (restaurant_id, idempotency_key) deduplică).
  // Regenerat după fiecare comandă trimisă cu succes.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID())
  // Meniul pornește la MONTARE, în paralel cu mesele (perf-staff-2): cât
  // ospătarul alege masa, arborele e deja pe drum. Înainte se cerea abia după
  // alegerea mesei, iar la fiecare masă aleasă se re-descărca de la zero.
  // Fiecare alegere de masă trece din nou prin `loadStaffMenu`: în TTL-ul de
  // 60 s primește aceeași promisiune (fără re-descărcare), peste el cere
  // arborele din nou. O promisiune ținută într-un ref de la montare ar fi
  // ocolit TTL-ul cât foaia stă deschisă (prețuri / „Epuizat" vechi — recenzie
  // CodeRabbit pe #321, WE4). Eșecul nu rămâne „lipit": cache-ul șterge
  // intrarea respinsă, deci următoarea alegere reîncearcă (WE3).

  function openMenu(table: RestaurantTable | null, isCancelled: () => boolean): void {
    setSelectedTable(table)
    setLoadError(null)
    loadStaffMenu(restaurantId)
      .then((cats) => {
        if (isCancelled()) return
        setCategories(cats)
        setActiveCatId(cats[0]?.id ?? null)
        setStep('menu')
      })
      .catch(() => {
        if (!isCancelled()) setLoadError(t('entry_errMenu'))
      })
  }

  useEffect(() => {
    let cancelled = false
    // Încălzește cache-ul; eroarea meniului se arată la alegerea mesei
    // (openMenu), nu aici.
    loadStaffMenu(restaurantId).catch(() => {
      /* arătată la alegerea mesei */
    })
    fetchTables(restaurantId)
      .then((ts) => {
        if (cancelled) return
        setTables(ts)
        // Pre-select din „Stadiu mese": dacă masa cerută există, sărim direct la
        // meniu (rundă nouă pe aceeași masă). Fără initialTableId → flux normal.
        if (initialTableId) {
          const match = ts.find((row) => row.id === initialTableId)
          if (match) openMenu(match, () => cancelled)
        }
      })
      .catch(() => setLoadError(t('entry_errTables')))
    return () => {
      cancelled = true
    }
    // openMenu e o funcție locală fără stare proprie (citește ref-uri, setteri
    // stabili și traducătorul `t`) — re-rularea efectului la fiecare randare ar
    // re-cere mesele. `t` (citit și direct, în `.catch` de mai sus) rămâne
    // DELIBERAT în afara deps: e memoizat pe limbă, iar o schimbare de limbă în
    // timpul încărcării costă cel mult un mesaj de eroare în limba veche — nu
    // merită re-cererea meselor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, initialTableId])

  function goToMenu(table: RestaurantTable | null): void {
    openMenu(table, () => false)
  }

  // „✕" stă lângă „Coș (N)": un tap scăpat arunca TOT coșul fără întrebare
  // (ux-staff-entry-discard). Cu produse în coș, cerem confirmare.
  async function requestClose(): Promise<void> {
    if (cart.length > 0) {
      const n = cart.reduce((sum, i) => sum + i.quantity, 0)
      const ok = await confirmDialog({
        title: t('entry_discardTitle'),
        description: tp('entry_discardDesc', n),
        confirmLabel: t('entry_discardConfirm'),
        cancelLabel: t('entry_discardKeep'),
        destructive: true,
      })
      if (!ok) return
    }
    onClose()
  }

  function addToCart(item: CartItem): void {
    setCart((prev) => [...prev, item])
  }

  function updateQty(key: string, delta: number): void {
    setCart((prev) =>
      // Același plafon ca serverul (create_order: 1–20 pe linie): „+" din coș
      // nu mai poate duce linia la 21, ca toată comanda să fie apoi refuzată.
      prev.map((i) =>
        i._key === key
          ? { ...i, quantity: Math.min(MAX_LINE_QTY, Math.max(1, i.quantity + delta)) }
          : i,
      ),
    )
  }

  function removeFromCart(key: string): void {
    setCart((prev) => prev.filter((i) => i._key !== key))
  }

  const cartTotal = cart.reduce((s, i) => s + lineTotal(i), 0)

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    setSubmitError(null)

    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const confirmation = await createOrder({
          restaurant_id: restaurantId,
          source: 'waiter',
          table_id: selectedTable?.id ?? null,
          qr_token_id: null,
          notes: notes.length > 0 ? notes : null,
          cart,
          idempotency_key: idempotencyKeyRef.current,
        })
        // Comandă trimisă — rotim key-ul pentru următoarea comandă.
        idempotencyKeyRef.current = crypto.randomUUID()
        onOrderCreated(confirmation)
        return
      } catch (e: unknown) {
        lastError = e
        // Detecția unică (lib/networkError.ts) — cunoaște și „Load failed" de pe iPhone.
        if (!isNetworkError(e) || attempt === 2) break
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1000))
      }
    }

    // Mesajul serverului în limba ospătarului (describeEntryError, mai sus).
    setSubmitError(describeEntryError(lastError, tr, tc))
    // Refuz pe meniu învechit (epuizat, produs scos, opțiune/extra
    // indisponibil): meniul ținut un minut în cache e cel greșit. Îl uităm și
    // îl cerem din nou, ca la „scoate și adaugă din nou" ospătarul să vadă ce
    // se poate comanda ACUM (recenzia O2b). Coșul rămâne neatins.
    if (isStaleMenuGuestError(lastError)) {
      invalidateStaffMenu(restaurantId)
      loadStaffMenu(restaurantId)
        .then((cats) => setCategories(cats))
        .catch(() => {
          /* meniul vechi rămâne; următoarea alegere de masă reîncearcă */
        })
    }
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
            {t('entry_selectTable')}
          </span>
          <button
            onClick={() => void requestClose()}
            aria-label={t('entry_closeAria')}
            style={{
              background: 'none',
              border: 'none',
              color: D.t2,
              fontSize: 22,
              cursor: 'pointer',
              minWidth: 44,
              minHeight: 44,
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
                    .catch(() => setLoadError(t('entry_errStill')))
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
                {tc.t('retry')}
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
            {t('noTable')}
          </button>
          {tables.map((table) => (
            <button
              key={table.id}
              onClick={() => goToMenu(table)}
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
              {table.name}
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
          {selectedTable != null ? selectedTable.name : t('noTable')}
        </span>
        {/* Distanță mare între „Coș" și „✕": cele două erau la 12 px. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
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
              {t('entry_cartCount', { n: cart.length })}
            </button>
          )}
          <button
            onClick={() => void requestClose()}
            aria-label={t('entry_closeAria')}
            style={{
              background: 'none',
              border: 'none',
              color: D.t2,
              fontSize: 22,
              cursor: 'pointer',
              minWidth: 44,
              minHeight: 44,
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
                  <span style={{ color: D.red, fontSize: 12, marginLeft: 8 }}>{t('soldOut')}</span>
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
              {t('money', { amount: product.price.toFixed(2) })}
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
          allowExtras
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
              {t('entry_cart')}
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
                  {/* Ce pleacă la bucătărie: opțiunile, extra-urile și nota liniei
                      (lotul O2a) — două „Pizza" se pot deosebi înainte de trimitere. */}
                  <OrderLineDetails
                    item={{
                      selected_modifiers: item.selected_modifiers,
                      notes: item.notes,
                      extras_added: (item.selected_extras ?? []).map((e) => ({ extra_name: e.name })),
                    }}
                  />
                  <div style={{ color: D.gold, fontSize: 13 }}>
                    {t('money', { amount: lineTotal(item).toFixed(2) })}
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
                    disabled={item.quantity >= MAX_LINE_QTY}
                    style={{
                      background: D.s3,
                      border: 'none',
                      color: D.t1,
                      borderRadius: '50%',
                      width: 28,
                      height: 28,
                      cursor: item.quantity >= MAX_LINE_QTY ? 'not-allowed' : 'pointer',
                      opacity: item.quantity >= MAX_LINE_QTY ? 0.4 : 1,
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
              {t('entry_total', { amount: cartTotal.toFixed(2) })}
            </div>

            <textarea
              placeholder={t('entry_notesPlaceholder')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={MAX_ORDER_NOTE}
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
              {submitting ? t('entry_sending') : t('entry_send')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

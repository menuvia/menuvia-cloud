// =============================================================
// Menuvia — src/pages/QrMenuPage.tsx
// Customer QR ordering page. Anon. Light theme. No `any`.
// Mobile-first, max-width 480px.
// =============================================================

import { useState, useEffect, lazy, Suspense } from 'react'
import {
  resolveQrToken,
  fetchMenuForRestaurant,
  fetchActiveHappyHour,
  happyHourPercentForProduct,
  openTableSession,
  type HappyHourRule,
} from '../lib/qr'
import { createOrder } from '../lib/orders'
import type { ResolvedQrToken, Category, Product } from '../lib/qr'
import type { CartItem, OrderConfirmationPayload } from '../lib/orders'
import { callWaiter } from '../lib/orders'

import ProductSheet from '../components/ProductSheet'
import { resolveTheme } from '../lib/themes'
import { OrderTracker, ActiveOrdersBanner } from '../components/OrderTracker'

const QrCartSheet = lazy(() => import('../components/QrCartSheet'))

function getIdempotencyKey(token: string): string {
  const storageKey = 'menuvia_idem:' + token
  let key = sessionStorage.getItem(storageKey)
  if (!key) {
    key = crypto.randomUUID()
    sessionStorage.setItem(storageKey, key)
  }
  return key
}
function clearIdempotencyKey(token: string): void {
  sessionStorage.removeItem('menuvia_idem:' + token)
}

interface Props {
  token: string
}

// ── QrMenuPage ────────────────────────────────────────────────

export default function QrMenuPage({ token }: Props) {
  const [ctx, setCtx] = useState<ResolvedQrToken | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [happyHour, setHappyHour] = useState<HappyHourRule[]>([])
  const [activeCatId, setActiveCatId] = useState<string | null>(null)
  const [resolving, setResolving] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [networkError, setNetworkError] = useState(false)
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<OrderConfirmationPayload | null>(null)
  const [callingWaiter, setCallingWaiter] = useState(false)
  const [waiterCalled, setWaiterCalled] = useState(false)
  const [previousOrders, setPreviousOrders] = useState<OrderConfirmationPayload[]>([])
  const [pairingPopup, setPairingPopup] = useState<{
    sourceProduct: Product
    pairings: Product[]
  } | null>(null)

  // Stable idempotency key — survives retries of the SAME order; rotated on reset.
  // Prevents duplicate orders when network flakes between request and response.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => getIdempotencyKey(token))

  // Gate B: session_id deschisă la scanare QR (open_table_session RPC).
  // Opțional — null dacă restaurantul nu e pe Gate B sau RPC eșuează (graceful).
  const [sessionId, setSessionId] = useState<string | null>(null)

  function loadQr() {
    setResolving(true)
    setInvalid(false)
    setNetworkError(false)
    let cancelled = false
    resolveQrToken(token)
      .then((result) => {
        if (cancelled) return
        if (result == null) {
          setInvalid(true)
          setResolving(false)
          return
        }
        setCtx(result)
        // Gate B: deschide sesiunea la scanare (non-blocking, graceful fallback).
        // Dacă RPC-ul lipsește sau eșuează → session_id rămâne null, create_order
        // funcționează fără guard (backward compat).
        openTableSession(token)
          .then((sess) => {
            if (!cancelled) setSessionId(sess.session_id)
          })
          .catch(() => {})
        // Happy Hour activ — non-blocking; meniul se afișează chiar dacă pică.
        void fetchActiveHappyHour(result.restaurant.id)
          .then((rules) => {
            if (!cancelled) setHappyHour(rules)
          })
          .catch(() => {})
        return fetchMenuForRestaurant(result.restaurant.id).then((cats) => {
          if (cancelled) return
          setCategories(cats)
          setActiveCatId(cats[0]?.id ?? null)
          setResolving(false)
        })
      })
      .catch(() => {
        if (!cancelled) {
          setNetworkError(true)
          setResolving(false)
        }
      })
    return () => {
      cancelled = true
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => loadQr(), [token])

  function addToCart(item: CartItem): void {
    setCart((p) => [...p, item])
    // Trigger pairing popup if product has pairings and they're not already in cart
    const allProducts = categories.flatMap((c) => c.products)
    const sourceProduct = allProducts.find((p) => p.id === item.product_id)
    if (sourceProduct && sourceProduct.pairings && sourceProduct.pairings.length > 0) {
      const cartProductIds = new Set(cart.map((c) => c.product_id).concat([item.product_id]))
      const pairedProducts = sourceProduct.pairings
        .map((pr) => allProducts.find((p) => p.id === pr.paired_product_id))
        .filter((p): p is Product => p != null && !p.is_sold_out && !cartProductIds.has(p.id))
        .slice(0, 3)
      if (pairedProducts.length > 0) {
        setPairingPopup({ sourceProduct, pairings: pairedProducts })
      }
    }
  }

  function updateQty(key: string, delta: number): void {
    setCart((p) =>
      p.map((i) => (i._key === key ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)),
    )
  }

  function removeFromCart(key: string): void {
    setCart((p) => p.filter((i) => i._key !== key))
  }

  function lineTotal(item: CartItem): number {
    const md = item.selected_modifiers.reduce((s, m) => s + m.price_delta, 0)
    return (item.unit_price_snapshot + md) * item.quantity
  }

  const cartTotal = cart.reduce((s, i) => s + lineTotal(i), 0)

  async function handleSubmit(): Promise<void> {
    if (ctx == null) return
    setSubmitting(true)
    setSubmitError(null)

    // Retry up to 2 times on network failures (common on 4G in restaurants)
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await createOrder({
          restaurant_id: ctx.restaurant.id,
          source: 'qr',
          table_id: ctx.table.id,
          qr_token_id: ctx.token.id,
          notes: notes.length > 0 ? notes : null,
          cart,
          idempotency_key: idempotencyKey,
          session_id: sessionId,
        })
        setConfirmation(result)
        return
      } catch (e: unknown) {
        lastError = e
        const msg = e instanceof Error ? e.message : ''
        // Only retry on network-level failures, not on server validation errors
        const isNetworkError =
          msg.includes('fetch') ||
          msg.includes('network') ||
          msg.includes('Failed to fetch') ||
          msg.includes('NetworkError') ||
          msg.includes('ECONNREFUSED')
        if (!isNetworkError || attempt === 2) break
        // Wait 1s, then 2s before retrying
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1000))
      }
    }

    const msg = lastError instanceof Error ? lastError.message : 'Eroare la trimiterea comenzii'
    const isOffline =
      msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch')
    setSubmitError(isOffline ? 'Conexiune slabă. Verifică internetul și încearcă din nou.' : msg)
    setSubmitting(false)
  }

  async function handleCallWaiter(): Promise<void> {
    if (!ctx || callingWaiter || waiterCalled) return
    setCallingWaiter(true)
    try {
      await callWaiter(ctx.token.id)
      setWaiterCalled(true)
      setTimeout(() => setWaiterCalled(false), 60000)
    } catch (err) {
      console.error('[QrMenuPage] callWaiter failed:', err)
      // Nu afișăm eroare vizibilă — butonul se resetează și clientul poate reîncerca
    }
    setCallingWaiter(false)
  }

  function handleReset(addMore = false): void {
    // If addMore: push current order to previousOrders, stay in session
    // If full reset: clear everything including session history
    if (addMore && confirmation) {
      setPreviousOrders((prev) => [...prev, confirmation])
    } else {
      setPreviousOrders([])
      // Full reset = grup nou la masă; re-deschidem sesiunea la next scan
      setSessionId(null)
    }
    clearIdempotencyKey(token)
    setCart([])
    setNotes('')
    setConfirmation(null)
    setShowCart(false)
    setSubmitError(null)
    setSubmitting(false)
    setIdempotencyKey(crypto.randomUUID())
  }

  // ── Resolve theme from restaurant settings ──────────────────
  const theme = resolveTheme(ctx?.restaurant.theme_settings)
  const PUB = {
    bg: theme.colors.bg,
    surface: theme.colors.surface,
    text: theme.colors.text,
    text2: theme.colors.text2,
    text3: theme.colors.text3,
    border: theme.colors.border,
    borderStrong: theme.colors.borderStrong,
  }
  // Backward-compat: primary_color from old DB column → override accent if set
  const accent = ctx?.restaurant.primary_color ?? theme.colors.accent
  const accentGradient = theme.colors.accentGradient
  const activeProducts = categories.find((c) => c.id === activeCatId)?.products ?? []
  const orderingAllowed = ctx?.orderingAllowed ?? false

  if (resolving) {
    return (
      <div
        style={{
          background: PUB.bg,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: '#5C4A2A', fontFamily: 'DM Sans, sans-serif' }}>Se încarcă...</span>
      </div>
    )
  }

  if (invalid) {
    return (
      <div
        style={{
          background: PUB.bg,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 32,
        }}
      >
        <div style={{ fontSize: 48 }}>❌</div>
        <div
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: PUB.text,
            textAlign: 'center',
          }}
        >
          QR invalid sau expirat
        </div>
        <div style={{ fontSize: 14, color: '#5C4A2A', textAlign: 'center' }}>
          Scanează din nou codul QR de pe masă.
        </div>
      </div>
    )
  }

  if (networkError) {
    return (
      <div
        style={{
          background: PUB.bg,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 32,
        }}
      >
        <div style={{ fontSize: 48 }}>📶</div>
        <div
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: PUB.text,
            textAlign: 'center',
          }}
        >
          Conexiune slabă
        </div>
        <div style={{ fontSize: 14, color: '#5C4A2A', textAlign: 'center', marginBottom: 8 }}>
          Nu s-a putut încărca meniul. Verifică internetul și încearcă din nou.
        </div>
        <button
          onClick={loadQr}
          style={{
            background: '#C8963C',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            padding: '12px 28px',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'DM Sans,sans-serif',
          }}
        >
          Reîncearcă
        </button>
      </div>
    )
  }

  if (confirmation != null) {
    return (
      <OrderTracker
        confirmation={confirmation}
        accent={accent}
        onReset={handleReset}
        previousOrders={previousOrders}
      />
    )
  }

  return (
    <div
      style={{
        background: PUB.bg,
        minHeight: '100vh',
        maxWidth: 480,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ctx?.restaurant.logo_url != null ? (
          <img
            src={ctx.restaurant.logo_url}
            alt={ctx.restaurant.name}
            decoding="async"
            style={{ height: 48, objectFit: 'contain', marginBottom: 4 }}
          />
        ) : (
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 22,
              fontWeight: 700,
              color: PUB.text,
            }}
          >
            {ctx?.restaurant.name}
          </div>
        )}
        <div
          style={{
            display: 'inline-block',
            background: `${accent}18`,
            border: `1px solid ${accent}44`,
            borderRadius: 20,
            padding: '4px 12px',
            fontSize: 13,
            color: accent,
            fontWeight: 600,
          }}
        >
          {ctx?.table.name ?? 'Masă'}
        </div>
      </div>

      {/* Active orders banner — shown when session has previous orders */}
      {previousOrders.length > 0 && orderingAllowed && !confirmation && (
        <div style={{ padding: '12px 16px 0' }}>
          <ActiveOrdersBanner
            orders={previousOrders}
            accent={accent}
            onAddMore={() => {
              /* user is already in menu */
            }}
          />
        </div>
      )}

      {/* Happy Hour banner */}
      {happyHour.length > 0 && (
        <div
          style={{
            margin: '12px 16px 0',
            padding: '10px 14px',
            background: 'linear-gradient(90deg, #2e7d32, #43a047)',
            borderRadius: 12,
            color: '#fff',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 16 }}>🎉</span>
          <span>Happy Hour activ:</span>
          {happyHour.map((r) => (
            <span
              key={r.id}
              style={{
                background: 'rgba(255,255,255,0.2)',
                borderRadius: 6,
                padding: '2px 8px',
                fontWeight: 700,
              }}
            >
              {r.name} ·{' '}
              {r.discount_type === 'percent'
                ? `-${r.discount_value}%`
                : `-${r.discount_value} lei`}
            </span>
          ))}
        </div>
      )}

      {/* Category tabs */}
      <div
        style={{
          display: 'flex',
          overflowX: 'auto',
          padding: '16px 0 0',
          borderBottom: `1px solid ${PUB.borderStrong}`,
          position: 'sticky',
          top: 0,
          background: PUB.bg,
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCatId(cat.id)}
            style={{
              background: 'transparent',
              borderBottom:
                activeCatId === cat.id ? `2px solid ${accent}` : '2px solid transparent',
              border: 'none',
              padding: '10px 16px',
              color: activeCatId === cat.id ? accent : '#5C4A2A',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              fontWeight: activeCatId === cat.id ? 700 : 400,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Product list — clean compact card design */}
      <div
        style={{
          flex: 1,
          padding: '14px 16px 120px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {activeProducts.map((product) => {
          const hasRequiredMods = product.modifier_groups?.some((g) => g.is_required) ?? false
          const isUnavailable = product.is_sold_out || !orderingAllowed
          const hhPct = happyHourPercentForProduct(product, happyHour)
          const hhPrice = hhPct > 0 ? product.price * (1 - hhPct / 100) : null
          // Compact badges: max 2 (priority: daily_special > dietary)
          const badges: string[] = []
          if (product.is_daily_special) badges.push('⭐')
          if (product.dietary_tags?.includes('vegan')) badges.push('🌱')
          else if (product.dietary_tags?.includes('vegetarian')) badges.push('🥗')

          return (
            <div
              key={product.id}
              onClick={() => {
                if (isUnavailable) return
                setActiveProduct(product)
              }}
              style={{
                background: '#FDF8F2',
                border: '1px solid #EDE3D4',
                borderRadius: 14,
                padding: 14,
                cursor: isUnavailable ? 'default' : 'pointer',
                opacity: product.is_sold_out ? 0.55 : 1,
                display: 'flex',
                gap: 14,
                alignItems: 'stretch',
                position: 'relative',
                transition: 'transform 0.1s ease',
                boxShadow: '0 1px 3px rgba(26,18,8,0.04)',
              }}
              onMouseDown={(e) => {
                if (!isUnavailable) e.currentTarget.style.transform = 'scale(0.985)'
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
              }}
            >
              {/* Image or emoji fallback — 88×88 */}
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: 88,
                    height: 88,
                    objectFit: 'cover',
                    borderRadius: 12,
                    flexShrink: 0,
                    background: PUB.surface,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 12,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 38,
                    background: accentGradient,
                  }}
                >
                  🍽️
                </div>
              )}

              {/* Content */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 6,
                }}
              >
                {/* Name + badges */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div
                    style={{
                      fontFamily: 'Fraunces, Georgia, serif',
                      fontSize: 16,
                      fontWeight: 600,
                      color: PUB.text,
                      lineHeight: 1.25,
                      letterSpacing: '-0.01em',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 1,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {product.name}
                    {badges.length > 0 && (
                      <span style={{ marginLeft: 6, fontSize: 13 }}>
                        {badges.slice(0, 2).join(' ')}
                      </span>
                    )}
                  </div>
                  {product.description && product.description.length > 0 && (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: '#7A6A52',
                        lineHeight: 1.35,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {product.description}
                    </div>
                  )}
                </div>

                {/* Price + Add button row */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                    {hasRequiredMods && (
                      <span
                        style={{
                          fontSize: 11,
                          color: '#9A8C7A',
                          fontFamily: 'DM Sans, sans-serif',
                        }}
                      >
                        de la
                      </span>
                    )}
                    {hhPrice != null && (
                      <span
                        style={{
                          fontFamily: 'Fraunces, Georgia, serif',
                          fontSize: 14,
                          fontWeight: 600,
                          color: '#9b8e7d',
                          textDecoration: 'line-through',
                          marginRight: 2,
                        }}
                      >
                        {product.price.toFixed(2)}
                      </span>
                    )}
                    <span
                      style={{
                        fontFamily: 'Fraunces, Georgia, serif',
                        fontSize: 17,
                        fontWeight: 700,
                        color: hhPrice != null ? '#2e7d32' : accent,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {(hhPrice ?? product.price).toFixed(2)}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: hhPrice != null ? '#2e7d32' : accent,
                        fontFamily: 'DM Sans, sans-serif',
                      }}
                    >
                      lei
                    </span>
                    {hhPrice != null && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#fff',
                          background: '#2e7d32',
                          borderRadius: 6,
                          padding: '2px 6px',
                          marginLeft: 4,
                          fontFamily: 'DM Sans, sans-serif',
                        }}
                      >
                        -{hhPct}%
                      </span>
                    )}
                  </div>

                  {product.is_sold_out ? (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#c0392b',
                        fontFamily: 'DM Sans, sans-serif',
                        padding: '4px 10px',
                        borderRadius: 100,
                        background: 'rgba(192,57,43,0.08)',
                      }}
                    >
                      Epuizat
                    </span>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!orderingAllowed) return
                        // If has required modifiers → open ProductSheet (forced selection)
                        // Otherwise → quick add directly to cart
                        if (hasRequiredMods) {
                          setActiveProduct(product)
                        } else {
                          // Quick add: no modifiers needed, no extras to pick
                          const newItem = {
                            _key: crypto.randomUUID(),
                            product_id: product.id,
                            product_name_snapshot: product.name,
                            unit_price_snapshot: product.price,
                            quantity: 1,
                            selected_modifiers: [],
                            notes: null,
                          }
                          setCart((prev) => [...prev, newItem])
                        }
                      }}
                      aria-label={`Adaugă ${product.name}`}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: accent,
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 22,
                        fontWeight: 400,
                        lineHeight: 1,
                        paddingBottom: 2,
                        flexShrink: 0,
                        boxShadow: '0 2px 6px rgba(200,150,60,0.35)',
                        transition: 'transform 0.1s, box-shadow 0.1s',
                      }}
                      onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.92)')}
                      onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                      onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Call waiter button */}
      {ctx && orderingAllowed && !confirmation && (
        <button
          onClick={() => {
            void handleCallWaiter()
          }}
          disabled={callingWaiter || waiterCalled}
          style={{
            position: 'fixed',
            bottom: cart.length > 0 ? 90 : 20,
            left: 16,
            background: waiterCalled ? '#4CAF6E' : 'rgba(26,18,8,0.85)',
            color: '#fff',
            border: 'none',
            borderRadius: 30,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: callingWaiter || waiterCalled ? 'default' : 'pointer',
            fontFamily: 'DM Sans, sans-serif',
            zIndex: 49,
            boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
            opacity: callingWaiter ? 0.7 : 1,
          }}
        >
          {waiterCalled
            ? '\u2713 Ospătar chemat'
            : callingWaiter
              ? 'Se cheam\u0103...'
              : '\ud83d\udc4b Cheam\u0103 ospătarul'}
        </button>
      )}

      {/* Cart bar — only when ordering is allowed and cart has items */}
      {cart.length > 0 && orderingAllowed && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '100%',
            maxWidth: 480,
            padding: '12px 16px 24px',
            background: PUB.bg,
            borderTop: `1px solid ${PUB.borderStrong}`,
            zIndex: 50,
          }}
        >
          <button
            onClick={() => setShowCart(true)}
            style={{
              background: accent,
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              padding: '14px 20px',
              width: '100%',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                background: 'rgba(255,255,255,0.25)',
                borderRadius: 20,
                padding: '2px 10px',
                fontSize: 13,
              }}
            >
              {cart.length} {cart.length === 1 ? 'produs' : 'produse'}
            </span>
            <span>Vezi coșul</span>
            <span>{cartTotal.toFixed(2)} lei</span>
          </button>
        </div>
      )}

      {/* Product sheet */}
      {activeProduct != null && orderingAllowed && (
        <ProductSheet
          product={activeProduct}
          accent={accent}
          theme={theme}
          onAdd={addToCart}
          onClose={() => setActiveProduct(null)}
        />
      )}

      {/* Pairing popup — appears after addToCart if product has pairings */}
      {pairingPopup != null && (
        <div
          onClick={() => setPairingPopup(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(26,18,8,0.55)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            zIndex: 250,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: PUB.bg,
              borderRadius: '20px 20px 0 0',
              width: '100%',
              maxWidth: 480,
              padding: '20px 22px 26px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: '0 -10px 40px rgba(26,18,8,0.18)',
            }}
          >
            <div
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                background: PUB.borderStrong,
                margin: '-8px auto 4px',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>✓</span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#4CAF6E',
                  fontFamily: 'DM Sans, sans-serif',
                }}
              >
                {pairingPopup.sourceProduct.name} adăugat
              </span>
            </div>

            <div
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 19,
                fontWeight: 600,
                color: PUB.text,
                letterSpacing: '-0.01em',
                lineHeight: 1.3,
              }}
            >
              🎉 Merge perfect cu...
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 10,
              }}
            >
              {pairingPopup.pairings.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: '#FDF8F2',
                    border: '1px solid #EDE3D4',
                    borderRadius: 12,
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    alignItems: 'stretch',
                  }}
                >
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt={p.name}
                      loading="lazy"
                      decoding="async"
                      style={{
                        width: '100%',
                        aspectRatio: '1/1',
                        objectFit: 'cover',
                        borderRadius: 8,
                        background: PUB.surface,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        aspectRatio: '1/1',
                        borderRadius: 8,
                        background: accentGradient,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 36,
                      }}
                    >
                      🍽️
                    </div>
                  )}
                  <div
                    style={{
                      fontFamily: 'Fraunces, Georgia, serif',
                      fontSize: 13,
                      fontWeight: 600,
                      color: PUB.text,
                      lineHeight: 1.25,
                      letterSpacing: '-0.01em',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {p.name}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'Fraunces, Georgia, serif',
                        fontSize: 14,
                        fontWeight: 700,
                        color: accent,
                      }}
                    >
                      {p.price.toFixed(2)}{' '}
                      <span style={{ fontSize: 10, fontFamily: 'DM Sans, sans-serif' }}>lei</span>
                    </span>
                    <button
                      onClick={() => {
                        const hasRequired = (p.modifier_groups ?? []).some((g) => g.is_required)
                        if (hasRequired) {
                          // Has required modifiers → open ProductSheet
                          setPairingPopup(null)
                          setActiveProduct(p)
                        } else {
                          // Quick-add the paired product
                          const newItem: CartItem = {
                            _key: crypto.randomUUID(),
                            product_id: p.id,
                            product_name_snapshot: p.name,
                            unit_price_snapshot: p.price,
                            quantity: 1,
                            selected_modifiers: [],
                            notes: null,
                            upsell_source: 'pairing',
                          }
                          setCart((prev) => [...prev, newItem])
                        }
                      }}
                      aria-label={`Adaugă ${p.name}`}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        background: accent,
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18,
                        lineHeight: 1,
                        paddingBottom: 2,
                        flexShrink: 0,
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setPairingPopup(null)}
              style={{
                background: 'transparent',
                border: `1px solid ${PUB.border}`,
                borderRadius: 12,
                padding: '12px 20px',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 14,
                fontWeight: 600,
                color: PUB.text2,
                cursor: 'pointer',
                width: '100%',
                marginTop: 4,
              }}
            >
              Continuă cu meniul
            </button>
          </div>
        </div>
      )}

      {/* Cart sheet — lazy loaded */}
      {showCart && (
        <Suspense fallback={null}>
          <QrCartSheet
            cart={cart}
            cartTotal={cartTotal}
            notes={notes}
            submitting={submitting}
            submitError={submitError}
            categories={categories}
            checkoutSuggestionSettings={ctx?.restaurant.checkout_suggestion_settings ?? null}
            PUB={PUB}
            accent={accent}
            accentGradient={accentGradient}
            onClose={() => setShowCart(false)}
            onNotesChange={setNotes}
            onUpdateQty={updateQty}
            onRemove={removeFromCart}
            onLineTotal={lineTotal}
            onSubmit={() => void handleSubmit()}
            onOpenProduct={(product) => { setActiveProduct(product) }}
            onAddToCart={(item) => setCart((prev) => [...prev, item])}
          />
        </Suspense>
      )}
    </div>
  )
}

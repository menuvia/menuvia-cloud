// ─────────────────────────────────────────────────────────────
// PublicMenuPage — Public restaurant menu (NO QR scan needed)
//
// Two modes:
//   • View only — when pickup is disabled (just browse menu)
//   • Order for pickup — when pickup_settings.enabled = true
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo } from 'react'
import { fetchRestaurantBySlug, fetchMenuForRestaurant } from '../lib/qr'
import type { Restaurant, Category, Product } from '../lib/qr'
import type { CartItem } from '../lib/orders'
import { createOrder } from '../lib/orders'
import { resolveTheme } from '../lib/themes'
import ProductSheet from '../components/ProductSheet'

interface Props {
  slug: string
  onBack: () => void
}

export default function PublicMenuPage({ slug, onBack }: Props) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCat, setActiveCat] = useState<string>('all')
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const [showPickup, setShowPickup] = useState(false)
  const [confirmation, setConfirmation] = useState<{
    short_id: string
    pickup_time: string | null
    total: number
  } | null>(null)

  const theme = useMemo(() => resolveTheme(restaurant?.theme_settings), [restaurant])
  const PUB = {
    bg: theme.colors.bg,
    surface: theme.colors.surface,
    text: theme.colors.text,
    text2: theme.colors.text2,
    text3: theme.colors.text3,
    border: theme.colors.border,
    borderStrong: theme.colors.borderStrong,
  }
  const accent = restaurant?.primary_color ?? theme.colors.accent
  const accentGradient = theme.colors.accentGradient

  const pickupEnabled = restaurant?.pickup_settings?.enabled ?? false

  const loadMenu = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchRestaurantBySlug(slug)
      if (!r) {
        setError('Restaurant negăsit')
        setLoading(false)
        return
      }
      setRestaurant(r as unknown as Restaurant)
      const cats = await fetchMenuForRestaurant((r as { id: string }).id)
      setCategories(cats)
      setLoading(false)
    } catch (err) {
      console.error('[PublicMenuPage] load error:', err)
      setError('Conexiune eșuată. Verifică internetul și încearcă din nou.')
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMenu()
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  const allProducts = useMemo(() => categories.flatMap((c) => c.products), [categories])
  const filtered =
    activeCat === 'all' ? allProducts : allProducts.filter((p) => p.category_id === activeCat)

  const lineTotal = (item: CartItem) => {
    const modsTotal = item.selected_modifiers.reduce((s, m) => s + m.price_delta, 0)
    const extrasTotal = (item.selected_extras ?? []).reduce((s, e) => s + e.price, 0)
    return (item.unit_price_snapshot + modsTotal + extrasTotal) * item.quantity
  }
  const cartTotal = cart.reduce((s, i) => s + lineTotal(i), 0)
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0)

  function addToCart(item: CartItem): void {
    setCart((prev) => [...prev, item])
  }

  function removeFromCart(key: string): void {
    setCart((prev) => prev.filter((i) => i._key !== key))
  }

  if (loading)
    return (
      <div
        style={{
          minHeight: '100vh',
          background: PUB.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: theme.fonts.body,
        }}
      >
        <span style={{ color: PUB.text2 }}>Se încarcă...</span>
      </div>
    )

  if (error || !restaurant)
    return (
      <div
        style={{
          minHeight: '100vh',
          background: PUB.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: theme.fonts.body,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🍽️</div>
          <div style={{ color: PUB.text2, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            {error ?? 'Restaurant negăsit'}
          </div>
          <button
            onClick={() => void loadMenu()}
            style={{
              background: accent,
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: theme.fonts.body,
            }}
          >
            Reîncearcă
          </button>
        </div>
      </div>
    )

  return (
    <div
      style={{
        background: PUB.bg,
        minHeight: '100vh',
        maxWidth: 480,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: theme.fonts.body,
      }}
    >
      {/* Header */}
      <div style={{ padding: '24px 20px 0', flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: PUB.text3,
            cursor: 'pointer',
            fontSize: 13,
            marginBottom: 12,
            fontFamily: theme.fonts.body,
          }}
        >
          ← Înapoi
        </button>
        <div
          style={{
            fontFamily: theme.fonts.heading,
            fontSize: 26,
            fontWeight: 700,
            color: PUB.text,
            letterSpacing: '-0.02em',
          }}
        >
          {restaurant.name}
        </div>
        {pickupEnabled && (
          <div
            style={{
              marginTop: 6,
              padding: '6px 12px',
              background: accent + '15',
              border: `1px solid ${accent}33`,
              borderRadius: 100,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: accent,
              fontWeight: 600,
            }}
          >
            📦 Comandă pentru ridicare
          </div>
        )}
      </div>

      {/* Categories tabs */}
      <div
        style={{
          display: 'flex',
          overflowX: 'auto',
          padding: '16px 20px',
          gap: 8,
          position: 'sticky',
          top: 0,
          background: PUB.bg,
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setActiveCat('all')}
          style={{
            padding: '8px 16px',
            borderRadius: 100,
            border: `1px solid ${activeCat === 'all' ? accent : PUB.border}`,
            background: activeCat === 'all' ? accent : 'transparent',
            color: activeCat === 'all' ? '#fff' : PUB.text,
            cursor: 'pointer',
            fontSize: 13,
            whiteSpace: 'nowrap',
            fontWeight: 600,
          }}
        >
          Toate
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            style={{
              padding: '8px 16px',
              borderRadius: 100,
              border: `1px solid ${activeCat === c.id ? accent : PUB.border}`,
              background: activeCat === c.id ? accent : 'transparent',
              color: activeCat === c.id ? '#fff' : PUB.text,
              cursor: 'pointer',
              fontSize: 13,
              whiteSpace: 'nowrap',
              fontWeight: 600,
            }}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Product list */}
      <div
        style={{
          flex: 1,
          padding: '14px 16px 120px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {filtered.map((product) => {
          const hasRequiredMods = product.modifier_groups?.some((g) => g.is_required) ?? false
          const isUnavailable = product.is_sold_out
          const badges: string[] = []
          if (product.is_daily_special) badges.push('⭐')
          if (product.dietary_tags?.includes('vegan')) badges.push('🌱')
          else if (product.dietary_tags?.includes('vegetarian')) badges.push('🥗')

          return (
            <div
              key={product.id}
              onClick={() => {
                if (!isUnavailable) setActiveProduct(product)
              }}
              style={{
                background: PUB.surface,
                border: `1px solid ${PUB.border}`,
                borderRadius: theme.radius,
                padding: 14,
                cursor: isUnavailable ? 'default' : 'pointer',
                opacity: product.is_sold_out ? 0.55 : 1,
                display: 'flex',
                gap: 14,
                boxShadow: '0 1px 3px rgba(26,18,8,0.04)',
              }}
            >
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                  style={{
                    width: 88,
                    height: 88,
                    objectFit: 'cover',
                    borderRadius: theme.radius - 2,
                    flexShrink: 0,
                    background: PUB.surface,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: theme.radius - 2,
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div
                    style={{
                      fontFamily: theme.fonts.heading,
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
                  {product.description && (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: PUB.text3,
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
                      <span style={{ fontSize: 11, color: PUB.text3 }}>de la</span>
                    )}
                    <span
                      style={{
                        fontFamily: theme.fonts.heading,
                        fontSize: 17,
                        fontWeight: 700,
                        color: accent,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {product.price.toFixed(2)}
                    </span>
                    <span style={{ fontSize: 12, color: accent }}>lei</span>
                  </div>
                  {product.is_sold_out ? (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#c0392b',
                        padding: '4px 10px',
                        borderRadius: 100,
                        background: 'rgba(192,57,43,0.08)',
                      }}
                    >
                      Epuizat
                    </span>
                  ) : pickupEnabled ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (hasRequiredMods) {
                          setActiveProduct(product)
                        } else {
                          addToCart({
                            _key: crypto.randomUUID(),
                            product_id: product.id,
                            product_name_snapshot: product.name,
                            unit_price_snapshot: product.price,
                            quantity: 1,
                            selected_modifiers: [],
                            notes: null,
                          })
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
                        lineHeight: 1,
                        paddingBottom: 2,
                        flexShrink: 0,
                        boxShadow: `0 2px 6px ${accent}55`,
                      }}
                    >
                      +
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Cart bar (sticky bottom — only if pickupEnabled and cart > 0) */}
      {pickupEnabled && cart.length > 0 && !showCart && (
        <button
          onClick={() => setShowCart(true)}
          style={{
            position: 'fixed',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 480,
            width: '100%',
            // Bottom padding include safe-area-inset ca butonul să nu cadă sub
            // home indicator iPhone (PWA fullscreen sau Safari).
            padding: '14px 20px calc(14px + env(safe-area-inset-bottom, 0px))',
            background: accent,
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontFamily: theme.fonts.body,
            fontSize: 15,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: `0 -4px 20px ${accent}55`,
          }}
        >
          <span>
            🛒 {cartCount} {cartCount === 1 ? 'produs' : 'produse'} în coș
          </span>
          <span style={{ fontFamily: theme.fonts.heading }}>{cartTotal.toFixed(2)} lei →</span>
        </button>
      )}

      {/* Product sheet */}
      {activeProduct != null && (
        <ProductSheet
          product={activeProduct}
          accent={accent}
          theme={theme}
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
            background: 'rgba(26,18,8,0.55)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: PUB.bg,
              borderRadius: '20px 20px 0 0',
              width: '100%',
              maxWidth: 480,
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                background: PUB.borderStrong,
                margin: '10px auto 0',
              }}
            />
            <div style={{ padding: '20px 22px 14px', flex: 1, overflowY: 'auto' }}>
              <div
                style={{
                  fontFamily: theme.fonts.heading,
                  fontSize: 22,
                  fontWeight: 600,
                  color: PUB.text,
                  marginBottom: 14,
                  letterSpacing: '-0.01em',
                }}
              >
                Comanda ta
              </div>
              {cart.map((item) => (
                <div
                  key={item._key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '12px 0',
                    borderBottom: `1px solid ${PUB.border}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: PUB.text }}>
                      {item.quantity}× {item.product_name_snapshot}
                    </div>
                    {item.selected_modifiers.length > 0 && (
                      <div style={{ fontSize: 11, color: PUB.text3, marginTop: 3 }}>
                        {item.selected_modifiers.map((m) => m.option_name).join(', ')}
                      </div>
                    )}
                    {(item.selected_extras ?? []).length > 0 && (
                      <div style={{ fontSize: 11, color: PUB.text3, marginTop: 3 }}>
                        + {(item.selected_extras ?? []).map((e) => e.name).join(', ')}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        fontFamily: theme.fonts.heading,
                        fontSize: 14,
                        fontWeight: 700,
                        color: accent,
                      }}
                    >
                      {lineTotal(item).toFixed(2)} lei
                    </span>
                    <button
                      onClick={() => removeFromCart(item._key)}
                      aria-label="Elimină"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: PUB.text3,
                        cursor: 'pointer',
                        fontSize: 14,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                padding: '14px 22px 22px',
                borderTop: `1px solid ${PUB.border}`,
                background: PUB.bg,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 14, color: PUB.text2 }}>Total</span>
                <span
                  style={{
                    fontFamily: theme.fonts.heading,
                    fontSize: 22,
                    fontWeight: 700,
                    color: PUB.text,
                  }}
                >
                  {cartTotal.toFixed(2)} lei
                </span>
              </div>
              <button
                onClick={() => {
                  setShowCart(false)
                  setShowPickup(true)
                }}
                style={{
                  width: '100%',
                  padding: '15px',
                  background: accent,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  fontFamily: theme.fonts.body,
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: `0 4px 14px ${accent}55`,
                }}
              >
                Continuă la ridicare →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pickup checkout sheet */}
      {showPickup && restaurant.pickup_settings != null && (
        <PickupCheckoutSheet
          restaurant={restaurant}
          cart={cart}
          cartTotal={cartTotal}
          theme={theme}
          accent={accent}
          PUB={PUB}
          onClose={() => setShowPickup(false)}
          onSuccess={(short_id, pickup_time, total) => {
            setShowPickup(false)
            setCart([])
            setConfirmation({ short_id, pickup_time, total })
          }}
        />
      )}

      {/* Confirmation sheet */}
      {confirmation != null && (
        <div
          onClick={() => setConfirmation(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(26,18,8,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: PUB.bg,
              borderRadius: 20,
              padding: '32px 24px',
              maxWidth: 420,
              width: '100%',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
            <div
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: 24,
                fontWeight: 600,
                color: PUB.text,
                marginBottom: 8,
                letterSpacing: '-0.01em',
              }}
            >
              Comandă plasată!
            </div>
            <div style={{ fontSize: 14, color: PUB.text2, marginBottom: 16, lineHeight: 1.6 }}>
              Comanda <strong>#{confirmation.short_id}</strong> a fost trimisă restaurantului.
              {confirmation.pickup_time && (
                <>
                  {' '}
                  Vino la{' '}
                  <strong>
                    {new Date(confirmation.pickup_time).toLocaleTimeString('ro-RO', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </strong>{' '}
                  să o ridici.
                </>
              )}
            </div>
            <div style={{ fontSize: 13, color: PUB.text3, marginBottom: 24 }}>
              Total de plată la ridicare:{' '}
              <strong style={{ color: accent }}>{confirmation.total.toFixed(2)} lei</strong>
            </div>
            <button
              onClick={() => setConfirmation(null)}
              style={{
                background: accent,
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '13px 28px',
                fontFamily: theme.fonts.body,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%',
              }}
            >
              Mulțumim!
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── PickupCheckoutSheet — name/phone/time slot picker ────────
import type { MenuTheme } from '../lib/themes'

interface PickupCheckoutProps {
  restaurant: Restaurant
  cart: CartItem[]
  cartTotal: number
  theme: MenuTheme
  accent: string
  PUB: {
    bg: string
    surface: string
    text: string
    text2: string
    text3: string
    border: string
    borderStrong: string
  }
  onClose: () => void
  onSuccess: (short_id: string, pickup_time: string | null, total: number) => void
}

function PickupCheckoutSheet({
  restaurant,
  cart,
  cartTotal,
  theme,
  accent,
  PUB,
  onClose,
  onSuccess,
}: PickupCheckoutProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pickupTime, setPickupTime] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Generate time slots: from now + min_lead_time, in slot_interval increments, until close
  const slots = useMemo(() => {
    const settings = restaurant.pickup_settings
    if (!settings) return []
    const now = new Date()
    const lead = settings.min_lead_time_minutes
    const interval = settings.slot_interval_minutes
    const earliest = new Date(now.getTime() + lead * 60_000)

    // Round up to next interval
    const min = earliest.getMinutes()
    const remainder = min % interval
    if (remainder > 0) earliest.setMinutes(min + (interval - remainder))
    earliest.setSeconds(0)
    earliest.setMilliseconds(0)

    // Parse close time today
    const [closeH, closeM] = settings.open_hours.end.split(':').map(Number)
    const close = new Date(now)
    close.setHours(closeH, closeM, 0, 0)
    if (close.getTime() < earliest.getTime()) return [] // closed

    const result: string[] = []
    let cursor = new Date(earliest)
    while (cursor.getTime() <= close.getTime() && result.length < 16) {
      result.push(cursor.toISOString())
      cursor = new Date(cursor.getTime() + interval * 60_000)
    }
    return result
  }, [restaurant.pickup_settings])

  async function submitOrder() {
    if (name.trim().length === 0) {
      setError('Te rog completează numele')
      return
    }
    if (slots.length > 0 && !pickupTime) {
      setError('Te rog alege un interval')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const result = await createOrder({
        restaurant_id: restaurant.id,
        source: 'pickup',
        table_id: null,
        qr_token_id: null,
        notes: null,
        cart,
        idempotency_key: crypto.randomUUID(),
        pickup_time: pickupTime || null,
        customer_name: name.trim(),
        customer_phone: phone.trim().length > 0 ? phone.trim() : null,
      })
      onSuccess(result.short_id, pickupTime || null, result.total)
    } catch (err) {
      console.error('[PickupCheckout] error:', err)
      setError('Comanda nu s-a trimis. Încearcă din nou.')
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,18,8,0.55)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 150,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: PUB.bg,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: PUB.borderStrong,
            margin: '10px auto 0',
          }}
        />
        <div style={{ padding: '20px 22px 14px', flex: 1, overflowY: 'auto' }}>
          <div
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 22,
              fontWeight: 600,
              color: PUB.text,
              marginBottom: 6,
              letterSpacing: '-0.01em',
            }}
          >
            Detalii ridicare
          </div>
          <div style={{ fontSize: 13, color: PUB.text2, marginBottom: 20 }}>
            Plata se face cash la ridicare.
          </div>

          {/* Name (required) */}
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: PUB.text2,
                marginBottom: 6,
              }}
            >
              Nume *
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ion Popescu"
              style={{
                width: '100%',
                padding: '12px 14px',
                border: `1.5px solid ${PUB.border}`,
                borderRadius: 10,
                fontSize: 14,
                fontFamily: theme.fonts.body,
                background: PUB.surface,
                color: PUB.text,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Phone (optional) */}
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: PUB.text2,
                marginBottom: 6,
              }}
            >
              Telefon (opțional)
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07XX XXX XXX"
              type="tel"
              style={{
                width: '100%',
                padding: '12px 14px',
                border: `1.5px solid ${PUB.border}`,
                borderRadius: 10,
                fontSize: 14,
                fontFamily: theme.fonts.body,
                background: PUB.surface,
                color: PUB.text,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 11, color: PUB.text3, marginTop: 5 }}>
              Pentru a putea fi sunat dacă întârzii
            </div>
          </div>

          {/* Time slots */}
          {slots.length > 0 ? (
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: PUB.text2,
                  marginBottom: 8,
                }}
              >
                Vino la *
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                  gap: 8,
                }}
              >
                {slots.map((iso) => {
                  const t = new Date(iso)
                  const label = t.toLocaleTimeString('ro-RO', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  const isSel = pickupTime === iso
                  return (
                    <button
                      key={iso}
                      onClick={() => setPickupTime(iso)}
                      style={{
                        padding: '10px 6px',
                        border: `1.5px solid ${isSel ? accent : PUB.border}`,
                        background: isSel ? `${accent}14` : PUB.surface,
                        color: isSel ? accent : PUB.text,
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: isSel ? 700 : 500,
                        cursor: 'pointer',
                        fontFamily: theme.fonts.body,
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: '12px 14px',
                background: PUB.surface,
                border: `1px solid ${PUB.border}`,
                borderRadius: 10,
                fontSize: 13,
                color: PUB.text2,
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              ⚠️ Restaurantul este închis acum. Vino mâine în orele de program.
            </div>
          )}

          {restaurant.pickup_settings?.instructions && (
            <div
              style={{
                padding: '12px 14px',
                background: PUB.surface,
                border: `1px solid ${PUB.border}`,
                borderRadius: 10,
                fontSize: 12,
                color: PUB.text2,
                marginBottom: 16,
                lineHeight: 1.55,
              }}
            >
              ℹ️ {restaurant.pickup_settings.instructions}
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '10px 14px',
                background: '#FBE5E5',
                border: '1px solid #C0392B22',
                borderRadius: 8,
                fontSize: 13,
                color: '#C0392B',
                marginBottom: 14,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '14px 22px 22px',
            borderTop: `1px solid ${PUB.border}`,
            background: PUB.bg,
          }}
        >
          <button
            disabled={submitting || (slots.length > 0 && !pickupTime)}
            onClick={() => void submitOrder()}
            style={{
              width: '100%',
              padding: '15px',
              background:
                submitting || (slots.length > 0 && !pickupTime) ? PUB.borderStrong : accent,
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontFamily: theme.fonts.body,
              fontSize: 15,
              fontWeight: 700,
              cursor: submitting || (slots.length > 0 && !pickupTime) ? 'not-allowed' : 'pointer',
              boxShadow: submitting ? 'none' : `0 4px 14px ${accent}55`,
            }}
          >
            {submitting ? 'Se trimite...' : `Trimite comanda · ${cartTotal.toFixed(2)} lei`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PublicMenuPage — Public restaurant menu (NO QR scan needed)
//
// Two modes:
//   • View only — when pickup is disabled (just browse menu)
//   • Order for pickup — when pickup_settings.enabled = true
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useDeferredValue } from 'react'
import type { ReactNode } from 'react'
import {
  fetchRestaurantBySlug,
  fetchMenuForRestaurant,
  computeIsOpen,
  todayHoursLabel,
} from '../lib/qr'
import type { Restaurant, Category, Product } from '../lib/qr'
import type { CartItem } from '../lib/orders'
import { createOrder } from '../lib/orders'
import { resolveTheme, isDarkTheme } from '../lib/themes'
import { DIETARY_TAGS, T } from '../lib/constants'
import type { MenuTheme } from '../lib/themes'
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
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<Set<string>>(() => new Set())
  const [tick, setTick] = useState(0)
  const [confirmation, setConfirmation] = useState<{
    short_id: string
    pickup_time: string | null
    total: number
  } | null>(null)

  const theme = useMemo(() => resolveTheme(restaurant?.theme_settings), [restaurant])
  const isDark = useMemo(() => isDarkTheme(theme), [theme])
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
  const lang = restaurant?.language ?? 'ro'

  // Live update is_open la fiecare 60s (când treci ora închiderii fără refresh)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const isOpen = useMemo(
    () => computeIsOpen(restaurant?.hours_structured, restaurant?.timezone),
    // tick e intenționat în deps ca să re-evalueze la fiecare minut
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restaurant?.hours_structured, restaurant?.timezone, tick],
  )

  const todayHours = useMemo(
    () => todayHoursLabel(restaurant?.hours_structured, restaurant?.timezone),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restaurant?.hours_structured, restaurant?.timezone, tick],
  )

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

  const deferredSearch = useDeferredValue(search)

  const filtered = useMemo(() => {
    const norm = (s: string) =>
      s
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
    const q = norm(deferredSearch.trim())
    return allProducts.filter((p) => {
      if (activeCat !== 'all' && p.category_id !== activeCat) return false
      if (q.length > 0) {
        const haystack = norm(p.name + ' ' + (p.description ?? ''))
        if (!haystack.includes(q)) return false
      }
      if (activeFilters.size > 0) {
        const tags = p.dietary_tags ?? []
        for (const f of activeFilters) {
          if (!tags.includes(f)) return false
        }
      }
      return true
    })
  }, [allProducts, activeCat, deferredSearch, activeFilters])

  // Grupare după categorie pentru SectionHeader (când "Toate" e activ)
  const filteredByCat = useMemo(() => {
    if (activeCat !== 'all') {
      return [{ cat: categories.find((c) => c.id === activeCat) ?? null, products: filtered }]
    }
    const map = new Map<string, Product[]>()
    for (const p of filtered) {
      const arr = map.get(p.category_id) ?? []
      arr.push(p)
      map.set(p.category_id, arr)
    }
    return categories
      .map((c) => ({ cat: c, products: map.get(c.id) ?? [] }))
      .filter((g) => g.products.length > 0)
  }, [filtered, categories, activeCat])

  function toggleFilter(id: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
        position: 'relative',
      }}
    >
      {/* Back button — discret deasupra hero */}
      <button
        onClick={onBack}
        data-testid="back-button"
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          left: 14,
          zIndex: 30,
          background: 'rgba(0,0,0,0.35)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.18)',
          color: '#fff',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          padding: '8px 14px',
          borderRadius: 100,
          fontFamily: theme.fonts.body,
        }}
      >
        ← {T(lang, 'back')}
      </button>

      {/* HERO editorial — full-bleed cover/gradient + glass pills */}
      <HeroSection
        restaurant={restaurant}
        theme={theme}
        isDark={isDark}
        accentGradient={accentGradient}
        isOpen={isOpen}
        todayHours={todayHours}
        lang={lang}
      />

      {pickupEnabled && (
        <div style={{ padding: '14px 20px 0' }}>
          <div
            style={{
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
            <IconBag size={14} color={accent} /> {T(lang, 'pickup_badge')}
          </div>
        </div>
      )}

      {/* STICKY TABS UNDERLINE */}
      <div
        style={{
          position: 'sticky',
          top: 'env(safe-area-inset-top, 0px)',
          zIndex: 20,
          background: PUB.bg,
          padding: '14px 20px 8px',
          marginTop: 18,
          borderBottom: `1px solid ${PUB.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            overflowX: 'auto',
            gap: 22,
            scrollbarWidth: 'none',
          }}
          data-testid="category-tabs"
        >
          <TabButton
            label={T(lang, 'all_categories')}
            active={activeCat === 'all'}
            accent={accent}
            theme={theme}
            text={PUB.text}
            text3={PUB.text3}
            onClick={() => setActiveCat('all')}
          />
          {categories.map((c) => (
            <TabButton
              key={c.id}
              label={c.name}
              active={activeCat === c.id}
              accent={accent}
              theme={theme}
              text={PUB.text}
              text3={PUB.text3}
              onClick={() => setActiveCat(c.id)}
            />
          ))}
        </div>
      </div>

      {/* SEARCH + FILTERS */}
      <div style={{ padding: '14px 20px 6px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={T(lang, 'search_placeholder')}
          theme={theme}
          PUB={PUB}
        />
        <FilterChipsRow
          activeFilters={activeFilters}
          onToggle={toggleFilter}
          theme={theme}
          PUB={PUB}
        />
      </div>

      {/* SECTIONS + CARDS EDITORIAL */}
      <div
        style={{
          flex: 1,
          padding: '4px 20px 140px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {filtered.length === 0 && (
          <EmptyState
            lang={lang}
            theme={theme}
            PUB={PUB}
            accent={accent}
            onClear={() => {
              setSearch('')
              setActiveFilters(new Set())
              setActiveCat('all')
            }}
          />
        )}
        {filteredByCat.map(({ cat, products }) => (
          <div key={cat?.id ?? 'flat'} style={{ display: 'flex', flexDirection: 'column' }}>
            {cat && activeCat === 'all' && (
              <SectionHeader title={cat.name} metaText={cat.meta_text} theme={theme} PUB={PUB} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {products.map((product) => (
                <ProductCardEditorial
                  key={product.id}
                  product={product}
                  accent={accent}
                  theme={theme}
                  PUB={PUB}
                  pickupEnabled={pickupEnabled}
                  onOpen={() => {
                    if (!product.is_sold_out) setActiveProduct(product)
                  }}
                  onQuickAdd={() => {
                    addToCart({
                      _key: crypto.randomUUID(),
                      product_id: product.id,
                      product_name_snapshot: product.name,
                      unit_price_snapshot: product.price,
                      quantity: 1,
                      selected_modifiers: [],
                      notes: null,
                    })
                  }}
                />
              ))}
            </div>
          </div>
        ))}

        {/* FOOTER brand */}
        <FooterBrand restaurant={restaurant} theme={theme} accent={accent} PUB={PUB} lang={lang} />
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
            padding: '14px 20px',
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <IconBag size={16} color="#fff" /> {cartCount}{' '}
            {cartCount === 1 ? 'produs' : 'produse'} în coș
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

// ═══════════════════════════════════════════════════════════════
// ICON SVGs inline — consistent stroke 1.5, currentColor
// ═══════════════════════════════════════════════════════════════
interface IconProps {
  size?: number
  color?: string
}

function IconBag({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 7h12l-1 13H7L6 7Z" />
      <path d="M9 7a3 3 0 1 1 6 0" />
    </svg>
  )
}

function IconMapPin({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}

function IconClock({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function IconWifi({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 9a16 16 0 0 1 20 0" />
      <path d="M5 12.5a11 11 0 0 1 14 0" />
      <path d="M8.5 16a6 6 0 0 1 7 0" />
      <circle cx="12" cy="19" r="0.8" fill={color} />
    </svg>
  )
}

function IconLeaf({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 19c8 0 14-6 14-14-8 0-14 6-14 14Z" />
      <path d="M5 19c2-5 5-8 10-10" />
    </svg>
  )
}

function IconInstagram({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill={color} />
    </svg>
  )
}

function IconSearch({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════
// HERO SECTION — full-bleed cover/gradient + glass pills overlay
// ═══════════════════════════════════════════════════════════════
interface HeroProps {
  restaurant: Restaurant
  theme: MenuTheme
  isDark: boolean
  accentGradient: string
  isOpen: boolean | null
  todayHours: string | null
  lang: string
}

function HeroSection({
  restaurant,
  theme,
  isDark,
  accentGradient,
  isOpen,
  todayHours,
  lang,
}: HeroProps) {
  const hasWifi = restaurant.amenities?.includes('wifi') ?? false
  const hasVegan = restaurant.amenities?.includes('vegan_options') ?? false
  const instagram = restaurant.socials?.instagram

  return (
    <div
      data-testid="hero"
      style={{
        position: 'relative',
        height: 'min(56vh, 380px)',
        minHeight: 320,
        marginLeft: 0,
        marginRight: 0,
        borderRadius: '0 0 24px 24px',
        overflow: 'hidden',
        background: restaurant.cover_url ? '#0a0a0a' : undefined,
        backgroundImage: restaurant.cover_url
          ? `url(${restaurant.cover_url})`
          : accentGradient,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '0 20px calc(env(safe-area-inset-bottom, 0px) + 24px)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
      }}
    >
      {/* Overlay dark garantat — funcționează pe orice cover sau gradient */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.72) 100%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', zIndex: 2 }}>
        {isOpen !== null && (
          <div
            data-testid="status-pill"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 12px',
              borderRadius: 100,
              background: isOpen ? 'rgba(76,175,110,0.22)' : 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: `1px solid ${isOpen ? 'rgba(120,210,150,0.5)' : 'rgba(255,255,255,0.2)'}`,
              color: '#fff',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.08em',
              marginBottom: 14,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: isOpen ? '#7BE093' : '#E58B7E',
                boxShadow: isOpen ? '0 0 8px #7BE093' : 'none',
              }}
            />
            {isOpen ? T(lang, 'open_now') : T(lang, 'closed')}
          </div>
        )}
        <div
          data-testid="hero-name"
          style={{
            fontFamily: theme.fonts.heading,
            fontStyle: 'italic',
            fontSize: 'clamp(34px, 9vw, 52px)',
            fontWeight: 500,
            color: '#fff',
            lineHeight: 1.02,
            letterSpacing: '-0.02em',
            textShadow: '0 2px 12px rgba(0,0,0,0.3)',
          }}
        >
          {restaurant.name}
        </div>
        {restaurant.tagline && (
          <div
            style={{
              fontFamily: theme.fonts.heading,
              fontStyle: 'italic',
              fontSize: 14,
              color: 'rgba(255,255,255,0.85)',
              marginTop: 6,
              fontWeight: 400,
            }}
          >
            {restaurant.tagline}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: 7,
            marginTop: 16,
            overflowX: 'auto',
            scrollbarWidth: 'none',
            paddingBottom: 2,
          }}
        >
          {restaurant.address && (
            <InfoPill isDark={isDark}>
              <IconMapPin /> {restaurant.address}
            </InfoPill>
          )}
          {todayHours && (
            <InfoPill isDark={isDark}>
              <IconClock /> {todayHours}
            </InfoPill>
          )}
          {hasWifi && (
            <InfoPill isDark={isDark}>
              <IconWifi /> WiFi
            </InfoPill>
          )}
          {hasVegan && (
            <InfoPill isDark={isDark}>
              <IconLeaf /> Vegan
            </InfoPill>
          )}
          {instagram && (
            <InfoPill isDark={isDark}>
              <IconInstagram /> {instagram.replace(/^@/, '@')}
            </InfoPill>
          )}
        </div>
      </div>
    </div>
  )
}

// Pill glass-morphism. `isDark` (theme-side) controlează valoarea de
// fundal: pe teme dark, pill-urile devin mai opace negre ca să rămână
// citibile peste overlay-ul deja întunecat al hero-ului.
function InfoPill({ children, isDark }: { children: ReactNode; isDark: boolean }) {
  return (
    <div
      data-testid="info-pill"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 100,
        background: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.18)',
        backdropFilter: 'blur(12px) saturate(120%)',
        WebkitBackdropFilter: 'blur(12px) saturate(120%)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.28)'}`,
        color: '#fff',
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// STICKY TAB — underline coral pe activ, fără pill
// ═══════════════════════════════════════════════════════════════
interface TabProps {
  label: string
  active: boolean
  accent: string
  theme: MenuTheme
  text: string
  text3: string
  onClick: () => void
}

function TabButton({ label, active, accent, theme, text, text3, onClick }: TabProps) {
  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        background: 'none',
        border: 'none',
        padding: '6px 0',
        cursor: 'pointer',
        fontSize: 13.5,
        fontWeight: active ? 700 : 500,
        color: active ? text : text3,
        whiteSpace: 'nowrap',
        fontFamily: theme.fonts.body,
        borderBottom: `2px solid ${active ? accent : 'transparent'}`,
        marginBottom: -1,
        letterSpacing: active ? '-0.005em' : 0,
        transition: 'color 120ms',
      }}
    >
      {label}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════
// SEARCH INPUT
// ═══════════════════════════════════════════════════════════════
interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder: string
  theme: MenuTheme
  PUB: {
    bg: string
    surface: string
    text: string
    text2: string
    text3: string
    border: string
    borderStrong: string
  }
}

function SearchInput({ value, onChange, placeholder, theme, PUB }: SearchInputProps) {
  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          left: 14,
          top: '50%',
          transform: 'translateY(-50%)',
          color: PUB.text3,
          pointerEvents: 'none',
          display: 'flex',
        }}
      >
        <IconSearch size={16} color={PUB.text3} />
      </div>
      <input
        type="text"
        value={value}
        data-testid="search-input"
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '12px 14px 12px 40px',
          background: PUB.surface,
          border: `1px solid ${PUB.border}`,
          borderRadius: 100,
          fontSize: 13.5,
          color: PUB.text,
          fontFamily: theme.fonts.body,
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// FILTER CHIPS — multi-select dietary tags
// ═══════════════════════════════════════════════════════════════
interface FilterChipsProps {
  activeFilters: Set<string>
  onToggle: (id: string) => void
  theme: MenuTheme
  PUB: {
    bg: string
    surface: string
    text: string
    text2: string
    text3: string
    border: string
    borderStrong: string
  }
}

function FilterChipsRow({ activeFilters, onToggle, theme, PUB }: FilterChipsProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 7,
        overflowX: 'auto',
        scrollbarWidth: 'none',
        paddingBottom: 2,
      }}
    >
      {DIETARY_TAGS.map((tag) => {
        const active = activeFilters.has(tag.id)
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => onToggle(tag.id)}
            data-testid={`filter-${tag.id}`}
            style={{
              background: active ? tag.color + '14' : 'transparent',
              border: `1px solid ${active ? tag.color : PUB.border}`,
              color: active ? tag.color : PUB.text2,
              padding: '6px 12px',
              borderRadius: 100,
              fontSize: 11.5,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              fontFamily: theme.fonts.body,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span style={{ fontSize: 12 }}>{tag.emoji}</span>
            {tag.label}
          </button>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// SECTION HEADER — serif left + dotted divider + meta italic right
// ═══════════════════════════════════════════════════════════════
interface SectionHeaderProps {
  title: string
  metaText: string | null
  theme: MenuTheme
  PUB: { text: string; text3: string; border: string }
}

function SectionHeader({ title, metaText, theme, PUB }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 14,
        margin: '14px 0 6px',
      }}
    >
      <h2
        style={{
          fontFamily: theme.fonts.heading,
          fontSize: 22,
          fontWeight: 600,
          color: PUB.text,
          margin: 0,
          letterSpacing: '-0.015em',
          flexShrink: 0,
        }}
      >
        {title}
      </h2>
      <div
        style={{
          flex: 1,
          height: 1,
          borderBottom: `1px dotted ${PUB.border}`,
          marginBottom: 4,
        }}
      />
      {metaText && (
        <div
          style={{
            fontFamily: theme.fonts.heading,
            fontStyle: 'italic',
            fontSize: 11.5,
            color: PUB.text3,
            fontWeight: 400,
            flexShrink: 0,
          }}
        >
          {metaText}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PRODUCT CARD EDITORIAL — list, no card bg, serif italic descr
// ═══════════════════════════════════════════════════════════════
interface CardProps {
  product: Product
  accent: string
  theme: MenuTheme
  PUB: {
    bg: string
    surface: string
    text: string
    text2: string
    text3: string
    border: string
    borderStrong: string
  }
  pickupEnabled: boolean
  onOpen: () => void
  onQuickAdd: () => void
}

function ProductCardEditorial({
  product,
  accent,
  theme,
  PUB,
  pickupEnabled,
  onOpen,
  onQuickAdd,
}: CardProps) {
  const hasRequiredMods = product.modifier_groups?.some((g) => g.is_required) ?? false
  const tags = (product.dietary_tags ?? []).slice(0, 3)
  const isSoldOut = product.is_sold_out
  const priceInt = Math.floor(product.price)
  const priceFrac = (product.price - priceInt).toFixed(2).slice(2) // "50" pentru 32.50

  return (
    <div
      data-testid="product-card"
      onClick={() => {
        if (!isSoldOut) onOpen()
      }}
      style={{
        display: 'flex',
        gap: 14,
        padding: '16px 0',
        borderBottom: `1px solid ${PUB.border}`,
        cursor: isSoldOut ? 'default' : 'pointer',
        opacity: isSoldOut ? 0.55 : 1,
      }}
    >
      {product.image_url && (
        <img
          src={product.image_url}
          alt={product.name}
          loading="lazy"
          decoding="async"
          style={{
            width: 92,
            height: 92,
            objectFit: 'cover',
            borderRadius: 8,
            flexShrink: 0,
            background: PUB.surface,
          }}
        />
      )}

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 10,
          }}
        >
          <div
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 16.5,
              fontWeight: 600,
              color: PUB.text,
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {product.name}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 2,
              flexShrink: 0,
            }}
          >
            {hasRequiredMods && (
              <span
                style={{
                  fontSize: 10,
                  color: PUB.text3,
                  marginRight: 4,
                  fontStyle: 'italic',
                }}
              >
                de la
              </span>
            )}
            <span
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: 20,
                fontWeight: 700,
                color: accent,
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {priceInt}
            </span>
            <span
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: 13,
                fontWeight: 600,
                color: accent,
                lineHeight: 1,
              }}
            >
              .{priceFrac}
            </span>
            <span
              style={{
                fontSize: 10.5,
                color: accent,
                marginLeft: 3,
                fontWeight: 500,
                letterSpacing: '0.04em',
              }}
            >
              lei
            </span>
          </div>
        </div>
        {product.description && (
          <div
            style={{
              fontFamily: theme.fonts.heading,
              fontStyle: 'italic',
              fontSize: 12.5,
              color: PUB.text2,
              lineHeight: 1.4,
              fontWeight: 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {product.description}
          </div>
        )}
        {(tags.length > 0 || isSoldOut) && (
          <div
            style={{
              display: 'flex',
              gap: 5,
              flexWrap: 'wrap',
              marginTop: 3,
              alignItems: 'center',
            }}
          >
            {tags.map((tagId) => (
              <TagBadge key={tagId} tagId={tagId} />
            ))}
            {isSoldOut && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: '#c0392b',
                  padding: '3px 8px',
                  borderRadius: 100,
                  border: '1px solid #c0392b55',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                Epuizat
              </span>
            )}
          </div>
        )}
      </div>

      {pickupEnabled && !isSoldOut && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (hasRequiredMods) onOpen()
            else onQuickAdd()
          }}
          aria-label={`Adaugă ${product.name}`}
          style={{
            alignSelf: 'center',
            flexShrink: 0,
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
            fontSize: 20,
            lineHeight: 1,
            paddingBottom: 2,
            boxShadow: `0 2px 8px ${accent}55`,
          }}
        >
          +
        </button>
      )}
    </div>
  )
}

function TagBadge({ tagId }: { tagId: string }) {
  const tag = DIETARY_TAGS.find((t) => t.id === tagId)
  if (!tag) return null
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 600,
        color: tag.color,
        padding: '3px 8px',
        borderRadius: 100,
        border: `1px solid ${tag.color}55`,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <span style={{ fontSize: 10 }}>{tag.emoji}</span>
      {tag.label}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════
// EMPTY STATE — afișat când filtered.length === 0
// ═══════════════════════════════════════════════════════════════
interface EmptyProps {
  lang: string
  theme: MenuTheme
  PUB: { text: string; text2: string; border: string }
  accent: string
  onClear: () => void
}

function EmptyState({ lang, theme, PUB, accent, onClear }: EmptyProps) {
  return (
    <div
      style={{
        padding: '40px 20px',
        textAlign: 'center',
        border: `1px dashed ${PUB.border}`,
        borderRadius: 12,
        marginTop: 20,
      }}
    >
      <div
        style={{
          fontFamily: theme.fonts.heading,
          fontStyle: 'italic',
          fontSize: 18,
          color: PUB.text,
          marginBottom: 8,
        }}
      >
        {T(lang, 'no_results')}
      </div>
      <button
        onClick={onClear}
        type="button"
        style={{
          background: 'none',
          border: 'none',
          color: accent,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: theme.fonts.body,
          textDecoration: 'underline',
          marginTop: 4,
        }}
      >
        {T(lang, 'clear_filters')}
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// FOOTER BRAND — name italic + 3 row info + MENIU BY MENUVIA
// ═══════════════════════════════════════════════════════════════
interface FooterProps {
  restaurant: Restaurant
  theme: MenuTheme
  accent: string
  PUB: { text: string; text2: string; text3: string; border: string }
  lang: string
}

function FooterBrand({ restaurant, theme, accent, PUB, lang }: FooterProps) {
  const instagram = restaurant.socials?.instagram
  return (
    <div
      data-testid="footer-brand"
      style={{
        marginTop: 60,
        paddingTop: 40,
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)',
        borderTop: `1px solid ${PUB.border}`,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div
        style={{
          fontFamily: theme.fonts.heading,
          fontStyle: 'italic',
          fontSize: 32,
          fontWeight: 500,
          color: PUB.text,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {restaurant.name}
      </div>
      {restaurant.tagline && (
        <div
          style={{
            fontFamily: theme.fonts.heading,
            fontStyle: 'italic',
            fontSize: 13,
            color: PUB.text2,
            fontWeight: 400,
          }}
        >
          {restaurant.tagline}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          marginTop: 8,
          fontSize: 12.5,
          color: PUB.text2,
        }}
      >
        {restaurant.address && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
            <IconMapPin size={13} color={accent} /> {restaurant.address}
          </div>
        )}
        {restaurant.hours && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
            <IconClock size={13} color={accent} /> {restaurant.hours}
          </div>
        )}
        {instagram && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
            <IconInstagram size={13} color={accent} /> {instagram}
          </div>
        )}
      </div>
      <div
        style={{
          marginTop: 24,
          fontSize: 9.5,
          color: PUB.text3,
          letterSpacing: '0.18em',
          fontWeight: 600,
        }}
      >
        {T(lang, 'menu_by')}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PICKUP CHECKOUT (existing)
// ═══════════════════════════════════════════════════════════════

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

// ─────────────────────────────────────────────────────────────
// PublicMenuPage — Public restaurant menu (NO QR scan needed)
//
// Two modes:
//   • View only — when pickup is disabled (just browse menu)
//   • Order for pickup — when pickup_settings.enabled = true
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useRef, useDeferredValue, lazy, Suspense } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import { useInView, revealStyle } from '../lib/motion'
import {
  fetchRestaurantBySlug,
  fetchMenuForRestaurant,
  fetchActiveHappyHour,
  happyHourPercentForProduct,
  computeIsOpen,
  todayHoursLabel,
} from '../lib/qr'
import type { HappyHourRule } from '../lib/qr'
import type { Restaurant, Category, Product } from '../lib/qr'
import type { CartItem } from '../lib/orders'
import { resolveTheme, isDarkTheme } from '../lib/themes'

import { DIETARY_TAGS, T } from '../lib/constants'
import { supabase } from '../lib/supabase'
import type { MenuTheme } from '../lib/themes'
import {
  IconBag,
  IconCalendar,
  IconMapPin,
  IconClock,
  IconWifi,
  IconLeaf,
  IconInstagram,
  IconTikTok,
  IconFacebook,
  IconGlobe,
  IconSearch,
} from '../components/icons/MenuIcons'
import { Icon } from '../components/ui/Icon'
// Componente comune de meniu (Lot A): stări premium + bară categorii unificată
import { MenuLoading, MenuError } from '../components/menu/MenuStates'
import { CategoryTabs } from '../components/menu/CategoryTabs'

// Lazy-load modalele grele — nu fac parte din bundle-ul inițial
const ProductSheet = lazy(() => import('../components/ProductSheet'))
const ReservationSheet = lazy(() => import('../components/ReservationSheet'))
const PickupCheckoutSheet = lazy(() => import('../components/PickupCheckoutSheet'))

interface Props {
  slug: string
  onBack: () => void
}

export default function PublicMenuPage({ slug, onBack }: Props) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [happyHour, setHappyHour] = useState<HappyHourRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCat, setActiveCat] = useState<string>('all')
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const [showPickup, setShowPickup] = useState(false)
  const [showReservation, setShowReservation] = useState(false)
  const [reservationsModuleEnabled, setReservationsModuleEnabled] = useState<boolean | null>(null)
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

  // „Lista mea" — meniu digital (fără comenzi/pickup): coșul devine o listă LOCALĂ
  // pe care NU o trimiți nicăieri, doar confort ca să ții minte ce vrei să iei.
  // Persistată în localStorage per restaurant, ca să supraviețuiască refresh-ului.
  const listMode = restaurant != null && !pickupEnabled
  const listKey = restaurant ? `menuvia.lista.${restaurant.slug}` : null
  // Sărim PRIMA salvare după hidratare ca să nu suprascriem lista salvată cu [] gol
  // în același commit (load programează setCart, dar closure-ul de save are cart vechi).
  const skipNextSaveRef = useRef(false)

  useEffect(() => {
    if (!listMode || !listKey) return
    try {
      const raw = localStorage.getItem(listKey)
      if (raw) {
        const saved = JSON.parse(raw) as CartItem[]
        if (Array.isArray(saved) && saved.length > 0) {
          skipNextSaveRef.current = true
          setCart(saved)
        }
      }
    } catch {
      /* localStorage indisponibil / JSON corupt → ignorăm */
    }
    // doar la (re)montare per restaurant
  }, [listMode, listKey])

  useEffect(() => {
    if (!listMode || !listKey) return
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    try {
      localStorage.setItem(listKey, JSON.stringify(cart))
    } catch {
      /* quota / indisponibil → ignorăm */
    }
  }, [cart, listMode, listKey])

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
      const rid = (r as { id: string }).id
      const cats = await fetchMenuForRestaurant(rid)
      setCategories(cats)
      setLoading(false)
      // Happy Hour — non-blocking
      void fetchActiveHappyHour(rid)
        .then(setHappyHour)
        .catch(() => {})
    } catch (err) {
      console.error('[PublicMenuPage] load error:', err)
      setError('Conexiune eșuată. Verifică internetul și încearcă din nou.')
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMenu()
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Gate D: încarcă starea modulului 'reservations' separat (non-blocking).
  // RLS permite SELECT public pe restaurant_modules.
  useEffect(() => {
    if (!restaurant?.id) return
    let cancelled = false
    // Tri-state: null = necunoscut/lipsă rând/eroare (→ fallback la amenity
    // legacy), true/false = toggle explicit din restaurant_modules.
    setReservationsModuleEnabled(null)
    void supabase
      .from('restaurant_modules')
      .select('enabled')
      .eq('restaurant_id', restaurant.id)
      .eq('module_key', 'reservations')
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setReservationsModuleEnabled(null)
          return
        }
        setReservationsModuleEnabled(data ? data.enabled : null)
      })
    return () => {
      cancelled = true
    }
  }, [restaurant?.id])

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

  // Stare de încărcare: schelet de listă premium (theme-aware) în loc de un
  // simplu „Se încarcă..." — percepție de viteză + zero salt de layout.
  if (loading) return <MenuLoading PUB={PUB} />

  // Eroare / restaurant negăsit: ecran premium cu icon + mesaj + reîncercare.
  if (error || !restaurant)
    return (
      <MenuError
        PUB={PUB}
        accent={accent}
        fonts={theme.fonts}
        onRetry={() => void loadMenu()}
        title={error ? 'Nu am putut încărca meniul' : 'Restaurant negăsit'}
        message={error ?? 'Verifică linkul sau încearcă din nou.'}
      />
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
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Icon name="arrowLeft" size={15} color="#fff" /> {T(lang, 'back')}
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

      {/* Gate D: CTA vizibil doar când modulul Rezervări e activat server-side.
          Backward compat: dacă amenity 'reservations' bifat, păstrăm legacy
          behavior până când admin-ul folosește toggle-ul nou. */}
      {(reservationsModuleEnabled ?? restaurant.amenities?.includes('reservations')) && (
        <div style={{ padding: '14px 20px 0' }}>
          <button
            data-testid="reserve-cta"
            onClick={() => setShowReservation(true)}
            style={{
              width: '100%',
              padding: '14px 16px',
              background: accent + '12',
              border: `1.5px solid ${accent}44`,
              borderRadius: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              fontFamily: theme.fonts.body,
              textAlign: 'left',
              color: PUB.text,
            }}
          >
            <IconCalendar size={22} color={accent} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: PUB.text }}>
                {T(lang, 'reserve_cta')}
              </div>
              <div style={{ fontSize: 12, color: PUB.text2 }}>{T(lang, 'reserve_trust')}</div>
            </div>
            <Icon name="chevronRight" size={18} color={accent} />
          </button>
        </div>
      )}

      {/* BARĂ CATEGORII — componentă comună: sticky, auto-center pe tabul activ,
          underline animat, badge-uri count per categorie, role=tablist (a11y). */}
      <CategoryTabs
        items={[
          { id: 'all', name: T(lang, 'all_categories'), count: allProducts.length },
          ...categories.map((c) => ({ id: c.id, name: c.name, count: c.products.length })),
        ]}
        activeId={activeCat}
        onSelect={setActiveCat}
        accent={accent}
        PUB={PUB}
        theme={theme}
      />

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
        {happyHour.length > 0 && (
          <div
            style={{
              padding: '10px 14px',
              background: 'linear-gradient(90deg, #2e7d32, #43a047)',
              borderRadius: 12,
              color: '#fff',
              fontFamily: theme.fonts.body,
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <Icon name="sparkle" size={16} color="#fff" />
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
        {filteredByCat.map(({ cat, products }, sectionIdx) => (
          <RevealItem
            key={cat?.id ?? 'flat'}
            // Stagger mic și plafonat — primele secțiuni primesc un delay
            // ușor, restul intră fără întârziere ca să nu animăm un meniu lung.
            delay={Math.min(sectionIdx, 3) * 50}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
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
                    // Butonul rapid „+" apare și pentru pickup, și pentru „Lista mea"
                    // (meniu digital) — în ambele cazuri adaugă în coșul/lista locală.
                    pickupEnabled={pickupEnabled || listMode}
                    happyHourPct={happyHourPercentForProduct(product, happyHour)}
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
          </RevealItem>
        ))}

        {/* FOOTER brand */}
        <FooterBrand restaurant={restaurant} theme={theme} accent={accent} PUB={PUB} lang={lang} />
      </div>

      {/* Bară sticky — coș (pickup) sau „Lista mea" (meniu digital). Pentru „Lista
          mea" e PERSISTENTĂ (chiar goală), ca să fie descoperită din prima. Pentru
          pickup apare doar când ai produse. */}
      {((listMode || cart.length > 0) && !showCart) && (
        <button
          onClick={() => setShowCart(true)}
          aria-label={listMode ? 'Lista mea' : 'Vezi coșul'}
          style={{
            position: 'fixed',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 480,
            width: '100%',
            padding: '14px 20px',
            background: cart.length > 0 ? accent : PUB.surface,
            color: cart.length > 0 ? '#fff' : PUB.text,
            border: cart.length > 0 ? 'none' : `1px solid ${PUB.borderStrong}`,
            cursor: 'pointer',
            fontFamily: theme.fonts.body,
            fontSize: 15,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: cart.length > 0 ? 'space-between' : 'center',
            gap: 10,
            boxShadow: cart.length > 0 ? `0 -4px 20px ${accent}55` : 'none',
          }}
        >
          {cart.length > 0 ? (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <IconBag size={16} color="#fff" /> {cartCount}{' '}
                {cartCount === 1 ? 'produs' : 'produse'} {listMode ? 'în lista mea' : 'în coș'}
              </span>
              <span style={{ fontFamily: theme.fonts.heading }}>{cartTotal.toFixed(2)} lei →</span>
            </>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: PUB.text2 }}>
              <IconBag size={16} color={PUB.text2} /> Lista mea · atinge un produs ca să adaugi
            </span>
          )}
        </button>
      )}

      {/* Product sheet */}
      {activeProduct != null && (
        <Suspense fallback={null}>
          <ProductSheet
            product={activeProduct}
            accent={accent}
            theme={theme}
            onAdd={addToCart}
            onClose={() => setActiveProduct(null)}
          />
        </Suspense>
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
                {listMode ? 'Lista mea' : 'Comanda ta'}
              </div>
              {listMode && (
                <div style={{ fontSize: 13, color: PUB.text2, marginTop: -8, marginBottom: 14 }}>
                  Ce vrei să iei — salvat pe telefonul tău. Arată-i ospătarului când comanzi.
                </div>
              )}
              {cart.length === 0 && (
                <div style={{ fontSize: 14, color: PUB.text3, padding: '18px 0', textAlign: 'center', lineHeight: 1.5 }}>
                  Lista e goală. Atinge un produs din meniu ca să-l adaugi aici.
                </div>
              )}
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
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 44,
                        minHeight: 44,
                      }}
                    >
                      <Icon name="close" size={16} color={PUB.text3} />
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
              {listMode ? (
                // „Lista mea" nu se trimite nicăieri — o poți goli sau închide.
                <button
                  onClick={() => {
                    if (cart.length > 0) setCart([])
                    setShowCart(false)
                  }}
                  style={{
                    width: '100%',
                    padding: '15px',
                    background: 'transparent',
                    color: PUB.text2,
                    border: `1px solid ${PUB.borderStrong}`,
                    borderRadius: 12,
                    fontFamily: theme.fonts.body,
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {cart.length > 0 ? 'Golește lista' : 'Închide'}
                </button>
              ) : (
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
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pickup checkout sheet */}
      {showPickup && restaurant.pickup_settings != null && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {/* Reservation sheet */}
      {showReservation && (
        <Suspense fallback={null}>
          <ReservationSheet
            restaurant={restaurant}
            theme={theme}
            accent={accent}
            PUB={PUB}
            lang={lang}
            onClose={() => setShowReservation(false)}
          />
        </Suspense>
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
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: accent + '18',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
              }}
            >
              <Icon name="check" size={32} color={accent} />
            </div>
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
// REVEAL ITEM — wrapper care apelează useInView intern (hooks NU pot
// rula în .map()) și aplică revealStyle. Sub reduced-motion/headless
// useInView întoarce true din start → conținutul rămâne vizibil.
// ═══════════════════════════════════════════════════════════════
function RevealItem({
  children,
  delay = 0,
  y = 12,
}: {
  children: ReactNode
  delay?: number
  y?: number
}) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} style={revealStyle(inView, { delay, y })}>
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// BLUR IMAGE — thumbnail cu blur-up. Pornește blurat, devine clar la
// `onLoad` adăugând clasa `.is-loaded` (vezi utilitarele globale).
// ═══════════════════════════════════════════════════════════════
function BlurImage({
  src,
  alt,
  style,
}: {
  src: string
  alt: string
  style?: CSSProperties
}) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="blur-up"
      // Imaginile din cache pot fi deja `complete` la montare (fără event
      // `load`) — ref callback-ul le marchează imediat ca încărcate.
      ref={(el) => {
        if (el?.complete) el.classList.add('is-loaded')
      }}
      onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
      style={style}
    />
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
  const tiktok = restaurant.socials?.tiktok
  const facebook = restaurant.socials?.facebook
  const website = restaurant.socials?.website

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
        backgroundImage: restaurant.cover_url ? `url(${restaurant.cover_url})` : accentGradient,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '0 20px calc(env(safe-area-inset-bottom, 0px) + 24px)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
      }}
    >
      {/* Scrim întărit — garantează lizibilitatea textului alb peste ORICE
          cover (inclusiv poze deschise care altfel ar spăla albul). Două
          straturi: un wash vertical + o concentrare suplimentară jos. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.30) 38%, rgba(0,0,0,0.62) 78%, rgba(0,0,0,0.82) 100%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '45%',
          background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 100%)',
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
            textShadow: '0 1px 2px rgba(0,0,0,0.5), 0 2px 18px rgba(0,0,0,0.45)',
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
              color: 'rgba(255,255,255,0.88)',
              marginTop: 6,
              fontWeight: 400,
              textShadow: '0 1px 8px rgba(0,0,0,0.5)',
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
            <SocialPill isDark={isDark} href={socialUrl('instagram', instagram)}>
              <IconInstagram /> {'@' + socialHandle(instagram)}
            </SocialPill>
          )}
          {tiktok && (
            <SocialPill isDark={isDark} href={socialUrl('tiktok', tiktok)}>
              <IconTikTok /> {'@' + socialHandle(tiktok)}
            </SocialPill>
          )}
          {facebook && (
            <SocialPill isDark={isDark} href={socialUrl('facebook', facebook)}>
              <IconFacebook /> Facebook
            </SocialPill>
          )}
          {website && (
            <SocialPill isDark={isDark} href={socialUrl('website', website)}>
              <IconGlobe /> Website
            </SocialPill>
          )}
        </div>
      </div>
    </div>
  )
}

// Construiește URL absolut pentru un canal social din handle sau URL brut.
// Dacă valoarea e deja un URL complet, o folosește ca atare.
function socialUrl(
  platform: 'instagram' | 'tiktok' | 'facebook' | 'website',
  value: string,
): string {
  const v = value.trim()
  if (/^https?:\/\//i.test(v)) return v
  const handle = v.replace(/^@/, '')
  switch (platform) {
    case 'instagram':
      return `https://instagram.com/${handle}`
    case 'tiktok':
      return `https://tiktok.com/@${handle}`
    case 'facebook':
      return `https://facebook.com/${handle}`
    case 'website':
      return `https://${handle}`
  }
}

// Extrage handle-ul curat (fără URL, fără @) pentru afișare în text.
function socialHandle(value: string): string {
  const v = value.trim()
  if (/^https?:\/\//i.test(v)) {
    try {
      // URL.pathname elimină query (?...) și hash (#...) automat.
      const pathname = new URL(v).pathname.replace(/\/+$/, '')
      const parts = pathname.split('/').filter(Boolean)
      return (parts[parts.length - 1] ?? '').replace(/^@/, '')
    } catch {
      return v.replace(/^@/, '').replace(/\/+$/, '')
    }
  }
  return v.replace(/^@/, '').replace(/\/+$/, '')
}

// Versiunea clickable a InfoPill: render <a> cu același styling.
function SocialPill({
  children,
  isDark,
  href,
}: {
  children: ReactNode
  isDark: boolean
  href: string
}) {
  return (
    <a
      data-testid="social-pill"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
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
        textDecoration: 'none',
      }}
    >
      {children}
    </a>
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

// Bara de categorii a fost mutată în componenta comună `CategoryTabs`
// (src/components/menu/CategoryTabs.tsx) — sticky, underline animat,
// auto-center, badge-uri count și role=tablist. Vechiul `TabButton` local
// a fost eliminat ca să nu existe două stiluri divergente de tab.

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
            className="pressable"
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
              transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease',
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
  happyHourPct?: number
  onOpen: () => void
  onQuickAdd: () => void
}

function ProductCardEditorial({
  product,
  accent,
  theme,
  PUB,
  pickupEnabled,
  happyHourPct = 0,
  onOpen,
  onQuickAdd,
}: CardProps) {
  const hasRequiredMods = product.modifier_groups?.some((g) => g.is_required) ?? false
  const tags = (product.dietary_tags ?? []).slice(0, 3)
  const isSoldOut = product.is_sold_out
  const effectivePrice = happyHourPct > 0 ? product.price * (1 - happyHourPct / 100) : product.price
  const priceInt = Math.floor(effectivePrice)
  const priceFrac = (effectivePrice - priceInt).toFixed(2).slice(2) // "50" pentru 32.50

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
        <BlurImage
          src={product.image_url}
          alt={product.name}
          style={{
            width: 92,
            height: 92,
            objectFit: 'cover',
            borderRadius: 10,
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
            {happyHourPct > 0 && (
              <span
                style={{
                  fontFamily: theme.fonts.heading,
                  fontSize: 13,
                  fontWeight: 600,
                  color: PUB.text3,
                  textDecoration: 'line-through',
                  marginRight: 4,
                  lineHeight: 1,
                }}
              >
                {product.price.toFixed(2)}
              </span>
            )}
            <span
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: 20,
                fontWeight: 700,
                color: happyHourPct > 0 ? '#2e7d32' : accent,
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
                color: happyHourPct > 0 ? '#2e7d32' : accent,
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
          type="button"
          className="pressable"
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
  const tiktok = restaurant.socials?.tiktok
  const facebook = restaurant.socials?.facebook
  const website = restaurant.socials?.website
  const socialLinkStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    color: 'inherit',
    textDecoration: 'none',
  }
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
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              justifyContent: 'center',
            }}
          >
            <IconMapPin size={13} color={accent} /> {restaurant.address}
          </div>
        )}
        {restaurant.hours && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              justifyContent: 'center',
            }}
          >
            <IconClock size={13} color={accent} /> {restaurant.hours}
          </div>
        )}
        {instagram && (
          <a
            href={socialUrl('instagram', instagram)}
            target="_blank"
            rel="noopener noreferrer"
            style={socialLinkStyle}
          >
            <IconInstagram size={13} color={accent} /> {'@' + socialHandle(instagram)}
          </a>
        )}
        {tiktok && (
          <a
            href={socialUrl('tiktok', tiktok)}
            target="_blank"
            rel="noopener noreferrer"
            style={socialLinkStyle}
          >
            <IconTikTok size={13} color={accent} /> {'@' + socialHandle(tiktok)}
          </a>
        )}
        {facebook && (
          <a
            href={socialUrl('facebook', facebook)}
            target="_blank"
            rel="noopener noreferrer"
            style={socialLinkStyle}
          >
            <IconFacebook size={13} color={accent} /> Facebook
          </a>
        )}
        {website && (
          <a
            href={socialUrl('website', website)}
            target="_blank"
            rel="noopener noreferrer"
            style={socialLinkStyle}
          >
            <IconGlobe size={13} color={accent} /> {website.replace(/^https?:\/\//i, '')}
          </a>
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

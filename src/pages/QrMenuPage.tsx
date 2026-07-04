// =============================================================
// Menuvia — src/pages/QrMenuPage.tsx
// Customer QR ordering page. Anon. Light theme. No `any`.
// Mobile-first, max-width 480px.
// =============================================================

import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue, lazy, Suspense } from 'react'
import {
  resolveQrToken,
  fetchMenuForRestaurant,
  fetchActiveHappyHour,
  happyHourPercentForProduct,
  openTableSession,
  hasMandatoryModifierGroups,
  type HappyHourRule,
} from '../lib/qr'
import { createOrder } from '../lib/orders'
import { T } from '../lib/constants'
import { trName, trDesc, availableMenuLangs, detectBrowserLang, normalizeMenuSearch } from '../lib/i18nMenu'
import type { ResolvedQrToken, Category, Product } from '../lib/qr'
import type { CartItem, OrderConfirmationPayload } from '../lib/orders'
import { callWaiter } from '../lib/orders'

import ProductSheet from '../components/ProductSheet'
import {
  resolveTheme,
  resolveMenuLayout,
  resolveFlipbookPages,
  readableTextOn,
} from '../lib/themes'
import { OrderTracker, ActiveOrdersBanner } from '../components/OrderTracker'
import { Icon } from '../components/ui/Icon'
// Componente comune de meniu (Lot A) — același limbaj vizual ca meniul digital.
import { CategoryTabs } from '../components/menu/CategoryTabs'
import ProductCard from '../components/menu/ProductCard'
import ProductGridCard from '../components/menu/ProductGridCard'
import ProductMinimalRow from '../components/menu/ProductMinimalRow'
import ProductPhotoCard from '../components/menu/ProductPhotoCard'
import FlipbookViewer from '../components/menu/FlipbookViewer'
import MenuHeader from '../components/menu/MenuHeader'
import { MenuLoading, MenuError, MenuCatalogEmpty } from '../components/menu/MenuStates'

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
// Rotește cheia de idempotență: generează una nouă ȘI o scrie imediat în
// sessionStorage (aceeași cheie de storage folosită la citirea inițială din
// getIdempotencyKey). Dacă am scrie doar în state React, un refresh de pagină
// exact în timpul unei comenzi noi ar regenera cheia din citirea inițială
// (care ar recrea una veche/inexistentă), riscând submit duplicat.
function rotateIdempotencyKey(token: string): string {
  const key = crypto.randomUUID()
  sessionStorage.setItem('menuvia_idem:' + token, key)
  return key
}

interface Props {
  token: string
}

// ── QrMenuPage ────────────────────────────────────────────────

export default function QrMenuPage({ token }: Props) {
  const [ctx, setCtx] = useState<ResolvedQrToken | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  // Limba activă a meniului ('ro' = originalul din name/description).
  const [lang, setLang] = useState('ro')
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
  const [requestingBill, setRequestingBill] = useState(false)
  const [billRequested, setBillRequested] = useState(false)
  const [search, setSearch] = useState('')
  // Focus vizibil pentru input-ul de căutare (fără :focus în inline styles).
  const [searchFocused, setSearchFocused] = useState(false)
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
          .catch((err) => {
            // Loghează — submit-ul mai are un retry înainte de createOrder.
            console.warn('[QrMenuPage] openTableSession failed:', err)
          })
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
    // Extras se adună per-unitate, apoi se multiplică cu quantity — la fel ca
    // serverul (mig 088: v_item_total = (unit + options + extras) * qty).
    const ex = (item.selected_extras ?? []).reduce((s, e) => s + e.price, 0)
    return (item.unit_price_snapshot + md + ex) * item.quantity
  }

  const cartTotal = cart.reduce((s, i) => s + lineTotal(i), 0)

  async function handleSubmit(): Promise<void> {
    if (ctx == null) return
    setSubmitting(true)
    setSubmitError(null)

    // Retry up to 2 times on network failures (common on 4G in restaurants).
    // (Re)deschiderea sesiunii de masă e ÎN buclă: dacă a eșuat la scanare, un
    // blip tranzitoriu la openTableSession beneficiază de aceleași backoff-uri
    // ca create_order (altfel Gate B ar respinge cu eroare criptică, o dată).
    let activeSessionId = sessionId
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (activeSessionId == null) {
          const sess = await openTableSession(ctx.token.token)
          activeSessionId = sess.session_id
          setSessionId(sess.session_id)
        }
        const result = await createOrder({
          restaurant_id: ctx.restaurant.id,
          source: 'qr',
          table_id: ctx.table.id,
          qr_token_id: ctx.token.id,
          notes: notes.length > 0 ? notes : null,
          cart,
          idempotency_key: idempotencyKey,
          session_id: activeSessionId,
        })
        // Rotim cheia de idempotență IMEDIAT după succes: dacă tab-ul se
        // reîncarcă (eviction pe mobil / back / refresh), sessionStorage
        // supraviețuiește iar un coș NOU cu aceeași cheie ar fi deduplicat
        // tăcut de server → confirmare veche, comandă pierdută. Retry-urile
        // acestei comenzi au folosit deja cheia veche în interiorul buclei.
        setIdempotencyKey(rotateIdempotencyKey(token))
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

  // „Cere nota" — același anti-spam ca la chemarea ospătarului (60s UI +
  // rate limit server-side per masă per tip, mig 091).
  async function handleRequestBill(): Promise<void> {
    if (!ctx || requestingBill || billRequested) return
    setRequestingBill(true)
    try {
      await callWaiter(ctx.token.id, 'bill')
      setBillRequested(true)
      setTimeout(() => setBillRequested(false), 60000)
    } catch (err) {
      console.error('[QrMenuPage] requestBill failed:', err)
    }
    setRequestingBill(false)
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
    setCart([])
    setNotes('')
    setConfirmation(null)
    setShowCart(false)
    setSubmitError(null)
    setSubmitting(false)
    // Rotește cheia ȘI în sessionStorage (nu doar în state) — vezi comentariul
    // de la rotateIdempotencyKey.
    setIdempotencyKey(rotateIdempotencyKey(token))
  }

  // ── Resolve theme from restaurant settings ──────────────────
  const theme = useMemo(() => resolveTheme(ctx?.restaurant.theme_settings), [ctx])
  // Memoizat: obiect nou la fiecare render înainte → prop instabil pentru
  // carduri/stări. Recalculat doar când se schimbă tema.
  const PUB = useMemo(
    () => ({
      bg: theme.colors.bg,
      surface: theme.colors.surface,
      text: theme.colors.text,
      text2: theme.colors.text2,
      text3: theme.colors.text3,
      border: theme.colors.border,
      borderStrong: theme.colors.borderStrong,
    }),
    [theme],
  )
  // Backward-compat: primary_color from old DB column → override accent if set
  const accent = ctx?.restaurant.primary_color ?? theme.colors.accent
  const accentGradient = theme.colors.accentGradient
  // `searchQuery` (imediat) rămâne pentru textul stărilor goale; filtrarea
  // rulează pe valoarea AMÂNATĂ ca să nu blocheze input-ul la fiecare tastă.
  const searchQuery = search.trim().toLowerCase()
  const deferredSearch = useDeferredValue(search)
  // Categorii localizate pentru AFIȘARE (tab-uri, liste, search). Pe 'ro'
  // întoarcem aceeași referință → memo stabil, zero re-render inutil. Doar
  // name/description sunt traduse; product_id rămâne identic (coșul nu se atinge).
  const localizedCategories = useMemo<Category[]>(() => {
    if (lang === 'ro') return categories
    return categories.map((c) => ({
      ...c,
      name: trName(c, lang),
      products: c.products.map((p) => ({
        ...p,
        name: trName(p, lang),
        description: trDesc(p, lang),
      })),
    }))
  }, [categories, lang])
  // Limbile extra oferite = cele în care meniul chiar e tradus (derivate din
  // conținut, nu dintr-un flag expus prin RPC). Switcher-ul apare doar dacă
  // există măcar o traducere reală.
  const availableLangs = useMemo(
    () => availableMenuLangs(categories, ctx?.restaurant.menu_languages),
    [categories, ctx?.restaurant.menu_languages],
  )
  // Auto-selectează limba browserului turistului DOAR dacă meniul e tradus în
  // ea și clientul n-a ales manual încă. Un client german vede meniul direct în
  // germană la scanare.
  const userPickedLangRef = useRef(false)
  const handleLangChange = useCallback((code: string) => {
    userPickedLangRef.current = true
    setLang(code)
  }, [])
  useEffect(() => {
    // Reset defensiv: limbă devenită indisponibilă (deselectată din setări) →
    // revenim la `ro` + redeschidem auto-detectul.
    if (lang !== 'ro' && !availableLangs.includes(lang)) {
      setLang('ro')
      userPickedLangRef.current = false
      return
    }
    if (userPickedLangRef.current || lang !== 'ro') return
    const detected = detectBrowserLang(availableLangs)
    if (detected) setLang(detected)
  }, [availableLangs, lang])
  // Index de căutare precalculat pe limba activă: haystack normalizat (fără
  // diacritice) per produs, recalculat doar la schimbarea meniului/limbii — nu
  // la fiecare tastă. Diacritic-insensitive ca pe meniul public (un client
  // care tastează „ciorba" găsește „Ciorbă").
  const searchIndex = useMemo(
    () =>
      localizedCategories
        .flatMap((c) => c.products ?? [])
        .map((p) => ({ product: p, hay: normalizeMenuSearch(p.name + ' ' + (p.description ?? '')) })),
    [localizedCategories],
  )
  // Search activ → căutăm în TOT meniul (toate categoriile), nu doar în cea
  // selectată — altfel clientul nu găsește produsul dacă e pe alt tab.
  const activeProducts = useMemo(() => {
    const q = normalizeMenuSearch(deferredSearch.trim())
    if (q.length > 0) return searchIndex.filter((e) => e.hay.includes(q)).map((e) => e.product)
    return localizedCategories.find((c) => c.id === activeCatId)?.products ?? []
  }, [searchIndex, localizedCategories, activeCatId, deferredSearch])
  // Total produse publicate (toate categoriile) — distinge „catalog gol"
  // (restaurantul n-a publicat nimic) de „categoria/căutarea nu are rezultate".
  const totalProducts = useMemo(
    () => categories.reduce((s, c) => s + (c.products?.length ?? 0), 0),
    [categories],
  )
  const orderingAllowed = ctx?.orderingAllowed ?? false
  const themeSettings = ctx?.restaurant.theme_settings
  // Layout ales de restaurant (listă / galerie / minimal / foto / flipbook) — implicit 'list'.
  // Memoizate pe theme_settings (ca în PublicMenuPage) — nu recalculăm la fiecare
  // re-render (tastă în search, add-to-cart, tick realtime).
  const menuLayout = useMemo(() => resolveMenuLayout(themeSettings), [themeSettings])
  // Paginile de flipbook validate (doar https, max 30) — [] dacă lipsesc.
  const flipbookPages = useMemo(() => resolveFlipbookPages(themeSettings), [themeSettings])
  // Flipbook fără pagini → fallback VIZIBIL pe 'list' (nu ecran gol).
  const effectiveLayout = menuLayout === 'flipbook' && flipbookPages.length === 0 ? 'list' : menuLayout
  // Pe flipbook DOAR catalogul e înlocuit: fără tab-uri/căutare/carduri și fără
  // bara „Comanda mea" (comanda din meniu nu e disponibilă pe acest stil).
  // Header-ul + „Cheamă ospătarul"/„Cere nota" rămân funcționale.
  const isFlipbook = effectiveLayout === 'flipbook'

  // Handlere de produs partajate între layout-uri (listă / galerie), ca să nu
  // duplicăm gate-ul de deschidere + quick-add-ul în fiecare ramură.
  const openProductQr = useCallback(
    (p: Product): void => {
      // Deschidem detaliile doar dacă se poate comanda (sold-out tratat intern de card).
      if (orderingAllowed) setActiveProduct(p)
    },
    [orderingAllowed],
  )
  const quickAddProductQr = useCallback(
    (p: Product): void =>
      // Quick-add: direct în coș (fără pairing popup — la fel ca butonul „+" vechi).
      setCart((prev) => [
        ...prev,
        {
          _key: crypto.randomUUID(),
          product_id: p.id,
          product_name_snapshot: p.name,
          unit_price_snapshot: p.price,
          quantity: 1,
          selected_modifiers: [],
          notes: null,
        },
      ]),
    [],
  )

  // Încărcare: schelet de listă premium (componentă comună), nu text gol.
  if (resolving) return <MenuLoading PUB={PUB} />

  // QR invalid: ecran de eroare premium fără reîncercare (QR-ul nu se „repară").
  if (invalid)
    return (
      <MenuError
        PUB={PUB}
        accent={accent}
        fonts={theme.fonts}
        title="Acest QR nu mai este activ"
        message="Te rugăm să ceri personalului un QR nou."
      />
    )

  // Eroare de rețea: același ecran premium, dar cu „Reîncearcă".
  if (networkError)
    return (
      <MenuError
        PUB={PUB}
        accent={accent}
        fonts={theme.fonts}
        onRetry={loadQr}
        title="Conexiune slabă"
        message="Nu s-a putut încărca meniul. Verifică internetul și încearcă din nou."
      />
    )

  if (confirmation != null) {
    return (
      <OrderTracker
        confirmation={confirmation}
        accent={accent}
        onReset={handleReset}
        previousOrders={previousOrders}
        sessionId={sessionId}
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
      {/* Header — componenta comună MenuHeader (compact + chrome 'plain' =
          look-ul istoric QR: logo/nume + badge masă, fără bandă pe surface).
          isOpen omis intenționat: pagina QR nu afișa pastila de status. */}
      <MenuHeader
        variant="compact"
        chrome="plain"
        restaurantName={ctx?.restaurant.name ?? ''}
        logoUrl={ctx?.restaurant.logo_url}
        badge={ctx?.table.name ?? 'Masă'}
        accent={accent}
        PUB={PUB}
        theme={theme}
        languages={availableLangs}
        activeLang={lang}
        onLangChange={handleLangChange}
      />

      {/* Active orders banner — shown when session has previous orders */}
      {previousOrders.length > 0 && orderingAllowed && !confirmation && (
        <div style={{ padding: '12px 16px 0' }}>
          <ActiveOrdersBanner
            orders={previousOrders}
            accent={accent}
            sessionId={sessionId}
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
            // Gradientul de accent al temei (același pattern ca hero-ul), nu un
            // verde hardcodat — textul alb e purtat de accentGradient peste tot.
            background: accentGradient,
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
          <span>{T(lang, 'happy_hour_active')}</span>
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
              {r.discount_type === 'percent' ? `-${r.discount_value}%` : `-${r.discount_value} lei`}
            </span>
          ))}
        </div>
      )}

      {/* Category tabs — componentă comună (parity cu meniul digital):
          sticky, auto-center pe activ, underline animat, counts, tablist a11y.
          Pe flipbook nu există catalog de produse → fără tab-uri și căutare. */}
      {!isFlipbook && (
        <CategoryTabs
          items={localizedCategories.map((cat) => ({
            id: cat.id,
            name: cat.name,
            count: cat.products?.length ?? 0,
          }))}
          activeId={activeCatId}
          onSelect={setActiveCatId}
          accent={accent}
          PUB={PUB}
          theme={theme}
        />
      )}

      {/* Search — sub tab-uri, peste tot meniul */}
      {!isFlipbook && (
        <div style={{ padding: '12px 16px 0' }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Caută în meniu..."
            aria-label="Caută în meniu"
            enterKeyHint="search"
            style={{
              width: '100%',
              background: PUB.surface,
              // Focus vizibil: bordură accent + halo subțire.
              border: `1px solid ${searchFocused ? accent : PUB.border}`,
              borderRadius: 12,
              padding: '11px 14px',
              fontSize: 15,
              color: PUB.text,
              fontFamily: theme.fonts.body,
              outline: 'none',
              boxShadow: searchFocused ? `0 0 0 3px ${accent}33` : 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {/* Product list — layout ales de restaurant (listă / galerie foto).
          Pe flipbook, DOAR catalogul e înlocuit de viewer — header-ul și
          butoanele de sesiune („Cheamă ospătarul"/„Cere nota") rămân. */}
      <div style={{ flex: 1, padding: '14px 16px 120px' }}>
        {isFlipbook && <FlipbookViewer pages={flipbookPages} theme={theme} PUB={PUB} />}
        {/* Empty states: catalog gol (nimic publicat) vs. căutare/categorie fără rezultate */}
        {!isFlipbook &&
          activeProducts.length === 0 &&
          (totalProducts === 0 ? (
            // Restaurantul n-a publicat încă produse — stare dedicată, comună
            // cu meniul digital (fără buton de golire: nu există filtre).
            <MenuCatalogEmpty PUB={PUB} fonts={theme.fonts} />
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: PUB.text2 }}>
              <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}>
                <Icon name={searchQuery ? 'search' : 'utensils'} size={36} color={PUB.text3} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: PUB.text, marginBottom: 6 }}>
                {searchQuery
                  ? `Niciun produs găsit pentru „${search.trim()}"`
                  : 'Momentan meniul nu este disponibil.'}
              </div>
              <div style={{ fontSize: 13 }}>
                {searchQuery ? 'Încearcă alt cuvânt.' : 'Te rugăm să întrebi personalul.'}
              </div>
            </div>
          ))}
        {isFlipbook ? null : effectiveLayout === 'grid' ? (
          // Galerie foto: grid 2 coloane cu carduri foto-forward.
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}
          >
            {activeProducts.map((product) => (
              <ProductGridCard
                key={product.id}
                product={product}
                accent={accent}
                PUB={PUB}
                theme={theme}
                canAdd={orderingAllowed}
                happyHourPct={happyHourPercentForProduct(product, happyHour)}
                onOpen={openProductQr}
                onQuickAdd={quickAddProductQr}
              />
            ))}
          </div>
        ) : effectiveLayout === 'photo' ? (
          // Foto-first: poze mari full-width cu nume/preț PE poză; produsele
          // fără poză cad pe rând compact (în ProductPhotoCard).
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {activeProducts.map((product) => (
              <ProductPhotoCard
                key={product.id}
                product={product}
                accent={accent}
                PUB={PUB}
                theme={theme}
                canAdd={orderingAllowed}
                happyHourPct={happyHourPercentForProduct(product, happyHour)}
                onOpen={openProductQr}
                onQuickAdd={quickAddProductQr}
              />
            ))}
          </div>
        ) : effectiveLayout === 'minimal' ? (
          // Minimal: rânduri text fără poză, aer editorial.
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activeProducts.map((product) => (
              <ProductMinimalRow
                key={product.id}
                product={product}
                accent={accent}
                PUB={PUB}
                theme={theme}
                canAdd={orderingAllowed}
                happyHourPct={happyHourPercentForProduct(product, happyHour)}
                onOpen={openProductQr}
                onQuickAdd={quickAddProductQr}
              />
            ))}
          </div>
        ) : (
          // Listă (implicit): card unificat cu poză mică + text.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {activeProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                accent={accent}
                PUB={PUB}
                theme={theme}
                canAdd={orderingAllowed}
                happyHourPct={happyHourPercentForProduct(product, happyHour)}
                onOpen={openProductQr}
                onQuickAdd={quickAddProductQr}
              />
            ))}
          </div>
        )}
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
            // Fundal derivat din temă (PUB.text = suprafață neutră de contrast),
            // nu maro hardcodat; verdele rămâne DOAR ca semnal de succes.
            background: waiterCalled ? '#4CAF6E' : PUB.text,
            color: waiterCalled ? '#fff' : readableTextOn(PUB.text, PUB.bg),
            border: 'none',
            borderRadius: 30,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: callingWaiter || waiterCalled ? 'default' : 'pointer',
            fontFamily: theme.fonts.body,
            zIndex: 49,
            boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
            opacity: callingWaiter ? 0.7 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <Icon
            name={waiterCalled ? 'check' : 'bell'}
            size={16}
            color={waiterCalled ? '#fff' : readableTextOn(PUB.text, PUB.bg)}
          />
          {waiterCalled
            ? 'Am anunțat ospătarul'
            : callingWaiter
              ? 'Se cheamă...'
              : 'Cheamă ospătarul'}
        </button>
      )}
      {ctx && orderingAllowed && !confirmation && (
        <button
          onClick={() => {
            void handleRequestBill()
          }}
          disabled={requestingBill || billRequested}
          style={{
            position: 'fixed',
            bottom: cart.length > 0 ? 90 : 20,
            right: 16,
            // Fundal derivat din temă (vezi butonul „Cheamă ospătarul").
            background: billRequested ? '#4CAF6E' : PUB.text,
            color: billRequested ? '#fff' : readableTextOn(PUB.text, PUB.bg),
            border: 'none',
            borderRadius: 30,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: requestingBill || billRequested ? 'default' : 'pointer',
            fontFamily: theme.fonts.body,
            zIndex: 49,
            boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
            opacity: requestingBill ? 0.7 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <Icon
            name={billRequested ? 'check' : 'receipt'}
            size={16}
            color={billRequested ? '#fff' : readableTextOn(PUB.text, PUB.bg)}
          />
          {billRequested
            ? 'Nota e pe drum'
            : requestingBill
              ? 'Se trimite...'
              : 'Cere nota'}
        </button>
      )}

      {/* Bară „Comanda mea" — PERSISTENTĂ când comanda e permisă (chiar cu coș gol),
          ca să fie clar din prima că se poate comanda; cu produse devine bara cu total.
          Pe flipbook nu există carduri de adăugat → comanda din meniu nu e disponibilă
          pe acest stil (chemarea ospătarului rămâne prin butoanele de mai sus). */}
      {orderingAllowed && !isFlipbook && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '100%',
            maxWidth: 480,
            // Safe-area jos pe iPhone cu home indicator (index.html are deja
            // viewport-fit=cover, deci env() e activ).
            padding: '12px 16px',
            paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
            background: PUB.bg,
            borderTop: `1px solid ${PUB.borderStrong}`,
            zIndex: 50,
          }}
        >
          <button
            onClick={() => setShowCart(true)}
            aria-label="Comanda mea"
            style={{
              background: cart.length > 0 ? accent : PUB.surface,
              color: cart.length > 0 ? '#fff' : PUB.text,
              border: cart.length > 0 ? 'none' : `1px solid ${PUB.borderStrong}`,
              borderRadius: 12,
              padding: '14px 20px',
              width: '100%',
              fontFamily: theme.fonts.body,
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: cart.length > 0 ? 'space-between' : 'center',
              gap: 10,
            }}
          >
            {cart.length > 0 ? (
              <>
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
                <span>Vezi comanda</span>
                <span>{cartTotal.toFixed(2)} lei</span>
              </>
            ) : (
              <span style={{ color: PUB.text2, fontWeight: 600 }}>
                Comanda mea · atinge un produs ca să începi
              </span>
            )}
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
          className="animate-backdrop"
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
            className="animate-sheet"
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
              <Icon name="check" size={18} color="#4CAF6E" />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#4CAF6E',
                  fontFamily: theme.fonts.body,
                }}
              >
                {pairingPopup.sourceProduct.name} adăugat
              </span>
            </div>

            <div
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: 19,
                fontWeight: 600,
                color: PUB.text,
                letterSpacing: '-0.01em',
                lineHeight: 1.3,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="sparkle" size={18} color={accent} />
              Merge perfect cu...
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
                    background: PUB.surface,
                    border: `1px solid ${PUB.border}`,
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
                    // Fără poză → monogramă (inițiala) pe gradientul temei (ca în ProductGridCard).
                    <div
                      aria-hidden
                      style={{
                        width: '100%',
                        aspectRatio: '1/1',
                        borderRadius: 8,
                        background: accentGradient,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: theme.fonts.heading,
                          fontSize: 40,
                          fontWeight: 600,
                          color: PUB.text,
                          opacity: 0.4,
                          lineHeight: 1,
                        }}
                      >
                        {(p.name.trim().charAt(0) || '•').toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div
                    style={{
                      fontFamily: theme.fonts.heading,
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
                        fontFamily: theme.fonts.heading,
                        fontSize: 14,
                        fontWeight: 700,
                        color: accent,
                      }}
                    >
                      {p.price.toFixed(2)}{' '}
                      <span style={{ fontSize: 10, fontFamily: theme.fonts.body }}>lei</span>
                    </span>
                    <button
                      onClick={() => {
                        // Minim efectiv > 0 (is_required SAU min_select > 0) →
                        // quick-add interzis; serverul respinge sub minim (mig 191).
                        const hasRequired = hasMandatoryModifierGroups(p.modifier_groups)
                        if (hasRequired) {
                          // Are modificatori obligatorii → deschidem ProductSheet
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
                        // 44x44 = țintă de atingere minimă (a11y).
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        background: accent,
                        color: readableTextOn(accent, PUB.text),
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
                fontFamily: theme.fonts.body,
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
            categories={localizedCategories}
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
            onOpenProduct={(product) => {
              setActiveProduct(product)
            }}
            onAddToCart={(item) => setCart((prev) => [...prev, item])}
            sentOrders={previousOrders}
            // „Plătește masa" = cere nota DOAR pentru ce e deja trimis la bucătărie
            // (request-bill nu trimite coșul). Afișăm strict totalul comandat, ca
            // suma de pe buton să corespundă cu ce se facturează (regula de aur).
            tableTotal={previousOrders.reduce((s, o) => s + o.total, 0)}
            onPayTable={
              previousOrders.length > 0 ? () => void handleRequestBill() : undefined
            }
            payDisabled={requestingBill || billRequested}
            payLabel={billRequested ? 'Nota a fost cerută ✓' : 'Plătește masa'}
          />
        </Suspense>
      )}
    </div>
  )
}

// =============================================================
// Menuvia — src/pages/QrMenuPage.tsx
// Customer QR ordering page. Anon. Light theme. No `any`.
// Mobile-first, max-width 480px.
// =============================================================

import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue, lazy, Suspense } from 'react'
import {
  resolveQrMenu,
  fetchMenuForRestaurant,
  fetchActiveHappyHour,
  happyHourPercentForProduct,
  openTableSession,
  hasMandatoryModifierGroups,
  type HappyHourRule,
} from '../lib/qr'
import {
  createOrder,
  lineTotal,
  getQrIdempotencyKey,
  rotateQrIdempotencyKey,
} from '../lib/orders'
import { fetchOnlinePaymentEnabled } from '../lib/payments'
import { fmtPrice, resolveMenuCurrency } from '../lib/currency'
import { T } from '../lib/publicMenuStrings'
import { trName, trDesc, availableMenuLangs, detectBrowserLang, normalizeMenuSearch } from '../lib/i18nMenu'
import type { ResolvedQrToken, Category, Product } from '../lib/qr'
import type { CartItem, OrderConfirmationPayload } from '../lib/orders'
import { callWaiter } from '../lib/orders'
import {
  fetchLoyaltyState,
  attachOrderToLoyalty,
  getStoredLoyaltyPhone,
  storeLoyaltyPhone,
  type LoyaltyState,
} from '../lib/loyalty'

import {
  resolveTheme,
  resolveHideBranding,
  resolveMenuLayout,
  resolveFlipbookPages,
  readableTextOn,
} from '../lib/themes'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { OrderTracker, ActiveOrdersBanner } from '../components/OrderTracker'
import { Icon } from '../components/ui/Icon'
// Componente comune de meniu (Lot A) — același limbaj vizual ca meniul digital.
import { CategoryTabs } from '../components/menu/CategoryTabs'
import { MenuBrandBadge } from '../components/menu/MenuBrandBadge'
import ProductCard from '../components/menu/ProductCard'
import ProductGridCard from '../components/menu/ProductGridCard'
import ProductMinimalRow from '../components/menu/ProductMinimalRow'
import ProductPhotoCard from '../components/menu/ProductPhotoCard'
import MenuHeader from '../components/menu/MenuHeader'
import { MenuLoading, MenuError, MenuCatalogEmpty } from '../components/menu/MenuStates'

// Lazy: ies din bundle-ul inițial al meniului QR (calea fierbinte = time-to-menu
// pe telefoane slabe). ProductSheet (~1000 linii) se cere doar la tap pe produs;
// FlipbookViewer doar pe layout-ul rar „flipbook". Precedent: PublicMenuPage.
const ProductSheet = lazy(() => import('../components/ProductSheet'))
const FlipbookViewer = lazy(() => import('../components/menu/FlipbookViewer'))
const QrCartSheet = lazy(() => import('../components/QrCartSheet'))
const PayTableSheet = lazy(() => import('../components/PayTableSheet'))
const SplitBillSheet = lazy(() => import('../components/SplitBillSheet'))

// Cheile de idempotență (sessionStorage per token) trăiesc în lib/orders —
// getQrIdempotencyKey / rotateQrIdempotencyKey — ca să fie unit-testate.

interface Props {
  token: string
}

// Scroll-lock pentru popup-ul de pairing: hook-urile nu pot fi apelate
// condiționat direct în QrMenuPage, deci montăm acest copil DOAR cât timp
// popup-ul e deschis — aceeași disciplină ca ProductSheet/QrCartSheet
// (altfel un swipe pe backdrop derulează meniul din spate).
function PairingPopupScrollLock(): null {
  useBodyScrollLock(true)
  return null
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
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => getQrIdempotencyKey(token))

  // Gate B: session_id deschisă la scanare QR (open_table_session RPC).
  // Opțional — null dacă restaurantul nu e pe Gate B sau RPC eșuează (graceful).
  const [sessionId, setSessionId] = useState<string | null>(null)

  // Plata online la masă (Etapa 1): doar AFIȘAREA e condiționată de modul —
  // gate-urile reale (plan + modul + cont Stripe) stau server-side în
  // begin_table_payment. Eroare la citire → butonul rămâne „cere nota".
  const [onlinePayEnabled, setOnlinePayEnabled] = useState(false)
  const [showPaySheet, setShowPaySheet] = useState(false)
  const [tablePaid, setTablePaid] = useState(false)
  const [showSplitSheet, setShowSplitSheet] = useState(false)
  // Comenzile deja plătite online (client-side, aproximare a settle-ului):
  // totalul butonului „Plătește masa" nu le mai numără, iar o rundă nouă
  // după plată re-activează butonul (serverul recalculează oricum exact).
  const [paidOrderIds, setPaidOrderIds] = useState<ReadonlySet<string>>(new Set<string>())

  function loadQr() {
    setResolving(true)
    setInvalid(false)
    setNetworkError(false)
    let cancelled = false
    // OPT-4 (mig 245): resolve + meniu într-UN singur RTT — RPC-ul compus
    // resolve_qr_menu; fallback-ul în doi pași e în resolveQrMenu (qr.ts).
    resolveQrMenu(token)
      .then((combined) => {
        if (cancelled) return
        if (combined == null) {
          setInvalid(true)
          setResolving(false)
          return
        }
        const result = combined.resolved
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
        // Plăți online — non-blocking; doar pentru eticheta butonului de plată.
        void fetchOnlinePaymentEnabled(result.restaurant.id)
          .then((enabled) => {
            if (!cancelled) setOnlinePayEnabled(enabled)
          })
          .catch(() => {})
        // Happy Hour activ — non-blocking; meniul se afișează chiar dacă pică.
        void fetchActiveHappyHour(result.restaurant.id)
          .then((rules) => {
            if (!cancelled) setHappyHour(rules)
          })
          .catch(() => {})
        // Meniul e deja în răspunsul compus; doar pe forma neașteptată
        // (menu null de la un RPC vechi) cădem pe fetch-ul separat.
        const menuPromise =
          combined.menu != null
            ? Promise.resolve(combined.menu)
            : fetchMenuForRestaurant(result.restaurant.id)
        return menuPromise.then((cats) => {
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

  const cartTotal = cart.reduce((s, i) => s + lineTotal(i), 0)
  // Numărul REAL de produse din coș (sumă pe cantități, ca `cartCount` din
  // PublicMenuPage) — un singur rând cu qty 3 trebuie să arate „3 produse",
  // altfel badge-ul contrazice totalul (lineTotal înmulțește cu quantity).
  const cartItemCount = cart.reduce((s, i) => s + i.quantity, 0)

  async function handleSubmit(notesValue: string): Promise<void> {
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
          notes: notesValue.length > 0 ? notesValue : null,
          cart,
          idempotency_key: idempotencyKey,
          session_id: activeSessionId,
        })
        // Rotim cheia de idempotență IMEDIAT după succes: dacă tab-ul se
        // reîncarcă (eviction pe mobil / back / refresh), sessionStorage
        // supraviețuiește iar un coș NOU cu aceeași cheie ar fi deduplicat
        // tăcut de server → confirmare veche, comandă pierdută. Retry-urile
        // acestei comenzi au folosit deja cheia veche în interiorul buclei.
        setIdempotencyKey(rotateQrIdempotencyKey(token))
        setConfirmation(result)
        // Loyalty (mig 226): legăm comanda de cardul de puncte — best-effort,
        // eșecul nu are voie să atingă confirmarea. Punctele se acordă
        // server-side abia la închiderea/plata comenzii.
        void attachOrderToLoyalty(result.id, ctx.token.id).then((r) => {
          if (r.ok && ctx.token.id) {
            void fetchLoyaltyState(ctx.token.id).then(setLoyalty)
          }
        })
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
  // Sheet-ul de bacșiș la „Cere nota" (EXPANSION E1, mig 223): clientul își
  // exprimă INTENȚIA de bacșiș — ospătarul o vede pe apel și o introduce la
  // încasare (tips_amount, mig 043). Nu e plată; banii se dau ca până acum.
  const [showTipSheet, setShowTipSheet] = useState(false)
  const [customTip, setCustomTip] = useState('')
  // Sumă custom neparsabilă (ex. „abc") — semnalată vizual, nu trimisă tăcut ca 0.
  const [customTipInvalid, setCustomTipInvalid] = useState(false)

  // ── Loyalty v1 (mig 226): cardul de puncte al clientului ──────────────
  // null = necunoscut/RPC nedeployat (secțiunea nu se afișează);
  // {enabled:false} = program inactiv/plan sub growth.
  const [loyalty, setLoyalty] = useState<LoyaltyState | null>(null)
  const [loyaltyPhone, setLoyaltyPhone] = useState(() => getStoredLoyaltyPhone())
  const [loyaltyPhoneSaved, setLoyaltyPhoneSaved] = useState(false)

  useEffect(() => {
    if (!ctx?.token.id) return
    let cancelled = false
    void fetchLoyaltyState(ctx.token.id).then((s) => {
      if (!cancelled) setLoyalty(s)
    })
    return () => {
      cancelled = true
    }
  }, [ctx?.token.id])

  function saveLoyaltyPhone(): void {
    const p = loyaltyPhone.trim()
    if (p.replace(/\D/g, '').length < 8) return
    storeLoyaltyPhone(p)
    setLoyaltyPhoneSaved(true)
    // Re-citim starea cu telefonul — dacă există deja un wallet pe număr
    // (alt device), punctele lui apar imediat.
    if (ctx?.token.id) void fetchLoyaltyState(ctx.token.id).then(setLoyalty)
    setTimeout(() => setLoyaltyPhoneSaved(false), 2500)
  }

  async function handleRequestBill(tipAmount?: number | null): Promise<void> {
    if (!ctx || requestingBill || billRequested) return
    setRequestingBill(true)
    try {
      await callWaiter(ctx.token.id, 'bill', tipAmount ?? null)
      setBillRequested(true)
      setShowTipSheet(false)
      setCustomTip('')
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
      // Rundă nouă pe aceeași masă: nota veche poate fi plătită online, dar
      // runda nouă e neplătită — butonul „Plătește masa" redevine activ.
      setTablePaid(false)
    } else {
      setPreviousOrders([])
      // Full reset = grup nou la masă; re-deschidem sesiunea la next scan
      setSessionId(null)
      // Grup nou = notă nouă — starea de „plătit online" nu se moștenește.
      setTablePaid(false)
      setPaidOrderIds(new Set<string>())
    }
    setShowPaySheet(false)
    setCart([])
    setNotes('')
    setConfirmation(null)
    setShowCart(false)
    setSubmitError(null)
    setSubmitting(false)
    // Rotește cheia ȘI în sessionStorage (nu doar în state) — vezi comentariul
    // de la rotateQrIdempotencyKey (lib/orders).
    setIdempotencyKey(rotateQrIdempotencyKey(token))
  }

  // ── Resolve theme from restaurant settings ──────────────────
  const theme = useMemo(() => resolveTheme(ctx?.restaurant.theme_settings), [ctx])
  // Moneda meniului (mig 205/206) — fail-safe RON pe RPC vechi/absență.
  const menuCurrency = resolveMenuCurrency(ctx?.restaurant.currency)
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
  // Prop-ul pentru CategoryTabs: memoizat ca să nu se recreeze la fiecare
  // tastă în căutare (altfel tab-urile se re-randează pe orice keystroke).
  const categoryTabItems = useMemo(
    () =>
      localizedCategories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        count: cat.products?.length ?? 0,
      })),
    [localizedCategories],
  )
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
        currency={menuCurrency}
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
            currency={menuCurrency}
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
              {r.discount_type === 'percent' ? `-${r.discount_value}%` : `-${fmtPrice(Number(r.discount_value), menuCurrency)}`}
            </span>
          ))}
        </div>
      )}

      {/* Category tabs — componentă comună (parity cu meniul digital):
          sticky, auto-center pe activ, underline animat, counts, tablist a11y.
          Pe flipbook nu există catalog de produse → fără tab-uri și căutare. */}
      {!isFlipbook && (
        <CategoryTabs
          items={categoryTabItems}
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
            placeholder={T(lang, 'search_placeholder')}
            aria-label={T(lang, 'search_placeholder')}
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
        {isFlipbook && (
          <Suspense fallback={null}>
            <FlipbookViewer pages={flipbookPages} theme={theme} PUB={PUB} />
          </Suspense>
        )}
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
                  ? `${T(lang, 'no_results')} · „${search.trim()}”`
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
                currency={menuCurrency}
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
                currency={menuCurrency}
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
                currency={menuCurrency}
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
                currency={menuCurrency}
              />
            ))}
          </div>
        )}

        {/* Loyalty v1 (mig 226): cardul de puncte — progres spre recompensă,
            cod de arătat staff-ului, telefon opțional (anti-pierdere puncte). */}
        {loyalty?.enabled && (
          <div
            style={{
              margin: '16px 0 4px',
              padding: '16px 16px 14px',
              borderRadius: 16,
              border: `1.5px solid ${loyalty.reward_available ? accent : PUB.border}`,
              background: PUB.surface,
              fontFamily: theme.fonts.body,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 10,
                marginBottom: 8,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 15, color: PUB.text }}>
                Puncte de fidelitate
              </span>
              <span style={{ fontSize: 13, color: PUB.text2 }}>
                {loyalty.points ?? 0} / {loyalty.reward_threshold}
              </span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                background: PUB.border,
                overflow: 'hidden',
                marginBottom: 10,
              }}
              role="progressbar"
              aria-valuenow={Math.min(loyalty.points ?? 0, loyalty.reward_threshold ?? 0)}
              aria-valuemin={0}
              aria-valuemax={loyalty.reward_threshold ?? 0}
              aria-label="Progres puncte de fidelitate"
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, Math.round(((loyalty.points ?? 0) / Math.max(1, loyalty.reward_threshold ?? 1)) * 100))}%`,
                  background: accent,
                  borderRadius: 4,
                  transition: 'width 300ms ease',
                }}
              />
            </div>
            {loyalty.reward_available && loyalty.short_code ? (
              <div
                style={{
                  background: PUB.bg,
                  border: `1px dashed ${accent}`,
                  borderRadius: 12,
                  padding: '10px 12px',
                  fontSize: 13,
                  color: PUB.text,
                  lineHeight: 1.5,
                }}
              >
                🎉 Ai o recompensă: <strong>{loyalty.reward_description}</strong>. Arată codul{' '}
                <strong style={{ letterSpacing: '0.12em' }}>{loyalty.short_code}</strong>{' '}
                ospătarului.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: PUB.text2, lineHeight: 1.5 }}>
                Primești puncte la fiecare comandă. La {loyalty.reward_threshold} puncte:{' '}
                {loyalty.reward_description}.
              </div>
            )}
            {getStoredLoyaltyPhone() === '' ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={loyaltyPhone}
                    onChange={(e) => setLoyaltyPhone(e.target.value)}
                    placeholder="Telefon (opțional)"
                    aria-label="Telefon pentru puncte de fidelitate"
                    style={{
                      flex: 1,
                      minHeight: 40,
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: `1.5px solid ${PUB.border}`,
                      background: PUB.bg,
                      color: PUB.text,
                      fontSize: 13,
                      fontFamily: theme.fonts.body,
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    onClick={saveLoyaltyPhone}
                    className="pressable"
                    style={{
                      minHeight: 40,
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: `1.5px solid ${PUB.border}`,
                      background: PUB.surface,
                      color: PUB.text,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: theme.fonts.body,
                    }}
                  >
                    {loyaltyPhoneSaved ? 'Salvat ✓' : 'Salvează'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: PUB.text3, marginTop: 6, lineHeight: 1.45 }}>
                  Cu telefonul nu-ți pierzi punctele dacă schimbi dispozitivul. Îl folosim doar
                  pentru puncte și îl stocăm criptat (hash), nu ca număr.
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Badge discret „Creat cu Menuvia" (E1) — aceeași buclă virală ca pe
            /m/:slug; opt-out prin theme_settings.hide_branding (Plan 2+). Pe
            domeniile de agenție (white-label v1, mig 236) — brandingul lor. */}
        {!resolveHideBranding(ctx?.restaurant.theme_settings) && (
          <MenuBrandBadge
            utmSource="qr"
            color={PUB.text3}
            fontFamily={theme.fonts.body}
            padding="4px 0 96px"
          />
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
            // Bara „Comanda mea" e PERSISTENTĂ când comanda e permisă (chiar cu coș gol)
            // — offset-ul urmează condiția EI de randare, nu coșul (altfel butoanele
            // rămâneau acoperite de bară la coș gol).
            bottom: orderingAllowed && !isFlipbook ? 90 : 20,
            left: 16,
            // Fundal derivat din temă (PUB.text = suprafață neutră de contrast),
            // nu maro hardcodat; verdele rămâne DOAR ca semnal de succes.
            background: waiterCalled ? '#4CAF6E' : PUB.text,
            color: waiterCalled ? '#fff' : readableTextOn(PUB.text, PUB.bg),
            border: 'none',
            borderRadius: 30,
            padding: '10px 18px',
            // Țintă de atingere ≥44px (a11y) — restul paginii e deja la standard.
            minHeight: 44,
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
          onClick={() => setShowTipSheet(true)}
          disabled={requestingBill || billRequested}
          style={{
            position: 'fixed',
            // Bara „Comanda mea" e PERSISTENTĂ când comanda e permisă (chiar cu coș gol)
            // — offset-ul urmează condiția EI de randare, nu coșul (altfel butoanele
            // rămâneau acoperite de bară la coș gol).
            bottom: orderingAllowed && !isFlipbook ? 90 : 20,
            right: 16,
            // Fundal derivat din temă (vezi butonul „Cheamă ospătarul").
            background: billRequested ? '#4CAF6E' : PUB.text,
            color: billRequested ? '#fff' : readableTextOn(PUB.text, PUB.bg),
            border: 'none',
            borderRadius: 30,
            padding: '10px 18px',
            // Țintă de atingere ≥44px (a11y) — restul paginii e deja la standard.
            minHeight: 44,
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

      {/* Sheet bacșiș la „Cere nota" (E1, mig 223): intenția clientului — nu plată.
          Procente pe totalul comenzilor din sesiune; fără total cunoscut → sume fixe. */}
      {showTipSheet && ctx && (
        <div
          onClick={() => setShowTipSheet(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Cere nota cu bacșiș"
            style={{
              background: PUB.bg,
              color: PUB.text,
              borderRadius: '18px 18px 0 0',
              padding: '20px 18px calc(20px + env(safe-area-inset-bottom))',
              width: '100%',
              maxWidth: 480,
              fontFamily: theme.fonts.body,
              boxShadow: '0 -6px 30px rgba(0,0,0,0.35)',
            }}
          >
            <div
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: 19,
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              Ceri nota
            </div>
            <div style={{ fontSize: 13, color: PUB.text2, marginBottom: 14, lineHeight: 1.5 }}>
              Vrei să lași bacșiș? Suma ajunge la ospătar odată cu nota — plătești ca de obicei.
            </div>
            {(() => {
              const base = previousOrders.reduce((sum, o) => sum + o.total, 0)
              // Plafonul serverului (mig 223) e 2000 — peste el, RPC-ul aruncă
              // TĂCUT bacșișul (v_tip=null) și confirmă ok. Clamp-uim aici ca
              // pe note mari (sau monede slabe) preset-ul de 15% să rămână valid.
              const TIP_CAP = 2000
              const options: { label: string; value: number | null }[] =
                base > 0
                  ? [
                      { label: 'Fără', value: 0 },
                      ...[5, 10, 15].map((pct) => {
                        const amt = Math.min(TIP_CAP, Math.round(base * pct) / 100)
                        return {
                          label: `${pct}% · ${fmtPrice(amt, menuCurrency)}`,
                          value: amt,
                        }
                      }),
                    ]
                  : [
                      { label: 'Fără', value: 0 },
                      ...[5, 10, 15].map((v) => ({
                        label: fmtPrice(v, menuCurrency),
                        value: v,
                      })),
                    ]
              return (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {options.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => {
                        void handleRequestBill(opt.value)
                      }}
                      disabled={requestingBill}
                      className="pressable"
                      style={{
                        flex: '1 1 auto',
                        minHeight: 44,
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: `1.5px solid ${PUB.border}`,
                        background: PUB.surface,
                        color: PUB.text,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: theme.fonts.body,
                        opacity: requestingBill ? 0.6 : 1,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )
            })()}
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              {/* type="text": un „12,5" într-un input number e sanitizat de
                  browser la gol → parseFloat dădea NaN și trimiteam TĂCUT
                  „fără bacșiș" cu confirmare de succes. Cu text, virgula
                  ajunge la noi și o convertim explicit. */}
              <input
                type="text"
                inputMode="decimal"
                value={customTip}
                onChange={(e) => {
                  setCustomTip(e.target.value)
                  if (customTipInvalid) setCustomTipInvalid(false)
                }}
                placeholder="Altă sumă"
                aria-label="Bacșiș — altă sumă"
                style={{
                  flex: 1,
                  minHeight: 44,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1.5px solid ${customTipInvalid ? '#E05555' : PUB.border}`,
                  background: PUB.surface,
                  color: PUB.text,
                  fontSize: 14,
                  fontFamily: theme.fonts.body,
                  boxSizing: 'border-box',
                }}
              />
              <button
                onClick={() => {
                  const raw = customTip.trim()
                  const v = parseFloat(raw.replace(',', '.'))
                  // Sumă neparsabilă/negativă NU se trimite ca „fără bacșiș"
                  // cu confirmare falsă — semnalăm și lăsăm userul să corecteze.
                  if (raw !== '' && (!Number.isFinite(v) || v < 0)) {
                    setCustomTipInvalid(true)
                    return
                  }
                  void handleRequestBill(
                    raw === '' || v <= 0 ? 0 : Math.min(2000, Math.round(v * 100) / 100),
                  )
                }}
                disabled={requestingBill}
                className="pressable"
                style={{
                  minHeight: 44,
                  padding: '10px 18px',
                  borderRadius: 12,
                  border: 'none',
                  background: accent,
                  color: readableTextOn(accent, PUB.bg),
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: theme.fonts.body,
                  opacity: requestingBill ? 0.6 : 1,
                }}
              >
                {requestingBill ? 'Se trimite...' : 'Trimite'}
              </button>
            </div>
          </div>
        </div>
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
                  {cartItemCount} {cartItemCount === 1 ? T(lang, 'item_one') : T(lang, 'item_many')}
                </span>
                <span>{T(lang, 'view_cart')}</span>
                <span>{fmtPrice(cartTotal, menuCurrency)}</span>
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
        <Suspense fallback={null}>
          <ProductSheet
            product={activeProduct}
            accent={accent}
            theme={theme}
            onAdd={addToCart}
            currency={menuCurrency}
            happyHourPct={happyHourPercentForProduct(activeProduct, happyHour)}
            onClose={() => setActiveProduct(null)}
          />
        </Suspense>
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
          <PairingPopupScrollLock />
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
                      {fmtPrice(p.price, menuCurrency)}
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
            currency={menuCurrency}
            onSubmit={(v) => {
              // Sursa de adevăr rămâne părintele (nota supraviețuiește
              // re-deschiderii sheet-ului); submit-ul primește valoarea ca
              // argument — NU din state (stale closure).
              setNotes(v)
              void handleSubmit(v)
            }}
            onOpenProduct={(product) => {
              setActiveProduct(product)
            }}
            onAddToCart={(item) => setCart((prev) => [...prev, item])}
            sentOrders={previousOrders}
            // „Plătește masa": cu modulul de plăți online activ + sesiune → plata
            // din telefon (PayTableSheet, suma se recalculează pe server); altfel
            // fallback-ul istoric = cere nota (request-bill nu trimite coșul).
            // Afișăm strict totalul comandat, ca suma de pe buton să corespundă
            // cu ce se facturează (regula de aur).
            tableTotal={previousOrders
              .filter((o) => !paidOrderIds.has(o.id))
              .reduce((s, o) => s + o.total, 0)}
            onPayTable={
              previousOrders.length > 0
                ? onlinePayEnabled && sessionId != null
                  ? () => setShowPaySheet(true)
                  : () => void handleRequestBill()
                : undefined
            }
            payDisabled={tablePaid || requestingBill || billRequested}
            // Split pe itemi (mig 229): doar cu plata online activă + sesiune.
            onPaySplit={
              onlinePayEnabled && sessionId != null && previousOrders.length > 0 && !tablePaid
                ? () => setShowSplitSheet(true)
                : undefined
            }
            payLabel={
              tablePaid
                ? 'Plătit online ✓'
                : onlinePayEnabled && sessionId != null
                  ? 'Plătește online'
                  : billRequested
                    ? 'Nota a fost cerută ✓'
                    : 'Plătește masa'
            }
          />
        </Suspense>
      )}

      {/* Plata online a mesei — lazy, doar la cerere */}
      {showPaySheet && sessionId != null && (
        <Suspense fallback={null}>
          <PayTableSheet
            token={token}
            sessionId={sessionId}
            PUB={PUB}
            accent={accent}
            onClose={() => setShowPaySheet(false)}
            onPaid={() => {
              setTablePaid(true)
              // Serverul a plătit TOATE comenzile neplătite ale sesiunii —
              // marcăm ce cunoaștem local ca totalul butonului să nu le
              // renumere la runda următoare. (`confirmation` e mereu null
              // aici — early-return-ul de mai sus randează OrderTracker.)
              setPaidOrderIds((prev) => {
                const next = new Set(prev)
                previousOrders.forEach((o) => next.add(o.id))
                return next
              })
            }}
            onPayOtherwise={() => {
              setShowPaySheet(false)
              // Ospătarul află imediat că masa vrea să plătească altfel.
              void handleRequestBill()
            }}
          />
        </Suspense>
      )}

      {/* Split pe itemi (mig 229) — plătește doar partea ta */}
      {showSplitSheet && sessionId != null && (
        <Suspense fallback={null}>
          <SplitBillSheet
            token={token}
            sessionId={sessionId}
            PUB={PUB}
            accent={accent}
            onClose={() => setShowSplitSheet(false)}
            onPaid={() => {
              // Plată PARȚIALĂ a mesei: NU setăm tablePaid/paidOrderIds —
              // serverul marchează 'paid' doar comenzile acoperite integral;
              // restul mesei se plătește în continuare (split sau ospătar).
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

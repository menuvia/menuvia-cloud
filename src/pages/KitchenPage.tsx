// =============================================================
// Menuvia — src/pages/KitchenPage.tsx
// Kitchen Dashboard (/kitchen). Dark theme.
// Restaurant selection via RestaurantContext — no local membership query.
// Lotul L4c: textele vin din namespace-ul `kitchen` (+ `orders` pentru
// cuvintele comune cu ospătarul și `common` pentru vârsta comenzii). Pagina
// cere `kitchen`, `orders` și `common` SUS, înaintea oricărui return timpuriu:
// nota de refuz (ActionErrorNote), detaliile de ridicare și panoul „Epuizate”
// le folosesc și sunt montate CONDIȚIONAT — altfel, într-o limbă nouă, prima
// eroare de pe un card ar suspenda și ar înlocui tot ecranul cu spinner-ul.
// =============================================================

import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  CSSProperties,
  ReactNode,
} from 'react'
import { useRestaurantCtx } from '../contexts/RestaurantContext'
import { useOrders } from '../hooks/useOrders'
import type { Order, OrderStatus, StaffActionFailure } from '../lib/orders'
import { STAFF_ORDERS_FETCH_LIMIT } from '../lib/orders'
import { D } from '../lib/constants'
import { urgencyColor, playSound } from '../lib/utils'
import { takeNewlyLate } from '../lib/orderAge'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { useAudioUnlock } from '../hooks/useAudioUnlock'
import { createTapGuard } from '../lib/tapGuard'
import { useInView, revealStyle } from '../lib/motion'
import { Icon, type IconName } from '../components/ui/Icon'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { Skeleton } from '../components/ui/Skeleton'
import PickupDetails from '../components/PickupDetails'
import { OrderLineDetails } from '../components/OrderLineDetails'
import { ActionErrorNote } from '../components/ActionErrorNote'
import { SignOutButton } from '../components/SignOutButton'
import { UiLanguageSelect } from '../components/UiLanguageSelect'
import { isScheduledPickupAhead, sortByDue, urgencyAnchor } from '../lib/pickupOrders'
import { useT } from '../i18n/useT'
import { kitchenNs } from '../i18n/ns/kitchen'
import { ordersNs } from '../i18n/ns/orders'
import { commonNs } from '../i18n/ns/common'
import { elapsedT } from '../i18n/elapsed'
// Panoul „Epuizate” (mig 313): încărcat doar la deschidere.
const StaffSoldOutSheet = lazy(() => import('../components/StaffSoldOutSheet'))

// D imported from constants

// Eticheta pasului: „Confirmă” e a Bucătăriei (`kitchen.next_confirm`), iar
// „Marchează în pregătire” / „Gata” sunt cuvintele ospătarului (`orders.step_*`
// — aceleași pe ambele ecrane, lotul L4a).
type KitchenStep = 'confirm' | 'preparing' | 'ready'
const KITCHEN_NEXT: Partial<Record<OrderStatus, { status: OrderStatus; step: KitchenStep }>> = {
  new: { status: 'confirmed', step: 'confirm' },
  confirmed: { status: 'preparing', step: 'preparing' },
  preparing: { status: 'ready', step: 'ready' },
}

// Board pe 3 coloane (DESIGN_SPEC Val 3): „Noi" cumulează new+confirmed —
// vizual, fără schimbare de statusuri în backend. Butonul de pe card face
// în continuare tranzițiile reale (new→confirmed→preparing→ready).
type ColumnId = 'new' | 'preparing' | 'ready'
interface KitchenColumn {
  id: ColumnId
  statuses: OrderStatus[]
  labelKey: 'col_new' | 'col_preparing' | 'col_ready'
  // Iconița stării goale a coloanei (înainte dedusă din eticheta românească).
  icon: IconName
}
const COLUMNS: KitchenColumn[] = [
  { id: 'new', statuses: ['new', 'confirmed'], labelKey: 'col_new', icon: 'receipt' },
  { id: 'preparing', statuses: ['preparing'], labelKey: 'col_preparing', icon: 'utensils' },
  { id: 'ready', statuses: ['ready'], labelKey: 'col_ready', icon: 'check' },
]

// Acțiunea MUTĂ cardul în altă coloană? Atunci cardul de dedesubt urcă sub
// deget și garda de dublu-tap respinge în fereastră un tap pe ORICE card;
// altfel („Confirmă": new → confirmed, aceeași coloană) doar pe același card.
function columnOf(status: OrderStatus): number {
  return COLUMNS.findIndex((c) => c.statuses.includes(status))
}
// NU se exportă: un export ne-componentă dintr-o pagină .tsx pică
// react-refresh/only-export-components (lint-ul e --max-warnings 0).
function kitchenActionMovesCard(current: OrderStatus, next: OrderStatus): boolean {
  return columnOf(current) !== columnOf(next)
}

// urgencyColor, playSound — imported from ../lib/utils; vârsta = elapsedT (src/i18n)

// Nivel de urgență derivat din vârsta comenzii. Refolosește exact pragurile
// din `urgencyColor` (10m → amber, 20m → red), dar le mapează la un nivel
// semantic ca să putem escalada întreg cardul, nu doar o dungă subțire.
type UrgencyLevel = 'calm' | 'warn' | 'late'
function urgencyLevel(createdAt: string): UrgencyLevel {
  const c = urgencyColor(createdAt)
  if (c === D.red) return 'late'
  if (c === D.amber) return 'warn'
  return 'calm'
}

// Culoarea de accent pentru un nivel de urgență. `calm` → null (fără accent);
// apelanții care au nevoie de o culoare neutră fac `?? D.t2`.
function urgencyLevelColor(level: UrgencyLevel): string | null {
  if (level === 'late') return D.red
  if (level === 'warn') return D.amber
  return null
}

// Wrapper mic pentru reveal per-card — hook-ul useInView e apelat înăuntru,
// nu în .map() (regula hooks). Comanda nouă „aterizează" lin în coloană.
function RevealItem({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const [ref, inView] = useInView<HTMLDivElement>({ amount: 0.05 })
  return (
    <div ref={ref} style={revealStyle(inView, { delay, y: 10 })}>
      {children}
    </div>
  )
}

// Timer mare, citibil de la distanță. Culoarea + intensitatea cresc cu vârsta.
// OPT-7: FĂRĂ interval propriu — părintele (OrderCard) se re-randează deja la
// 10s prin urgencyTick, deci vârsta calculată la render e mereu proaspătă.
// Înainte: 2 timere per card (60 la 30 de comenzi), re-render-uri decalate.
// Vârsta e `elapsedT` (lotul L4c): unitățile în limba personalului, în română
// exact textele de dinainte („30s”, „5m”, „1h 30m”).
function ElapsedTimer({ createdAt }: { createdAt: string }) {
  const tc = useT(commonNs)
  const val = elapsedT(createdAt, tc)
  const level = urgencyLevel(createdAt)
  const color = urgencyLevelColor(level) ?? D.t2
  const calm = level === 'calm'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: calm ? D.s3 : `${color}1F`,
        color: calm ? D.t2 : color,
        border: `1px solid ${calm ? D.border : `${color}55`}`,
        borderRadius: 10,
        padding: '5px 10px',
        fontSize: 18,
        fontWeight: 800,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {!calm && (
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: color,
          }}
        />
      )}
      {val}
    </span>
  )
}

interface OrderCardProps {
  order: Order
  onAdvance: (id: string, cur: OrderStatus, next: OrderStatus) => void
  // Acțiunea pe comandă e în curs: butonul stă dezactivat (anti dublu-tap —
  // după primul tap butonul arată deja PASUL URMĂTOR).
  pending?: boolean
  // Refuzul ultimei acțiuni, ca DATE (useOrders), tradus de nota de SUB buton
  // (nu sus, în pagină) — lotul L4c.
  actionError?: StaffActionFailure | null
  onDismissError?: (id: string) => void
}
const OrderCard = memo(function OrderCard({
  order,
  onAdvance,
  pending = false,
  actionError = null,
  onDismissError,
}: OrderCardProps) {
  const { t } = useT(kitchenNs)
  const to = useT(ordersNs)
  const next = KITCHEN_NEXT[order.status]
  const nextLabel =
    next == null
      ? ''
      : next.step === 'confirm'
        ? t('next_confirm')
        : next.step === 'preparing'
          ? to.t('step_preparing')
          : to.t('step_ready')
  // Re-render la 10s (aceeași cadență ca ElapsedTimer) — altfel border-ul/fundalul
  // cardului rămâneau „calme" până la următorul poll (~30s) deși chip-ul de timp
  // devenise deja amber/roșu: stare vizuală contradictorie pe același card.
  const [, setUrgencyTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setUrgencyTick((t) => t + 1), 10_000)
    return () => clearInterval(id)
  }, [])
  // Pickup programat în viitor: încă nu întârzie → fără escaladare. După ora
  // de ridicare, urgența se măsoară față de ora PROMISĂ, nu față de plasare.
  const pickupAhead = isScheduledPickupAhead(order)
  const anchor = urgencyAnchor(order)
  const level: UrgencyLevel = pickupAhead ? 'calm' : urgencyLevel(anchor)
  const urgColor = urgencyLevelColor(level)
  const isNew = order.status === 'new'
  // Urgența îmbracă TOT cardul (border + tentă de fundal), nu o dungă laterală.
  // Calm → border auriu doar pentru comenzi noi neconfirmate. Warn/late escaladează.
  const accent = urgColor ?? (isNew ? D.gold : null)
  const card: CSSProperties = {
    background:
      level === 'late'
        ? D.redA
        : level === 'warn'
          ? D.amberA
          : D.s2,
    // `color-mix`, nu `${accent}99`: un sufix de alfa lipit de un `var(...)` e
    // CSS invalid — bordura de urgență dispărea tăcut (lotul V).
    border: `1.5px solid ${accent != null ? `color-mix(in srgb, ${accent} 60%, transparent)` : D.s3}`,
    boxShadow: level === 'late' ? `0 0 0 1px ${D.redBorder}, 0 4px 16px ${D.redA}` : 'none',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    position: 'relative',
  }
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 20,
              fontWeight: 700,
              color: D.t1,
            }}
          >
            {order.table?.name ?? to.t('noTable')}
          </div>
          <div style={{ fontSize: 12, color: D.t2, marginTop: 2 }}>
            #{order.id.slice(-6).toUpperCase()} ·{' '}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                verticalAlign: 'middle',
                color: order.source === 'qr' ? D.goldL : order.source === 'pickup' ? D.green : D.t2,
              }}
            >
              {order.source === 'qr' ? (
                <>
                  <Icon name="qr" size={13} />
                  {t('src_qr')}
                </>
              ) : order.source === 'pickup' ? (
                <>
                  <Icon name="box" size={13} />
                  {to.t('card_srcPickup')}
                </>
              ) : (
                t('src_waiter')
              )}
            </span>
          </div>
        </div>
        {!pickupAhead && <ElapsedTimer createdAt={anchor} />}
      </div>
      <PickupDetails order={order} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {order.order_items.map((item) => (
          <div key={item.id}>
            <div style={{ fontSize: 15, color: D.t1, fontWeight: 600 }}>
              {item.product_name_snapshot} × {item.quantity}
            </div>
            {/* Opțiunile, extra-urile plătite (lotul O2a — înainte nu apăreau
                deloc) și nota per produs („fără ceapă"). Fără prețuri: bucătarul
                nu are nevoie de bani pe ecran. */}
            <OrderLineDetails item={item} variant="list" />
          </div>
        ))}
      </div>
      {order.notes != null && order.notes.length > 0 && (
        <div
          style={{
            fontSize: 12,
            color: D.t1,
            fontStyle: 'italic',
            background: D.s3,
            borderRadius: 8,
            padding: '8px 10px',
          }}
        >
          „{order.notes}”
        </div>
      )}
      {next != null && (
        <Button
          variant="primary"
          size="lg"
          fullWidth
          className="pressable"
          loading={pending}
          onClick={(e) => {
            // Feedback tactil scurt pe tap — bucătarul vede că butonul a „prins".
            e.currentTarget.classList.remove('animate-bump')
            void e.currentTarget.offsetWidth
            e.currentTarget.classList.add('animate-bump')
            onAdvance(order.id, order.status, next.status)
          }}
        >
          {pending ? to.t('saving') : nextLabel}
        </Button>
      )}
      {actionError != null && (
        <ActionErrorNote
          error={actionError}
          onDismiss={onDismissError ? () => onDismissError(order.id) : undefined}
        />
      )}
    </div>
  )
})

// Exportat pentru teste (cardul pickup: ora, clientul, fără timer roșu înainte).
export { OrderCard as KitchenOrderCard }

// ── Restaurant selector — shown only when user has access to multiple restaurants ──
function RestaurantSelector({
  memberships,
  activeId,
  setActive,
}: {
  memberships: { restaurant_id: string; restaurant: { id: string; name: string; slug: string } }[]
  activeId: string | null
  setActive: (id: string) => void
}) {
  const { t } = useT(kitchenNs)
  if (memberships.length <= 1) return null
  return (
    <select
      value={activeId ?? ''}
      onChange={(e) => setActive(e.target.value)}
      aria-label={t('selectRestaurant')}
      style={{
        background: D.s3,
        border: `1px solid ${D.s3}`,
        borderRadius: 7,
        color: D.t1,
        minHeight: 44,
        padding: '6px 10px',
        fontSize: 13,
        fontFamily: D.fontBody,
        cursor: 'pointer',
        outline: 'none',
        // Numele lungi de restaurant nu au voie să împingă header-ul în overflow la 375px.
        maxWidth: 140,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {memberships.map((m) => (
        <option key={m.restaurant_id} value={m.restaurant_id}>
          {m.restaurant.name}
        </option>
      ))}
    </select>
  )
}

export default function KitchenPage() {
  // FIX: use RestaurantContext — no more local membership query, supports multi-restaurant
  const {
    activeId: restaurantId,
    activeName: restaurantName,
    activeRole,
    memberships,
    setActive,
    loading: ctxLoading,
  } = useRestaurantCtx()
  // Toate trei SUS, înaintea oricărui return timpuriu (vezi antetul fișierului).
  const { t } = useT(kitchenNs)
  useT(ordersNs)
  useT(commonNs)
  // Owner/manager ajung aici din panou și au nevoie de drumul înapoi;
  // bucătarul nu are panou (lib/roleRouting.ts îl trimite oricum aici).
  const isAdminRole = activeRole === 'owner' || activeRole === 'manager'
  const prevOrderIds = useRef(new Set<string>())
  // Primul snapshot hidratat NU e „comandă nouă" — altfel beep-ul suna la încărcarea
  // paginii sau după schimbarea restaurantului. Sunăm doar de la al doilea snapshot.
  const hasSeenInitialSnapshot = useRef(false)
  // Dismiss local pe banner-ul de eroare: pe un ecran deschis toată ziua, o eroare
  // tranzientă nu trebuie să lase un banner roșu perpetuu. O eroare NOUĂ (text diferit)
  // redeschide bannerul.
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [showSoldOut, setShowSoldOut] = useState(false)

  const {
    orders,
    loading,
    error,
    truncated,
    snapshotFor,
    advance,
    byStatus,
    connectionStatus,
    pendingIds,
    actionErrors,
    dismissActionError,
  } = useOrders(restaurantId, 'kitchen')
  // Sunetul pentru comandă nouă: deblocat la PRIMA atingere a ecranului;
  // până atunci un banner o cere (altfel beep-ul era mut fără niciun semn).
  const sound = useAudioUnlock()
  // Anti dublu-tap între carduri: „Gata" mută cardul în altă coloană, iar
  // cardul de dedesubt urcă sub deget (lib/tapGuard.ts).
  const tapGuard = useMemo(() => createTapGuard(), [])
  // Indicatorul reflectă starea REALĂ a canalului de comenzi (useOrders), nu un canal de
  // prezență separat care putea arăta „Conectat" când realtime-ul comenzilor era căzut.
  // Cele 3 stări rămân distincte: 'connecting' (starea inițială, câteva secunde la fiecare
  // deschidere) NU e „Deconectat" — altfel staff-ul vede o alarmă falsă roșie la fiecare load.
  const connDot =
    connectionStatus === 'connected' ? D.green : connectionStatus === 'connecting' ? D.amber : D.red
  const connLabel =
    connectionStatus === 'connected'
      ? t('conn_connected')
      : connectionStatus === 'connecting'
        ? t('conn_connecting')
        : t('conn_disconnected')
  const {
    supported: pushSupported,
    permission: pushPerm,
    subscribed: pushSubscribed,
    loading: pushLoading,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = usePushNotifications(restaurantId)


  // Lotul G: o comandă încă nepregătită care trece de 20 de minute sună O dată
  // (ton mai jos și mai lung decât „comandă nouă", ca bucătarul să le
  // deosebească). Comenzile deja întârziate la deschiderea ecranului NU sună:
  // cardul lor e deja roșu, iar un reload nu are voie să facă zgomot.
  const lateAlerted = useRef<Set<string>>(new Set())
  const lateBaselineDone = useRef(false)

  // Reset la schimbarea restaurantului — noul prim snapshot nu trebuie să sune,
  // iar o eroare închisă pe vechiul restaurant nu ascunde una de pe cel nou.
  useEffect(() => {
    prevOrderIds.current = new Set<string>()
    hasSeenInitialSnapshot.current = false
    lateAlerted.current = new Set<string>()
    lateBaselineDone.current = false
    setDismissedError(null)
  }, [restaurantId])

  // Verificarea rulează la fiecare schimbare a comenzilor ȘI la 10 s (o comandă
  // devine întârziată odată cu trecerea timpului, fără niciun eveniment); efectul
  // se reface la fiecare listă nouă, deci intervalul citește mereu lista curentă.
  //
  // Baseline-ul se pune DOAR pe un snapshot reușit al restaurantului ACTIV
  // (`snapshotFor`, din useOrders): nu pe lista goală a unui prim fetch eșuat
  // (altfel, la primul poll reușit, comenzile deja întârziate ar suna toate) și
  // nu pe lista vechiului restaurant, pe care useOrders o mai ține o randare
  // după comutare — goală sau nu, deci nu se poate deduce din comenzi.
  useEffect(() => {
    if (loading) return
    const check = (): void => {
      if (!lateBaselineDone.current && snapshotFor !== restaurantId) return
      const { alerted, fresh } = takeNewlyLate(orders, lateAlerted.current)
      lateAlerted.current = alerted
      if (!lateBaselineDone.current) {
        lateBaselineDone.current = true
        return
      }
      if (fresh.length > 0) playSound(440, 450)
    }
    check()
    const id = setInterval(check, 10_000)
    return () => clearInterval(id)
  }, [orders, loading, snapshotFor, restaurantId])

  useEffect(() => {
    // NU arma baseline-ul pe render-ul GOL dinainte de primul fetch: altfel
    // orders trece din [] (pre-fetch) în [reale] și toate par „noi" față de
    // prevOrderIds gol → beep fals la fiecare încărcare a paginii Bucătărie.
    // Primul snapshot POST-load devine baseline-ul tăcut.
    if (loading) return
    const currentIds = new Set(orders.map((o) => o.id))
    if (hasSeenInitialSnapshot.current) {
      for (const o of orders) {
        if (o.status === 'new' && !prevOrderIds.current.has(o.id)) {
          playSound(880, 200)
          break
        }
      }
    }
    hasSeenInitialSnapshot.current = true
    prevOrderIds.current = currentIds
  }, [orders, loading])

  // OPT-8: stabil — altfel memo-ul de pe OrderCard e inert (prop nou/render).
  const handleAdvance = useCallback(
    (orderId: string, current: OrderStatus, next: OrderStatus): void => {
      if (!tapGuard(orderId, kitchenActionMovesCard(current, next) ? 'list' : 'card')) return
      void advance(orderId, current, { status: next })
    },
    [advance, tapGuard],
  )

  if (ctxLoading || loading) {
    return (
      <div
        style={{
          background: D.bg,
          minHeight: '100vh',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 1,
          padding: 12,
        }}
      >
        {[0, 1, 2].map((col) => (
          <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
            <Skeleton variant="title" width="50%" />
            <Skeleton variant="card" count={3} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ background: D.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          background: D.s1,
          borderBottom: `1px solid ${D.s3}`,
          // minHeight + wrap (nu înălțime fixă): cu „Înapoi la panou" și
          // „Ieși din cont", pe 375px grupul de butoane coboară pe rândul doi.
          padding: '6px 16px',
          minHeight: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 200px' }}>
        {isAdminRole && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Icon name="arrowLeft" size={14} />}
            onClick={() => {
              window.history.pushState({}, '', '/dashboard')
              window.dispatchEvent(new PopStateEvent('popstate'))
            }}
            title={t('header_backTitle')}
            style={{ flexShrink: 0 }}
          >
            {t('header_back')}
          </Button>
        )}
        <PageHeader
          as="h1"
          compact
          title={restaurantName.length === 0 ? t('title') : t('titleWithName', { name: restaurantName })}
          style={{ flex: '1 1 160px', minWidth: 0, alignItems: 'center' }}
        />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexShrink: 0,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          {/* Restaurant selector — only visible for multi-restaurant users */}
          <RestaurantSelector
            memberships={memberships}
            activeId={restaurantId}
            setActive={setActive}
          />
          {restaurantId != null && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowSoldOut(true)}
              icon={<Icon name="alert" size={16} />}
              aria-label={t('soldOutAria')}
            >
              {t('soldOut')}
            </Button>
          )}
          {pushSupported && pushPerm !== 'unsupported' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void (pushSubscribed ? pushUnsubscribe() : pushSubscribe())
              }}
              disabled={pushLoading || (!pushSubscribed && pushPerm === 'denied')}
              aria-label={
                pushSubscribed
                  ? t('push_onAria')
                  : pushPerm === 'denied'
                    ? t('push_blockedAria')
                    : t('push_enable')
              }
              title={
                pushSubscribed
                  ? t('push_onTitle')
                  : pushPerm === 'denied'
                    ? t('push_blockedTitle')
                    : t('push_enable')
              }
              icon={<Icon name="bell" size={16} color={pushSubscribed ? D.gold : undefined} />}
            >
              {/* „Blocate" e vizibil și pe touch — title-ul nu se afișează pe tabletele din bucătărie */}
              {pushSubscribed ? t('push_on') : pushPerm === 'denied' ? t('push_blocked') : t('push_off')}
            </Button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: connDot,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, color: D.t2, whiteSpace: 'nowrap' }}>{connLabel}</span>
          </div>
          {/* Comutatorul de limbă (lotul L4c): invizibil cu o singură limbă activă. */}
          <UiLanguageSelect />
          {/* Ieșirea din cont, pentru ORICE rol — bucătarul nu avea niciuna. */}
          <SignOutButton variant="header" />
        </div>
      </div>

      {/* Push permission banner — shown once until user acts */}
      {pushSupported && pushPerm === 'default' && !pushSubscribed && (
        <div
          style={{
            background: D.goldA,
            borderBottom: `1px solid ${D.goldBorder}`,
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="bell" size={18} color={D.gold} />
            <span style={{ fontSize: '0.82rem', color: D.t2, lineHeight: 1.4 }}>
              {t('pushBanner_text')}
            </span>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              void pushSubscribe()
            }}
            loading={pushLoading}
            style={{ flexShrink: 0 }}
          >
            {pushLoading ? t('pushBanner_enabling') : t('pushBanner_enable')}
          </Button>
        </div>
      )}

      {sound.locked && (
        <div
          role="status"
          style={{
            // Token-uri D întregi: `${D.amber}1F` lipește un sufix de opacitate
            // de un `var(...)` → CSS invalid, banner fără fundal.
            background: D.amberA,
            borderBottom: `1px solid ${D.amber}`,
            padding: '8px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: D.amber, fontSize: 13 }}
          >
            <Icon name="bell" size={16} color={D.amber} />
            {t('sound_locked')}
          </span>
          <Button variant="primary" size="sm" onClick={sound.unlock} style={{ flexShrink: 0 }}>
            {t('sound_unlock')}
          </Button>
        </div>
      )}

      {truncated && (
        <div
          role="status"
          style={{ background: D.amberA, color: D.amber, padding: '8px 24px', fontSize: 13 }}
        >
          {t('list_truncated', { limit: STAFF_ORDERS_FETCH_LIMIT })}
        </div>
      )}

      {error != null && error !== dismissedError && (
        <div
          style={{
            background: D.redA,
            color: D.red,
            padding: '4px 12px 4px 24px',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          {/* Doar erorile de ÎNCĂRCARE a listei (refuzurile unei acțiuni stau pe card).
              Mesaj acționabil în limba personalului; detaliul tehnic (netradus)
              rămâne secundar, pentru diagnoză. Dispare singur la următorul fetch
              reușit. */}
          <span style={{ minWidth: 0 }}>
            {t('sync_error')}{' '}
            <span style={{ opacity: 0.65, fontSize: 11 }}>({error})</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDismissedError(error)}
            aria-label={t('sync_dismiss')}
            style={{ flexShrink: 0, minWidth: 44, padding: 0 }}
          >
            <Icon name="close" size={16} />
          </Button>
        </div>
      )}

      {showSoldOut && restaurantId != null && (
        <Suspense fallback={null}>
          <StaffSoldOutSheet restaurantId={restaurantId} onClose={() => setShowSoldOut(false)} />
        </Suspense>
      )}

      {/* Kanban */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          // auto-fit: 3 coloane pe desktop/tabletă, stack vertical pe telefon
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 1,
          overflow: 'auto',
        }}
      >
        {COLUMNS.map((col) => {
          // „Când trebuie să fie gata": pickup după ora de ridicare, restul FIFO.
          const colOrders = sortByDue(byStatus(col.statuses))
          return (
            <div
              key={col.id}
              style={{
                background: D.s1,
                borderRight: `1px solid ${D.s3}`,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: `1px solid ${D.s3}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span
                  style={{
                    fontFamily: D.fontBody,
                    fontSize: 13,
                    fontWeight: 600,
                    color: D.t2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {t(col.labelKey)}
                </span>
                <span
                  style={{
                    background: D.s3,
                    color: D.t2,
                    borderRadius: 12,
                    padding: '2px 8px',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {colOrders.length}
                </span>
              </div>
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {colOrders.map((order, i) => (
                  <RevealItem key={order.id} delay={Math.min(i, 4) * 40}>
                    <OrderCard
                      order={order}
                      onAdvance={handleAdvance}
                      pending={pendingIds.has(order.id)}
                      actionError={actionErrors[order.id] ?? null}
                      onDismissError={dismissActionError}
                    />
                  </RevealItem>
                ))}
                {colOrders.length === 0 && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <EmptyState
                      compact
                      icon={col.icon}
                      title={t('empty_title')}
                      description={
                        orders.length === 0 && col.id === 'new' ? t('empty_newHint') : undefined
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

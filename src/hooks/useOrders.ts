import { useState, useEffect, useCallback, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  fetchKitchenOrders,
  fetchWaiterOrders,
  fetchOrderById,
  advanceOrderStatus,
  subscribeToOrders,
  type Order,
  type OrderStatus,
  type PaymentMethod,
  type AdvanceOrderPayload,
  type RealtimeConnectionStatus,
  describeStaffActionError,
} from '../lib/orders'

// Refetch periodic ca plasă de siguranță dacă realtime pică tăcut.
// 30s e suficient pentru un POS (comenzile apar mai devreme via realtime
// când canalul e OK; polling-ul prinde doar cazurile când realtime a căzut).
const POLLING_INTERVAL_MS = 30_000

// Cât stă vizibilă eroarea unei acțiuni rapide lângă buton. Înainte eroarea
// mergea în bannerul de pagină și rămânea acolo până la următoarea acțiune
// (pe o tabletă de bucătărie deschisă toată ziua = banner roșu perpetuu).
export const ACTION_ERROR_TTL_MS = 8_000

// Resincronizare (perf-staff-1): la RE-conectarea canalului realtime, la
// revenirea în prim-plan după o pauză și la evenimentul `online` lista se
// reîncarcă IMEDIAT. Evenimentele emise cât canalul era căzut / tab-ul era
// suspendat NU se mai livrează — fără resync, comenzile noi apăreau abia la
// heartbeat (~120 s cu realtime „conectat"). Pragul pe ascundere evită un
// fetch complet la fiecare deblocare scurtă de telefon (canalul supraviețuiește
// câteva secunde în fundal); plafonul dintre două resync-uri oprește o
// avalanșă când rețeaua pâlpâie.
const RESYNC_AFTER_HIDDEN_MS = 10_000
const RESYNC_MIN_GAP_MS = 2_000

const KITCHEN_STATUSES: OrderStatus[] = ['new', 'confirmed', 'preparing', 'ready']
// `closed` E exclus: fetchWaiterOrders folosește lista POZITIVĂ (fără closed),
// deci un UPDATE realtime served→closed (Plan 2) trebuie să SCOATĂ comanda din
// vedere — altfel rămânea afișată până la următorul refetch (review audit v3).
const WAITER_EXCLUDED: OrderStatus[] = ['paid', 'cancelled', 'closed']

function belongsInView(order: Order, view: 'kitchen' | 'waiter'): boolean {
  if (view === 'kitchen') return KITCHEN_STATUSES.includes(order.status)
  return !WAITER_EXCLUDED.includes(order.status)
}

// Reconciliere de polling (OPT-7): pentru fiecare comandă nouă, dacă cea
// veche cu același id e IDENTICĂ structural (JSON stabil — include items și
// embed-ul table), păstrăm obiectul VECHI ca referința să nu se schimbe.
// Dacă totul e identic și ordinea/lungimea coincid, întoarcem chiar array-ul
// vechi → setState devine no-op și nimic nu se re-randează.
export function reconcileOrders(prev: Order[], next: Order[]): Order[] {
  const byId = new Map(prev.map((o) => [o.id, o]))
  let allSame = prev.length === next.length
  const merged = next.map((n, i) => {
    const old = byId.get(n.id)
    if (old && JSON.stringify(old) === JSON.stringify(n)) {
      if (allSame && prev[i] !== old) allSame = false
      return old
    }
    allSame = false
    return n
  })
  return allSame ? prev : merged
}

// Realtime poate livra coloanele numeric ca string — coercăm defensiv.
function rtStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}
function rtNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// Aplică un UPDATE realtime peste comanda deja hidratată, FĂRĂ round-trip.
// Sigur doar când totalul e neschimbat: orice editare de produse trece prin
// update_order_items care recalculează totalul, deci total identic = doar
// tranziție de status/plată — câmpurile de mai jos sunt exact ce scrie
// advance_order. Toate se iau din rând (rândul realtime e complet), deci
// două evenimente rapide pe aceeași comandă converg la starea finală.
// True dacă payload-ul reprezintă o TRANZIȚIE de status/plată reală (un câmp de
// status sau un timestamp de stadiu chiar s-a schimbat). Folosit ca gardă pentru
// fast-path-ul de merge din realtime: o editare de PRODUSE cu total identic (swap
// la același preț) nu schimbă niciun câmp de status → nu e „tranziție" → refetch,
// ca să nu rămână produse STALE pe Bucătărie/Ospătar (audit comenzi, MEDIUM).
export function isStatusTransition(existing: Order, row: Record<string, unknown>): boolean {
  const diff = (a: string | null, b: string | null) => (a ?? '') !== (b ?? '')
  return (
    diff(rtStr(row.status), existing.status) ||
    diff(rtStr(row.confirmed_at), existing.confirmed_at) ||
    diff(rtStr(row.preparing_at), existing.preparing_at) ||
    diff(rtStr(row.ready_at), existing.ready_at) ||
    diff(rtStr(row.served_at), existing.served_at) ||
    diff(rtStr(row.paid_at), existing.paid_at) ||
    diff(rtStr(row.cancelled_at), existing.cancelled_at) ||
    diff(rtStr(row.payment_method), existing.payment_method) ||
    (rtNum(row.paid_amount) ?? -1) !== (existing.paid_amount ?? -1)
  )
}

export function mergeRealtimeOrder(existing: Order, row: Record<string, unknown>): Order {
  return {
    ...existing,
    status: (rtStr(row.status) as OrderStatus | null) ?? existing.status,
    payment_method: rtStr(row.payment_method) as PaymentMethod | null,
    paid_amount: rtNum(row.paid_amount),
    notes: rtStr(row.notes),
    cancel_reason: rtStr(row.cancel_reason),
    served_by: rtStr(row.served_by),
    paid_by: rtStr(row.paid_by),
    confirmed_at: rtStr(row.confirmed_at),
    preparing_at: rtStr(row.preparing_at),
    ready_at: rtStr(row.ready_at),
    served_at: rtStr(row.served_at),
    paid_at: rtStr(row.paid_at),
    cancelled_at: rtStr(row.cancelled_at),
  }
}

interface UseOrdersResult {
  orders: Order[]
  loading: boolean
  error: string | null
  // Lista e plafonată (cele mai noi STAFF_ORDERS_FETCH_LIMIT comenzi deschise).
  truncated: boolean
  connectionStatus: RealtimeConnectionStatus
  // Întoarce true dacă update-ul a reușit, false dacă a fost respins (rol/gate/rețea)
  // sau dacă o acțiune pe ACEEAȘI comandă e deja în curs (dublu-tap).
  // Apelanții pe căi de bani (plată) trebuie să verifice rezultatul înainte de a
  // închide optimist modalul.
  // Cu `opts.throwOnError` eroarea e re-aruncată (cu hint/code) în loc de
  // `false`, ca apelantul s-o afișeze în propriul dialog (mig 270).
  advance: (
    orderId: string,
    currentStatus: OrderStatus,
    payload: AdvanceOrderPayload,
    opts?: { throwOnError?: boolean },
  ) => Promise<boolean>
  byStatus: (statuses: OrderStatus[]) => Order[]
  /** Comenzile cu o acțiune în curs — butoanele lor stau dezactivate (anti dublu-tap). */
  pendingIds: ReadonlySet<string>
  /**
   * Eroarea ultimei acțiuni rapide eșuate, PE COMANDĂ, în română
   * (describeStaffActionError) — se afișează lângă butonul apăsat și dispare
   * singură după ACTION_ERROR_TTL_MS sau la următoarea acțiune pe comandă.
   */
  actionErrors: Readonly<Record<string, string>>
  dismissActionError: (orderId: string) => void
}

function withoutKey(
  rec: Readonly<Record<string, string>>,
  key: string,
): Readonly<Record<string, string>> {
  if (!(key in rec)) return rec
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(rec)) if (k !== key) next[k] = v
  return next
}

export function useOrders(
  restaurantId: string | null,
  view: 'kitchen' | 'waiter',
): UseOrdersResult {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Lista a fost plafonată la STAFF_ORDERS_FETCH_LIMIT (cele mai NOI comenzi
  // deschise) — paginile afișează un avertisment, nu tac (audit v3 RES-36).
  const [truncated, setTruncated] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>('connecting')
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [actionErrors, setActionErrors] = useState<Readonly<Record<string, string>>>({})
  // Sursa SINCRONĂ a lock-ului de dublu-tap: al doilea tap din același frame
  // vine înainte ca state-ul `pendingIds` să se fi re-randat.
  const pendingSetRef = useRef<Set<string>>(new Set())
  const errorTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // Generația vederii (restaurant + view): un advance/resync pornit pentru
  // restaurantul VECHI nu are voie să scrie în lista celui nou.
  const genRef = useRef(0)

  // Snapshot pentru handler-ul realtime (nu re-abonăm canalul la fiecare
  // schimbare de listă). Poate fi cu un frame în urmă — inofensiv: merge-ul
  // ia toate câmpurile volatile din rândul evenimentului, nu din snapshot.
  const ordersRef = useRef<Order[]>([])
  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  const upsertOrder = useCallback(
    (order: Order) => {
      setOrders((prev) => {
        if (!belongsInView(order, view)) return prev.filter((o) => o.id !== order.id)
        const idx = prev.findIndex((o) => o.id === order.id)
        if (idx === -1) return [order, ...prev]
        const next = [...prev]
        next[idx] = order
        return next
      })
    },
    [view],
  )

  const removeOrder = useCallback((orderId: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== orderId))
  }, [])

  useEffect(() => {
    if (!restaurantId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    genRef.current += 1
    pendingSetRef.current = new Set()
    setPendingIds(new Set<string>())
    setActionErrors({})
    // Guard de anulare (audit v3 DS-4): la comutarea restaurantului, răspunsul
    // ÎNTÂRZIAT al fetch-ului vechi nu are voie să suprascrie lista noului
    // restaurant (comenzile lui A afișate sub titlul lui B până la următorul poll).
    let cancelled = false
    const fetcher = view === 'kitchen' ? fetchKitchenOrders : fetchWaiterOrders
    fetcher(restaurantId)
      .then((page) => {
        if (cancelled) return
        setOrders(page.orders)
        setTruncated(page.truncated)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // Surfacing real al erorii: Supabase aruncă uneori un obiect simplu
        // ({ message, code, ... }) care NU e instanceof Error → nu masca mesajul
        // ca „Unknown error", ci citește `.message` și din obiect.
        const msg =
          e instanceof Error
            ? e.message
            : e && typeof e === 'object' && 'message' in e
              ? String((e as { message: unknown }).message)
              : 'Unknown error'
        setError(msg)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId, view])

  const channelRef = useRef<RealtimeChannel | null>(null)
  // Câte operații advance() sunt in-flight. Polling-ul nu suprascrie state-ul
  // cât timp > 0 (altfel ar reverti update-ul optimist înainte de RPC).
  const pendingAdvancesRef = useRef(0)
  // Câte advance()-uri au PORNIT. O listă cerută ÎNAINTEA unui advance și
  // sosită DUPĂ ce el s-a terminat e mai veche decât rezultatul lui: aplicată,
  // ar readuce comanda pe pasul de dinainte (iar cu realtime conectat nimic nu
  // o mai corecta până la heartbeat). Contorul spune dacă s-a întâmplat asta.
  const advanceEpochRef = useRef(0)
  // Câte acțiuni au pornit PE FIECARE comandă. Citirea rândului real după un
  // refuz (rollback-ul de mai jos) se aplică doar dacă între timp nu a pornit
  // altă acțiune pe ACEEAȘI comandă: altfel rândul, cerut înaintea ei, ar
  // suprascrie starea ei optimistă, iar cu realtime conectat nimic nu l-ar mai
  // corecta până la heartbeat (recenzie CodeRabbit pe #321, UA9). Per comandă,
  // nu epoca globală: o acțiune pe ALTĂ comandă nu are voie să arunce
  // corectura (UA10).
  const actionSeqRef = useRef(new Map<string, number>())
  // OPT-3: statusul realtime într-un ref — polling-ul îl consultă fără să
  // re-creeze intervalul la fiecare flap de status.
  const connectionStatusRef = useRef<RealtimeConnectionStatus>('connecting')
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Resincronizarea curentă (setată de efectul de mai jos, pe restaurant+view)
  // — ref, ca handler-ul canalului să n-o pună în dependențe (re-abonarea
  // canalului la fiecare schimbare ar pierde evenimente).
  const resyncRef = useRef<(force?: boolean) => void>(() => {})
  // Un resync cerut cât un advance e in-flight se amână până la finalul lui
  // (altfel ar suprascrie starea optimistă înainte de RPC).
  const resyncWantedRef = useRef(false)
  const lastResyncAtRef = useRef(0)

  useEffect(() => {
    if (!restaurantId) return
    const fetcher = view === 'kitchen' ? fetchKitchenOrders : fetchWaiterOrders
    let cancelled = false
    // Un semnal venit în fereastra de RESYNC_MIN_GAP_MS e AMÂNAT până la
    // capătul ei, nu aruncat. Pe telefonul care se trezește, `visibilitychange`
    // (sau `online`) și reconectarea canalului vin la ~1 s una de alta, iar
    // fetch-ul care contează e cel de DUPĂ reconectare: comenzile create între
    // cele două nu mai vin pe canal. Aruncat, al doilea semnal lăsa lista
    // incompletă până la heartbeat (~120 s cu realtime „conectat").
    let trailing: ReturnType<typeof setTimeout> | null = null
    resyncRef.current = (force = false) => {
      if (pendingAdvancesRef.current > 0) {
        resyncWantedRef.current = true
        return
      }
      const now = Date.now()
      // `since < 0` = ceasul a sărit înapoi: nu așteptăm o fereastră falsă.
      const since = now - lastResyncAtRef.current
      if (!force && since >= 0 && since < RESYNC_MIN_GAP_MS) {
        if (trailing == null) {
          trailing = setTimeout(() => {
            trailing = null
            resyncRef.current()
          }, RESYNC_MIN_GAP_MS - since)
        }
        return
      }
      if (trailing != null) {
        clearTimeout(trailing)
        trailing = null
      }
      lastResyncAtRef.current = now
      resyncWantedRef.current = false
      const epoch = advanceEpochRef.current
      fetcher(restaurantId)
        .then((page) => {
          if (cancelled) return
          if (pendingAdvancesRef.current > 0 || advanceEpochRef.current !== epoch) {
            // A pornit un advance DUPĂ ce lista a fost cerută: lista poate fi
            // mai veche decât rezultatul lui. N-o aplicăm; o cerem din nou (la
            // finalul advance-ului, dacă e încă în curs).
            resyncWantedRef.current = true
            if (pendingAdvancesRef.current === 0) resyncRef.current()
            return
          }
          setOrders((prev) => reconcileOrders(prev, page.orders))
          setTruncated(page.truncated)
          // Un fetch reușit închide bannerul de sincronizare (era lipicios).
          setError(null)
        })
        .catch(() => {
          /* păstrăm lista; heartbeat-ul reîncearcă */
        })
    }
    let hiddenAt: number | null =
      typeof document !== 'undefined' && document.hidden ? Date.now() : null
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now()
        return
      }
      const away = hiddenAt == null ? 0 : Date.now() - hiddenAt
      hiddenAt = null
      if (away >= RESYNC_AFTER_HIDDEN_MS) resyncRef.current()
    }
    const onOnline = () => resyncRef.current()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      if (trailing != null) clearTimeout(trailing)
      resyncRef.current = () => {}
      resyncWantedRef.current = false
      lastResyncAtRef.current = 0
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    }
  }, [restaurantId, view])

  useEffect(() => {
    if (!restaurantId) return
    setConnectionStatus('connecting')
    // Resetăm ȘI ref-ul (nu doar state-ul): la schimbarea restaurantului un
    // 'connected' vechi din ref ar face polling-ul să sară hidratarea corectă
    // și să ruleze throttled pe noul restaurant până la primul flap real.
    connectionStatusRef.current = 'connecting'
    // A fost canalul ACESTA vreodată conectat? Primul SUBSCRIBED nu cere
    // resync (fetch-ul inițial tocmai a adus lista); fiecare RE-conectare da.
    let everConnected = false
    // Timeout: dacă realtime nu raportează SUBSCRIBED în 12s, marcăm
    // disconnected (polling-ul preia datele). Evită bulina blocată pe galben.
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current)
    connectTimeoutRef.current = setTimeout(() => {
      setConnectionStatus((s) => (s === 'connecting' ? 'disconnected' : s))
    }, 12_000)

    const channel = subscribeToOrders(
      restaurantId,
      async (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'DELETE') {
          const deletedId = oldRow?.id
          if (typeof deletedId === 'string') removeOrder(deletedId)
          return
        }
        const orderId = newRow?.id
        if (typeof orderId !== 'string') return
        // UPDATE pe o comandă deja hidratată, cu total neschimbat (= doar
        // status/plată, vezi mergeRealtimeOrder) → aplicăm din payload.
        // Evită un SELECT cu join-uri per eveniment pe Bucătărie + Ospătar
        // în ora de vârf; INSERT-urile și editările de produse refetch-uiesc.
        if (eventType === 'UPDATE') {
          const existing = ordersRef.current.find((o) => o.id === orderId)
          // OPT-7: comandă ABSENTĂ din state, cu status în payload care nu
          // aparține view-ului (ex. served→paid pe Bucătărie) → zero interes,
          // sărim SELECT-ul cu join-uri. Statusul lipsă cade pe refetch.
          const newStatus = rtStr(newRow.status)
          if (!existing && newStatus !== null) {
            const phantom = { status: newStatus } as Order
            if (!belongsInView(phantom, view)) return
          }
          const newTotal = rtNum(newRow.total)
          // Fast-path DOAR pentru tranziții reale de status/plată (total neschimbat
          // ȘI un câmp de status/timestamp chiar s-a schimbat). O editare de produse
          // cu total identic cade pe refetch (altfel produse stale pe Bucătărie).
          if (
            existing &&
            newTotal !== null &&
            Math.abs(newTotal - existing.total) < 0.005 &&
            isStatusTransition(existing, newRow)
          ) {
            upsertOrder(mergeRealtimeOrder(existing, newRow))
            return
          }
        }
        try {
          const hydrated = await fetchOrderById(orderId)
          upsertOrder(hydrated)
        } catch {
          /* order outside SELECT access */
        }
      },
      (status) => {
        const prev = connectionStatusRef.current
        connectionStatusRef.current = status
        setConnectionStatus(status)
        if (status === 'connected' && connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
        if (status === 'connected' && prev !== 'connected') {
          // Evenimentele din fereastra în care canalul a fost căzut nu se
          // mai livrează — le recuperăm cu un fetch imediat.
          if (everConnected) resyncRef.current()
          everConnected = true
        }
      },
    )
    channelRef.current = channel
    return () => {
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
      }
      channelRef.current?.unsubscribe()
      channelRef.current = null
    }
    // `view` e citit în handler dar NU e dependență: re-abonarea canalului
    // realtime la fiecare comutare de view ar pierde evenimente în fereastra
    // de reconectare, degeaba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, upsertOrder, removeOrder])

  // Plasă de siguranță: refetch periodic chiar dacă realtime e OK.
  // Prinde scenariile când canalul a căzut tăcut (no SUBSCRIBED status) sau
  // când au apărut evenimente între unsubscribe și re-subscribe.
  // Guard-uri: (1) nu poll-uim când tab-ul e ascuns (cost inutil pe mobil),
  // (2) nu suprascriem dacă un advance() optimist e in-flight.
  useEffect(() => {
    if (!restaurantId) return
    const fetcher = view === 'kitchen' ? fetchKitchenOrders : fetchWaiterOrders
    // OPT-3: heartbeat, nu full-skip — cu realtime 'connected', fetch-ul
    // integral (join dublu pe toată lista) rulează doar la fiecare al 4-lea
    // tick (~120s); pe 'connecting'/'disconnected' rămâne la fiecare tick.
    // NU se sare definitiv: heartbeat-ul rar prinde căderile TĂCUTE de canal.
    let tick = 0
    // Același guard de anulare ca la fetch-ul inițial (DS-4): un heartbeat
    // pornit pentru restaurantul vechi nu reconciliază lista celui nou.
    let cancelled = false
    const interval = setInterval(() => {
      tick += 1
      if (typeof document !== 'undefined' && document.hidden) return
      if (pendingAdvancesRef.current > 0) return
      if (connectionStatusRef.current === 'connected' && tick % 4 !== 0) return
      const epoch = advanceEpochRef.current
      fetcher(restaurantId)
        .then((page) => {
          if (cancelled) return
          // Dublu-check: dacă între timp a pornit un advance — chiar și unul
          // deja terminat (epoca s-a schimbat) — lista e posibil mai veche
          // decât rezultatul lui: nu suprascrie.
          if (pendingAdvancesRef.current > 0 || advanceEpochRef.current !== epoch) return
          // OPT-7: reconciliere pe id cu păstrarea REFERINȚELOR — altfel
          // fiecare heartbeat crea obiecte noi pentru comenzi neschimbate,
          // re-randând tot arborele și invalidând orice memo pe carduri.
          setOrders((prev) => reconcileOrders(prev, page.orders))
          setTruncated(page.truncated)
          setError(null)
        })
        .catch(() => {
          /* ignore — păstrăm state-ul curent */
        })
    }, POLLING_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [restaurantId, view])

  const dismissActionError = useCallback((orderId: string) => {
    const t = errorTimersRef.current.get(orderId)
    if (t) {
      clearTimeout(t)
      errorTimersRef.current.delete(orderId)
    }
    setActionErrors((prev) => withoutKey(prev, orderId))
  }, [])

  const showActionError = useCallback((orderId: string, message: string) => {
    const old = errorTimersRef.current.get(orderId)
    if (old) clearTimeout(old)
    setActionErrors((prev) => ({ ...prev, [orderId]: message }))
    errorTimersRef.current.set(
      orderId,
      setTimeout(() => {
        errorTimersRef.current.delete(orderId)
        setActionErrors((prev) => withoutKey(prev, orderId))
      }, ACTION_ERROR_TTL_MS),
    )
  }, [])

  useEffect(() => {
    const timers = errorTimersRef.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
  }, [])

  const advance = useCallback(
    async (
      orderId: string,
      currentStatus: OrderStatus,
      payload: AdvanceOrderPayload,
      // throwOnError: după rollback, eroarea e RE-ARUNCATĂ (cu hint/code) ca
      // apelantul s-o afișeze în propriul dialog (plată / anulare). Fără el,
      // eroarea ajunge în `actionErrors[orderId]`, lângă butonul apăsat.
      opts?: { throwOnError?: boolean },
    ) => {
      // Dublu-tap (ux-staff-double-tap-advance): după primul tap starea
      // optimistă mută deja comanda la pasul următor, iar butonul ei arată
      // ACȚIUNEA următoare — al doilea tap o avansa încă o dată. Cât o acțiune
      // e în curs pe comandă, orice altă acțiune pe ea e refuzată pe loc.
      if (pendingSetRef.current.has(orderId)) {
        if (opts?.throwOnError) {
          throw Object.assign(new Error(describeStaffActionError({ hint: 'action_in_progress' })), {
            hint: 'action_in_progress',
          })
        }
        return false
      }
      const gen = genRef.current
      advanceEpochRef.current += 1
      const seq = (actionSeqRef.current.get(orderId) ?? 0) + 1
      actionSeqRef.current.set(orderId, seq)
      pendingSetRef.current.add(orderId)
      setPendingIds(new Set(pendingSetRef.current))
      dismissActionError(orderId)
      // Instantaneul pentru rollback se citește SINCRON (nu din updater-ul lui
      // setOrders, care poate rula abia la randare).
      const previous = ordersRef.current.find((o) => o.id === orderId)
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, ...payload } : o)))
      pendingAdvancesRef.current += 1
      try {
        // OPT-5: cu realtime conectat, evenimentul UPDATE aduce rândul
        // autoritativ prin fast-path-ul de merge — refetch-ul cu join dublu
        // de după RPC e redundant. Pe connecting/disconnected hidratăm ca
        // înainte (starea optimistă ar rămâne altfel singura sursă).
        const updated = await advanceOrderStatus(
          orderId,
          { ...payload, _currentStatus: currentStatus },
          { hydrate: connectionStatusRef.current !== 'connected' },
        )
        if (updated && gen === genRef.current) upsertOrder(updated)
        return true
      } catch (e: unknown) {
        if (gen === genRef.current) {
          if (previous !== undefined) {
            const snap = previous
            setOrders((prev) => {
              const idx = prev.findIndex((o) => o.id === orderId)
              if (idx === -1) return prev
              const next = [...prev]
              next[idx] = snap
              return next
            })
          }
          // Rollback-ul la instantaneu nu e neapărat ADEVĂRUL: cel mai des o
          // acțiune e respinsă tocmai fiindcă un coleg a mutat deja comanda
          // (invalid_transition). Cerem rândul real; dacă nici asta nu merge
          // (rețea), rămâne instantaneul.
          void fetchOrderById(orderId)
            .then((fresh) => {
              if (gen === genRef.current && actionSeqRef.current.get(orderId) === seq) {
                upsertOrder(fresh)
              }
            })
            .catch(() => {
              /* rămâne instantaneul */
            })
        }
        if (opts?.throwOnError) throw e
        if (gen === genRef.current) showActionError(orderId, describeStaffActionError(e))
        return false
      } finally {
        pendingAdvancesRef.current = Math.max(0, pendingAdvancesRef.current - 1)
        pendingSetRef.current.delete(orderId)
        if (gen === genRef.current) setPendingIds(new Set(pendingSetRef.current))
        if (pendingAdvancesRef.current === 0 && resyncWantedRef.current) resyncRef.current(true)
      }
    },
    [upsertOrder, dismissActionError, showActionError],
  )

  const byStatus = useCallback(
    (statuses: OrderStatus[]): Order[] => orders.filter((o) => statuses.includes(o.status)),
    [orders],
  )

  return {
    orders,
    loading,
    error,
    truncated,
    connectionStatus,
    advance,
    byStatus,
    pendingIds,
    actionErrors,
    dismissActionError,
  }
}

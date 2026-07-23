// ─────────────────────────────────────────────────────────────
// offlineSync.ts — Offline queue pentru comenzi ospătar
//
// Flux:
//   createOrder() detectează offline → savePendingOrder() → IDB
//   window 'online' event / Background Sync API → syncPendingOrders()
//   syncPendingOrders() → flush IDB → create_order RPC
//
// Scoped DOAR pe source='waiter'. Clienții QR sunt online by definition.
// ─────────────────────────────────────────────────────────────

import { get, set } from 'idb-keyval'
import type { CreateOrderArgs, OrderConfirmationPayload } from './orders'
import { supabase } from './supabase'

const QUEUE_KEY = 'menuvia_offline_orders'
const MAX_RETRIES = 3 // Câte retry-uri pe comandă înainte de a o abandona
const MAX_QUEUE = 100 // Câte comenzi maxim în queue (safety)

export interface QueuedOrder {
  localId: string // UUID local — nu e ID-ul din Supabase
  queuedAt: number // timestamp ms
  retries: number // câte sync-uri au eșuat pentru asta
  lastError?: string // ultimul mesaj de eroare (debug)
  queuedBy?: string // user.id care a pus comanda în coadă (anti mis-atribuire pe device partajat)
  payload: CreateOrderArgs
}

// Eroare PERMANENTĂ (business/DB) → comanda e invalidă, o eliminăm din coadă.
// Doar SQLSTATE-uri clare: clasa 22 (data exception), 23 (integrity constraint),
// P0 (raise din PL/pgSQL). ORICE altceva (rețea, gateway, JWT, necunoscut) e tratat
// ca tranzitoriu → retry, ca să NU pierdem comenzi valide pe o eroare ambiguă.
function isPermanentOrderError(error: { code?: string } | null | undefined): boolean {
  const code = error?.code
  return typeof code === 'string' && /^(22|23|P0)/.test(code)
}

// ─── IDB helpers ─────────────────────────────────────────────

export async function getPendingOrders(): Promise<QueuedOrder[]> {
  try {
    return (await get<QueuedOrder[]>(QUEUE_KEY)) ?? []
  } catch (err) {
    console.error('[offlineSync] IDB read error:', err)
    return []
  }
}

async function saveQueue(queue: QueuedOrder[]): Promise<void> {
  await set(QUEUE_KEY, queue)
  window.dispatchEvent(new CustomEvent('offline-queue-updated', { detail: queue.length }))
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Adaugă o comandă în queue-ul local (IDB).
 * Returnează un mock OrderConfirmationPayload pentru a ține UI-ul funcțional.
 * short_id va fi `LOCAL-XXXX` pentru a fi vizibil distinct față de comenzile reale.
 */
export async function savePendingOrder(args: CreateOrderArgs): Promise<OrderConfirmationPayload> {
  const queue = await getPendingOrders()

  // Safety limit — previne umplerea IDB-ului la infinit
  if (queue.length >= MAX_QUEUE) {
    throw new Error(`Queue offline plin (${MAX_QUEUE} comenzi). Reconnectează-te pentru a trimite.`)
  }

  const localId = crypto.randomUUID()
  const shortNum = String(Math.floor(Math.random() * 9000) + 1000) // 4 cifre random

  // Cheie de idempotență STABILĂ, fixată la ENQUEUE (nu la trimitere).
  // Serverul deduplică pe (restaurant_id, idempotency_key) — index UNIQUE,
  // mig 088. Persistăm key-ul în payload și îl refolosim identic la fiecare
  // retry, astfel încât un succes ne-confirmat urmat de reconectare NU creează
  // o a doua comandă. Dacă apelantul a furnizat deja un key (ex. WaiterEntry),
  // îl păstrăm; altfel generăm unul aici.
  const payload: CreateOrderArgs = {
    ...args,
    idempotency_key: args.idempotency_key ?? crypto.randomUUID(),
  }

  // Stampăm user.id-ul care a creat comanda offline. La sync, o comandă e trimisă
  // DOAR dacă sesiunea curentă aparține aceluiași user — altfel pe un device partajat
  // (ospătar A → logout → ospătar B) comenzile lui A s-ar crea sub sesiunea lui B.
  // getSession() citește din storage local, deci funcționează și offline.
  // Fail-closed: o comandă nouă TREBUIE atribuită unui user. Dacă sesiunea nu e
  // disponibilă, nu o punem în coadă cu queuedBy=undefined (ar putea fi sincronizată
  // sub alt ospătar pe un device partajat). Toleranța pentru undefined rămâne DOAR în
  // syncPendingOrders, pentru intrările vechi (legacy) deja existente în coadă.
  let queuedBy: string
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.user?.id) throw new Error('no-session')
    queuedBy = session.user.id
  } catch {
    throw new Error('Sesiune indisponibilă — reconectează-te înainte de a salva comanda offline.')
  }

  const entry: QueuedOrder = {
    localId,
    queuedAt: Date.now(),
    retries: 0,
    queuedBy,
    payload,
  }

  queue.push(entry)
  await saveQueue(queue)

  // Background Sync — dacă browser-ul suportă, SW va triggeriza sync
  // chiar dacă tab-ul e în background când conexiunea revine
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready
      // Background Sync API — nu e în TypeScript lib standard
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ('sync' in reg) await (reg as any).sync.register('sync-orders')
    } catch {
      // Background Sync nesuportat (Firefox, Safari) — sync manual la 'online' event
    }
  }

  // Mock payload — UI-ul afișează comanda cu badge distinctiv
  const total = args.cart.reduce(
    (s, i) =>
      s +
      (i.unit_price_snapshot + i.selected_modifiers.reduce((m, x) => m + x.price_delta, 0)) *
        i.quantity,
    0,
  )

  return {
    id: localId,
    short_id: `LOCAL-${shortNum}`, // Ospătarul vede că e în așteptare
    status: 'new',
    total,
    created_at: new Date().toISOString(),
  }
}

// ─── Sync engine ──────────────────────────────────────────────

let isSyncing = false

/**
 * Încearcă să trimită toate comenzile din queue la Supabase.
 * Se oprește dacă se pierde conexiunea în mijlocul sync-ului.
 * Comenzile cu prea multe retry-uri sunt eliminate din queue (cu log).
 */
export async function syncPendingOrders(): Promise<void> {
  if (isSyncing) return
  if (!navigator.onLine) return

  const queue = await getPendingOrders()
  if (queue.length === 0) return

  // Verifică sesiunea — dacă a expirat, nu putem trimite
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) {
    console.warn(
      '[offlineSync] Sesiune expirată — sync amânat. Utilizatorul trebuie să se reconecteze.',
    )
    window.dispatchEvent(new CustomEvent('offline-sync-auth-required'))
    return
  }

  isSyncing = true
  console.log(`[offlineSync] Start sync: ${queue.length} comenzi în queue`)

  try {
  for (const item of queue) {
    // Dacă s-a pierdut conexiunea în mijlocul loop-ului, oprim
    if (!navigator.onLine) {
      console.log('[offlineSync] Conexiune pierdută în mijlocul sync-ului. Oprit.')
      break
    }

    // Prea multe retry-uri → abandonăm comanda (business logic error, nu rețea)
    if (item.retries >= MAX_RETRIES) {
      console.error(`[offlineSync] Comandă abandonată după ${MAX_RETRIES} retry-uri:`, item)
      await removeFromQueue(item.localId)
      continue
    }

    // Anti mis-atribuire: nu trimitem comanda altui user sub sesiunea curentă.
    // O lăsăm în coadă pentru când userul ei se reconectează. (Comenzile legacy
    // fără queuedBy rămân compatibile — se trimit ca înainte.)
    if (item.queuedBy && item.queuedBy !== session.user.id) {
      console.warn('[offlineSync] Comandă a altui user — sărită până la reconectarea lui:', item.localId)
      continue
    }

    try {
      // Construim p_items exact ca în createOrder() din orders.ts
      const p_items = item.payload.cart.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        option_ids: i.selected_modifiers.map((m) => m.option_id),
        extra_ids: (i.selected_extras ?? []).map((e) => e.id),
        upsell_source: i.upsell_source ?? null,
        notes: i.notes ?? null,
      }))

      // B1 (mig 145): semnătura 7-arg a fost DROP-uită; trimitem semnătura 11-arg
      // completă (null pt pickup/customer/session — comenzile offline sunt source='waiter',
      // fără sesiune de masă), identic cu orders.ts. Un singur overload viu = fără ambiguitate.
      const { error } = await supabase.rpc('create_order', {
        p_restaurant_id: item.payload.restaurant_id,
        p_source: item.payload.source,
        p_table_id: item.payload.table_id ?? null,
        p_qr_token_id: item.payload.qr_token_id ?? null,
        p_notes: item.payload.notes ?? null,
        p_items,
        p_idempotency_key: item.payload.idempotency_key ?? null,
        p_pickup_time: null,
        p_customer_name: null,
        p_customer_phone: null,
        p_session_id: null,
      })

      if (error) {
        // Doar erorile clare de business/DB (SQLSTATE 22/23/P0) elimină comanda.
        // Erorile ambigue/de rețea → retry, NU ștergem (anti pierdere de comenzi).
        if (isPermanentOrderError(error)) {
          console.error('[offlineSync] Eroare business logic, comandă eliminată:', error)
          await removeFromQueue(item.localId)
          // O comandă offline ștearsă permanent (ex. produs șters / grup obligatoriu
          // schimbat mid-flow) NU trebuie să dispară TĂCUT — ospătarul crede că s-a
          // trimis. Anunțăm UI-ul (WaiterPage) ca să afișeze un banner „reintroду comanda".
          window.dispatchEvent(
            new CustomEvent('offline-order-dropped', {
              detail: { reason: error.message ?? 'eroare necunoscută', localId: item.localId },
            }),
          )
          continue
        }
        // Tranzitoriu (rețea, gateway, JWT, necunoscut) → oprim, reluăm la 'online'.
        // NU folosim markRetry: ar incrementa retries și după MAX_RETRIES comanda ar fi
        // ștearsă — o pierdere de comandă validă pe o pană prelungită. Doar notăm eroarea.
        console.warn('[offlineSync] Eroare tranzitorie mid-sync:', error.message)
        await markTransientError(item.localId, error.message ?? 'unknown')
        break
      }

      // Succes ✓
      console.log(`[offlineSync] Comandă sincronizată: ${item.localId}`)
      await removeFromQueue(item.localId)
    } catch (err) {
      // TypeError de rețea → oprim sync-ul. Tranzitoriu → NU incrementăm retries
      // (altfel s-ar șterge după MAX_RETRIES la o pană prelungită).
      console.warn('[offlineSync] Excepție rețea:', err)
      await markTransientError(item.localId, err instanceof Error ? err.message : String(err))
      break
    }
  }
  } finally {
    // isSyncing se reseteaza MEREU — chiar daca markTransientError/IDB arunca, altfel
    // flag-ul ar ramane true si ar bloca permanent sync-ul in acest tab.
    isSyncing = false
  }

  // Notifică UI că sync-ul s-a terminat
  const remaining = await getPendingOrders()
  window.dispatchEvent(new CustomEvent('offline-queue-updated', { detail: remaining.length }))
  if (remaining.length === 0) {
    window.dispatchEvent(new CustomEvent('offline-sync-complete'))
  }
}

// ─── Internal helpers ─────────────────────────────────────────

async function removeFromQueue(localId: string): Promise<void> {
  const queue = await getPendingOrders()
  await saveQueue(queue.filter((q) => q.localId !== localId))
}

// Eroare TRANZITORIE (rețea/gateway/JWT/necunoscut): notăm doar lastError, FĂRĂ să
// incrementăm retries — astfel o pană prelungită nu duce comanda în pragul MAX_RETRIES
// (ștergere). Comenzile valide rămân în coadă până se sincronizează. Erorile permanente
// de business sunt eliminate separat (isPermanentOrderError), iar MAX_QUEUE plafonează coada.
async function markTransientError(localId: string, errMsg: string): Promise<void> {
  const queue = await getPendingOrders()
  const updated = queue.map((q) =>
    q.localId === localId ? { ...q, lastError: errMsg } : q,
  )
  await saveQueue(updated)
}

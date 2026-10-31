// Coada comenzilor de ospătar salvate DOAR pe telefon (lib/offlineSync.ts),
// scoasă din WaiterPage și făcută să se golească SINGURĂ.
//
// Până acum trimiterea pornea doar la evenimentul `online` și la mesajul
// Background Sync al service worker-ului (care nu există pe Safari/Firefox).
// O comandă pusă în coadă cu `navigator.onLine` ADEVĂRAT — Wi-Fi-ul
// localului „conectat" dar fără internet, sau „Load failed" pe iPhone — nu
// mai primea niciodată un `online`, deci stătea pe telefon până la un reload,
// iar bannerul verde „Se sincronizează comenzile..." mințea. La fel după o
// repornire a aplicației cu comenzi rămase în coadă: la montare doar le
// număra. Acum: încercare la montare, la revenirea în prim-plan, la `online`
// și periodic cât coada nu e goală.
//
// Sesiunea expirată blochează trimiterea (offlineSync nu trimite comenzile sub
// alt cont) — înainte era doar un console.warn; acum pagina o spune.
import { useCallback, useEffect, useState } from 'react'
import { getPendingOrders, syncPendingOrders } from '../lib/offlineSync'

/** Cât de des se reîncearcă trimiterea cât există comenzi salvate pe telefon. */
export const OFFLINE_RETRY_MS = 30_000

export interface OfflineOrderQueue {
  isOffline: boolean
  /** Comenzi salvate pe telefon, încă netrimise. */
  pendingCount: number
  /** O comandă respinsă DEFINITIV de server la trimitere — trebuie reintrodusă. */
  droppedReason: string | null
  dismissDropped: () => void
  /** Sesiunea a expirat: comenzile din coadă așteaptă o reconectare. */
  authRequired: boolean
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function trySync(): void {
  if (!isOnline()) return
  syncPendingOrders().catch((e: unknown) => {
    console.error('[useOfflineOrderQueue] sincronizarea a eșuat:', e)
  })
}

export function useOfflineOrderQueue(): OfflineOrderQueue {
  const [isOffline, setIsOffline] = useState(() => !isOnline())
  const [pendingCount, setPendingCount] = useState(0)
  const [droppedReason, setDroppedReason] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)

  useEffect(() => {
    let alive = true
    function handleOnline(): void {
      setIsOffline(false)
      trySync()
    }
    function handleOffline(): void {
      setIsOffline(true)
    }
    function handleQueueUpdate(e: Event): void {
      const n = (e as CustomEvent<number>).detail
      if (typeof n !== 'number') return
      setPendingCount(n)
      if (n === 0) setAuthRequired(false)
    }
    function handleAuthRequired(): void {
      setAuthRequired(true)
    }
    function handleDropped(e: Event): void {
      const detail = (e as CustomEvent<{ reason?: string } | undefined>).detail
      setDroppedReason(detail?.reason ?? 'eroare necunoscută')
    }
    function handleVisibility(): void {
      if (!document.hidden) trySync()
    }
    // Background Sync (Chrome): service worker-ul cere trimiterea.
    function handleSwMessage(e: MessageEvent): void {
      const data = e.data as { type?: unknown } | null
      if (data && data.type === 'SYNC_NOW') trySync()
    }

    // La montare: numărăm ȘI trimitem ce a rămas (repornire a aplicației).
    getPendingOrders()
      .then((q) => {
        if (!alive) return
        setPendingCount(q.length)
        if (q.length > 0) trySync()
      })
      .catch(() => {})

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('offline-queue-updated', handleQueueUpdate)
    window.addEventListener('offline-sync-auth-required', handleAuthRequired)
    window.addEventListener('offline-order-dropped', handleDropped)
    document.addEventListener('visibilitychange', handleVisibility)
    navigator.serviceWorker?.addEventListener('message', handleSwMessage)
    return () => {
      alive = false
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('offline-queue-updated', handleQueueUpdate)
      window.removeEventListener('offline-sync-auth-required', handleAuthRequired)
      window.removeEventListener('offline-order-dropped', handleDropped)
      document.removeEventListener('visibilitychange', handleVisibility)
      navigator.serviceWorker?.removeEventListener('message', handleSwMessage)
    }
  }, [])

  // Reîncercare periodică DOAR cât coada nu e goală — fără `online` (Wi-Fi
  // fără internet, iPhone) comenzile tot pleacă singure când revine rețeaua.
  useEffect(() => {
    if (pendingCount === 0) return
    const id = setInterval(trySync, OFFLINE_RETRY_MS)
    return () => clearInterval(id)
  }, [pendingCount])

  const dismissDropped = useCallback(() => setDroppedReason(null), [])

  return { isOffline, pendingCount, droppedReason, dismissDropped, authRequired }
}

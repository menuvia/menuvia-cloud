// Comenzile ospătarului salvate pe telefon pleacă SINGURE. Înainte trimiterea
// pornea doar la `online` / Background Sync (inexistent pe Safari): o comandă
// pusă în coadă cu `navigator.onLine` adevărat (Wi-Fi fără internet, „Load
// failed" pe iPhone) sau rămasă după o repornire a aplicației stătea pe telefon
// până la un reload — iar bannerul verde spunea „Se sincronizează".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const m = vi.hoisted(() => ({
  getPendingOrders: vi.fn(),
  syncPendingOrders: vi.fn(),
}))
vi.mock('../../lib/offlineSync', () => m)

import { useOfflineOrderQueue, OFFLINE_RETRY_MS } from '../useOfflineOrderQueue'

let online = true

async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function emit(name: string, detail?: unknown): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(name, { detail }))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  m.getPendingOrders.mockReset()
  m.syncPendingOrders.mockReset()
  m.syncPendingOrders.mockResolvedValue(undefined)
  online = true
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'onLine')
  vi.useRealTimers()
})

describe('useOfflineOrderQueue', () => {
  it('OQ1 comenzi rămase în coadă la deschidere → trimitere IMEDIATĂ, nu doar numărare', async () => {
    // Mutație: doar `setPendingCount(q.length)` la montare (codul vechi din
    // WaiterPage) → syncPendingOrders nu e chemat.
    m.getPendingOrders.mockResolvedValue([{ localId: 'a' }, { localId: 'b' }])
    const { result } = renderHook(() => useOfflineOrderQueue())
    await tick(0)
    expect(result.current.pendingCount).toBe(2)
    expect(m.syncPendingOrders).toHaveBeenCalledTimes(1)
  })

  it('OQ2 fără niciun eveniment `online` (Wi-Fi fără internet, iPhone), reîncearcă periodic', async () => {
    // Mutație: fără intervalul de reîncercare → rămâne la 1 apel.
    m.getPendingOrders.mockResolvedValue([{ localId: 'a' }])
    renderHook(() => useOfflineOrderQueue())
    await tick(0)
    expect(m.syncPendingOrders).toHaveBeenCalledTimes(1)
    await tick(OFFLINE_RETRY_MS)
    expect(m.syncPendingOrders).toHaveBeenCalledTimes(2)
    await tick(OFFLINE_RETRY_MS)
    expect(m.syncPendingOrders).toHaveBeenCalledTimes(3)
  })

  it('OQ3 control: coadă goală → nicio trimitere, nici periodică', async () => {
    m.getPendingOrders.mockResolvedValue([])
    renderHook(() => useOfflineOrderQueue())
    await tick(0)
    await tick(OFFLINE_RETRY_MS * 3)
    expect(m.syncPendingOrders).not.toHaveBeenCalled()
  })

  it('OQ4 coada golită de sincronizare → reîncercarea periodică se oprește', async () => {
    m.getPendingOrders.mockResolvedValue([{ localId: 'a' }])
    const { result } = renderHook(() => useOfflineOrderQueue())
    await tick(0)
    await emit('offline-queue-updated', 0)
    expect(result.current.pendingCount).toBe(0)
    await tick(OFFLINE_RETRY_MS * 3)
    expect(m.syncPendingOrders).toHaveBeenCalledTimes(1)
  })

  it('OQ5 offline real → nu încearcă degeaba; la `online` trimite', async () => {
    online = false
    m.getPendingOrders.mockResolvedValue([{ localId: 'a' }])
    const { result } = renderHook(() => useOfflineOrderQueue())
    await tick(0)
    await tick(OFFLINE_RETRY_MS)
    expect(result.current.isOffline).toBe(true)
    expect(m.syncPendingOrders).not.toHaveBeenCalled()
    online = true
    await emit('online')
    expect(result.current.isOffline).toBe(false)
    expect(m.syncPendingOrders).toHaveBeenCalledTimes(1)
  })

  it('OQ6 sesiunea expirată se SPUNE (înainte era doar console.warn), iar coada golită o stinge', async () => {
    m.getPendingOrders.mockResolvedValue([{ localId: 'a' }])
    const { result } = renderHook(() => useOfflineOrderQueue())
    await tick(0)
    await emit('offline-sync-auth-required')
    expect(result.current.authRequired).toBe(true)
    await emit('offline-queue-updated', 0)
    expect(result.current.authRequired).toBe(false)
  })

  it('OQ7 comanda respinsă definitiv ajunge în pagină și se poate închide', async () => {
    m.getPendingOrders.mockResolvedValue([])
    const { result } = renderHook(() => useOfflineOrderQueue())
    await tick(0)
    await emit('offline-order-dropped', { reason: 'produs inactiv' })
    expect(result.current.droppedReason).toBe('produs inactiv')
    act(() => {
      result.current.dismissDropped()
    })
    expect(result.current.droppedReason).toBeNull()
  })
})

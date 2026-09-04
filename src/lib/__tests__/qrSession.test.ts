// Teste pe snapshot-ul sesiunii QR (audit v3, FC-02) — remedierea de client
// care nu avea plasă. Fără ele, o regresie pe rehidratare se vede abia în
// teren: clientul pierde bannerul de urmărire și „Plătește online" după ce
// iOS evacuează tab-ul, iar nota există server-side.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadQrSessionSnapshot, saveQrSessionSnapshot, clearQrSessionSnapshot } from '../qrSession'
import type { OrderConfirmationPayload } from '../orders'

const TOKEN = 'tok-abc'
const KEY = 'menuvia_qr_session:' + TOKEN

function conf(id: string, total: number): OrderConfirmationPayload {
  return {
    id,
    short_id: id.toUpperCase(),
    status: 'new',
    total,
    created_at: '2026-09-01T10:00:00Z',
  }
}

describe('qrSession — snapshot-ul mesei', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
  })

  it('fără nimic salvat întoarce null', () => {
    expect(loadQrSessionSnapshot(TOKEN)).toBeNull()
  })

  it('salvează și rehidratează comenzile, sesiunea și notele plătite', () => {
    saveQrSessionSnapshot(TOKEN, {
      previousOrders: [conf('o1', 42.5)],
      sessionId: 'sess-1',
      paidOrderIds: ['o1'],
    })
    const snap = loadQrSessionSnapshot(TOKEN)
    expect(snap).not.toBeNull()
    expect(snap?.previousOrders).toHaveLength(1)
    expect(snap?.previousOrders[0].id).toBe('o1')
    expect(snap?.sessionId).toBe('sess-1')
    expect(snap?.paidOrderIds).toEqual(['o1'])
  })

  it('snapshot-ul e izolat per token (masa A nu apare sub masa B)', () => {
    saveQrSessionSnapshot(TOKEN, {
      previousOrders: [conf('o1', 10)],
      sessionId: 'sess-A',
      paidOrderIds: [],
    })
    expect(loadQrSessionSnapshot('alt-token')).toBeNull()
  })

  it('un snapshot GOL șterge cheia în loc să scrie o stare inutilă', () => {
    saveQrSessionSnapshot(TOKEN, {
      previousOrders: [conf('o1', 10)],
      sessionId: 'sess-1',
      paidOrderIds: [],
    })
    expect(sessionStorage.getItem(KEY)).not.toBeNull()

    saveQrSessionSnapshot(TOKEN, { previousOrders: [], sessionId: null, paidOrderIds: [] })
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('expiră după TTL (6h) și curăță cheia — o notă închisă nu reînvie', () => {
    const t0 = new Date('2026-09-01T10:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    saveQrSessionSnapshot(TOKEN, {
      previousOrders: [conf('o1', 10)],
      sessionId: 'sess-1',
      paidOrderIds: [],
    })
    // La 5h59m încă e validă.
    vi.setSystemTime(new Date(t0.getTime() + 5 * 3600_000 + 59 * 60_000))
    expect(loadQrSessionSnapshot(TOKEN)).not.toBeNull()
    // La 6h01m a expirat ȘI cheia dispare (nu rămâne gunoi în storage).
    vi.setSystemTime(new Date(t0.getTime() + 6 * 3600_000 + 60_000))
    expect(loadQrSessionSnapshot(TOKEN)).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('JSON corupt nu aruncă — întoarce null', () => {
    sessionStorage.setItem(KEY, '{nu e json')
    expect(loadQrSessionSnapshot(TOKEN)).toBeNull()
  })

  it('filtrează intrările care nu sunt confirmări valide', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        previousOrders: [{ id: 'o1', total: 10 }, { id: 'fara-total' }, 'text', null],
        sessionId: 42, // tip greșit → null
        paidOrderIds: ['ok', 7],
        savedAt: Date.now(),
      }),
    )
    const snap = loadQrSessionSnapshot(TOKEN)
    expect(snap?.previousOrders.map((o) => o.id)).toEqual(['o1'])
    expect(snap?.sessionId).toBeNull()
    expect(snap?.paidOrderIds).toEqual(['ok'])
  })

  it('clear șterge snapshot-ul', () => {
    saveQrSessionSnapshot(TOKEN, {
      previousOrders: [conf('o1', 10)],
      sessionId: 'sess-1',
      paidOrderIds: [],
    })
    clearQrSessionSnapshot(TOKEN)
    expect(loadQrSessionSnapshot(TOKEN)).toBeNull()
  })
})

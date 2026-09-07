// Teste pe cheile de idempotență QR (sessionStorage per token) — capcana
// documentată în CLAUDE.md: cheia se rotește PE SUCCES, altfel un coș nou
// după refresh refolosește cheia comenzii trimise → dedup server → comandă
// pierdută tăcut. Aici verificăm contractul de storage al helperelor.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import {
  getQrIdempotencyKey,
  rotateQrIdempotencyKey,
  getPickupIdempotencyKey,
  rotatePickupIdempotencyKey,
} from '../orders'

const TOKEN = 'tok-abc'
const STORAGE_KEY = 'menuvia_idem:' + TOKEN

describe('idempotență QR — getQrIdempotencyKey / rotateQrIdempotencyKey', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('generează o cheie nouă și o PERSISTĂ la prima citire', () => {
    const key = getQrIdempotencyKey(TOKEN)
    expect(key).toBeTruthy()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(key)
  })

  it('citirile repetate întorc ACEEAȘI cheie (retry-ul unei comenzi = același dedup)', () => {
    const first = getQrIdempotencyKey(TOKEN)
    expect(getQrIdempotencyKey(TOKEN)).toBe(first)
    expect(getQrIdempotencyKey(TOKEN)).toBe(first)
  })

  it('rotația scrie IMEDIAT noua cheie în sessionStorage (nu doar în state React)', () => {
    const old = getQrIdempotencyKey(TOKEN)
    const rotated = rotateQrIdempotencyKey(TOKEN)
    expect(rotated).not.toBe(old)
    // Un refresh de pagină după rotație trebuie să citească cheia NOUĂ —
    // altfel comanda următoare ar fi deduplicată de server pe cheia veche.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(rotated)
    expect(getQrIdempotencyKey(TOKEN)).toBe(rotated)
  })

  it('token-uri diferite (mese diferite) au chei independente', () => {
    const a = getQrIdempotencyKey('tok-a')
    const b = getQrIdempotencyKey('tok-b')
    expect(a).not.toBe(b)
    rotateQrIdempotencyKey('tok-a')
    // Rotația mesei A nu atinge cheia mesei B.
    expect(getQrIdempotencyKey('tok-b')).toBe(b)
  })
})

// ── PICKUP (audit v3 FC-01 / RES-24) ─────────────────────────────────────────
// Cheia pickup e SINGURA barieră contra comenzii duble la răspuns pierdut (nu
// există backstop server dincolo de idempotency_key). Persistă în sessionStorage
// per restaurant și cade pe un fallback în MEMORIE când storage-ul lipsește —
// o cheie nouă la fiecare apel ar anula exact protecția.

// Fallback-ul e un Map la nivel de MODUL (supraviețuiește între teste) →
// fiecare test folosește un scope distinct.
describe('idempotență PICKUP — get/rotatePickupIdempotencyKey', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function breakStorage(): void {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
  }

  it('P1 prima citire generează + PERSISTĂ cheia', () => {
    const key = getPickupIdempotencyKey('p1')
    expect(key).toBeTruthy()
    expect(sessionStorage.getItem('menuvia_idem_pickup:p1')).toBe(key)
  })

  it('P2 citirile repetate întorc aceeași cheie', () => {
    const first = getPickupIdempotencyKey('p2')
    expect(getPickupIdempotencyKey('p2')).toBe(first)
    expect(getPickupIdempotencyKey('p2')).toBe(first)
  })

  it('P3 rotația scrie IMEDIAT cheia nouă în storage', () => {
    const old = getPickupIdempotencyKey('p3')
    const rotated = rotatePickupIdempotencyKey('p3')
    expect(rotated).not.toBe(old)
    expect(sessionStorage.getItem('menuvia_idem_pickup:p3')).toBe(rotated)
    expect(getPickupIdempotencyKey('p3')).toBe(rotated)
  })

  it('P4 scope-urile sunt independente', () => {
    const a = getPickupIdempotencyKey('p4a')
    const b = getPickupIdempotencyKey('p4b')
    rotatePickupIdempotencyKey('p4a')
    expect(getPickupIdempotencyKey('p4b')).toBe(b)
    expect(getPickupIdempotencyKey('p4a')).not.toBe(a)
  })

  it('P5 storage indisponibil → aceeași cheie din memorie (nu una nouă la fiecare apel)', () => {
    breakStorage()
    const k1 = getPickupIdempotencyKey('p5')
    expect(getPickupIdempotencyKey('p5')).toBe(k1)
    expect(getPickupIdempotencyKey('p5')).toBe(k1)
  })

  it('P6 storage indisponibil → rotația actualizează fallback-ul', () => {
    breakStorage()
    const k1 = getPickupIdempotencyKey('p6')
    const r = rotatePickupIdempotencyKey('p6')
    expect(r).not.toBe(k1)
    expect(getPickupIdempotencyKey('p6')).toBe(r)
  })

  it('P7 cheia veche din storage e ȘTEARSĂ când scrierea celei noi eșuează', () => {
    sessionStorage.setItem('menuvia_idem_pickup:p7', 'old-key')
    expect(getPickupIdempotencyKey('p7')).toBe('old-key')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    const r = rotatePickupIdempotencyKey('p7')
    expect(r).not.toBe('old-key')
    // Un remount NU are voie să recitească cheia comenzii deja trimise.
    expect(sessionStorage.getItem('menuvia_idem_pickup:p7')).toBeNull()
    expect(getPickupIdempotencyKey('p7')).toBe(r)
  })

  it('P8 storage-ul revine → cheia din memorie se re-persistă, nu una nouă', () => {
    breakStorage()
    const k = getPickupIdempotencyKey('p8')
    vi.restoreAllMocks()
    expect(getPickupIdempotencyKey('p8')).toBe(k)
    expect(sessionStorage.getItem('menuvia_idem_pickup:p8')).toBe(k)
  })
})

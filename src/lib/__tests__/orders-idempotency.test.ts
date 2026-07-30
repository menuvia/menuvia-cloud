// Teste pe cheile de idempotență QR (sessionStorage per token) — capcana
// documentată în CLAUDE.md: cheia se rotește PE SUCCES, altfel un coș nou
// după refresh refolosește cheia comenzii trimise → dedup server → comandă
// pierdută tăcut. Aici verificăm contractul de storage al helperelor.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import { getQrIdempotencyKey, rotateQrIdempotencyKey } from '../orders'

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

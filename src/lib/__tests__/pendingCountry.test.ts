// Țara de onboarding NESALVATĂ — lib/pendingCountry.ts (review #288).
//   PC-A  pe 'RO' (și cod necunoscut) nu se păstrează NIMIC — fluxul .ro neatins
//   PC-B  UPDATE reușit → intenția se ȘTERGE; UPDATE picat (error SAU throw) →
//         intenția RĂMÂNE pentru următoarea încărcare
//   PC-C  restaurantul are deja țara → fără UPDATE, intenția se șterge
//   PC-D  non-owner → fără UPDATE, intenția rămâne (trigger-ul din DB ar respinge)
//   PC-E  storage care ARUNCĂ (Safari „Block All Cookies") → fail-open, fără excepție
//   PC-F  cheie per restaurant: intenția lui A nu se aplică pe B
import { describe, it, expect } from 'vitest'
import {
  PENDING_COUNTRY_PREFIX,
  clearPendingCountry,
  readPendingCountry,
  retryPendingCountry,
  storePendingCountry,
  type CountryPatch,
  type KeyValueStorage,
} from '../pendingCountry'

function memStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('SecurityError')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  },
}

describe('pendingCountry', () => {
  it('PC-A: RO / cod necunoscut → nimic păstrat', () => {
    const s = memStorage()
    storePendingCountry('r1', 'RO', s)
    storePendingCountry('r1', 'XX', s)
    expect(s.map.size).toBe(0)
    storePendingCountry('r1', 'DE', s)
    expect(s.map.get(PENDING_COUNTRY_PREFIX + 'r1')).toBe('DE')
    expect(readPendingCountry('r1', s)).toBe('DE')
  })

  it('PC-B: succes → șters; eșec (error sau throw) → păstrat', async () => {
    const s = memStorage()
    storePendingCountry('r1', 'DE', s)
    const calls: CountryPatch[] = []

    const failed = await retryPendingCountry({
      restaurantId: 'r1',
      currentCountry: 'RO',
      isOwner: true,
      update: async (p) => {
        calls.push(p)
        return { error: { message: 'network' } }
      },
      storage: s,
    })
    expect(failed).toBe('failed')
    expect(readPendingCountry('r1', s)).toBe('DE')

    const thrown = await retryPendingCountry({
      restaurantId: 'r1',
      currentCountry: 'RO',
      isOwner: true,
      update: async () => {
        throw new Error('offline')
      },
      storage: s,
    })
    expect(thrown).toBe('failed')
    expect(readPendingCountry('r1', s)).toBe('DE')

    const saved = await retryPendingCountry({
      restaurantId: 'r1',
      currentCountry: 'RO',
      isOwner: true,
      update: async (p) => {
        calls.push(p)
        return { error: null }
      },
      storage: s,
    })
    expect(saved).toBe('saved')
    expect(readPendingCountry('r1', s)).toBeNull()
    // Patch-ul complet: țară + monedă + fus (ca la onboarding).
    expect(calls[calls.length - 1]).toEqual({
      country: 'DE',
      currency: 'EUR',
      timezone: 'Europe/Berlin',
    })
  })

  it('PC-C: țara deja salvată → fără UPDATE, intenția se șterge', async () => {
    const s = memStorage()
    storePendingCountry('r1', 'DE', s)
    let called = false
    const res = await retryPendingCountry({
      restaurantId: 'r1',
      currentCountry: 'de',
      isOwner: true,
      update: async () => {
        called = true
        return { error: null }
      },
      storage: s,
    })
    expect(res).toBe('already_set')
    expect(called).toBe(false)
    expect(s.map.size).toBe(0)
  })

  it('PC-D: non-owner → fără UPDATE, intenția rămâne', async () => {
    const s = memStorage()
    storePendingCountry('r1', 'DE', s)
    let called = false
    const res = await retryPendingCountry({
      restaurantId: 'r1',
      currentCountry: 'RO',
      isOwner: false,
      update: async () => {
        called = true
        return { error: null }
      },
      storage: s,
    })
    expect(res).toBe('not_owner')
    expect(called).toBe(false)
    expect(readPendingCountry('r1', s)).toBe('DE')
  })

  it('PC-E: storage care aruncă → fail-open', async () => {
    expect(() => storePendingCountry('r1', 'DE', throwing)).not.toThrow()
    expect(readPendingCountry('r1', throwing)).toBeNull()
    expect(() => clearPendingCountry('r1', throwing)).not.toThrow()
    const res = await retryPendingCountry({
      restaurantId: 'r1',
      currentCountry: 'RO',
      isOwner: true,
      update: async () => ({ error: null }),
      storage: throwing,
    })
    expect(res).toBe('none')
    expect(
      await retryPendingCountry({
        restaurantId: 'r1',
        currentCountry: 'RO',
        isOwner: true,
        update: async () => ({ error: null }),
        storage: null,
      }),
    ).toBe('none')
  })

  it('PC-F: cheie per restaurant', async () => {
    const s = memStorage()
    storePendingCountry('rA', 'FR', s)
    let called = false
    const res = await retryPendingCountry({
      restaurantId: 'rB',
      currentCountry: 'RO',
      isOwner: true,
      update: async () => {
        called = true
        return { error: null }
      },
      storage: s,
    })
    expect(res).toBe('none')
    expect(called).toBe(false)
    expect(readPendingCountry('rA', s)).toBe('FR')
  })
})

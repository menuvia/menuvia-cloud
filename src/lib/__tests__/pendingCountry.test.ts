// Țara de onboarding NESALVATĂ — lib/pendingCountry.ts (review #288).
//   PC-A  pe 'RO' (și cod necunoscut) nu se păstrează NIMIC — fluxul .ro neatins
//   PC-B  UPDATE reușit → intenția se ȘTERGE; UPDATE picat (error SAU throw) →
//         intenția RĂMÂNE pentru următoarea încărcare
//   PC-C  restaurantul are deja țara → fără UPDATE, intenția se șterge
//   PC-D  non-owner → fără UPDATE, intenția rămâne (trigger-ul din DB ar respinge)
//   PC-E  storage care ARUNCĂ (Safari „Block All Cookies") → fail-open, fără excepție
//   PC-F  cheie per restaurant: intenția lui A nu se aplică pe B
//   PR1   (lotul G1, recenzia CodeRabbit pe #358) locația nouă păstrează patch-ul
//         regional ÎNTREG — și dintr-o sursă românească cu monedă/fus propriu
//         (fără țară); o valoare stricată sau străină se citește ca null.
//   PR2   reîncercarea trimite DOAR câmpurile care încă diferă (moneda și fusul
//         aleși de mână la sursă, nu default-urile țării); totul deja la locul
//         lui → fără UPDATE, intenția se șterge. Mutația care pică: reîncercarea
//         doar cu țara (fusul și limba sursei pierdute).
//   PR3   UPDATE picat → intenția rămâne; reușit → se șterge
//   PR4   o țară de schimbat fără owner → fără UPDATE (mig 296); fără țară → merge
import { describe, it, expect } from 'vitest'
import {
  PENDING_COUNTRY_PREFIX,
  clearPendingCountry,
  readPendingCountry,
  retryPendingCountry,
  storePendingCountry,
  clearPendingRegional,
  readPendingRegional,
  retryPendingRegional,
  storePendingRegional,
  type CountryPatch,
  type KeyValueStorage,
} from '../pendingCountry'
import type { RegionalPatch } from '../countries'

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

describe('pendingCountry — setările regionale ale locației noi (lotul G1)', () => {
  it('PR1 patch-ul întreg, și dintr-o sursă românească; gunoiul → null', () => {
    const s = memStorage()
    storePendingRegional('r1', { country: 'DE', currency: 'USD', timezone: 'Europe/Berlin', language: 'de' }, s)
    expect(readPendingRegional('r1', s)).toEqual({
      country: 'DE',
      currency: 'USD',
      timezone: 'Europe/Berlin',
      language: 'de',
    })
    storePendingRegional('r2', { currency: 'EUR', timezone: 'Europe/London' }, s)
    expect(readPendingRegional('r2', s)).toEqual({ currency: 'EUR', timezone: 'Europe/London' })
    // Nimic de copiat → nimic păstrat.
    storePendingRegional('r3', { country: 'RO', currency: 'RON' }, s)
    expect(readPendingRegional('r3', s)).toBeNull()
    s.map.set('menuvia_pending_regional:r4', '{nu e json')
    expect(readPendingRegional('r4', s)).toBeNull()
    s.map.set('menuvia_pending_regional:r5', JSON.stringify({ timezone: 'Marte/Olimp', currency: 'XXX' }))
    expect(readPendingRegional('r5', s)).toBeNull()
    clearPendingRegional('r1', s)
    expect(readPendingRegional('r1', s)).toBeNull()
  })

  it('PR2 doar câmpurile care încă diferă; totul la locul lui → fără UPDATE', async () => {
    const s = memStorage()
    storePendingRegional('r1', { country: 'DE', currency: 'USD', timezone: 'Europe/Berlin', language: 'de' }, s)
    const sent: RegionalPatch[] = []
    const res = await retryPendingRegional({
      restaurantId: 'r1',
      current: { country: 'DE', currency: 'RON', timezone: 'Europe/Bucharest', language: 'de' },
      isOwner: true,
      update: async (p) => {
        sent.push(p)
        return { error: null }
      },
      storage: s,
    })
    expect(res).toBe('saved')
    expect(sent).toEqual([{ currency: 'USD', timezone: 'Europe/Berlin' }])
    expect(readPendingRegional('r1', s)).toBeNull()

    storePendingRegional('r2', { currency: 'EUR' }, s)
    const none: RegionalPatch[] = []
    const done = await retryPendingRegional({
      restaurantId: 'r2',
      current: { country: 'RO', currency: 'EUR' },
      isOwner: true,
      update: async (p) => {
        none.push(p)
        return { error: null }
      },
      storage: s,
    })
    expect(done).toBe('already_set')
    expect(none).toEqual([])
    expect(readPendingRegional('r2', s)).toBeNull()
  })

  it('PR3 UPDATE picat → intenția rămâne', async () => {
    const s = memStorage()
    storePendingRegional('r1', { timezone: 'Europe/London' }, s)
    const failed = await retryPendingRegional({
      restaurantId: 'r1',
      current: { timezone: 'Europe/Bucharest' },
      isOwner: true,
      update: async () => ({ error: { message: 'boom' } }),
      storage: s,
    })
    expect(failed).toBe('failed')
    expect(readPendingRegional('r1', s)).toEqual({ timezone: 'Europe/London' })
    const thrown = await retryPendingRegional({
      restaurantId: 'r1',
      current: { timezone: 'Europe/Bucharest' },
      isOwner: true,
      update: async () => {
        throw new Error('net')
      },
      storage: s,
    })
    expect(thrown).toBe('failed')
    expect(readPendingRegional('r1', s)).not.toBeNull()
    expect(await retryPendingRegional({ restaurantId: 'nimic', current: {}, isOwner: true, update: async () => ({ error: null }), storage: s })).toBe('none')
  })

  it('PR4 țara cere owner-ul; fără țară, reîncercarea merge', async () => {
    const s = memStorage()
    storePendingRegional('r1', { country: 'FR', currency: 'EUR' }, s)
    let calls = 0
    const res = await retryPendingRegional({
      restaurantId: 'r1',
      current: { country: 'RO', currency: 'RON' },
      isOwner: false,
      update: async () => {
        calls += 1
        return { error: null }
      },
      storage: s,
    })
    expect(res).toBe('not_owner')
    expect(calls).toBe(0)
    storePendingRegional('r2', { currency: 'EUR' }, s)
    const ok = await retryPendingRegional({
      restaurantId: 'r2',
      current: { currency: 'RON' },
      isOwner: false,
      update: async () => {
        calls += 1
        return { error: null }
      },
      storage: s,
    })
    expect(ok).toBe('saved')
    expect(calls).toBe(1)
  })
})

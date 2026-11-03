// Vârsta comenzii pe ecranele de staff (lotul G).
//   OA1  pragurile: sub 10 min calm, 10 → atenție, 20 → întârziată
//   OA2  pickup programat în viitor nu întârzie; după ora promisă vârsta se
//        măsoară de la ea, nu de la plasare. Mutația care pică: ancora pe
//        `created_at` pentru pickup.
//   OA3  doar comenzile încă în bucătărie (new/confirmed/preparing) contează
//        pentru alertă; „ready"/„served" nu. Mutația care pică: fără filtrul
//        de status (comenzile gata ar suna).
//   OA4  takeNewlyLate: fiecare comandă sună O dată, iar comenzile ieșite din
//        bucătărie sunt scoase din set. Mutația care pică: fără `alerted`
//        (aceeași comandă ar suna la fiecare verificare).
import { describe, it, expect } from 'vitest'
import { ageLevel, lateKitchenOrderIds, takeNewlyLate } from '../orderAge'
import { makeOrder } from '../../components/__tests__/fixtures'

const NOW = Date.parse('2026-07-20T12:00:00Z')
const minsAgo = (m: number): string => new Date(NOW - m * 60_000).toISOString()

describe('ageLevel', () => {
  it('OA1 pragurile 10 / 20 de minute', () => {
    expect(ageLevel(makeOrder({ created_at: minsAgo(9.9) }), NOW)).toBe('calm')
    expect(ageLevel(makeOrder({ created_at: minsAgo(10) }), NOW)).toBe('warn')
    expect(ageLevel(makeOrder({ created_at: minsAgo(19.9) }), NOW)).toBe('warn')
    expect(ageLevel(makeOrder({ created_at: minsAgo(20) }), NOW)).toBe('late')
  })

  it('OA2 pickup: viitor → calm, după ora promisă se măsoară de la ea', () => {
    const ahead = makeOrder({ source: 'pickup', created_at: minsAgo(120), pickup_time: minsAgo(-30) })
    expect(ageLevel(ahead, NOW)).toBe('calm')
    const due = makeOrder({ source: 'pickup', created_at: minsAgo(120), pickup_time: minsAgo(5) })
    expect(ageLevel(due, NOW)).toBe('calm')
    const lateDue = makeOrder({ source: 'pickup', created_at: minsAgo(120), pickup_time: minsAgo(25) })
    expect(ageLevel(lateDue, NOW)).toBe('late')
  })
})

describe('alerta de întârziere', () => {
  it('OA3 doar comenzile încă în bucătărie', () => {
    const orders = [
      makeOrder({ id: 'n', status: 'new', created_at: minsAgo(30) }),
      makeOrder({ id: 'p', status: 'preparing', created_at: minsAgo(25) }),
      makeOrder({ id: 'r', status: 'ready', created_at: minsAgo(40) }),
      makeOrder({ id: 's', status: 'served', created_at: minsAgo(40) }),
      makeOrder({ id: 'c', status: 'confirmed', created_at: minsAgo(5) }),
    ]
    expect(lateKitchenOrderIds(orders, NOW)).toEqual(['n', 'p'])
  })

  it('OA4 fiecare comandă sună o dată; comenzile ieșite din bucătărie se uită', () => {
    const a = makeOrder({ id: 'a', status: 'preparing', created_at: minsAgo(21) })
    const b = makeOrder({ id: 'b', status: 'preparing', created_at: minsAgo(15) })
    let step = takeNewlyLate([a, b], new Set(), NOW)
    expect(step.fresh).toEqual(['a'])
    step = takeNewlyLate([a, b], step.alerted, NOW)
    expect(step.fresh).toEqual([])
    // Peste 6 minute B devine întârziată → sună doar ea.
    step = takeNewlyLate([a, b], step.alerted, NOW + 6 * 60_000)
    expect(step.fresh).toEqual(['b'])
    // A e gata → iese din set (setul nu crește la nesfârșit).
    step = takeNewlyLate([{ ...a, status: 'ready' }, b], step.alerted, NOW + 7 * 60_000)
    expect([...step.alerted]).toEqual(['b'])
  })
})

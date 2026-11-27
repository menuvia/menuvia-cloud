// Lotul C8b — totalul unei comenzi DUPĂ trimitere e al SERVERULUI.
// `create_order` întoarce suma DINAINTEA reducerii (contract mig 191, HH1:
// 24.00 vs 21.60 după COMMIT), iar Happy Hour se aplică printr-un trigger amânat
// (mig 077). Clientul citește numărul din get_order_public_status și îl duce în
// lista sesiunii; reducerea nu se recalculează local. Funcțiile de aici sunt
// PURE: citirea payload-ului, înlocuirea în listă și nota din coș.
//
// Mutațiile care pică:
//   SVT8  payload-ul MINIM (fără sesiune, mig 092) tratat ca total 0 → oaspetele
//         ar vedea „0.00 lei” și butonul „Plătește masa” ar scădea suma;
//   SVT9  `discount_amount` lipsă/stricat tratat ca NaN → rândul de reducere
//         ar afișa „−NaN lei”;
//   SVT10 lista re-creată la fiecare poll fără schimbare → re-randări + restart
//         de polling în ActiveOrdersBanner (identitatea TREBUIE păstrată);
//   SVT11 nota din coș legată doar de procente sau fără potrivire pe scope.
// Controale pozitive: payload complet cu number ȘI cu string (PostgREST poate
// întoarce numeric ca string), înlocuirea reală a totalului.
import { describe, it, expect } from 'vitest'
import {
  serverOrderDiscount,
  serverOrderTotal,
  type OrderConfirmationPayload,
  type PublicOrderStatus,
} from '../orders'
import { withServerOrderTotal } from '../qrSession'
import { happyHourCoversProduct, type HappyHourRule } from '../qr'

function status(extra: Record<string, unknown>): PublicOrderStatus {
  return { id: 'o1', status: 'preparing', created_at: '2026-09-07T10:00:00Z', ...extra } as unknown as PublicOrderStatus
}

describe('serverOrderTotal / serverOrderDiscount — citirea payload-ului', () => {
  it('SVT8 total din payload complet (number și string); minim/stricat → null', () => {
    expect(serverOrderTotal(status({ total: 21.6 }))).toBe(21.6)
    expect(serverOrderTotal(status({ total: '21.60' }))).toBe(21.6)
    expect(serverOrderTotal(status({ total: 0 }))).toBe(0)
    // Payload-ul minim (mig 092): {id, short_id, status}, fără cheia `total`.
    expect(serverOrderTotal({ id: 'o1', short_id: 'o1', status: 'new' } as unknown as PublicOrderStatus)).toBeNull()
    expect(serverOrderTotal(null)).toBeNull()
    expect(serverOrderTotal(undefined)).toBeNull()
    expect(serverOrderTotal(status({ total: null }))).toBeNull()
    expect(serverOrderTotal(status({ total: '' }))).toBeNull()
    expect(serverOrderTotal(status({ total: 'abc' }))).toBeNull()
    expect(serverOrderTotal(status({ total: -5 }))).toBeNull()
  })

  it('SVT9 reducerea: valoarea serverului, altfel 0 (niciodată NaN)', () => {
    expect(serverOrderDiscount(status({ total: 21.6, discount_amount: 2.4 }))).toBe(2.4)
    expect(serverOrderDiscount(status({ total: 21.6, discount_amount: '2.40' }))).toBe(2.4)
    expect(serverOrderDiscount(status({ total: 24 }))).toBe(0)
    expect(serverOrderDiscount(status({ total: 24, discount_amount: null }))).toBe(0)
    expect(serverOrderDiscount(status({ total: 24, discount_amount: 'x' }))).toBe(0)
    expect(serverOrderDiscount(null)).toBe(0)
  })
})

function conf(id: string, total: number): OrderConfirmationPayload {
  return { id, short_id: id.toUpperCase(), status: 'new', total, created_at: '2026-09-07T10:00:00Z' }
}

describe('withServerOrderTotal — totalul serverului în lista sesiunii', () => {
  it('SVT10 înlocuiește doar comanda vizată; fără schimbare → ACEEAȘI listă', () => {
    const list = [conf('a', 24), conf('b', 10)]
    const next = withServerOrderTotal(list, 'a', 21.6)
    expect(next).not.toBe(list)
    expect(next.map((o) => o.total)).toEqual([21.6, 10])
    expect(next[1]).toBe(list[1])
    // Același total, id necunoscut, valoare invalidă → aceeași referință.
    expect(withServerOrderTotal(next, 'a', 21.6)).toBe(next)
    expect(withServerOrderTotal(next, 'zzz', 5)).toBe(next)
    expect(withServerOrderTotal(next, 'b', Number.NaN)).toBe(next)
    expect(withServerOrderTotal(next, 'b', -1)).toBe(next)
  })
})

describe('happyHourCoversProduct — doar nota din coș, fără sumă', () => {
  const product = { id: 'p1', category_id: 'c1' }
  function rule(overrides: Partial<HappyHourRule>): HappyHourRule {
    return {
      id: 'r',
      name: 'HH',
      scope: 'all',
      category_id: null,
      product_id: null,
      discount_type: 'percent',
      discount_value: 10,
      max_discount: null,
      ...overrides,
    }
  }

  it('SVT11 potrivire pe scope, pe ambele tipuri de reducere', () => {
    expect(happyHourCoversProduct(product, [rule({})])).toBe(true)
    expect(happyHourCoversProduct(product, [rule({ discount_type: 'amount', discount_value: 5 })])).toBe(true)
    expect(happyHourCoversProduct(product, [rule({ scope: 'category', category_id: 'c1' })])).toBe(true)
    expect(happyHourCoversProduct(product, [rule({ scope: 'category', category_id: 'c2' })])).toBe(false)
    expect(happyHourCoversProduct(product, [rule({ scope: 'product', product_id: 'p1' })])).toBe(true)
    expect(happyHourCoversProduct(product, [rule({ scope: 'product', product_id: 'p2' })])).toBe(false)
    expect(happyHourCoversProduct(product, [rule({ discount_value: 0 })])).toBe(false)
    expect(happyHourCoversProduct(product, [])).toBe(false)
  })
})

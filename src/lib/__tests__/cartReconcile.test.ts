// Coșul oaspetelui față de meniul de acum (lotul O4a, audit nov 2026 OPT-2 /
// OPT-14).
//
//   CM1  linia validă → nicio problemă (control pozitiv pentru tot ce urmează).
//   CM2  produs scos din meniu / ciornă → `unavailable`; epuizat → `sold_out`;
//        meniu necunoscut (gol) → nicio problemă inventată.
//   CM3  opțiune scoasă sau indisponibilă, grup scos → `options_changed`.
//        [PICĂ: verificarea `o.is_available === false` sau căutarea în grup
//        scoasă — exact bucla „Opțiunile nu mai sunt valabile” la retrimitere]
//   CM4  grup devenit OBLIGATORIU fără alegere în linie → `options_changed`;
//        peste maximul unui grup → `options_changed`.
//   CM5  extra scos sau indisponibil → `options_changed`.
//   CM6  repriceCart: liniile valide trec pe prețurile de acum (produs,
//        opțiune, extra), cele cu probleme rămân neatinse, iar fără schimbări
//        întoarce ACEEAȘI referință (setCart nu randează degeaba).
//   CM7  isStaleMenuGuestError: epuizare, produs scos, opțiuni/extra-uri
//        invalide, grup obligatoriu → da; rețea, sesiune închisă, rate-limit → nu.
//   CM8  cablajul: QR, coșul QR și ridicarea pe /m folosesc piesele de mai sus.
//        [PICĂ: `onStaleMenu` scos din PickupCheckoutSheet sau
//        `useMenuVersionRefetch` scos de pe /m — ridicarea rămânea pe meniul vechi]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { cartIssueCounts, cartLineIssue, productIndex, repriceCart } from '../cartReconcile'
import { isStaleMenuGuestError } from '../guestErrors'
import type { CartItem } from '../orders'
import {
  makeCartItem,
  makeCategory,
  makeGroup,
  makeOption,
  makeProduct,
} from '../../components/__tests__/fixtures'

const blat = makeGroup({
  id: 'g-blat',
  name: 'Blat',
  is_required: true,
  modifier_options: [
    makeOption({ id: 'o-sub', name: 'Subțire', modifier_group_id: 'g-blat' }),
    makeOption({ id: 'o-puf', name: 'Pufos', price_delta: 2, modifier_group_id: 'g-blat' }),
  ],
})
const sosuri = makeGroup({
  id: 'g-sos',
  name: 'Sosuri',
  selection_type: 'multiple',
  max_select: 2,
  modifier_options: [
    makeOption({ id: 'o-a', name: 'Usturoi', modifier_group_id: 'g-sos' }),
    makeOption({ id: 'o-b', name: 'Picant', modifier_group_id: 'g-sos' }),
    makeOption({ id: 'o-c', name: 'Dulce', modifier_group_id: 'g-sos' }),
  ],
})
const pizza = makeProduct({
  id: 'p-pizza',
  name: 'Pizza',
  price: 30,
  modifier_groups: [blat, sosuri],
  extras: [{ id: 'e-bacon', name: 'Bacon', price: 5, emoji: null, display_order: 0, is_available: true }],
})

function line(over: Partial<CartItem> = {}): CartItem {
  return makeCartItem({
    product_id: 'p-pizza',
    product_name_snapshot: 'Pizza',
    unit_price_snapshot: 30,
    selected_modifiers: [
      { group_id: 'g-blat', group_name: 'Blat', option_id: 'o-puf', option_name: 'Pufos', price_delta: 2 },
    ],
    selected_extras: [{ id: 'e-bacon', name: 'Bacon', price: 5 }],
    ...over,
  })
}

function menuWith(p = pizza) {
  return productIndex([makeCategory({ id: 'c1', products: [p] })])
}

describe('cartLineIssue — coșul față de meniul de acum', () => {
  it('CM1 linia validă nu are nicio problemă', () => {
    expect(cartLineIssue(line(), menuWith())).toBeNull()
  })

  it('CM2 produs scos / ciornă / epuizat; meniu necunoscut', () => {
    const other = productIndex([makeCategory({ products: [makeProduct({ id: 'p-alt' })] })])
    expect(cartLineIssue(line(), other)).toBe('unavailable')
    expect(cartLineIssue(line(), menuWith({ ...pizza, is_draft: true }))).toBe('unavailable')
    expect(cartLineIssue(line(), menuWith({ ...pizza, is_sold_out: true }))).toBe('sold_out')
    expect(cartLineIssue(line(), new Map())).toBeNull()
  })

  it('CM3 opțiunea aleasă nu mai e valabilă', () => {
    const unavailable = {
      ...pizza,
      modifier_groups: [
        { ...blat, modifier_options: blat.modifier_options.map((o) => ({ ...o, is_available: o.id !== 'o-puf' })) },
        sosuri,
      ],
    }
    expect(cartLineIssue(line(), menuWith(unavailable))).toBe('options_changed')
    const removed = {
      ...pizza,
      modifier_groups: [{ ...blat, modifier_options: [blat.modifier_options[0]] }, sosuri],
    }
    expect(cartLineIssue(line(), menuWith(removed))).toBe('options_changed')
    const groupGone = { ...pizza, modifier_groups: [sosuri] }
    expect(cartLineIssue(line(), menuWith(groupGone))).toBe('options_changed')
  })

  it('CM4 grup devenit obligatoriu; peste maximul grupului', () => {
    const noBlat = line({ selected_modifiers: [] })
    expect(cartLineIssue(noBlat, menuWith())).toBe('options_changed')
    // Control: același coș pe un grup opțional trece.
    const optional = { ...pizza, modifier_groups: [{ ...blat, is_required: false }, sosuri] }
    expect(cartLineIssue(noBlat, menuWith(optional))).toBeNull()

    const threeSauces = line({
      selected_modifiers: [
        { group_id: 'g-blat', group_name: 'Blat', option_id: 'o-sub', option_name: 'Subțire', price_delta: 0 },
        ...['o-a', 'o-b', 'o-c'].map((id) => ({
          group_id: 'g-sos',
          group_name: 'Sosuri',
          option_id: id,
          option_name: id,
          price_delta: 0,
        })),
      ],
    })
    expect(cartLineIssue(threeSauces, menuWith())).toBe('options_changed')
    expect(cartLineIssue(threeSauces, menuWith({ ...pizza, modifier_groups: [blat, { ...sosuri, max_select: 3 }] }))).toBeNull()
  })

  it('CM5 extra-ul ales nu mai e valabil', () => {
    expect(cartLineIssue(line(), menuWith({ ...pizza, extras: [] }))).toBe('options_changed')
    expect(
      cartLineIssue(line(), menuWith({ ...pizza, extras: pizza.extras.map((e) => ({ ...e, is_available: false })) })),
    ).toBe('options_changed')
    const counts = cartIssueCounts([line(), line({ selected_modifiers: [] })], menuWith())
    expect(counts).toEqual({ sold_out: 0, unavailable: 0, options_changed: 1 })
  })
})

describe('repriceCart — coșul arată prețul pe care îl va încasa serverul', () => {
  it('CM6 prețurile noi trec pe liniile valide; nimic schimbat = aceeași referință', () => {
    const cart = [line(), line({ product_id: 'p-alt' })]
    const same = repriceCart(cart, menuWith())
    expect(same.changed).toBe(false)
    expect(same.cart).toBe(cart)

    const pricier = {
      ...pizza,
      price: 32,
      modifier_groups: [
        { ...blat, modifier_options: blat.modifier_options.map((o) => (o.id === 'o-puf' ? { ...o, price_delta: 3 } : o)) },
        sosuri,
      ],
      extras: pizza.extras.map((e) => ({ ...e, price: 6 })),
    }
    const r = repriceCart(cart, menuWith(pricier))
    expect(r.changed).toBe(true)
    expect(r.cart[0]).toMatchObject({ unit_price_snapshot: 32, product_name_snapshot: 'Pizza' })
    expect(r.cart[0].selected_modifiers[0].price_delta).toBe(3)
    expect(r.cart[0].selected_extras?.[0].price).toBe(6)
    // Linia cu produs scos rămâne neatinsă — oaspetele o scoate.
    expect(r.cart[1]).toBe(cart[1])
  })
})

describe('isStaleMenuGuestError — când pagina reface meniul', () => {
  it('CM7 refuzurile de „meniu vechi” da, restul nu', () => {
    for (const hint of [
      'product_sold_out',
      'product_inactive',
      'product_not_found',
      'invalid_options',
      'too_many_in_group',
      'missing_required_group',
      'invalid_extras',
    ]) {
      expect(isStaleMenuGuestError(Object.assign(new Error('x'), { hint })), hint).toBe(true)
    }
    // Fără hint (server mai vechi): tiparele de mesaj.
    expect(isStaleMenuGuestError(new Error('Produsul "Supă" este epuizat'))).toBe(true)
    expect(isStaleMenuGuestError(new Error('Extra indisponibil pentru produsul "X"'))).toBe(true)
    for (const hint of ['session_closed', 'pickup_rate_limit', 'restaurant_inactive']) {
      expect(isStaleMenuGuestError(Object.assign(new Error('x'), { hint })), hint).toBe(false)
    }
    expect(isStaleMenuGuestError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isStaleMenuGuestError(null)).toBe(false)
  })
})

describe('cablajul pe paginile oaspetelui', () => {
  const read = (f: string): string => readFileSync(resolve(process.cwd(), f), 'utf8')

  it('CM8 QR, coșul QR și ridicarea pe /m folosesc reconcilierea', () => {
    const qr = read('src/pages/QrMenuPage.tsx')
    expect(qr).toMatch(/repriceCart\(cartRef\.current, menu\)/)
    const cart = read('src/components/QrCartSheet.tsx')
    expect(cart).toMatch(/cartIssueCounts\(cart, productById\)/)
    expect(cart).toMatch(/changedInCart === 0/)
    const pub = read('src/pages/PublicMenuPage.tsx')
    expect(pub).toMatch(/useMenuVersionRefetch\(menuRestaurantId, refreshMenu\)/)
    expect(pub).toMatch(/onStaleMenu=\{\(\) => void refreshMenu\(\)\}/)
    expect(pub).toMatch(/disabled=\{cart\.length === 0 \|\| cartBlocked\}/)
    const pickup = read('src/components/PickupCheckoutSheet.tsx')
    expect(pickup).toMatch(/if \(isStaleMenuGuestError\(err\)\) onStaleMenu\?\.\(\)/)
  })
})

// Motorul comun de selecție a opțiunilor (lotul O4b, audit nov 2026 OPT-4 /
// OPT-6 / OPT-8 / OPT-10 / OPT-12).
//
//   OE1  se numără doar opțiunile care există și sunt disponibile: un id
//        dispărut după o reîmprospătare nu satisface un grup obligatoriu.
//        [PICĂ: numărarea mărimii brute a mulțimii — exact bug-ul din
//        ProductSheet, „Adaugă” activ și comanda respinsă]
//   OE2  single opțional: a doua atingere deselectează; single obligatoriu:
//        rămâne ales (radio). [PICĂ: ramura `modifierGroupMin(g) === 0` scoasă]
//   OE3  multiple: bifare până la maxim, debifare oricând; opțiunea
//        indisponibilă nu se poate alege.
//   OE4  pruneSelections scoate id-urile dispărute și întoarce aceeași
//        referință când nu are ce scoate.
//   OE5  grupul obligatoriu fără opțiuni disponibile face produsul necomandabil;
//        markUnorderableProducts îl arată „Epuizat”, fără să atingă restul.
//   OE6  missingGroups / selectionsComplete / delta / modificatorii trimiși.
//   OE7  fmtPriceDelta: semnul apare și pe opțiunile care scad prețul.
//   OE8  addOrMergeCartItem: o linie identică își crește cantitatea; altă
//        opțiune / notă / sursă de upsell = linie nouă; peste 20 = linie nouă.
//        [PICĂ: identitatea fără opțiuni — „Pizza blat subțire” și „Pizza blat
//        pufos” s-ar contopi]
import { describe, it, expect } from 'vitest'
import {
  buildSelectedModifiers,
  initialSelections,
  markUnorderableProducts,
  missingGroups,
  productOptionsUnavailable,
  pruneSelections,
  selectedCount,
  selectionDelta,
  selectionsComplete,
  toggleOption,
  type OptionSelections,
} from '../optionSelection'
import { fmtPriceDelta } from '../currency'
import { addOrMergeCartItem, MAX_LINE_QTY } from '../orders'
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
const sos = makeGroup({
  id: 'g-sos',
  name: 'Sos',
  modifier_options: [makeOption({ id: 'o-pic', name: 'Picant', price_delta: 3, modifier_group_id: 'g-sos' })],
})
const toppinguri = makeGroup({
  id: 'g-top',
  name: 'Toppinguri',
  selection_type: 'multiple',
  max_select: 2,
  modifier_options: [
    makeOption({ id: 'o-a', name: 'Ciuperci', modifier_group_id: 'g-top' }),
    makeOption({ id: 'o-b', name: 'Ardei', modifier_group_id: 'g-top' }),
    makeOption({ id: 'o-c', name: 'Măsline', modifier_group_id: 'g-top' }),
    makeOption({ id: 'o-x', name: 'Trufe', is_available: false, modifier_group_id: 'g-top' }),
  ],
})

describe('motorul de selecție', () => {
  it('OE1 doar opțiunile existente și disponibile se numără', () => {
    const stale: OptionSelections = { 'g-blat': 'o-disparut', 'g-top': new Set(['o-a', 'o-x', 'o-y']) }
    expect(selectedCount(blat, stale)).toBe(0)
    expect(selectedCount(toppinguri, stale)).toBe(1)
    expect(selectionsComplete([blat], stale)).toBe(false)
    expect(selectionsComplete([blat], { 'g-blat': 'o-sub' })).toBe(true)
  })

  it('OE2 single: deselectare doar pe grupul opțional', () => {
    let s: OptionSelections = {}
    s = toggleOption(sos, s, 'o-pic')
    expect(s['g-sos']).toBe('o-pic')
    s = toggleOption(sos, s, 'o-pic')
    expect(s['g-sos']).toBeNull()
    let r: OptionSelections = toggleOption(blat, {}, 'o-sub')
    r = toggleOption(blat, r, 'o-sub')
    expect(r['g-blat']).toBe('o-sub')
    r = toggleOption(blat, r, 'o-puf')
    expect(r['g-blat']).toBe('o-puf')
  })

  it('OE3 multiple: până la maxim; indisponibilul nu se alege', () => {
    let s: OptionSelections = {}
    s = toggleOption(toppinguri, s, 'o-a')
    s = toggleOption(toppinguri, s, 'o-b')
    const atMax = toggleOption(toppinguri, s, 'o-c')
    expect(atMax).toBe(s)
    s = toggleOption(toppinguri, s, 'o-a')
    expect(selectedCount(toppinguri, s)).toBe(1)
    expect(toggleOption(toppinguri, s, 'o-x')).toBe(s)
  })

  it('OE4 pruneSelections', () => {
    const clean: OptionSelections = { 'g-blat': 'o-sub', 'g-top': new Set(['o-a']) }
    expect(pruneSelections([blat, toppinguri], clean)).toBe(clean)
    const pruned = pruneSelections([blat, toppinguri], { 'g-blat': 'o-gone', 'g-top': new Set(['o-a', 'o-x']) })
    expect(pruned['g-blat']).toBeNull()
    expect([...(pruned['g-top'] as Set<string>)]).toEqual(['o-a'])
  })

  it('OE5 grup obligatoriu fără opțiuni disponibile = produs necomandabil', () => {
    const dead = { ...blat, modifier_options: blat.modifier_options.map((o) => ({ ...o, is_available: false })) }
    const pizza = makeProduct({ id: 'p-pizza', modifier_groups: [dead] })
    const ok = makeProduct({ id: 'p-ok', modifier_groups: [blat, sos] })
    expect(productOptionsUnavailable(pizza)).toBe(true)
    expect(productOptionsUnavailable(ok)).toBe(false)
    const cats = [makeCategory({ id: 'c1', products: [pizza, ok] })]
    const shown = markUnorderableProducts(cats)
    expect(shown[0].products[0].is_sold_out).toBe(true)
    expect(shown[0].products[1]).toBe(ok)
    const fine = [makeCategory({ id: 'c2', products: [ok] })]
    expect(markUnorderableProducts(fine)).toBe(fine)
  })

  it('OE6 ce lipsește, prețul și ce se trimite', () => {
    const groups = [blat, sos, toppinguri]
    expect(missingGroups(groups, {}).map((g) => g.name)).toEqual(['Blat'])
    const s: OptionSelections = { 'g-blat': 'o-puf', 'g-sos': 'o-pic', 'g-top': new Set(['o-b']) }
    expect(missingGroups(groups, s)).toEqual([])
    expect(selectionDelta(groups, s)).toBe(5)
    expect(buildSelectedModifiers(groups, s).map((m) => m.option_id)).toEqual(['o-puf', 'o-pic', 'o-b'])
    const seeded = initialSelections(groups, [
      { group_id: 'g-blat', option_id: 'o-sub' },
      { group_id: 'g-top', option_id: 'o-x' },
    ])
    expect(seeded['g-blat']).toBe('o-sub')
    expect([...(seeded['g-top'] as Set<string>)]).toEqual([])
  })

  it('OE7 fmtPriceDelta are semn', () => {
    expect(fmtPriceDelta(3)).toBe('+3.00 lei')
    expect(fmtPriceDelta(-5)).toBe('−5.00 lei')
  })
})

describe('addOrMergeCartItem — o linie pentru același lucru', () => {
  const mod = (id: string) => ({ group_id: 'g', group_name: 'G', option_id: id, option_name: id, price_delta: 0 })

  it('OE8 linia identică își crește cantitatea; diferențele pornesc linii noi', () => {
    const a = makeCartItem({ product_id: 'p', selected_modifiers: [mod('x'), mod('y')] })
    const same = makeCartItem({ product_id: 'p', selected_modifiers: [mod('y'), mod('x')], quantity: 2 })
    let cart = addOrMergeCartItem([], a)
    cart = addOrMergeCartItem(cart, same)
    expect(cart).toHaveLength(1)
    expect(cart[0]).toMatchObject({ _key: a._key, quantity: 3 })

    expect(addOrMergeCartItem(cart, makeCartItem({ product_id: 'p', selected_modifiers: [mod('z')] }))).toHaveLength(2)
    expect(
      addOrMergeCartItem(cart, makeCartItem({ product_id: 'p', selected_modifiers: [mod('x'), mod('y')], notes: 'fără ceapă' })),
    ).toHaveLength(2)
    expect(
      addOrMergeCartItem(
        cart,
        makeCartItem({ product_id: 'p', selected_modifiers: [mod('x'), mod('y')], upsell_source: 'pairing' }),
      ),
    ).toHaveLength(2)

    const full = [makeCartItem({ product_id: 'q', quantity: MAX_LINE_QTY })]
    const next = addOrMergeCartItem(full, makeCartItem({ product_id: 'q' }))
    expect(next).toHaveLength(2)
    expect(next[0].quantity).toBe(MAX_LINE_QTY)
  })
})

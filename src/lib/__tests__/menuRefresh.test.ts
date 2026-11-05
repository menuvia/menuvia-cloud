// lib/menuRefresh — reîmprospătarea meniului QR (mig 313, recenzie CodeRabbit
// pe #338).
//
//   MRF1 doar cea mai NOUĂ cerere scrie: un răspuns mai vechi, sosit după unul
//        mai nou, e depășit. Mutația care pică: `begin` care întoarce mereu
//        `true` (fără contor de secvență).
//   MRF2 `invalidate()` (alt token QR) face depășite toate cererile în zbor.
//   MRF3 foaia deschisă primește rândul proaspăt LOCALIZAT în limba curentă
//        (nume + descriere), cu `is_sold_out` proaspăt. Mutația care pică:
//        `return fresh` (rândul brut, în română).
//   MRF4 pe `ro` aceeași referință; produs dispărut din meniu → rămâne cel
//        deschis; nicio foaie deschisă → null.
//   MRF5 (lotul O6c) marcajul „de verificat” al traducerilor AI (`ai_fields`)
//        nu schimbă nimic din ce vede oaspetele: grupurile, opțiunile și
//        extra-urile se localizează identic cu și fără el, iar o intrare care
//        are DOAR marcajul cade pe original. Mutația care pică: un cititor care
//        ar trata orice intrare nevidă drept traducere.
import { describe, it, expect } from 'vitest'
import { createLatestGate, freshActiveProduct, localizeProduct } from '../menuRefresh'
import {
  makeCategory,
  makeGroup,
  makeOption,
  makeProduct,
} from '../../components/__tests__/fixtures'
import type { Translations } from '../i18nMenu'

describe('createLatestGate', () => {
  it('MRF1 cererea mai veche e depășită de una mai nouă', () => {
    const gate = createLatestGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  it('MRF2 invalidate() depășește tot ce e în zbor', () => {
    const gate = createLatestGate()
    const pending = gate.begin()
    gate.invalidate()
    expect(pending()).toBe(false)
    expect(gate.begin()()).toBe(true)
  })
})

describe('freshActiveProduct', () => {
  const translations = { en: { name: 'Lemonade', description: 'Fresh lemons' } }

  it('MRF3 rândul proaspăt e localizat și poartă epuizarea', () => {
    const opened = localizeProduct(
      makeProduct({ id: 'p1', name: 'Limonadă', description: 'Lămâi', translations }),
      'en',
    )
    expect(opened.name).toBe('Lemonade')
    const fresh = makeProduct({
      id: 'p1',
      name: 'Limonadă',
      description: 'Lămâi',
      translations,
      is_sold_out: true,
    })
    const next = freshActiveProduct(opened, [makeCategory({ products: [fresh] })], 'en')
    expect(next).not.toBeNull()
    expect(next?.name).toBe('Lemonade')
    expect(next?.description).toBe('Fresh lemons')
    expect(next?.is_sold_out).toBe(true)
  })

  it('MRF4 ro = aceeași referință; produs dispărut = cel deschis; fără foaie = null', () => {
    const fresh = makeProduct({ id: 'p1' })
    expect(localizeProduct(fresh, 'ro')).toBe(fresh)
    const menu = [makeCategory({ products: [fresh] })]
    const gone = makeProduct({ id: 'x' })
    expect(freshActiveProduct(gone, menu, 'ro')).toBe(gone)
    expect(freshActiveProduct(null, menu, 'en')).toBeNull()
  })
})

describe('localizeProduct — marcajul AI e invizibil pentru oaspete', () => {
  function withTr(flag: boolean) {
    const f = (t: Translations): Translations =>
      flag ? { en: { ...t.en, ai_fields: ['name'] } } : t
    return makeProduct({
      id: 'p1',
      name: 'Pizza',
      translations: f({ en: { name: 'Pizza EN' } }),
      modifier_groups: [
        makeGroup({
          id: 'g1',
          name: 'Mărime',
          translations: f({ en: { name: 'Size' } }),
          modifier_options: [makeOption({ id: 'o1', name: 'Mare', translations: f({ en: { name: 'Large' } }) })],
        }),
      ],
      extras: [
        {
          id: 'e1',
          name: 'Brânză extra',
          price: 5,
          emoji: null,
          display_order: 0,
          is_available: true,
          translations: f({ en: { name: 'Extra cheese' } }),
        },
      ],
    })
  }

  it('MRF5 același rezultat cu și fără marcaj; intrarea doar cu marcaj = original', () => {
    const names = (p: ReturnType<typeof localizeProduct>) => [
      p.name,
      p.modifier_groups[0].name,
      p.modifier_groups[0].modifier_options[0].name,
      p.extras[0].name,
    ]
    expect(names(localizeProduct(withTr(true), 'en'))).toEqual(names(localizeProduct(withTr(false), 'en')))
    expect(names(localizeProduct(withTr(false), 'en'))).toEqual(['Pizza EN', 'Size', 'Large', 'Extra cheese'])
    const onlyFlag = makeProduct({
      name: 'Pizza',
      modifier_groups: [
        makeGroup({ name: 'Mărime', translations: { en: { ai_fields: ['name'] } }, modifier_options: [] }),
      ],
      extras: [
        { id: 'e2', name: 'Bacon', price: 3, emoji: null, display_order: 0, is_available: true, translations: { en: { ai_fields: ['name'] } } },
      ],
    })
    const out = localizeProduct(onlyFlag, 'en')
    expect(out.modifier_groups[0].name).toBe('Mărime')
    expect(out.extras[0].name).toBe('Bacon')
  })
})

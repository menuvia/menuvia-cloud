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
import { describe, it, expect } from 'vitest'
import { createLatestGate, freshActiveProduct, localizeProduct } from '../menuRefresh'
import { makeCategory, makeProduct } from '../../components/__tests__/fixtures'

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

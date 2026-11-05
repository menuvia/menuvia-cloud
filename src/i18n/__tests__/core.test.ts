// Motorul dicționarelor personalului (lotul L0b).
//   IC1  interpolarea: `{x}` înlocuit; un loc fără valoare rămâne VIZIBIL.
//   IC2  pluralul urmează regulile limbii (ro 1/2/20, fr 0/1/1 000 000).
//   IC3  o limbă fără fișier cade ÎNTREG pe engleză, apoi pe română.
//   IC4  încărcarea leneșă: prima citire e „în așteptare”, după promisiune
//        dicționarul e servit; o încărcare EȘUATĂ cade pe română, nu agață.
//   IC5  `t` pe o cheie de plural întoarce forma `other` (nu „[object]”).
import { describe, it, expect, vi } from 'vitest'
import {
  defineNamespace,
  effectiveLang,
  interpolate,
  makeTranslator,
  readNamespace,
  selectPlural,
  type Translation,
} from '../core'

const ro = { hi: 'Salut, {name}!', n: { one: '{n} masă', few: '{n} mese', other: '{n} de mese' } }
const en: Translation<typeof ro> = { hi: 'Hi, {name}!', n: { one: '{n} table', other: '{n} tables' } }

describe('core', () => {
  it('IC1 interpolare', () => {
    expect(interpolate('Salut, {name}!', { name: 'Ana' })).toBe('Salut, Ana!')
    expect(interpolate('Salut, {name}!', {})).toBe('Salut, {name}!')
    expect(interpolate('{a}{a}', { a: 1 })).toBe('11')
  })

  it('IC2 plural pe regulile limbii', () => {
    const tr = makeTranslator(ro, 'ro')
    expect(tr.tp('n', 1)).toBe('1 masă')
    expect(tr.tp('n', 2)).toBe('2 mese')
    expect(tr.tp('n', 19)).toBe('19 mese')
    expect(tr.tp('n', 20)).toBe('20 de mese')
    const fr = { one: '{n} produit', many: '{n} de produits', other: '{n} produits' }
    expect(selectPlural(fr, 'fr', 0)).toBe('{n} produit')
    expect(selectPlural(fr, 'fr', 2)).toBe('{n} produits')
    expect(selectPlural(fr, 'fr', 1000000)).toBe('{n} de produits')
  })

  it('IC3 limba fără fișier → engleza întreagă, apoi româna', () => {
    const withEn = defineNamespace('x', ro, { en: () => Promise.resolve({ default: en }) })
    expect(effectiveLang(withEn, 'fr')).toBe('en')
    expect(effectiveLang(withEn, 'de')).toBe('en')
    expect(effectiveLang(withEn, 'ro')).toBe('ro')
    const onlyRo = defineNamespace('y', ro, {})
    expect(effectiveLang(onlyRo, 'fr')).toBe('ro')
  })

  it('IC4 încărcare leneșă și cădere pe română la eșec', async () => {
    const ns = defineNamespace('z', ro, { en: () => Promise.resolve({ default: en }) })
    const first = readNamespace(ns, 'en')
    expect('pending' in first).toBe(true)
    // A doua citire în zbor întoarce ACEEAȘI promisiune (o singură cerere).
    const again = readNamespace(ns, 'en')
    expect('pending' in again && 'pending' in first && again.pending === first.pending).toBe(true)
    if ('pending' in first) await first.pending
    const done = readNamespace(ns, 'en')
    expect('dict' in done && done.dict.hi).toBe('Hi, {name}!')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken = defineNamespace('w', ro, { en: () => Promise.reject(new Error('chunk')) })
    const p = readNamespace(broken, 'en')
    if ('pending' in p) await p.pending
    const after = readNamespace(broken, 'en')
    expect('dict' in after && after.dict.hi).toBe('Salut, {name}!')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('IC5 t pe o cheie de plural → forma other', () => {
    const tr = makeTranslator(ro, 'ro') as unknown as { t: (k: string) => string }
    expect(tr.t('n')).toBe('{n} de mese')
    expect(tr.t('missing')).toBe('missing')
  })
})

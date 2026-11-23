// Motorul dicționarelor personalului (lotul L0b).
//   IC1  interpolarea: `{x}` înlocuit; un loc fără valoare rămâne VIZIBIL.
//   IC2  pluralul urmează regulile limbii (ro 1/2/20, fr 0/1/1 000 000).
//   IC3  o limbă fără fișier cade ÎNTREG pe engleză, apoi pe română.
//   IC4  încărcarea leneșă: prima citire e „în așteptare”, după promisiune
//        dicționarul e servit; o încărcare EȘUATĂ cade pe română, nu agață,
//        și raportează limba 'ro' (altfel pluralul francez pe forme românești:
//        „2 de mese”). [PICĂ: `lang: eff` pe dicționarul de rezervă]
//   IC5  `t` pe o cheie de plural întoarce forma `other` (nu „[object]”).
//   IC6  după un eșec, dicționarul se reîncearcă în FUNDAL (după primul
//        interval sau la evenimentul `online`), fără să suspende: cache-ul
//        ține româna până la reușită, apoi limba cerută. [PICĂ: fără
//        `scheduleRetry` — româna rămâne până la reîncărcarea paginii]
import { describe, it, expect, vi } from 'vitest'
import {
  defineNamespace,
  effectiveLang,
  interpolate,
  makeTranslator,
  NAMESPACE_RETRY_DELAYS_MS,
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
    // Textele sunt în română, deci și limba (pluralul românesc, nu cel francez).
    expect('dict' in after && after.lang).toBe('ro')
    if ('dict' in after) expect(makeTranslator(after.dict, after.lang).tp('n', 2)).toBe('2 mese')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('IC5 t pe o cheie de plural → forma other', () => {
    const tr = makeTranslator(ro, 'ro') as unknown as { t: (k: string) => string }
    expect(tr.t('n')).toBe('{n} de mese')
    expect(tr.t('missing')).toBe('missing')
  })

  it('IC6 o încărcare eșuată se reîncearcă în fundal, fără Suspense', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const enOk = { hi: 'Hi, {name}!', n: { one: '{n} table', other: '{n} tables' } }
      // Pe temporizator: primul apel pică, al doilea reușește.
      let calls = 0
      const flaky = defineNamespace('r1', ro, {
        en: () => (++calls === 1 ? Promise.reject(new Error('net')) : Promise.resolve({ default: enOk })),
      })
      const p = readNamespace(flaky, 'en')
      if ('pending' in p) await p.pending
      const fallback = readNamespace(flaky, 'en')
      expect('dict' in fallback && fallback.lang).toBe('ro')
      await vi.advanceTimersByTimeAsync(NAMESPACE_RETRY_DELAYS_MS[0])
      expect(calls).toBe(2)
      const healed = readNamespace(flaky, 'en')
      expect('dict' in healed && healed.dict.hi).toBe('Hi, {name}!')
      expect('dict' in healed && healed.lang).toBe('en')

      // La revenirea rețelei: reîncercarea pleacă imediat, înaintea intervalului.
      let calls2 = 0
      const offline = defineNamespace('r2', ro, {
        en: () => (++calls2 === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ default: enOk })),
      })
      const p2 = readNamespace(offline, 'en')
      if ('pending' in p2) await p2.pending
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(0)
      expect(calls2).toBe(2)
      const back = readNamespace(offline, 'en')
      expect('dict' in back && back.lang).toBe('en')
      // Un singur reapel per eșec: temporizatorul nu mai pleacă după `online`.
      await vi.advanceTimersByTimeAsync(NAMESPACE_RETRY_DELAYS_MS[0])
      expect(calls2).toBe(2)

      // Plafonul: un chunk care pică mereu se reîncearcă de exact 3 ori.
      let calls3 = 0
      const dead = defineNamespace('r3', ro, { en: () => (++calls3, Promise.reject(new Error('gone'))) })
      const p3 = readNamespace(dead, 'en')
      if ('pending' in p3) await p3.pending
      for (const d of NAMESPACE_RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(d)
      await vi.advanceTimersByTimeAsync(600_000)
      expect(calls3).toBe(1 + NAMESPACE_RETRY_DELAYS_MS.length)
      const still = readNamespace(dead, 'en')
      expect('dict' in still && still.lang).toBe('ro')
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })
})

// Coșul oaspetelui supraviețuiește reîncărcării (lotul C8a, lib/cartPersist).
// Fără el, iOS scotea tab-ul din memorie și oaspetele găsea coșul gol, deși
// alesese produse cu opțiuni, extra-uri și note — pe /q și la ridicare pe /m.
//
//   CK1  dus-întors: coșul și limba salvate revin identic; cheile sunt
//        `menuvia_qr_cart:<token>` și `menuvia_pickup_cart:<restaurant>`, iar
//        masa A nu apare sub masa B, nici ridicarea sub masă.
//        [PICĂ: scope-ul scos din cheie, sau cheia QR și cea de ridicare unite]
//   CK2  coș gol fără limbă → intrarea se șterge; coș gol CU limbă → rămâne
//        doar limba. [PICĂ: `saveCart` care scrie mereu, sau care șterge și
//        limba la golirea coșului]
//   CK3  TTL de 6 h, ca snapshot-ul sesiunii: înainte de prag coșul revine,
//        după prag întoarce null și curăță cheia. [PICĂ: verificarea TTL scoasă]
//   CK4  fiecare linie se validează la citire: o linie stricată se aruncă, nu
//        tot coșul; un delta negativ de opțiune și nota lipsă sunt valide
//        (control pozitiv). [PICĂ: validarea per linie scoasă (gunoiul ajunge
//        în React) sau un `return []` la prima linie stricată (tot coșul pierdut)]
//   CK5  JSON stricat / formă greșită / fără `savedAt` → null, fără throw.
//   CK6  storage OSTIL (RESID-15): get/set/remove aruncă `SecurityError` →
//        citirea dă null, scrierea și ștergerea NU aruncă — meniul QR citește
//        coșul în inițializatorul de `useState`. [PICĂ: orice acces scos din
//        try/catch]. Controlul pozitiv e CK1 (pe storage sănătos chiar scrie).
//   CK7  golirea după trimitere păstrează limba și scoate coșul; fără limbă
//        șterge cheia. [PICĂ: `clearSavedCart` care nu golește coșul — o
//        reîncărcare a confirmării ar reînvia coșul deja trimis]
//   CK8  limba salvată e doar un cod din MENU_LANGS.
//   CK9  `restoredMenuLang`: nimic salvat / limbă neoferită → undefined (cade
//        pe auto-detect); baza → null (alegere explicită); oferită → codul.
//   CK10 toate câmpurile cunoscute ale unei linii supraviețuiesc dus-întorsului,
//        iar `CART_ITEM_FIELDS` e exact mulțimea lor. [PICĂ: `toCartItem` care
//        uită `selected_extras` sau `upsell_source` — reîncărcarea ar pierde
//        tăcut extra-urile plătite sau atribuirea upsell-ului]
//   CK11 cablajul pe /q și /m: hidratare în inițializator (/q), golire LÂNGĂ
//        rotirea cheii de idempotență și la reset, salvare, limba restaurată
//        după încărcare. [PICĂ: golirea scoasă de pe calea de succes — coșul
//        trimis reînvie cu o cheie NOUĂ, adică exact comanda dublă]
//   CK12 repreluarea coșului REHIDRATAT la prețurile de acum, pe /q și /m,
//        verificată pe CORPUL efectului de hidratare (felia de la
//        `const before = hydratedCartRef.current` la lista lui de dependențe),
//        nu pe un `repriceCart(before, menu)` oarecare: pe /m textul ăsta
//        exista deja în `refreshMenu`, deci o căutare în tot fișierul trecea
//        și cu efectul ȘTERS. Ref-ul se consumă DUPĂ garda „meniu încărcat”,
//        iar anunțul de prețuri schimbate pleacă din efect. [PICĂ: efectul
//        șters (coșul de ieri rămâne cu prețurile de ieri, fără anunț), ref-ul
//        golit înaintea gărzii (consumat pe meniul încă gol), ref-ul nealimentat
//        din coșul salvat, anunțul scos].
//        Control pozitiv: aceeași felie pe codul curent conține toți pașii.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CART_ITEM_FIELDS,
  cartStorageKey,
  clearSavedCart,
  loadSavedCart,
  restoredMenuLang,
  sanitizeCart,
  saveCart,
  type CartScope,
} from '../cartPersist'
import type { CartItem } from '../orders'
import { makeCartItem } from '../../components/__tests__/fixtures'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const read = (f: string): string => readFileSync(resolve(process.cwd(), f), 'utf8')

const QR: CartScope = { kind: 'qr', token: 'tok-a' }
const PICKUP: CartScope = { kind: 'pickup', restaurantId: 'rest-1' }

function fullItem(overrides: Partial<CartItem> = {}): CartItem {
  return makeCartItem({
    _key: 'k-full',
    product_id: 'p-pizza',
    product_name_snapshot: 'Pizza',
    unit_price_snapshot: 30,
    quantity: 2,
    selected_modifiers: [
      {
        group_id: 'g-blat',
        group_name: 'Blat',
        option_id: 'o-puf',
        option_name: 'Pufos',
        price_delta: 2,
      },
    ],
    notes: 'fără ceapă',
    selected_extras: [{ id: 'x-ou', name: 'Ou', price: 3 }],
    upsell_source: 'pairing',
    ...overrides,
  })
}

describe('cartPersist — coșul salvat', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    sessionStorage.clear()
  })

  it('CK1 dus-întors pe chei separate per masă și per restaurant', () => {
    const cart = [fullItem(), makeCartItem({ _key: 'k2', product_id: 'p-apa' })]
    saveCart(QR, { cart, lang: 'de' })
    expect(cartStorageKey(QR)).toBe('menuvia_qr_cart:tok-a')
    expect(cartStorageKey(PICKUP)).toBe('menuvia_pickup_cart:rest-1')
    expect(sessionStorage.getItem('menuvia_qr_cart:tok-a')).not.toBeNull()

    expect(loadSavedCart(QR)).toEqual({ cart, lang: 'de' })
    // Masa B și ridicarea nu văd coșul mesei A.
    expect(loadSavedCart({ kind: 'qr', token: 'tok-b' })).toBeNull()
    expect(loadSavedCart({ kind: 'pickup', restaurantId: 'tok-a' })).toBeNull()

    saveCart(PICKUP, { cart: [makeCartItem({ _key: 'k3' })], lang: null })
    expect(loadSavedCart(PICKUP)?.cart.map((c) => c._key)).toEqual(['k3'])
    expect(loadSavedCart(QR)?.cart).toHaveLength(2)
  })

  it('CK2 coș gol fără limbă șterge intrarea; cu limbă păstrează doar limba', () => {
    saveCart(QR, { cart: [fullItem()], lang: null })
    expect(sessionStorage.getItem(cartStorageKey(QR))).not.toBeNull()
    saveCart(QR, { cart: [], lang: null })
    expect(sessionStorage.getItem(cartStorageKey(QR))).toBeNull()
    expect(loadSavedCart(QR)).toBeNull()

    saveCart(QR, { cart: [], lang: 'fr' })
    expect(loadSavedCart(QR)).toEqual({ cart: [], lang: 'fr' })
  })

  it('CK3 expiră după 6 h și curăță cheia', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    saveCart(QR, { cart: [fullItem()], lang: null })

    vi.setSystemTime(new Date('2026-11-01T15:59:00Z'))
    expect(loadSavedCart(QR)?.cart).toHaveLength(1)

    vi.setSystemTime(new Date('2026-11-01T16:00:01Z'))
    expect(loadSavedCart(QR)).toBeNull()
    expect(sessionStorage.getItem(cartStorageKey(QR))).toBeNull()
  })

  it('CK4 o linie stricată se aruncă, restul coșului rămâne', () => {
    const good = fullItem({ _key: 'ok' })
    const bad: unknown[] = [
      { ...good, _key: 'q0', quantity: 0 },
      { ...good, _key: 'q21', quantity: 21 },
      { ...good, _key: 'qfrac', quantity: 1.5 },
      { ...good, _key: 'qstr', quantity: '2' },
      { ...good, _key: 'pneg', unit_price_snapshot: -1 },
      { ...good, _key: 'pnull', unit_price_snapshot: null },
      { ...good, _key: 'noprod', product_id: '' },
      { ...good, _key: 'mods', selected_modifiers: 'x' },
      { ...good, _key: 'badmod', selected_modifiers: [{ group_id: 'g', option_id: 'o' }] },
      { ...good, _key: 'badextra', selected_extras: [{ id: 'x', name: 'X', price: 'trei' }] },
      { ...good, _key: 'badsrc', upsell_source: 'banner' },
      { ...good, _key: 'badnote', notes: 7 },
      null,
      'linie',
    ]
    // Dublură de `_key` (cheia de randare React): a doua apariție se aruncă.
    const dupe = { ...good, quantity: 5 }
    // Control pozitiv: delta negativ (varianta mică) și nota lipsă sunt valide.
    const negativeDelta = fullItem({
      _key: 'neg',
      selected_modifiers: [
        {
          group_id: 'g-m',
          group_name: 'Mărime',
          option_id: 'o-mic',
          option_name: 'Mic',
          price_delta: -4,
        },
      ],
    })
    // `JSON.stringify` scoate cheile `undefined`: o notă lipsă = fără notă.
    const noNotes: Record<string, unknown> = { ...fullItem({ _key: 'nonote' }) }
    delete noNotes.notes

    const out = sanitizeCart([good, ...bad, dupe, negativeDelta, noNotes])
    expect(out.map((c) => c._key)).toEqual(['ok', 'neg', 'nonote'])
    expect(out[0].quantity).toBe(2)
    expect(out[2].notes).toBeNull()

    // Prin storage: aceeași filtrare, nu tot coșul aruncat.
    sessionStorage.setItem(
      cartStorageKey(QR),
      JSON.stringify({ cart: [good, ...bad, negativeDelta], lang: null, savedAt: Date.now() }),
    )
    expect(loadSavedCart(QR)?.cart.map((c) => c._key)).toEqual(['ok', 'neg'])

    // Numai linii stricate și fără limbă → nimic de restaurat.
    sessionStorage.setItem(
      cartStorageKey(QR),
      JSON.stringify({ cart: bad, lang: null, savedAt: Date.now() }),
    )
    expect(loadSavedCart(QR)).toBeNull()
  })

  it('CK5 JSON stricat sau formă greșită → null, fără throw', () => {
    for (const raw of ['{nu e json', 'null', '[]', '42', JSON.stringify({ cart: [fullItem()] })]) {
      sessionStorage.setItem(cartStorageKey(QR), raw)
      expect(() => loadSavedCart(QR)).not.toThrow()
      expect(loadSavedCart(QR)).toBeNull()
    }
    sessionStorage.setItem(
      cartStorageKey(QR),
      JSON.stringify({ cart: 'nu e listă', lang: null, savedAt: Date.now() }),
    )
    expect(loadSavedCart(QR)).toBeNull()
  })

  it('CK6 storage care aruncă SecurityError nu omoară meniul (RESID-15)', () => {
    const deny = (): never => {
      throw new DOMException('denied', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(deny)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(deny)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(deny)

    // Exact apelul din inițializatorul de `useState` al lui QrMenuPage.
    expect(() => loadSavedCart(QR)).not.toThrow()
    expect(loadSavedCart(QR)).toBeNull()
    expect(() => saveCart(QR, { cart: [fullItem()], lang: 'de' })).not.toThrow()
    expect(() => saveCart(QR, { cart: [], lang: null })).not.toThrow()
    expect(() => clearSavedCart(QR)).not.toThrow()
  })

  it('CK7 golirea după trimitere scoate coșul și păstrează limba', () => {
    saveCart(QR, { cart: [fullItem()], lang: 'it' })
    clearSavedCart(QR)
    expect(loadSavedCart(QR)).toEqual({ cart: [], lang: 'it' })

    saveCart(PICKUP, { cart: [fullItem()], lang: null })
    clearSavedCart(PICKUP)
    expect(sessionStorage.getItem(cartStorageKey(PICKUP))).toBeNull()
    expect(loadSavedCart(PICKUP)).toBeNull()

    // Fără nimic salvat: no-op, fără throw.
    expect(() => clearSavedCart({ kind: 'qr', token: 'nimic' })).not.toThrow()
  })

  it('CK8 limba salvată e doar un cod de meniu cunoscut', () => {
    for (const lang of ['xx', 'EN', 'de-DE', 5, '']) {
      sessionStorage.setItem(
        cartStorageKey(QR),
        JSON.stringify({ cart: [fullItem()], lang, savedAt: Date.now() }),
      )
      expect(loadSavedCart(QR)?.lang).toBeNull()
    }
    sessionStorage.setItem(
      cartStorageKey(QR),
      JSON.stringify({ cart: [fullItem()], lang: 'hu', savedAt: Date.now() }),
    )
    expect(loadSavedCart(QR)?.lang).toBe('hu')
  })

  it('CK9 restoredMenuLang: undefined / null (baza) / codul', () => {
    expect(restoredMenuLang(null, ['en', 'de'], 'ro')).toBeUndefined()
    expect(restoredMenuLang('es', ['en', 'de'], 'ro')).toBeUndefined()
    expect(restoredMenuLang('ro', ['en', 'de'], 'ro')).toBeNull()
    expect(restoredMenuLang('de', ['en', 'de'], 'ro')).toBe('de')
    // Baza e a LOCALULUI (lotul O6a): pe un meniu francez, „fr” = baza.
    expect(restoredMenuLang('fr', ['ro'], 'fr')).toBeNull()
  })

  it('CK10 toate câmpurile unei linii supraviețuiesc dus-întorsului', () => {
    const item = fullItem()
    const keys = Object.keys(item).sort()
    expect(keys).toEqual(Object.keys(CART_ITEM_FIELDS).sort())
    saveCart(QR, { cart: [item], lang: null })
    const back = loadSavedCart(QR)?.cart[0]
    expect(back).toEqual(item)
    expect(back && Object.keys(back).sort()).toEqual(keys)
    // Un câmp NECUNOSCUT din storage nu intră în linie.
    const withJunk = { ...item, admin: true }
    expect(sanitizeCart([withJunk])[0]).toEqual(item)
  })
})

describe('cartPersist — cablajul pe /q și /m', () => {
  it('CK11 hidratare, golire pe succes și la reset, salvare, repreluare, limbă', () => {
    const qr = read('src/pages/QrMenuPage.tsx')
    // Hidratarea e în inițializatorul lui useState (RESID-15 e în loadSavedCart).
    expect(qr).toMatch(/useState\(\(\) => loadSavedCart\(cartScope\)\)/)
    expect(qr).toMatch(/useState<CartItem\[\]>\(\(\) => savedCart\?\.cart \?\? \[\]\)/)
    expect(qr).toMatch(/kind: 'qr', token/)

    // Calea de succes: golirea stă DUPĂ rotirea cheii și ÎNAINTEA confirmării.
    const okStart = qr.indexOf('const result = await createOrder(')
    const okEnd = qr.indexOf('setConfirmation(result)', okStart)
    expect(okStart).toBeGreaterThan(0)
    expect(okEnd).toBeGreaterThan(okStart)
    const ok = qr.slice(okStart, okEnd)
    const rotate = ok.indexOf('setIdempotencyKey(rotateQrIdempotencyKey(token))')
    const clear = ok.indexOf('clearSavedCart(cartScope)')
    expect(rotate).toBeGreaterThan(0)
    expect(clear).toBeGreaterThan(rotate)
    expect(ok.slice(clear)).toMatch(/setCart\(\[\]\)/)

    // Reset-ul golește și el coșul salvat.
    const reset = qr.slice(qr.indexOf('function handleReset('), qr.indexOf('useDocumentLang(lang)'))
    expect(reset).toMatch(/clearSavedCart\(cartScope\)/)

    expect(qr).toMatch(/saveCart\(cartScope, \{/)
    expect(qr).toMatch(/restoredMenuLang\(restoredLangRef\.current, availableLangs, baseLang\)/)

    const pub = read('src/pages/PublicMenuPage.tsx')
    expect(pub).toMatch(/kind: 'pickup', restaurantId: pickupCartId/)
    expect(pub).toMatch(/loadSavedCart\(pickupCartScope\)/)
    expect(pub).toMatch(/saveCart\(pickupCartScope, \{/)
    expect(pub).toMatch(/restoredMenuLang\(restoredLangRef\.current, availableLangs, baseLang\)/)
    // Ridicarea reușită golește coșul salvat înainte de confirmare.
    const pStart = pub.indexOf('onSuccess={(short_id, pickup_time, total) => {')
    const pEnd = pub.indexOf('setConfirmation({ short_id, pickup_time, total })', pStart)
    expect(pStart).toBeGreaterThan(0)
    expect(pEnd).toBeGreaterThan(pStart)
    expect(pub.slice(pStart, pEnd)).toMatch(/clearSavedCart\(pickupCartScope\)/)
  })

  // Felia efectului de hidratare: de la citirea ref-ului până la lista lui de
  // dependențe. Ancorele sunt text care există DOAR în acest efect (nu în
  // `refreshMenu`, care citește `cartRef.current`), deci un efect șters face
  // ca felia să lipsească, nu ca aserția să găsească alt apel.
  function hydrationEffect(src: string, deps: string): string {
    const start = src.indexOf('const before = hydratedCartRef.current')
    expect(start).toBeGreaterThan(0)
    const end = src.indexOf(deps, start)
    expect(end).toBeGreaterThan(start)
    return src.slice(start, end)
  }

  function expectGuardBeforeConsume(effect: string, guard: string): void {
    const g = effect.indexOf(guard)
    const consume = effect.indexOf('hydratedCartRef.current = null')
    expect(g).toBeGreaterThan(0)
    expect(consume).toBeGreaterThan(g)
    // Repreluarea folosește coșul HIDRATAT, apoi actualizarea e funcțională.
    const reprice = effect.indexOf('repriceCart(before, menu)')
    expect(reprice).toBeGreaterThan(consume)
    const update = effect.indexOf('setCart((prev) => repriceCart(prev, menu).cart)')
    expect(update).toBeGreaterThan(reprice)
  }

  it('CK12 coșul rehidratat trece pe prețurile de acum, în efectul de hidratare', () => {
    const qr = read('src/pages/QrMenuPage.tsx')
    // Sursa ref-ului: coșul salvat, doar dacă are linii.
    const qrRefSource = new RegExp(
      String.raw`useRef<CartItem\[\] \| null>\(\s*` +
        String.raw`savedCart != null && savedCart\.cart\.length > 0 \? savedCart\.cart : null,?\s*\)`,
    )
    expect(qr).toMatch(qrRefSource)
    const qrEffect = hydrationEffect(qr, '}, [menuLoaded, categories])')
    expectGuardBeforeConsume(qrEffect, 'if (before == null || !menuLoaded) return')
    expect(qrEffect).toContain('setHydratedRepriced(true)')
    // Anunțul (toast) pleacă din efectul care urmărește steagul.
    const nStart = qr.indexOf('if (!hydratedRepriced) return')
    const nEnd = qr.indexOf('}, [hydratedRepriced, orderingAllowed, lang, toast])', nStart)
    expect(nStart).toBeGreaterThan(0)
    expect(nEnd).toBeGreaterThan(nStart)
    expect(qr.slice(nStart, nEnd)).toContain("toast.info(T(lang, 'cart_prices_updated'))")

    const pub = read('src/pages/PublicMenuPage.tsx')
    // Sursa ref-ului: coșul de ridicare salvat, doar dacă are linii.
    expect(pub).toMatch(/hydratedCartRef\.current = saved\.cart\s*\n\s*setCart\(saved\.cart\)/)
    // Garda e „meniul s-a încărcat CU SUCCES”, nu numărul de categorii: un
    // meniu încărcat gol e meniul de acum (recenzia pe #396, CM10/CM11).
    const pubEffect = hydrationEffect(pub, '}, [menuLoaded, categories])')
    expectGuardBeforeConsume(pubEffect, 'if (before == null || !menuLoaded) return')
    // Anunțul de pe /m: cheile repreluate alimentează `pricesUpdated`.
    expect(pubEffect).toContain('setRepricedKeys(')
  })
})

// Detecția unică a erorilor de rețea (lib/networkError.ts). Defectul reparat
// (ux-guest-9 + coada offline a ospătarului): fiecare ecran avea lista lui de
// subșiruri, iar niciuna nu cunoștea „Load failed" — textul cu care Safari pe
// iPhone respinge un fetch. Pe iPhone comanda QR nu se reîncerca, iar comanda
// ospătarului nu intra în coada offline.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { isNetworkError } from '../networkError'
import { isNetworkGuestError } from '../guestErrors'

describe('isNetworkError', () => {
  it('NE1 recunoaște căderea de rețea pe FIECARE browser, ca Error și ca eroare supabase-js', () => {
    // Mutație: scoate `load failed` din regex → cazurile Safari pică.
    const messages = [
      'TypeError: Failed to fetch', // Chrome/Edge, prin supabase-js
      'TypeError: Load failed', // Safari / iPhone, prin supabase-js
      // Chrome, conexiunea cade în timpul citirii corpului (reset HTTP/2/QUIC
      // după antetele 200). Lista veche a oaspetelui o prindea prin `network`
      // gol; fără ea, comanda deja înregistrată nu se mai reîncerca și
      // oaspetele vedea „Comanda nu s-a trimis” (recenzie adversarială #321).
      'TypeError: network error',
      'Network request failed', // cross-fetch / React Native
      'Load failed',
      'The Internet connection appears to be offline.',
      'The network connection was lost.',
      'TypeError: NetworkError when attempting to fetch resource.', // Firefox
      'fetch failed mid-flight', // Node/undici (teste, contractul din orders-create)
      'network-error', // marcajul intern din createOrder
    ]
    for (const m of messages) {
      expect(isNetworkError(new Error(m)), m).toBe(true)
      // supabase-js NU aruncă la o cădere de rețea: întoarce `{ error }` cu mesajul fetch-ului.
      expect(isNetworkError({ message: m, details: '', hint: '', code: '' }), `obiect: ${m}`).toBe(
        true,
      )
    }
  })

  it('NE2 control negativ: refuzurile de business NU sunt rețea (nu se reîncearcă)', () => {
    const business = [
      'Selectează opțiunile obligatorii pentru „Ciorbă de burtă".',
      'Not authorized for this restaurant',
      'Order is already terminal (status: paid)',
      'update_order_items: comanda a fost modificată între timp (total 25, așteptat 20).',
      'Featurea X nu e disponibilă pe planul tău',
    ]
    for (const m of business) {
      expect(isNetworkError(new Error(m)), m).toBe(false)
      expect(isNetworkError({ message: m, code: 'P0001', hint: 'invalid_transition' }), m).toBe(
        false,
      )
    }
  })

  it('NE3 TypeError (respingerea fetch-ului) = rețea; valorile fără mesaj = nu', () => {
    expect(isNetworkError(new TypeError('orice'))).toBe(true)
    expect(isNetworkError(null)).toBe(false)
    expect(isNetworkError(undefined)).toBe(false)
    expect(isNetworkError(42)).toBe(false)
    expect(isNetworkError({ message: 123 })).toBe(false)
  })
})

// Clichet: fișierele care TRIMIT comenzi nu-și mai scriu propria listă de
// subșiruri — o listă locală e exact forma care a ratat „Load failed".
// Mutație: readuci vechiul `msg.includes('fetch') || msg.includes('network')`
// în QrMenuPage / WaiterEntry / orders.ts → NE4 pică.
const ORDER_FLOW_FILES = [
  'src/pages/QrMenuPage.tsx',
  'src/components/WaiterEntry.tsx',
  'src/lib/orders.ts',
]
const LOCAL_LIST =
  /\.includes\(\s*['"](?:fetch|failed to fetch|network|networkerror|load failed)['"]\s*\)/i

describe('clichet: detecția de rețea are o singură sursă pe fluxul de comandă', () => {
  it('NE4 niciun fișier al fluxului nu are listă locală de subșiruri', () => {
    const hits: string[] = []
    for (const f of ORDER_FLOW_FILES) {
      readFileSync(resolve(process.cwd(), f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (LOCAL_LIST.test(line)) hits.push(`${f}:${i + 1}`)
        })
    }
    expect(hits).toEqual([])
  })

  it('NE5 control pozitiv: scanerul prinde forma veche', () => {
    expect(LOCAL_LIST.test("const n = msg.includes('fetch') || msg.includes('network')")).toBe(true)
    expect(LOCAL_LIST.test('if (isNetworkError(e)) retry()')).toBe(false)
  })
})

// Oaspetele și staff-ul au aceeași detecție. #317 (meniul QR) și #321 (ospătar,
// coada offline) reparaseră „Load failed” în paralel, fiecare cu lista lui;
// `isNetworkGuestError` (lib/guestErrors) deleagă acum aici. Mutația care pică:
// readuci regex-ul propriu din guestErrors, cu `network|fetch|offline` goale —
// un refuz de server care conține „network” devine „verifică-ți conexiunea”.
describe('clichet: oaspetele și staff-ul au aceeași detecție de rețea', () => {
  it('NE6 isNetworkGuestError dă exact verdictul lui isNetworkError', () => {
    const cases: unknown[] = [
      new Error('TypeError: Load failed'),
      { message: 'TypeError: Failed to fetch', code: '' },
      new TypeError('orice'),
      new Error('Not authorized for this restaurant'),
      // Refuzuri care conțin subșirurile pe care lista veche le lua drept rețea.
      { message: 'network policy denied', code: 'P0001' },
      new Error('Could not fetch restaurant settings'),
      new Error('Restaurant is offline for maintenance'),
      null,
      undefined,
    ]
    for (const c of cases) {
      expect(isNetworkGuestError(c), String((c as { message?: unknown })?.message ?? c)).toBe(
        isNetworkError(c),
      )
    }
  })

  it('NE7 guestErrors nu are o listă proprie de subșiruri de rețea', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/guestErrors.ts'), 'utf8')
    expect(src).toMatch(/from '\.\/networkError'/)
    expect(src).not.toMatch(/load failed|failed to fetch/i)
  })
})

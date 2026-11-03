// Lotul E (mig 312): reluarea confirmării după redirect-ul Stripe, snapshot-ul
// „masa plătită” și polling-ul confirmării de la server.
//
//   W1  return_url-ul poartă plata, sesiunea și felul; revenirea se citește
//       înapoi exact, URL-ul se curăță de TOȚI parametrii revenirii (inclusiv
//       `payment_intent_client_secret`) și își păstrează restul; fără
//       parametrii Stripe nu e revenire; fără sesiune validă nu se reia nimic;
//       felul lipsă = `split` (nu marcăm masa plătită pe ghicite); fără `tp`
//       referința cade pe `payment_intent`
//       Mutația care pică: `kind` implicit `table`; `stripTablePaymentReturn`
//       care uită `payment_intent_client_secret`; parse fără garda de sesiune.
//   W3  `snapshotTablePaid`: masa e plătită după reload DOAR dacă TOATE
//       comenzile din snapshot sunt marcate plătite (adică au trecut prin
//       confirmarea serverului); o rundă nouă neplătită o face din nou
//       neplătită; snapshot gol / lipsă = neplătită
//       Mutația care pică: `some` în loc de `every`; fără garda de listă goală.
//   P1  `unknown` (eroare / plafon) și o respingere a cererii NU termină
//       polling-ul și nu devin niciodată `succeeded` — se ajunge la `timeout`
//       Mutația care pică: `unknown` tratat ca terminal / `.catch` scos.
//   P2  oprirea ignoră și răspunsul aflat DEJA în zbor
//       Mutația care pică: garda `if (stopped) return` scoasă din `.then`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildTablePaymentReturnUrl,
  parseTablePaymentReturn,
  stripTablePaymentReturn,
  pollTablePaymentStatus,
  CONFIRM_DEADLINE_MS,
  CONFIRM_POLL_DELAYS_MS,
  CONFIRM_FAILED_GRACE_MS,
  type ServerConfirmOutcome,
} from '../tablePaymentConfirm'
import { saveQrSessionSnapshot, loadQrSessionSnapshot, snapshotTablePaid } from '../qrSession'
import type { OrderConfirmationPayload } from '../orders'
import type { TablePaymentPublicStatus } from '../payments'

const SESSION = '11111111-1111-4111-8111-111111111111'
const PAYMENT = '22222222-2222-4222-8222-222222222222'

/** Ce adaugă Stripe la return_url la revenire. */
function stripeReturn(url: string, status = 'succeeded'): string {
  const u = new URL(url)
  u.searchParams.set('payment_intent', 'pi_3Abc')
  u.searchParams.set('payment_intent_client_secret', 'pi_3Abc_secret_xyz')
  u.searchParams.set('redirect_status', status)
  return u.toString()
}

describe('W1 return_url: reluarea după redirect', () => {
  const page = 'https://menuvia.example/q/tok_abc?lang=en#menu'

  it('dus-întors: plata, sesiunea, felul; curățarea păstrează restul URL-ului', () => {
    const built = buildTablePaymentReturnUrl(page, { paymentId: PAYMENT, sessionId: SESSION, kind: 'table' })
    const back = stripeReturn(built)
    expect(parseTablePaymentReturn(back)).toEqual({
      paymentRef: PAYMENT,
      sessionId: SESSION,
      kind: 'table',
      redirectFailed: false,
    })
    const clean = stripTablePaymentReturn(back)
    expect(clean).toBe('/q/tok_abc?lang=en#menu')
    expect(clean).not.toMatch(/secret|payment_intent|redirect_status|tp=|tps=|tpk=/)
    expect(parseTablePaymentReturn('https://menuvia.example' + clean)).toBeNull()
  })

  it('redirect eșuat, fel lipsă, referință din payment_intent, URL fără revenire / fără sesiune', () => {
    const failed = stripeReturn(
      buildTablePaymentReturnUrl(page, { paymentId: PAYMENT, sessionId: SESSION, kind: 'split' }),
      'failed',
    )
    expect(parseTablePaymentReturn(failed)).toMatchObject({ kind: 'split', redirectFailed: true })

    const noKind = new URL(stripeReturn(page))
    noKind.searchParams.set('tps', SESSION)
    // Fără `tp` și fără `tpk`: referința e intent-ul, felul NU e ghicit „table”.
    expect(parseTablePaymentReturn(noKind.toString())).toEqual({
      paymentRef: 'pi_3Abc',
      sessionId: SESSION,
      kind: 'split',
      redirectFailed: false,
    })

    expect(parseTablePaymentReturn(page)).toBeNull()
    expect(parseTablePaymentReturn(stripeReturn(page))).toBeNull() // fără sesiune
    const badSession = new URL(stripeReturn(page))
    badSession.searchParams.set('tps', 'nu-e-uuid')
    expect(parseTablePaymentReturn(badSession.toString())).toBeNull()
    expect(parseTablePaymentReturn('nu e un url')).toBeNull()
  })

  it('un return_url refăcut nu dublează parametrii (o a doua plată pe aceeași pagină)', () => {
    const once = buildTablePaymentReturnUrl(stripeReturn(page), {
      paymentId: PAYMENT,
      sessionId: SESSION,
      kind: 'table',
    })
    const u = new URL(once)
    expect(u.searchParams.getAll('tp')).toEqual([PAYMENT])
    expect(u.searchParams.get('payment_intent')).toBeNull()
    expect(u.searchParams.get('lang')).toBe('en')
  })
})

describe('W3 snapshot: „masa plătită” supraviețuiește reîncărcării doar după server', () => {
  const order = (id: string): OrderConfirmationPayload =>
    ({ id, total: 10 }) as unknown as OrderConfirmationPayload

  afterEach(() => sessionStorage.clear())

  it('toate comenzile marcate (confirmate de server) → plătită după save/load', () => {
    saveQrSessionSnapshot('tok_w3', {
      previousOrders: [order('o1'), order('o2')],
      sessionId: SESSION,
      paidOrderIds: ['o1', 'o2'],
    })
    expect(snapshotTablePaid(loadQrSessionSnapshot('tok_w3'))).toBe(true)
  })

  it('o rundă nouă neplătită, nimic marcat, snapshot gol sau lipsă → neplătită', () => {
    expect(
      snapshotTablePaid({ previousOrders: [order('o1'), order('o2')], paidOrderIds: ['o1'] }),
    ).toBe(false)
    expect(snapshotTablePaid({ previousOrders: [order('o1')], paidOrderIds: [] })).toBe(false)
    expect(snapshotTablePaid({ previousOrders: [], paidOrderIds: ['o1'] })).toBe(false)
    expect(snapshotTablePaid(null)).toBe(false)
    expect(snapshotTablePaid(loadQrSessionSnapshot('tok_w3_lipsa'))).toBe(false)
  })
})

describe('polling-ul confirmării', () => {
  afterEach(() => vi.useRealTimers())

  it('P1 unknown și respingerile nu termină și nu devin succeeded → timeout', async () => {
    vi.useFakeTimers()
    let n = 0
    const fetchStatus = vi.fn((): Promise<TablePaymentPublicStatus> => {
      n += 1
      return n % 2 === 0 ? Promise.reject(new Error('rețea')) : Promise.resolve('unknown')
    })
    const outcomes: ServerConfirmOutcome[] = []
    pollTablePaymentStatus(fetchStatus, (o) => outcomes.push(o))
    await vi.advanceTimersByTimeAsync(CONFIRM_DEADLINE_MS - 1)
    expect(outcomes).toEqual([])
    await vi.advanceTimersByTimeAsync(CONFIRM_POLL_DELAYS_MS[CONFIRM_POLL_DELAYS_MS.length - 1] + 1)
    expect(outcomes).toEqual(['timeout'])
    expect(fetchStatus.mock.calls.length).toBeGreaterThan(5)
    // Termenul e mai lung decât grația pentru `failed` (altfel un retry de card
    // pe același intent n-ar avea când să ajungă la `succeeded`).
    expect(CONFIRM_DEADLINE_MS).toBeGreaterThan(CONFIRM_FAILED_GRACE_MS)
  })

  it('P2 oprirea ignoră și răspunsul aflat deja în zbor', async () => {
    const gate: { release?: (s: TablePaymentPublicStatus) => void } = {}
    const fetchStatus = vi.fn(
      () =>
        new Promise<TablePaymentPublicStatus>((resolve) => {
          gate.release = resolve
        }),
    )
    const onOutcome = vi.fn()
    const stop = pollTablePaymentStatus(fetchStatus, onOutcome)
    expect(fetchStatus).toHaveBeenCalledTimes(1) // prima cerere e în zbor
    expect(gate.release).toBeDefined()
    stop()
    gate.release?.('succeeded')
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(onOutcome).not.toHaveBeenCalled()
  })
})

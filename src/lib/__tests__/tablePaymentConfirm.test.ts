// Lotul E (mig 312): reluarea confirmării după redirect-ul Stripe, snapshot-ul
// „masa plătită” și polling-ul confirmării de la server.
//
//   W1  return_url-ul poartă plata și sesiunea, NU felul (`tpk` — îl spune
//       serverul); revenirea se citește înapoi exact (cu succesul raportat de
//       browser din `redirect_status`), URL-ul se curăță de TOȚI parametrii
//       revenirii (inclusiv `payment_intent_client_secret` și `tpk` moștenit)
//       și își păstrează restul; fără parametrii Stripe nu e revenire; fără
//       sesiune validă nu se reia nimic; fără `tp` referința cade pe
//       `payment_intent`
//       Mutația care pică: `tpk` scris în return_url; `stripTablePaymentReturn`
//       care uită `payment_intent_client_secret`; parse fără garda de sesiune.
//   W4  curățarea URL-ului NU depinde de parsare: orice parametru al revenirii
//       (chiar cu sesiune stricată / doar `tpk`) → URL curățat; niciunul → null
//       Mutația care pică: curățarea condiționată de `parseTablePaymentReturn`.
//   K1  „masa plătită” se decide pe felul spus de SERVER: doar `succeeded` +
//       `table`; `split`/`unknown` NU; handler-ul `onPaid` al QrMenuPage îl
//       aplică (și pagina îl folosește pe AMBELE PayTableSheet — clichet pe sursă)
//       Mutația care pică: `onPaid` necondiționat (helper sau pagină).
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
//   P3  cu succes raportat de browser, `failed` din DB NU e terminal: primul
//       card refuzat (`failed`) peste grație → apoi `succeeded` = `succeeded`;
//       fără succes raportat, același `failed` e terminal după grație
//       Mutația care pică: parametrul `browserStatus` ignorat.
//   P4  o cerere care nu se întoarce NICIODATĂ → `timeout` la termen (paznic pe
//       ceas real), nu „confirmăm…” la nesfârșit
//       Mutația care pică: paznicul scos (termenul numărat doar pe pauze).
//   P5  o excepție în `onOutcome` nu scapă din polling și nu-l repornește
//       Mutația care pică: try/catch scos din `finish`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildTablePaymentReturnUrl,
  parseTablePaymentReturn,
  stripTablePaymentReturn,
  pollTablePaymentStatus,
  tablePaymentReturnCleanUrl,
  applyTablePaymentOutcome,
  makeServerPaidHandler,
  CONFIRM_DEADLINE_MS,
  CONFIRM_POLL_DELAYS_MS,
  CONFIRM_FAILED_GRACE_MS,
  type ServerConfirmOutcome,
} from '../tablePaymentConfirm'
import { saveQrSessionSnapshot, loadQrSessionSnapshot, snapshotTablePaid } from '../qrSession'
import type { OrderConfirmationPayload } from '../orders'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TablePaymentPublicResult, TablePaymentPublicStatus } from '../payments'

const r = (
  status: TablePaymentPublicStatus,
  kind: TablePaymentPublicResult['kind'] = 'table',
): TablePaymentPublicResult => ({ status, kind })

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
    const built = buildTablePaymentReturnUrl(page, { paymentId: PAYMENT, sessionId: SESSION })
    // Felul NU călătorește prin URL — îl spune serverul (mig 312, `kind`).
    expect(new URL(built).searchParams.has('tpk')).toBe(false)
    const back = stripeReturn(built)
    expect(parseTablePaymentReturn(back)).toEqual({
      paymentRef: PAYMENT,
      sessionId: SESSION,
      redirectFailed: false,
      browserStatus: 'succeeded',
    })
    const clean = stripTablePaymentReturn(back)
    expect(clean).toBe('/q/tok_abc?lang=en#menu')
    expect(clean).not.toMatch(/secret|payment_intent|redirect_status|tp=|tps=|tpk=/)
    expect(parseTablePaymentReturn('https://menuvia.example' + clean)).toBeNull()
  })

  it('redirect eșuat / processing, referință din payment_intent, URL fără revenire / fără sesiune', () => {
    const built = buildTablePaymentReturnUrl(page, { paymentId: PAYMENT, sessionId: SESSION })
    expect(parseTablePaymentReturn(stripeReturn(built, 'failed'))).toMatchObject({
      redirectFailed: true,
      browserStatus: null,
    })
    expect(parseTablePaymentReturn(stripeReturn(built, 'processing'))).toMatchObject({
      redirectFailed: false,
      browserStatus: 'processing',
    })

    const noTp = new URL(stripeReturn(page))
    noTp.searchParams.set('tps', SESSION)
    noTp.searchParams.set('tpk', 'table') // moștenit: ignorat la citire
    // Fără `tp`: referința e intent-ul.
    expect(parseTablePaymentReturn(noTp.toString())).toEqual({
      paymentRef: 'pi_3Abc',
      sessionId: SESSION,
      redirectFailed: false,
      browserStatus: 'succeeded',
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
    })
    const u = new URL(once)
    expect(u.searchParams.getAll('tp')).toEqual([PAYMENT])
    expect(u.searchParams.get('payment_intent')).toBeNull()
    expect(u.searchParams.get('lang')).toBe('en')
  })
})

describe('W4 curățarea URL-ului nu depinde de parsare', () => {
  const page = 'https://menuvia.example/q/tok_abc?lang=en#menu'

  it('orice parametru al revenirii → curățat, chiar dacă revenirea nu se poate citi', () => {
    // Sesiune stricată: parse = null, dar secretul NU are voie să rămână.
    const broken = new URL(stripeReturn(page))
    broken.searchParams.set('tps', 'nu-e-uuid')
    expect(parseTablePaymentReturn(broken.toString())).toBeNull()
    expect(tablePaymentReturnCleanUrl(broken.toString())).toBe('/q/tok_abc?lang=en#menu')

    for (const k of ['payment_intent', 'payment_intent_client_secret', 'redirect_status', 'tp', 'tps', 'tpk']) {
      const u = new URL(page)
      u.searchParams.set(k, 'x')
      expect(tablePaymentReturnCleanUrl(u.toString())).toBe('/q/tok_abc?lang=en#menu')
    }
  })

  it('fără parametri ai revenirii / URL invalid → null (nimic de curățat)', () => {
    expect(tablePaymentReturnCleanUrl(page)).toBeNull()
    expect(tablePaymentReturnCleanUrl('nu e un url')).toBeNull()
  })
})

describe('K1 „masa plătită” pe felul spus de server', () => {
  it('doar succeeded + table marchează masa', () => {
    expect(applyTablePaymentOutcome({ kind: 'table', status: 'succeeded' })).toEqual({ markTablePaid: true })
    expect(applyTablePaymentOutcome({ kind: 'split', status: 'succeeded' })).toEqual({ markTablePaid: false })
    expect(applyTablePaymentOutcome({ kind: 'unknown', status: 'succeeded' })).toEqual({ markTablePaid: false })
    expect(applyTablePaymentOutcome({ kind: 'table', status: 'timeout' })).toEqual({ markTablePaid: false })
    expect(applyTablePaymentOutcome({ kind: 'table', status: 'failed' })).toEqual({ markTablePaid: false })
  })

  it('handler-ul onPaid nu marchează pe split / unknown', () => {
    const mark = vi.fn()
    const onPaid = makeServerPaidHandler(mark)
    onPaid('split')
    onPaid('unknown')
    expect(mark).not.toHaveBeenCalled()
    onPaid('table')
    expect(mark).toHaveBeenCalledTimes(1)
  })

  it('QrMenuPage: AMBELE PayTableSheet primesc handler-ul, felul nu vine din URL', () => {
    // Calea din `process.cwd()` (rădăcina repo-ului), ca în qr-scan.test.ts.
    const src = readFileSync(resolve(process.cwd(), 'src/pages/QrMenuPage.tsx'), 'utf8')
    expect(src).toContain('makeServerPaidHandler(markTablePaidLocally)')
    expect(src.match(/onPaid=\{onServerPaid\}/g)?.length).toBe(2)
    expect(src).not.toMatch(/onPaid=\{markTablePaidLocally\}/)
    expect(src).not.toMatch(/resumePayment\.kind/)
    // Curățarea URL-ului nu e condiționată de reușita parsării.
    expect(src).toContain('tablePaymentReturnCleanUrl(window.location.href)')
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
    const fetchStatus = vi.fn((): Promise<TablePaymentPublicResult> => {
      n += 1
      return n % 2 === 0 ? Promise.reject(new Error('rețea')) : Promise.resolve(r('unknown', 'unknown'))
    })
    const outcomes: ServerConfirmOutcome[] = []
    pollTablePaymentStatus(fetchStatus, (o) => {
      outcomes.push(o)
    })
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
    const gate: { release?: (s: TablePaymentPublicResult) => void } = {}
    const fetchStatus = vi.fn(
      () =>
        new Promise<TablePaymentPublicResult>((resolve) => {
          gate.release = resolve
        }),
    )
    const onOutcome = vi.fn()
    const stop = pollTablePaymentStatus(fetchStatus, onOutcome)
    expect(fetchStatus).toHaveBeenCalledTimes(1) // prima cerere e în zbor
    expect(gate.release).toBeDefined()
    stop()
    gate.release?.(r('succeeded'))
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(onOutcome).not.toHaveBeenCalled()
  })

  /** Serverul spune `failed` până la `untilMs`, apoi `succeeded` (ceas fals). */
  function failedThenSucceeded(untilMs: number) {
    const start = Date.now()
    return vi.fn(
      (): Promise<TablePaymentPublicResult> =>
        Promise.resolve(Date.now() - start < untilMs ? r('failed') : r('succeeded')),
    )
  }

  it('P3 succes raportat de browser: `failed` peste grație NU e terminal, apoi succeeded', async () => {
    vi.useFakeTimers()
    const until = CONFIRM_FAILED_GRACE_MS + 5_000
    const outcomes: Array<[ServerConfirmOutcome, string]> = []
    pollTablePaymentStatus(failedThenSucceeded(until), (o, k) => {
      outcomes.push([o, k])
    }, { browserStatus: 'succeeded' })
    await vi.advanceTimersByTimeAsync(CONFIRM_FAILED_GRACE_MS + 1_000)
    expect(outcomes).toEqual([]) // încă așteptăm, deși `failed` a trecut de grație
    await vi.advanceTimersByTimeAsync(10_000)
    expect(outcomes).toEqual([['succeeded', 'table']])
  })

  it('P3 fără succes raportat: același `failed` e terminal după grație', async () => {
    vi.useFakeTimers()
    const outcomes: ServerConfirmOutcome[] = []
    pollTablePaymentStatus(failedThenSucceeded(CONFIRM_FAILED_GRACE_MS + 5_000), (o) => {
      outcomes.push(o)
    })
    await vi.advanceTimersByTimeAsync(CONFIRM_FAILED_GRACE_MS - 500)
    expect(outcomes).toEqual([]) // în grație
    await vi.advanceTimersByTimeAsync(4_000)
    expect(outcomes).toEqual(['failed'])
  })

  it('P3 succes raportat + `failed` până la termen → timeout (în curs de confirmare), nu failed', async () => {
    vi.useFakeTimers()
    const outcomes: ServerConfirmOutcome[] = []
    pollTablePaymentStatus(() => Promise.resolve(r('failed')), (o) => {
      outcomes.push(o)
    }, { browserStatus: 'processing' })
    await vi.advanceTimersByTimeAsync(CONFIRM_DEADLINE_MS + 1)
    expect(outcomes).toEqual(['timeout'])
  })

  it('P4 o cerere care nu se întoarce niciodată → timeout la termen', async () => {
    vi.useFakeTimers()
    const fetchStatus = vi.fn(() => new Promise<TablePaymentPublicResult>(() => {}))
    const outcomes: ServerConfirmOutcome[] = []
    pollTablePaymentStatus(fetchStatus, (o) => {
      outcomes.push(o)
    })
    await vi.advanceTimersByTimeAsync(CONFIRM_DEADLINE_MS - 1)
    expect(outcomes).toEqual([])
    await vi.advanceTimersByTimeAsync(2)
    expect(outcomes).toEqual(['timeout'])
    expect(fetchStatus).toHaveBeenCalledTimes(1)
  })

  it('P5 o excepție în onOutcome nu scapă și nu repornește polling-ul', async () => {
    vi.useFakeTimers()
    const fetchStatus = vi.fn(() => Promise.resolve(r('succeeded')))
    const onOutcome = vi.fn(() => {
      throw new Error('sessionStorage blocat')
    })
    pollTablePaymentStatus(fetchStatus, onOutcome)
    await vi.advanceTimersByTimeAsync(CONFIRM_DEADLINE_MS + 10_000)
    expect(onOutcome).toHaveBeenCalledTimes(1) // nici paznicul nu-l mai cheamă
    expect(fetchStatus).toHaveBeenCalledTimes(1)
  })
})

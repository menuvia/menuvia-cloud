// `fetchTablePaymentStatus` (lotul E, mig 312): forma `{status, kind}` și
// plafonul de timp per cerere.
//
//   S1  răspunsul serverului se citește exact (`status` + `kind`); o formă
//       necunoscută / `kind` lipsă / eroare PostgREST → `unknown` pe câmpul
//       respectiv (felul lipsă NU devine `table` — masa n-ar trebui marcată)
//       Mutația care pică: `kind` implicit `table`; `kind` necitit.
//   S2  o cerere care nu se întoarce NICIODATĂ dă `unknown` după
//       `TABLE_PAYMENT_STATUS_TIMEOUT_MS` și abandonează cererea (abort)
//       Mutația care pică: `Promise.race` cu timeout-ul scos.
//   S3  o excepție (rețea) → `unknown`, fără să arunce
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import {
  fetchTablePaymentStatus,
  parseTablePaymentPublicResult,
  TABLE_PAYMENT_STATUS_TIMEOUT_MS,
} from '../payments'

/** Builder-ul supabase-js: thenable + `abortSignal`. */
function builder(result: Promise<unknown>) {
  const signals: AbortSignal[] = []
  const b = {
    signals,
    abortSignal(s: AbortSignal) {
      signals.push(s)
      return b
    },
    then<T>(onOk: (v: unknown) => T, onErr?: (e: unknown) => T) {
      return result.then(onOk, onErr)
    },
  }
  return b
}

beforeEach(() => rpcMock.mockReset())
afterEach(() => vi.useRealTimers())

describe('fetchTablePaymentStatus', () => {
  it('S1 forma {status, kind}; formă necunoscută → unknown pe câmp', async () => {
    rpcMock.mockReturnValue(builder(Promise.resolve({ data: { status: 'succeeded', kind: 'split' }, error: null })))
    await expect(fetchTablePaymentStatus('tok', 'sess', 'ref')).resolves.toEqual({
      status: 'succeeded',
      kind: 'split',
    })
    expect(rpcMock).toHaveBeenCalledWith('get_table_payment_public_status', {
      p_token: 'tok',
      p_session_id: 'sess',
      p_payment_ref: 'ref',
    })

    rpcMock.mockReturnValue(builder(Promise.resolve({ data: { status: 'succeeded' }, error: null })))
    await expect(fetchTablePaymentStatus('tok', 'sess', 'ref')).resolves.toEqual({
      status: 'succeeded',
      kind: 'unknown',
    })

    rpcMock.mockReturnValue(builder(Promise.resolve({ data: null, error: { message: 'x' } })))
    await expect(fetchTablePaymentStatus('tok', 'sess', 'ref')).resolves.toEqual({
      status: 'unknown',
      kind: 'unknown',
    })

    expect(parseTablePaymentPublicResult({ status: 'paid', kind: 'all' })).toEqual({
      status: 'unknown',
      kind: 'unknown',
    })
    expect(parseTablePaymentPublicResult({ status: 'pending', kind: 'table' })).toEqual({
      status: 'pending',
      kind: 'table',
    })
    expect(parseTablePaymentPublicResult(null)).toEqual({ status: 'unknown', kind: 'unknown' })
  })

  it('S2 o cerere agățată → unknown după timeout, cu abort', async () => {
    vi.useFakeTimers()
    const b = builder(new Promise(() => {}))
    rpcMock.mockReturnValue(b)
    let settled: unknown = 'pending'
    void fetchTablePaymentStatus('tok', 'sess', 'ref').then((v) => {
      settled = v
    })
    await vi.advanceTimersByTimeAsync(TABLE_PAYMENT_STATUS_TIMEOUT_MS - 1)
    expect(settled).toBe('pending')
    await vi.advanceTimersByTimeAsync(2)
    expect(settled).toEqual({ status: 'unknown', kind: 'unknown' })
    expect(b.signals).toHaveLength(1)
    expect(b.signals[0].aborted).toBe(true)
  })

  it('S3 excepție de rețea → unknown, fără throw', async () => {
    rpcMock.mockReturnValue(builder(Promise.reject(new Error('Failed to fetch'))))
    await expect(fetchTablePaymentStatus('tok', 'sess', 'ref')).resolves.toEqual({
      status: 'unknown',
      kind: 'unknown',
    })
  })
})

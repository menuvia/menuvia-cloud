// Teste pe jumătatea de CLIENT a mig 273 (audit v3 RES-29): cheia de
// idempotență a rezervării publice și apelul RPC care o poartă.
//
// Ce păzesc, în ordinea în care contează:
//   R1–R3  contractul de storage (persistă, se reia identic, rotația scrie
//          IMEDIAT) — fără el, o retrimitere după refresh ar purta o cheie NOUĂ
//          și serverul ar crea a doua rezervare;
//   R4     scope pe slug: două restaurante nu împart cheia;
//   R5–R6  fallback-ul când sessionStorage aruncă (private mode, cotă): cheia
//          rămâne STABILĂ în memorie, altfel protecția dispare exact în
//          browserul unde e cel mai probabil să pierzi răspunsul;
//   R7     cheia ajunge REALMENTE în argumentele RPC (clichet: un call-site
//          care o uită ar trece toate testele de mai sus);
//   R8     fallback-ul PGRST202 (client deployat înaintea migrației) reîncearcă
//          O SINGURĂ dată, fără cheie, cu contractul vechi;
//   R9     eroarea aruncată e un `Error` REAL cu `hint`/`code` păstrate —
//          ReservationSheet mapează pe ele mesajele prietenoase.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import {
  getReservationIdempotencyKey,
  rotateReservationIdempotencyKey,
  createReservationPublic,
  TERMINAL_RESERVATION_STATUSES,
  isTerminalReservation,
} from '../reservations'

const SLUG = 'bistro-test'
const STORAGE_KEY = 'menuvia_idem_resv:' + SLUG

const ARGS = {
  p_slug: SLUG,
  p_customer_name: 'Ana',
  p_customer_phone: '0722000001',
  p_party_size: 2,
  p_starts_at: '2027-06-01T09:00:00.000Z',
  p_customer_email: null,
  p_special_requests: null,
  p_duration_minutes: null,
  p_zone: null,
  p_table_id: null,
}

const ROW = {
  reservation_id: 'r-1',
  confirmation_code: 'ABCD1234',
  status: 'confirmed',
  table_name: 'M1',
  starts_at: ARGS.p_starts_at,
  ends_at: '2027-06-01T11:00:00.000Z',
  requested_zone: null,
  party_size: 2,
}

describe('cheia de idempotență a rezervării', () => {
  beforeEach(() => {
    sessionStorage.clear()
    rpcMock.mockReset()
  })

  it('R1: prima citire generează o cheie și o PERSISTĂ', () => {
    const key = getReservationIdempotencyKey(SLUG)
    expect(key).toBeTruthy()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(key)
  })

  it('R2: citirile repetate întorc ACEEAȘI cheie (retrimiterea = același dedup)', () => {
    const first = getReservationIdempotencyKey(SLUG)
    expect(getReservationIdempotencyKey(SLUG)).toBe(first)
    expect(getReservationIdempotencyKey(SLUG)).toBe(first)
  })

  it('R3: rotația scrie IMEDIAT cheia nouă (un refresh după succes nu reia cheia veche)', () => {
    const old = getReservationIdempotencyKey(SLUG)
    const rotated = rotateReservationIdempotencyKey(SLUG)
    expect(rotated).not.toBe(old)
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(rotated)
    expect(getReservationIdempotencyKey(SLUG)).toBe(rotated)
  })

  it('R4: cheia e scopată pe slug (două restaurante nu o împart)', () => {
    const a = getReservationIdempotencyKey(SLUG)
    const b = getReservationIdempotencyKey('alt-local')
    expect(a).not.toBe(b)
    expect(sessionStorage.getItem('menuvia_idem_resv:alt-local')).toBe(b)
  })

  it('R5: sessionStorage indisponibil → cheia rămâne STABILĂ în memorie', () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError')
      })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    try {
      const first = getReservationIdempotencyKey('privat')
      expect(first).toBeTruthy()
      // O cheie nouă la fiecare apel ar anula exact protecția.
      expect(getReservationIdempotencyKey('privat')).toBe(first)
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('R6: rotația fără storage schimbă cheia și NU lasă cheia veche în storage', () => {
    const before = getReservationIdempotencyKey(SLUG)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    try {
      const rotated = rotateReservationIdempotencyKey(SLUG)
      expect(rotated).not.toBe(before)
      // Dacă scrierea eșuează, cheia veche TREBUIE ștearsă — altfel un remount
      // ar reciti cheia rezervării deja trimise și serverul ar întoarce-o pe aceea.
      expect(removeItem).toHaveBeenCalledWith(STORAGE_KEY)
      // Și, mai important decât apelul în sine: CITIREA URMĂTOARE trebuie să dea
      // cheia NOUĂ. Fără asta, testul verifica doar că s-a chemat `removeItem`,
      // nu și proprietatea pentru care există — exact ce trebuie să prindă.
      expect(getReservationIdempotencyKey(SLUG)).toBe(rotated)
      expect(getReservationIdempotencyKey(SLUG)).not.toBe(before)
    } finally {
      setItem.mockRestore()
      removeItem.mockRestore()
    }
  })
})

describe('createReservationPublic', () => {
  beforeEach(() => {
    sessionStorage.clear()
    rpcMock.mockReset()
  })

  it('R7 (clichet): cheia ajunge în argumentele RPC', async () => {
    rpcMock.mockResolvedValue({ data: [ROW], error: null })
    await createReservationPublic(ARGS, 'cheie-123')
    expect(rpcMock).toHaveBeenCalledTimes(1)
    const [fn, payload] = rpcMock.mock.calls[0]
    expect(fn).toBe('create_reservation_public')
    expect(payload).toMatchObject({ ...ARGS, p_idempotency_key: 'cheie-123' })
  })

  it('R7b: fără cheie, payload-ul NU conține parametrul (contractul vechi)', async () => {
    rpcMock.mockResolvedValue({ data: [ROW], error: null })
    await createReservationPublic(ARGS, null)
    const [, payload] = rpcMock.mock.calls[0]
    expect(payload).not.toHaveProperty('p_idempotency_key')
  })

  it('R8: PGRST202 (migrația neaplicată) → o SINGURĂ reîncercare, fără cheie', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
      .mockResolvedValueOnce({ data: [ROW], error: null })
    const row = await createReservationPublic(ARGS, 'cheie-123')
    expect(row.confirmation_code).toBe('ABCD1234')
    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect(rpcMock.mock.calls[1][1]).not.toHaveProperty('p_idempotency_key')
  })

  it('R8b: o altă eroare NU declanșează reîncercarea', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Prea multe rezervări', hint: 'reservation_rate_limit' },
    })
    await expect(createReservationPublic(ARGS, 'cheie-123')).rejects.toThrow(/prea multe/i)
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('R9: aruncă un Error REAL, cu hint și code păstrate', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'Masa aleasă nu mai este disponibilă', hint: 'table_unavailable' },
    })
    const err = await createReservationPublic(ARGS, null).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error & { hint?: string }).hint).toBe('table_unavailable')
    expect((err as Error & { code?: string }).code).toBe('23514')
  })

  it('R9b: răspuns fără rând → eroare explicită, nu undefined mai departe', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    await expect(createReservationPublic(ARGS, null)).rejects.toThrow(/nu a putut fi confirmată/i)
  })

  it('R11: calea de compatibilitate (7 coloane, fără party_size) cade pe numărul CERUT', async () => {
    // Pe o bază fără mig 273 proiecția n-are party_size, iar ecranul îl afișează
    // din rândul serverului → ar randa un număr GOL. Acolo rândul e mereu cel
    // tocmai creat, deci numărul cerut e corect.
    const legacyRow = { ...ROW }
    delete (legacyRow as { party_size?: number }).party_size
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
      .mockResolvedValueOnce({ data: [legacyRow], error: null })
    const row = await createReservationPublic({ ...ARGS, p_party_size: 7 }, 'cheie-123')
    expect(row.party_size).toBe(7)
  })

  it('R12: decizia „rând mort" acoperă terminalele și NU stările vii', () => {
    // Testăm funcția de DECIZIE, nu doar existența unei constante: un test care
    // verifică doar că array-ul conține două șiruri ar trece și dacă ramura din
    // ReservationSheet ar fi ștearsă. Reziduu consemnat: cablajul din componentă
    // (setError + return) nu are test de randare — call-site-ul e unul singur.
    expect(isTerminalReservation('cancelled')).toBe(true)
    expect(isTerminalReservation('no_show')).toBe(true)
    for (const alive of ['pending', 'confirmed', 'seated', 'completed']) {
      expect(isTerminalReservation(alive)).toBe(false)
    }
    expect(TERMINAL_RESERVATION_STATUSES).toContain('cancelled')
  })

  it('R10: rândul întors poartă party_size (ecranul de confirmare îl ia de la server)', async () => {
    // Cu idempotență, rândul întors poate fi o rezervare făcută MAI DEVREME, cu
    // alt interval și alt număr de persoane decât ce e acum în formular. Ecranul
    // afișează rândul serverului, deci proiecția trebuie să-l poarte.
    rpcMock.mockResolvedValue({ data: [{ ...ROW, party_size: 5, starts_at: '2027-06-01T15:00:00.000Z' }], error: null })
    const row = await createReservationPublic(ARGS, 'cheie-123')
    expect(row.party_size).toBe(5)
    expect(row.starts_at).toBe('2027-06-01T15:00:00.000Z')
  })
})

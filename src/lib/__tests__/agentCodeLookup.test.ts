// Rezolvarea codului de agent la server (mig 301, client): `lookupAgentCode`.
//
//   AL1  cod/vanity cunoscut → codul CANONIC; RPC-ul primește exact `p_code`
//   AL2  serverul răspunde clar „nu există" → unknown (singurul caz care oprește
//        formularul)
//   AL3  plafonul global (`rate_limited`) NU e „nu există" → error
//   AL4  eroare RPC (DB fără mig 295, rețea) → error
//   AL5  RPC care ARUNCĂ → error (nu propagă)
//   AL6  formă neașteptată (null / non-obiect / cod gol) → error / unknown, nu valid
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import { lookupAgentCode } from '../agentCode'

beforeEach(() => {
  rpcMock.mockReset()
})

describe('lookupAgentCode', () => {
  it('AL1 cod cunoscut → canonic', async () => {
    rpcMock.mockResolvedValue({ data: { referral_code: 'k7m2xq9' }, error: null })
    expect(await lookupAgentCode('ion-pop')).toEqual({ state: 'valid', code: 'k7m2xq9' })
    expect(rpcMock).toHaveBeenCalledWith('resolve_referral_code', { p_code: 'ion-pop' })
  })

  it('AL2 „nu există" → unknown', async () => {
    rpcMock.mockResolvedValue({ data: { referral_code: null }, error: null })
    expect(await lookupAgentCode('nuexista')).toEqual({ state: 'unknown' })
  })

  it('AL3 plafon global → error, nu unknown', async () => {
    rpcMock.mockResolvedValue({ data: { referral_code: null, rate_limited: true }, error: null })
    expect(await lookupAgentCode('k7m2xq9')).toEqual({ state: 'error' })
  })

  it('AL4 eroare RPC → error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'PGRST202' } })
    expect(await lookupAgentCode('k7m2xq9')).toEqual({ state: 'error' })
  })

  it('AL5 RPC care aruncă → error', async () => {
    rpcMock.mockRejectedValue(new Error('network'))
    expect(await lookupAgentCode('k7m2xq9')).toEqual({ state: 'error' })
  })

  it('AL6 forme neașteptate nu devin „valid"', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })
    expect(await lookupAgentCode('k7m2xq9')).toEqual({ state: 'error' })
    rpcMock.mockResolvedValue({ data: 'k7m2xq9', error: null })
    expect(await lookupAgentCode('k7m2xq9')).toEqual({ state: 'error' })
    rpcMock.mockResolvedValue({ data: { referral_code: '' }, error: null })
    expect(await lookupAgentCode('k7m2xq9')).toEqual({ state: 'unknown' })
    rpcMock.mockResolvedValue({ data: { referral_code: 42 }, error: null })
    expect(await lookupAgentCode('k7m2xq9')).toEqual({ state: 'unknown' })
  })
})

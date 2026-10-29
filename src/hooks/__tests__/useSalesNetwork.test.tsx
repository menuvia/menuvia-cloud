// Hook-ul „Echipa mea" (mig 304): starea e TRISTATE, iar un răspuns întârziat nu
// scrie peste unul mai nou.
//
//   HS1  încărcare la montare: network + loading=false, fără eroare
//   HS2  enabled=false → niciun apel, nimic de încărcat
//   HS3  RPC nedeployat (PGRST202) → network rămâne null (NECUNOSCUT), unavailable
//   HS4  o eroare după o citire reușită NU golește ecranul (ultima stare rămâne)
//   HS5  răspuns întârziat al unei cereri vechi e ignorat
//   HS6  setContactSharing: apelează RPC-ul, reîncarcă, întoarce null
//   HS7  setContactSharing eșuat întoarce eroarea (nu aruncă) și NU reîncarcă
//   HS8  enabled true→false: starea se curăță, iar un răspuns în zbor e ignorat
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: rpcMock } }))

import { useSalesNetwork } from '../useSalesNetwork'

function networkPayload(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    role: 'head',
    status: 'active',
    affiliate_id: 'aff-1',
    contact_sharing: false,
    contract: {
      current_version: '1.0',
      accepted_version: '1.0',
      accepted_at: '2026-10-28T10:00:00Z',
      needs_acceptance: false,
    },
    head: null,
    team: [],
    open_invites: [],
    limits: { open_invites_max: 20, invite_ttl_days: 14 },
    ...over,
  }
}

function ok(data: unknown) {
  return Promise.resolve({ data, error: null })
}
function fail(code: string) {
  return Promise.resolve({ data: null, error: { code, message: 'x' } })
}
function callsOf(fn: string): number {
  return rpcMock.mock.calls.filter((c: unknown[]) => c[0] === fn).length
}

beforeEach(() => {
  rpcMock.mockReset()
})

describe('useSalesNetwork', () => {
  it('HS1: încarcă la montare', async () => {
    rpcMock.mockImplementation(() => ok(networkPayload()))
    const { result } = renderHook(() => useSalesNetwork(true))
    expect(result.current.loading).toBe(true)
    expect(result.current.network).toBeNull()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.network?.role).toBe('head')
    expect(result.current.error).toBeNull()
    expect(result.current.unavailable).toBe(false)
    expect(callsOf('get_sales_network')).toBe(1)
  })

  it('HS2: enabled=false nu cheamă serverul', async () => {
    rpcMock.mockImplementation(() => ok(networkPayload()))
    const { result } = renderHook(() => useSalesNetwork(false))
    expect(result.current.loading).toBe(false)
    await act(async () => {
      await result.current.reload()
    })
    expect(rpcMock).not.toHaveBeenCalled()
    expect(result.current.network).toBeNull()
  })

  it('HS3: PGRST202 → necunoscut + unavailable', async () => {
    rpcMock.mockImplementation(() => fail('PGRST202'))
    const { result } = renderHook(() => useSalesNetwork(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.network).toBeNull()
    expect(result.current.unavailable).toBe(true)
    expect(result.current.error?.reason).toBe('unavailable')
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('HS4: eroarea după o citire reușită păstrează ultima stare', async () => {
    rpcMock.mockImplementationOnce(() => ok(networkPayload({ role: 'agent' })))
    const { result } = renderHook(() => useSalesNetwork(true))
    await waitFor(() => expect(result.current.network?.role).toBe('agent'))
    rpcMock.mockImplementationOnce(() => fail(''))
    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.network?.role).toBe('agent')
    expect(result.current.error?.reason).toBe('network')
    // reîncărcarea reușită șterge eroarea
    rpcMock.mockImplementationOnce(() => ok(networkPayload({ role: 'agent' })))
    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.error).toBeNull()
  })

  it('HS5: răspunsul întârziat al unei cereri vechi e ignorat', async () => {
    let releaseFirst: (v: unknown) => void = () => undefined
    const first = new Promise((resolve) => {
      releaseFirst = resolve
    })
    rpcMock.mockImplementationOnce(() => first)
    rpcMock.mockImplementationOnce(() => ok(networkPayload({ role: 'agent' })))
    const { result } = renderHook(() => useSalesNetwork(true))
    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.network?.role).toBe('agent')
    await act(async () => {
      releaseFirst({ data: networkPayload({ role: 'head' }), error: null })
      await first
    })
    expect(result.current.network?.role).toBe('agent')
    expect(result.current.loading).toBe(false)
  })

  it('HS6: setContactSharing apelează RPC-ul și reîncarcă', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'set_my_contact_sharing') return ok({ ok: true, contact_sharing: true })
      return ok(networkPayload({ contact_sharing: callsOf('set_my_contact_sharing') > 0 }))
    })
    const { result } = renderHook(() => useSalesNetwork(true))
    await waitFor(() => expect(result.current.network).not.toBeNull())
    expect(result.current.network?.contactSharing).toBe(false)
    let outcome: unknown = 'neapelat'
    await act(async () => {
      outcome = await result.current.setContactSharing(true)
    })
    expect(outcome).toBeNull()
    expect(rpcMock).toHaveBeenCalledWith('set_my_contact_sharing', { p_share: true })
    expect(callsOf('get_sales_network')).toBe(2)
    expect(result.current.network?.contactSharing).toBe(true)
  })

  it('HS7: setContactSharing eșuat întoarce eroarea și nu reîncarcă', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'set_my_contact_sharing') return ok({ ok: false, reason: 'not_an_affiliate' })
      return ok(networkPayload())
    })
    const { result } = renderHook(() => useSalesNetwork(true))
    await waitFor(() => expect(result.current.network).not.toBeNull())
    // `as`: fără cast TS îngustează `outcome` la `null` (atribuirea e în callback).
    let outcome = null as { reason: string; message: string } | null
    await act(async () => {
      outcome = await result.current.setContactSharing(true)
    })
    expect(outcome).not.toBeNull()
    expect(outcome?.reason).toBe('not_an_affiliate')
    expect(callsOf('get_sales_network')).toBe(1)
  })

  it('HS8: enabled true→false curăță starea și ignoră răspunsul în zbor', async () => {
    let releaseFirst: (v: unknown) => void = () => undefined
    const first = new Promise((resolve) => {
      releaseFirst = resolve
    })
    rpcMock.mockImplementationOnce(() => first)
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useSalesNetwork(enabled),
      {
        initialProps: { enabled: true },
      },
    )
    rerender({ enabled: false })
    await act(async () => {
      releaseFirst({ data: networkPayload(), error: null })
      await first
    })
    expect(result.current.network).toBeNull()
    expect(result.current.loading).toBe(false)
  })
})

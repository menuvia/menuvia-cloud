// Teste pe rezolvarea publică a QR-ului și a slug-ului (ux-guest-1, audit oct 2026).
//
// De ce există: supabase-js NU aruncă — o cădere de rețea / timeout / 5xx vine
// în `{error}`. `resolveQrToken` și `fetchRestaurantBySlug` întorceau `null` și
// pe eroare, iar `null` înseamnă „nu există": oaspetele cu semnal slab vedea
// „Acest QR nu mai este activ, cere un QR nou" (pe /q) sau „Restaurant negăsit"
// (pe /m și /rezervare), fără „Reîncearcă". Acum transportul ARUNCĂ, iar `null`
// rămâne strict pentru „nu există".
//
//   QZ1  resolveQrToken: eroare → aruncă (cu `code` păstrat); null → null.
//   QZ2  resolveQrMenu: RPC-ul compus și fallback-ul pică → aruncă, nu null.
//   QZ3  resolveQrMenu: `resolved: null` explicit → null FĂRĂ al doilea RTT.
//   QZ3b control: RPC compus lipsă (PGRST202) → fallback-ul în doi pași rămâne.
//   QZ4  fetchRestaurantBySlug / fetchMenuBySlug: eroare → aruncă; [] / null → null.
//
// Mutații care pică: `if (error || data == null) return null` înapoi în
// resolveQrToken → QZ1 + QZ2; `return null` pe eroare în fetchRestaurantBySlug
// → QZ4; scoaterea scurtăturii `payload.resolved === null` → QZ3 (rpc chemat de 2 ori).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import { resolveQrToken, resolveQrMenu, fetchRestaurantBySlug, fetchMenuBySlug } from '../qr'

type RpcResult = { data: unknown; error: { message: string; code?: string } | null }

// Răspunsuri per nume de RPC — fiecare test își declară lumea.
function rpcWorld(table: Record<string, RpcResult>): void {
  rpcMock.mockImplementation((fn: string) => {
    const r = table[fn]
    if (!r) throw new Error(`RPC neașteptat în test: ${fn}`)
    return Promise.resolve(r)
  })
}

const NET_DOWN = { data: null, error: { message: 'TypeError: Load failed', code: '' } }

const RESOLVED_PAYLOAD = {
  token: { id: 'tok-1', restaurant_id: 'r1', table_id: 't1', token: 'abc', is_active: true },
  table: { id: 't1', restaurant_id: 'r1', name: 'Masa 1' },
  restaurant: { id: 'r1', name: 'Bistro', primary_color: '#C8963C', menu_languages: ['en'] },
  orderingAllowed: true,
}

beforeEach(() => {
  rpcMock.mockReset()
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('resolveQrToken / resolveQrMenu — rețeaua nu se deghizează în „QR invalid"', () => {
  it('QZ1 resolveQrToken: eroarea RPC aruncă un Error real cu `code`; null rămâne null', async () => {
    rpcWorld({ resolve_qr_token: { data: null, error: { message: 'timeout', code: '57014' } } })
    const err: unknown = await resolveQrToken('abc').then(
      () => null,
      (e: unknown) => e,
    )
    // Error real (callerii testează `instanceof Error`), cu codul Postgres păstrat.
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('timeout')
    expect((err as { code?: string }).code).toBe('57014')

    rpcWorld({ resolve_qr_token: { data: null, error: null } })
    await expect(resolveQrToken('abc')).resolves.toBeNull()
  })

  it('QZ2 resolveQrMenu: RPC-ul compus și fallback-ul pică pe rețea → aruncă, NU null', async () => {
    rpcWorld({ resolve_qr_menu: NET_DOWN, resolve_qr_token: NET_DOWN })
    await expect(resolveQrMenu('abc')).rejects.toThrow(/load failed/i)
  })

  it('QZ3 resolveQrMenu: `resolved: null` explicit (token invalid) → null, fără al doilea RTT', async () => {
    rpcWorld({ resolve_qr_menu: { data: { resolved: null, menu: null }, error: null } })
    await expect(resolveQrMenu('abc')).resolves.toBeNull()
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('resolve_qr_menu', { p_token: 'abc' })
  })

  it('QZ3b control: RPC compus lipsă (PGRST202) → fallback-ul în doi pași aduce meniul', async () => {
    rpcWorld({
      resolve_qr_menu: { data: null, error: { message: 'function not found', code: 'PGRST202' } },
      resolve_qr_token: { data: RESOLVED_PAYLOAD, error: null },
      get_menu_for_restaurant: { data: [], error: null },
    })
    const out = await resolveQrMenu('abc')
    expect(out?.resolved.restaurant.id).toBe('r1')
    expect(out?.resolved.restaurant.menu_languages).toEqual(['en'])
    expect(out?.menu).toEqual([])
  })
})

describe('fetchRestaurantBySlug / fetchMenuBySlug — „Restaurant negăsit" doar când chiar nu există', () => {
  it('QZ4 eroarea aruncă; rândul lipsă întoarce null', async () => {
    rpcWorld({ get_restaurant_by_slug: NET_DOWN })
    await expect(fetchRestaurantBySlug('bistro')).rejects.toThrow(/load failed/i)

    rpcWorld({ get_restaurant_by_slug: { data: [], error: null } })
    await expect(fetchRestaurantBySlug('bistro')).resolves.toBeNull()

    // RPC compus pe eroare + fallback pe eroare → eroarea ajunge la pagină.
    rpcWorld({ get_menu_by_slug: NET_DOWN, get_restaurant_by_slug: NET_DOWN })
    await expect(fetchMenuBySlug('bistro')).rejects.toThrow(/load failed/i)

    // Slug inexistent: contractul RPC-ului compus e `null` fără eroare.
    rpcWorld({ get_menu_by_slug: { data: null, error: null } })
    await expect(fetchMenuBySlug('bistro')).resolves.toBeNull()
  })
})

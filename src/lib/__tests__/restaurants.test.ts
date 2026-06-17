// Unit tests pentru adapter-ul src/lib/restaurants.ts.
// Mocăm supabase.rpc; nu lovim DB real / PostgREST.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockRpc = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => mockRpc(name, args),
  },
}))

import {
  createRestaurant,
  changeMemberRole,
  removeMember,
  revokeInvite,
  changeRestaurantSlug,
} from '../restaurants'

beforeEach(() => {
  mockRpc.mockReset()
})

describe('createRestaurant', () => {
  it('returns the parsed restaurant on ok=true response', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: true, restaurant_id: 'r-1', restaurant_slug: 'rsl' },
      error: null,
    })
    const r = await createRestaurant({ name: 'X' })
    expect(r).toEqual({ restaurant_id: 'r-1', restaurant_slug: 'rsl' })
    expect(mockRpc).toHaveBeenCalledWith('create_restaurant', {
      p_name: 'X',
      p_city: null,
      p_slug: null,
      p_primary_color: '#C8963C',
    })
  })

  it('throws on rpc error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('rpc failed') })
    await expect(createRestaurant({ name: 'X' })).rejects.toThrow('rpc failed')
  })

  it('throws when ok !== true', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: false, restaurant_id: 'r-1', restaurant_slug: 'rsl' },
      error: null,
    })
    await expect(createRestaurant({ name: 'X' })).rejects.toThrow(/ok !== true/)
  })

  it('throws when response is not an object', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'wrong', error: null })
    await expect(createRestaurant({ name: 'X' })).rejects.toThrow(/not an object/)
  })

  it('throws when restaurant_slug is empty', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: true, restaurant_id: 'r-1', restaurant_slug: '   ' },
      error: null,
    })
    await expect(createRestaurant({ name: 'X' })).rejects.toThrow(
      /restaurant_id \/ restaurant_slug invalid/,
    )
  })
})

describe('changeMemberRole', () => {
  it('returns parsed result on success', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: true, membership_id: 'm-1', role: 'manager' },
      error: null,
    })
    const r = await changeMemberRole({ membershipId: 'm-1', newRole: 'manager' })
    expect(r).toEqual({ membership_id: 'm-1', role: 'manager' })
    expect(mockRpc).toHaveBeenCalledWith('change_member_role', {
      p_membership_id: 'm-1',
      p_new_role: 'manager',
    })
  })

  it('throws when ok!=true', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: false }, error: null })
    await expect(
      changeMemberRole({ membershipId: 'm-1', newRole: 'manager' }),
    ).rejects.toThrow(/ok !== true/)
  })

  it('throws on rpc error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('boom') })
    await expect(
      changeMemberRole({ membershipId: 'm-1', newRole: 'manager' }),
    ).rejects.toThrow('boom')
  })
})

describe('removeMember', () => {
  it('returns parsed result on success', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: true, membership_id: 'm-1' },
      error: null,
    })
    const r = await removeMember({ membershipId: 'm-1' })
    expect(r).toEqual({ membership_id: 'm-1' })
  })

  it('throws when missing membership_id', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null })
    await expect(removeMember({ membershipId: 'm-1' })).rejects.toThrow(
      /Invalid remove_member response/,
    )
  })
})

describe('revokeInvite', () => {
  it('returns parsed result on success', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: true, invite_id: 'i-1' },
      error: null,
    })
    const r = await revokeInvite({ inviteId: 'i-1' })
    expect(r).toEqual({ invite_id: 'i-1' })
  })

  it('throws when ok=false', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: false, invite_id: 'i-1' },
      error: null,
    })
    await expect(revokeInvite({ inviteId: 'i-1' })).rejects.toThrow(/ok !== true/)
  })
})

describe('changeRestaurantSlug', () => {
  it('returns the parsed new slug on success', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: true, restaurant_id: 'r-1', slug: 'noul-slug' },
      error: null,
    })
    const r = await changeRestaurantSlug({ restaurantId: 'r-1', newSlug: 'Noul Slug' })
    expect(r).toEqual({ ok: true, restaurant_id: 'r-1', slug: 'noul-slug' })
    expect(mockRpc).toHaveBeenCalledWith('change_restaurant_slug', {
      p_restaurant_id: 'r-1',
      p_new_slug: 'Noul Slug',
    })
  })

  it('returns slug_taken conflict without throwing', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: false, reason: 'slug_taken', slug: 'ocupat' },
      error: null,
    })
    const r = await changeRestaurantSlug({ restaurantId: 'r-1', newSlug: 'ocupat' })
    expect(r).toEqual({ ok: false, reason: 'slug_taken', slug: 'ocupat' })
  })

  it('throws on rpc error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('rpc died') })
    await expect(
      changeRestaurantSlug({ restaurantId: 'r-1', newSlug: 'x' }),
    ).rejects.toThrow('rpc died')
  })

  it('throws on missing fields in success response', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, restaurant_id: 'r-1' }, error: null })
    await expect(
      changeRestaurantSlug({ restaurantId: 'r-1', newSlug: 'x' }),
    ).rejects.toThrow(/Invalid change_restaurant_slug success/)
  })

  it('throws on malformed conflict response', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: false }, error: null })
    await expect(
      changeRestaurantSlug({ restaurantId: 'r-1', newSlug: 'x' }),
    ).rejects.toThrow(/Invalid change_restaurant_slug conflict/)
  })
})

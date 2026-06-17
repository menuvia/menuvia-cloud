// Adapter pentru cele patru RPC-uri SECURITY DEFINER introduse în mig 096A.
// Toate returnează jsonb cu cheia `ok:true` pe succes; orice eroare aruncă.
//
// Folosit din:
//   src/pages/OnboardingPage.tsx — createRestaurant()
//   src/hooks/useData.ts         — createRestaurant() în create()
//   src/components/TeamManager.tsx — changeMemberRole / removeMember / revokeInvite
//
// Tipuri Database (typed createClient<Database>) sunt deferred la PR 1D.
// Validarea runtime din acest fișier este sursa pentru integritatea răspunsului.

import { supabase } from './supabase'
import type { MemberRole } from './constants'

export interface CreatedRestaurant {
  restaurant_id: string
  restaurant_slug: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asOkResponse(data: unknown, label: string): Record<string, unknown> {
  if (!isObject(data)) {
    throw new Error(`Invalid ${label} response: not an object`)
  }
  if (data.ok !== true) {
    throw new Error(`Invalid ${label} response: ok !== true`)
  }
  return data
}

export async function createRestaurant(input: {
  name: string
  city?: string | null
  slug?: string | null
  primaryColor?: string
}): Promise<CreatedRestaurant> {
  const { data, error } = await supabase.rpc('create_restaurant', {
    p_name: input.name,
    p_city: input.city ?? null,
    p_slug: input.slug ?? null,
    p_primary_color: input.primaryColor ?? '#C8963C',
  })
  if (error) throw error
  const ok = asOkResponse(data, 'create_restaurant')
  const restaurantId = ok.restaurant_id
  const restaurantSlug = ok.restaurant_slug
  if (typeof restaurantId !== 'string' || typeof restaurantSlug !== 'string' || !restaurantSlug.trim()) {
    throw new Error('Invalid create_restaurant response: restaurant_id / restaurant_slug invalid')
  }
  return { restaurant_id: restaurantId, restaurant_slug: restaurantSlug }
}

export interface ChangeMemberRoleResult {
  membership_id: string
  role: MemberRole
}

export async function changeMemberRole(input: {
  membershipId: string
  newRole: Exclude<MemberRole, 'owner'>
}): Promise<ChangeMemberRoleResult> {
  const { data, error } = await supabase.rpc('change_member_role', {
    p_membership_id: input.membershipId,
    p_new_role: input.newRole,
  })
  if (error) throw error
  const ok = asOkResponse(data, 'change_member_role')
  const membershipId = ok.membership_id
  const role = ok.role
  if (typeof membershipId !== 'string' || typeof role !== 'string') {
    throw new Error('Invalid change_member_role response')
  }
  return { membership_id: membershipId, role: role as MemberRole }
}

export interface RemoveMemberResult {
  membership_id: string
}

export async function removeMember(input: { membershipId: string }): Promise<RemoveMemberResult> {
  const { data, error } = await supabase.rpc('remove_member', {
    p_membership_id: input.membershipId,
  })
  if (error) throw error
  const ok = asOkResponse(data, 'remove_member')
  const membershipId = ok.membership_id
  if (typeof membershipId !== 'string') {
    throw new Error('Invalid remove_member response')
  }
  return { membership_id: membershipId }
}

export interface RevokeInviteResult {
  invite_id: string
}

export async function revokeInvite(input: { inviteId: string }): Promise<RevokeInviteResult> {
  const { data, error } = await supabase.rpc('revoke_invite', {
    p_invite_id: input.inviteId,
  })
  if (error) throw error
  const ok = asOkResponse(data, 'revoke_invite')
  const inviteId = ok.invite_id
  if (typeof inviteId !== 'string') {
    throw new Error('Invalid revoke_invite response')
  }
  return { invite_id: inviteId }
}

// ── change_restaurant_slug — introdus în mig 096B (PR 1B).
//    Înlocuiește UPDATE direct pe `restaurants.slug` (privilegiul column-level
//    a fost revocat). Admin-only server-side; validează unicitate.
export interface ChangeRestaurantSlugSuccess {
  ok: true
  restaurant_id: string
  slug: string
}
export interface ChangeRestaurantSlugConflict {
  ok: false
  reason: 'slug_taken'
  slug: string
}
export type ChangeRestaurantSlugResult =
  | ChangeRestaurantSlugSuccess
  | ChangeRestaurantSlugConflict

export async function changeRestaurantSlug(input: {
  restaurantId: string
  newSlug: string
}): Promise<ChangeRestaurantSlugResult> {
  const { data, error } = await supabase.rpc('change_restaurant_slug', {
    p_restaurant_id: input.restaurantId,
    p_new_slug: input.newSlug,
  })
  if (error) throw error
  if (!isObject(data) || (data.ok !== true && data.ok !== false)) {
    throw new Error('Invalid change_restaurant_slug response')
  }
  if (data.ok === false) {
    if (data.reason !== 'slug_taken' || typeof data.slug !== 'string') {
      throw new Error('Invalid change_restaurant_slug conflict response')
    }
    return { ok: false, reason: 'slug_taken', slug: data.slug }
  }
  // data.ok === true
  if (typeof data.restaurant_id !== 'string' || typeof data.slug !== 'string') {
    throw new Error('Invalid change_restaurant_slug success response')
  }
  return { ok: true, restaurant_id: data.restaurant_id, slug: data.slug }
}

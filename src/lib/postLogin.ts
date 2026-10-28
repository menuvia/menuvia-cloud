// src/lib/postLogin.ts
// Unde ajunge fiecare după login (S1): fiecare rol pe ecranul lui.
//
//   personal doar bucătărie → /kitchen        personal doar ospătar → /waiter
//   fără restaurant + afiliat (activ/în aprobare) → /afiliat (panoul agentului)
//   orice altceva → /dashboard (un patron fără restaurant ajunge acolo pe
//   onboarding: AppRouter randează OnboardingPage când `restaurants` e gol)
//
// Până acum logica stătea doar în efectul de auto-redirect din App.tsx și nu
// cunoștea agentul: un agent fără restaurant ateriza pe „Creează-ți restaurantul".
// Același calcul îl folosește acum și `onSuccess` din AuthPage (înainte ducea
// mereu la /dashboard, în cursă cu efectul). Funcția de decizie e pură.

import { supabase } from './supabase'

export type AffiliateAccess = 'active' | 'pending' | 'other' | 'none'
export type PostLoginPath = '/kitchen' | '/waiter' | '/afiliat' | '/dashboard'

export function pickPostLoginDestination(input: {
  roles: readonly string[]
  affiliate: AffiliateAccess
}): PostLoginPath {
  const { roles, affiliate } = input
  if (roles.length === 0) {
    // Fără restaurant: agentul (sau solicitantul în așteptare) are panoul lui.
    // Un afiliat închis/respins/suspendat NU e trimis acolo — își poate crea
    // un restaurant ca orice patron.
    return affiliate === 'active' || affiliate === 'pending' ? '/afiliat' : '/dashboard'
  }
  if (roles.every((r) => r === 'kitchen')) return '/kitchen'
  if (roles.every((r) => r === 'waiter')) return '/waiter'
  return '/dashboard'
}

function toAffiliateAccess(status: unknown): AffiliateAccess {
  if (status === 'active') return 'active'
  if (status === 'pending') return 'pending'
  return typeof status === 'string' ? 'other' : 'none'
}

/**
 * Citește rolurile și rândul de afiliat al utilizatorului (ambele sub RLS, doar
 * rândurile lui) și întoarce destinația. NU aruncă: la orice eroare de citire a
 * rolurilor cade pe /dashboard (comportamentul de dinainte); o eroare pe
 * afiliat înseamnă „nu e afiliat".
 */
export async function loadPostLoginDestination(userId: string): Promise<PostLoginPath> {
  try {
    const [membershipsRes, affiliateRes] = await Promise.all([
      supabase.from('restaurant_memberships').select('role').eq('user_id', userId),
      supabase.from('affiliates').select('status').eq('profile_id', userId).maybeSingle(),
    ])
    if (membershipsRes.error) return '/dashboard'
    const roles = ((membershipsRes.data ?? []) as Array<{ role: string }>).map((r) => r.role)
    const affiliate = affiliateRes.error
      ? 'none'
      : toAffiliateAccess((affiliateRes.data as { status?: unknown } | null)?.status)
    return pickPostLoginDestination({ roles, affiliate })
  } catch {
    return '/dashboard'
  }
}

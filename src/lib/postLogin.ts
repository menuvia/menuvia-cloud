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
//
// Cu o INTENȚIE DE PLAN (aleasă pe landing/pricing înainte de cont) decide
// `pickPlanIntentDestination`: întâi restaurantul, apoi planul. „Începe gratuit”
// ducea un patron fără niciun restaurant direct în Stripe (cardul cerut înainte
// să fi văzut măcar produsul); acum patronul nou trece întâi prin onboarding,
// iar intenția rămâne păstrată și e onorată la finalul lui (App.tsx).

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

/** Destinația unei sesiuni noi care are o intenție de plan validă. */
export type PlanIntentPath = '/pricing' | PostLoginPath

/**
 * Cu intenție de plan: checkout-ul (/pricing, unde `usePlanIntentAutoCheckout`
 * pornește plata) DOAR pentru cine deține deja un restaurant — planul se aplică
 * restaurantelor pe care le deține. Fără niciun restaurant → /dashboard, adică
 * onboarding-ul; intenția nu se consumă, o onorează finalul onboarding-ului.
 * Agentul fără restaurant care a ales totuși un plan vrea un local, deci tot
 * onboarding. Personalul altui restaurant (fără rol de owner) merge pe ecranul
 * rolului, ca fără intenție.
 */
export function pickPlanIntentDestination(input: {
  roles: readonly string[]
  affiliate: AffiliateAccess
}): PlanIntentPath {
  if (input.roles.includes('owner')) return '/pricing'
  if (input.roles.length === 0) return '/dashboard'
  return pickPostLoginDestination(input)
}

interface PostLoginFacts {
  roles: string[]
  affiliate: AffiliateAccess
}

/**
 * Rolurile și rândul de afiliat ale utilizatorului (ambele sub RLS, doar
 * rândurile lui). `null` = rolurile NU sunt cunoscute (eroare de citire sau
 * excepție); o eroare doar pe afiliat înseamnă „nu e afiliat". Nu aruncă.
 */
async function readPostLoginFacts(userId: string): Promise<PostLoginFacts | null> {
  try {
    const [membershipsRes, affiliateRes] = await Promise.all([
      supabase.from('restaurant_memberships').select('role').eq('user_id', userId),
      supabase.from('affiliates').select('status').eq('profile_id', userId).maybeSingle(),
    ])
    if (membershipsRes.error) return null
    const roles = ((membershipsRes.data ?? []) as Array<{ role: string }>).map((r) => r.role)
    const affiliate = affiliateRes.error
      ? 'none'
      : toAffiliateAccess((affiliateRes.data as { status?: unknown } | null)?.status)
    return { roles, affiliate }
  } catch {
    return null
  }
}

/**
 * Citește rolurile și rândul de afiliat al utilizatorului (ambele sub RLS, doar
 * rândurile lui) și întoarce destinația. NU aruncă: la orice eroare de citire a
 * rolurilor cade pe /dashboard (comportamentul de dinainte); o eroare pe
 * afiliat înseamnă „nu e afiliat".
 */
export async function loadPostLoginDestination(userId: string): Promise<PostLoginPath> {
  const facts = await readPostLoginFacts(userId)
  return facts ? pickPostLoginDestination(facts) : '/dashboard'
}

/**
 * Destinația cu intenție de plan (`pickPlanIntentDestination`). Rolurile
 * NECUNOSCUTE (blip de rețea) duc pe /dashboard, nu în Stripe: acolo AppRouter
 * vede singur dacă există restaurant, iar intenția rămâne păstrată. Nu aruncă.
 */
export async function loadPlanIntentDestination(userId: string): Promise<PlanIntentPath> {
  const facts = await readPostLoginFacts(userId)
  return facts ? pickPlanIntentDestination(facts) : '/dashboard'
}

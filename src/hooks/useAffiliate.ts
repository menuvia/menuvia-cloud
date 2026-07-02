// src/hooks/useAffiliate.ts
// Hook pentru panoul de afiliat. Cheamă RPC-ul get_affiliate_dashboard (un
// singur fetch care întoarce profil + restaurante + sub-afiliați + câștiguri)
// și expune register_affiliate pentru onboarding. Oglindește pattern-ul din
// useData.ts (load/refetch, loading doar pe fetch-ul inițial).

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export interface AffiliateProfile {
  id: string
  referral_code: string
  vanity_slug: string | null
  status: 'active' | 'suspended' | 'closed'
  setup_bps: number
  recurring_bps: number
  cascade_bps: number
  recurring_cap_months: number
  created_at: string
}

export interface AffiliateRestaurant {
  attribution_id: string
  status: string
  captured_at: string
  restaurant_names: string[]
  city: string | null
  commission_cents: number
}

export interface AffiliateSubAffiliate {
  referral_code: string
  status: string
  joined_at: string
  attributions_count: number
}

export interface AffiliateEarnings {
  currency: string
  total_cents: number
  confirmed_cents: number
  pending_cents: number
  paid_cents: number
  clawed_back_cents: number
}

export interface AffiliateDashboard {
  ok: boolean
  is_affiliate: boolean
  affiliate?: AffiliateProfile
  restaurants?: AffiliateRestaurant[]
  sub_affiliates?: AffiliateSubAffiliate[]
  earnings?: AffiliateEarnings
  next_payout_at?: string | null
  // Doar pe ramura ne-afiliat (mig 188): comisioanele implicite ale platformei,
  // ca onboarding-ul să afișeze procentele reale. Opțional — poate lipsi până
  // rulează migrația.
  defaults?: {
    setup_bps: number
    recurring_bps: number
    recurring_cap_months: number
  }
}

export interface RegisterResult {
  ok: boolean
  reason?: string
  affiliate_id?: string
  referral_code?: string
}

export function useAffiliate() {
  const { user } = useAuth()
  const [dashboard, setDashboard] = useState<AffiliateDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const initialFetchDoneRef = useRef(false)

  const load = useCallback(async () => {
    if (!user) {
      setDashboard(null)
      setLoading(false)
      initialFetchDoneRef.current = false
      return
    }
    if (!initialFetchDoneRef.current) setLoading(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('get_affiliate_dashboard')
    if (err) {
      // Logăm explicit (pattern useFeatures.ts): panoul afișează bani, o
      // defecțiune RPC tăcută nu trebuie să dispară doar în starea de UI.
      console.error('[useAffiliate] load error:', err)
      setError(err.message)
      setLoading(false)
      return
    }
    setDashboard(data as AffiliateDashboard)
    setLoading(false)
    initialFetchDoneRef.current = true
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  // Userul devine afiliat. parentCode opțional (sub-afiliere, 1 nivel).
  const register = async (parentCode?: string): Promise<RegisterResult> => {
    const { data, error: err } = await supabase.rpc('register_affiliate', {
      p_parent_referral_code: parentCode ?? null,
    })
    if (err) {
      console.error('[useAffiliate] register error:', err)
      return { ok: false, reason: err.message }
    }
    await load()
    return data as RegisterResult
  }

  return { dashboard, loading, error, refetch: load, register }
}

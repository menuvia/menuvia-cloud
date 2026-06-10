import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface PlanLimits {
  plan: string
  max_products: number
  max_restaurants: number
  max_tables: number
  ai_imports_month: number
  features: string[]
}

// Fallback offline — valori identice cu rândurile din migration 062
// (plan_limits). Folosit când fetch-ul DB eșuează sau înainte de load.
const DEFAULTS: Record<string, PlanLimits> = {
  free: {
    plan: 'free',
    max_products: 15,
    max_restaurants: 1,
    max_tables: 3,
    ai_imports_month: 1,
    features: ['qr_static'],
  },
  starter: {
    plan: 'starter',
    max_products: 50,
    max_restaurants: 1,
    max_tables: 8,
    ai_imports_month: 2,
    features: ['qr_static', 'qr_dynamic'],
  },
  growth: {
    plan: 'growth',
    max_products: 500,
    max_restaurants: 1,
    max_tables: 50,
    ai_imports_month: 20,
    features: ['qr_dynamic', 'ordering', 'analytics', 'team', 'kitchen', 'waiter'],
  },
  pro: {
    plan: 'pro',
    max_products: 2000,
    max_restaurants: 2,
    max_tables: 100,
    ai_imports_month: 50,
    features: [
      'qr_dynamic',
      'ordering',
      'analytics',
      'ai_import',
      'team',
      'kitchen',
      'waiter',
      'floor_plan',
      'split_bill',
    ],
  },
  enterprise: {
    plan: 'enterprise',
    max_products: 1_000_000_000,
    max_restaurants: 1_000_000_000,
    max_tables: 1_000_000_000,
    ai_imports_month: 5000,
    features: [
      'qr_dynamic',
      'ordering',
      'analytics',
      'ai_import',
      'team',
      'kitchen',
      'waiter',
      'floor_plan',
      'split_bill',
      'multi_location',
    ],
  },
}

let _cache: Record<string, PlanLimits> | null = null

export function usePlanLimits(plan: string) {
  const [limits, setLimits] = useState<PlanLimits>(
    () => _cache?.[plan] ?? DEFAULTS[plan] ?? DEFAULTS.free,
  )
  const [loading, setLoading] = useState(!_cache)

  const load = useCallback(async () => {
    if (_cache) {
      setLimits(_cache[plan] ?? DEFAULTS[plan] ?? DEFAULTS.free)
      setLoading(false)
      return
    }
    try {
      const { data, error } = await supabase.from('plan_limits').select('*')
      if (error) throw error
      const map: Record<string, PlanLimits> = {}
      for (const row of data ?? []) {
        const r = row as Record<string, unknown>
        map[r.plan as string] = {
          plan: r.plan as string,
          max_products: r.max_products as number,
          max_restaurants: r.max_restaurants as number,
          max_tables: r.max_tables as number,
          ai_imports_month: r.ai_imports_month as number,
          features: (r.features as string[]) ?? [],
        }
      }
      _cache = map
      setLimits(map[plan] ?? DEFAULTS[plan] ?? DEFAULTS.free)
    } catch {
      setLimits(DEFAULTS[plan] ?? DEFAULTS.free)
    }
    setLoading(false)
  }, [plan])

  useEffect(() => {
    void load()
  }, [load])

  const canAddProduct = (currentCount: number): boolean => currentCount < limits.max_products

  const hasFeature = (feature: string): boolean => limits.features.includes(feature)

  return { limits, loading, canAddProduct, hasFeature }
}

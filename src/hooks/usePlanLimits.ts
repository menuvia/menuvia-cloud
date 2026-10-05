import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface PlanLimits {
  plan: string
  max_products: number
  max_restaurants: number
  max_tables: number
}

// Fallback offline — valori identice cu rândurile din migration 062
// (plan_limits). Folosit când fetch-ul DB eșuează sau înainte de load.
const DEFAULTS: Record<string, PlanLimits> = {
  free: {
    plan: 'free',
    max_products: 15,
    max_restaurants: 1,
    max_tables: 3,
  },
  // Limitele de mai jos sunt sincronizate cu plans.ts + migrația 089.
  // Dacă schimbi într-un loc, schimbă în toate trei (TS config, DB migrate,
  // acest fallback). UI-ul citește în primul rând din get_restaurant_features.
  starter: {
    plan: 'starter',
    max_products: 300,
    max_restaurants: 1,
    max_tables: 120,
  },
  growth: {
    plan: 'growth',
    max_products: 1000,
    max_restaurants: 1,
    max_tables: 300,
  },
  pro: {
    plan: 'pro',
    max_products: 2000,
    max_restaurants: 2,
    max_tables: 500,
  },
  enterprise: {
    plan: 'enterprise',
    max_products: 1_000_000_000,
    max_restaurants: 1_000_000_000,
    max_tables: 1_000_000_000,
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
      // Listă EXPLICITĂ (mig 290 a șters ai_imports_month + features — zero cititori);
      // coloanele de mai jos există și înainte, și după migrație → deploy în orice ordine.
      const { data, error } = await supabase
        .from('plan_limits')
        .select('plan, max_products, max_restaurants, max_tables')
      if (error) throw error
      const map: Record<string, PlanLimits> = {}
      for (const row of data ?? []) {
        const r = row as Record<string, unknown>
        map[r.plan as string] = {
          plan: r.plan as string,
          max_products: r.max_products as number,
          max_restaurants: r.max_restaurants as number,
          max_tables: r.max_tables as number,
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

  return { limits, loading, canAddProduct }
}

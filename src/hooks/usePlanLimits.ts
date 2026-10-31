import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getPlan, type PlanId } from '../lib/plans'

export interface PlanLimits {
  plan: string
  max_products: number
  max_restaurants: number
  max_tables: number
}

// enterprise = „nelimitat" în DB (mig 071 scrie 1e9 în toate trei coloanele).
const UNLIMITED = 1_000_000_000

function fromCommercialPlan(id: PlanId): PlanLimits {
  const l = getPlan(id).limits
  return {
    plan: id,
    max_products: l.maxProducts,
    max_restaurants: l.maxRestaurants,
    max_tables: l.maxTables,
  }
}

/**
 * Fallback offline — folosit înainte de prima citire și când `plan_limits` nu
 * se poate citi. Înainte era o a TREIA copie scrisă de mână a limitelor
 * (comentariul cerea „schimbă în toate trei"), fără niciun test care s-o lege
 * de DB: o modificare de plan ar fi lăsat-o tăcut în urmă.
 * Acum: planurile comerciale se DERIVĂ din `plans.ts` (pe care PL3 îl leagă de
 * DB), iar free/enterprise — fără card comercial — sunt înghețate de PLT1
 * contra fixturii `PLAN_LIMIT_MATRIX` (aceeași pe care PD5 o compară cu DB-ul).
 */
const PLAN_LIMITS_FALLBACK: Readonly<Record<string, PlanLimits>> = {
  free: { plan: 'free', max_products: 15, max_restaurants: 1, max_tables: 3 },
  starter: fromCommercialPlan('starter'),
  growth: fromCommercialPlan('growth'),
  pro: fromCommercialPlan('pro'),
  enterprise: {
    plan: 'enterprise',
    max_products: UNLIMITED,
    max_restaurants: UNLIMITED,
    max_tables: UNLIMITED,
  },
}

/**
 * Limitele planului CERUT: rândul din DB dacă îl avem, altfel fallback-ul
 * planului, iar pentru un plan necunoscut — free (cel mai restrictiv).
 * Rezultatul e legat de `plan`, nu de cererea care a sosit ultima.
 */
function limitsFor(plan: string, fromDb: Readonly<Record<string, PlanLimits>> | null): PlanLimits {
  return fromDb?.[plan] ?? PLAN_LIMITS_FALLBACK[plan] ?? PLAN_LIMITS_FALLBACK.free
}

// Tabela e GLOBALĂ (aceeași pentru toate restaurantele): o citire per sesiune,
// împărțită între consumatorii simultani.
let _cache: Record<string, PlanLimits> | null = null
let _inflight: Promise<Record<string, PlanLimits> | null> | null = null

async function fetchPlanLimits(): Promise<Record<string, PlanLimits> | null> {
  try {
    // Listă EXPLICITĂ (mig 290 a șters ai_imports_month + features — zero cititori);
    // coloanele de mai jos există și înainte, și după migrație → deploy în orice ordine.
    const { data, error } = await supabase
      .from('plan_limits')
      .select('plan, max_products, max_restaurants, max_tables')
    if (error) return null
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
    return map
  } catch {
    return null
  }
}

function sharedPlanLimits(): Promise<Record<string, PlanLimits> | null> {
  if (!_inflight) {
    _inflight = fetchPlanLimits().finally(() => {
      _inflight = null
    })
  }
  return _inflight
}

export function usePlanLimits(plan: string) {
  // Ce s-a citit din DB (null = încă nimic / citire eșuată → fallback).
  // Limitele NU se țin în state: se derivă la fiecare randare din `plan`.
  // Înainte, fiecare schimbare de plan pornea o citire nouă, iar răspunsul
  // care sosea ULTIMUL câștiga — la încărcarea panoului planul trece din
  // „necunoscut" (free) în cel real, deci un răspuns întârziat pentru free
  // putea lăsa limitele lui free sub planul real.
  const [fromDb, setFromDb] = useState<Record<string, PlanLimits> | null>(() => _cache)
  const [loading, setLoading] = useState(() => _cache == null)

  useEffect(() => {
    if (_cache) {
      setFromDb(_cache)
      setLoading(false)
      return
    }
    let alive = true
    void sharedPlanLimits().then((map) => {
      if (map) _cache = map
      if (!alive) return
      setFromDb(map)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const limits = limitsFor(plan, fromDb)
  const canAddProduct = (currentCount: number): boolean => currentCount < limits.max_products

  return { limits, loading, canAddProduct }
}

// ─────────────────────────────────────────────────────────────
// useFeatures — Hook pentru plan features + cache
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { fetchRestaurantFeatures, hasFeature, getLimit, isWithinLimit } from '../lib/features'
import type { RestaurantFeatures, FeatureName } from '../lib/features'

interface UseFeaturesResult {
  features: RestaurantFeatures | null
  loading: boolean
  // Eroare de CITIRE a feature-urilor ≠ „plan free". Fără această stare,
  // un blip de RPC prăbușea tăcut un plătitor (pro) la fallback-ul cel mai
  // restrictiv (tier 1), făcând să dispară tab-uri fără explicație. Consumatorii
  // pot afișa un banner „nu am putut încărca planul — reîncearcă".
  loadError: boolean
  has: (name: FeatureName) => boolean
  limit: (name: FeatureName) => number | null
  within: (name: FeatureName, count: number) => boolean
  reload: () => Promise<void>
}

// OPT-2: cache SWR la nivel de modul (pattern usePlanLimits) — planul unui
// restaurant nu se schimbă între tab-uri, dar hook-ul e instanțiat de
// DashboardPage + TablesManager + WaiterPage și re-executa RPC-ul la FIECARE
// vizită de tab, cu flash de fallback restrictiv până venea răspunsul.
// Reguli: cache-ul NU stochează niciodată null și NU se suprascrie cu null
// de la un blip; consumatorii simultani împart aceeași promisiune (dedup);
// sub TTL revalidarea se sare complet.
const FEATURES_TTL_MS = 60_000
const featuresCache = new Map<string, { data: RestaurantFeatures; at: number }>()
const inflight = new Map<string, Promise<RestaurantFeatures | null>>()

function fetchShared(restaurantId: string): Promise<RestaurantFeatures | null> {
  const existing = inflight.get(restaurantId)
  if (existing) return existing
  const p = fetchRestaurantFeatures(restaurantId).finally(() => {
    inflight.delete(restaurantId)
  })
  inflight.set(restaurantId, p)
  return p
}

export function useFeatures(restaurantId: string | null | undefined): UseFeaturesResult {
  const [features, setFeatures] = useState<RestaurantFeatures | null>(() =>
    restaurantId ? (featuresCache.get(restaurantId)?.data ?? null) : null,
  )
  const [loading, setLoading] = useState(() =>
    restaurantId ? !featuresCache.has(restaurantId) : false,
  )
  const [loadError, setLoadError] = useState(false)

  async function load(force = false): Promise<void> {
    if (!restaurantId) {
      setFeatures(null)
      setLoadError(false)
      setLoading(false)
      return
    }

    const cached = featuresCache.get(restaurantId)
    if (cached && !force) {
      // Servește sincron din cache — fără flash de fallback restrictiv.
      setFeatures(cached.data)
      setLoadError(false)
      setLoading(false)
      if (Date.now() - cached.at < FEATURES_TTL_MS) return
      // Stale → revalidare în fundal, fără stare de loading.
      const fresh = await fetchShared(restaurantId)
      if (fresh) {
        featuresCache.set(restaurantId, { data: fresh, at: Date.now() })
        setFeatures(fresh)
      }
      return
    }

    setLoading(true)
    const data = await fetchShared(restaurantId)
    if (data) {
      featuresCache.set(restaurantId, { data, at: Date.now() })
      setFeatures(data)
      setLoadError(false)
    } else {
      // null = eroare RPC (fetchRestaurantFeatures NU aruncă — loghează și
      // întoarce null). NU prăbușim tăcut planul: semnalăm eroarea, features
      // rămâne la ultima valoare cunoscută (sau null la primul load).
      setLoadError(true)
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [restaurantId]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    features,
    loading,
    loadError,
    has: (name) => hasFeature(features, name),
    limit: (name) => getLimit(features, name),
    within: (name, count) => isWithinLimit(features, name, count),
    // reload = revalidare FORȚATĂ (invalidează TTL-ul) — folosit după upgrade.
    reload: () => load(true),
  }
}

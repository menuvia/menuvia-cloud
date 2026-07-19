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

export function useFeatures(restaurantId: string | null | undefined): UseFeaturesResult {
  const [features, setFeatures] = useState<RestaurantFeatures | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  async function load(): Promise<void> {
    if (!restaurantId) {
      setFeatures(null)
      setLoadError(false)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await fetchRestaurantFeatures(restaurantId)
      setFeatures(data)
      setLoadError(false)
    } catch (err) {
      console.error('[useFeatures] load error:', err)
      // NU prăbușim tăcut planul: semnalăm eroarea, features rămâne la ultima
      // valoare cunoscută (sau null la primul load).
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
    reload: load,
  }
}

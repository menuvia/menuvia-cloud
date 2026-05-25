// ─────────────────────────────────────────────────────────────
// useFeatures — Hook pentru plan features + cache
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { fetchRestaurantFeatures, hasFeature, getLimit, isWithinLimit } from '../lib/features'
import type { RestaurantFeatures, FeatureName } from '../lib/features'

interface UseFeaturesResult {
  features: RestaurantFeatures | null
  loading: boolean
  has: (name: FeatureName) => boolean
  limit: (name: FeatureName) => number | null
  within: (name: FeatureName, count: number) => boolean
  reload: () => Promise<void>
}

export function useFeatures(restaurantId: string | null | undefined): UseFeaturesResult {
  const [features, setFeatures] = useState<RestaurantFeatures | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(): Promise<void> {
    if (!restaurantId) {
      setFeatures(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await fetchRestaurantFeatures(restaurantId)
      setFeatures(data)
    } catch (err) {
      console.error('[useFeatures] load error:', err)
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [restaurantId]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    features,
    loading,
    has: (name) => hasFeature(features, name),
    limit: (name) => getLimit(features, name),
    within: (name, count) => isWithinLimit(features, name, count),
    reload: load,
  }
}

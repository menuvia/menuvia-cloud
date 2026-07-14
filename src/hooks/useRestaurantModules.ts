// ─────────────────────────────────────────────────────────────
// useRestaurantModules — toggle pentru module opționale per-restaurant
// ─────────────────────────────────────────────────────────────
// Citire prin SELECT direct pe restaurant_modules (RLS = public read);
// mutație prin set_restaurant_module RPC (admin-only, verifică membership).
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export type ModuleKey =
  | 'reservations'
  | 'online_payments'
  | 'loyalty'
  | 'delivery'
  | 'gift_cards'
  | 'sms_notifications'

interface UseRestaurantModulesResult {
  modules: Record<ModuleKey, boolean>
  loading: boolean
  isEnabled: (key: ModuleKey) => boolean
  setModule: (key: ModuleKey, enabled: boolean) => Promise<void>
  reload: () => Promise<void>
}

const DEFAULT_MODULES: Record<ModuleKey, boolean> = {
  reservations: false,
  online_payments: false,
  loyalty: false,
  delivery: false,
  gift_cards: false,
  sms_notifications: false,
}

export function useRestaurantModules(
  restaurantId: string | null | undefined,
): UseRestaurantModulesResult {
  const [modules, setModules] = useState<Record<ModuleKey, boolean>>(DEFAULT_MODULES)
  const [loading, setLoading] = useState(true)
  // Token de secvență: ignoră răspunsuri întârziate pentru un restaurantId vechi.
  const loadSeqRef = useRef(0)

  async function load(): Promise<void> {
    const seq = ++loadSeqRef.current
    if (!restaurantId) {
      if (seq === loadSeqRef.current) {
        setModules(DEFAULT_MODULES)
        setLoading(false)
      }
      return
    }
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('restaurant_modules')
        .select('module_key, enabled')
        .eq('restaurant_id', restaurantId)
      if (error) throw error
      const next = { ...DEFAULT_MODULES }
      for (const row of data ?? []) {
        next[row.module_key as ModuleKey] = row.enabled
      }
      if (seq === loadSeqRef.current) setModules(next)
    } catch (err) {
      console.error('[useRestaurantModules] load error:', err)
    }
    if (seq === loadSeqRef.current) setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [restaurantId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setModule(key: ModuleKey, enabled: boolean): Promise<void> {
    if (!restaurantId) throw new Error('restaurant_id lipsă')
    // Optimistic update — UI răspunde instant; rollback la eroare.
    const prev = modules
    setModules({ ...prev, [key]: enabled })
    const { error } = await supabase.rpc('set_restaurant_module', {
      p_restaurant_id: restaurantId,
      p_module_key: key,
      p_enabled: enabled,
    })
    if (error) {
      setModules(prev)
      throw error
    }
  }

  return {
    modules,
    loading,
    isEnabled: (key) => modules[key] ?? false,
    setModule,
    reload: load,
  }
}

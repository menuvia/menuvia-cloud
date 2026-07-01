import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { MemberRole } from '../lib/constants'

export interface RestaurantMembership {
  restaurant_id: string
  role: MemberRole
  restaurant: {
    id: string
    name: string
    slug: string
  }
}

interface RestaurantCtxValue {
  memberships: RestaurantMembership[]
  activeId: string | null
  activeName: string
  activeRole: MemberRole | null
  setActive: (id: string) => void
  loading: boolean
}

const RestaurantCtx = createContext<RestaurantCtxValue | null>(null)

const STORAGE_KEY = 'menuvia_active_restaurant'

export function RestaurantProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [memberships, setMemberships] = useState<RestaurantMembership[]>([])
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Flag de anulare: previne ca un răspuns vechi (user A) să suprascrie
    // state-ul după ce userul s-a schimbat (user B) la re-login rapid.
    let cancelled = false

    if (!user) {
      // Signout / user null: golim state-ul local și cheia din localStorage,
      // ca un user nou să nu moștenească restaurantul activ al celui vechi.
      localStorage.removeItem(STORAGE_KEY)
      setMemberships([])
      setActiveIdState(null)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    async function loadMemberships() {
      try {
        const { data } = await supabase
          .from('restaurant_memberships')
          .select('restaurant_id, role, restaurant:restaurants(id, name, slug)')
          .eq('user_id', user!.id)

        if (cancelled) return

        const rows: RestaurantMembership[] = (data ?? []).map((m) => {
          const raw = m as {
            restaurant_id: string
            role: string
            restaurant:
              | { id: string; name: string; slug: string }
              | { id: string; name: string; slug: string }[]
              | null
          }
          const rest = Array.isArray(raw.restaurant) ? raw.restaurant[0] : raw.restaurant
          return {
            restaurant_id: raw.restaurant_id,
            role: raw.role as MemberRole,
            restaurant: rest ?? { id: '', name: '', slug: '' },
          }
        })
        setMemberships(rows)

        const saved = localStorage.getItem(STORAGE_KEY)
        const isValid = saved != null && rows.some((m) => m.restaurant_id === saved)
        setActiveIdState(isValid ? saved : (rows[0]?.restaurant_id ?? null))
      } catch (err) {
        if (cancelled) return
        console.error('[RestaurantContext] Failed to load memberships:', err)
        // Continuăm cu memberships goale — userul vede onboarding
      }
      if (cancelled) return
      setLoading(false)
    }
    void loadMemberships()

    return () => {
      cancelled = true
    }
  }, [user])

  const setActive = useCallback((id: string) => {
    setActiveIdState(id)
    localStorage.setItem(STORAGE_KEY, id)
  }, [])

  const active = memberships.find((m) => m.restaurant_id === activeId)

  return (
    <RestaurantCtx.Provider
      value={{
        memberships,
        activeId,
        activeName: active?.restaurant?.name ?? '',
        activeRole: active?.role ?? null,
        setActive,
        loading,
      }}
    >
      {children}
    </RestaurantCtx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRestaurantCtx(): RestaurantCtxValue {
  const ctx = useContext(RestaurantCtx)
  if (!ctx) throw new Error('useRestaurantCtx must be used inside <RestaurantProvider>')
  return ctx
}

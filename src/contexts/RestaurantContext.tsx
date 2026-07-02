import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { getFounderView, clearFounderView } from '../lib/founder'
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
  // Id-ul restaurantului vizitat în „mod fondator/partener" (nu e membership
  // real al userului) — null în folosirea normală. DashboardPage arată banner.
  founderViewId: string | null
}

const RestaurantCtx = createContext<RestaurantCtxValue | null>(null)

const STORAGE_KEY = 'menuvia_active_restaurant'

export function RestaurantProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [memberships, setMemberships] = useState<RestaurantMembership[]>([])
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [founderViewId, setFounderViewId] = useState<string | null>(null)

  useEffect(() => {
    // Flag de anulare: previne ca un răspuns vechi (user A) să suprascrie
    // state-ul după ce userul s-a schimbat (user B) la re-login rapid.
    let cancelled = false

    if (!user) {
      // Signout / user null: golim state-ul local și cheia din localStorage,
      // ca un user nou să nu moștenească restaurantul activ al celui vechi.
      localStorage.removeItem(STORAGE_KEY)
      clearFounderView()
      setFounderViewId(null)
      setMemberships([])
      setActiveIdState(null)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    async function loadMemberships() {
      // Marcăm loading la începutul fetch-ului: fără asta, primul render cu
      // user!=null (dar înainte de a avea date) ar arăta loading=false → flash
      // de UI onboarding/gol cât `loadMemberships()` e încă în zbor.
      setLoading(true)
      try {
        const { data, error: memErr } = await supabase
          .from('restaurant_memberships')
          .select('restaurant_id, role, restaurant:restaurants(id, name, slug)')
          .eq('user_id', user!.id)

        if (cancelled) return
        if (memErr) {
          // supabase-js nu aruncă — eroarea vine în {error}. O listă goală din
          // cauza unui blip de rețea NU înseamnă „zero membership-uri": nu
          // atingem founder-view și nu suprascriem state-ul cu [].
          console.error('[RestaurantContext] Failed to load memberships:', memErr)
          setLoading(false)
          return
        }

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
        // Mod fondator/partener: FounderPage sau AffiliatePanel a cerut
        // vizitarea unui restaurant pe care userul NU are membership. RLS-ul
        // (is_member, extins în mig 186) decide accesul: dacă SELECT-ul pe
        // restaurants întoarce rândul, injectăm un membership sintetic de
        // manager; dacă nu (user fără drepturi / cheie stale), curățăm cheia.
        const fv = getFounderView()
        let fvActive: string | null = null
        if (fv && !rows.some((m) => m.restaurant_id === fv)) {
          const { data: fvRest, error: fvErr } = await supabase
            .from('restaurants')
            .select('id, name, slug')
            .eq('id', fv)
            .maybeSingle()
          if (cancelled) return
          if (fvRest) {
            rows.push({
              restaurant_id: fvRest.id,
              role: 'manager' as MemberRole,
              restaurant: fvRest,
            })
            fvActive = fvRest.id
          } else if (!fvErr) {
            // Răspuns valid cu zero rânduri = chiar nu ai acces (cheie stale).
            // Pe eroare tranzientă păstrăm cheia — altfel un blip de rețea la
            // reload ejecta silențios fondatorul/partenerul din modul de vizită.
            clearFounderView()
          }
        } else if (fv) {
          // Are membership real pe restaurantul cerut — nu e impersonare.
          clearFounderView()
        }
        setFounderViewId(fvActive)
        setMemberships(rows)

        const saved = localStorage.getItem(STORAGE_KEY)
        const isValid = saved != null && rows.some((m) => m.restaurant_id === saved)
        // Modul fondator are prioritate la selecție (userul tocmai a ales
        // „Intră pe cont" — îl ducem direct pe restaurantul țintă).
        setActiveIdState(fvActive ?? (isValid ? saved : (rows[0]?.restaurant_id ?? null)))
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
        founderViewId,
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

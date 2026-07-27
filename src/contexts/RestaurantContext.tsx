import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
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
  // true când încărcarea membership-urilor a eșuat tranzient (blip de rețea /
  // eroare Supabase) — memberships rămân goale, dar NU înseamnă „fără acces".
  // Consumatorii (ProtectedRoute) trebuie să arate „reîncearcă", nu „n-ai drept".
  error: boolean
  // Id-ul restaurantului vizitat în „mod fondator/partener" (nu e membership
  // real al userului) — null în folosirea normală. DashboardPage arată banner.
  founderViewId: string | null
}

const RestaurantCtx = createContext<RestaurantCtxValue | null>(null)

const STORAGE_KEY = 'menuvia_active_restaurant'

export function RestaurantProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [memberships, setMemberships] = useState<RestaurantMembership[]>([])
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [founderViewId, setFounderViewId] = useState<string | null>(null)
  // Id-ul userului pentru care s-au încărcat membership-urile curente. La o
  // schimbare DIRECTĂ de identitate (A→B fără null intermediar — magic-link /
  // OAuth callback), golim state-ul ÎNAINTE de fetch: altfel, dacă fetch-ul lui
  // B eșuează tranzient, memberships/activeId rămân ale lui A → chrome-ul mesei
  // greșite (RLS-ul serverului blochează datele reale, dar UI-ul e inconsistent).
  const loadedForUserRef = useRef<string | null>(null)

  useEffect(() => {
    // Flag de anulare: previne ca un răspuns vechi (user A) să suprascrie
    // state-ul după ce userul s-a schimbat (user B) la re-login rapid.
    let cancelled = false

    // Auth-ul încă se rezolvă. AuthContext pornește cu `user = null` și cheamă
    // `getSession()` ASINCRON, iar AuthProvider randează copiii necondiționat →
    // RestaurantProvider se monta mereu cu user=null la ORICE încărcare de
    // pagină și intra în ramura de mai jos, ștergând `menuvia_active_restaurant`
    // + `menuvia_founder_view`. Efecte: „Intră pe cont" (fondator/partener) era
    // MORT (enterFounderView scrie cheia, apoi face navigare completă → mount la
    // rece → cheia ștearsă înainte s-o citească cineva), iar un owner cu mai
    // multe restaurante pierdea restaurantul selectat la fiecare refresh
    // (fallback pe rows[0]). Așteptăm rezolvarea sesiunii; `loading` rămâne true.
    if (authLoading) return

    if (!user) {
      loadedForUserRef.current = null
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

    // Schimbare DIRECTĂ de identitate (A→B fără null): golim state-ul lui A
    // ÎNAINTE de fetch-ul lui B. Nu se declanșează la re-fetch pentru ACELAȘI
    // user (id neschimbat → fără flash), doar la trecerea reală între conturi.
    if (loadedForUserRef.current !== null && loadedForUserRef.current !== user.id) {
      setMemberships([])
      setActiveIdState(null)
      setFounderViewId(null)
      // ...și CHEIA, nu doar state-ul: altfel userul B moștenea vizita de
      // fondator a lui A (se auto-repara abia prin RLS, la fetch — dar între
      // timp UI-ul arăta intenția lui A). Restaurantul activ, la fel.
      clearFounderView()
      localStorage.removeItem(STORAGE_KEY)
    }
    loadedForUserRef.current = user.id

    async function loadMemberships() {
      // Marcăm loading la începutul fetch-ului: fără asta, primul render cu
      // user!=null (dar înainte de a avea date) ar arăta loading=false → flash
      // de UI onboarding/gol cât `loadMemberships()` e încă în zbor.
      setLoading(true)
      setError(false)
      try {
        const { data, error: memErr } = await supabase
          .from('restaurant_memberships')
          .select('restaurant_id, role, restaurant:restaurants(id, name, slug)')
          .eq('user_id', user!.id)
          // Ordine STABILĂ: fără ea, `rows[0]` (restaurantul implicit când nu
          // există unul salvat) era la mila ordinii returnate de Postgres —
          // adică userul putea nimeri alt restaurant de la un reload la altul.
          .order('restaurant_id', { ascending: true })

        if (cancelled) return
        if (memErr) {
          // supabase-js nu aruncă — eroarea vine în {error}. O listă goală din
          // cauza unui blip de rețea NU înseamnă „zero membership-uri": nu
          // atingem founder-view și nu suprascriem state-ul cu []. Marcăm eroarea
          // ca ProtectedRoute să arate „reîncearcă", nu „n-ai acces".
          console.error('[RestaurantContext] Failed to load memberships:', memErr)
          setError(true)
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
        // Eroare tranzientă (nu răspuns valid cu zero rânduri) → marcăm error,
        // NU tratăm ca „fără restaurant / fără acces".
        setError(true)
      }
      if (cancelled) return
      setLoading(false)
    }
    void loadMemberships()

    return () => {
      cancelled = true
    }
  }, [user, authLoading])

  const setActive = useCallback((id: string) => {
    setActiveIdState(id)
    localStorage.setItem(STORAGE_KEY, id)
    // Alegerea manuală a unui restaurant încheie vizita de fondator/partener.
    // Fără asta cheia rămânea și, la următorul reload, `fvActive` avea prioritate
    // în selecție (vezi mai jos) → userul era readus pe restaurantul vizitat,
    // deși tocmai comutase în altă parte.
    clearFounderView()
    setFounderViewId(null)
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
        error,
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

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { getFounderView, clearFounderView } from '../lib/founder'
import type { MemberRole } from '../lib/constants'
import { resolveVisitRole, type UiRole } from '../lib/partnerAccess'
import { defaultActiveRestaurantId } from '../lib/roleRouting'

export interface RestaurantMembership {
  restaurant_id: string
  // MemberRole din DB + „partner" (vizită de afiliat, mig 286 — doar în UI).
  role: UiRole
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
  activeRole: UiRole | null
  setActive: (id: string) => void
  loading: boolean
  // true când încărcarea membership-urilor a eșuat tranzient (blip de rețea /
  // eroare Supabase) — memberships rămân goale, dar NU înseamnă „fără acces".
  // Consumatorii (ProtectedRoute) trebuie să arate „reîncearcă", nu „n-ai drept".
  error: boolean
  // Id-ul restaurantului vizitat în „mod fondator/partener" (nu e membership
  // real al userului) — null în folosirea normală. DashboardPage arată banner.
  founderViewId: string | null
  // Recitește membership-urile FĂRĂ să treacă prin `loading` (care ar demonta
  // panoul): după „Adaugă o locație" (lotul A), noul restaurant trebuie să
  // aibă rolul `owner` în listă ÎNAINTE de `setActive`, altfel `activeRole` ar
  // fi null pe locul tocmai creat. `false` = citirea a eșuat (lista rămâne).
  reloadMemberships: () => Promise<boolean>
}

const RestaurantCtx = createContext<RestaurantCtxValue | null>(null)

const STORAGE_KEY = 'menuvia_active_restaurant'

const MEMBERSHIP_SELECT = 'restaurant_id, role, restaurant:restaurants(id, name, slug)'

// Rândurile `restaurant_memberships` (cu restaurantul încorporat) → forma din
// context. Folosită de încărcarea inițială ȘI de `reloadMemberships`.
function mapMembershipRows(data: unknown[] | null): RestaurantMembership[] {
  return (data ?? []).map((m) => {
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
}

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
          .select(MEMBERSHIP_SELECT)
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

        const rows: RestaurantMembership[] = mapMembershipRows(data)
        // Mod fondator/partener: FounderPage sau AffiliatePanel a cerut
        // vizitarea unui restaurant pe care userul NU are membership. RLS-ul
        // (is_member, extins în mig 186) decide accesul: dacă SELECT-ul pe
        // restaurants întoarce rândul, injectăm un membership sintetic (manager
        // pentru fondator, „partner" pentru afiliat); dacă nu (user fără drepturi / cheie stale), curățăm cheia.
        const fv = getFounderView(user!.id)
        let fvActive: string | null = null
        if (fv && !rows.some((m) => m.restaurant_id === fv)) {
          const { data: fvRest, error: fvErr } = await supabase
            .from('restaurants')
            .select('id, name, slug')
            .eq('id', fv)
            .maybeSingle()
          if (cancelled) return
          if (fvRest) {
            // Rolul vizitei: fondatorul (is_platform_admin) = manager virtual,
            // partenerul (mig 286) = „partner" — SELECT-ul pe restaurants a trecut
            // pentru el prin politica dedicată, dar my_role() întoarce null, iar
            // dashboard-ul îi arată doar meniul + mesele/QR.
            const { data: visitRole, error: roleErr } = await supabase.rpc('my_role', {
              p_restaurant_id: fvRest.id,
            })
            if (cancelled) return
            rows.push({
              restaurant_id: fvRest.id,
              role: resolveVisitRole(
                typeof visitRole === 'string' ? visitRole : null,
                roleErr != null,
              ),
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
        // Fără restaurant salvat (dispozitiv nou), NU `rows[0]` (ordonat după
        // restaurant_id, deci la întâmplare față de rol): un patron care e și
        // bucătar în alt local ar fi pornit pe localul de bucătărie, iar garda
        // de pe /dashboard (lib/roleRouting.ts) l-ar fi scos din propriul panou.
        setActiveIdState(fvActive ?? (isValid ? saved : defaultActiveRestaurantId(rows)))
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

  // Doar membership-urile REALE se recitesc; cel sintetic al vizitei de
  // fondator/partener (dacă există) rămâne în listă, neatins.
  const userId = user?.id ?? null
  const reloadMemberships = useCallback(async (): Promise<boolean> => {
    if (!userId) return false
    const { data, error: memErr } = await supabase
      .from('restaurant_memberships')
      .select(MEMBERSHIP_SELECT)
      .eq('user_id', userId)
      .order('restaurant_id', { ascending: true })
    // Contul s-a schimbat cât cererea era în zbor: răspunsul nu mai e al lui.
    if (loadedForUserRef.current !== userId) return false
    if (memErr) {
      console.error('[RestaurantContext] Failed to reload memberships:', memErr)
      return false
    }
    const rows = mapMembershipRows(data)
    setMemberships((prev) => {
      const realIds = new Set(rows.map((r) => r.restaurant_id))
      const synthetic = prev.filter(
        (m) => m.restaurant_id === founderViewId && !realIds.has(m.restaurant_id),
      )
      return [...rows, ...synthetic]
    })
    return true
  }, [userId, founderViewId])

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
        reloadMemberships,
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

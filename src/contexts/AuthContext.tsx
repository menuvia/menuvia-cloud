import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  plan: string
  /** Consimțământul la Termeni (mig 042). `null` = nu s-a consemnat niciodată. */
  terms_accepted_at: string | null
}

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // OPT-3: ultimul id de user văzut — deosebește schimbarea REALĂ de user de
  // un TOKEN_REFRESHED (obiect nou, același id) fără efecte în updater.
  const lastUserIdRef = useRef<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  // Ultimul profil CERUT: un răspuns întârziat pentru contul anterior nu are
  // voie să suprascrie profilul contului curent (recenzie CodeRabbit pe #261).
  // Consecința nu e cosmetică: `TermsAcceptanceGate` citește
  // `terms_accepted_at` de aici, deci un profil străin ar putea sări
  // consimțământul pentru contul nou. Aceeași disciplină ca guard-ul de
  // anulare din useOrders.
  const profileReqRef = useRef<string | null>(null)

  async function loadProfile(userId: string) {
    profileReqRef.current = userId
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name, plan, terms_accepted_at')
        .eq('id', userId)
        .single()
      if (data && profileReqRef.current === userId) {
        const row = data as Record<string, unknown>
        setProfile({
          id: row.id as string,
          email: row.email as string,
          full_name: (row.full_name as string | null) ?? null,
          plan: (row.plan as string) ?? 'free',
          terms_accepted_at: (row.terms_accepted_at as string | null) ?? null,
        })
      }
    } catch (err) {
      console.error('[AuthContext] Profile load failed:', err)
      // App continuă cu profile=null — doar numele nu se afișează
    }
  }

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        setUser(s?.user ?? null)
        lastUserIdRef.current = s?.user?.id ?? null
        if (s?.user) void loadProfile(s.user.id)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      // OPT-3/OPT-R2: TOKEN_REFRESHED (~orar) emite un obiect user NOU cu același id —
      // identitatea nouă redeclanșa efectele pe [user] din useData/RestaurantContext
      // (cascadă de refetch-uri + remount pe ecranele POS la fiecare ~55 min).
      // Păstrăm identitatea obiectului când id-ul nu s-a schimbat; profilul se
      // reîncarcă doar la schimbarea REALĂ de utilizator (updater-ul rămâne pur).
      const next = s?.user ?? null
      const changed = lastUserIdRef.current !== (next?.id ?? null)
      lastUserIdRef.current = next?.id ?? null
      if (changed) {
        // Profilul vechi dispare ÎNAINTE de încărcare: până sosește cel nou,
        // „necunoscut" e singurul răspuns onest, iar gate-urile tristate
        // (Termeni, plan) sunt construite exact pentru asta.
        setProfile(null)
        if (next) void loadProfile(next.id)
      }
      setUser((prev) => (prev?.id === next?.id ? prev : next))
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
  }
  const refreshProfile = async () => {
    if (user) await loadProfile(user.id)
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}

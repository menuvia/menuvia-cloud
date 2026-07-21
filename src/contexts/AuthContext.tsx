import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  plan: string
}

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  session: null,
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
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId: string) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name, plan')
        .eq('id', userId)
        .single()
      if (data) {
        const row = data as Record<string, unknown>
        setProfile({
          id: row.id as string,
          email: row.email as string,
          full_name: (row.full_name as string | null) ?? null,
          plan: (row.plan as string) ?? 'free',
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
        setSession(s)
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
      setSession(s)
      // OPT-3: TOKEN_REFRESHED (~orar) emite un obiect user NOU cu același id —
      // identitatea nouă redeclanșa efectele pe [user] din useData/RestaurantContext
      // (cascadă de refetch-uri + remount pe ecranele POS la fiecare ~55 min).
      // Păstrăm identitatea obiectului când id-ul nu s-a schimbat; profilul se
      // reîncarcă doar la schimbarea REALĂ de utilizator (updater-ul rămâne pur).
      const next = s?.user ?? null
      const changed = lastUserIdRef.current !== (next?.id ?? null)
      lastUserIdRef.current = next?.id ?? null
      if (changed) {
        if (next) void loadProfile(next.id)
        else setProfile(null)
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
    <AuthContext.Provider value={{ user, profile, session, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}

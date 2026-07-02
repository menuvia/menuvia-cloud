import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  pickAllowed,
  RESTAURANT_UPDATE_FIELDS,
  CATEGORY_UPDATE_FIELDS,
  PRODUCT_UPDATE_FIELDS,
} from '../lib/sanitize'
import { createRestaurant } from '../lib/restaurants'
import { getFounderView } from '../lib/founder'

export interface Restaurant {
  id: string
  owner_id: string
  name: string
  tagline: string | null
  city: string | null
  slug: string
  description: string | null
  address: string | null
  phone: string | null
  hours: string | null
  primary_color: string
  logo_url: string | null
  cover_url: string | null
  is_active: boolean
  floor_layout: Record<string, unknown> | null
  socials: {
    instagram?: string | null
    facebook?: string | null
    tiktok?: string | null
    website?: string | null
  } | null
  amenities: string[]
  hours_structured: {
    mon?: { open: string; close: string; closed: boolean }
    tue?: { open: string; close: string; closed: boolean }
    wed?: { open: string; close: string; closed: boolean }
    thu?: { open: string; close: string; closed: boolean }
    fri?: { open: string; close: string; closed: boolean }
    sat?: { open: string; close: string; closed: boolean }
    sun?: { open: string; close: string; closed: boolean }
  } | null
  wifi_password: string | null
  timezone: string | null
  checkout_suggestion_settings: {
    enabled: boolean
    categories: string[]
    max_suggestions: number
    message: string
  } | null
  theme_settings: {
    preset_id: string
    accent_override?: string | null
    menu_layout?: 'list' | 'grid' | 'minimal' | null
    elements?: {
      cover?: boolean
      tagline?: boolean
      status?: boolean
      amenities?: boolean
      social?: boolean
    } | null
  } | null
  pickup_settings: {
    enabled: boolean
    min_lead_time_minutes: number
    slot_interval_minutes: number
    open_hours: { start: string; end: string }
    instructions: string | null
  } | null
  google_place_id: string | null
  google_review_url: string | null
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  restaurant_id: string
  name: string
  emoji: string
  display_order: number
  meta_text: string | null
}

export interface Product {
  id: string
  restaurant_id: string
  category_id: string | null
  name: string
  description: string | null
  price: number
  emoji: string
  image_url: string | null
  is_active: boolean
  is_daily_special: boolean
  is_sold_out: boolean
  is_draft: boolean
  display_order: number
  allergens: string[]
  dietary_tags: string[]
  prep_time_minutes: number | null
  portion_size: string | null
  vat_group: number
  // ── Nutriție (estimabilă cu AI) + marker câmpuri generate de AI ──
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  // Lista câmpurilor generate de AI și NEverificate încă (ex. ['image_url','calories']).
  // UI afișează badge „generat de AI — verifică"; editarea manuală scoate câmpul.
  ai_generated_fields: string[]
}

export function useRestaurants() {
  const { user } = useAuth()
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Marchez DOAR fetch-ul inițial pentru user-ul curent. Refetch-urile după
  // create/update/remove NU mai setează loading:true → fără full-page spinner
  // în DashboardPage la fiecare CRUD.
  const initialFetchDoneRef = useRef(false)

  const load = useCallback(async () => {
    if (!user) {
      setRestaurants([])
      setLoading(false)
      initialFetchDoneRef.current = false
      return
    }
    // Setăm loading:true doar pe fetch-ul INIȚIAL pentru acest user. Asta
    // previne flash-ul OnboardingPage când auth se hidratează tardiv —
    // înainte de fix exista fereastra loading=false + restaurants=[] +
    // user=real în care App.tsx randa onboarding-ul 2-3 sec.
    if (!initialFetchDoneRef.current) setLoading(true)
    setError(null)
    const [ownedRes, memberRes] = await Promise.all([
      supabase.from('restaurants').select('*').eq('owner_id', user.id).order('created_at'),
      supabase
        .from('restaurant_memberships')
        .select('restaurant:restaurants(*)')
        .eq('user_id', user.id)
        .neq('role', 'owner'),
    ])
    if (ownedRes.error && memberRes.error) {
      setError(ownedRes.error.message)
      setLoading(false)
      return
    }
    const owned = (ownedRes.data ?? []) as Restaurant[]
    const viaMembership: Restaurant[] = (memberRes.data ?? [])
      .map((m) => {
        const raw = (m as Record<string, unknown>).restaurant as Restaurant | Restaurant[] | null
        if (!raw) return null
        return Array.isArray(raw) ? (raw[0] ?? null) : raw
      })
      .filter((r): r is Restaurant => r !== null)
    const seen = new Set(owned.map((r) => r.id))
    const merged = [...owned]
    for (const r of viaMembership) {
      if (!seen.has(r.id)) {
        merged.push(r)
        seen.add(r.id)
      }
    }
    // Mod fondator/partener: restaurantul vizitat nu e nici owned, nici prin
    // membership — îl încărcăm separat. RLS-ul (is_member extins, mig 186)
    // decide accesul: fără drepturi, SELECT-ul întoarce null și nu adăugăm nimic.
    const fv = getFounderView()
    if (fv && !seen.has(fv)) {
      const { data: fvRow } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', fv)
        .maybeSingle()
      if (fvRow) merged.push(fvRow as Restaurant)
    }
    setRestaurants(merged)
    setLoading(false)
    initialFetchDoneRef.current = true
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (form: Partial<Restaurant>) => {
    // Forma legacy a contractului (păstrăm shape-ul {data,error} pe care îl
    // așteptau call site-urile). Folosim RPC-ul `create_restaurant`; după
    // bootstrap reluăm fetch-ul pentru a returna rândul cu toate coloanele.
    try {
      const created = await createRestaurant({
        name: form.name ?? '',
        city: form.city ?? null,
        slug: form.slug ?? null,
        primaryColor: form.primary_color ?? undefined,
      })
      await load()
      const fetched = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', created.restaurant_id)
        .single()
      return fetched
    } catch (e) {
      return { data: null, error: e as Error }
    }
  }
  const update = async (id: string, form: Partial<Restaurant>) => {
    const safe = pickAllowed(form, RESTAURANT_UPDATE_FIELDS)
    const result = await supabase.from('restaurants').update(safe).eq('id', id).select().single()
    if (!result.error) await load()
    return result
  }
  // useRestaurants.remove() retras: mig 096B REVOKE delete pe `restaurants`
  // pentru anon/authenticated. Ștergerea restaurantelor nu există în UI;
  // ar fi un flow admin separat, sub RPC dedicat dacă va apărea cândva.

  return { restaurants, loading, error, refetch: load, create, update }
}

export function useCategories(restaurantId: string | null) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!restaurantId) {
      setCategories([])
      setLoading(false)
      return
    }
    setError(null)
    const { data, error: err } = await supabase
      .from('categories')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('display_order')
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setCategories((data ?? []) as Category[])
    setLoading(false)
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (form: Partial<Category>) => {
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.display_order), -1)
    const safe = pickAllowed(form, CATEGORY_UPDATE_FIELDS)
    const r = await supabase
      .from('categories')
      .insert({ ...safe, restaurant_id: restaurantId, display_order: maxOrder + 1 })
      .select()
      .single()
    if (!r.error) await load()
    return r
  }
  const update = async (id: string, form: Partial<Category>) => {
    const safe = pickAllowed(form, CATEGORY_UPDATE_FIELDS)
    const r = await supabase.from('categories').update(safe).eq('id', id).select().single()
    if (!r.error) await load()
    return r
  }
  const remove = async (id: string) => {
    const r = await supabase.from('categories').delete().eq('id', id)
    if (!r.error) await load()
    return r
  }

  const reorder = async (ordered: Category[]) => {
    const updates = ordered.map((c, i) =>
      supabase.from('categories').update({ display_order: i }).eq('id', c.id),
    )
    await Promise.all(updates)
    setCategories(ordered.map((c, i) => ({ ...c, display_order: i })))
  }

  return { categories, loading, error, refetch: load, create, update, remove, reorder }
}

export function useProducts(restaurantId: string | null) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!restaurantId) {
      setProducts([])
      setLoading(false)
      return
    }
    setError(null)
    const { data, error: err } = await supabase
      .from('products')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('display_order')
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setProducts((data ?? []) as Product[])
    setLoading(false)
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (form: Partial<Product>) => {
    const maxOrder = products.reduce((m, p) => Math.max(m, p.display_order), -1)
    const safe = pickAllowed(form, PRODUCT_UPDATE_FIELDS)
    const r = await supabase
      .from('products')
      .insert({ ...safe, restaurant_id: restaurantId, display_order: maxOrder + 1 })
      .select()
      .single()
    if (!r.error) await load()
    return r
  }
  const update = async (id: string, form: Partial<Product>) => {
    const safe = pickAllowed(form, PRODUCT_UPDATE_FIELDS)
    const r = await supabase.from('products').update(safe).eq('id', id).select().single()
    if (!r.error) await load()
    return r
  }
  const remove = async (id: string) => {
    const r = await supabase.from('products').delete().eq('id', id)
    if (!r.error) await load()
    return r
  }
  const toggleActive = async (id: string, current: boolean) => {
    const r = await supabase.from('products').update({ is_active: !current }).eq('id', id)
    if (!r.error) await load()
    return r
  }
  const toggleSoldOut = async (id: string, current: boolean) => {
    const r = await supabase.from('products').update({ is_sold_out: !current }).eq('id', id)
    if (!r.error) await load()
    return r
  }
  const toggleDailySpecial = async (id: string, current: boolean) => {
    const r = await supabase.from('products').update({ is_daily_special: !current }).eq('id', id)
    if (!r.error) await load()
    return r
  }

  return {
    products,
    loading,
    error,
    refetch: load,
    create,
    update,
    remove,
    toggleActive,
    toggleSoldOut,
    toggleDailySpecial,
  }
}

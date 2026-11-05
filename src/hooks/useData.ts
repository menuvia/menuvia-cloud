import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  pickAllowed,
  RESTAURANT_UPDATE_FIELDS,
  CATEGORY_UPDATE_FIELDS,
  PRODUCT_INSERT_FIELDS,
  PRODUCT_UPDATE_FIELDS,
} from '../lib/sanitize'
import { createRestaurant } from '../lib/restaurants'
import { getFounderView } from '../lib/founder'
import { zeroRowsAsDenied } from '../lib/userMessages'
import { setProductSoldOut, isMissingSoldOutRpc, type SoldOutSource } from '../lib/soldOut'

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
    menu_layout?: 'list' | 'grid' | 'minimal' | 'photo' | 'flipbook' | null
    elements?: {
      cover?: boolean
      tagline?: boolean
      status?: boolean
      amenities?: boolean
      social?: boolean
    } | null
    flipbook_pages?: string[] | null
    // Ascunde badge-ul „Creat cu Menuvia" (E1) — scrierea e gate-uită în UI
    // pe Plan 2+ (remove_branding); citirea în meniuri e liberă (resolveHideBranding).
    hide_branding?: boolean | null
  } | null
  pickup_settings: {
    enabled: boolean
    min_lead_time_minutes: number
    slot_interval_minutes: number
    open_hours: { start: string; end: string }
    instructions: string | null
    // Mod „doar ridicare" (food truck, E3): ascunde Hartă sală/Rezervări din
    // dashboard; QR-ul general /m/:slug devine QR-ul principal. OPȚIONAL —
    // pur mod de afișare, enforcement-ul comenzii pickup există în Gate A.
    pickup_only?: boolean
  } | null
  google_place_id: string | null
  google_review_url: string | null
  // Limbile în care restaurantul expune meniul (array de coduri, ex. ['en','de']).
  // Româna e mereu baza și NU apare aici. Vezi src/lib/i18nMenu.ts.
  menu_languages?: string[] | null
  // Moneda meniului (mig 007, activată în mig 205) — 'RON' default.
  currency?: string | null
  // Țara (ISO alpha-2, mig 296) — 'RO' default. Feature-urile românești
  // (fiscal, plăți în aplicație, TVA) sunt false în DB pentru country <> 'RO'.
  country?: string | null
  // Limba de BAZĂ a meniului (mig 038; editabilă din mig 298): limba în care
  // sunt scrise name/description. Una din MENU_LANGS (CHECK în DB).
  language?: string | null
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
  // Traduceri manuale per limbă (cheia = cod de limbă). Vezi src/lib/i18nMenu.ts.
  translations?: import('../lib/i18nMenu').Translations | null
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
  // De ce e (sau nu e) epuizat (mig 313): 'stock' = automat din rețetă,
  // 'manual' = de om. Opțional: lipsește pe o bază fără migrația 313.
  sold_out_source?: SoldOutSource
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
  // Traduceri manuale per limbă (cheia = cod de limbă). Vezi src/lib/i18nMenu.ts.
  translations?: import('../lib/i18nMenu').Translations | null
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
  // Token anti-race (pattern-ul `cancelled` din RestaurantContext): un fetch
  // în zbor pentru userul vechi (pornit cu token-ul LUI, deci RLS întoarce
  // rândurile lui) nu are voie să suprascrie state-ul după signout/re-login.
  // Last-wins și între refetch-uri suprapuse.
  const loadSeqRef = useRef(0)

  // Schimbare DIRECTĂ de cont (A→B fără delogare între ele): lista lui A nu
  // are voie să rămână în selector cât se încarcă B, iar B are propriul fetch
  // inițial (cu spinner), nu un refetch tăcut peste datele lui A.
  const loadedForUserRef = useRef<string | null>(null)
  // Același proprietar, ca STATE: ref-ul de mai sus se schimbă abia când
  // efectul cheamă `load`, deci la prima randare cu B lista lui A ar fi
  // ajuns încă la AppRouter. Ieșirea hook-ului e mascată pe el (mai jos).
  const [listOwner, setListOwner] = useState<string | null>(null)

  // Întoarce lista încărcată (aceeași care ajunge în state) sau `null` când nu
  // s-a putut citi / a fost depășită de o cerere mai nouă — „Adaugă o locație"
  // (lotul A) verifică pe ea că locația nouă chiar e în listă.
  const load = useCallback(async (): Promise<Restaurant[] | null> => {
    const seq = ++loadSeqRef.current
    if (user && loadedForUserRef.current !== user.id) {
      if (loadedForUserRef.current !== null) {
        setRestaurants([])
        initialFetchDoneRef.current = false
      }
      loadedForUserRef.current = user.id
      setListOwner(user.id)
    }
    if (!user) {
      loadedForUserRef.current = null
      setListOwner(null)
      setRestaurants([])
      setLoading(false)
      initialFetchDoneRef.current = false
      return null
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
    if (seq !== loadSeqRef.current) return null
    // `owned` e sursa principală de adevăr: dacă interogarea ei eșuează (blip
    // rețea / RLS timeout / 500), NU știm dacă userul are restaurante — arătăm
    // eroare, nu o listă goală (care ar trimite fals un owner la Onboarding).
    if (ownedRes.error) {
      setError(ownedRes.error.message)
      setLoading(false)
      return null
    }
    const owned = (ownedRes.data ?? []) as Restaurant[]
    // memberRes eșuat colapsat la „zero membership-uri" ar bloca un staff (fără
    // restaurante owned) la Onboarding pe un simplu blip. Dacă ownedul e gol și
    // membershipurile n-au putut fi citite, semnalăm eroare în loc de listă goală.
    if (memberRes.error && owned.length === 0) {
      setError(memberRes.error.message)
      setLoading(false)
      return null
    }
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
    const fv = getFounderView(user.id)
    if (fv && !seen.has(fv)) {
      const { data: fvRow, error: fvErr } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', fv)
        .maybeSingle()
      if (seq !== loadSeqRef.current) return null
      if (fvErr) {
        // Fără restaurantul vizitat în listă, DashboardPage ar cădea pe primul
        // restaurant PROPRIU sub bannerul de impersonare (banner/conținut
        // nepotrivite). Mai bine stare de eroare explicită decât cont greșit.
        setError(fvErr.message)
        setLoading(false)
        return null
      }
      if (fvRow) merged.push(fvRow as Restaurant)
    }
    if (seq !== loadSeqRef.current) return null
    setRestaurants(merged)
    setLoading(false)
    initialFetchDoneRef.current = true
    return merged
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
    // OPT-R2 (extinde OPT-5 pe categorii): rândul actualizat E în răspuns
    // (select() = paritate cu query-ul `owned` care e select('*')) — merge
    // local în loc de refetch integral owned+memberships. Zero rânduri = eroare
    // vizibilă (nu succes tăcut); load() pe eroare rămâne implicit prin apelant.
    if (!result.error && result.data) {
      setRestaurants((prev) =>
        prev.map((r) => (r.id === id ? (result.data as Restaurant) : r)),
      )
    }
    return result
  }
  // Aplică LOCAL o scriere făcută deja printr-un RPC (`save_floor_layout`,
  // mig 322 — harta nu mai trece prin `update()`), la fel cum `update()`
  // face merge cu rândul întors (OPT-R2), fără refetch de rețea. Un merge local
  // e determinist; un refetch ar lăsa copia VECHE exact când recitirea pică pe
  // un blip (load() întoarce null) — iar atunci următoarea salvare din editorul
  // remontat ar suprascrie harta mai nouă.
  const patchLocal = useCallback((id: string, patch: Partial<Restaurant>) => {
    setRestaurants((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])
  // useRestaurants.remove() retras: mig 096B REVOKE delete pe `restaurants`
  // pentru anon/authenticated. Ștergerea restaurantelor nu există în UI;
  // ar fi un flow admin separat, sub RPC dedicat dacă va apărea cândva.

  // Până când `load` a preluat noul cont, nicio listă (nici a contului vechi)
  // și stare de încărcare — nu o listă goală „încărcată”, care ar trimite
  // fals la Onboarding.
  const staleOwner = user != null && listOwner !== user.id
  return {
    restaurants: staleOwner ? EMPTY_RESTAURANTS : restaurants,
    loading: staleOwner ? true : loading,
    error: staleOwner ? null : error,
    refetch: load,
    create,
    update,
    patchLocal,
  }
}

const EMPTY_RESTAURANTS: Restaurant[] = []

export function useCategories(restaurantId: string | null) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Guard de secvență (ca useRestaurants): la schimbarea restaurantului pot fi
  // două load()-uri în zbor; fără token, răspunsul VECHI ar putea ateriza ultimul
  // și suprascrie cu categoriile restaurantului precedent (fără realtime/polling
  // care să auto-corecteze, meniul greșit persistă până la un create/update).
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    if (!restaurantId) {
      setCategories([])
      setLoading(false)
      return
    }
    const seq = ++loadSeqRef.current
    setError(null)
    const { data, error: err } = await supabase
      .from('categories')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('display_order')
    if (seq !== loadSeqRef.current) return
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
    // OPT-5: rândul actualizat E în răspuns — merge local (+ re-sort pe
    // display_order, invariantul lui load()), fără refetch integral.
    if (!r.error && r.data) {
      setCategories((prev) =>
        prev
          .map((c) => (c.id === id ? (r.data as Category) : c))
          .sort((a, b) => a.display_order - b.display_order),
      )
    }
    return r
  }
  // `.select('id')` + numărarea rândurilor: un DELETE refuzat de RLS NU dă
  // eroare (PostgREST: 200, zero rânduri), deci fără ea UI-ul arăta „Ștearsă"
  // pe o categorie care rămânea în bază (lib/userMessages.ts).
  const remove = async (id: string) => {
    const error = zeroRowsAsDenied(
      await supabase.from('categories').delete().eq('id', id).select('id'),
    )
    if (!error) await load()
    return { error }
  }

  const reorder = async (ordered: Category[]) => {
    const results = await Promise.all(
      ordered.map((c, i) =>
        supabase.from('categories').update({ display_order: i }).eq('id', c.id),
      ),
    )
    // Dacă vreun update a eșuat, ordinea optimistă din UI ar diverge de DB
    // (unele rânduri actualizate, altele nu). Resincronizăm din server în loc
    // să afișăm o stare pe jumătate aplicată.
    if (results.some((r) => r.error)) {
      await load()
      return
    }
    setCategories(ordered.map((c, i) => ({ ...c, display_order: i })))
  }

  return { categories, loading, error, refetch: load, create, update, remove, reorder }
}

export function useProducts(restaurantId: string | null) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Guard de secvență (ca useRestaurants/useCategories): răspunsul unui load()
  // vechi nu mai suprascrie produsele restaurantului curent la schimbare rapidă.
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    if (!restaurantId) {
      setProducts([])
      setLoading(false)
      return
    }
    const seq = ++loadSeqRef.current
    setError(null)
    const { data, error: err } = await supabase
      .from('products')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('display_order')
    if (seq !== loadSeqRef.current) return
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
    const safe = pickAllowed(form, PRODUCT_INSERT_FIELDS)
    const r = await supabase
      .from('products')
      .insert({ ...safe, restaurant_id: restaurantId, display_order: maxOrder + 1 })
      .select()
      .single()
    if (!r.error) await load()
    return r
  }
  // OPT-5: update/toggle primesc rândul actualizat prin .select().single() —
  // merge local (+ re-sort pe display_order) în loc de refetch integral
  // select('*') al întregii liste (sute de rânduri cu jsonb) per operație.
  // load() rămâne pe create/remove (resincronizare completă) și ca refetch
  // pentru scrierile externe (AiBulkGenerate/CSV import).
  const mergeRow = (row: Product) => {
    setProducts((prev) =>
      prev
        .map((p) => (p.id === row.id ? row : p))
        .sort((a, b) => a.display_order - b.display_order),
    )
  }
  // Fără `is_sold_out` (PRODUCT_UPDATE_FIELDS, mig 313): „Epuizat” trece doar
  // prin toggleSoldOut, ca un formular cu date vechi să nu deblocheze tăcut un
  // produs epuizat din stoc între timp.
  const update = async (id: string, form: Partial<Product>) => {
    const safe = pickAllowed(form, PRODUCT_UPDATE_FIELDS)
    const r = await supabase.from('products').update(safe).eq('id', id).select().single()
    if (!r.error && r.data) mergeRow(r.data as Product)
    return r
  }
  // OPT-5: import în LOT (AI import) — UN singur INSERT pentru N produse
  // (display_order incremental din maxOrder) + UN singur load() la final,
  // în loc de N×(insert + refetch integral) — ~100 RTT-uri → 2 la 50 produse.
  const createMany = async (forms: Partial<Product>[]) => {
    const maxOrder = products.reduce((m, p) => Math.max(m, p.display_order), -1)
    const rows = forms.map((form, i) => ({
      ...pickAllowed(form, PRODUCT_INSERT_FIELDS),
      restaurant_id: restaurantId,
      display_order: maxOrder + 1 + i,
    }))
    const r = await supabase.from('products').insert(rows).select()
    if (!r.error) await load()
    return r
  }
  // Ca la categorii: 0 rânduri șterse = refuz de drepturi, nu „Șters".
  const remove = async (id: string) => {
    const error = zeroRowsAsDenied(
      await supabase.from('products').delete().eq('id', id).select('id'),
    )
    if (!error) await load()
    return { error }
  }
  // FĂRĂ `.single()`: pe un UPDATE refuzat de RLS (0 rânduri) `.single()` dă
  // PGRST116 în engleză („JSON object requested, multiple (or no) rows
  // returned"), afișat ospătarului care marca „Epuizat". Numărăm rândurile și
  // dăm refuzul de drepturi în română. `.select()` întreg (nu doar `id`):
  // rândul actualizat alimentează merge-ul local.
  const toggleProductFlag = async (
    id: string,
    patch: { is_active: boolean } | { is_sold_out: boolean } | { is_daily_special: boolean },
  ) => {
    const r = await supabase.from('products').update(patch).eq('id', id).select()
    const error = zeroRowsAsDenied(r)
    const row = !error && r.data ? (r.data[0] as Product) : null
    if (row) mergeRow(row)
    return { data: row, error }
  }
  // Activ/inactiv, epuizat și specialitatea zilei: aceeași regulă.
  const toggleActive = async (id: string, current: boolean) =>
    toggleProductFlag(id, { is_active: !current })
  // „Epuizat” trece prin RPC-ul personalului (mig 313), ca sursa (manual vs.
  // din stoc) să fie scrisă la fel din ProductsTab și din panoul ospătarului.
  // Pe o bază fără 313 (PGRST202) cade pe UPDATE-ul direct de dinainte.
  const toggleSoldOut = async (
    id: string,
    current: boolean,
  ): Promise<{ data: Product | null; error: { message: string; code: string } | null }> => {
    try {
      const state = await setProductSoldOut(id, !current)
      const prev = products.find((p) => p.id === id)
      const row = prev ? { ...prev, ...state } : null
      // Contopire FUNCȚIONALĂ, doar pe cele două câmpuri: după un update() din
      // formular, `products` din closure e încă rândul VECHI, iar `mergeRow(row)`
      // ar fi readus descrierea de dinainte de salvare în listă.
      setProducts((list) => list.map((p) => (p.id === id ? { ...p, ...state } : p)))
      return { data: row, error: null }
    } catch (e) {
      if (isMissingSoldOutRpc(e)) return toggleProductFlag(id, { is_sold_out: !current })
      const err = e as { message?: unknown; code?: unknown }
      return {
        data: null,
        error: {
          message: typeof err.message === 'string' ? err.message : '',
          code: typeof err.code === 'string' ? err.code : '',
        },
      }
    }
  }
  const toggleDailySpecial = async (id: string, current: boolean) =>
    toggleProductFlag(id, { is_daily_special: !current })

  return {
    products,
    loading,
    error,
    refetch: load,
    create,
    createMany,
    update,
    remove,
    toggleActive,
    toggleSoldOut,
    toggleDailySpecial,
  }
}

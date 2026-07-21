import { useState, useEffect, lazy, Suspense } from 'react'
import { useProducts, useCategories } from '../hooks/useData'
import type { Product, Category } from '../hooks/useData'
import { usePlanLimits } from '../hooks/usePlanLimits'
import { useIsMobile } from '../hooks/useIsMobile'
import { supabase } from '../lib/supabase'
import { D, DIETARY_TAGS, ALLERGENS } from '../lib/constants'
import { MENU_LANGS } from '../lib/i18nMenu'
import { fetchVatRates } from '../lib/vat'
import type { VatRate } from '../lib/vat'
import {
  fetchIngredients,
  fetchRecipesForProduct,
  setRecipeItem,
  removeRecipeItem,
} from '../lib/stocks'
import type { Ingredient as StocksIngredient, Recipe as StocksRecipe } from '../lib/stocks'
import { QueryError } from './PageLoader'
import { btn, inp, useToast, Toast, Modal, Inp, Sel, Toggle } from './_dashboard/sharedUI'
import { generateNutrition, generateProductImage } from '../lib/ai'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { Spinner } from './ui/Spinner'

const ProductsCsvImport = lazy(() => import('./ProductsCsvImport'))
const AiMenuImport = lazy(() => import('./AiMenuImport'))
const AiBulkGenerate = lazy(() => import('./AiBulkGenerate'))

// ── Product Modal ─────────────────────────────────────────────
function ProductModal({
  product,
  categories,
  onSave,
  onClose,
  restaurantId,
  userId,
  menuLanguages,
}: {
  product: Product | null
  categories: Category[]
  onSave: (f: Partial<Product>) => void | Promise<void>
  onClose: () => void
  restaurantId: string
  userId: string
  menuLanguages: string[]
}) {
  const isMobile = useIsMobile()
  // Scroll-lock-ul e gestionat acum de <Modal> (sharedUI) — nu-l mai dublăm aici.
  const [uploading, setUploading] = useState(false)
  // Anti dublu-submit: al doilea click pe conexiune lentă crea produs duplicat.
  const [saving, setSaving] = useState(false)
  const [imgPreview, setImgPreview] = useState<string | null>(product?.image_url || null)
  // Toast local pentru erori din modal (extras/pereche/rețetă/imagine) — înainte
  // erau înghițite silențios (doar console.error), owner-ul nu afla că salvarea a picat.
  const { toasts: pmToasts, toast: pmToast } = useToast()

  async function handleImageUpload(file: File) {
    if (!file || uploading) return
    // Validare client tip + dimensiune înainte de decode/resize pe canvas (eroare prietenoasă).
    if (!file.type.startsWith('image/')) {
      pmToast('Te rugăm încarcă un fișier imagine (JPG, PNG, WEBP).', 'error')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      pmToast('Imaginea e prea mare (max 10MB). Comprim-o și reîncearcă.', 'error')
      return
    }
    setUploading(true)
    try {
      // Client-side resize
      const canvas = document.createElement('canvas')
      const ctx2d = canvas.getContext('2d')!
      const img = new Image()
      const url = URL.createObjectURL(file)
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej()
        img.src = url
      })
      const maxW = 1200
      const scale = img.width > maxW ? maxW / img.width : 1
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      const blob = await new Promise<Blob>((res) =>
        canvas.toBlob((b) => res(b!), 'image/webp', 0.85),
      )
      // OPT-6: al DOILEA blob de ~320px pentru thumbnail-uri — cardurile de
      // listă (88px) și coșul (52px) descărcau originalul de 1200px
      // (~150-400KB) pentru fiecare poză; thumb-ul e ~20KB. Convenție de nume
      // {uuid}_t.webp lângă original (thumbUrlFor din lib/images derivă URL-ul;
      // fallback onError la original acoperă toate imaginile vechi — fără
      // migrație DB, fără coloană nouă).
      const thumbW = 320
      const tScale = canvas.width > thumbW ? thumbW / canvas.width : 1
      const tCanvas = document.createElement('canvas')
      tCanvas.width = Math.round(canvas.width * tScale)
      tCanvas.height = Math.round(canvas.height * tScale)
      tCanvas.getContext('2d')!.drawImage(canvas, 0, 0, tCanvas.width, tCanvas.height)
      const thumbBlob = await new Promise<Blob>((res) =>
        tCanvas.toBlob((b) => res(b!), 'image/webp', 0.8),
      )
      const baseName = crypto.randomUUID()
      const path = userId + '/' + restaurantId + '/' + baseName + '.webp'
      const thumbPath = userId + '/' + restaurantId + '/' + baseName + '_t.webp'
      const { error } = await supabase.storage
        .from('product-images')
        .upload(path, blob, { contentType: 'image/webp' })
      if (error) throw error
      // Thumb-ul e best-effort: dacă upload-ul lui pică, cardurile cad oricum
      // pe original prin fallback-ul onError — nu blocăm salvarea produsului.
      const { error: thumbErr } = await supabase.storage
        .from('product-images')
        .upload(thumbPath, thumbBlob, { contentType: 'image/webp' })
      if (thumbErr) console.warn('Thumb upload failed (fallback pe original):', thumbErr.message)
      const {
        data: { publicUrl },
      } = supabase.storage.from('product-images').getPublicUrl(path)
      setImgPreview(publicUrl)
      // Upload manual = imagine reală a owner-ului → scoatem marcajul „AI".
      setForm((f) => ({
        ...f,
        image_url: publicUrl,
        ai_generated_fields: (f.ai_generated_fields ?? []).filter((x) => x !== 'image_url'),
      }))
    } catch (e) {
      console.error('Upload failed', e)
      pmToast(
        'Încărcarea imaginii a eșuat: ' + (e instanceof Error ? e.message : 'reîncearcă'),
        'error',
      )
    }
    setUploading(false)
  }

  function removeImage() {
    setImgPreview(null)
    // La ștergere manuală, scoatem și marcajul „generat de AI" pentru imagine.
    setForm((f) => ({
      ...f,
      image_url: null,
      ai_generated_fields: (f.ai_generated_fields ?? []).filter((x) => x !== 'image_url'),
    }))
  }

  const [form, setForm] = useState<Partial<Product>>(
    product || {
      name: '',
      price: 0,
      emoji: '🍽️',
      is_active: true,
      is_draft: false,
      is_daily_special: false,
      is_sold_out: false,
      allergens: [],
      dietary_tags: [],
      prep_time_minutes: null,
      portion_size: null,
      vat_group: 1,
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      ai_generated_fields: [],
    },
  )

  // ── AI: generare imagine + nutriție ──────────────────────────
  // Câmpurile generate de AI sunt marcate în form.ai_generated_fields și
  // afișează badge „verifică"; editarea manuală a unui câmp îl scoate din listă.
  const aiFields = form.ai_generated_fields ?? []
  const isAiField = (f: string) => aiFields.includes(f)
  const clearAiFlag = (f: string) =>
    setForm((prev) => ({
      ...prev,
      ai_generated_fields: (prev.ai_generated_fields ?? []).filter((x) => x !== f),
    }))
  const markAiFields = (fields: string[]) =>
    setForm((prev) => ({
      ...prev,
      ai_generated_fields: Array.from(new Set([...(prev.ai_generated_fields ?? []), ...fields])),
    }))
  const [aiNutriBusy, setAiNutriBusy] = useState(false)
  const [aiImgBusy, setAiImgBusy] = useState(false)
  // Alergenii sugerați de AI NU se aplică automat (răspundere legală EU 1169/2011)
  // — rămân sugestii pe care owner-ul le confirmă manual prin click.
  const [aiAllergenSuggestions, setAiAllergenSuggestions] = useState<string[]>([])

  async function handleGenerateNutrition() {
    if (!form.name?.trim()) {
      pmToast('Adaugă întâi numele produsului.', 'error')
      return
    }
    setAiNutriBusy(true)
    try {
      const catName = categories.find((c) => c.id === form.category_id)?.name ?? null
      const n = await generateNutrition({
        restaurant_id: restaurantId,
        name: form.name.trim(),
        description: form.description ?? null,
        category: catName,
      })
      setForm((prev) => ({
        ...prev,
        calories: n.calories,
        protein_g: n.protein_g,
        carbs_g: n.carbs_g,
        fat_g: n.fat_g,
        // Tag-urile dietetice (vegan etc.) sunt comerciale, nu safety-critical → le sugerăm direct.
        dietary_tags: Array.from(new Set([...(prev.dietary_tags ?? []), ...n.dietary_tags])),
      }))
      const marked = ['calories', 'protein_g', 'carbs_g', 'fat_g']
      if (n.dietary_tags.length) marked.push('dietary_tags')
      markAiFields(marked)
      // Alergenii: DOAR sugestii de confirmat manual (nu se publică fără click explicit).
      setAiAllergenSuggestions(n.allergens)
      pmToast('Valori generate de AI — verifică-le. Alergenii necesită confirmare manuală.', 'success')
    } catch (e) {
      pmToast(e instanceof Error ? e.message : 'Eroare la generarea nutriției.', 'error')
    } finally {
      setAiNutriBusy(false)
    }
  }

  async function handleGenerateImage() {
    if (!product?.id) {
      pmToast('Salvează întâi produsul, apoi generează imaginea.', 'error')
      return
    }
    setAiImgBusy(true)
    try {
      const catName = categories.find((c) => c.id === form.category_id)?.name ?? null
      const { image_url } = await generateProductImage({
        restaurant_id: restaurantId,
        product_id: product.id,
        name: (form.name ?? product.name ?? '').trim(),
        description: form.description ?? null,
        category: catName,
      })
      setImgPreview(image_url)
      setForm((prev) => ({ ...prev, image_url }))
      markAiFields(['image_url'])
      pmToast('Imagine generată de AI — verifică-o.', 'success')
    } catch (e) {
      pmToast(e instanceof Error ? e.message : 'Eroare la generarea imaginii.', 'error')
    } finally {
      setAiImgBusy(false)
    }
  }
  const [showOptional, setShowOptional] = useState(false)
  const [vatRates, setVatRates] = useState<VatRate[]>([])
  useEffect(() => {
    void fetchVatRates(restaurantId)
      .then(setVatRates)
      .catch((err) => console.error('VAT rates load:', err))
  }, [restaurantId])
  const [showUpsell, setShowUpsell] = useState(false)
  const [extras, setExtras] = useState<
    Array<{
      id: string
      name: string
      price: number
      emoji: string | null
      display_order: number
      is_available: boolean
    }>
  >([])
  const [pairings, setPairings] = useState<
    Array<{ id: string; paired_product_id: string; display_order: number }>
  >([])
  const [allProducts, setAllProducts] = useState<
    Array<{ id: string; name: string; emoji: string; price: number }>
  >([])
  const [upsellLoading, setUpsellLoading] = useState(false)

  // Load extras + pairings when editing existing product
  useEffect(() => {
    if (!product?.id) {
      return
    }
    setUpsellLoading(true)
    void (async () => {
      const [extrasRes, pairingsRes, prodsRes] = await Promise.all([
        supabase
          .from('product_extras')
          .select('id,name,price,emoji,display_order,is_available')
          .eq('product_id', product.id)
          .order('display_order'),
        supabase
          .from('product_pairings')
          .select('id,paired_product_id,display_order')
          .eq('product_id', product.id)
          .order('display_order'),
        supabase
          .from('products')
          .select('id,name,emoji,price')
          .eq('restaurant_id', restaurantId)
          .eq('is_active', true)
          .neq('id', product.id)
          .order('name'),
      ])
      if (!extrasRes.error && extrasRes.data)
        setExtras(extrasRes.data.map((e) => ({ ...e, price: Number(e.price) })))
      if (!pairingsRes.error && pairingsRes.data) setPairings(pairingsRes.data)
      if (!prodsRes.error && prodsRes.data)
        setAllProducts(prodsRes.data.map((p) => ({ ...p, price: Number(p.price) })))
      setUpsellLoading(false)
    })()
  }, [product?.id, restaurantId])

  async function addExtra(name: string, price: number, emoji: string) {
    if (!product?.id || name.length === 0) return
    const newOrder = extras.length === 0 ? 0 : Math.max(...extras.map((e) => e.display_order)) + 1
    const { data, error } = await supabase
      .from('product_extras')
      .insert({
        product_id: product.id,
        name: name.trim(),
        price,
        emoji: emoji.length > 0 ? emoji : null,
        display_order: newOrder,
        is_available: true,
      })
      .select()
      .single()
    if (!error && data) setExtras((prev) => [...prev, { ...data, price: Number(data.price) }])
    else if (error) pmToast('Nu am putut adăuga extra-ul: ' + error.message, 'error')
  }

  async function removeExtra(id: string) {
    const { error } = await supabase.from('product_extras').delete().eq('id', id)
    if (!error) setExtras((prev) => prev.filter((e) => e.id !== id))
    else pmToast('Nu am putut șterge extra-ul: ' + error.message, 'error')
  }

  // ── Recipe state (gestiune ingredients) ─────────
  const [showRecipe, setShowRecipe] = useState(false)
  const [recipeRows, setRecipeRows] = useState<StocksRecipe[]>([])
  const [allIngredients, setAllIngredients] = useState<StocksIngredient[]>([])
  const [recipeLoading, setRecipeLoading] = useState(false)

  useEffect(() => {
    if (!product?.id) {
      return
    }
    setRecipeLoading(true)
    void (async () => {
      try {
        const [recipes, ingredients] = await Promise.all([
          fetchRecipesForProduct(product.id),
          fetchIngredients(restaurantId),
        ])
        setRecipeRows(recipes)
        setAllIngredients(ingredients)
      } catch (err) {
        console.error('Recipe load error:', err)
      }
      setRecipeLoading(false)
    })()
  }, [product?.id, restaurantId])

  async function setRecipeQty(ingredientId: string, quantity: number) {
    if (!product?.id) return
    if (quantity <= 0) return
    try {
      await setRecipeItem(product.id, ingredientId, quantity)
      const refreshed = await fetchRecipesForProduct(product.id)
      setRecipeRows(refreshed)
    } catch (err) {
      pmToast(
        'Nu am putut salva rețeta: ' + (err instanceof Error ? err.message : 'eroare necunoscută'),
        'error',
      )
    }
  }

  async function deleteRecipeItem(ingredientId: string) {
    if (!product?.id) return
    try {
      await removeRecipeItem(product.id, ingredientId)
      setRecipeRows((prev) => prev.filter((r) => r.ingredient_id !== ingredientId))
    } catch (err) {
      pmToast(
        'Nu am putut șterge ingredientul: ' +
          (err instanceof Error ? err.message : 'eroare necunoscută'),
        'error',
      )
    }
  }

  async function togglePairing(pairedId: string) {
    if (!product?.id) return
    const existing = pairings.find((p) => p.paired_product_id === pairedId)
    if (existing) {
      const { error } = await supabase.from('product_pairings').delete().eq('id', existing.id)
      if (!error) setPairings((prev) => prev.filter((p) => p.id !== existing.id))
      else pmToast('Nu am putut elimina perechea: ' + error.message, 'error')
    } else {
      if (pairings.length >= 3) return // limit 3 pairings
      const newOrder =
        pairings.length === 0 ? 0 : Math.max(...pairings.map((p) => p.display_order)) + 1
      const { data, error } = await supabase
        .from('product_pairings')
        .insert({ product_id: product.id, paired_product_id: pairedId, display_order: newOrder })
        .select()
        .single()
      if (!error && data) setPairings((prev) => [...prev, data])
      else if (error) pmToast('Nu am putut adăuga perechea: ' + error.message, 'error')
    }
  }
  const upd = (k: keyof Product, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  // ── Traduceri manuale (opționale) ────────────────────────────
  // Scriu în form.translations[code].{name,description}. Câmpurile goale sunt
  // eliminate ca să nu bloateze jsonb-ul; clientul face fallback la 'ro'.
  const [showTranslations, setShowTranslations] = useState(false)
  const setTranslation = (code: string, field: 'name' | 'description', value: string) =>
    setForm((f) => {
      const prev = f.translations ?? {}
      const entry = { ...(prev[code] ?? {}) }
      if (value.length === 0) delete entry[field]
      else entry[field] = value
      const next = { ...prev }
      if (Object.keys(entry).length === 0) delete next[code]
      else next[code] = entry
      return { ...f, translations: next }
    })
  // Numărul de limbi cu cel puțin o traducere completată (pentru contorul din header).
  const translatedCount = menuLanguages.filter(
    (code) =>
      (form.translations?.[code]?.name ?? '').length > 0 ||
      (form.translations?.[code]?.description ?? '').length > 0,
  ).length

  // Allergen toggle helpers — orice editare manuală scoate flag-ul „AI".
  const toggleAllergen = (id: string) => {
    setForm((f) => ({
      ...f,
      allergens: (f.allergens || []).includes(id)
        ? (f.allergens || []).filter((a) => a !== id)
        : [...(f.allergens || []), id],
    }))
    clearAiFlag('allergens')
  }
  const toggleDiet = (id: string) => {
    setForm((f) => ({
      ...f,
      dietary_tags: (f.dietary_tags || []).includes(id)
        ? (f.dietary_tags || []).filter((d) => d !== id)
        : [...(f.dietary_tags || []), id],
    }))
    clearAiFlag('dietary_tags')
  }
  return (
    <Modal title={product ? 'Editează produs' : 'Adaugă produs'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            Nume *
          </label>
          <Inp
            value={form.name || ''}
            onChange={(v) => upd('name', v)}
            placeholder="Spaghete Carbonara"
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
              Preț (lei) *
            </label>
            <Inp
              value={form.price != null ? String(form.price) : ''}
              onChange={(v) => upd('price', v.trim() === '' ? 0 : parseFloat(v) || 0)}
              type="number"
              placeholder="32.00"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
              Categorie
            </label>
            <Sel value={form.category_id || ''} onChange={(v) => upd('category_id', v)}>
              <option value="">Fără categorie</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </Sel>
          </div>
        </div>

        {/* TVA selector — folosește cotele configurate de owner în Settings */}
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            Cotă TVA
          </label>
          {vatRates.length === 0 ? (
            <div
              style={{
                fontSize: '0.74rem',
                color: D.t3,
                padding: '10px 12px',
                background: D.s3,
                borderRadius: 7,
              }}
            >
              Se încarcă cotele TVA...
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 6 }}>
                {vatRates.map((rate) => {
                  const isSel = (form.vat_group ?? 1) === rate.vat_group
                  return (
                    <button
                      key={rate.vat_group}
                      type="button"
                      onClick={() => upd('vat_group', rate.vat_group)}
                      style={btn({
                        background: isSel ? D.goldA : D.s3,
                        color: isSel ? D.gold : D.t2,
                        border: `1px solid ${isSel ? D.gold : D.border}`,
                        height: 56,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        padding: '6px 4px',
                      })}
                    >
                      <span
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 700,
                          fontFamily: 'Fraunces,serif',
                        }}
                      >
                        {rate.rate_percent}%
                      </span>
                      <span
                        style={{
                          fontSize: '0.62rem',
                          opacity: 0.85,
                          fontWeight: 500,
                          lineHeight: 1.1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '100%',
                        }}
                      >
                        {rate.label}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 5, lineHeight: 1.5 }}>
                {(() => {
                  const r = vatRates.find((r) => r.vat_group === (form.vat_group ?? 1))
                  return r?.description ?? 'Configurabil în Setări → Cote TVA'
                })()}
              </div>
            </>
          )}
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            Descriere
          </label>
          <textarea
            value={form.description || ''}
            onChange={(e) => upd('description', e.target.value)}
            placeholder="Descriere produs..."
            rows={3}
            style={{ ...inp, height: 'auto', resize: 'vertical' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            Status
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10 }}>
            {(
              [
                ['is_active', 'Activ', 'Apare în meniu'],
                ['is_daily_special', 'Specialitate', '⭐ apare evidențiat'],
                ['is_sold_out', 'Epuizat', 'Afișat dezactivat'],
              ] as [keyof Product, string, string][]
            ).map(([k, l, desc]) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  background: D.s3,
                  borderRadius: 9,
                  padding: '10px 12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: '0.82rem', color: D.t2, fontWeight: 500 }}>{l}</span>
                  <Toggle value={!!form[k]} onChange={(v) => upd(k, v)} />
                </div>
                <span style={{ fontSize: '0.66rem', color: D.t3, lineHeight: 1.3 }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Image upload */}
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}>
            Imagine produs
          </label>
          {imgPreview ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={imgPreview}
                alt="Preview"
                style={{
                  width: 120,
                  height: 120,
                  objectFit: 'cover',
                  borderRadius: 10,
                  border: `1px solid ${D.border}`,
                }}
              />
              <button
                onClick={removeImage}
                aria-label="Elimină imaginea"
                title="Elimină imaginea"
                style={{
                  position: 'absolute',
                  top: -8,
                  right: -8,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: D.red,
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                x
              </button>
            </div>
          ) : (
            <label
              role="button"
              tabIndex={0}
              aria-label="Încarcă imagine produs"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.currentTarget.querySelector('input')?.click()
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 120,
                height: 120,
                borderRadius: 10,
                border: `2px dashed ${D.border}`,
                cursor: uploading ? 'wait' : 'pointer',
                color: D.t3,
                fontSize: '0.8rem',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleImageUpload(f)
                }}
                disabled={uploading}
              />
              {uploading ? 'Se încarcă...' : '+ Imagine'}
            </label>
          )}
          {/* Generare imagine cu AI (doar OpenAI/Gemini; necesită produs salvat) */}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => void handleGenerateImage()}
              disabled={aiImgBusy || !product?.id}
              title={!product?.id ? 'Salvează întâi produsul' : 'Generează o imagine cu AI'}
              style={btn({
                background: 'transparent',
                color: D.gold,
                border: `1px solid ${D.gold}55`,
                height: 34,
                fontSize: '0.78rem',
                padding: '0 12px',
                opacity: aiImgBusy || !product?.id ? 0.5 : 1,
              })}
            >
              {aiImgBusy ? 'Se generează…' : '✨ Generează imagine'}
            </button>
            {isAiField('image_url') && (
              <span style={{ display: 'inline-block', marginLeft: 8, fontSize: '0.68rem', color: D.amber }}>
                ✨ generată de AI — verifică
              </span>
            )}
          </div>
        </div>
        {/* Taguri dietetice */}
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 4 }}>
            Etichete dietetice
            {isAiField('dietary_tags') && (
              <span style={{ marginLeft: 8, fontSize: '0.68rem', color: D.amber }}>✨ sugerat de AI — verifică</span>
            )}
          </label>
          <div style={{ fontSize: '0.7rem', color: D.t3, marginBottom: 8, lineHeight: 1.5 }}>
            Opțional. Ajută clienții să găsească produse potrivite cu
            dieta lor (vegetarian, picant, etc).
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {DIETARY_TAGS.map((tag) => {
              const active = (form.dietary_tags || []).includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleDiet(tag.id)}
                  aria-pressed={active}
                  style={{
                    minHeight: isMobile ? 44 : undefined,
                    padding: '4px 10px',
                    borderRadius: 100,
                    fontSize: '0.75rem',
                    fontFamily: 'DM Sans,sans-serif',
                    cursor: 'pointer',
                    outline: 'none',
                    background: active ? tag.color + '22' : 'transparent',
                    color: active ? tag.color : D.t3,
                    border: `1px solid ${active ? tag.color + '55' : D.border}`,
                    fontWeight: active ? 600 : 400,
                    transition: 'all .15s',
                  }}
                >
                  {tag.emoji} {tag.label}
                </button>
              )
            })}
          </div>
        </div>
        {/* Alergeni EU 1169/2011 */}
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 4 }}>
            Alergeni
          </label>
          <div style={{ fontSize: '0.7rem', color: D.t3, marginBottom: 8, lineHeight: 1.5 }}>
            Bifează dacă produsul conține. Cerință legală (EU
            1169/2011) — protejează clienții cu alergii.
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))',
              gap: 5,
            }}
          >
            {ALLERGENS.map((a) => {
              const active = (form.allergens || []).includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAllergen(a.id)}
                  title={a.desc}
                  aria-pressed={active}
                  style={{
                    minHeight: isMobile ? 44 : undefined,
                    padding: '5px 8px',
                    borderRadius: 7,
                    fontSize: '0.75rem',
                    fontFamily: 'DM Sans,sans-serif',
                    cursor: 'pointer',
                    outline: 'none',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    background: active ? 'rgba(224,85,85,0.12)' : 'transparent',
                    color: active ? D.red : D.t3,
                    border: `1px solid ${active ? 'rgba(224,85,85,0.3)' : D.border}`,
                    fontWeight: active ? 600 : 400,
                    transition: 'all .15s',
                  }}
                >
                  <span>{a.emoji}</span>
                  <span>{a.label}</span>
                </button>
              )
            })}
          </div>
          {/* Sugestii AI de alergeni — de confirmat manual (NU se publică automat). */}
          {aiAllergenSuggestions.filter((id) => !(form.allergens || []).includes(id)).length > 0 && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: D.s3, border: `1px solid ${D.amber}44`, borderRadius: 8 }}>
              <div style={{ fontSize: '0.7rem', color: D.amber, marginBottom: 6, fontWeight: 600 }}>
                ✨ Sugerat de AI — confirmă doar ce e corect (răspundere legală):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {aiAllergenSuggestions
                  .filter((id) => !(form.allergens || []).includes(id))
                  .map((id) => {
                    const a = ALLERGENS.find((x) => x.id === id)
                    if (!a) return null
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          toggleAllergen(id) // confirmare explicită = adăugare în lista oficială
                          setAiAllergenSuggestions((prev) => prev.filter((x) => x !== id))
                        }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 100,
                          fontSize: '0.74rem',
                          fontFamily: 'DM Sans,sans-serif',
                          cursor: 'pointer',
                          background: 'transparent',
                          color: D.amber,
                          border: `1px dashed ${D.amber}88`,
                        }}
                      >
                        + {a.emoji} {a.label}
                      </button>
                    )
                  })}
              </div>
            </div>
          )}
          {(form.allergens || []).length > 0 && (
            <div
              style={{
                marginTop: 8,
                fontSize: '0.72rem',
                color: D.t3,
                padding: '6px 10px',
                background: D.s3,
                borderRadius: 7,
              }}
            >
              ⚠️ Conține:{' '}
              {(form.allergens || [])
                .map((id) => ALLERGENS.find((a) => a.id === id)?.label)
                .filter(Boolean)
                .join(', ')}
            </div>
          )}
        </div>

        {/* ── Traduceri (opțional, colapsabil) — doar dacă restaurantul are limbi ── */}
        {menuLanguages.length > 0 && (
          <div style={{ borderTop: `1px solid ${D.border}`, paddingTop: 14, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setShowTranslations((s) => !s)}
              style={{
                background: 'transparent',
                border: 'none',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                padding: '4px 0',
                color: D.t2,
                fontFamily: 'DM Sans,sans-serif',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    transform: showTranslations ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.15s',
                    display: 'inline-block',
                  }}
                >
                  ▸
                </span>
                <span>Traduceri</span>
                <span style={{ fontSize: '0.7rem', color: D.t3, fontWeight: 400 }}>(opțional)</span>
              </span>
              <span style={{ fontSize: '0.7rem', color: D.t3, fontWeight: 400 }}>
                {translatedCount}/{menuLanguages.length} limbi
              </span>
            </button>

            {showTranslations && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 14 }}>
                <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5 }}>
                  Numele și descrierea în alte limbi. Româna (originalul de sus) rămâne baza —
                  câmpurile lăsate goale afișează automat varianta în română.
                </div>
                {menuLanguages.map((code) => {
                  const meta = MENU_LANGS.find((l) => l.code === code)
                  const label = meta?.label ?? code.toUpperCase()
                  const entry = form.translations?.[code] ?? {}
                  return (
                    <div
                      key={code}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        padding: '12px 14px',
                        background: D.s3,
                        borderRadius: 9,
                        border: `1px solid ${D.border}`,
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: D.t1 }}>
                        {meta?.flag} {label}
                      </div>
                      <div>
                        <label
                          style={{
                            display: 'block',
                            fontSize: '0.74rem',
                            color: D.t2,
                            marginBottom: 5,
                          }}
                        >
                          Nume ({label})
                        </label>
                        <Inp
                          value={entry.name ?? ''}
                          onChange={(v) => setTranslation(code, 'name', v)}
                          placeholder={form.name || 'Nume produs'}
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            display: 'block',
                            fontSize: '0.74rem',
                            color: D.t2,
                            marginBottom: 5,
                          }}
                        >
                          Descriere ({label})
                        </label>
                        <textarea
                          value={entry.description ?? ''}
                          onChange={(e) => setTranslation(code, 'description', e.target.value)}
                          placeholder={form.description || 'Descriere produs'}
                          rows={2}
                          style={{ ...inp, height: 'auto', resize: 'vertical' }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Detalii suplimentare (opțional, colapsabil) ───────────── */}
        <div style={{ borderTop: `1px solid ${D.border}`, paddingTop: 14, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowOptional((s) => !s)}
            style={{
              background: 'transparent',
              border: 'none',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              padding: '4px 0',
              color: D.t2,
              fontFamily: 'DM Sans,sans-serif',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  transform: showOptional ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.15s',
                  display: 'inline-block',
                }}
              >
                ▸
              </span>
              <span>Detalii suplimentare</span>
              <span style={{ fontSize: '0.7rem', color: D.t3, fontWeight: 400 }}>(opțional)</span>
            </span>
            <span style={{ fontSize: '0.7rem', color: D.t3, fontWeight: 400 }}>
              {
                [
                  form.prep_time_minutes != null,
                  form.portion_size != null && form.portion_size.length > 0,
                  form.calories != null,
                  form.protein_g != null,
                  form.carbs_g != null,
                  form.fat_g != null,
                ].filter(Boolean).length
              }{' '}
              din 6 completate
            </span>
          </button>

          {showOptional && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                marginTop: 14,
                paddingLeft: 24,
              }}
            >
              {/* Timp pregătire + Porție */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                <div>
                  <label
                    style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
                  >
                    Timp pregătire
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Inp
                      value={form.prep_time_minutes == null ? '' : String(form.prep_time_minutes)}
                      onChange={(v) =>
                        upd('prep_time_minutes', v.length > 0 ? parseInt(v) || null : null)
                      }
                      type="number"
                      placeholder="15"
                    />
                    <span style={{ fontSize: '0.78rem', color: D.t3 }}>min</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 5 }}>
                    Apare ca ⏱️ ~15 min
                  </div>
                </div>

                <div>
                  <label
                    style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 5 }}
                  >
                    Cantitate / porție
                  </label>
                  <Inp
                    value={form.portion_size || ''}
                    onChange={(v) => upd('portion_size', v.length > 0 ? v : null)}
                    placeholder="350g"
                  />
                  <div style={{ fontSize: '0.7rem', color: D.t3, marginTop: 5 }}>
                    Ex: 350g, 500ml, 2 buc
                  </div>
                </div>
              </div>

              {/* ── Valori nutriționale (estimabile cu AI) ──────── */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
                  <label style={{ fontSize: '0.78rem', color: D.t2 }}>
                    Valori nutriționale
                    {(isAiField('calories') || isAiField('protein_g') || isAiField('carbs_g') || isAiField('fat_g')) && (
                      <span style={{ marginLeft: 8, fontSize: '0.68rem', color: D.amber }}>✨ estimate de AI — verifică</span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleGenerateNutrition()}
                    disabled={aiNutriBusy}
                    style={btn({
                      background: 'transparent',
                      color: D.gold,
                      border: `1px solid ${D.gold}55`,
                      height: 32,
                      fontSize: '0.76rem',
                      padding: '0 12px',
                      opacity: aiNutriBusy ? 0.5 : 1,
                    })}
                  >
                    {aiNutriBusy ? 'Se generează…' : '✨ Generează cu AI'}
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 10 }}>
                  {([
                    { key: 'calories', label: 'Calorii (kcal)', int: true },
                    { key: 'protein_g', label: 'Proteine (g)', int: false },
                    { key: 'carbs_g', label: 'Carbohidrați (g)', int: false },
                    { key: 'fat_g', label: 'Grăsimi (g)', int: false },
                  ] as const).map((nf) => (
                    <div key={nf.key}>
                      <label style={{ display: 'block', fontSize: '0.7rem', color: D.t3, marginBottom: 4 }}>{nf.label}</label>
                      <Inp
                        type="number"
                        value={form[nf.key] == null ? '' : String(form[nf.key])}
                        onChange={(v) => {
                          const parsed = v.length > 0 ? (nf.int ? parseInt(v) : parseFloat(v)) : NaN
                          upd(nf.key, Number.isFinite(parsed) ? parsed : null)
                          clearAiFlag(nf.key) // editare manuală → nu mai e „AI"
                        }}
                        placeholder="—"
                      />
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '0.68rem', color: D.t3, marginTop: 6 }}>
                  Valori per porție. Cele generate de AI sunt estimative — corectează-le dacă e nevoie.
                </div>
              </div>

              <div
                style={{
                  fontSize: '0.7rem',
                  color: D.t3,
                  padding: '10px 12px',
                  background: D.s3,
                  borderRadius: 7,
                  lineHeight: 1.55,
                }}
              >
                💡 <strong style={{ color: D.t2 }}>Aceste detalii sunt opționale.</strong> Apar în
                meniu doar dacă le completezi. Lasă goale dacă nu sunt relevante pentru produs.
              </div>
            </div>
          )}
        </div>

        {/* ── Upsell: Extras + Pereche (opțional, colapsabil) ──────── */}
        <div style={{ borderTop: `1px solid ${D.border}`, paddingTop: 14, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowUpsell((s) => !s)}
            style={{
              background: 'transparent',
              border: 'none',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              padding: '4px 0',
              color: D.t2,
              fontFamily: 'DM Sans,sans-serif',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  transform: showUpsell ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.15s',
                  display: 'inline-block',
                }}
              >
                ▸
              </span>
              <span>Extras & Pereche</span>
              <span style={{ fontSize: '0.7rem', color: D.t3, fontWeight: 400 }}>(opțional)</span>
            </span>
            <span style={{ fontSize: '0.7rem', color: D.t3, fontWeight: 400 }}>
              {extras.length} {extras.length === 1 ? 'extra' : 'extra-uri'} · {pairings.length}{' '}
              {pairings.length === 1 ? 'pereche' : 'perechi'}
            </span>
          </button>

          {showUpsell && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 14 }}>
              {!product?.id ? (
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: D.t2,
                    padding: '14px 16px',
                    background: D.s3,
                    borderRadius: 9,
                    lineHeight: 1.55,
                    border: `1px dashed ${D.border}`,
                  }}
                >
                  ℹ️ <strong>Salvează produsul mai întâi.</strong> După ce produsul este creat, poți
                  reveni aici pentru a adăuga extra-uri și produse pereche.
                </div>
              ) : upsellLoading ? (
                <div
                  style={{ fontSize: '0.78rem', color: D.t3, padding: '12px', textAlign: 'center' }}
                >
                  Se încarcă...
                </div>
              ) : (
                <>
                  {/* ── Extras (add-ons plătite la produs) ───────────── */}
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 6,
                      }}
                    >
                      <label style={{ fontSize: '0.82rem', fontWeight: 600, color: D.t1 }}>
                        💎 Extras (add-on plătite)
                      </label>
                      <span style={{ fontSize: '0.7rem', color: D.t3 }}>{extras.length} / 6</span>
                    </div>
                    <div
                      style={{ fontSize: '0.7rem', color: D.t3, marginBottom: 10, lineHeight: 1.5 }}
                    >
                      Adaos LA produs cu cost extra. Ex: „+5 lei brânză extra", „+3 lei bacon".
                      Clientul le bifează în fereastra produsului, înainte să adauge în coș.
                    </div>

                    {extras.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          marginBottom: 10,
                        }}
                      >
                        {extras.map((e) => (
                          <div
                            key={e.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '8px 12px',
                              background: D.s3,
                              borderRadius: 8,
                              border: `1px solid ${D.border}`,
                            }}
                          >
                            <span style={{ fontSize: '0.95rem' }}>{e.emoji || '💎'}</span>
                            <span style={{ flex: 1, fontSize: '0.85rem', color: D.t1 }}>
                              {e.name}
                            </span>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: D.gold }}>
                              +{e.price.toFixed(2)} lei
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                void removeExtra(e.id)
                              }}
                              aria-label={`Șterge extra-ul ${e.name}`}
                              title="Șterge"
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 6,
                                background: 'transparent',
                                border: `1px solid ${D.border}`,
                                color: D.red,
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {extras.length < 6 && <ExtraForm onAdd={addExtra} />}
                  </div>

                  {/* ── Pereche (sugestii după adăugarea în coș) ─────── */}
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 6,
                      }}
                    >
                      <label style={{ fontSize: '0.82rem', fontWeight: 600, color: D.t1 }}>
                        💡 Pereche (sugestii după adăugarea în coș)
                      </label>
                      <span style={{ fontSize: '0.7rem', color: D.t3 }}>{pairings.length} / 3</span>
                    </div>
                    <div
                      style={{ fontSize: '0.7rem', color: D.t3, marginBottom: 10, lineHeight: 1.5 }}
                    >
                      Produse care MERG BINE cu acesta. Apar ca pop-up după ce clientul adaugă în
                      coș. Ex: friptură → vin, cartofi pai.
                    </div>

                    {allProducts.length === 0 ? (
                      <div
                        style={{
                          fontSize: '0.7rem',
                          color: D.t3,
                          padding: '10px',
                          background: D.s3,
                          borderRadius: 7,
                          textAlign: 'center',
                        }}
                      >
                        Nu există alte produse active. Adaugă mai multe produse mai întâi.
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 5,
                          maxHeight: 200,
                          overflowY: 'auto',
                          border: `1px solid ${D.border}`,
                          borderRadius: 8,
                          padding: 6,
                          background: D.s3,
                        }}
                      >
                        {allProducts.map((p) => {
                          const isPaired = pairings.some((pr) => pr.paired_product_id === p.id)
                          const canAdd = isPaired || pairings.length < 3
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                if (canAdd) void togglePairing(p.id)
                              }}
                              disabled={!canAdd && !isPaired}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '7px 10px',
                                background: isPaired ? D.goldA : 'transparent',
                                border: `1px solid ${isPaired ? D.gold : 'transparent'}`,
                                borderRadius: 6,
                                cursor: canAdd ? 'pointer' : 'not-allowed',
                                opacity: !canAdd && !isPaired ? 0.4 : 1,
                                color: isPaired ? D.gold : D.t2,
                                fontSize: '0.78rem',
                                textAlign: 'left',
                              }}
                            >
                              <span
                                style={{
                                  width: 14,
                                  height: 14,
                                  borderRadius: 3,
                                  border: `1.5px solid ${isPaired ? D.gold : D.border}`,
                                  background: isPaired ? D.gold : 'transparent',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                {isPaired && (
                                  <span
                                    style={{
                                      color: '#000',
                                      fontSize: '0.7rem',
                                      fontWeight: 700,
                                      lineHeight: 1,
                                    }}
                                  >
                                    ✓
                                  </span>
                                )}
                              </span>
                              <span style={{ fontSize: '0.85rem' }}>{p.emoji}</span>
                              <span
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {p.name}
                              </span>
                              <span style={{ color: D.t3, fontSize: '0.72rem' }}>
                                {p.price.toFixed(2)} lei
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      fontSize: '0.7rem',
                      color: D.t3,
                      padding: '10px 12px',
                      background: D.s3,
                      borderRadius: 7,
                      lineHeight: 1.55,
                    }}
                  >
                    💡 <strong style={{ color: D.t2 }}>Diferența:</strong> Extras = adaos LA produs
                    (brânză extra). Pereche = produs SEPARAT sugerat (vin, salată).
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Rețetă (gestiune stocuri) ──────────────────────────────── */}
        <div style={{ borderTop: `1px solid ${D.border}`, paddingTop: 14, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowRecipe((s) => !s)}
            style={{
              background: 'transparent',
              border: 'none',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              padding: '4px 0',
              color: D.t2,
              fontFamily: 'DM Sans,sans-serif',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  transform: showRecipe ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.15s',
                  display: 'inline-block',
                }}
              >
                ▸
              </span>
              <span>Rețetă (ingrediente consumate)</span>
              <span style={{ fontSize: '0.7rem', color: D.t3, fontWeight: 400 }}>(opțional)</span>
            </span>
            <span style={{ fontSize: '0.7rem', color: D.t3, fontWeight: 400 }}>
              {recipeRows.length} ingrediente
            </span>
          </button>

          {showRecipe && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
              {!product?.id ? (
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: D.t2,
                    padding: '14px 16px',
                    background: D.s3,
                    borderRadius: 9,
                    lineHeight: 1.55,
                    border: `1px dashed ${D.border}`,
                  }}
                >
                  ℹ️ <strong>Salvează produsul mai întâi.</strong> După ce produsul e creat, poți
                  adăuga ingrediente în rețetă pentru a urmări costuri și stoc.
                </div>
              ) : recipeLoading ? (
                <div
                  style={{ fontSize: '0.78rem', color: D.t3, padding: '12px', textAlign: 'center' }}
                >
                  Se încarcă...
                </div>
              ) : allIngredients.length === 0 ? (
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: D.t2,
                    padding: '14px 16px',
                    background: D.s3,
                    borderRadius: 9,
                    lineHeight: 1.55,
                    border: `1px dashed ${D.border}`,
                  }}
                >
                  ℹ️ <strong>Nu ai ingrediente în stoc încă.</strong> Mergi la tab-ul Stocuri →
                  Ingrediente și adaugă-le pe cele folosite în acest produs.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5 }}>
                    Definește câte unități din fiecare ingredient se consumă pentru 1 bucată din
                    acest produs. La fiecare comandă plătită, sistemul scade automat din stoc.
                  </div>

                  {recipeRows.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {recipeRows.map((r) => {
                        const ing = allIngredients.find((i) => i.id === r.ingredient_id)
                        if (!ing) return null
                        return (
                          <div
                            key={r.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '8px 12px',
                              background: D.s3,
                              borderRadius: 8,
                              border: `1px solid ${D.border}`,
                            }}
                          >
                            <span style={{ fontSize: '1rem' }}>{ing.emoji ?? '🥬'}</span>
                            <span
                              style={{
                                flex: 1,
                                fontSize: '0.85rem',
                                color: D.t1,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {ing.name}
                            </span>
                            <span
                              style={{
                                fontSize: '0.78rem',
                                color: D.gold,
                                fontFamily: 'Fraunces,serif',
                                fontWeight: 600,
                              }}
                            >
                              {r.quantity} {ing.unit}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: D.t3 }}>
                              ({(r.quantity * ing.cost_per_unit).toFixed(2)} lei)
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                void deleteRecipeItem(r.ingredient_id)
                              }}
                              aria-label={`Șterge ingredientul ${ing.name}`}
                              title="Șterge"
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 6,
                                background: 'transparent',
                                border: `1px solid ${D.border}`,
                                color: D.red,
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <RecipeAddForm
                    ingredients={allIngredients.filter(
                      (i) => !recipeRows.some((r) => r.ingredient_id === i.id),
                    )}
                    onAdd={setRecipeQty}
                  />

                  {recipeRows.length > 0 && (
                    <div
                      style={{
                        padding: '10px 12px',
                        background: D.goldA,
                        border: `1px solid ${D.gold}33`,
                        borderRadius: 7,
                        fontSize: '0.75rem',
                        color: D.t1,
                        lineHeight: 1.55,
                      }}
                    >
                      💰 <strong>Cost total rețetă:</strong>{' '}
                      {recipeRows
                        .reduce((sum, r) => {
                          const ing = allIngredients.find((i) => i.id === r.ingredient_id)
                          return sum + (ing ? r.quantity * ing.cost_per_unit : 0)
                        }, 0)
                        .toFixed(2)}{' '}
                      lei
                      {form.price &&
                        form.price > 0 &&
                        (() => {
                          const cost = recipeRows.reduce((sum, r) => {
                            const ing = allIngredients.find((i) => i.id === r.ingredient_id)
                            return sum + (ing ? r.quantity * ing.cost_per_unit : 0)
                          }, 0)
                          const margin = ((form.price - cost) / form.price) * 100
                          return (
                            <span
                              style={{
                                marginLeft: 8,
                                color: margin > 60 ? D.green : margin > 30 ? D.gold : D.red,
                                fontWeight: 700,
                              }}
                            >
                              → marja {margin.toFixed(0)}%
                            </span>
                          )
                        })()}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
          <button
            onClick={onClose}
            style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
          >
            Anulează
          </button>
          <button
            onClick={async () => {
              if (saving || uploading) return
              setSaving(true)
              try {
                await onSave(form)
              } finally {
                setSaving(false)
              }
            }}
            disabled={uploading || saving}
            style={btn({ background: D.gold, color: '#000', opacity: uploading || saving ? 0.7 : 1 })}
          >
            {saving ? 'Se salvează…' : 'Salvează'}
          </button>
        </div>
      </div>
      <Toast toasts={pmToasts} />
    </Modal>
  )
}

// ── RecipeAddForm: inline form for adding ingredient to recipe ───
function RecipeAddForm({
  ingredients,
  onAdd,
}: {
  ingredients: StocksIngredient[]
  onAdd: (ingredientId: string, quantity: number) => void | Promise<void>
}) {
  const [selectedId, setSelectedId] = useState('')
  const [quantity, setQuantity] = useState('')

  function submit() {
    if (selectedId.length === 0 || quantity.length === 0) return
    const q = parseFloat(quantity)
    if (isNaN(q) || q <= 0) return
    void onAdd(selectedId, q)
    setSelectedId('')
    setQuantity('')
  }

  if (ingredients.length === 0) {
    return (
      <div
        style={{
          fontSize: '0.74rem',
          color: D.t3,
          padding: '10px',
          background: D.s3,
          borderRadius: 7,
          textAlign: 'center',
        }}
      >
        Toate ingredientele sunt deja adăugate la rețetă
      </div>
    )
  }

  const sel = ingredients.find((i) => i.id === selectedId)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 100px 70px',
        gap: 6,
        alignItems: 'center',
      }}
    >
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        style={{
          padding: '8px 10px',
          background: D.s3,
          border: `1px solid ${D.border}`,
          borderRadius: 7,
          color: D.t1,
          fontSize: '0.82rem',
          fontFamily: 'DM Sans,sans-serif',
          height: 36,
        }}
      >
        <option value="">Alege ingredient...</option>
        {ingredients.map((i) => (
          <option key={i.id} value={i.id}>
            {i.emoji ?? '🥬'} {i.name}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Inp value={quantity} onChange={setQuantity} type="number" placeholder="0" />
        <span style={{ fontSize: '0.7rem', color: D.t3, whiteSpace: 'nowrap' }}>
          {sel?.unit ?? ''}
        </span>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={selectedId.length === 0 || quantity.length === 0}
        style={btn({
          background: D.gold,
          color: '#000',
          height: 36,
          fontSize: '0.74rem',
          opacity: selectedId.length === 0 || quantity.length === 0 ? 0.5 : 1,
        })}
      >
        + Adaugă
      </button>
    </div>
  )
}

// ── ExtraForm: small inline form for adding a product extra ───────
function ExtraForm({
  onAdd,
}: {
  onAdd: (name: string, price: number, emoji: string) => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [emoji, setEmoji] = useState('')

  function submit() {
    if (name.trim().length === 0 || price.length === 0) return
    const p = parseFloat(price)
    if (isNaN(p) || p < 0) return
    void onAdd(name, p, emoji)
    setName('')
    setPrice('')
    setEmoji('')
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 1fr 80px 70px',
        gap: 6,
        alignItems: 'center',
      }}
    >
      <Inp value={emoji} onChange={setEmoji} placeholder="🧀" />
      <Inp value={name} onChange={setName} placeholder="Brânză extra" />
      <Inp value={price} onChange={setPrice} type="number" placeholder="5.00" />
      <button
        type="button"
        onClick={submit}
        disabled={name.trim().length === 0 || price.length === 0}
        style={btn({
          background: D.gold,
          color: '#000',
          height: 36,
          fontSize: '0.78rem',
          opacity: name.trim().length === 0 || price.length === 0 ? 0.5 : 1,
        })}
      >
        + Adaugă
      </button>
    </div>
  )
}

// ── Products Tab ──────────────────────────────────────────────
export default function ProductsTab({
  restaurantId,
  plan,
  onUpgrade,
  userId,
  menuLanguages = [],
}: {
  restaurantId: string
  plan: string
  onUpgrade: () => void
  userId: string
  menuLanguages?: string[]
}) {
  const [vatRates, setVatRates] = useState<VatRate[]>([])
  useEffect(() => {
    void fetchVatRates(restaurantId)
      .then(setVatRates)
      .catch(() => {})
  }, [restaurantId])
  const vatLabel = (g: number): string => {
    const r = vatRates.find((r) => r.vat_group === (g || 1))
    return r ? `${r.rate_percent}%` : `${g || 1}`
  }
  const { canAddProduct, limits } = usePlanLimits(plan)
  const {
    products,
    loading,
    error,
    create,
    update,
    remove,
    toggleActive,
    toggleSoldOut,
    toggleDailySpecial,
    refetch: refetchProducts,
  } = useProducts(restaurantId)
  const { categories, error: catError, refetch: refetchCats } = useCategories(restaurantId)
  const { toasts, toast } = useToast()
  const [modal, setModal] = useState<Product | 'add' | null>(null)
  const [delId, setDelId] = useState<string | null>(null)
  // id-ul produsului al cărui toggle activ/inactiv e în zbor — dezactivează
  // butonul respectiv cât timp requestul e pending, ca userul să nu dea click
  // de mai multe ori sau să rămână nesigur dacă a mers.
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [csvImportOpen, setCsvImportOpen] = useState(false)
  const [aiImportOpen, setAiImportOpen] = useState(false)
  const [aiBulkOpen, setAiBulkOpen] = useState(false)
  const [activeCat, setActiveCat] = useState('all')
  const [search, setSearch] = useState('')
  const canAdd = canAddProduct(products.length)
  const mob = useIsMobile()

  if (error || catError)
    return (
      <QueryError
        message={error || catError || 'Eroare necunoscută'}
        onRetry={() => {
          refetchProducts()
          refetchCats()
        }}
      />
    )

  const filtered = products
    .filter((p) => activeCat === 'all' || p.category_id === activeCat)
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))

  const handleSave = async (form: Partial<Product>) => {
    if (modal === 'add') {
      const { error: e } = await create(form)
      if (e) toast(e.message, 'error')
      else {
        toast('Produs adăugat')
        setModal(null)
      }
    } else if (modal) {
      const { error: e } = await update((modal as Product).id, form)
      if (e) toast(e.message, 'error')
      else {
        toast('Actualizat')
        setModal(null)
      }
    }
  }
  const handleDelete = async () => {
    if (!delId) return
    const { error: e } = await remove(delId)
    if (e) toast(e.message, 'error')
    else toast('Șters')
    setDelId(null)
  }
  const handleToggleActive = async (p: Product) => {
    setTogglingId(p.id)
    try {
      const { error } = await toggleActive(p.id, p.is_active)
      if (!error) toast(p.is_active ? 'Dezactivat' : 'Activat')
      else toast(error.message, 'error')
    } finally {
      setTogglingId(null)
    }
  }

  // ── Mobile: card layout. Desktop: table grid ──────────────
  const gridCols = mob ? '1fr auto' : '2fr 1fr 80px 80px 150px'

  return (
    <div>
      <Toast toasts={toasts} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: mob ? '1.25rem' : '1.5rem',
              color: D.t1,
              letterSpacing: '-0.02em',
            }}
          >
            Produse
          </h2>
          <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>
            {products.length} total · {products.filter((p) => p.is_active).length} active
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setAiBulkOpen(true)}
            aria-label="Generează AI pentru tot meniul"
            title="Generează imagini + nutriție cu AI pentru tot meniul"
            style={btn({
              background: D.s2,
              color: D.gold,
              border: `1px solid ${D.gold}55`,
              height: 44,
              fontSize: mob ? '0.78rem' : '0.85rem',
              padding: mob ? '0 10px' : '0 14px',
              gap: 6,
            })}
          >
            <Icon name="sparkle" size={16} />
            {mob ? 'AI' : 'Generează AI'}
          </button>
          <button
            onClick={() => setAiImportOpen(true)}
            aria-label="Import meniu din poză (AI)"
            title="Import meniu din poză (AI)"
            style={btn({
              background: D.s2,
              color: D.t1,
              border: `1px solid ${D.border}`,
              height: 44,
              fontSize: mob ? '0.78rem' : '0.85rem',
              padding: mob ? '0 10px' : '0 14px',
              gap: 6,
            })}
          >
            <Icon name="camera" size={16} />
            {mob ? 'Poză' : 'Import din poză'}
          </button>
          <button
            onClick={() => setCsvImportOpen(true)}
            aria-label="Import CSV"
            title="Import produse din fișier CSV"
            style={btn({
              background: D.s2,
              color: D.t1,
              border: `1px solid ${D.border}`,
              height: 44,
              fontSize: mob ? '0.78rem' : '0.85rem',
              padding: mob ? '0 10px' : '0 14px',
              gap: 6,
            })}
          >
            <Icon name="download" size={16} />
            {mob ? 'CSV' : 'Import CSV'}
          </button>
          <button
            onClick={() => {
              if (!canAdd) {
                onUpgrade()
                return
              }
              setModal('add')
            }}
            style={btn({
              background: canAdd ? D.gold : D.s3,
              color: canAdd ? '#000' : D.t2,
              border: canAdd ? 'none' : `1px solid ${D.border}`,
              height: 44,
              fontSize: mob ? '0.82rem' : '0.9rem',
              gap: 6,
            })}
          >
            {canAdd ? (
              '+ Adaugă produs'
            ) : (
              <>
                <Icon name="lock" size={16} />
                Limită atinsă — Upgrade
              </>
            )}
          </button>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 14,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Caută..."
          style={{
            ...inp,
            flex: '1 1 160px',
            maxWidth: mob ? '100%' : 260,
            height: 40,
            fontSize: '0.85rem',
          }}
        />
        {/* Chip-urile de categorie: strip cu scroll orizontal (nu se mai înghesuie
            pe ecrane înguste) + ținte de atingere ≥44px pentru mobil. */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            flex: '1 1 240px',
            minWidth: 0,
            paddingBottom: 2,
          }}
        >
          <button
            onClick={() => setActiveCat('all')}
            aria-pressed={activeCat === 'all'}
            style={btn({
              height: 44,
              padding: '0 14px',
              fontSize: '0.78rem',
              background: activeCat === 'all' ? D.goldA : D.s2,
              color: activeCat === 'all' ? D.goldL : D.t2,
              border: `1px solid ${activeCat === 'all' ? D.gold + '44' : D.border}`,
            })}
          >
            Toate
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              aria-pressed={activeCat === c.id}
              style={btn({
                height: 44,
                padding: '0 14px',
                fontSize: '0.78rem',
                background: activeCat === c.id ? D.goldA : D.s2,
                color: activeCat === c.id ? D.goldL : D.t2,
                border: `1px solid ${activeCat === c.id ? D.gold + '44' : D.border}`,
              })}
            >
              {c.emoji} {c.name}
            </button>
          ))}
        </div>
      </div>
      <div
        style={{
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        {/* Table header — hidden on mobile */}
        {!mob && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridCols,
              padding: '10px 20px',
              background: D.s3,
              borderBottom: `1px solid ${D.border}`,
            }}
          >
            {['Produs', 'Categorie', 'Preț', 'Status', 'Acțiuni'].map((h) => (
              <div
                key={h}
                style={{
                  fontSize: '0.7rem',
                  color: D.t3,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {h}
              </div>
            ))}
          </div>
        )}
        {loading ? (
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton variant="table-row" count={5} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={search ? 'search' : 'menu'}
            title={search ? 'Niciun produs găsit' : 'Niciun produs încă'}
            description={
              search
                ? 'Încearcă alt termen de căutare sau șterge filtrul.'
                : 'Adaugă primul produs din meniu — manual, din poză sau prin CSV.'
            }
            action={
              !search ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Icon name="plus" size={16} />}
                  onClick={() => {
                    if (!canAdd) {
                      onUpgrade()
                      return
                    }
                    setModal('add')
                  }}
                >
                  Adaugă produs
                </Button>
              ) : undefined
            }
          />
        ) : (
          filtered.map((p, i) =>
            mob ? (
              /* ── Mobile: compact card ── */
              <div
                key={p.id}
                style={{
                  padding: '12px 14px',
                  borderBottom: i < filtered.length - 1 ? `1px solid ${D.border}` : 'none',
                  opacity: p.is_sold_out ? 0.5 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: D.s4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1rem',
                      flexShrink: 0,
                    }}
                  >
                    {p.emoji}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                    >
                      <span style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 500 }}>
                        {p.name}
                      </span>
                      {p.is_daily_special && (
                        <span
                          style={{
                            fontSize: '0.6rem',
                            background: D.goldA,
                            color: D.gold,
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          ⭐
                        </span>
                      )}
                      {p.is_sold_out && (
                        <span
                          style={{
                            fontSize: '0.6rem',
                            background: D.redA,
                            color: D.red,
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          EPUIZAT
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: D.t3 }}>
                      {categories.find((c) => c.id === p.category_id)?.name || '—'}
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      flexShrink: 0,
                      gap: 2,
                    }}
                  >
                    <div style={{ fontSize: '0.9rem', color: D.gold, fontWeight: 600 }}>
                      {p.price.toFixed(2)} lei
                    </div>
                    <div style={{ fontSize: '0.62rem', color: D.t3, fontWeight: 500 }}>
                      TVA {vatLabel(p.vat_group ?? 1)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => void handleToggleActive(p)}
                    disabled={togglingId === p.id}
                    aria-label={p.is_active ? 'Dezactivează produsul' : 'Activează produsul'}
                    style={{
                      minHeight: 44,
                      borderRadius: 7,
                      background: 'transparent',
                      border: `1px solid ${D.border}`,
                      color: p.is_active ? D.green : D.t3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: togglingId === p.id ? 'wait' : 'pointer',
                      fontSize: '0.7rem',
                      padding: '0 12px',
                      gap: 4,
                      opacity: togglingId === p.id ? 0.6 : 1,
                    }}
                  >
                    {togglingId === p.id ? (
                      <Spinner size="sm" />
                    ) : (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: p.is_active ? D.green : D.t3,
                        }}
                      />
                    )}
                    {p.is_active ? 'Activ' : 'Inactiv'}
                  </button>
                  <button
                    onClick={() => setModal(p)}
                    aria-label="Editează produsul"
                    title="Editează"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 7,
                      background: D.s4,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="edit" size={18} />
                  </button>
                  <button
                    onClick={() => setDelId(p.id)}
                    aria-label="Șterge produsul"
                    title="Șterge"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 7,
                      background: D.s4,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              </div>
            ) : (
              /* ── Desktop: table row ── */
              <div
                key={p.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: gridCols,
                  padding: '12px 20px',
                  borderBottom: i < filtered.length - 1 ? `1px solid ${D.border}` : 'none',
                  alignItems: 'center',
                  opacity: p.is_sold_out ? 0.5 : 1,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = D.s3)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: D.s4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1rem',
                      flexShrink: 0,
                    }}
                  >
                    {p.emoji}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 500 }}>
                        {p.name}
                      </span>
                      {p.is_daily_special && (
                        <span
                          style={{
                            fontSize: '0.6rem',
                            background: D.goldA,
                            color: D.gold,
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          ⭐ SPECIAL
                        </span>
                      )}
                      {p.is_sold_out && (
                        <span
                          style={{
                            fontSize: '0.6rem',
                            background: D.redA,
                            color: D.red,
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          EPUIZAT
                        </span>
                      )}
                    </div>
                    {p.description && (
                      <div
                        style={{
                          fontSize: '0.72rem',
                          color: D.t3,
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.description}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: '0.8rem', color: D.t2 }}>
                  {categories.find((c) => c.id === p.category_id)?.name || '—'}
                </div>
                <div>
                  <div style={{ fontSize: '0.875rem', color: D.t1, fontWeight: 500 }}>
                    {p.price.toFixed(2)} lei
                  </div>
                  <div style={{ fontSize: '0.65rem', color: D.t3, fontWeight: 500, marginTop: 2 }}>
                    TVA {vatLabel(p.vat_group ?? 1)}
                  </div>
                </div>
                <button
                  onClick={() => void handleToggleActive(p)}
                  disabled={togglingId === p.id}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: togglingId === p.id ? 'wait' : 'pointer',
                    textAlign: 'left',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    opacity: togglingId === p.id ? 0.6 : 1,
                  }}
                >
                  {togglingId === p.id && <Spinner size="sm" />}
                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: 100,
                      fontSize: '0.72rem',
                      fontWeight: 500,
                      background: p.is_active ? D.greenA : D.s3,
                      color: p.is_active ? D.green : D.t3,
                      border: `1px solid ${p.is_active ? 'rgba(76,175,110,0.2)' : D.border}`,
                    }}
                  >
                    {p.is_active ? 'Activ' : 'Inactiv'}
                  </span>
                </button>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={async () => {
                      const r = await toggleSoldOut(p.id, p.is_sold_out)
                      if (r.error) toast('Nu s-a putut actualiza: ' + r.error.message, 'error')
                      else toast(p.is_sold_out ? 'Disponibil' : 'Epuizat')
                    }}
                    aria-label={p.is_sold_out ? 'Marchează disponibil' : 'Marchează epuizat'}
                    title={p.is_sold_out ? 'Marchează disponibil' : 'Marchează epuizat'}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: p.is_sold_out ? D.redA : D.s4,
                      border: `1px solid ${p.is_sold_out ? 'rgba(224,85,85,0.3)' : D.border}`,
                      color: p.is_sold_out ? D.red : D.t3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="alert" size={15} />
                  </button>
                  <button
                    onClick={async () => {
                      const r = await toggleDailySpecial(p.id, p.is_daily_special)
                      if (r.error) toast('Nu s-a putut actualiza: ' + r.error.message, 'error')
                      else toast(p.is_daily_special ? 'Normal' : 'Special!')
                    }}
                    aria-label={p.is_daily_special ? 'Scoate din specialități' : 'Marchează specialitate'}
                    title={p.is_daily_special ? 'Scoate din specialități' : 'Marchează specialitate'}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: p.is_daily_special ? D.goldA : D.s4,
                      border: `1px solid ${p.is_daily_special ? D.gold + '44' : D.border}`,
                      color: p.is_daily_special ? D.gold : D.t3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="star" size={15} />
                  </button>
                  <button
                    onClick={() => setModal(p)}
                    aria-label="Editează produsul"
                    title="Editează"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: D.s4,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    onClick={() => setDelId(p.id)}
                    aria-label="Șterge produsul"
                    title="Șterge"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: D.s4,
                      border: `1px solid ${D.border}`,
                      color: D.t2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            ),
          )
        )}
      </div>
      {modal && (
        <ProductModal
          product={modal === 'add' ? null : (modal as Product)}
          categories={categories}
          onSave={handleSave}
          onClose={() => setModal(null)}
          restaurantId={restaurantId}
          userId={userId}
          menuLanguages={menuLanguages}
        />
      )}
      {csvImportOpen && (
        <Suspense fallback={null}>
          <ProductsCsvImport
            restaurantId={restaurantId}
            remainingSlots={Math.max(0, limits.max_products - products.length)}
            existingCategories={categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }))}
            onClose={() => setCsvImportOpen(false)}
            onDone={(n) => {
              setCsvImportOpen(false)
              toast(`✓ ${n} produse importate`)
              refetchProducts()
              refetchCats()
            }}
          />
        </Suspense>
      )}
      {aiImportOpen && (
        <Suspense fallback={null}>
          <AiMenuImport
            restaurantId={restaurantId}
            onClose={() => {
              setAiImportOpen(false)
              refetchProducts()
            }}
          />
        </Suspense>
      )}
      {aiBulkOpen && (
        <Suspense fallback={null}>
          <AiBulkGenerate
            restaurantId={restaurantId}
            products={products}
            categories={categories}
            menuLanguages={menuLanguages}
            onClose={() => setAiBulkOpen(false)}
            onDone={() => refetchProducts()}
          />
        </Suspense>
      )}
      {delId && (
        <Modal title="Șterge produs" onClose={() => setDelId(null)} width={380}>
          <p style={{ color: D.t2, marginBottom: 22 }}>
            Ești sigur că vrei să ștergi{' '}
            <strong style={{ color: D.t1 }}>{products.find((p) => p.id === delId)?.name}</strong>?
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setDelId(null)}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              Anulează
            </button>
            <button onClick={handleDelete} style={btn({ background: D.red, color: '#fff' })}>
              Șterge
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

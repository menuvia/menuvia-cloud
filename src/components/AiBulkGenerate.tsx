// AiBulkGenerate — generează imagini + macronutrienți pentru tot meniul (AI)
// Rulează secvențial pe produsele care nu au încă imagine / nutriție, cu
// progres vizibil. Tot ce se generează e marcat ca „AI" (ai_generated_fields)
// → owner-ul vede badge „verifică" în fiecare produs. Se oprește la depășirea
// cotei (429) și raportează clar.
import { useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { D } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import { supabase } from '../lib/supabase'
import type { Product, Category } from '../hooks/useData'
import { generateNutrition, generateProductImage, aiTranslateBatch } from '../lib/ai'
import type { Translations } from '../lib/i18nMenu'

type ErrWithMeta = Error & { code?: string; status?: number }
function isQuota(e: unknown): boolean {
  const m = e as ErrWithMeta
  return m?.code === 'quota_exceeded' || m?.status === 429
}

// Împarte un array în grupuri de câte `n` (pentru apeluri AI de traducere în lot).
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// Merge non-distructiv, fill-only-gaps: valorile EXISTENTE (editate manual sau
// traduse anterior) CÂȘTIGĂ — AI-ul completează doar câmpurile goale. Ordinea
// de spread pune `val` (AI) prima și `merged[code]` (existent) a doua, deci
// existentul suprascrie AI-ul la câmpurile deja completate. Astfel un buton
// „Traduceri" repetat NU pierde niciodată o traducere ajustată manual.
function mergeTranslations(existing: Translations | null | undefined, tr: Translations): Translations {
  const merged: Translations = { ...(existing ?? {}) }
  for (const [code, val] of Object.entries(tr)) {
    merged[code] = { ...val, ...(merged[code] ?? {}) }
  }
  return merged
}

export default function AiBulkGenerate({
  restaurantId,
  products,
  categories,
  menuLanguages = [],
  onClose,
  onDone,
}: {
  restaurantId: string
  products: Product[]
  categories: Category[]
  /** Limbile extra alese de restaurant (Setări → Limbi meniu). [] = fără traduceri. */
  menuLanguages?: string[]
  onClose: () => void
  onDone: () => void
}) {
  useBodyScrollLock(true)
  const isMobile = useIsMobile()
  const langs = menuLanguages.filter((c) => c !== 'ro')
  const hasLangs = langs.length > 0
  const [doImages, setDoImages] = useState(true)
  const [doNutrition, setDoNutrition] = useState(true)
  const [doTranslate, setDoTranslate] = useState(hasLangs)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [progress, setProgress] = useState(0)
  const [okImg, setOkImg] = useState(0)
  const [okNutri, setOkNutri] = useState(0)
  const [okTr, setOkTr] = useState(0)
  const [okTrCat, setOkTrCat] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const [current, setCurrent] = useState('')
  const [quotaHit, setQuotaHit] = useState(false)

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null

  // Un produs are nevoie de traducere dacă vreo limbă țintă n-are încă un nume
  // tradus SAU (când produsul are descriere) o descriere tradusă — altfel un
  // produs cu numele deja tradus dar descrierea netradusă era sărit tăcut.
  const needsTr = (p: Product): boolean =>
    hasLangs &&
    langs.some(
      (l) =>
        !p.translations?.[l]?.name?.trim() ||
        (!!p.description?.trim() && !p.translations?.[l]?.description?.trim()),
    )
  const needsTrCat = (c: Category): boolean =>
    hasLangs && langs.some((l) => !(c.translations?.[l]?.name?.trim()))

  const missingImg = products.filter((p) => !p.image_url)
  const missingNutri = products.filter((p) => p.calories == null)
  const missingTr = products.filter(needsTr)
  const missingTrCat = categories.filter(needsTrCat)
  // Produsele din bucla per-produs = cele care au nevoie de imagine/nutriție.
  // Traducerile se fac SEPARAT, în loturi (pre-pass batched), nu aici.
  const targets = products.filter(
    (p) => (doImages && !p.image_url) || (doNutrition && p.calories == null),
  )
  // Există muncă de făcut? Include traducerile (produse + categorii), care nu
  // sunt în `targets` ci în pre-pass-ul batched.
  const hasWork =
    targets.length > 0 ||
    (doTranslate && (missingTr.length > 0 || missingTrCat.length > 0))

  async function run() {
    setRunning(true)
    setDone(false)
    setProgress(0)
    setOkImg(0)
    setOkNutri(0)
    setOkTr(0)
    setOkTrCat(0)
    setErrors([])
    setQuotaHit(false)
    let stop = false

    // Pre-pass BATCHED de traducere: categorii + produse, în loturi de câte un
    // apel AI. Dimensiunea lotului SCADE cu numărul de limbi, ca output-ul AI
    // să nu depășească plafonul de tokeni (altfel răspunsul e trunchiat → JSON
    // invalid → tot lotul pierdut). Merge non-distructiv; oprire la cota 429.
    const nLangs = Math.max(1, langs.length)
    // Categorii = doar nume (output mic). Produse = nume + descriere (mai mare).
    const catChunkSize = Math.min(25, Math.max(4, Math.floor(80 / nLangs)))
    const prodChunkSize = Math.min(20, Math.max(2, Math.floor(34 / nLangs)))
    if (doTranslate) {
      // Categorii (headerele meniului) — doar nume.
      const catGroups = chunk(categories.filter(needsTrCat), catChunkSize)
      for (let g = 0; g < catGroups.length && !stop; g++) {
        const group = catGroups[g]
        setCurrent(`Traduc categorii (${group.length})…`)
        let map: Record<string, Translations> = {}
        try {
          map = await aiTranslateBatch({
            restaurant_id: restaurantId,
            items: group.map((c) => ({ id: c.id, name: c.name })),
            targetLangs: langs,
          })
        } catch (e) {
          if (isQuota(e)) { setQuotaHit(true); stop = true }
          else setErrors((prev) => [...prev, `Traducere categorii: ${e instanceof Error ? e.message : 'eroare'}`])
          continue
        }
        // Scrierile per-item NU opresc lotul: o eroare de UPDATE pe un item nu
        // mai anulează traducerile deja obținute pentru restul grupului.
        for (const c of group) {
          const tr = map[c.id]
          if (!tr) continue
          try {
            const { error } = await supabase
              .from('categories')
              .update({ translations: mergeTranslations(c.translations, tr) })
              .eq('id', c.id)
            if (error) throw new Error(error.message)
            setOkTrCat((x) => x + 1)
          } catch (e) {
            setErrors((prev) => [...prev, `${c.name} (categorie): ${e instanceof Error ? e.message : 'eroare'}`])
          }
        }
      }
      // Produse — nume + descriere.
      const prodGroups = chunk(products.filter(needsTr), prodChunkSize)
      for (let g = 0; g < prodGroups.length && !stop; g++) {
        const group = prodGroups[g]
        setCurrent(`Traduc produse (${group.length})…`)
        let map: Record<string, Translations> = {}
        try {
          map = await aiTranslateBatch({
            restaurant_id: restaurantId,
            items: group.map((p) => ({ id: p.id, name: p.name, description: p.description })),
            targetLangs: langs,
          })
        } catch (e) {
          if (isQuota(e)) { setQuotaHit(true); stop = true }
          else setErrors((prev) => [...prev, `Traducere produse: ${e instanceof Error ? e.message : 'eroare'}`])
          continue
        }
        for (const p of group) {
          const tr = map[p.id]
          if (!tr) continue
          try {
            const { error } = await supabase
              .from('products')
              .update({ translations: mergeTranslations(p.translations, tr) })
              .eq('id', p.id)
            if (error) throw new Error(error.message)
            setOkTr((x) => x + 1)
          } catch (e) {
            setErrors((prev) => [...prev, `${p.name} (traducere): ${e instanceof Error ? e.message : 'eroare'}`])
          }
        }
      }
    }

    for (let i = 0; i < targets.length && !stop; i++) {
      const p = targets[i]
      setCurrent(p.name)

      // Nutriție
      if (doNutrition && p.calories == null) {
        try {
          const n = await generateNutrition({
            restaurant_id: restaurantId,
            name: p.name,
            description: p.description,
            category: catName(p.category_id),
          })
          const fields = Array.from(
            new Set([...(p.ai_generated_fields ?? []), 'calories', 'protein_g', 'carbs_g', 'fat_g']),
          )
          const { error } = await supabase
            .from('products')
            .update({
              calories: n.calories,
              protein_g: n.protein_g,
              carbs_g: n.carbs_g,
              fat_g: n.fat_g,
              ai_generated_fields: fields,
            })
            .eq('id', p.id)
          if (error) throw new Error(error.message)
          setOkNutri((x) => x + 1)
        } catch (e) {
          if (isQuota(e)) { setQuotaHit(true); stop = true }
          else setErrors((prev) => [...prev, `${p.name} (nutriție): ${e instanceof Error ? e.message : 'eroare'}`])
        }
      }

      // Imagine
      if (!stop && doImages && !p.image_url) {
        try {
          await generateProductImage({
            restaurant_id: restaurantId,
            product_id: p.id,
            name: p.name,
            description: p.description,
            category: catName(p.category_id),
          })
          setOkImg((x) => x + 1)
        } catch (e) {
          if (isQuota(e)) { setQuotaHit(true); stop = true }
          else setErrors((prev) => [...prev, `${p.name} (imagine): ${e instanceof Error ? e.message : 'eroare'}`])
        }
      }

      setProgress(i + 1)
    }

    setDone(true)
    setRunning(false)
    setCurrent('')
    onDone()
  }

  const pct = targets.length > 0 ? Math.round((progress / targets.length) * 100) : 0

  return (
    <div onClick={running ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: D.s1, border: `1px solid ${D.border}`, borderRadius: isMobile ? '18px 18px 0 0' : 18, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'Fraunces,serif', fontSize: '1.1rem', color: D.t1 }}>✨ Generează AI pentru meniu</span>
          {!running && <button onClick={onClose} aria-label="Închide" style={{ background: 'transparent', border: 'none', color: D.t2, cursor: 'pointer', fontSize: 18 }}>✕</button>}
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          {!done && (
            <>
              <p style={{ color: D.t2, fontSize: '0.88rem', lineHeight: 1.5, marginBottom: 16 }}>
                Completez automat ce lipsește din meniu. Tot ce generez e marcat „✨ generat de AI — verifică", ca să corectezi ușor.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={doImages} disabled={running} onChange={(e) => setDoImages(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#C8963C' }} />
                <span style={{ color: D.t1, fontSize: '0.9rem' }}>Imagini ({missingImg.length} fără imagine)</span>
              </label>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginLeft: 28, marginTop: -6, marginBottom: 4 }}>
                Necesită furnizor OpenAI sau Gemini. Pe Claude/custom, imaginile vor fi sărite.
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={doNutrition} disabled={running} onChange={(e) => setDoNutrition(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#C8963C' }} />
                <span style={{ color: D.t1, fontSize: '0.9rem' }}>Macronutrienți ({missingNutri.length} fără valori)</span>
              </label>

              {hasLangs && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={doTranslate} disabled={running} onChange={(e) => setDoTranslate(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#C8963C' }} />
                    <span style={{ color: D.t1, fontSize: '0.9rem' }}>Traduceri în {langs.length} {langs.length === 1 ? 'limbă' : 'limbi'} ({missingTr.length + missingTrCat.length} de tradus)</span>
                  </label>
                  <div style={{ fontSize: '0.72rem', color: D.t3, marginLeft: 28, marginTop: -6, marginBottom: 4 }}>
                    Traduce numele + descrierea în limbile alese din Setări → Limbi meniu. Nu suprascrie traducerile editate manual.
                  </div>
                </>
              )}

              {running && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ height: 8, background: D.s3, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: D.gold, transition: 'width .3s' }} />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: D.t2 }}>{progress}/{targets.length} · {current}</div>
                </div>
              )}
            </>
          )}

          {done && (
            <div>
              <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 10 }}>{quotaHit ? '⚠️' : '✅'}</div>
              <p style={{ color: D.t1, fontSize: '0.95rem', fontWeight: 600, textAlign: 'center', marginBottom: 6 }}>
                {quotaHit ? 'Cotă AI epuizată' : 'Gata!'}
              </p>
              <p style={{ color: D.t2, fontSize: '0.85rem', textAlign: 'center', marginBottom: 14 }}>
                {okNutri} seturi de valori nutriționale · {okImg} imagini generate
                {hasLangs ? ` · ${okTr} produse${okTrCat > 0 ? ` + ${okTrCat} categorii` : ''} traduse` : ''}.
                {quotaHit && ' Cumpără credite din Setări → Asistent AI ca să continui.'}
              </p>
              <p style={{ color: D.amber, fontSize: '0.8rem', textAlign: 'center', marginBottom: 10 }}>
                ✨ Tot ce s-a generat e marcat „verifică" — corectează în fiecare produs.
              </p>
              {errors.length > 0 && (
                <div style={{ background: D.s2, border: `1px solid ${D.border}`, borderRadius: 8, padding: 10, maxHeight: 160, overflowY: 'auto' }}>
                  {errors.map((er, i) => (
                    <div key={i} style={{ fontSize: '0.75rem', color: D.t3, marginBottom: 4 }}>{er}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: 16, borderTop: `1px solid ${D.border}`, display: 'flex', gap: 10 }}>
          {!done && (
            <button
              onClick={() => void run()}
              disabled={running || !hasWork || (!doImages && !doNutrition && !doTranslate)}
              className="pressable"
              style={{ flex: 1, background: D.gold, color: '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: '0.9rem', fontWeight: 700, cursor: running ? 'default' : 'pointer', opacity: running || !hasWork || (!doImages && !doNutrition && !doTranslate) ? 0.5 : 1 }}
            >
              {running
                ? 'Se generează…'
                : targets.length > 0
                  ? `Generează pentru ${targets.length} ${targets.length === 1 ? 'produs' : 'produse'}`
                  : 'Generează traduceri'}
            </button>
          )}
          {done && (
            <button onClick={onClose} className="pressable" style={{ flex: 1, background: D.gold, color: '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer' }}>
              Gata
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

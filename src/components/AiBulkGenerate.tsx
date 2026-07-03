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
import { generateNutrition, generateProductImage, aiTranslateProduct } from '../lib/ai'

type ErrWithMeta = Error & { code?: string; status?: number }
function isQuota(e: unknown): boolean {
  const m = e as ErrWithMeta
  return m?.code === 'quota_exceeded' || m?.status === 429
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

  // Un produs/o categorie are nevoie de traducere dacă vreo limbă țintă n-are
  // încă un nume tradus.
  const needsTr = (p: Product): boolean =>
    hasLangs && langs.some((l) => !(p.translations?.[l]?.name?.trim()))
  const needsTrCat = (c: Category): boolean =>
    hasLangs && langs.some((l) => !(c.translations?.[l]?.name?.trim()))

  const missingImg = products.filter((p) => !p.image_url)
  const missingNutri = products.filter((p) => p.calories == null)
  const missingTr = products.filter(needsTr)
  const missingTrCat = categories.filter(needsTrCat)
  // Produsele de procesat = reuniunea celor vizate de opțiunile bifate.
  const targets = products.filter(
    (p) =>
      (doImages && !p.image_url) ||
      (doNutrition && p.calories == null) ||
      (doTranslate && needsTr(p)),
  )
  // Există muncă de făcut? Include și categoriile de tradus (care nu sunt în
  // `targets`, dar declanșează pre-pass-ul de traducere).
  const hasWork = targets.length > 0 || (doTranslate && missingTrCat.length > 0)

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

    // Pre-pass: traducerea numelor de CATEGORII (headerele meniului). Puține la
    // număr, deci nu intră în bara de progres (care numără produsele).
    if (doTranslate) {
      const catTargets = categories.filter(needsTrCat)
      for (let i = 0; i < catTargets.length && !stop; i++) {
        const c = catTargets[i]
        setCurrent(c.name)
        try {
          const tr = await aiTranslateProduct({
            restaurant_id: restaurantId,
            name: c.name,
            description: null,
            targetLangs: langs,
          })
          const merged = { ...(c.translations ?? {}) }
          for (const [code, val] of Object.entries(tr)) {
            merged[code] = { ...(merged[code] ?? {}), ...val }
          }
          const { error } = await supabase
            .from('categories')
            .update({ translations: merged })
            .eq('id', c.id)
          if (error) throw new Error(error.message)
          setOkTrCat((x) => x + 1)
        } catch (e) {
          if (isQuota(e)) { setQuotaHit(true); stop = true }
          else setErrors((prev) => [...prev, `${c.name} (categorie): ${e instanceof Error ? e.message : 'eroare'}`])
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

      // Traduceri (multilingv)
      if (!stop && doTranslate && needsTr(p)) {
        try {
          const tr = await aiTranslateProduct({
            restaurant_id: restaurantId,
            name: p.name,
            description: p.description,
            targetLangs: langs,
          })
          // Merge non-distructiv: păstrează traducerile deja existente/editate
          // manual, completează doar ce lipsește pe limbile țintă.
          const merged = { ...(p.translations ?? {}) }
          for (const [code, val] of Object.entries(tr)) {
            merged[code] = { ...(merged[code] ?? {}), ...val }
          }
          const { error } = await supabase
            .from('products')
            .update({ translations: merged })
            .eq('id', p.id)
          if (error) throw new Error(error.message)
          setOkTr((x) => x + 1)
        } catch (e) {
          if (isQuota(e)) { setQuotaHit(true); stop = true }
          else setErrors((prev) => [...prev, `${p.name} (traducere): ${e instanceof Error ? e.message : 'eroare'}`])
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

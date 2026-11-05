// AiBulkGenerate — generează imagini + macronutrienți pentru tot meniul (AI)
// Rulează secvențial pe produsele care nu au încă imagine / nutriție, cu
// progres vizibil. Tot ce se generează e marcat ca „AI" (ai_generated_fields)
// → owner-ul vede badge „verifică" în fiecare produs. Se oprește la depășirea
// cotei (429) și raportează clar. O eroare de CONFIGURARE (furnizor fără
// imagini, AI dezactivat, cheie lipsă — vezi isAiConfigError) se repetă identic
// la fiecare produs: o raportăm O DATĂ și sărim restul pentru acel tip de
// generare, în loc să chemăm serverul de N ori și să umplem lista cu N erori.
//
// Traducerile (lotul O6c): fill-only-gaps prin `mergeAiTranslations` — textul
// existent câștigă, AI-ul completează doar golurile și le marchează în
// `translations[lang].ai_fields` („de verificat” în Meniu → Traduceri). Cu
// `optionRows` (ecranul Traduceri) se traduc și grupurile, opțiunile și
// extra-urile; din Produse lotul rămâne cel de dinainte.
import { useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { D } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import { supabase } from '../lib/supabase'
import type { Product, Category } from '../hooks/useData'
import {
  generateNutrition,
  generateProductImage,
  aiTranslateBatch,
  isAiConfigError,
  isAiQuotaError,
  type TranslatableItem,
} from '../lib/ai'
import {
  activeTranslationLangs,
  mergeAiTranslations,
  type TranslatedField,
  type Translations,
} from '../lib/i18nMenu'
import {
  needsAiTranslation,
  remapCategoryAi,
  roCount,
  trFieldsFor,
  type AiOptionRow,
  type AiOptionRows,
  type TrTable,
} from '../lib/menuTranslations'
import { toUserMessage } from '../lib/userMessages'
import { Button } from './ui/Button'

// Erorile AI vin deja în română (lib/ai.ts); restul trec prin toUserMessage.
const errText = (e: unknown): string => toUserMessage(e, 'eroare la generare')

// Împarte un array în grupuri de câte `n` (pentru apeluri AI de traducere în lot).
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// Câmpurile pe care AI-ul are voie să le scrie pe un rând = cele cerute de
// raport (trFieldsFor): descrierea doar cu original, subtitlul doar cu subtitlu.
const allow = (fields: readonly TranslatedField[]): Partial<Record<TranslatedField, boolean>> =>
  Object.fromEntries(fields.map((f) => [f, true]))
const productFields = (p: Product) =>
  trFieldsFor('product', { name: p.name, description: p.description ?? undefined })
const categoryFields = (c: Category) =>
  trFieldsFor('category', { name: c.name, meta_text: c.meta_text ?? undefined })
const NAME_ONLY: readonly TranslatedField[] = ['name']

export default function AiBulkGenerate({
  restaurantId,
  products,
  categories,
  menuLanguages = [],
  baseLang = 'ro',
  onClose,
  onDone,
  translateOnly = false,
  optionRows,
  title,
  onOpenTranslations,
}: {
  restaurantId: string
  products: Product[]
  categories: Category[]
  /** Limbile extra alese de restaurant (Setări → Aspect meniu → Limbi meniu). [] = fără traduceri. */
  menuLanguages?: string[]
  /** Limba în care e scris meniul (lotul O6a): sursa traducerilor AI. */
  baseLang?: string
  onClose: () => void
  onDone: () => void
  /**
   * Agentul de vânzări (partener cu acces acordat, mig 286): ai-proxy îi permite
   * DOAR `menu_import` și `translate` (AGENT_FEATURES) — nutriția îi dă 403, iar
   * imaginile n-au cale de agent. Fără bifele lor, lotul face doar traduceri.
   */
  translateOnly?: boolean
  /**
   * Grupurile, opțiunile și extra-urile de tradus (ecranul Traduceri, lotul
   * O6c). Fără ele (tab-ul Produse) lotul nu le atinge.
   */
  optionRows?: AiOptionRows
  /** Titlul ferestrei (implicit „Generează AI pentru meniu"). */
  title?: string
  /** „Verifică traducerile" pe ecranul final: duce în Meniu → Traduceri. */
  onOpenTranslations?: () => void
}) {
  useBodyScrollLock(true)
  const isMobile = useIsMobile()
  const langs = activeTranslationLangs(menuLanguages, baseLang)
  const hasLangs = langs.length > 0
  const [doImages, setDoImages] = useState(!translateOnly)
  const [doNutrition, setDoNutrition] = useState(!translateOnly)
  const [doTranslate, setDoTranslate] = useState(hasLangs)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [progress, setProgress] = useState(0)
  const [okImg, setOkImg] = useState(0)
  const [okNutri, setOkNutri] = useState(0)
  const [okTr, setOkTr] = useState(0)
  const [okTrCat, setOkTrCat] = useState(0)
  const [okTrOpt, setOkTrOpt] = useState(0)
  // Textele (câmpurile) completate de AI — toate marcate „de verificat".
  const [okTexts, setOkTexts] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const [current, setCurrent] = useState('')
  const [quotaHit, setQuotaHit] = useState(false)

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null

  // Un rând are nevoie de traducere dacă vreo limbă țintă n-are încă unul
  // dintre câmpurile cerute — ACEEAȘI regulă ca „Lipsă” din Meniu → Traduceri
  // (needsAiTranslation): numele, descrierea produsului care are una,
  // subtitlul categoriei care are unul.
  const needsTr = (p: Product): boolean =>
    hasLangs && needsAiTranslation(productFields(p), p.translations, langs)
  const needsTrCat = (c: Category): boolean =>
    hasLangs && needsAiTranslation(categoryFields(c), c.translations, langs)
  const needsTrRow = (r: AiOptionRow): boolean =>
    hasLangs && needsAiTranslation(NAME_ONLY, r.translations, langs)

  const missingImg = products.filter((p) => !p.image_url)
  const missingNutri = products.filter((p) => p.calories == null)
  const missingTr = products.filter(needsTr)
  const missingTrCat = categories.filter(needsTrCat)
  const missingTrOpt = optionRows
    ? [...optionRows.groups, ...optionRows.options, ...optionRows.extras].filter(needsTrRow)
    : []
  // Produsele din bucla per-produs = cele care au nevoie de imagine/nutriție.
  // Traducerile se fac SEPARAT, în loturi (pre-pass batched), nu aici.
  const targets = products.filter(
    (p) => (doImages && !p.image_url) || (doNutrition && p.calories == null),
  )
  // Există muncă de făcut? Include traducerile (produse + categorii), care nu
  // sunt în `targets` ci în pre-pass-ul batched.
  const hasWork =
    targets.length > 0 ||
    (doTranslate && (missingTr.length > 0 || missingTrCat.length > 0 || missingTrOpt.length > 0))

  async function run() {
    setRunning(true)
    setDone(false)
    setProgress(0)
    setOkImg(0)
    setOkNutri(0)
    setOkTr(0)
    setOkTrCat(0)
    setOkTrOpt(0)
    setOkTexts(0)
    setErrors([])
    setQuotaHit(false)
    let stop = false
    // Eroare de configurare pe un tip de generare → restul produselor se sar
    // pentru acel tip (imaginile pot fi oprite, nutriția continuă).
    let stopText = false
    let stopImages = false

    // Pre-pass BATCHED de traducere: categorii + produse, în loturi de câte un
    // apel AI. Dimensiunea lotului SCADE cu numărul de limbi, ca output-ul AI
    // să nu depășească plafonul de tokeni (altfel răspunsul e trunchiat → JSON
    // invalid → tot lotul pierdut). Merge non-distructiv; oprire la cota 429.
    const nLangs = Math.max(1, langs.length)
    // Categorii = doar nume (output mic). Produse = nume + descriere (mai mare).
    const catChunkSize = Math.min(25, Math.max(4, Math.floor(80 / nLangs)))
    const prodChunkSize = Math.min(20, Math.max(2, Math.floor(34 / nLangs)))
    // Un fel de rând (categorii, produse, grupuri, opțiuni, extra-uri), cu
    // ACELAȘI flux de control pentru toate: 429 → cotă, oprire; eroare de
    // configurare → un singur mesaj, oprire; altă eroare → mesaj pe lot și se
    // continuă. Scrierile per rând NU opresc lotul.
    async function translateKind<T extends { id: string; name: string; translations?: Translations | null }>(k: {
      label: string
      rowLabel: string
      table: TrTable
      rows: T[]
      chunkSize: number
      toItem: (r: T) => TranslatableItem
      fieldsOf: (r: T) => readonly TranslatedField[]
      remap?: (m: Record<string, Translations>) => Record<string, Translations>
      onOk: () => void
    }): Promise<void> {
      const groups = chunk(k.rows, k.chunkSize)
      for (let g = 0; g < groups.length && !stop && !stopText; g++) {
        const group = groups[g]
        setCurrent(`Traduc ${k.label} (${group.length})…`)
        let map: Record<string, Translations>
        try {
          map = await aiTranslateBatch({
            restaurant_id: restaurantId,
            items: group.map(k.toItem),
            targetLangs: langs,
            sourceLang: baseLang,
          })
        } catch (e) {
          if (isAiQuotaError(e)) {
            setQuotaHit(true)
            stop = true
          } else if (isAiConfigError(e)) {
            stopText = true
            setErrors((prev) => [...prev, `Traduceri oprite: ${errText(e)}`])
            break
          } else setErrors((prev) => [...prev, `Traducere ${k.label}: ${errText(e)}`])
          continue
        }
        if (k.remap) map = k.remap(map)
        for (const r of group) {
          const tr = map[r.id]
          if (!tr) continue
          const merged = mergeAiTranslations(r.translations, tr, {
            langs,
            base: baseLang,
            fields: allow(k.fieldsOf(r)),
          })
          // Nimic de completat (totul era deja tradus): fără scriere inutilă.
          if (merged.filled === 0) continue
          try {
            const { error } = await supabase
              .from(k.table)
              .update({ translations: merged.translations })
              .eq('id', r.id)
            if (error) throw new Error(error.message)
            k.onOk()
            setOkTexts((x) => x + merged.filled)
          } catch (e) {
            setErrors((prev) => [...prev, `${r.name} (${k.rowLabel}): ${errText(e)}`])
          }
        }
      }
    }

    if (doTranslate) {
      // Categorii (headerele meniului) — numele + subtitlul (trimis ca
      // descriere, întors înapoi pe `meta_text`).
      await translateKind({
        label: 'categorii',
        rowLabel: 'categorie',
        table: 'categories',
        rows: categories.filter(needsTrCat),
        chunkSize: catChunkSize,
        toItem: (c) => ({
          id: c.id,
          name: c.name,
          ...(c.meta_text?.trim() ? { description: c.meta_text } : {}),
        }),
        fieldsOf: categoryFields,
        remap: remapCategoryAi,
        onOk: () => setOkTrCat((x) => x + 1),
      })
      // Produse — nume + descriere (forma itemului NESCHIMBATĂ).
      await translateKind({
        label: 'produse',
        rowLabel: 'traducere',
        table: 'products',
        rows: products.filter(needsTr),
        chunkSize: prodChunkSize,
        toItem: (p) => ({ id: p.id, name: p.name, description: p.description }),
        fieldsOf: productFields,
        onOk: () => setOkTr((x) => x + 1),
      })
      // Grupuri, opțiuni, extra-uri — doar numele, cu context pentru AI.
      if (optionRows) {
        const optItem = (r: AiOptionRow): TranslatableItem => ({
          id: r.id,
          name: r.name,
          ...(r.context ? { context: r.context } : {}),
        })
        const kinds: [string, string, TrTable, AiOptionRow[]][] = [
          ['grupuri de opțiuni', 'grup', 'modifier_groups', optionRows.groups],
          ['opțiuni', 'opțiune', 'modifier_options', optionRows.options],
          ['extra-uri', 'extra', 'product_extras', optionRows.extras],
        ]
        for (const [label, rowLabel, table, rows] of kinds) {
          await translateKind({
            label,
            rowLabel,
            table,
            rows: rows.filter(needsTrRow),
            chunkSize: catChunkSize,
            toItem: optItem,
            fieldsOf: () => NAME_ONLY,
            onOk: () => setOkTrOpt((x) => x + 1),
          })
        }
      }
    }

    for (let i = 0; i < targets.length && !stop; i++) {
      const p = targets[i]
      setCurrent(p.name)

      // Nutriție
      if (doNutrition && !stopText && p.calories == null) {
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
          if (isAiQuotaError(e)) {
            setQuotaHit(true)
            stop = true
          } else if (isAiConfigError(e)) {
            stopText = true
            setErrors((prev) => [
              ...prev,
              `Macronutrienți opriți: ${errText(e)} Restul produselor au fost sărite.`,
            ])
          } else setErrors((prev) => [...prev, `${p.name} (nutriție): ${errText(e)}`])
        }
      }

      // Imagine
      if (!stop && doImages && !stopImages && !p.image_url) {
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
          if (isAiQuotaError(e)) {
            setQuotaHit(true)
            stop = true
          } else if (isAiConfigError(e)) {
            stopImages = true
            setErrors((prev) => [
              ...prev,
              `Imagini oprite: ${errText(e)} Restul produselor au fost sărite.`,
            ])
          } else setErrors((prev) => [...prev, `${p.name} (imagine): ${errText(e)}`])
        }
      }

      setProgress(i + 1)
      // Nimic de făcut mai departe: ambele tipuri cerute s-au oprit.
      if ((!doNutrition || stopText) && (!doImages || stopImages)) stop = true
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
          <span style={{ fontFamily: 'Fraunces,serif', fontSize: '1.1rem', color: D.t1 }}>{title ?? '✨ Generează AI pentru meniu'}</span>
          {!running && <button onClick={onClose} aria-label="Închide" style={{ background: 'transparent', border: 'none', color: D.t2, cursor: 'pointer', fontSize: 18 }}>✕</button>}
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          {!done && (
            <>
              <p style={{ color: D.t2, fontSize: '0.88rem', lineHeight: 1.5, marginBottom: 16 }}>
                Completez automat ce lipsește din meniu. Tot ce generez e marcat „✨ generat de AI — verifică", ca să corectezi ușor.
              </p>
              {!translateOnly && (
              <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={doImages} disabled={running} onChange={(e) => setDoImages(e.target.checked)} style={{ width: 18, height: 18, accentColor: D.gold }} />
                <span style={{ color: D.t1, fontSize: '0.9rem' }}>Imagini ({missingImg.length} fără imagine)</span>
              </label>
              <div style={{ fontSize: '0.72rem', color: D.t3, marginLeft: 28, marginTop: -6, marginBottom: 4 }}>
                Merg cu furnizorul implicit (OpenAI) sau cu Gemini. Pe Claude sau pe un furnizor personalizat, imaginile se sar, cu un singur mesaj.
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={doNutrition} disabled={running} onChange={(e) => setDoNutrition(e.target.checked)} style={{ width: 18, height: 18, accentColor: D.gold }} />
                <span style={{ color: D.t1, fontSize: '0.9rem' }}>Macronutrienți ({missingNutri.length} fără valori)</span>
              </label>
              </>
              )}

              {hasLangs && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={doTranslate} disabled={running} onChange={(e) => setDoTranslate(e.target.checked)} style={{ width: 18, height: 18, accentColor: D.gold }} />
                    <span style={{ color: D.t1, fontSize: '0.9rem' }}>Traduceri în {langs.length} {langs.length === 1 ? 'limbă' : 'limbi'} ({missingTr.length + missingTrCat.length + missingTrOpt.length} de tradus)</span>
                  </label>
                  <div style={{ fontSize: '0.72rem', color: D.t3, marginLeft: 28, marginTop: -6, marginBottom: 4 }}>
                    Traduce {optionRows ? 'numele, descrierile, opțiunile și extra-urile' : 'numele + descrierea'} în limbile alese din Setări → Aspect meniu → Limbi meniu. Completează doar ce lipsește (nu suprascrie traducerile editate manual) și marchează textele noi «de verificat».
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
                {[
                  ...(translateOnly ? [] : [`${okNutri} seturi de valori nutriționale`, `${okImg} imagini generate`]),
                  ...(hasLangs
                    ? [
                        `${okTr} produse${okTrCat > 0 ? ` + ${okTrCat} categorii` : ''}${okTrOpt > 0 ? ` + ${okTrOpt} opțiuni și extra-uri` : ''} traduse`,
                      ]
                    : []),
                ].join(' · ')}
                .{quotaHit && ' Cumpără credite din Setări → Asistent AI ca să continui.'}
              </p>
              {!translateOnly && (
                <p style={{ color: D.amber, fontSize: '0.8rem', textAlign: 'center', marginBottom: 10 }}>
                  ✨ Tot ce s-a generat e marcat „verifică" — corectează în fiecare produs.
                </p>
              )}
              {hasLangs && doTranslate && (
                <p style={{ color: D.amber, fontSize: '0.8rem', textAlign: 'center', marginBottom: 10 }}>
                  ✨ {roCount(okTexts, 'text tradus', 'texte traduse')} — marcate «de verificat».
                </p>
              )}
              {onOpenTranslations && hasLangs && doTranslate && (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onClose()
                      onOpenTranslations()
                    }}
                  >
                    Verifică traducerile
                  </Button>
                </div>
              )}
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

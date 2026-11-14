// ─────────────────────────────────────────────────────────────
// ProductsCsvImport — modal de import produse din CSV
//
// Formatul, parserul și validarea stau în `lib/productsCsv.ts` (lotul L5a2):
// antetele coloanelor se recunosc în oricare dintre cele patru limbi ale
// personalului (ro/en/fr/de), șablonul descărcabil se generează cu antetele în
// LIMBA PERSONALULUI (în română byte-identic cu cel de dinainte), iar erorile
// de rând și ale importului se țin ca DATE (coduri, `CsvImportFailure`) și se
// traduc la randare (`lib/importMessages.ts`). Valorile din celule (numele
// produselor și ale categoriilor) NU se traduc niciodată.
// Componenta e leneșă, montată din fila Produse sub propriul `<Suspense>`:
// `useT(importsNs)` o suspendă pe ea, nu fila.
// ─────────────────────────────────────────────────────────────
import { useState, useMemo, useRef } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { parseProductsCsv, type ParsedCsvRow } from '../lib/productsCsv'
import {
  CsvImportFailure,
  csvExample,
  csvPlaceholder,
  csvRowErrorText,
  csvTemplate,
  describeCsvImportError,
} from '../lib/importMessages'
import { useT } from '../i18n/useT'
import { fillNodes } from '../i18n/fillNodes'
import { commonNs } from '../i18n/ns/common'
import { importsNs } from '../i18n/ns/imports'

interface Props {
  restaurantId: string
  existingCategories: { id: string; name: string; emoji: string | null }[]
  onClose: () => void
  onDone: (createdCount: number) => void
  // Câte produse mai încap în planul curent (max_products − produse existente).
  // Serverul respinge oricum peste limită (trg_enforce_product_limit, mig 013/038),
  // dar fără plafon client-side userul afla abia din eroarea brută, la mijlocul
  // importului, cu rânduri deja inserate. undefined = necunoscut → fără plafon aici.
  remainingSlots?: number
  // Cotele TVA există doar pe planul cu bon (planSurface.vat). Obligatoriu:
  // un apelant care l-ar uita n-are voie să cadă tăcut pe o variantă.
  showVat: boolean
}

// ── Style ────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: D.s1,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: 22,
  maxWidth: 760,
  width: '100%',
  maxHeight: '92vh',
  display: 'flex',
  flexDirection: 'column',
  // Scroll INTERN al modalului: conținutul înalt derulează în card, nu în afara
  // viewport-ului (înainte lipsea → trebuia scroll pe pagină ca să vezi modalul).
  overflowY: 'auto',
}
const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 14px',
  height: 38,
  borderRadius: 8,
  fontSize: '0.86rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  ...extra,
})

// ── Main component ───────────────────────────────────────────
export default function ProductsCsvImport({
  restaurantId,
  existingCategories,
  onClose,
  onDone,
  remainingSlots,
  showVat,
}: Props) {
  // Blochează scroll-ul paginii cât modalul e deschis (altfel pagina din spate
  // rămâne scrollabilă și modalul pare deplasat / cere scroll manual — fix #74).
  const tr = useT(importsNs)
  const { t, tp } = tr
  const tc = useT(commonNs)
  useBodyScrollLock(true)
  const [step, setStep] = useState<'paste' | 'preview' | 'importing'>('paste')
  const [csvText, setCsvText] = useState('')
  const [progress, setProgress] = useState(0)
  // Eroarea BRUTĂ a importului (de regulă `CsvImportFailure`), tradusă la randare.
  const [error, setError] = useState<unknown>(null)
  const [importedCount, setImportedCount] = useState(0)

  // Resume idempotent pe RETRY după eșec parțial. Cursorul + categoriile create
  // (cheiate pe textul CSV) evită re-inserția batch-urilor DEJA CONFIRMATE. DAR
  // cursorul nu poate acoperi un batch COMIS-DAR-NECONFIRMAT pe rețea (serverul
  // l-a scris, ack-ul HTTP s-a pierdut → cursorul rămâne pe loc). De aceea, la
  // RETRY (a mai fost o încercare pe același CSV), re-verificăm în DB numele deja
  // existente și le sărim — dedup real, nu doar pe cursor.
  const insertedCursorRef = useRef(0)
  // Poziția de pornire a produselor importate (lotul O5b, MENU-10): toate
  // primeau display_order 0, deci ordinea din meniu era nedefinită. Citită O
  // DATĂ, ca o reîncercare să continue numerotarea, nu s-o ia de la capăt.
  const baseOrderRef = useRef<number | null>(null)
  const createdCatsRef = useRef<Map<string, string>>(new Map())
  const importedCsvRef = useRef<string | null>(null)
  const attemptedImportRef = useRef(false)
  // Numele produselor dinaintea PRIMEI încercări — baseline pentru dedup-ul de
  // pe retry (vezi doImport). Se citește o singură dată, ÎNAINTE de orice
  // inserare; fără el importul nu pornește.
  const baselineNamesRef = useRef<Set<string> | null>(null)
  // Total inserat de-a lungul TUTUROR încercărilor din această sesiune de modal
  // — altfel, după un retry, mesajul de final raporta doar rândurile ultimei
  // încercări și părea că s-au importat mult mai puține decât în realitate.
  const totalAddedRef = useRef(0)

  // Parse CSV (lib/productsCsv): antete în oricare dintre cele patru limbi.
  const parsed = useMemo<ParsedCsvRow[]>(() => parseProductsCsv(csvText, showVat), [csvText, showVat])

  const validRows = parsed.filter((r) => r.errors.length === 0)
  const invalidRows = parsed.filter((r) => r.errors.length > 0)

  // Plafonul planului, aplicat ÎNAINTE de import: importăm doar primele
  // `remainingSlots` rânduri valide și spunem explicit câte au rămas pe
  // dinafară — altfel trigger-ul server oprea importul la mijloc, cu eroare
  // brută și rânduri deja inserate.
  const importRows =
    remainingSlots != null ? validRows.slice(0, Math.max(0, remainingSlots)) : validRows
  const truncatedCount = validRows.length - importRows.length

  // Categories needed (unique, not yet existing) — doar pentru rândurile care
  // chiar se importă (nu creăm categorii pentru rânduri tăiate de plafon).
  const newCategories = useMemo(() => {
    const existing = new Set(existingCategories.map((c) => c.name.toLowerCase()))
    const wanted = new Set(importRows.map((r) => r.category.toLowerCase()))
    return Array.from(wanted).filter((c) => !existing.has(c))
  }, [importRows, existingCategories])

  function downloadTemplate() {
    const blob = new Blob(['\uFEFF' + csvTemplate(tr, showVat)], {
      type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = t('csv_templateFile')
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setCsvText(text)
  }

  async function doImport() {
    if (importRows.length === 0) return
    setStep('importing')
    setError(null)

    // RETRY = a mai fost o încercare pe EXACT același CSV. Pe retry activăm
    // dedup-ul din DB (jos), ca un batch comis-dar-neconfirmat să nu se dubleze.
    // „Am mai încercat un import în ACEASTĂ sesiune de modal" — independent de
    // faptul că userul a editat între timp CSV-ul. Dacă prima încercare apucase
    // să insereze rânduri, ele trebuie deduplicate și la o încercare cu CSV
    // MODIFICAT; altfel editarea CSV-ului redeschidea calea spre duplicate.
    const hasAttempted = attemptedImportRef.current

    // CSV nou (față de ultima încercare) → resetăm cursorul de resume. Un retry
    // pe ACELAȘI CSV păstrează cursorul și sare peste ce s-a inserat deja.
    if (importedCsvRef.current !== csvText) {
      insertedCursorRef.current = 0
      // Și poziția de pornire se recitește: dedup-ul scoate nume fără să
      // renumeroteze, deci un CSV editat ar fi refolosit pozițiile primei
      // încercări (recenzia CodeRabbit pe #352). Un retry pe ACELAȘI CSV o păstrează.
      baseOrderRef.current = null
      createdCatsRef.current = new Map()
      importedCsvRef.current = csvText
    }
    setProgress(Math.round((100 * insertedCursorRef.current) / importRows.length))

    try {
      // Dedup pe RETRY, corect: sărim DOAR numele apărute în DB de la începutul
      // acestui import (adică inserate chiar de el, inclusiv batch-ul comis dar
      // neconfirmat pe care cursorul nu-l vede) — NU tot ce există în meniu.
      // Altfel un rând CSV legitim care coincide cu un produs preexistent
      // („Cappuccino" era deja în meniu) ar fi sărit TĂCUT — pierdere de date,
      // mai rea decât duplicatul pe care îl prevenim.
      // Paginare explicită: PostgREST plafonează răspunsul (max_rows, tipic
      // 1000), deci pe un meniu mare setul ar fi ieșit INCOMPLET și dedup-ul ar
      // fi funcționat doar parțial, tăcut. Citim în pagini până se epuizează.
      const readNames = async (): Promise<Set<string> | null> => {
        const out = new Set<string>()
        let maxOrder = -1
        const page = 1000
        for (let from = 0; ; from += page) {
          const { data, error: exErr } = await supabase
            .from('products')
            .select('name, display_order')
            .eq('restaurant_id', restaurantId)
            .range(from, from + page - 1)
          if (exErr) return null
          const rows = data ?? []
          rows.forEach((r) => {
            out.add((r.name as string).trim().toLowerCase())
            const o = (r as { display_order?: unknown }).display_order
            if (typeof o === 'number' && o > maxOrder) maxOrder = o
          })
          if (rows.length < page) break
        }
        // Prima citire completă fixează poziția de pornire (MENU-10).
        if (baseOrderRef.current == null) baseOrderRef.current = maxOrder + 1
        return out
      }

      // Baseline = numele dinaintea PRIMEI încercări. Fără el nu putem distinge
      // „produs pus de importul ăsta" de „produs care era deja în meniu".
      // Gardă FAIL-CLOSED (code-health-error-ignored-guards): înainte, o citire
      // eșuată lăsa baseline-ul gol, importul pornea oricum, iar la retry
      // baseline-ul se recitea DUPĂ încercarea parțială — conținea chiar rândurile
      // ei, deci dedup-ul era orb exact la ele. Acum, fără baseline, importul NU
      // pornește: nimic nu s-a inserat, deci următorul click e tot „prima" încercare.
      if (!hasAttempted) {
        const baseline = await readNames()
        if (!baseline) {
          throw new CsvImportFailure({ kind: 'baseline' })
        }
        baselineNamesRef.current = baseline
      }
      attemptedImportRef.current = true

      let dbNames: Set<string> | null = null
      if (hasAttempted) {
        // Pe RETRY, dedup-ul E garda anti-dublură: o citire eșuată nu înseamnă
        // „nimic importat încă" — oprim, în loc să inserăm orbește a doua oară.
        const baseline = baselineNamesRef.current
        const current = await readNames()
        if (!baseline || !current) {
          throw new CsvImportFailure({ kind: 'verifyProducts' })
        }
        // Doar ce a apărut ÎNTRE timp = inserat de acest import.
        dbNames = new Set([...current].filter((n) => !baseline.has(n)))
      }

      // 1. Auto-create missing categories (sar peste cele deja create într-o
      // încercare anterioară — createdCatsRef persistă între retry-uri).
      const catMap = new Map<string, string>() // name (lower) → id
      for (const c of existingCategories) {
        catMap.set(c.name.toLowerCase(), c.id)
      }
      // Pe RETRY recitim categoriile din DB: `existingCategories` (prop) e stale
      // după un eșec (părintele refetch-uiește doar în onDone), iar createdCatsRef
      // nu reține categoriile create de un request COMIS-dar-neconfirmat → fără
      // asta, fiecare retry mai adăuga o categorie cu același nume în meniu.
      if (hasAttempted) {
        const { data: freshCats, error: catsErr } = await supabase
          .from('categories')
          .select('id, name')
          .eq('restaurant_id', restaurantId)
        // Aceeași gardă: fără lista proaspătă, o categorie creată de un request
        // comis-dar-neconfirmat s-ar crea a doua oară.
        if (catsErr) {
          throw new CsvImportFailure({ kind: 'verifyCategories' })
        }
        for (const c of freshCats ?? []) {
          catMap.set((c.name as string).toLowerCase(), c.id as string)
        }
      }
      for (const [k, v] of createdCatsRef.current) catMap.set(k, v)
      for (const [index, newCatName] of newCategories.entries()) {
        if (catMap.has(newCatName)) continue // deja creată la o încercare anterioară
        const original =
          importRows.find((r) => r.category.toLowerCase() === newCatName)?.category || newCatName
        const { data, error: catErr } = await supabase
          .from('categories')
          .insert({
            restaurant_id: restaurantId,
            name: original,
            emoji: '🍽️',
            // #27: meniul ordonează după `display_order` (NOT NULL), nu `position`. Offset =
            // nr. categorii existente + indexul în lista nouă (catMap include deja existentele,
            // deci NU folosim catMap.size — ar dubla offset-ul).
            display_order: existingCategories.length + index,
          })
          .select('id')
          .single()
        if (catErr) throw new CsvImportFailure({ kind: 'category', name: original, cause: catErr })
        if (data) {
          catMap.set(newCatName, data.id as string)
          createdCatsRef.current.set(newCatName, data.id as string)
        }
      }

      // 2. Insert products in batches of 20 (avoid huge single insert). Pornim de
      // la cursorul de resume: batch-urile deja inserate NU se re-trimit (anti-dublu).
      // `cursor` urmărește poziția în importRows (resume/progress); `added` = câte
      // s-au inserat efectiv (pe retry, sub dbNames, unele se sar).
      const batchSize = 20
      const baseOrder = baseOrderRef.current ?? 0
      let cursor = insertedCursorRef.current
      for (let i = insertedCursorRef.current; i < importRows.length; i += batchSize) {
        const batch = importRows.slice(i, i + batchSize)
        let rows = batch.map((r, j) => ({
          restaurant_id: restaurantId,
          category_id: catMap.get(r.category.toLowerCase())!,
          // Ordinea din fișier (MENU-10).
          display_order: baseOrder + i + j,
          name: r.name,
          description: r.description || null,
          price: r.price!,
          emoji: r.emoji,
          vat_group: r.vat,
          is_active: true,
        }))
        if (dbNames) {
          const names = dbNames
          rows = rows.filter((r) => !names.has(r.name.trim().toLowerCase()))
        }
        if (rows.length > 0) {
          const { error: insErr } = await supabase.from('products').insert(rows)
          if (insErr) throw new CsvImportFailure({ kind: 'batch', index: i, cause: insErr })
          totalAddedRef.current += rows.length
          // Numele tocmai inserate intră în set → batch-urile următoare nu le redublează.
          if (dbNames) {
            const names = dbNames
            rows.forEach((r) => names.add(r.name.trim().toLowerCase()))
          }
        }
        // Avansăm cursorul cu întregul batch (poziție în importRows), DUPĂ succes:
        // un retry pornește de aici, nu de la 0.
        cursor += batch.length
        insertedCursorRef.current = cursor
        setProgress(Math.round((100 * cursor) / importRows.length))
      }

      setImportedCount(totalAddedRef.current)
      // Brief delay before closing for user to see 100%
      setTimeout(() => onDone(totalAddedRef.current), 500)
    } catch (e) {
      setError(e)
      setStep('preview')
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <h2
            style={{
              fontFamily: 'Fraunces,serif',
              fontSize: '1.3rem',
              fontWeight: 600,
              color: D.t1,
              margin: 0,
            }}
          >
            {t('csv_title')}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.t2,
              fontSize: '1.4rem',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>
        <div style={{ fontSize: '0.82rem', color: D.t3, marginBottom: 18 }}>
          {t('csv_subtitle')}
        </div>

        {step === 'paste' && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                background: D.s2,
                padding: 12,
                borderRadius: 9,
                fontSize: '0.82rem',
                color: D.t2,
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: D.t1 }}>{t('csv_formatTitle')}</strong>
              <pre
                style={{
                  margin: '8px 0 0',
                  padding: 8,
                  background: D.s3,
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  overflow: 'auto',
                  color: D.t1,
                  fontFamily: 'monospace',
                }}
              >
                {csvExample(tr, showVat)}
              </pre>
              <div style={{ marginTop: 8, fontSize: '0.76rem' }}>
                {fillNodes(t('csv_columnsNote'), {
                  columns: <strong style={{ color: D.t1 }}>{t('csv_columnsLabel')}</strong>,
                  name: <em>{t('csv_head_name')}</em>,
                  category: <em>{t('csv_head_category')}</em>,
                  price: <em>{t('csv_head_price')}</em>,
                })}
                {showVat ? ` ${t('csv_vatNote')}` : ''}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={downloadTemplate}
                style={btn({ background: D.s2, color: D.t1, border: `1px solid ${D.border}` })}
              >
                {t('csv_downloadTemplate')}
              </button>
              <label
                style={{
                  ...btn({ background: D.s2, color: D.t1, border: `1px solid ${D.border}` }),
                  cursor: 'pointer',
                }}
              >
                {t('csv_uploadFile')}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFile}
                  style={{ display: 'none' }}
                />
              </label>
            </div>

            <div>
              <div style={{ fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}>
                {t('csv_pasteLead')}
              </div>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={csvPlaceholder(tr, showVat)}
                style={{
                  width: '100%',
                  minHeight: 180,
                  padding: 10,
                  background: D.s3,
                  border: `1px solid ${D.border}`,
                  borderRadius: 8,
                  color: D.t1,
                  fontFamily: 'monospace',
                  fontSize: '0.82rem',
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {parsed.length === 0 ? null : (
              <div style={{ fontSize: '0.84rem', color: D.t2 }}>
                {fillNodes(tp('csv_detected', parsed.length), {
                  count: <strong style={{ color: D.t1 }}>{parsed.length}</strong>,
                })}{' '}
                <span style={{ color: D.green }}>{tp('csv_valid', validRows.length)}</span>
                {invalidRows.length === 0 ? null : (
                  <span style={{ color: D.red }}>, {tp('csv_invalid', invalidRows.length)}</span>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 'auto' }}>
              <button
                onClick={onClose}
                style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
              >
                {tc.t('cancel')}
              </button>
              <button
                onClick={() => setStep('preview')}
                disabled={validRows.length === 0}
                style={btn({
                  background: validRows.length > 0 ? D.gold : D.s3,
                  color: validRows.length > 0 ? '#000' : D.t3,
                })}
              >
                {t('csv_preview')}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div
              style={{
                background: D.s2,
                padding: 12,
                borderRadius: 8,
                marginBottom: 12,
                fontSize: '0.86rem',
              }}
            >
              <div style={{ color: D.t1 }}>
                {fillNodes(tp('csv_willCreate', validRows.length), { count: <strong>{validRows.length}</strong> })}
                {newCategories.length === 0 ? null : (
                  <>
                    {' '}
                    {fillNodes(tp('csv_newCategories', newCategories.length), {
                      count: <strong>{newCategories.length}</strong>,
                    })}{' '}
                    {newCategories.join(', ')}
                  </>
                )}
              </div>
              {invalidRows.length === 0 ? null : (
                <div style={{ color: D.amber, marginTop: 4 }}>
                  {tp('csv_skipped', invalidRows.length)}
                </div>
              )}
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                border: `1px solid ${D.border}`,
                borderRadius: 8,
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead style={{ position: 'sticky', top: 0, background: D.s2 }}>
                  <tr style={{ borderBottom: `1px solid ${D.border}`, color: D.t3 }}>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                      }}
                    >
                      #
                    </th>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('csv_colStatus')}
                    </th>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('csv_colName')}
                    </th>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('csv_colCategory')}
                    </th>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'right',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('csv_colPrice')}
                    </th>
                    {showVat && (
                      <th
                        style={{
                          padding: '8px 10px',
                          textAlign: 'center',
                          fontSize: '0.7rem',
                          textTransform: 'uppercase',
                        }}
                      >
                        {t('csv_colVat')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((r) => (
                    <tr
                      key={r.rowNum}
                      style={{
                        borderBottom: `1px solid ${D.border}`,
                        opacity: r.errors.length === 0 ? 1 : 0.6,
                      }}
                    >
                      <td style={{ padding: '6px 10px', color: D.t3 }}>{r.rowNum}</td>
                      <td style={{ padding: '6px 10px' }}>
                        {r.errors.length === 0 ? (
                          <span style={{ color: D.green }}>✓</span>
                        ) : (
                          <span style={{ color: D.red, fontSize: '0.74rem' }}>
                            ✕ {r.errors.map((e) => csvRowErrorText(e, tr)).join(', ')}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', color: D.t1 }}>
                        {r.emoji} {r.name}
                      </td>
                      <td style={{ padding: '6px 10px', color: D.t2 }}>{r.category}</td>
                      <td
                        style={{
                          padding: '6px 10px',
                          textAlign: 'right',
                          color: D.t1,
                          fontWeight: 500,
                        }}
                      >
                        {r.price != null && !isNaN(r.price) ? t('money', { amount: r.price.toFixed(2) }) : '—'}
                      </td>
                      {showVat && (
                        <td style={{ padding: '6px 10px', textAlign: 'center', color: D.t3 }}>
                          {r.vat}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error == null ? null : (
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  background: D.redA,
                  color: D.red,
                  borderRadius: 8,
                  fontSize: '0.84rem',
                }}
              >
                {describeCsvImportError(error, tr, tc)}
              </div>
            )}

            {/* Plafonul planului — anunțat ÎNAINTE de import, nu ca eroare brută
                la mijloc. Zero locuri → mesaj clar; parțial → câte intră/rămân. */}
            {truncatedCount === 0 ? null : (
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  background: D.goldA,
                  color: D.t1,
                  borderRadius: 8,
                  fontSize: '0.82rem',
                  lineHeight: 1.5,
                }}
              >
                {importRows.length === 0
                  ? t('csv_limitFull')
                  : fillNodes(tp('csv_slots', importRows.length), {
                      lead: fillNodes(tp('csv_slotsLead', importRows.length), {
                        count: <strong>{importRows.length}</strong>,
                      }),
                      rest: tp('csv_slotsRest', truncatedCount),
                    })}
              </div>
            )}

            <div
              style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 12 }}
            >
              <button
                onClick={() => setStep('paste')}
                style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
              >
                {t('csv_back')}
              </button>
              <button
                onClick={() => void doImport()}
                disabled={importRows.length === 0}
                style={btn({ background: D.gold, color: '#000' })}
              >
                {tp('csv_importN', importRows.length)}
              </button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div style={{ padding: 30, textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: 16 }}>{progress < 100 ? '⏳' : '✅'}</div>
            <div
              style={{
                fontSize: '1.1rem',
                color: D.t1,
                marginBottom: 12,
                fontFamily: 'Fraunces,serif',
              }}
            >
              {progress < 100 ? t('csv_progress', { pct: progress }) : tp('csv_imported', importedCount)}
            </div>
            <div style={{ background: D.s3, height: 8, borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: D.gold,
                  transition: 'width .25s',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

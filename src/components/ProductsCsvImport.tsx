// ─────────────────────────────────────────────────────────────
// ProductsCsvImport — modal de import produse din CSV
//
// Format CSV așteptat (header line obligatoriu):
//   nume,categorie,pret,emoji,descriere,tva
//   Espresso,Cafele,8.00,☕,,1
//   Latte Macchiato,Cafele,14.00,🥛,Cafea cu lapte,1
//   Pizza Margherita,Pizza,28.00,🍕,Mozzarella + roșii,1
//
// Coloane:
//   • nume       (obligatoriu) — string
//   • categorie  (obligatoriu) — string. Auto-create dacă nu există.
//   • pret       (obligatoriu) — număr decimal cu . sau , ca separator
//   • emoji      (opțional)    — default 🍽️
//   • descriere  (opțional)    — text
//   • tva        (opțional)    — 1-4 (default 1)
//
// Acceptă atât , cât și ; ca delimitator (auto-detect).
// ─────────────────────────────────────────────────────────────
import { useState, useMemo, useRef } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'

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
}

interface ParsedRow {
  nume: string
  categorie: string
  pret: number | null
  emoji: string
  descriere: string
  tva: number
  // Validare
  errors: string[]
  rowNum: number // 1-indexed pentru afișare user
}

// ── Normalizare robustă preț ─────────────────────────────────
// Acceptă formate variate: "1.299,50" (RO mii cu ., zecimal cu ,),
// "1,299.50" (US/EN mii cu ,, zecimal cu .), "14.00", "14,00",
// spații, NBSP, simbol monedă ("lei", "RON", "€", "$") etc.
// Returnează number finit >= 0 sau null (= neparsabil → raportat userului,
// NU tratat tăcut ca 0).
function normalizePrice(raw: string): number | null {
  // Curăță spații (inclusiv NBSP/spații înguste) și simboluri monedă/litere
  let s = raw
    .replace(/[\u00A0\u202F\u2007\uFEFF\u2060]/g, ' ') // NBSP / narrow-NBSP / BOM etc -> spatiu normal
    .trim()
  if (s.length === 0) return null

  // Elimină tot ce nu e cifră, separator (. ,) sau semn minus
  // (scapă de "lei", "RON", "€", "$", spații dintre cifre, etc.)
  s = s.replace(/[^\d.,-]/g, '')
  if (s.length === 0) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')

  if (lastComma !== -1 && lastDot !== -1) {
    // Ambele separatoare prezente: cel care apare ULTIMUL e separatorul zecimal,
    // celălalt e separator de mii și se elimină.
    if (lastComma > lastDot) {
      // Format RO: "1.299,50" → mii ".", zecimal ","
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      // Format US/EN: "1,299.50" → mii ",", zecimal "."
      s = s.replace(/,/g, '')
    }
  } else if (lastComma !== -1) {
    // Doar virgulă prezentă.
    const parts = s.split(',')
    const decimals = parts[parts.length - 1] ?? ''
    if (parts.length > 2 || decimals.length === 3) {
      // Mai multe virgule, sau exact 3 cifre după ultima virgulă → separator de mii
      // (ex. "1,299" sau "1,234,567"). Eliminăm toate virgulele.
      s = s.replace(/,/g, '')
    } else {
      // O singură virgulă cu 1-2 (sau >3) zecimale → separator zecimal RO.
      s = s.replace(',', '.')
    }
  } else if (lastDot !== -1) {
    // Doar punct prezent.
    const parts = s.split('.')
    const decimals = parts[parts.length - 1] ?? ''
    if (parts.length > 2 || decimals.length === 3) {
      // Mai multe puncte, sau exact 3 cifre după ultimul punct → separator de mii
      // (ex. "1.299" sau "1.234.567"). Eliminăm toate punctele.
      s = s.replace(/\./g, '')
    }
    // altfel punctul e separator zecimal normal ("14.00") — lăsăm așa.
  }

  // Validare strictă: doar număr cu eventual semn și o singură parte zecimală
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null

  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return n
}

// ── CSV parser minimal (suportă quotes RFC4180) ──────────────
function parseCsv(text: string): string[][] {
  // Detect delimiter
  const firstLine = text.split('\n')[0] ?? ''
  const delim = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 2
        continue
      }
      if (ch === '"') {
        inQuotes = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delim) {
      row.push(cell)
      cell = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(cell)
      if (row.some((c) => c.trim().length > 0)) rows.push(row)
      row = []
      cell = ''
      i++
      continue
    }
    cell += ch
    i++
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    if (row.some((c) => c.trim().length > 0)) rows.push(row)
  }
  return rows
}

// ── Sample CSV template ──────────────────────────────────────
const TEMPLATE = `nume,categorie,pret,emoji,descriere,tva
Espresso,Cafele,8.00,☕,Cafea italiană pură,1
Cappuccino,Cafele,14.00,☕,Cu spumă de lapte,1
Latte Macchiato,Cafele,16.00,🥛,,1
Limonadă,Băuturi reci,14.00,🍋,Cu mentă proaspătă,1
Cheesecake,Prăjituri,16.00,🍰,Cu fructe de pădure,1
`

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
}: Props) {
  // Blochează scroll-ul paginii cât modalul e deschis (altfel pagina din spate
  // rămâne scrollabilă și modalul pare deplasat / cere scroll manual — fix #74).
  useBodyScrollLock(true)
  const [step, setStep] = useState<'paste' | 'preview' | 'importing'>('paste')
  const [csvText, setCsvText] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [importedCount, setImportedCount] = useState(0)

  // Resume idempotent pe RETRY după eșec parțial. Cursorul + categoriile create
  // (cheiate pe textul CSV) evită re-inserția batch-urilor DEJA CONFIRMATE. DAR
  // cursorul nu poate acoperi un batch COMIS-DAR-NECONFIRMAT pe rețea (serverul
  // l-a scris, ack-ul HTTP s-a pierdut → cursorul rămâne pe loc). De aceea, la
  // RETRY (a mai fost o încercare pe același CSV), re-verificăm în DB numele deja
  // existente și le sărim — dedup real, nu doar pe cursor.
  const insertedCursorRef = useRef(0)
  const createdCatsRef = useRef<Map<string, string>>(new Map())
  const importedCsvRef = useRef<string | null>(null)
  const attemptedImportRef = useRef(false)
  // Numele produselor dinaintea PRIMEI încercări — baseline pentru dedup-ul de
  // pe retry (vezi doImport). null = n-am putut citi ⇒ dedup dezactivat.
  const baselineNamesRef = useRef<Set<string> | null>(null)

  // Parse CSV
  const parsed = useMemo<ParsedRow[]>(() => {
    if (!csvText.trim()) return []
    const rows = parseCsv(csvText)
    if (rows.length < 2) return []
    const headerRow = rows[0]!.map((h) => h.trim().toLowerCase())
    const findCol = (name: string): number => headerRow.indexOf(name)

    const idxNume = findCol('nume')
    const idxCategorie = findCol('categorie')
    const idxPret = findCol('pret') !== -1 ? findCol('pret') : findCol('preț')
    const idxEmoji = findCol('emoji')
    const idxDescriere = findCol('descriere')
    const idxTva = findCol('tva')

    return rows.slice(1).map((r, i): ParsedRow => {
      const errs: string[] = []
      const nume = (r[idxNume] ?? '').trim()
      const categorie = (r[idxCategorie] ?? '').trim()
      const pretRaw = (r[idxPret] ?? '').trim()
      const pret = normalizePrice(pretRaw)
      const emoji = (r[idxEmoji] ?? '').trim() || '🍽️'
      const descriere = idxDescriere >= 0 ? (r[idxDescriere] ?? '').trim() : ''
      const tvaRaw = idxTva >= 0 ? (r[idxTva] ?? '').trim() : '1'
      const tva = tvaRaw.length > 0 ? parseInt(tvaRaw, 10) : 1

      if (!nume) errs.push('lipsește numele')
      if (!categorie) errs.push('lipsește categoria')
      if (pretRaw.length === 0) {
        errs.push('lipsește prețul')
      } else if (pret == null || !Number.isFinite(pret)) {
        // Valoare neparsabilă — raportăm explicit, NU o tratăm tăcut ca 0.
        errs.push(`preț neparsabil ("${pretRaw}")`)
      } else if (pret < 0) {
        errs.push('preț negativ')
      }
      if (![1, 2, 3, 4].includes(tva)) errs.push('TVA trebuie 1-4')
      if (nume.length > 100) errs.push('nume prea lung (>100)')

      return { nume, categorie, pret, emoji, descriere, tva, errors: errs, rowNum: i + 2 }
    })
  }, [csvText])

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
    const wanted = new Set(importRows.map((r) => r.categorie.toLowerCase()))
    return Array.from(wanted).filter((c) => !existing.has(c))
  }, [importRows, existingCategories])

  function downloadTemplate() {
    const blob = new Blob(['\uFEFF' + TEMPLATE], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'template-produse-menuvia.csv'
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
    const isRetry = attemptedImportRef.current && importedCsvRef.current === csvText
    attemptedImportRef.current = true

    // CSV nou (față de ultima încercare) → resetăm cursorul de resume. Un retry
    // pe ACELAȘI CSV păstrează cursorul și sare peste ce s-a inserat deja.
    if (importedCsvRef.current !== csvText) {
      insertedCursorRef.current = 0
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
      const readNames = async (): Promise<Set<string> | null> => {
        const { data, error: exErr } = await supabase
          .from('products')
          .select('name')
          .eq('restaurant_id', restaurantId)
        if (exErr) return null
        return new Set((data ?? []).map((p) => (p.name as string).trim().toLowerCase()))
      }

      // Baseline = numele dinaintea PRIMEI încercări. Fără el nu putem distinge
      // „produs pus de importul ăsta" de „produs care era deja în meniu".
      if (!isRetry) baselineNamesRef.current = await readNames()

      let dbNames: Set<string> | null = null
      if (isRetry && baselineNamesRef.current) {
        const current = await readNames()
        const baseline = baselineNamesRef.current
        // Doar ce a apărut ÎNTRE timp = inserat de acest import.
        if (current) dbNames = new Set([...current].filter((n) => !baseline.has(n)))
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
      if (isRetry) {
        const { data: freshCats } = await supabase
          .from('categories')
          .select('id, name')
          .eq('restaurant_id', restaurantId)
        for (const c of freshCats ?? []) {
          catMap.set((c.name as string).toLowerCase(), c.id as string)
        }
      }
      for (const [k, v] of createdCatsRef.current) catMap.set(k, v)
      for (const [index, newCatName] of newCategories.entries()) {
        if (catMap.has(newCatName)) continue // deja creată la o încercare anterioară
        const original =
          importRows.find((r) => r.categorie.toLowerCase() === newCatName)?.categorie || newCatName
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
        if (catErr) throw new Error(`Eroare la categoria "${original}": ${catErr.message}`)
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
      let cursor = insertedCursorRef.current
      let added = 0
      for (let i = insertedCursorRef.current; i < importRows.length; i += batchSize) {
        const batch = importRows.slice(i, i + batchSize)
        let rows = batch.map((r) => ({
          restaurant_id: restaurantId,
          category_id: catMap.get(r.categorie.toLowerCase())!,
          name: r.nume,
          description: r.descriere || null,
          price: r.pret!,
          emoji: r.emoji,
          vat_group: r.tva,
          is_active: true,
        }))
        if (dbNames) {
          const names = dbNames
          rows = rows.filter((r) => !names.has(r.name.trim().toLowerCase()))
        }
        if (rows.length > 0) {
          const { error: insErr } = await supabase.from('products').insert(rows)
          if (insErr) throw new Error(`Eroare la batch ${i}: ${insErr.message}`)
          added += rows.length
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

      setImportedCount(added)
      // Brief delay before closing for user to see 100%
      setTimeout(() => onDone(added), 500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscută la import')
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
            📥 Import produse din CSV
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
          Util pentru migrare rapidă de la alt soft (SmartBill, Octopus, Excel manual).
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
              <strong style={{ color: D.t1 }}>Format așteptat (CSV cu header):</strong>
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
                {`nume,categorie,pret,emoji,descriere,tva
Espresso,Cafele,8.00,☕,,1
Latte,Cafele,14.00,🥛,Cu lapte,1`}
              </pre>
              <div style={{ marginTop: 8, fontSize: '0.76rem' }}>
                <strong style={{ color: D.t1 }}>Coloane:</strong> <em>nume</em> și{' '}
                <em>categorie</em> și <em>pret</em> obligatorii. Categoriile inexistente se creează
                automat. TVA = 1-4 (default 1).
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={downloadTemplate}
                style={btn({ background: D.s2, color: D.t1, border: `1px solid ${D.border}` })}
              >
                📄 Descarcă template CSV
              </button>
              <label
                style={{
                  ...btn({ background: D.s2, color: D.t1, border: `1px solid ${D.border}` }),
                  cursor: 'pointer',
                }}
              >
                📁 Încarcă fișier CSV
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
                Sau lipește CSV direct:
              </div>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder="nume,categorie,pret,emoji,descriere,tva..."
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

            {parsed.length > 0 && (
              <div style={{ fontSize: '0.84rem', color: D.t2 }}>
                Detectate <strong style={{ color: D.t1 }}>{parsed.length}</strong> rânduri:{' '}
                <span style={{ color: D.green }}>{validRows.length} valide</span>
                {invalidRows.length > 0 && (
                  <span style={{ color: D.red }}>, {invalidRows.length} cu erori</span>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 'auto' }}>
              <button
                onClick={onClose}
                style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
              >
                Anulează
              </button>
              <button
                onClick={() => setStep('preview')}
                disabled={validRows.length === 0}
                style={btn({
                  background: validRows.length > 0 ? D.gold : D.s3,
                  color: validRows.length > 0 ? '#000' : D.t3,
                })}
              >
                Previzualizare →
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
                <strong>{validRows.length}</strong> produse vor fi create.
                {newCategories.length > 0 && (
                  <>
                    {' '}
                    Se vor crea și <strong>{newCategories.length}</strong> categorii noi:{' '}
                    {newCategories.join(', ')}
                  </>
                )}
              </div>
              {invalidRows.length > 0 && (
                <div style={{ color: D.amber, marginTop: 4 }}>
                  ⚠ {invalidRows.length} rânduri vor fi sărite (au erori).
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
                      Status
                    </th>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                      }}
                    >
                      Nume
                    </th>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                      }}
                    >
                      Categorie
                    </th>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'right',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                      }}
                    >
                      Preț
                    </th>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'center',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                      }}
                    >
                      TVA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((r) => (
                    <tr
                      key={r.rowNum}
                      style={{
                        borderBottom: `1px solid ${D.border}`,
                        opacity: r.errors.length > 0 ? 0.6 : 1,
                      }}
                    >
                      <td style={{ padding: '6px 10px', color: D.t3 }}>{r.rowNum}</td>
                      <td style={{ padding: '6px 10px' }}>
                        {r.errors.length === 0 ? (
                          <span style={{ color: D.green }}>✓</span>
                        ) : (
                          <span style={{ color: D.red, fontSize: '0.74rem' }}>
                            ✕ {r.errors.join(', ')}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', color: D.t1 }}>
                        {r.emoji} {r.nume}
                      </td>
                      <td style={{ padding: '6px 10px', color: D.t2 }}>{r.categorie}</td>
                      <td
                        style={{
                          padding: '6px 10px',
                          textAlign: 'right',
                          color: D.t1,
                          fontWeight: 500,
                        }}
                      >
                        {r.pret != null && !isNaN(r.pret) ? `${r.pret.toFixed(2)} lei` : '—'}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center', color: D.t3 }}>
                        {r.tva}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && (
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
                {error}
              </div>
            )}

            {/* Plafonul planului — anunțat ÎNAINTE de import, nu ca eroare brută
                la mijloc. Zero locuri → mesaj clar; parțial → câte intră/rămân. */}
            {truncatedCount > 0 && (
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
                {importRows.length === 0 ? (
                  <>
                    Ai atins limita de produse a planului tău — importul nu poate adăuga
                    produse noi. Șterge produse sau treci la un plan mai mare.
                  </>
                ) : (
                  <>
                    Planul tău mai are loc pentru <strong>{importRows.length}</strong>{' '}
                    {importRows.length === 1 ? 'produs' : 'produse'} — se importă primele{' '}
                    {importRows.length}, iar {truncatedCount}{' '}
                    {truncatedCount === 1 ? 'rând rămâne' : 'rânduri rămân'} pe dinafară.
                  </>
                )}
              </div>
            )}

            <div
              style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 12 }}
            >
              <button
                onClick={() => setStep('paste')}
                style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
              >
                ← Înapoi
              </button>
              <button
                onClick={() => void doImport()}
                disabled={importRows.length === 0}
                style={btn({ background: D.gold, color: '#000' })}
              >
                Importă {importRows.length} produse →
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
              {progress < 100
                ? `Import în progres... ${progress}%`
                : `${importedCount} produse importate!`}
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

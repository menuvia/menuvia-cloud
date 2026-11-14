// src/lib/productsCsv.ts — parserul și validatorul importului de produse din
// CSV (ProductsCsvImport), scoși din componentă în lotul L5a2 ca să poată fi
// testați fără DOM. FĂRĂ text: erorile de rând sunt CODURI (cu parametri),
// traduse la randare de `csvRowErrorText` (lib/importMessages.ts), iar antetele
// șablonului vin din namespace-ul `imports`.
//
// Format (rând de antet obligatoriu), de exemplu în română:
//   nume,categorie,pret,emoji,descriere,tva
//   Espresso,Cafele,8.00,☕,,1
// Coloane:
//   • nume       (obligatoriu) — string
//   • categorie  (obligatoriu) — string. Se creează dacă nu există.
//   • pret       (obligatoriu) — număr zecimal cu . sau , ca separator
//   • emoji      (opțional)    — implicit 🍽️
//   • descriere  (opțional)    — text
//   • tva        (opțional)    — 1-4 (implicit 1). DOAR pe planul cu bon
//                               (`showVat`, planSurface.vat — lotul P): pe
//                               Planurile 1–2 coloana nu se citește (grupa 1).
// ANTETELE se recunosc în oricare dintre cele patru limbi ale personalului
// (`CSV_HEADER_ALIASES`): un șablon descărcat în germană se re-importă și de
// un coleg care lucrează în română. Ce mergea înainte merge neschimbat:
// potrivirea exactă (fără majuscule) pe antetele românești câștigă întâi,
// abia apoi se caută fără diacritice în toate limbile.
// Delimitatorul: , sau ; (detectat din primul rând). Valorile din celule
// (numele produselor) NU se traduc niciodată.

export type CsvColumn = 'name' | 'category' | 'price' | 'emoji' | 'description' | 'vat'

// Regula de dinainte (identică): antetul tăiat + litere mici, egal cu unul din
// acestea, în ordine (`pret` înaintea lui `preț`).
const LEGACY_HEADERS: Readonly<Record<CsvColumn, readonly string[]>> = {
  name: ['nume'],
  category: ['categorie'],
  price: ['pret', 'preț'],
  emoji: ['emoji'],
  description: ['descriere'],
  vat: ['tva'],
}

/** Antetele acceptate pentru fiecare coloană — ro, en, fr, de (cele din
 *  șabloanele `imports.csv_head_*`, plus „mwst.”/„ust”/„ust.” în germană). Se compară
 *  după `normalizeCsvHeader` (fără majuscule, diacritice, BOM, spații). */
export const CSV_HEADER_ALIASES: Readonly<Record<CsvColumn, readonly string[]>> = {
  name: ['nume', 'name', 'nom'],
  category: ['categorie', 'category', 'catégorie', 'kategorie'],
  price: ['preț', 'price', 'prix', 'preis'],
  emoji: ['emoji'],
  description: ['descriere', 'description', 'beschreibung'],
  vat: ['tva', 'vat', 'mwst', 'mwst.', 'ust', 'ust.'],
}

/** Antetul în forma de comparație: fără BOM, fără diacritice, fără spații la
 *  capete, litere mici („Catégorie” → „categorie”, „Preț” → „pret”). */
export function normalizeCsvHeader(h: string): string {
  return h
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/** Indexul fiecărei coloane în rândul de antet (-1 = lipsește). Fără TVA pe
 *  plan, coloana TVA se ignoră (nici citită, nici validată). */
export function csvColumnIndexes(headerRow: readonly string[], showVat: boolean): Record<CsvColumn, number> {
  const legacy = headerRow.map((h) => h.trim().toLowerCase())
  const norm = headerRow.map(normalizeCsvHeader)
  const find = (col: CsvColumn): number => {
    for (const a of LEGACY_HEADERS[col]) {
      const i = legacy.indexOf(a)
      if (i !== -1) return i
    }
    for (const a of CSV_HEADER_ALIASES[col]) {
      const i = norm.indexOf(normalizeCsvHeader(a))
      if (i !== -1) return i
    }
    return -1
  }
  return {
    name: find('name'),
    category: find('category'),
    price: find('price'),
    emoji: find('emoji'),
    description: find('description'),
    vat: showVat ? find('vat') : -1,
  }
}

// ── Normalizare robustă preț ─────────────────────────────────
// Acceptă formate variate: "1.299,50" (RO mii cu ., zecimal cu ,),
// "1,299.50" (US/EN mii cu ,, zecimal cu .), "14.00", "14,00",
// spații, NBSP, simbol monedă ("lei", "RON", "€", "$") etc.
// Returnează number finit sau null (= neparsabil → raportat userului,
// NU tratat tăcut ca 0).
export function normalizeCsvPrice(raw: string): number | null {
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
export function parseCsvRows(text: string): string[][] {
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

/** O eroare de RÂND, ca DATE (tradusă la randare). */
export type CsvRowError =
  | { code: 'missing_name' }
  | { code: 'missing_category' }
  | { code: 'missing_price' }
  | { code: 'bad_price'; raw: string }
  | { code: 'negative_price' }
  | { code: 'bad_vat' }
  | { code: 'name_too_long' }

export interface ParsedCsvRow {
  name: string
  category: string
  price: number | null
  emoji: string
  description: string
  vat: number
  errors: CsvRowError[]
  rowNum: number // 1-indexed pentru afișare user
}

/** Rândurile de date ale unui CSV de produse, validate. Mai puțin de două
 *  rânduri (antet + date) → listă goală. */
export function parseProductsCsv(text: string, showVat: boolean): ParsedCsvRow[] {
  if (!text.trim()) return []
  const rows = parseCsvRows(text)
  if (rows.length < 2) return []
  const idx = csvColumnIndexes(rows[0]!, showVat)

  return rows.slice(1).map((r, i): ParsedCsvRow => {
    const errs: CsvRowError[] = []
    const name = (r[idx.name] ?? '').trim()
    const category = (r[idx.category] ?? '').trim()
    const priceRaw = (r[idx.price] ?? '').trim()
    const price = normalizeCsvPrice(priceRaw)
    const emoji = (r[idx.emoji] ?? '').trim() || '🍽️'
    const description = idx.description >= 0 ? (r[idx.description] ?? '').trim() : ''
    const vatRaw = idx.vat >= 0 ? (r[idx.vat] ?? '').trim() : '1'
    const vat = vatRaw.length > 0 ? parseInt(vatRaw, 10) : 1

    if (!name) errs.push({ code: 'missing_name' })
    if (!category) errs.push({ code: 'missing_category' })
    if (priceRaw.length === 0) {
      errs.push({ code: 'missing_price' })
    } else if (price == null || !Number.isFinite(price)) {
      // Valoare neparsabilă — raportăm explicit, NU o tratăm tăcut ca 0.
      errs.push({ code: 'bad_price', raw: priceRaw })
    } else if (price < 0) {
      errs.push({ code: 'negative_price' })
    }
    if (![1, 2, 3, 4].includes(vat)) errs.push({ code: 'bad_vat' })
    if (name.length > 100) errs.push({ code: 'name_too_long' })

    return { name, category, price, emoji, description, vat, errors: errs, rowNum: i + 2 }
  })
}

/** Același text fără ULTIMA coloană pe fiecare rând (TVA, pe Planurile 1–2 —
 *  lotul P). Un rând gol rămâne gol. */
export function dropLastCsvColumn(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/,[^,]*$/, ''))
    .join('\n')
}

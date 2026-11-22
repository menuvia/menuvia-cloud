// ─────────────────────────────────────────────────────────────
// tableSlug.ts — slug-ul mesei (identificator intern, `tables.slug`), scos
// din TablesManager în lotul L6a. E o DATĂ, nu un text de ecran: NU urmează
// limba personalului, fiindcă generarea rapidă („Câte mese ai?”) își găsește
// numerele LIBERE după el — un prefix care s-ar schimba cu limba ecranului ar
// crea, pe aceleași mese, a doua serie de slug-uri.
// Tot aici stă și NUMELE mesei create de generarea rapidă: e tot o DATĂ —
// apare pe cardul QR TIPĂRIT (care urmează limba MENIULUI, nu a personalului)
// și în meniul oaspetelui.
//
// SERIILE (precondiția B7 a activării limbilor): onboarding-ul creează mesele
// în limba funnel-ului (`step3_tableName`/`step3_tableSlug` din `onboarding`:
// „Masa N”/`masa-N`, „Table N”/`table-N`, „Tisch N”/`tisch-N`), iar generarea
// rapidă cunoștea doar `masa-N`. După un onboarding în germană cu 5 mese,
// „generează până la 8” crea „Masa 1…3” — numere DUBLATE și două limbi pe
// ecranul ospătarului, pe tichetul de bucătărie și pe cardurile tipărite.
// Acum: un număr e ocupat în ORICARE serie, iar mesele noi continuă seria
// localului (cea mai folosită; la egalitate, ordinea din SERIES); fără nicio
// masă numerotată, seria vine din limba de BAZĂ a meniului (ro → Masa, en/fr
// → Table, de → Tisch, oricare alta → Masa, ca înainte).
// ─────────────────────────────────────────────────────────────

const PREFIX = 'masa'
/** Seriile de mese numerotate, cu numele lor (slug-ul = cheia). */
const SERIES = { masa: 'Masa', table: 'Table', tisch: 'Tisch' } as const
export type TableSeries = keyof typeof SERIES
const SERIES_ORDER = Object.keys(SERIES) as TableSeries[]
const BULK_RE = /^(masa|table|tisch)-(\d+)$/
/** Limba de bază a meniului → seria implicită (aceleași cuvinte ca onboarding-ul). */
const SERIES_BY_LANG: Readonly<Record<string, TableSeries>> = { ro: 'masa', en: 'table', fr: 'table', de: 'tisch' }

/** Numele mesei → slug (litere mici, cratime); gol → `masa`. */
export function slugifyTable(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^-|-$/g, '') || PREFIX
  )
}

/** Slug-ul mesei nr. `n` creată de generarea rapidă: `masa-N` (sau seria dată). */
export function bulkTableSlug(n: number, series: TableSeries = 'masa'): string {
  return `${series}-${n}`
}

/** Numele mesei nr. `n` creată de generarea rapidă: `Masa N` (sau seria dată; dată, nu text de ecran). */
export function bulkTableName(n: number, series: TableSeries = 'masa'): string {
  return `${SERIES[series]} ${n}`
}

function parseBulk(slug: string | null | undefined): { series: TableSeries; n: number } | null {
  const m = BULK_RE.exec(slug || '')
  return m ? { series: m[1] as TableSeries, n: parseInt(m[2], 10) } : null
}

/** Numărul unei mese numerotate (`masa-N` / `table-N` / `tisch-N` → N), altfel `null`. */
export function bulkTableNumber(slug: string | null | undefined): number | null {
  return parseBulk(slug)?.n ?? null
}

/**
 * Seria în care continuă generarea rapidă: cea mai folosită dintre mesele
 * numerotate existente (egalitate → ordinea `masa`, `table`, `tisch`); fără
 * nicio masă numerotată, cea a limbii de bază a meniului (necunoscută → `masa`).
 */
export function bulkTableSeries(
  slugs: readonly (string | null | undefined)[],
  baseLang: string | null | undefined,
): TableSeries {
  const counts = new Map<TableSeries, number>()
  for (const s of slugs) {
    const hit = parseBulk(s)
    if (hit) counts.set(hit.series, (counts.get(hit.series) ?? 0) + 1)
  }
  let best: TableSeries | null = null
  for (const series of SERIES_ORDER) {
    const c = counts.get(series) ?? 0
    if (c > 0 && (best === null || c > (counts.get(best) ?? 0))) best = series
  }
  return best ?? SERIES_BY_LANG[baseLang ?? ''] ?? 'masa'
}

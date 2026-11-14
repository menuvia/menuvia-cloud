// ─────────────────────────────────────────────────────────────
// tableSlug.ts — slug-ul mesei (identificator intern, `tables.slug`), scos
// din TablesManager în lotul L6a. E o DATĂ, nu un text de ecran: rămâne
// `masa`/`masa-N` în orice limbă a personalului, fiindcă generarea rapidă
// („Câte mese ai?”) își găsește numerele LIBERE după el — un prefix care s-ar
// schimba cu limba ar crea, pe aceleași mese, a doua serie de slug-uri.
// Comportament identic cu funcțiile de dinainte din TablesManager.
// Tot aici stă și NUMELE mesei create de generarea rapidă (`Masa N`): e tot o
// DATĂ — apare pe cardul QR TIPĂRIT (care urmează limba MENIULUI, nu a
// personalului) și în meniul oaspetelui —, deci rămâne în română în orice
// limbă a personalului, exact ca înainte de L6a.
// ─────────────────────────────────────────────────────────────

const PREFIX = 'masa'
const BULK_NAME = 'Masa'
const BULK_RE = /^masa-(\d+)$/

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

/** Slug-ul mesei nr. `n` creată de generarea rapidă: `masa-N`. */
export function bulkTableSlug(n: number): string {
  return `${PREFIX}-${n}`
}

/** Numele mesei nr. `n` creată de generarea rapidă: `Masa N` (dată, nu text de ecran). */
export function bulkTableName(n: number): string {
  return `${BULK_NAME} ${n}`
}

/** Numărul unei mese din generarea rapidă (`masa-N` → N), altfel `null`. */
export function bulkTableNumber(slug: string | null | undefined): number | null {
  const m = BULK_RE.exec(slug || '')
  return m ? parseInt(m[1], 10) : null
}

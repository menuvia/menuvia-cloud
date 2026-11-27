// ─────────────────────────────────────────────────────────────
// tableSort.ts — ordinea NATURALĂ a meselor (lotul C5b).
//
// `.order('name')` din PostgREST sortează numele ca TEXT: „Masa 1, Masa 10,
// Masa 11, Masa 2”. Ordinea asta ajungea neschimbată în Mese & QR, pe
// cardurile PDF-ului tipărit (în ordinea listei), în grila de mese a
// ospătarului (fiecare comandă nouă), în selectul de masă al rezervării, în
// alocarea meselor și în dropdown-ul de legare de pe hartă. Doar „Stadiu mese”
// sorta numeric, cu `localeCompare` propriu. Acum toate trec prin ACEST
// comparator, aplicat pe client după fiecare citire (`sortTablesByName`).
//
// Numele mesei e o DATĂ (nu se traduce), deci ordinea nu depinde de limba
// personalului: colatorul e fix pe `ro`, cu `numeric: true` (2 < 10) și
// `sensitivity: 'base'` (majusculele nu contează).
//
// Diacriticele se scot din CHEIA de comparare (NFD + fără semne combinate):
// în colația românească ă/â/î/ș/ț sunt litere PRIMARE distincte, deci
// `sensitivity: 'base'` singur NU le ignoră — măsurat: compare('Terasa 3',
// 'Terasă 3') = -1, iar „Terasa 2” ajungea înaintea lui „Terasă 1”. Aceeași
// zonă scrisă o dată cu și o dată fără diacritice (cazul obișnuit la mese
// tastate de mână) se despărțea în două șiruri.
//
// La egalitate (aceeași cheie: „masa 1” / „Masa 1”, „Terasa 1” / „Terasă 1”)
// decide numele original în colația românească, apoi slug-ul, apoi id-ul —
// ordinea e TOTALĂ, deci stabilă între reîncărcări (PDF-ul iese mereu la fel).
// ─────────────────────────────────────────────────────────────

/** Minimul de care are nevoie comparatorul: numele, plus departajarea. */
export interface TableNameLike {
  name: string
  slug?: string | null
  id?: string | null
}

// Colatoarele se creează la PRIMA comparare, nu la încărcarea modulului:
// lib/orders.ts (care îl importă pentru `fetchTables`) e și în graful meniului
// QR, iar oaspetele nu sortează niciodată mese.
let collators: { base: Intl.Collator; exact: Intl.Collator } | null = null
function getCollators(): { base: Intl.Collator; exact: Intl.Collator } {
  if (!collators)
    collators = {
      base: new Intl.Collator('ro', { numeric: true, sensitivity: 'base' }),
      exact: new Intl.Collator('ro', { numeric: true }),
    }
  return collators
}

/** Cheia de comparare: fără diacritice și fără spațiile de la capete. */
export function tableNameKey(name: string): string {
  // `?? ''`: un rând fără nume (mock, răspuns parțial) nu are voie să rupă
  // sortarea întregii liste.
  return (name ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim()
}

function codeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Comparatorul meselor: natural (2 < 10), fără majuscule și diacritice; total. */
export function compareTableNames(a: TableNameLike, b: TableNameLike): number {
  const { base, exact } = getCollators()
  const an = a.name ?? ''
  const bn = b.name ?? ''
  return (
    base.compare(tableNameKey(an), tableNameKey(bn)) ||
    exact.compare(an, bn) ||
    codeUnits(an, bn) ||
    codeUnits(a.slug ?? '', b.slug ?? '') ||
    codeUnits(a.id ?? '', b.id ?? '')
  )
}

/** O copie sortată natural (lista primită rămâne neatinsă). */
export function sortTablesByName<T extends TableNameLike>(
  rows: readonly T[] | null | undefined,
): T[] {
  return [...(rows ?? [])].sort(compareTableNames)
}

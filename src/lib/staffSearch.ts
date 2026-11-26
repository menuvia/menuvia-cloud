// ─────────────────────────────────────────────────────────────
// Căutarea din ecranele personalului (lotul C4a): lista de produse din
// Meniu → Produse, „Alege produsele” din Meniu → Opțiuni și panoul „Epuizate”
// al bucătăriei / ospătarului.
//
// Înainte fiecare făcea `name.toLowerCase().includes(q.toLowerCase())`: fără
// plierea diacriticelor (cine tasta „ciorba” nu găsea „Ciorbă”), lista de
// produse nici măcar cu `trim()` (un spațiu tastat la final golea lista) și fără
// descriere. Regula e acum cea a meniului oaspetelui (`normalizeMenuSearch`,
// QrMenuPage / PublicMenuPage). Textul fiecărui element se normalizează O
// SINGURĂ DATĂ (indexul, memoizat de apelant pe listă); la fiecare tastă se
// normalizează doar interogarea.
// ─────────────────────────────────────────────────────────────
import { normalizeMenuSearch } from './i18nMenu'

export interface SearchEntry<T> {
  item: T
  hay: string
}

/** Indexul: câmpurile elementului (nume, descriere…) lipite și normalizate o dată. */
export function buildSearchIndex<T>(
  items: readonly T[],
  fields: (item: T) => ReadonlyArray<string | null | undefined>,
): SearchEntry<T>[] {
  return items.map((item) => ({
    item,
    hay: normalizeMenuSearch(
      fields(item)
        .filter((f): f is string => typeof f === 'string' && f.length > 0)
        .join(' '),
    ),
  }))
}

/** Interogarea normalizată: fără spații la capete, fără diacritice, litere mici. */
export function normalizeSearchQuery(query: string): string {
  return normalizeMenuSearch(query.trim())
}

/** Elementele care conțin interogarea, în ordinea indexului; interogare goală → toate. */
export function filterSearchIndex<T>(index: readonly SearchEntry<T>[], query: string): T[] {
  const q = normalizeSearchQuery(query)
  return q ? index.filter((e) => e.hay.includes(q)).map((e) => e.item) : index.map((e) => e.item)
}

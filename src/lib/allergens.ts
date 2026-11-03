import { ALLERGENS } from './constants'
import { Tf, allergenLabel } from './guestI18n'

// Lista de alergeni afișată pe cardurile meniului oaspetelui (lotul C) —
// pură, separată de componentă (react-refresh cere ca un fișier .tsx să
// exporte doar componente). Regulile sunt în antetul lui
// components/menu/AllergenIcons.tsx.

type Allergen = (typeof ALLERGENS)[number]
const ORDER = new Map<string, number>(ALLERGENS.map((a, i): [string, number] => [a.id, i]))
const BY_ID = new Map<string, Allergen>(ALLERGENS.map((a): [string, Allergen] => [a.id, a]))
const UNKNOWN_EMOJI = '⚠️'

export interface AllergenEntry {
  id: string
  emoji: string
  label: string
}

/** Lista afișată: deduplicată, în ordinea canonică, cu necunoscutele la final. */
export function allergenEntries(
  allergens: readonly string[] | null | undefined,
  lang: string,
): AllergenEntry[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const raw of allergens ?? []) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  // Necunoscutele după cele 14, în ordinea în care au venit (sort stabil).
  const rank = (id: string): number => ORDER.get(id) ?? ALLERGENS.length
  ids.sort((a, b) => rank(a) - rank(b))
  return ids.map((id) => {
    const a = BY_ID.get(id)
    return a
      ? { id, emoji: a.emoji, label: allergenLabel(lang, a.id, a.label) }
      : { id, emoji: UNKNOWN_EMOJI, label: id }
  })
}

/** „Alergeni: Gluten, Lapte” în limba aleasă, sau null fără alergeni. Textul
 *  accesibil al pictogramelor ȘI al cardului: Grid și Photo au `aria-label`
 *  pe buton, care înlocuiește numele calculat din conținut (iar copiii unui
 *  <button> sunt prezentaționali), deci acolo lista trebuie pusă explicit. */
export function allergenListLabel(
  allergens: readonly string[] | null | undefined,
  lang: string,
): string | null {
  const entries = allergenEntries(allergens, lang)
  if (entries.length === 0) return null
  return Tf(lang, 'allergens_list_aria', { list: entries.map((e) => e.label).join(', ') })
}

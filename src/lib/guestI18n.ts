// ─────────────────────────────────────────────────────────────
// guestI18n — ajutoare PURE peste T() pentru fluxul oaspetelui:
// interpolare `{nume}`, etichetele de alergeni/etichete dietetice și
// microcopy-ul min/max al grupurilor de opțiuni în limba aleasă.
// ─────────────────────────────────────────────────────────────
import { T, type PublicMenuStringKey } from './publicMenuStrings'

/** T() cu substituții `{nume}`. O variabilă lipsă rămâne vizibilă ca `{nume}`
 *  (bug evident în UI), nu dispare tăcut. */
export function Tf(
  lang: string | null | undefined,
  key: PublicMenuStringKey,
  vars: Readonly<Record<string, string | number>>,
): string {
  return T(lang, key).replace(/\{(\w+)\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  )
}

const ALLERGEN_KEYS: Readonly<Record<string, PublicMenuStringKey>> = {
  gluten: 'allergen_gluten',
  crustacee: 'allergen_crustacee',
  oua: 'allergen_oua',
  peste: 'allergen_peste',
  arahide: 'allergen_arahide',
  soia: 'allergen_soia',
  lapte: 'allergen_lapte',
  nuci: 'allergen_nuci',
  telina: 'allergen_telina',
  mustar: 'allergen_mustar',
  susan: 'allergen_susan',
  sulfiti: 'allergen_sulfiti',
  lupin: 'allergen_lupin',
  molusce: 'allergen_molusce',
}

const DIETARY_KEYS: Readonly<Record<string, PublicMenuStringKey>> = {
  signature: 'diet_signature',
  nou: 'diet_nou',
  vegetarian: 'diet_vegetarian',
  vegan: 'diet_vegan',
  'fara-gluten': 'diet_fara_gluten',
  'fara-lactoza': 'diet_fara_lactoza',
  picant: 'diet_picant',
  raw: 'diet_raw',
}

/** Eticheta alergenului în limba oaspetelui; id necunoscut → `fallback`
 *  (eticheta din constants), ca un alergen nou să nu dispară din fișă. */
export function allergenLabel(lang: string, id: string, fallback: string): string {
  const k = ALLERGEN_KEYS[id]
  return k ? T(lang, k) : fallback
}

export function dietaryLabel(lang: string, id: string, fallback: string): string {
  const k = DIETARY_KEYS[id]
  return k ? T(lang, k) : fallback
}

/** Id-urile acoperite — pentru clichetul care cere ca TOATE id-urile din
 *  ALLERGENS/DIETARY_TAGS (constants) să aibă traducere. */
export const TRANSLATED_ALLERGEN_IDS: readonly string[] = Object.keys(ALLERGEN_KEYS)
export const TRANSLATED_DIETARY_IDS: readonly string[] = Object.keys(DIETARY_KEYS)

/** Oglinda lui `modifierGroupHint` (lib/qr) în limba oaspetelui — aceeași
 *  regulă: doar pe grupurile multiple; `min` vine din `modifierGroupMin`. */
export function modifierGroupHintT(
  lang: string,
  g: { selection_type: string; max_select: number | null },
  min: number,
): string | null {
  if (g.selection_type !== 'multiple') return null
  const max = g.max_select
  if (min > 0 && max != null) {
    return min === max
      ? Tf(lang, 'mod_choose_exact', { n: min })
      : Tf(lang, 'mod_choose_between', { min, max })
  }
  if (min > 0) return Tf(lang, 'mod_choose_at_least', { n: min })
  if (max != null) return Tf(lang, 'mod_choose_max', { n: max })
  return null
}

const LOCALES: Readonly<Record<string, string>> = {
  ro: 'ro-RO',
  en: 'en-GB',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
  hu: 'hu-HU',
  es: 'es-ES',
}

/** Locale BCP 47 pentru Intl (date, sortare) în limba oaspetelui; limbă
 *  nesuportată → en-GB, aceeași regulă de fallback ca T(). */
export function guestLocale(lang: string): string {
  return LOCALES[lang] ?? 'en-GB'
}

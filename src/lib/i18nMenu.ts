// ─────────────────────────────────────────────────────────────
// i18nMenu — meniu multilingv (traduceri manuale)
//
// Româna (`ro`) e ÎNTOTDEAUNA baza: originalul stă în coloanele
// `name` / `description` ale produselor și categoriilor. Traducerile
// manuale pentru celelalte limbi trăiesc în coloana jsonb `translations`
// (cheia = codul de limbă → { name?, description? }).
//
// Helper-ele de mai jos sunt PURE și fac fallback la original când
// traducerea lipsește sau e goală — clientul nu rămâne niciodată cu un
// câmp gol dacă restaurantul n-a tradus încă un produs.
// ─────────────────────────────────────────────────────────────

export interface MenuLang {
  code: string
  label: string
  flag: string
}

// Limbile disponibile în switcher. `ro` e mereu prima (baza / originalul).
export const MENU_LANGS: MenuLang[] = [
  { code: 'ro', label: 'Română', flag: '🇷🇴' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'hu', label: 'Magyar', flag: '🇭🇺' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
]

// Structura coloanei `translations` (products/categories): cheia = cod de
// limbă (`en`, `de`, …), valoarea = câmpurile traduse (opționale).
export type Translations = Record<string, { name?: string; description?: string }>

// Întoarce numele localizat al unui produs/categorie pe limba cerută.
// Fallback la original (coloana `name`) pentru `ro`, lipsă traducere sau
// traducere goală (string gol după trim).
export function trName(
  item: { name: string; translations?: Translations | null },
  lang: string,
): string {
  if (lang === 'ro') return item.name
  const t = item.translations?.[lang]?.name
  if (typeof t === 'string' && t.trim().length > 0) return t
  return item.name
}

// Întoarce descrierea localizată. Fallback la original (`description`) pe
// aceeași regulă. Poate întoarce null dacă originalul e null și nu există
// traducere validă.
export function trDesc(
  item: { description: string | null; translations?: Translations | null },
  lang: string,
): string | null {
  if (lang === 'ro') return item.description
  const t = item.translations?.[lang]?.description
  if (typeof t === 'string' && t.trim().length > 0) return t
  return item.description
}

// Limbile EXTRA (fără `ro`) în care meniul chiar e tradus — derivate din
// conținutul real, nu dintr-un flag de restaurant. Astfel switcher-ul de pe
// meniul clientului apare EXACT pentru limbile care au măcar o traducere
// nevidă (nume sau descriere) pe un produs/categorie. Evită dependența de o
// coloană expusă prin RPC și e mai onest cu clientul (nu oferă o limbă goală).
// Ordinea urmează MENU_LANGS. `categories` = catalogul deja adus în client.
export function availableMenuLangs(
  categories: {
    translations?: Translations | null
    products?: { translations?: Translations | null }[]
  }[],
): string[] {
  const found = new Set<string>()
  const scan = (tr: Translations | null | undefined): void => {
    if (!tr) return
    for (const code of Object.keys(tr)) {
      if (code === 'ro') continue
      const v = tr[code]
      if (
        (typeof v?.name === 'string' && v.name.trim().length > 0) ||
        (typeof v?.description === 'string' && v.description.trim().length > 0)
      ) {
        found.add(code)
      }
    }
  }
  for (const c of categories) {
    scan(c.translations)
    for (const p of c.products ?? []) scan(p.translations)
  }
  // Păstrează doar limbile cunoscute, în ordinea din MENU_LANGS (fără `ro`).
  return MENU_LANGS.filter((l) => l.code !== 'ro' && found.has(l.code)).map((l) => l.code)
}

// src/i18n/resolveLang.ts — ce limbă vede un om din personal (lotul L0b).
// Pur: toate intrările vin ca argumente, ca regula să fie testabilă fără DOM.
//
// Ordinea (prima sursă care numește o limbă ACTIVĂ câștigă):
//   1. `?lang=` din URL — alegere explicită pentru această vizită;
//   2. `profiles.ui_language` — alegerea CONTULUI (mig 323), aceeași pe orice
//      dispozitiv; conturile dinainte de 323 au 'ro', deci rămân în română;
//   3. stocarea locală (`menuvia_ui_lang`) — preferința dispozitivului, pentru
//      cine n-a ales nimic în cont (sau nu e logat încă);
//   4. limbile browserului, în ordinea lor (`navigator.languages`, doar
//      subeticheta primară: 'fr-CA' → 'fr');
//   5. site-ul: 'en' pe menuvia.com, 'ro' în rest (`defaultUiLang`).
// O limbă care nu e în `enabled` se SARE (nu oprește căutarea), iar dacă
// nimic nu se potrivește rezultatul e 'ro' — prima limbă activă mereu.
import { ENABLED_STAFF_LANGS, FUNNEL_LANGS, isStaffLang, type StaffLang } from './langs'

export interface UiLangInputs {
  urlLang?: string | null
  profileLang?: string | null
  storedLang?: string | null
  navigatorLangs?: readonly string[] | null
  /** Limba implicită a site-ului (`defaultUiLang(browserSite())`). */
  siteLang?: string | null
  enabled?: readonly StaffLang[]
}

function primary(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? ''
}

export function resolveUiLang(inp: UiLangInputs): StaffLang {
  const enabled = inp.enabled ?? ENABLED_STAFF_LANGS
  const ok = (v: string | null | undefined): StaffLang | null => {
    if (v == null) return null
    const p = primary(v)
    return isStaffLang(p) && enabled.includes(p) ? p : null
  }
  for (const candidate of [inp.urlLang, inp.profileLang, inp.storedLang]) {
    const hit = ok(candidate)
    if (hit) return hit
  }
  for (const tag of inp.navigatorLangs ?? []) {
    const hit = ok(tag)
    if (hit) return hit
  }
  return ok(inp.siteLang) ?? (enabled.includes('ro') ? 'ro' : (enabled[0] ?? 'ro'))
}

/**
 * Limba drumului de dinaintea panoului (lotul L2): aceeași ordine, cu două
 * diferențe deliberate.
 *   - Limbile sunt `FUNNEL_LANGS` (româna, engleza și ce s-a activat pentru
 *     personal), nu doar cele ale panoului: engleza există aici din E4a.
 *   - Limbile BROWSERULUI nu contează. Funnel-ul nu le-a citit niciodată, iar
 *     pe menuvia.ro un român cu browserul în engleză vede azi formularul în
 *     română; dacă le-am citi, l-am muta pe engleză fără să fi cerut-o.
 * Rămâne: `?lang=` → limba contului (Termenii se cer după login) → stocarea
 * dispozitivului (`menuvia_ui_lang`, scrisă de /en și de `?lang=`) → site-ul.
 */
export function resolveFunnelLang(inp: Omit<UiLangInputs, 'navigatorLangs' | 'enabled'>): StaffLang {
  return resolveUiLang({ ...inp, navigatorLangs: null, enabled: FUNNEL_LANGS })
}

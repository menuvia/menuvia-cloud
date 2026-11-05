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
import { ENABLED_STAFF_LANGS, isStaffLang, type StaffLang } from './langs'

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

// src/i18n/accountLang.ts — copia limbii CONTULUI pe dispozitiv, pe cont
// (`menuvia_ui_lang_acct:<uid>`), separată de preferința DISPOZITIVULUI
// (`menuvia_ui_lang`, citită și de funnel). O citește doar rezolvarea
// personalului (`UiLangProvider`), pentru ACEST cont, cât profilul nu e în
// memorie — la deschidere, înainte să sosească, sau când reîncărcarea lui a
// picat. Modul separat de UiLangContext: îl scriu și providerul (la fiecare
// profil încărcat), și salvarea limbii (`useSetUiLanguage`).
import type { StaffLang } from './langs'

const ACCOUNT_LANG_PREFIX = 'menuvia_ui_lang_acct:'

// Copia din MEMORIA tab-ului, citită înaintea celei persistate: limba aleasă
// aici rămâne pe ecran și când localStorage aruncă (Safari „Block All
// Cookies”, RESID-15) — fără ea, cu profilul neîncărcat și reîncărcarea
// picată, ecranul revenea pe limba de dinainte (recenzia CodeRabbit pe #388).
// Pe cont, deci o schimbare de cont pe tableta comună nu o moștenește.
const memory = new Map<string, StaffLang>()

/** Anunță providerul că o copie s-a schimbat în ACEST tab (localStorage nu
 *  emite `storage` în tab-ul care scrie, iar copia se citește la randare). */
export const ACCOUNT_LANG_EVENT = 'menuvia:ui-lang-account'

export function readAccountLang(uid: string): string | null {
  const mem = memory.get(uid)
  if (mem) return mem
  try {
    return window.localStorage.getItem(ACCOUNT_LANG_PREFIX + uid)
  } catch {
    return null // Safari „Block All Cookies": accesul ARUNCĂ (RESID-15)
  }
}

/**
 * `notify`: limba tocmai a fost ALEASĂ în acest tab (nu doar recopiată din
 * profil), deci ecranul trebuie să o preia fără să aștepte profilul — dacă
 * reîncărcarea lui pică cu profilul încă neîncărcat, copia veche ar ține
 * ecranul pe limba de dinainte (recenzia CodeRabbit pe #388).
 */
export function storeAccountLang(uid: string, lang: StaffLang, opts?: { notify?: boolean }): void {
  memory.set(uid, lang)
  try {
    const key = ACCOUNT_LANG_PREFIX + uid
    if (window.localStorage.getItem(key) !== lang) window.localStorage.setItem(key, lang)
  } catch {
    /* Safari „Block All Cookies”: limba rămâne doar în cont */
  }
  if (opts?.notify) {
    try {
      window.dispatchEvent(new Event(ACCOUNT_LANG_EVENT))
    } catch {
      /* fără `window` (teste izolate): nimic de anunțat */
    }
  }
}

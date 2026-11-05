// src/i18n/langs.ts — limbile interfeței PERSONALULUI (Partea II, lotul L0b).
// Modul FĂRĂ importuri: îl citesc intrarea aplicației (UiLangContext) și
// paginile oaspetelui, deci nu are voie să tragă după el niciun dicționar.
//
// Limbile oaspetelui (meniul QR, 7 limbi) sunt altă tabelă, `T()` din
// `lib/publicMenuStrings.ts` — oaspetele și personalul nu împart dicționare.

export const STAFF_LANGS = ['ro', 'en', 'fr', 'de'] as const
export type StaffLang = (typeof STAFF_LANGS)[number]

/**
 * Limbile pe care le poate PRIMI un utilizator azi. O limbă intră aici abia
 * când panoul, ospătarul și bucătăria sunt complete în ea (decizia din plan:
 * comutatorul apare doar atunci) — până atunci orice preferință (URL, cont,
 * stocare, browser) cade pe română, deci fundația e invizibilă.
 */
export const ENABLED_STAFF_LANGS: readonly StaffLang[] = ['ro']

/**
 * Limbile drumului de DINAINTEA panoului — autentificare, confirmarea
 * emailului, resetarea parolei, Termenii, onboarding-ul (lotul L2). Engleza e
 * aici din E4a (vizitatorii veniți de pe /en și de pe menuvia.com), deci nu
 * poate aștepta comutatorul personalului; orice limbă activată pentru personal
 * intră automat. Franceza și germana au dicționare gata, dar apar abia odată
 * cu panoul: un patron francez care se înscrie în franceză și aterizează
 * într-un panou românesc ar vedea exact ecranul amestecat pe care îl evităm.
 */
export const FUNNEL_LANGS: readonly StaffLang[] = STAFF_LANGS.filter(
  (l) => l === 'ro' || l === 'en' || ENABLED_STAFF_LANGS.includes(l),
)

/**
 * Cheia de stocare locală — aceeași cu cea a funnel-ului RO/EN (/auth,
 * onboarding), lărgită la cele patru limbi: o vizită pe /en rămâne o
 * preferință exprimată.
 */
export const UI_LANG_STORAGE_KEY = 'menuvia_ui_lang'

export function isStaffLang(v: unknown): v is StaffLang {
  return typeof v === 'string' && (STAFF_LANGS as readonly string[]).includes(v)
}

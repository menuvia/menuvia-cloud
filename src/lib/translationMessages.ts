// src/lib/translationMessages.ts — textele calculate ale ecranului Meniu →
// Traduceri și ale traducerilor din fișa produsului, în limba personalului
// (lotul L5a, partea 2). Traducătorii se primesc ca parametri (dicționarele
// vin doar prin `import type`, SK4).
//
// 1. Numele limbilor MENIULUI (cele 7 ale oaspetelui, `MENU_LANGS`) — alt
//    concept decât limba personalului. Tabelă în namespace, NU
//    `Intl.DisplayNames`: în română textul de dinainte e numele fiecărei limbi
//    în limba EI („English”, „Deutsch” — `MENU_LANGS[].label`), pe care
//    DisplayNames nu-l dă („engleză”); majusculele diferă pe limbă și pe loc
//    (fr „en allemand” în propoziție, „Allemand” la începutul pastilei); iar
//    rezultatul DisplayNames depinde de ICU-ul browserului — o tabelă e
//    deterministă și e verificată de SK1–SK3 ca orice text.
// 2. Refuzurile: în ROMÂNĂ exact `toUserMessage(err, fallback)` de dinainte;
//    în altă limbă, `code`-urile cunoscute au textul lor (AiError din lib/ai:
//    cotă, sesiune, drepturi, configurare, furnizor; `not_found` din
//    saveRowTranslations), restul cade pe clasa erorii din `common` sau pe
//    textul de rezervă — un mesaj românesc al serverului NU ajunge pe ecran.
import { describeStaffError } from '../i18n/staffErrors'
import type { StringKey, Translator } from '../i18n/core'
import type commonRo from '../i18n/ns/common/ro'
import type translationsRo from '../i18n/ns/translations/ro'
import type { TranslatedField } from './i18nMenu'

export type TranslationsTranslator = Pick<Translator<typeof translationsRo>, 't' | 'lang'>
type CommonTranslator = Translator<typeof commonRo>
type TrKey = StringKey<typeof translationsRo>

/** Eticheta fiecărui câmp traductibil (TranslationRow, ProductTranslations,
 *  ExtraTranslations). */
export const FIELD_KEY = {
  name: 'field_name',
  description: 'field_description',
  meta_text: 'field_meta_text',
} as const satisfies Record<TranslatedField, TrKey>

/** Codurile limbilor meniului cu nume în dicționar (= `MENU_LANGS`, LX7). */
export const MENU_LANG_KEYS = {
  ro: 'menuLang_ro',
  en: 'menuLang_en',
  de: 'menuLang_de',
  fr: 'menuLang_fr',
  it: 'menuLang_it',
  hu: 'menuLang_hu',
  es: 'menuLang_es',
} as const satisfies Record<string, TrKey>

function keyOf(code: string): TrKey | null {
  return Object.prototype.hasOwnProperty.call(MENU_LANG_KEYS, code)
    ? MENU_LANG_KEYS[code as keyof typeof MENU_LANG_KEYS]
    : null
}

/** Numele limbii meniului în forma din propoziție („Meniul e scris în …”).
 *  Un cod necunoscut întoarce `fallback` (implicit codul cu majuscule, ca
 *  înainte). */
export function menuLangName(code: string, tr: TranslationsTranslator, fallback = code.toUpperCase()): string {
  const k = keyOf(code)
  return k ? tr.t(k) : fallback
}

/** Numele la începutul unei pastile sau al unui titlu: prima literă mare
 *  (fr „anglais” → „Anglais”); în română/engleză/germană numele încep deja
 *  cu majusculă, deci e identic cu `menuLangName`. */
export function menuLangTitle(code: string, tr: TranslationsTranslator, fallback = code.toUpperCase()): string {
  const name = menuLangName(code, tr, fallback)
  return name.charAt(0).toLocaleUpperCase(tr.lang) + name.slice(1)
}

// Codurile AiError (lib/ai) — folosite și de apelurile AI din fișa produsului
// (`describeAiError`), ca același refuz să aibă același text pe tot ecranul.
const AI_CODE_KEYS: Readonly<Record<string, TrKey>> = {
  quota_exceeded: 'err_aiQuota',
  rate_limited: 'err_aiQuota',
  auth_missing: 'err_aiSession',
  auth_invalid: 'err_aiSession',
  forbidden: 'err_aiForbidden',
  server_config: 'err_aiUnavailable',
  ai_disabled: 'err_aiUnavailable',
  provider_key_missing: 'err_aiUnavailable',
  key_load_failed: 'err_aiUnavailable',
  model_missing: 'err_aiUnavailable',
  base_url_rejected: 'err_aiUnavailable',
  provider_timeout: 'err_aiBusy',
  provider_failed: 'err_aiBusy',
  server_error: 'err_aiBusy',
}

const CODE_KEYS: Readonly<Record<string, TrKey>> = {
  not_found: 'err_notInMenu',
  ...AI_CODE_KEYS,
}

function codeOf(err: unknown): string {
  if (err == null || typeof err !== 'object') return ''
  const c = (err as { code?: unknown }).code
  return typeof c === 'string' ? c : ''
}

/** Mesajul unui refuz al ecranului Traduceri / al traducerilor din fișă.
 *  `fallback` e deja tradus. */
function describeByCode(
  err: unknown,
  keys: Readonly<Record<string, TrKey>>,
  tr: TranslationsTranslator,
  tc: CommonTranslator,
  fallback: string,
): string {
  if (tc.lang !== 'ro') {
    const code = codeOf(err)
    // AiError `network` poartă un text românesc pe care detectorul de rețea
    // nu-l recunoaște: clasa vine din cod.
    if (code === 'network') return tc.t('err_network')
    if (Object.prototype.hasOwnProperty.call(keys, code)) return tr.t(keys[code])
  }
  return describeStaffError(err, tc, { fallback })
}

export function describeTranslationError(
  err: unknown,
  tr: TranslationsTranslator,
  tc: CommonTranslator,
  fallback: string,
): string {
  return describeByCode(err, CODE_KEYS, tr, tc, fallback)
}

/** Refuzul unui apel AI (lib/ai: imagine, valori nutriționale) din fișa
 *  produsului. În română exact `toUserMessage(err, fallback)`; în altă limbă
 *  aceleași texte ca `describeTranslationError` pentru codurile AiError
 *  (cotă, sesiune, drepturi, configurare, furnizor, rețea), fără `not_found`
 *  — acela e al salvării traducerilor („nu mai e în meniu”). */
export function describeAiError(
  err: unknown,
  tr: TranslationsTranslator,
  tc: CommonTranslator,
  fallback: string,
): string {
  return describeByCode(err, AI_CODE_KEYS, tr, tc, fallback)
}

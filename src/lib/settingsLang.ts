// src/lib/settingsLang.ts — etichetele calculate ale filei Setări în limba
// personalului (lotul L6b). Traducătorul se primește ca parametru, iar
// dicționarul vine doar prin `import type` (SK4): fișierul e importat doar de
// SettingsTab (chunk leneș), dar regula rămâne aceeași ca la pickupCopy.
//
// În ROMÂNĂ fiecare funcție întoarce EXACT eticheta de dinainte — oracolele
// rămân sursele lor: `WEEK_DAY_LABELS` (mutat aici din SettingsTab), `labelRo`
// din `AMENITIES` (lib/constants), `name`/`description` din `THEMES`
// (lib/themes), `name` din `ACCENT_SWATCHES` (lib/accentPalette), `name` din
// `COUNTRIES` (lib/countries). Un id NOU fără cheie în dicționar cade pe
// eticheta sursei (românească), nu pe numele cheii — testul TW pur cere ca
// fiecare id cunoscut să aibă cheie.
//
// Țările: în română și engleză lista arată de azi numele ENGLEZEȘTI din
// `COUNTRIES` (aceleași ca în onboarding) — româna rămâne byte-identică; în
// franceză și germană numele vine din `Intl.DisplayNames` (regiunile ISO sunt
// date CLDR stabile), cu numele englezesc ca rezervă pe un motor fără el.
import type { StringKey, Translator } from '../i18n/core'
import type { StaffLang } from '../i18n/langs'
import type settingsRo from '../i18n/ns/settings/ro'
import type { AmenityId } from './constants'

export type SettingsTranslator = Pick<Translator<typeof settingsRo>, 't' | 'lang'>
type SettingsKey = StringKey<typeof settingsRo>

// ── Zilele programului (hours_structured) ──
export type WeekDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export const WEEK_DAY_KEYS: WeekDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** Oracolul românesc: etichetele de dinainte ale lui SettingsTab. */
export const WEEK_DAY_LABELS: Record<WeekDayKey, string> = {
  mon: 'Luni',
  tue: 'Marți',
  wed: 'Miercuri',
  thu: 'Joi',
  fri: 'Vineri',
  sat: 'Sâmbătă',
  sun: 'Duminică',
}

const DAY_KEYS = {
  mon: 'day_mon',
  tue: 'day_tue',
  wed: 'day_wed',
  thu: 'day_thu',
  fri: 'day_fri',
  sat: 'day_sat',
  sun: 'day_sun',
} as const satisfies Record<WeekDayKey, SettingsKey>

export function weekDayLabel(day: WeekDayKey, tr: SettingsTranslator): string {
  return tr.t(DAY_KEYS[day])
}

// ── Mesajul IMPLICIT al sugestiilor la coș și recompensa IMPLICITĂ a fidelizării ──
// Se SALVEAZĂ (`checkout_suggestion_settings.message`, `loyalty_settings.
// reward_description`) la prima pornire și le vede OASPETELE, deci sunt DATE
// ale meniului, nu text al personalului: NU urmează limba personalului.
// Urmează limba de BAZĂ a meniului (`menuBaseLang(restaurants.language)`):
// oaspetele vede textul salvat exact când citește meniul în limba de bază
// (QrCartSheet: `lang === baseLang`), deci un local german care pornea
// sugestiile le arăta oaspeților germani un text românesc. Româna e textul de
// dinainte; o limbă necunoscută cade pe română, ca `menuBaseLang`.
export const CHECKOUT_SUGGESTION_DEFAULT_MESSAGE = '🍰 Înainte să trimiți... ai vrea ceva în plus?'

const CHECKOUT_SUGGESTION_DEFAULTS: Readonly<Record<string, string>> = {
  ro: CHECKOUT_SUGGESTION_DEFAULT_MESSAGE,
  en: '🍰 Before you send… would you like anything else?',
  de: '🍰 Bevor du bestellst … darf es noch etwas sein?',
  fr: '🍰 Avant d’envoyer… envie d’autre chose ?',
  it: '🍰 Prima di inviare… vuoi qualcos’altro?',
  hu: '🍰 Mielőtt elküldöd… kérsz még valamit?',
  es: '🍰 Antes de enviar… ¿quieres algo más?',
}

export function checkoutSuggestionDefaultMessage(baseLang: string): string {
  return CHECKOUT_SUGGESTION_DEFAULTS[baseLang] ?? CHECKOUT_SUGGESTION_DEFAULT_MESSAGE
}

export const LOYALTY_DEFAULT_REWARD = 'Un desert din partea casei'

const LOYALTY_REWARD_DEFAULTS: Readonly<Record<string, string>> = {
  ro: LOYALTY_DEFAULT_REWARD,
  en: 'A dessert on the house',
  de: 'Ein Dessert aufs Haus',
  fr: 'Un dessert offert par la maison',
  it: 'Un dolce offerto dalla casa',
  hu: 'Egy desszert a ház ajándékaként',
  es: 'Un postre por cuenta de la casa',
}

export function loyaltyDefaultReward(baseLang: string): string {
  return LOYALTY_REWARD_DEFAULTS[baseLang] ?? LOYALTY_DEFAULT_REWARD
}

function own(map: Readonly<Record<string, SettingsKey>>, id: string): SettingsKey | null {
  return Object.prototype.hasOwnProperty.call(map, id) ? (map[id] ?? null) : null
}

// ── Facilitățile ──
export const AMENITY_KEYS = {
  wifi: 'amenity_wifi',
  vegan_options: 'amenity_vegan_options',
  outdoor_seating: 'amenity_outdoor_seating',
  parking: 'amenity_parking',
  cards: 'amenity_cards',
  reservations: 'amenity_reservations',
  pet_friendly: 'amenity_pet_friendly',
} as const satisfies Record<AmenityId, SettingsKey>

export function amenityLabel(a: { id: string; labelRo: string }, tr: SettingsTranslator): string {
  const k = own(AMENITY_KEYS, a.id)
  return k ? tr.t(k) : a.labelRo
}

// ── Temele meniului ──
export const THEME_KEYS: Readonly<Record<string, { name: SettingsKey; desc: SettingsKey }>> = {
  cafe: { name: 'theme_cafe_name', desc: 'theme_cafe_desc' },
  pizzeria: { name: 'theme_pizzeria_name', desc: 'theme_pizzeria_desc' },
  'fine-dining': { name: 'theme_fine-dining_name', desc: 'theme_fine-dining_desc' },
  pub: { name: 'theme_pub_name', desc: 'theme_pub_desc' },
  mexican: { name: 'theme_mexican_name', desc: 'theme_mexican_desc' },
  asian: { name: 'theme_asian_name', desc: 'theme_asian_desc' },
  healthy: { name: 'theme_healthy_name', desc: 'theme_healthy_desc' },
  mediterranean: { name: 'theme_mediterranean_name', desc: 'theme_mediterranean_desc' },
}

function themeKeys(id: string): { name: SettingsKey; desc: SettingsKey } | null {
  return Object.prototype.hasOwnProperty.call(THEME_KEYS, id) ? (THEME_KEYS[id] ?? null) : null
}

export function themeName(theme: { id: string; name: string }, tr: SettingsTranslator): string {
  const k = themeKeys(theme.id)
  return k ? tr.t(k.name) : theme.name
}

export function themeDescription(theme: { id: string; description: string }, tr: SettingsTranslator): string {
  const k = themeKeys(theme.id)
  return k ? tr.t(k.desc) : theme.description
}

// ── Mostrele de accent (cheia = codul hex fără „#”, majuscule) ──
export const ACCENT_KEYS: Readonly<Record<string, SettingsKey>> = {
  C8963C: 'accent_C8963C',
  E05555: 'accent_E05555',
  '4CAF6E': 'accent_4CAF6E',
  '5B8DEF': 'accent_5B8DEF',
  '9B72CF': 'accent_9B72CF',
  E07B45: 'accent_E07B45',
  '3ABFBF': 'accent_3ABFBF',
}

export function accentName(swatch: { hex: string; name: string }, tr: SettingsTranslator): string {
  const k = own(ACCENT_KEYS, swatch.hex.replace(/^#/, '').toUpperCase())
  return k ? tr.t(k) : swatch.name
}

// ── Țările ──
const regionNames = new Map<string, Intl.DisplayNames | null>()

function displayNamesFor(lang: StaffLang): Intl.DisplayNames | null {
  if (regionNames.has(lang)) return regionNames.get(lang) ?? null
  let dn: Intl.DisplayNames | null
  try {
    dn = new Intl.DisplayNames([lang], { type: 'region' })
  } catch {
    dn = null // motor fără DisplayNames — rămâne numele englezesc
  }
  regionNames.set(lang, dn)
  return dn
}

/** Numele țării în selectorul din Setări. `name` = cel din `COUNTRIES`
 *  (englezesc) — în română și engleză EXACT el, ca înainte. */
export function countryLabel(code: string, name: string, lang: StaffLang): string {
  if (lang === 'ro' || lang === 'en') return name
  try {
    const out = displayNamesFor(lang)?.of(code)
    return out && out !== code ? out : name
  } catch {
    return name
  }
}

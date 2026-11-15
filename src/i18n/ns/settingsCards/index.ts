// Namespace `settingsCards`: cardurile montate STATIC de SettingsTab
// (LoyaltySettingsCard, MfaCard, GdprCard, AddLocationCard,
// SmsNotificationsCard) — sunt în ACELAȘI chunk leneș cu fila Setări, deci
// SettingsTab îl cere SUS, împreună cu `settings`, ca prima randare într-o
// limbă nouă să încarce ambele dicționare dintr-o dată. en/fr/de vin prin
// `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const settingsCardsNs = defineNamespace('settingsCards', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

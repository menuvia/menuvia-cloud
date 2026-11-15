// Namespace `settings`: doar din fila Setări (SettingsTab, chunk LENEȘ în
// DashboardPage, sub Suspense-ul panoului) și din helperii ei puri
// (`pickupSettingsCopyT` în lib/pickupCopy.ts și lib/settingsLang.ts —
// primesc traducătorul ca parametru și importă doar TIPUL namespace-ului,
// fiindcă pickupCopy e în graful static al DashboardPage). SettingsTab cere
// SUS și `settingsCards`, `common`, `translations` și `home` (al
// SubscriptionCard). en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const settingsNs = defineNamespace('settings', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

// Namespace `aiSettings`: doar din fila Asistent AI (AiSettingsTab, chunk
// LENEȘ în DashboardPage, sub Suspense-ul panoului). en/fr/de vin prin
// `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const aiSettingsNs = defineNamespace('aiSettings', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

// Namespace `assistant`: doar din asistentul AI flotant al panoului
// (AiChatbot, chunk LENEȘ în DashboardPage). AiChatbot și fiecare
// subcomponentă cer SUS `assistant` + `common`. en/fr/de vin prin `import()`
// (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const assistantNs = defineNamespace('assistant', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

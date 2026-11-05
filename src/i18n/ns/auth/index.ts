// Namespace `auth`: importă-l DOAR din ecranele leneșe ale drumului de
// dinaintea panoului (AuthPage, ResetPasswordPage și componentele lor) —
// en/fr/de vin prin `import()` doar când sunt cerute (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const authNs = defineNamespace('auth', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

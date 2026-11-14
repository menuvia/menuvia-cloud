// Namespace `promotions`: doar din fila Promoții (HappyHourTab, chunk LENEȘ din
// DashboardPage, cu editorul de regulă și confirmarea ștergerii) și din
// zilele săptămânii calculate de `lib/happyHourDays.ts`.
// en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const promotionsNs = defineNamespace('promotions', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

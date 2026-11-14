// Namespace `reservations`: doar din fila Rezervări (ReservationsTab, chunk
// LENEȘ în DashboardPage, sub Suspense-ul panoului) și din helperii ei puri
// (`reservationStatusLabelT`/`reservationCountT` în lib/reservationsLang.ts —
// aceștia primesc traducătorul ca parametru și importă doar TIPUL). en/fr/de
// vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const reservationsNs = defineNamespace('reservations', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

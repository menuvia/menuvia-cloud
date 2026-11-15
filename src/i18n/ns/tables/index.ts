// Namespace `tables`: doar din fila Mese & QR (TablesManager, chunk LENEȘ în
// DashboardPage, sub Suspense-ul panoului) și din helperii ei puri
// (`pickupCopyT` în lib/pickupCopy.ts — primește traducătorul ca parametru
// și importă doar TIPUL namespace-ului, fiindcă
// pickupCopy e în graful static al DashboardPage). en/fr/de vin prin
// `import()` (SK4). Textul TIPĂRIT pe cardurile QR nu e aici (lib/qrCopy.ts).
import { defineNamespace } from '../../core'
import ro from './ro'

export const tablesNs = defineNamespace('tables', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

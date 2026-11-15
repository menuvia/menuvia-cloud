// Namespace `reports`: doar din fila Vânzări (ReportsTab, chunk LENEȘ în
// DashboardPage, sub Suspense-ul panoului) și din helperul ei pur
// lib/reportsExport.ts (eticheta perioadei, ziua de pe grafic, exporturile CSV
// și PDF — primește traducătorul ca parametru și importă doar TIPUL
// namespace-ului). ReportsTab cere SUS și `common` (rezerva erorilor,
// „Reîncearcă”); nu montează copii care cer alte namespace-uri. en/fr/de vin
// prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const reportsNs = defineNamespace('reports', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

// Namespace `stocks`: doar din fila Stocuri (StocksTab, chunk LENEȘ în
// DashboardPage, sub Suspense-ul panoului) și din helperii ei puri
// (`formatStockT`/`unitSymbolT`/`unitLabelT` în lib/stocks.ts,
// `describeStockError`/`vatGroupLabel` în lib/stockMessages.ts — aceștia
// primesc traducătorul ca parametru și importă doar TIPUL). en/fr/de vin prin
// `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const stocksNs = defineNamespace('stocks', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

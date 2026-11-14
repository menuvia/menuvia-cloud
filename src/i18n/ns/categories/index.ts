// Namespace `categories`: doar din fila Meniu → Categorii (CategoriesTab, chunk
// LENEȘ din DashboardPage, cu modalul de categorie și dialogul de ștergere).
// en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const categoriesNs = defineNamespace('categories', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

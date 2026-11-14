// Namespace `modifiers`: doar din fila Meniu → Opțiuni (ModifiersTab, chunk
// LENEȘ din DashboardPage, cu dialogurile „Grup nou / Editează grup” și
// „Alege produsele”) și din textele calculate de `lib/modifierMessages.ts`.
// en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const modifiersNs = defineNamespace('modifiers', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

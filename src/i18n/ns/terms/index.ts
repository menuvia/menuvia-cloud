// Namespace `terms`: doar din TermsAcceptanceGate (chunk leneș) — SK4.
import { defineNamespace } from '../../core'
import ro from './ro'

export const termsNs = defineNamespace('terms', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

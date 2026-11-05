// Namespace `onboarding`: doar din OnboardingPage (chunk leneș) — SK4.
import { defineNamespace } from '../../core'
import ro from './ro'

export const onboardingNs = defineNamespace('onboarding', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

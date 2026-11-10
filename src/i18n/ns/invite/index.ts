// Namespace `invite`: doar din InviteAcceptPage (chunk leneș) — SK4.
import { defineNamespace } from '../../core'
import ro from './ro'

export const inviteNs = defineNamespace('invite', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})

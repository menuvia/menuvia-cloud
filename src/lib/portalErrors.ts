// src/lib/portalErrors.ts — `code`-urile refuzurilor lui
// netlify/functions/stripe-portal.js → cheia textului din namespace-ul `home`
// (lotul L8d). SubscriptionCard o dă lui `describeFunctionError`, care o
// consultă DOAR în celelalte limbi (în română rămâne textul serverului).
//
// Stă într-un modul PROPRIU: în componentă n-o putea vedea niciun test, iar
// lib/billing.ts e înlocuit în testele cardului de un `vi.mock` care exportă
// doar `openBillingPortal`. Aici SUB6 o leagă de codurile pe care funcția chiar
// le întoarce (în ambele sensuri: o cheie scrisă greșit pică, un cod nou al
// funcției fără text pică), iar SUB7 verifică, cod cu cod, textul afișat.
//
// `no_customer` NU e aici: are ramura lui în card (ecran propriu, nu eroare).
// La runtime, un cod necunoscut (server mai nou decât clientul) cade pe
// `sub_portalFallback`.
import type homeRo from '../i18n/ns/home/ro'

export const PORTAL_ERROR_KEYS = {
  server_config: 'sub_errUnavailable',
  portal_unavailable: 'sub_errUnavailable',
  rate_limited: 'sub_errRateLimited',
  auth_missing: 'sub_errSession',
  auth_invalid: 'sub_errSession',
  rate_limit_unavailable: 'sub_errService',
  service_unavailable: 'sub_errService',
} as const satisfies Readonly<Record<string, keyof typeof homeRo>>

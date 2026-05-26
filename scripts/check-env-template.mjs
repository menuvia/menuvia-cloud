#!/usr/bin/env node
/**
 * scripts/check-env-template.mjs
 *
 * Validează că `.env.example` documentează variabilele frontend critice.
 *
 * Comportament:
 *   - citește doar `.env.example` (nu citește `.env.local`, `.env`, etc.);
 *   - nu printează niciodată valori (afișează doar nume de chei);
 *   - exit 0 dacă toate cheile critice sunt prezente;
 *   - exit 1 dacă orice cheie lipsește sau template-ul nu există.
 *
 * Cheile verificate sunt limitate la frontend non-secret (chei VITE_*).
 * Server-side secrets (SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, etc.)
 * sunt în .env.example dar nu fac obiectul acestui check — gestionarea
 * lor se face în Netlify env vars (vezi runbook-ul).
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE_PATH = resolve(ROOT, '.env.example')

const REQUIRED_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_APP_URL']

if (!existsSync(TEMPLATE_PATH)) {
  console.error(`✗ .env.example not found at ${TEMPLATE_PATH}`)
  process.exit(1)
}

const text = readFileSync(TEMPLATE_PATH, 'utf8')
const documented = new Set()

for (const rawLine of text.split(/\r?\n/)) {
  const line = rawLine.trim()
  if (line.length === 0 || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq <= 0) continue
  documented.add(line.slice(0, eq).trim())
}

const missing = REQUIRED_KEYS.filter((key) => !documented.has(key))

if (missing.length > 0) {
  console.error(`✗ .env.example is missing required frontend keys: ${missing.join(', ')}`)
  console.error(`  Required: ${REQUIRED_KEYS.join(', ')}`)
  process.exit(1)
}

console.log(`✓ .env.example documents all ${REQUIRED_KEYS.length} required frontend keys`)
console.log(`  (${REQUIRED_KEYS.join(', ')})`)
process.exit(0)

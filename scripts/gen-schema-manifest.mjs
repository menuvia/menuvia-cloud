#!/usr/bin/env node
// Generează `netlify/functions/schema-manifest.json` — lista NUMELOR de
// migrații din `supabase/migrations/` (fișierul fără prefixul de 14 cifre și
// fără `.sql`), exact forma sub care `supabase_migrations.schema_migrations`
// le ține pe prod (`name`). /health o trimite lui `get_schema_version` (mig 271)
// ca să afle ce lipsește din ledger (audit v3 RES-08).
//
// Manifestul e COMIS (VPS-ul nu face build; esbuild îl inline-uiește pe
// Netlify). Testul `tests/functions/schema-manifest.test.js` pică pe orice PR
// care adaugă o migrație fără să regenereze manifestul:
//   node scripts/gen-schema-manifest.mjs
import { readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'supabase', 'migrations')
const PREFIX = /^\d{14}_/

const names = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => {
    if (!PREFIX.test(f)) throw new Error(`migrație fără prefix de 14 cifre: ${f}`)
    return f.replace(PREFIX, '').replace(/\.sql$/, '')
  })
  .sort()

const out = join(root, 'netlify', 'functions', 'schema-manifest.json')
writeFileSync(out, JSON.stringify({ names }, null, 2) + '\n')
console.log(`${names.length} migrații → ${out}`)

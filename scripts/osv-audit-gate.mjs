#!/usr/bin/env node
// scripts/osv-audit-gate.mjs
// =============================================================================
// CLI-ul porții de securitate. Toată logica stă în `scripts/lib/osv-audit.mjs`
// (bibliotecă pură, testabilă offline); aici rămâne DOAR execuția.
//
// Rulează NECONDIȚIONAT, fără guard de tip `import.meta.url === argv[1]`: un
// astfel de guard pică TĂCUT cu exit 0 când calea trece printr-un symlink (npm
// realpath-uiește), sub `node --import`, sau când `argv[1]` lipsește — adică
// exact o poartă permanent verde. Verdictul trăiește în CODUL DE IEȘIRE, nu în
// stdout.
// =============================================================================
import { main } from './lib/osv-audit.mjs'

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`\nEȘEC: ${e && e.message ? e.message : e}\n`)
    process.stderr.write('Poarta de securitate NU a fost evaluată — asta NU înseamnă „curat".\n')
    process.exit(1)
  })

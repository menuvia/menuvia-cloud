// `/preturi` → `/pricing` (audit v3, S0). Varianta românească a rutei ajungea pe
// pagina 404; redirectul HTTP real e în netlify.toml (și în Caddyfile pe VPS),
// iar clientul are plasa lui pentru preview-uri.
//
//   RA1  `legacyPathRedirect`: alias → cale canonică, tolerant la slash final și
//        majuscule; orice altă cale (inclusiv prefixe și chei de prototip) → null
//   RA2  netlify.toml: 301 /preturi → /pricing, ÎNAINTEA catch-all-ului /*
//        (first-match wins — după catch-all ar fi mort)
//   RA3  Caddyfile (VPS): același redirect
//   RA4  App.tsx rutează prin helper (altfel RA1 ar testa cod nefolosit)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { LEGACY_PATH_REDIRECTS, legacyPathRedirect } from '../routeAliases'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

describe('routeAliases', () => {
  it('RA1: /preturi → /pricing; restul căilor nu sunt atinse', () => {
    for (const p of ['/preturi', '/preturi/', '/Preturi', '/PRETURI//']) {
      expect(legacyPathRedirect(p), p).toBe('/pricing')
    }
    for (const p of [
      '/pricing',
      '/',
      '',
      '/preturi-noi',
      '/preturi/x',
      '/m/preturi',
      '/__proto__',
      '/constructor',
      '/toString',
    ]) {
      expect(legacyPathRedirect(p), `„${p}"`).toBeNull()
    }
    // Ținta fiecărui alias e o rută care NU e ea însăși un alias (fără bucle).
    for (const target of Object.values(LEGACY_PATH_REDIRECTS)) {
      expect(legacyPathRedirect(target), target).toBeNull()
    }
  })

  it('RA2: netlify.toml are 301 /preturi → /pricing înaintea catch-all-ului', () => {
    const toml = read('netlify.toml')
    const alias = toml.indexOf('from   = "/preturi"')
    const catchAll = toml.indexOf('from   = "/*"')
    expect(alias, 'redirectul /preturi lipsește').toBeGreaterThan(0)
    expect(catchAll).toBeGreaterThan(0)
    expect(alias, 'după catch-all ar fi mort').toBeLessThan(catchAll)
    // Blocul redirectului: de la `from` până la următorul `[[redirects]]` (catch-all-ul).
    const block = toml.slice(alias, catchAll)
    expect(block).toContain('to     = "/pricing"')
    expect(block).toContain('status = 301')
  })

  it('RA3: Caddyfile (VPS) are același redirect', () => {
    expect(read('deploy/Caddyfile')).toMatch(/redir \/preturi \/pricing\?\{query\} 301/)
  })

  it('RA4: App.tsx rutează prin helper', () => {
    const app = read('src/App.tsx')
    expect(app).toContain("import { legacyPathRedirect } from './lib/routeAliases'")
    expect(app).toContain('legacyPathRedirect(window.location.pathname)')
  })
})

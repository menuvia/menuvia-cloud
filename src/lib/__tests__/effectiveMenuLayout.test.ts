// Layout-ul EFECTIV al meniului public, dintr-o singură sursă (reziduul R2 al
// lui #324). Pe flipbook pagina publică nu randează carduri, coș sau ridicare,
// iar „flipbook fără pagini” cade VIZIBIL pe 'list'. Regula stătea copiată în
// PublicMenuPage și în QrMenuPage, iar panoul nu o citea deloc: Setări și Mese
// promiteau comenzi și pe flipbook. Acum o citesc toți din lib/themes.
//
//   EL1  tabelul de adevăr: flipbook cu pagini VALIDE rămâne flipbook; fără
//        pagini, sau doar cu pagini respinse de `resolveFlipbookPages` (nu-https,
//        ne-șir), cade pe 'list'; celelalte stiluri trec neschimbate, un stil
//        necunoscut e 'list'. Mutația care pică: un helper care citește doar
//        `menu_layout` (flipbook fără pagini ar rămâne 'flipbook').
//   EL2  clichet de CLASĂ pe sursă: regula („flipbook” + „pagini goale” → listă)
//        nu mai e scrisă nicăieri în src/ în afara lui lib/themes (cu control
//        pozitiv pe forma veche din pagini). Mutația care pică: rândul vechi
//        `menuLayout === 'flipbook' && flipbookPages.length === 0 ? 'list' : …`.
//   EL3  consumatorii: paginile oaspetelui ȘI ecranele de staff care vorbesc
//        despre comenzi trec prin `resolveEffectiveMenuLayout`; resolver-ul
//        BRUT (`resolveMenuLayout`) e citit doar din registru, cu motiv.
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveEffectiveMenuLayout, type ThemeSettings } from '../themes'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const read = (f: string): string => readFileSync(resolve(ROOT, f), 'utf8')

const PAGE = 'https://cdn.example.com/meniu-1.webp'
const ts = (over: Partial<ThemeSettings>): ThemeSettings => ({ preset_id: 'cafe', ...over })

describe('EL1: layout-ul efectiv', () => {
  it('flipbook cu pagini valide rămâne flipbook', () => {
    expect(resolveEffectiveMenuLayout(ts({ menu_layout: 'flipbook', flipbook_pages: [PAGE] }))).toBe(
      'flipbook',
    )
  })

  it('flipbook fără pagini valide cade pe listă', () => {
    for (const pages of [undefined, null, [], ['http://x.ro/p.webp'], ['javascript:alert(1)']]) {
      expect(
        resolveEffectiveMenuLayout(ts({ menu_layout: 'flipbook', flipbook_pages: pages })),
        JSON.stringify(pages),
      ).toBe('list')
    }
  })

  it('celelalte stiluri trec neschimbate; lipsă / necunoscut → listă', () => {
    for (const l of ['list', 'grid', 'minimal', 'photo'] as const) {
      // Paginile de flipbook rămase de la un stil vechi nu schimbă nimic.
      expect(resolveEffectiveMenuLayout(ts({ menu_layout: l, flipbook_pages: [PAGE] })), l).toBe(l)
    }
    expect(resolveEffectiveMenuLayout(null)).toBe('list')
    expect(resolveEffectiveMenuLayout(undefined)).toBe('list')
    expect(resolveEffectiveMenuLayout(ts({ menu_layout: null }))).toBe('list')
    // jsonb-ul poate conține orice — un stil necunoscut nu e flipbook.
    const unknown = { preset_id: 'cafe', menu_layout: 'carusel' } as unknown as ThemeSettings
    expect(resolveEffectiveMenuLayout(unknown)).toBe('list')
  })
})

// Codul fără comentarii (proza poate descrie regula fără s-o reimplementeze).
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// Forma regulii copiate: „=== 'flipbook' && <ceva>.length === 0”.
const RULE_COPY = /===\s*'flipbook'\s*&&[^\n;]*\.length\s*===\s*0/

const SRC_FILES = (readdirSync(resolve(ROOT, 'src'), { recursive: true }) as string[])
  .map((f) => `src/${f.replace(/\\/g, '/')}`)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__') && !f.endsWith('.d.ts'))

describe('EL2: regula „flipbook fără pagini = listă” stă într-un singur loc', () => {
  it('control: detectorul prinde forma veche din pagini și vede arborele', () => {
    expect(
      "const effectiveLayout = menuLayout === 'flipbook' && flipbookPages.length === 0 ? 'list' : menuLayout",
    ).toMatch(RULE_COPY)
    expect(SRC_FILES.length).toBeGreaterThan(100)
    // Sursa unică chiar conține regula.
    expect(code(read('src/lib/themes.ts'))).toMatch(RULE_COPY)
  })

  it('nicio copie în afara lui lib/themes', () => {
    const copies = SRC_FILES.filter(
      (f) => f !== 'src/lib/themes.ts' && RULE_COPY.test(code(read(f))),
    )
    expect(copies).toEqual([])
  })
})

// Cine citește stilul BRUT (fără fallback-ul pe listă) — și de ce.
const RAW_LAYOUT_READERS: Record<string, string> = {
  'src/lib/themes.ts': 'definiția + resolveEffectiveMenuLayout',
  'src/components/menu/MenuPreview.tsx':
    'previzualizarea din Setări arată stilul ALES, cu starea goală a viewer-ului ca îndemn la încărcarea paginilor',
}

describe('EL3: consumatorii layout-ului efectiv', () => {
  it('paginile oaspetelui și ecranele de staff despre comenzi trec prin helper', () => {
    for (const f of [
      'src/pages/PublicMenuPage.tsx',
      'src/pages/QrMenuPage.tsx',
      'src/components/SettingsTab.tsx',
      'src/components/TablesManager.tsx',
    ]) {
      expect(code(read(f)), f).toContain('resolveEffectiveMenuLayout(')
    }
  })

  it('resolver-ul brut e citit doar din registru (o scutire moartă pică)', () => {
    const readers = SRC_FILES.filter((f) => /\bresolveMenuLayout\(/.test(code(read(f))))
    expect([...readers].sort()).toEqual(Object.keys(RAW_LAYOUT_READERS).sort())
  })
})

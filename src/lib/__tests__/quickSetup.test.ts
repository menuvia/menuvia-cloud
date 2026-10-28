// Teste pe preset-ul TVA din Setup Asistent (FR-07, mig 285).
//
// De ce există: `VAT_PRESETS` oferea „Simplu — 19%", „Mâncare 9% + Alcool 19%"
// și „Turism — 5% + 9% + 19%" — cote abrogate de L.141/2025 (în vigoare din
// 1 aug 2025), în timp ce restaurantele NOI primeau deja 11/21 (mig 102/109).
// Preview-ul, RPC-ul și default-urile erau trei surse pentru același lucru;
// testele de aici le leagă: QS1 de LEGE, QS3 de SQL-ul pe care îl scrie serverul.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import { VAT_PRESETS, applyVatPreset, describeVatPresetError } from '../quickSetup'

// Căile se rezolvă din `process.cwd()` (rădăcina repo-ului), NU din
// `import.meta.url` — sub vitest acela nu e `file://` (precedentul qr-scan.test.ts).
const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations')
const QUICK_SETUP_TAB = resolve(process.cwd(), 'src/components/QuickSetupTab.tsx')

// Tabela legală grupă → cotă (L.141/2025, mig 102/109). Ancoră LITERALĂ: QS3
// leagă clientul de SQL, dar dacă AMBELE ar deriva împreună spre o cotă
// abrogată, QS3 ar rămâne verde — doar ancora asta pică.
const LEGAL_RO: { group: number; rate: number }[] = [
  { group: 1, rate: 11 },
  { group: 2, rate: 21 },
  { group: 3, rate: 11 },
  { group: 4, rate: 0 },
]

// Un procent abrogat în text: 19%, 9%, 5% (dar nu 11%/21%/100%).
const ABROGATED_PCT = /(?<!\d)(19|9|5)\s*%/

interface SqlDefaultRow {
  group: number
  rate: number
  label: string
}

const DEFINES_DEFAULTS = /create\s+(?:or\s+replace\s+)?function\s+public\.vat_rate_defaults_ro\s*\(/

// Ultima migrație care (re)definește sursa unică — o redefinire viitoare
// câștigă, exact ca pe lanțul aplicat.
function latestDefaultsSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  let last: string | null = null
  for (const f of files) {
    const src = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8')
    // Ancorat pe DEFINIRE, nu pe orice mențiune: o migrație viitoare care doar
    // face grant/revoke pe funcție n-are voie să devină „sursa”.
    if (DEFINES_DEFAULTS.test(src)) last = src
  }
  if (last === null) throw new Error('vat_rate_defaults_ro nu e definită în nicio migrație')
  return last
}

// Rândurile au forma `(N::smallint, R::numeric, 'Eticheta'::text, …` (contract
// consemnat în antetul funcției din mig 285).
function parseSqlDefaults(src: string): SqlDefaultRow[] {
  const start = src.search(DEFINES_DEFAULTS)
  const body = src.slice(start).split('$$')[1] ?? ''
  const re = /\(\s*(\d)::smallint,\s*([\d.]+)::numeric,\s*'([^']*)'::text/g
  return Array.from(body.matchAll(re), (m) => ({
    group: Number(m[1]),
    rate: Number(m[2]),
    label: m[3],
  }))
}

describe('VAT_PRESETS — FR-07 (L.141/2025)', () => {
  it('QS1 un singur preset, cu tabela legală EXACTĂ pe toate cele 4 grupe', () => {
    expect(VAT_PRESETS.map((p) => p.id)).toEqual(['ro_l141_2025'])
    expect(VAT_PRESETS[0].rates.map(({ group, rate }) => ({ group, rate }))).toEqual(LEGAL_RO)
  })

  it('QS2 nicio cotă și niciun text cu procent abrogat (5/9/19)', () => {
    for (const p of VAT_PRESETS) {
      for (const r of p.rates) {
        expect([0, 11, 21]).toContain(r.rate)
        expect(r.label).not.toMatch(ABROGATED_PCT)
      }
      expect(p.label).not.toMatch(ABROGATED_PCT)
      expect(p.description).not.toMatch(ABROGATED_PCT)
    }
  })

  it('QS3 preview-ul == ce scrie serverul (vat_rate_defaults_ro din ultima migrație)', () => {
    const sqlRows = parseSqlDefaults(latestDefaultsSql())
    // Control pozitiv: parserul chiar a găsit rânduri — altfel „[] == []" ar trece.
    expect(sqlRows).toHaveLength(4)
    expect(VAT_PRESETS[0].rates).toEqual(sqlRows)
  })
})

describe('applyVatPreset / describeVatPresetError', () => {
  beforeEach(() => {
    rpcMock.mockReset()
  })

  it('QS4 cheamă RPC-ul cu id-ul nou și aruncă un Error REAL cu hint/code', async () => {
    rpcMock.mockResolvedValue({
      data: { status: 'success', preset: 'ro_l141_2025', rates_applied: 4 },
      error: null,
    })
    await expect(applyVatPreset('rest-1', 'ro_l141_2025')).resolves.toMatchObject({
      rates_applied: 4,
    })
    // Numele parametrilor e CONTRACT (PostgREST rezolvă funcția pe ele).
    expect(rpcMock).toHaveBeenCalledWith('apply_vat_preset', {
      p_restaurant_id: 'rest-1',
      p_preset: 'ro_l141_2025',
    })

    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Invalid preset: ro_l141_2025', hint: 'invalid_preset', code: 'P0001' },
    })
    const err: unknown = await applyVatPreset('rest-1', 'ro_l141_2025').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).toMatchObject({ hint: 'invalid_preset', code: 'P0001' })
  })

  it('QS5 mesajele INTERNE (engleză) sunt înlocuite cu text RO', () => {
    const notAdmin = describeVatPresetError(new Error('Not admin of this restaurant'))
    const skew = describeVatPresetError(new Error('Invalid preset: ro_l141_2025'))
    const other = describeVatPresetError({ message: 'raw' })
    expect(notAdmin).toMatch(/proprietarul sau managerul/)
    expect(skew).toMatch(/Cote TVA/)
    expect(other).toMatch(/Reîncearcă/)
    for (const s of [notAdmin, skew, other]) {
      expect(s).not.toMatch(/not admin|invalid preset/i)
    }
  })

  it('QS6 Setup Asistent nu mai afișează cote abrogate și trimite la editorul real', () => {
    const src = readFileSync(QUICK_SETUP_TAB, 'utf8')
    expect(src).not.toMatch(ABROGATED_PCT)
    // „Raport TVA" e un tab de Plan 3, FĂRĂ editor — cotele se schimbă din Setări.
    expect(src).not.toMatch(/Raport TVA/)
    expect(src).toMatch(/Setări → Comenzi & plăți → Cote TVA/)
  })
})

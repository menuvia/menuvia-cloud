// Ordinea NATURALĂ a meselor (lotul C5b, lib/tableSort.ts). `.order('name')`
// din PostgREST sortează ca TEXT („Masa 1, Masa 10, Masa 11, Masa 2”), iar
// ordinea asta ajungea în Mese & QR, pe cardurile PDF-ului tipărit, în grila
// de mese a ospătarului, în selectul de masă al rezervării, în alocarea meselor
// și în dropdown-ul de legare al hărții. (Prefixul TN: verificat cu grep în
// src/, tests/, e2e/, supabase/, docs/ și CLAUDE.md, nefolosit înainte.)
//   TN1  ['Masa 10','Masa 2','Masa 1','Terasa 3'] → 1, 2, 10, Terasa 3.
//        Control POZITIV: ordinea de text (`localeCompare` simplu, ce dădea
//        `.order('name')`) chiar e greșită pe aceeași intrare — altfel testul
//        n-ar discrimina nimic. Mutația care pică: comparatorul fără
//        `numeric: true`.
//   TN2  majusculele și diacriticele NU despart numele: „masa 2” stă între
//        „Masa 1” și „MASA 10”, „Terasă 1” înaintea lui „Terasa 2”. Control:
//        colatorul românesc SINGUR (fără cheia fără diacritice) le desparte —
//        de aceea există `tableNameKey`. Mutația care pică: `tableNameKey`
//        scos din comparator (comparare pe numele brut).
//   TN3  ordinea e TOTALĂ: două mese cu același nume (și același nume cu/fără
//        diacritice) ies la fel indiferent de ordinea primită — departajare pe
//        numele exact, slug, id. Mutația care pică: departajarea pe slug/id
//        scoasă (rezultatul urmează ordinea de intrare).
//   TN4  `sortTablesByName` întoarce o COPIE (lista primită rămâne neatinsă) și
//        acceptă `null`/`undefined` (răspunsul gol al PostgREST).
//   TN5  clichet STRUCTURAL, prin descoperire: orice fișier din src/ care
//        citește `from('tables')` cu `.order('name')` (o LISTĂ de mese pentru
//        ecran) sortează rezultatul cu `sortTablesByName`; „Stadiu mese” trece
//        prin `compareTableNames`, fără un `localeCompare` numeric propriu.
//        Anti-vacuitate: descoperirea găsește cele cinci locuri cunoscute.
//        Mutația care pică: `sortTablesByName` scos din `fetchTables`
//        (lib/orders.ts) sau din oricare dintre ecrane.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { compareTableNames, sortTablesByName, tableNameKey } from '../tableSort'

const names = (xs: readonly string[]): string[] =>
  sortTablesByName(xs.map((name, i) => ({ name, id: `id-${i}` }))).map((t) => t.name)

describe('ordinea naturală a meselor', () => {
  it('TN1: Masa 2 înaintea lui Masa 10', () => {
    const input = ['Masa 10', 'Masa 2', 'Masa 1', 'Terasa 3']
    expect(names(input)).toEqual(['Masa 1', 'Masa 2', 'Masa 10', 'Terasa 3'])
    expect(names(['Masa 11', 'Masa 10', 'Masa 9', 'Bar'])).toEqual([
      'Bar',
      'Masa 9',
      'Masa 10',
      'Masa 11',
    ])
    // Control: ordinea de TEXT pe aceeași intrare e cea greșită.
    expect([...input].sort((a, b) => a.localeCompare(b, 'ro'))).toEqual([
      'Masa 1',
      'Masa 10',
      'Masa 2',
      'Terasa 3',
    ])
  })

  it('TN2: majusculele și diacriticele nu despart numele', () => {
    expect(names(['MASA 10', 'masa 2', 'Masa 1'])).toEqual(['Masa 1', 'masa 2', 'MASA 10'])
    expect(names(['terasa 3', 'Terasa 2', 'Terasă 1'])).toEqual([
      'Terasă 1',
      'Terasa 2',
      'terasa 3',
    ])
    expect(names(['Separeu 2', 'Șezlong 1', 'Sala 1'])).toEqual([
      'Sala 1',
      'Separeu 2',
      'Șezlong 1',
    ])
    expect(tableNameKey(' Terasă ')).toBe('Terasa')
    // Control: colatorul românesc singur ține ă/ș/ț ca litere distincte —
    // „Terasa 3” vs „Terasă 3” nu ies egale fără cheia fără diacritice.
    const raw = new Intl.Collator('ro', { numeric: true, sensitivity: 'base' })
    expect(raw.compare('Terasa 3', 'Terasă 3')).not.toBe(0)
    expect(compareTableNames({ name: 'Terasa 3' }, { name: 'Terasă 3' })).not.toBe(0)
    expect(Math.sign(compareTableNames({ name: 'Terasă 1' }, { name: 'Terasa 2' }))).toBe(-1)
  })

  it('TN3: ordinea e totală — aceeași ieșire pentru orice ordine de intrare', () => {
    const rows = [
      { name: 'Masa 1', slug: 'masa-1-b', id: 'b' },
      { name: 'Masa 1', slug: 'masa-1-a', id: 'c' },
      { name: 'Masa 1', slug: 'masa-1-a', id: 'a' },
      { name: 'masa 1', slug: 'x', id: 'd' },
      { name: 'Terasă 1', slug: 't', id: 'e' },
      { name: 'Terasa 1', slug: 't', id: 'f' },
    ]
    const want = sortTablesByName(rows).map((r) => r.id)
    // Toate permutările prin rotire și inversare dau aceeași ordine.
    for (let k = 0; k < rows.length; k++) {
      const rotated = [...rows.slice(k), ...rows.slice(0, k)]
      expect(sortTablesByName(rotated).map((r) => r.id)).toEqual(want)
      expect(sortTablesByName([...rotated].reverse()).map((r) => r.id)).toEqual(want)
    }
    // Același nume exact: slug-ul, apoi id-ul decid.
    const sameName = want.filter((id) => ['a', 'b', 'c'].includes(id))
    expect(sameName).toEqual(['a', 'c', 'b'])
  })

  it('TN4: copie, nu mutație; gol pe null/undefined', () => {
    const input = [{ name: 'Masa 10' }, { name: 'Masa 2' }]
    const out = sortTablesByName(input)
    expect(out.map((t) => t.name)).toEqual(['Masa 2', 'Masa 10'])
    expect(input.map((t) => t.name)).toEqual(['Masa 10', 'Masa 2'])
    expect(out).not.toBe(input)
    expect(sortTablesByName(null)).toEqual([])
    expect(sortTablesByName(undefined)).toEqual([])
  })
})

describe('clichet: fiecare listă de mese trece prin sortTablesByName', () => {
  const ROOT = resolve(process.cwd())
  function walk(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        if (name === '__tests__') continue
        out.push(...walk(p))
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
    }
    return out
  }
  /** Fișierele cu un `from('tables')` al cărui lanț (până la următorul `.from(`) are `.order('name')`. */
  function listingReaders(): string[] {
    const found: string[] = []
    for (const abs of walk(join(ROOT, 'src'))) {
      const src = readFileSync(abs, 'utf8')
      let i = src.indexOf(".from('tables')")
      while (i >= 0) {
        const rest = src.slice(i + 1)
        const next = rest.indexOf('.from(')
        const chain = rest.slice(0, next >= 0 ? Math.min(next, 600) : 600)
        if (chain.includes(".order('name')")) {
          found.push(relative(ROOT, abs).split('\\').join('/'))
          break
        }
        i = src.indexOf(".from('tables')", i + 1)
      }
    }
    return found.sort()
  }

  it('TN5: citirile de liste de mese sortează natural; „Stadiu mese” folosește comparatorul', () => {
    const readers = listingReaders()
    // Anti-vacuitate: cele cinci locuri cunoscute la lotul C5b.
    expect(readers).toEqual(
      expect.arrayContaining([
        'src/components/FloorPlanEditor.tsx',
        'src/components/TablesManager.tsx',
        'src/components/WaiterAssignments.tsx',
        'src/lib/orders.ts',
        'src/pages/WaiterPage.tsx',
      ]),
    )
    for (const f of readers)
      expect(readFileSync(join(ROOT, f), 'utf8'), f).toContain('sortTablesByName(')
    const board = readFileSync(join(ROOT, 'src/components/TableStatusBoard.tsx'), 'utf8')
    expect(board).toContain('compareTableNames(a, b)')
    expect(board).not.toMatch(/localeCompare\([^)]*numeric/)
  })
})

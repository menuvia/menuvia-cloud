// Căutarea din ecranele personalului (lotul C4a): lib/staffSearch.ts. Randarea
// (lista de produse, „Alege produsele”, panoul „Epuizate”) e în
// src/components/__tests__/StaffSearch.test.tsx (SRC4–SRC6).
// (Prefixul SRC: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md, nefolosit înainte.)
//   SRC1 „ciorba” găsește „Ciorbă de burtă”, „tuica” găsește „Țuică”, „TAITEI”
//        găsește descrierea „cu tăiței de casă”. Mutația care pică: indexul
//        construit cu `toLowerCase()` în loc de `normalizeMenuSearch` (fără
//        plierea diacriticelor), sau descrierea scoasă din câmpuri.
//   SRC2 spațiile de la capete nu contează („  ciorba ”), iar o interogare goală
//        sau doar din spații întoarce TOATĂ lista, în ordinea ei. Mutația care
//        pică: `trim()` scos din `normalizeSearchQuery` (înainte, un spațiu
//        tastat la final golea lista de produse).
//   SRC3 control pozitiv: o interogare care nu se potrivește nicăieri întoarce
//        zero elemente (indexul nu e „totul se potrivește”); câmpurile lipsă
//        (null/undefined) nu produc „null” în text.
import { describe, expect, it } from 'vitest'
import { buildSearchIndex, filterSearchIndex, normalizeSearchQuery } from '../staffSearch'

type P = { name: string; description: string | null | undefined }
const ITEMS: P[] = [
  { name: 'Ciorbă de burtă', description: null },
  { name: 'Supă', description: 'cu tăiței de casă' },
  { name: 'Țuică', description: undefined },
  { name: 'Apă plată', description: '' },
]
const index = buildSearchIndex(ITEMS, (p) => [p.name, p.description])
const names = (q: string) => filterSearchIndex(index, q).map((p) => p.name)

describe('căutarea personalului', () => {
  it('SRC1 fără diacritice, pe nume și descriere', () => {
    expect(names('ciorba')).toEqual(['Ciorbă de burtă'])
    expect(names('tuica')).toEqual(['Țuică'])
    expect(names('TAITEI')).toEqual(['Supă'])
    expect(names('Ciorbă')).toEqual(['Ciorbă de burtă'])
  })

  it('SRC2 spațiile de la capete și interogarea goală', () => {
    expect(names('  ciorba ')).toEqual(['Ciorbă de burtă'])
    expect(normalizeSearchQuery('  Șnițel ')).toBe('snitel')
    expect(names('')).toEqual(ITEMS.map((p) => p.name))
    expect(names('   ')).toEqual(ITEMS.map((p) => p.name))
  })

  it('SRC3 control: nimic potrivit → listă goală; câmpurile lipsă nu devin text', () => {
    expect(names('pizza')).toEqual([])
    expect(names('null')).toEqual([])
    expect(names('undefined')).toEqual([])
  })
})

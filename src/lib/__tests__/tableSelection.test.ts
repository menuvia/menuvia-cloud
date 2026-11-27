// Ce intră în PDF-ul de QR din Mese & QR (lotul C5b, lib/tableSelection.ts) —
// partea PURĂ. Ecranul randat (bife, bara de selecție, zona în lot, cardul
// unei mese) e în src/components/__tests__/TablesManager.selection.test.tsx
// (QG5–QG11). (Prefixul QG: verificat cu grep în src/, tests/, e2e/,
// supabase/, docs/ și CLAUDE.md, nefolosit înainte.)
//   QG1  fără selecție și fără filtre → sursa „all”, domeniul = toată lista
//        (eticheta butonului rămâne cea de dinainte). Mesele fără QR și cele
//        inactive NU intră în PDF, dar se NUMĂRĂ separat. Mutația care pică:
//        clasificarea veche (`is_active && active_token`) fără resturi
//        numărate — `noQr`/`inactive` goale.
//   QG2  o selecție ne-goală bate filtrul: exact mesele bifate, ÎN ordinea
//        listei (nu a bifării), oricare ar fi lista vizibilă; un ID care nu mai
//        e în listă (masă ștearsă) se ignoră. Mutația care pică: domeniul pe
//        `visible` chiar și cu selecție (comportamentul de dinainte ignora
//        orice alegere).
//   QG3  fără selecție, cu filtre → sursa „visible”, domeniul = lista FILTRATĂ.
//        Control: cu selecția indisponibilă (o singură masă, `selectionEnabled`
//        false) o bifă rămasă nu contează. Mutația care pică: domeniul pe
//        `all` (căutarea/zona ignorate, ca înainte).
//   QG4  `withIds` întoarce un Set NOU (React vede schimbarea), adaugă/scoate
//        un grup întreg; `allSelected` e fals pe grup gol (altfel butonul
//        „Deselectează zona” ar apărea pe o zonă fără mese).
// Filtrele listei după o reîncărcare (recenzia lotului C5b; prefixul ZF:
// verificat cu grep în src/, tests/, supabase/, scripts/, docs/ și CLAUDE.md,
// nefolosit înainte). Ecranul randat: ZF3–ZF6 în TablesManager.selection.test.tsx.
//   ZF1  `reconcileZoneFilter`: zona care mai are mese RĂMÂNE (control
//        pozitiv, și cu `follow` — mutarea parțială nu mută filtrul); zona
//        dispărută ia `follow` doar dacă lista îl are, altfel se golește; fără
//        filtru `follow` nu pornește unul; sub prag (8 mese) filtrul se golește
//        chiar dacă zona există. Mutațiile care pică: `return current` fără
//        verificarea pe rânduri (filtrul rămâne pe o zonă fără mese — lista
//        goală, fără ieșire), `follow` ignorat, pragul scos.
//   ZF2  pragul barei (9 mese) și căutarea: sub prag se golește, de la prag
//        rămâne. Mutația care pică: `reconcileTableSearch` care întoarce mereu
//        căutarea (filtrează ascuns după o ștergere).
import { describe, it, expect } from 'vitest'
import {
  allSelected,
  planQrPrint,
  reconcileTableSearch,
  reconcileZoneFilter,
  tableFiltersShown,
  withIds,
} from '../tableSelection'

const T = (id: string, is_active = true, token: string | null = `tok-${id}`) => ({
  id,
  is_active,
  active_token: token === null ? null : { token },
})
const ids = (rows: ReadonlyArray<{ id: string }>) => rows.map((r) => r.id)

const ALL = [T('m1'), T('m2', true, null), T('m3', false), T('m10')]

describe('domeniul PDF-ului de QR', () => {
  it('QG1: fără selecție și fără filtre → toată lista; fără QR / inactive numărate', () => {
    const plan = planQrPrint(ALL, ALL, new Set(), true)
    expect(plan.source).toBe('all')
    expect(ids(plan.scope)).toEqual(['m1', 'm2', 'm3', 'm10'])
    expect(ids(plan.printable)).toEqual(['m1', 'm10'])
    expect(ids(plan.noQr)).toEqual(['m2'])
    expect(ids(plan.inactive)).toEqual(['m3'])
    // Inactivă FĂRĂ QR: e „inactivă” (motivul care o ține afară e decizia).
    const p2 = planQrPrint([T('x', false, null)], [T('x', false, null)], new Set(), true)
    expect([ids(p2.noQr), ids(p2.inactive)]).toEqual([[], ['x']])
  })

  it('QG2: selecția bate filtrul, în ordinea listei; ID-urile moarte se ignoră', () => {
    // Bifate în ordinea m10, m1 (+ un ID șters), lista vizibilă doar m2.
    const plan = planQrPrint(ALL, [ALL[1]!], new Set(['m10', 'gone', 'm1']), true)
    expect(plan.source).toBe('selection')
    expect(ids(plan.scope)).toEqual(['m1', 'm10'])
    expect(ids(plan.printable)).toEqual(['m1', 'm10'])
    expect(plan.noQr).toEqual([])
    // Doar ID-uri moarte = fără selecție → lista vizibilă.
    const dead = planQrPrint(ALL, ALL, new Set(['gone']), true)
    expect(dead.source).toBe('all')
  })

  it('QG3: fără selecție, cu filtre → lista filtrată; selecția indisponibilă nu contează', () => {
    const visible = [ALL[0]!, ALL[1]!]
    const plan = planQrPrint(ALL, visible, new Set(), true)
    expect(plan.source).toBe('visible')
    expect(ids(plan.scope)).toEqual(['m1', 'm2'])
    expect(ids(plan.printable)).toEqual(['m1'])
    expect(ids(plan.noQr)).toEqual(['m2'])
    // Control: aceeași bifă, cu selecția oprită (sub două mese) → ignorată.
    const one = [T('solo')]
    expect(planQrPrint(one, one, new Set(['solo']), false).source).toBe('all')
    expect(planQrPrint(ALL, visible, new Set(['m10']), false).source).toBe('visible')
  })

  it('QG4: withIds / allSelected', () => {
    const start = new Set(['a'])
    const added = withIds(start, ['b', 'c'], true)
    expect(added).not.toBe(start)
    expect([...added].sort()).toEqual(['a', 'b', 'c'])
    expect([...start]).toEqual(['a'])
    expect([...withIds(added, ['a', 'c'], false)]).toEqual(['b'])
    expect(allSelected(added, [{ id: 'a' }, { id: 'b' }])).toBe(true)
    expect(allSelected(added, [{ id: 'a' }, { id: 'z' }])).toBe(false)
    expect(allSelected(added, [])).toBe(false)
  })
})

/** `n` mese cu aceeași zonă (doar câmpul care contează). */
const Z = (n: number, zone: string | null) => Array.from({ length: n }, () => ({ zone }))

describe('filtrele listei după o reîncărcare', () => {
  it('ZF1: zona filtrată rămâne doar dacă mai are mese; altfel o urmează pe cea nouă sau se golește', () => {
    const before = [...Z(5, 'Terasa'), ...Z(5, 'Interior')]
    // Control pozitiv: zona încă are mese → filtrul rămâne, chiar cu `follow`
    // (o mutare parțială nu mută filtrul).
    expect(reconcileZoneFilter(before, 'Terasa', null)).toBe('Terasa')
    expect(reconcileZoneFilter(before, 'Terasa', 'Bar')).toBe('Terasa')
    // „Terasa” → „Terasă” pe toate mesele ei: filtrul urmează mesele.
    const renamed = [...Z(5, 'Terasă'), ...Z(5, 'Interior')]
    expect(reconcileZoneFilter(renamed, 'Terasa', 'Terasă')).toBe('Terasă')
    // Zona dispărută fără `follow` (masă ștearsă, editare) → toată lista.
    expect(reconcileZoneFilter(renamed, 'Terasa', null)).toBe('')
    // `follow` pe care lista nu-l are (UPDATE care n-a atins nimic) → toată
    // lista, nu un filtru nou fără mese; câmpul gol = zona scoasă.
    expect(reconcileZoneFilter(renamed, 'Terasa', 'Bar')).toBe('')
    expect(reconcileZoneFilter([...Z(5, null), ...Z(5, 'Interior')], 'Terasa', '')).toBe('')
    // Fără nicio zonă rămasă (select-ul nici nu se mai randează).
    expect(reconcileZoneFilter(Z(10, null), 'Terasa', null)).toBe('')
    // Fără filtru, `follow` nu pornește unul.
    expect(reconcileZoneFilter(renamed, '', 'Terasă')).toBe('')
    // Sub prag bara nu se vede → niciun filtru, chiar dacă zona există.
    expect(reconcileZoneFilter(Z(8, 'Terasa'), 'Terasa', null)).toBe('')
    expect(reconcileZoneFilter(Z(9, 'Terasa'), 'Terasa', null)).toBe('Terasa')
  })

  it('ZF2: pragul barei de filtre și căutarea ascunsă', () => {
    expect([8, 9].map(tableFiltersShown)).toEqual([false, true])
    expect(reconcileTableSearch(8, 'Masa 1')).toBe('')
    // Control pozitiv: de la prag căutarea se vede, deci rămâne.
    expect(reconcileTableSearch(9, 'Masa 1')).toBe('Masa 1')
    expect(reconcileTableSearch(0, '')).toBe('')
  })
})

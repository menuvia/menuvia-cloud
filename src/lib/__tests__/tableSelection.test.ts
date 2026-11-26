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
import { describe, it, expect } from 'vitest'
import { allSelected, planQrPrint, withIds } from '../tableSelection'

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

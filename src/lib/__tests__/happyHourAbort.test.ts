// Anularea salvării unei reguli Happy Hour (recenzia lotului C4a): editorul își
// mărginește salvarea în timp (HappyHourTab, HAPPY_HOUR_SAVE_TIMEOUT_MS) și, la
// termen, ANULEAZĂ cererea. Testele editorului (HHM10) mock-uiesc tot
// `lib/happyHour`, deci văd doar că semnalul e dat și anulat — că ajunge la
// builderul supabase-js se vede doar aici.
// (Prefixul HHA: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md, nefolosit înainte.)
//   HHA1 createHappyHourRule cu semnal → `abortSignal(semnal)` pe builder,
//        înaintea lui `single()`, cu ACELAȘI semnal. Mutația care pică:
//        parametrul `signal` netransmis builderului.
//   HHA2 updateHappyHourRule cu semnal → `abortSignal(semnal)` după filtrele pe
//        id și pe `updated_at` (garda `ifUpdatedAt`) și după `select('id,
//        updated_at')`; întoarce rândul atins. Mutația care pică: la fel, sau
//        garda netransmisă (recenzia adversarială a lui cdcb6dd).
//   HHA3 control: fără semnal, aceeași cerere (rândul cu restaurantul, filtrul
//        pe id), fără `abortSignal`; un refuz al serverului aruncă, ca înainte.
//        Rândul INSERT-ului poartă id-ul dat de apelant (recenzia adversarială
//        a lotului C4a: editorul îl generează o dată pe sesiune și îl
//        retrimite la reîncercare), iar un `id`/`restaurant_id` strecurat în
//        câmpuri printr-un cast nu le înlocuiește. Mutațiile care pică: `id`
//        netrimis în INSERT (baza ar genera altul la fiecare încercare, deci o
//        creare comisă după ce clientul a renunțat ar sta lângă reîncercare —
//        regula dublată) sau câmpurile întinse DUPĂ `id`/`restaurant_id`.
//   HHA4 fetchHappyHourRules cu semnal (reîncărcarea de VERIFICARE de după o
//        salvare fără răspuns, mărginită de HAPPY_HOUR_VERIFY_TIMEOUT_MS) →
//        `abortSignal(semnal)` după `order`, cu ACELAȘI semnal; fără semnal
//        (încărcarea obișnuită), aceeași cerere fără `abortSignal` (control).
//        Mutația care pică: semnalul netransmis builderului (verificarea ar
//        rămâne în aer după termenul ei).
//   HHA5 o modificare care NU atinge niciun rând (regula ștearsă, ascunsă de
//        RLS sau, cu garda, modificată între timp) întoarce `null`, nu „succes”
//        — PostgREST răspunde fără eroare (recenzia adversarială a lui cdcb6dd);
//        fără gardă nu se adaugă filtrul pe `updated_at` (comutatorul de pe
//        card). Control pozitiv: HHA2 (rândul atins e întors). Mutațiile care
//        pică: `.select(...)` scos sau un rezultat gol tratat ca rând.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HappyHourRule } from '../happyHour'

type NewRule = Omit<HappyHourRule, 'id' | 'restaurant_id' | 'created_at' | 'updated_at'>

const h = vi.hoisted(() => ({
  // Metodele builderului, în ordinea apelului.
  calls: [] as string[],
  // Argumentele lui insert/update/eq.
  args: [] as unknown[][],
  // Argumentele lui select (coloanele cerute înapoi).
  selects: [] as unknown[][],
  signals: [] as AbortSignal[],
  result: { data: null, error: null } as { data: unknown; error: unknown },
}))

vi.mock('../supabase', () => {
  function builder(): Record<string, unknown> {
    const b: Record<string, unknown> = {}
    for (const m of ['insert', 'update', 'select', 'eq', 'order', 'single']) {
      b[m] = (...args: unknown[]) => {
        h.calls.push(m)
        if (m === 'insert' || m === 'update' || m === 'eq') h.args.push(args)
        if (m === 'select') h.selects.push(args)
        return b
      }
    }
    b.abortSignal = (s: AbortSignal) => {
      h.calls.push('abortSignal')
      h.signals.push(s)
      return b
    }
    // Thenable, ca builderul real: rezultatul se citește abia la `await`.
    b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(h.result).then(ok, bad)
    return b
  }
  return {
    supabase: {
      from: (table: string) => {
        h.calls.push(`from:${table}`)
        return builder()
      },
    },
  }
})

import { createHappyHourRule, fetchHappyHourRules, updateHappyHourRule } from '../happyHour'

const FIELDS: NewRule = {
  name: 'Happy',
  is_active: true,
  starts_at: '17:00:00',
  ends_at: '19:00:00',
  days_of_week: [],
  scope: 'all',
  category_id: null,
  product_id: null,
  discount_type: 'percent',
  discount_value: 20,
  max_discount: null,
}

beforeEach(() => {
  h.calls = []
  h.args = []
  h.selects = []
  h.signals = []
  h.result = { data: null, error: null }
})

describe('salvarea unei reguli Happy Hour se poate anula', () => {
  it('HHA1 crearea leagă semnalul de cerere', async () => {
    h.result = { data: { id: 'r9' }, error: null }
    const ctrl = new AbortController()
    await expect(createHappyHourRule('rest-1', 'id-9', FIELDS, ctrl.signal)).resolves.toEqual({
      id: 'r9',
    })
    expect(h.calls).toEqual(['from:happy_hour_rules', 'insert', 'select', 'abortSignal', 'single'])
    expect(h.signals).toHaveLength(1)
    expect(h.signals[0]).toBe(ctrl.signal)
  })

  it('HHA2 modificarea leagă semnalul și garda de cerere', async () => {
    h.result = { data: [{ id: 'r1', updated_at: 'T2' }], error: null }
    const ctrl = new AbortController()
    await expect(
      updateHappyHourRule('r1', { discount_value: 15 }, { ifUpdatedAt: 'T1', signal: ctrl.signal }),
    ).resolves.toEqual({ id: 'r1', updated_at: 'T2' })
    expect(h.calls).toEqual([
      'from:happy_hour_rules',
      'update',
      'eq',
      'eq',
      'select',
      'abortSignal',
    ])
    expect(h.args).toEqual([[{ discount_value: 15 }], ['id', 'r1'], ['updated_at', 'T1']])
    expect(h.selects).toEqual([['id, updated_at']])
    expect(h.signals).toHaveLength(1)
    expect(h.signals[0]).toBe(ctrl.signal)
  })

  it('HHA3 control: fără semnal, aceeași cerere, fără anulare; refuzul aruncă', async () => {
    await expect(updateHappyHourRule('r1', { is_active: false })).resolves.toBeNull()
    expect(h.calls).toEqual(['from:happy_hour_rules', 'update', 'eq', 'select'])

    h.calls = []
    h.args = []
    h.result = { data: null, error: { message: 'Nu ai voie.', code: '42501' } }
    await expect(createHappyHourRule('rest-1', 'id-1', FIELDS)).rejects.toEqual({
      message: 'Nu ai voie.',
      code: '42501',
    })
    expect(h.calls).toEqual(['from:happy_hour_rules', 'insert', 'select', 'single'])
    expect(h.args).toEqual([[{ id: 'id-1', restaurant_id: 'rest-1', ...FIELDS }]])
    expect(h.signals).toHaveLength(0)

    // Un `id`/`restaurant_id` strecurat în câmpuri (cast) nu înlocuiește
    // id-ul sesiunii și nici restaurantul.
    h.args = []
    const sneaky = { ...FIELDS, id: 'altul', restaurant_id: 'rest-2' } as NewRule
    await expect(createHappyHourRule('rest-1', 'id-1', sneaky)).rejects.toBeTruthy()
    expect(h.args).toEqual([[{ ...FIELDS, id: 'id-1', restaurant_id: 'rest-1' }]])
  })

  it('HHA4 reîncărcarea de verificare leagă semnalul de cerere', async () => {
    h.result = { data: [{ id: 'r1' }], error: null }
    const ctrl = new AbortController()
    await expect(fetchHappyHourRules('rest-1', ctrl.signal)).resolves.toEqual([{ id: 'r1' }])
    expect(h.calls).toEqual(['from:happy_hour_rules', 'select', 'eq', 'order', 'abortSignal'])
    expect(h.signals).toHaveLength(1)
    expect(h.signals[0]).toBe(ctrl.signal)

    // Control: încărcarea obișnuită, fără semnal.
    h.calls = []
    await fetchHappyHourRules('rest-1')
    expect(h.calls).toEqual(['from:happy_hour_rules', 'select', 'eq', 'order'])
    expect(h.signals).toHaveLength(1)
  })

  it('HHA5 o modificare care nu atinge niciun rând întoarce null; refuzul aruncă', async () => {
    h.result = { data: [], error: null }
    await expect(
      updateHappyHourRule('r1', { discount_value: 15 }, { ifUpdatedAt: 'T1' }),
    ).resolves.toBeNull()
    expect(h.calls).toEqual(['from:happy_hour_rules', 'update', 'eq', 'eq', 'select'])
    expect(h.args).toEqual([[{ discount_value: 15 }], ['id', 'r1'], ['updated_at', 'T1']])

    // Fără gardă (comutatorul de pe card): doar filtrul pe id.
    h.calls = []
    h.args = []
    await expect(updateHappyHourRule('r1', { is_active: true })).resolves.toBeNull()
    expect(h.args).toEqual([[{ is_active: true }], ['id', 'r1']])

    h.result = { data: null, error: { message: 'Nu ai voie.', code: '42501' } }
    await expect(updateHappyHourRule('r1', { is_active: true })).rejects.toEqual({
      message: 'Nu ai voie.',
      code: '42501',
    })
  })
})

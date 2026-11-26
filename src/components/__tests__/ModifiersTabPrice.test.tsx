// Meniu → Opțiuni: prețul opțiunii noi și căutarea din „Alege produsele”
// (lotul C4a). Textele în limbi sunt în ModifiersLang.test.tsx (MG0–MG6).
// (Prefixul MOP: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md, nefolosit înainte; SRC5 continuă seria din staffSearch.test.ts.)
//   MOP1 „4,50” tastat cu virgulă pleacă 4.5 — înainte câmpul era
//        `type="number"`, „4,50” ajungea gol și `parseFloat(x) || 0` salva o
//        opțiune GRATUITĂ („Inclus”) pe fiecare comandă. Control: un câmp gol
//        rămâne „Inclus” (0, ales explicit), iar minusul e o reducere („-1,5” →
//        −1.5). Mutația care pică: `parseFloat(draft.price) || 0` readus sau
//        `type="number"` (jsdom golește „4,50”).
//   MOP2 un preț fără formă de număr („4,5,0”) NU se salvează: eroarea stă lângă
//        câmpul grupului (aria-invalid + aria-describedby), nu în bannerul de
//        sus; editarea câmpului o șterge. Mutația care pică: NaN → 0 tăcut.
//   SRC5 „Alege produsele”: „ciorba” găsește „Ciorbă de burtă”, cu spații la
//        capete; control: „pizza” → „Niciun produs găsit.”. Mutația care pică:
//        `p.name.toLowerCase().includes(...)` readus.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  inserts: [] as Record<string, unknown>[],
}))

vi.mock('../../lib/supabase', () => {
  function builder(table: string) {
    let op = 'select'
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order']) b[m] = () => b
    b.insert = (row: Record<string, unknown>) => {
      op = 'insert'
      h.inserts.push(row)
      return b
    }
    for (const m of ['update', 'delete'])
      b[m] = () => {
        op = m
        return b
      }
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: op === 'select' ? (h.tables[table] ?? []) : [{ id: 'x' }], error: null }).then(
        resolve,
      )
    return b
  }
  return { supabase: { from: (t: string) => builder(t) } }
})
vi.mock('../../lib/modifierLinks', () => ({
  fetchModifierGroupLinks: async () => [],
  fetchLinkableProducts: async () => h.tables.products ?? [],
  setModifierGroupProducts: async () => {},
}))
vi.mock('../ui/confirm', () => ({ confirm: async () => true }))

import ModifiersTab from '../ModifiersTab'

beforeEach(() => {
  h.tables.modifier_groups = [
    { id: 'g-top', name: 'Topping', selection_type: 'multiple', is_required: false, min_select: 0, max_select: null, display_order: 0 },
    { id: 'g-sos', name: 'Sos', selection_type: 'single', is_required: false, min_select: 0, max_select: null, display_order: 1 },
  ]
  h.tables.modifier_options = []
  h.tables.products = [
    { id: 'p-cio', name: 'Ciorbă de burtă' },
    { id: 'p-mar', name: 'Margherita' },
  ]
  h.inserts = []
})

const nameField = (g: string) => screen.getByLabelText(`Nume opțiune nouă pentru grupul ${g}`)
const priceField = (g: string) => screen.getByLabelText(`Preț suplimentar pentru opțiunea nouă din grupul ${g}`)
function card(g: string): HTMLElement {
  let el: HTMLElement | null = nameField(g)
  while (el && !within(el).queryByRole('button', { name: 'Alege produsele' })) el = el.parentElement
  if (!el) throw new Error(`card ${g} negăsit`)
  return el
}

async function addOption(user: ReturnType<typeof userEvent.setup>, g: string, name: string, price: string) {
  await user.type(nameField(g), name)
  if (price) await user.type(priceField(g), price)
  await user.click(within(card(g)).getByRole('button', { name: 'Adaugă' }))
}

describe('ModifiersTab — prețul opțiunii noi (lotul C4a)', () => {
  it('MOP1 virgula, câmpul gol și minusul', async () => {
    const user = userEvent.setup()
    render(<ModifiersTab restaurantId="r1" />)
    await screen.findByLabelText('Nume opțiune nouă pentru grupul Topping')
    expect(priceField('Topping')).toHaveAttribute('inputmode', 'decimal')
    expect(priceField('Topping')).toHaveValue('')

    // După fiecare adăugare reușită câmpurile se golesc (draft-ul resetat).
    for (const [g, name, price] of [
      ['Topping', 'Mozzarella', '4,50'],
      ['Topping', 'Oregano', ''],
      ['Sos', 'Fără sos', '-1,5'],
    ] as const) {
      await addOption(user, g, name, price)
      await waitFor(() => expect(nameField(g)).toHaveValue(''))
    }
    expect(h.inserts.map((r) => [r.name, r.price_delta])).toEqual([
      ['Mozzarella', 4.5],
      ['Oregano', 0],
      ['Fără sos', -1.5],
    ])
  })

  it('MOP2 un preț fără formă de număr e o eroare lângă câmp, nu 0', async () => {
    const user = userEvent.setup()
    render(<ModifiersTab restaurantId="r1" />)
    await screen.findByLabelText('Nume opțiune nouă pentru grupul Topping')
    await addOption(user, 'Topping', 'Bacon', '4,5,0')
    expect(h.inserts).toEqual([])
    const alert = within(card('Topping')).getByRole('alert')
    expect(alert).toHaveTextContent('Prețul nu e un număr valid')
    expect(priceField('Topping')).toHaveAttribute('aria-invalid', 'true')
    expect(priceField('Topping')).toHaveAttribute('aria-describedby', alert.id)
    // Eroarea e a grupului: celălalt grup n-are nimic.
    expect(within(card('Sos')).queryByRole('alert')).toBeNull()

    await user.type(priceField('Topping'), 'x')
    expect(within(card('Topping')).queryByRole('alert')).toBeNull()
    await user.clear(priceField('Topping'))
    await user.type(priceField('Topping'), '3')
    await user.click(within(card('Topping')).getByRole('button', { name: 'Adaugă' }))
    expect(h.inserts.map((r) => [r.name, r.price_delta])).toEqual([['Bacon', 3]])
  })
})

describe('ModifiersTab — căutarea din „Alege produsele” (lotul C4a)', () => {
  it('SRC5 fără diacritice și fără spațiile de la capete', async () => {
    const user = userEvent.setup()
    render(<ModifiersTab restaurantId="r1" />)
    await screen.findByLabelText('Nume opțiune nouă pentru grupul Topping')
    await user.click(within(card('Topping')).getByRole('button', { name: 'Alege produsele' }))
    const dlg = await screen.findByRole('dialog')
    const search = within(dlg).getByRole('textbox', { name: 'Caută produs' })

    await user.type(search, ' ciorba ')
    expect(within(dlg).getByRole('checkbox', { name: 'Ciorbă de burtă' })).toBeInTheDocument()
    expect(within(dlg).queryByRole('checkbox', { name: 'Margherita' })).toBeNull()

    await user.clear(search)
    await user.type(search, 'pizza')
    expect(within(dlg).getByText('Niciun produs găsit.')).toBeInTheDocument()
    expect(within(dlg).queryAllByRole('checkbox')).toHaveLength(0)
  })
})

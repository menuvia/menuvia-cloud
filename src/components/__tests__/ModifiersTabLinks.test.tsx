// Meniu → Opțiuni: grupurile se aplică pe produse (lotul O1b, audit nov 2026
// MENU-02 / MENU-11). Înainte nimic nu scria legătura produs ↔ grup, deci
// grupurile create aici n-ajungeau la niciun produs.
//
//   ML1  fiecare grup spune câte produse îl folosesc; unul nefolosit avertizează
//        că „clienții nu îl văd”.
//   ML2  „Alege produsele”: bifele pornesc din legăturile existente, salvarea
//        trimite EXACT produsele bifate. [PICĂ: lista pornită goală — salvarea
//        ar dezlega tăcut produsele deja legate]
//   ML3  un grup obligatoriu fără opțiuni disponibile e marcat (produsele lui
//        nu se pot comanda); control: unul cu opțiune disponibilă nu e.
//   ML4  ultima opțiune disponibilă a unui grup obligatoriu folosit cere
//        confirmare înainte de a fi marcată indisponibilă; refuzul nu scrie nimic.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { tables, calls, confirmMock } = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  calls: { setGroupProducts: [] as [string, string[]][], updates: [] as unknown[] },
  confirmMock: vi.fn(async () => true),
}))

vi.mock('../../lib/supabase', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order']) b[m] = () => b
    b.update = (patch: unknown) => {
      calls.updates.push(patch)
      return b
    }
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve)
    return b
  }
  return { supabase: { from: (t: string) => builder(t) } }
})
vi.mock('../../lib/modifierLinks', () => ({
  fetchModifierGroupLinks: async () => tables.product_modifier_groups ?? [],
  setModifierGroupProducts: async (gid: string, pids: string[]) => {
    calls.setGroupProducts.push([gid, pids])
  },
}))
vi.mock('../ui/confirm', () => ({ confirm: confirmMock }))

import ModifiersTab from '../ModifiersTab'

beforeEach(() => {
  tables.modifier_groups = [
    { id: 'g-blat', name: 'Blat', selection_type: 'single', is_required: true, min_select: 1, max_select: null, display_order: 0 },
    { id: 'g-sos', name: 'Sos', selection_type: 'single', is_required: false, min_select: 0, max_select: null, display_order: 1 },
  ]
  tables.modifier_options = [
    { id: 'o-sub', modifier_group_id: 'g-blat', name: 'Subțire', price_delta: 0, is_available: true, display_order: 0 },
    { id: 'o-pic', modifier_group_id: 'g-sos', name: 'Picant', price_delta: 3, is_available: true, display_order: 0 },
  ]
  tables.products = [
    { id: 'p-dia', name: 'Diavola' },
    { id: 'p-mar', name: 'Margherita' },
  ]
  tables.product_modifier_groups = [
    { product_id: 'p-mar', modifier_group_id: 'g-blat', display_order: 0 },
    { product_id: 'p-dia', modifier_group_id: 'g-blat', display_order: 0 },
  ]
  calls.setGroupProducts = []
  calls.updates = []
  confirmMock.mockClear()
  confirmMock.mockResolvedValue(true)
})

function card(name: string): HTMLElement {
  // Cardul grupului = primul strămoș care conține câmpul „opțiune nouă” al lui
  // (antetul cu butoane, opțiunile și rândul de adăugare).
  let el: HTMLElement | null = screen.getByLabelText(`Nume opțiune nouă pentru grupul ${name}`)
  while (el && !within(el).queryByRole('button', { name: 'Alege produsele' })) el = el.parentElement
  if (!el) throw new Error(`card ${name} negăsit`)
  return el
}

describe('ModifiersTab — grupurile se aplică pe produse', () => {
  it('ML1 câte produse folosesc grupul; avertisment pe grupul nefolosit', async () => {
    render(<ModifiersTab restaurantId="r1" />)
    expect(await screen.findByText('Folosit de 2 produse')).toBeInTheDocument()
    expect(screen.getByText('Nu e folosit de niciun produs — clienții nu îl văd')).toBeInTheDocument()
  })

  it('ML2 „Alege produsele” pornește din legăturile existente și salvează bifele', async () => {
    const user = userEvent.setup()
    render(<ModifiersTab restaurantId="r1" />)
    await screen.findByText('Folosit de 2 produse')
    await user.click(within(card('Sos')).getByRole('button', { name: 'Alege produsele' }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByRole('checkbox', { name: 'Diavola' })).not.toBeChecked()
    await user.click(within(dlg).getByRole('checkbox', { name: 'Diavola' }))
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(calls.setGroupProducts).toEqual([['g-sos', ['p-dia']]])

    await user.click(within(card('Blat')).getByRole('button', { name: 'Alege produsele' }))
    const dlg2 = await screen.findByRole('dialog')
    expect(within(dlg2).getByRole('checkbox', { name: 'Diavola' })).toBeChecked()
    expect(within(dlg2).getByRole('checkbox', { name: 'Margherita' })).toBeChecked()
    await user.click(within(dlg2).getByRole('checkbox', { name: 'Margherita' }))
    await user.click(within(dlg2).getByRole('button', { name: 'Salvează' }))
    expect(calls.setGroupProducts[1]).toEqual(['g-blat', ['p-dia']])
  })

  it('ML3 grupul obligatoriu fără opțiuni disponibile e marcat', async () => {
    tables.modifier_options = [
      { id: 'o-sub', modifier_group_id: 'g-blat', name: 'Subțire', price_delta: 0, is_available: false, display_order: 0 },
      { id: 'o-pic', modifier_group_id: 'g-sos', name: 'Picant', price_delta: 3, is_available: true, display_order: 0 },
    ]
    render(<ModifiersTab restaurantId="r1" />)
    await screen.findByText('Folosit de 2 produse')
    expect(within(card('Blat')).getByRole('note')).toHaveTextContent(/nu se pot comanda/)
    expect(within(card('Sos')).queryByRole('note')).toBeNull()
  })

  it('ML4 ultima opțiune a unui grup obligatoriu folosit cere confirmare', async () => {
    const user = userEvent.setup()
    confirmMock.mockResolvedValue(false)
    render(<ModifiersTab restaurantId="r1" />)
    await screen.findByText('Folosit de 2 produse')
    await user.click(within(card('Blat')).getByRole('button', { name: 'Marchează indisponibil' }))
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(calls.updates).toEqual([])
    // Control: grupul opțional nu cere confirmare.
    await user.click(within(card('Sos')).getByRole('button', { name: 'Marchează indisponibil' }))
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(calls.updates).toEqual([{ is_available: false }])
  })
})

// Editorul de regulă Happy Hour (lotul C4a): dialog real, un singur „Creează”,
// prețuri cu virgulă, ordinea meniului. Textele în limbi sunt în
// HappyHourLang.test.tsx (HP0–HP6). Reducerea se aplică pe SERVER (mig 077);
// aici se verifică doar ce trimite editorul.
// (Prefixul HHM: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md, nefolosit înainte.)
//   HHM1 editorul e un dialog cu nume (`role="dialog"`, titlul „Regulă nouă”),
//        iar câmpurile au nume accesibile din etichetă (`<label htmlFor>`):
//        „Nume *”, „De la”, „Până la”, lista de categorii. Control pozitiv:
//        butonul „Creează regulă” e în dialog. Mutația care pică: overlay-ul
//        `div` de dinainte readus (fără rol) sau etichetele `<div style={lbl}>`.
//   HHM2 dublu-click pe „Creează regulă” cât cererea e în aer → regula se
//        creează O SINGURĂ dată, iar butonul arată „Se salvează…” dezactivat;
//        după un refuz butonul revine (control: a doua încercare pleacă).
//        Mutația care pică: garda `savingRef` / `disabled={saving}` scoasă.
//   HHM3 închiderea cu formularul modificat întreabă („Renunți la
//        modificări?”, „Rămân în editor”): refuzul lasă editorul deschis, ✕ +
//        acceptul îl închide; FĂRĂ modificări, „Anulează” închide direct, fără
//        întrebare (control). Mutația care pică: `confirmClose` scos de pe Modal
//        sau „Anulează” legat direct de `onClose`.
//   HHM4 valoarea și plafonul cu virgulă („12,5” / „7,5”) pleacă 12.5 / 7.5; un
//        plafon fără formă de număr („abc”) e o eroare, nu un plafon șters
//        tăcut (NaN → `null` în JSON). Mutația care pică: `type="number"` readus
//        (jsdom golește „12,5”) sau verificarea NaN a plafonului scoasă.
//   HHM5 categoriile se cer în ordinea MENIULUI (`display_order`), nu pe coloana
//        veche `position`. Mutația care pică: `.order('position')` readus.
//   HHM6 ștergerea trece prin confirm() (ui/confirm): refuzată → nimic șters;
//        acceptată → regula aleasă e ștearsă. Mutația care pică: ștergerea
//        fără confirmare.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HappyHourRule } from '../../lib/happyHour'
import type { ConfirmOptions } from '../ui/confirm'

type NewRule = Omit<HappyHourRule, 'id' | 'restaurant_id' | 'created_at' | 'updated_at'>

const h = vi.hoisted(() => ({
  rules: [] as HappyHourRule[],
  created: [] as NewRule[],
  deleted: [] as string[],
  // Cererea de creare rămâne „în aer” până o rezolvă testul (HHM2).
  pending: null as null | { resolve: () => void; reject: (e: unknown) => void },
  holdCreate: false,
  orders: [] as [string, string][],
  confirm: [] as ConfirmOptions[],
  answer: false,
}))

vi.mock('../ui/confirm', () => ({
  confirm: async (o: ConfirmOptions) => {
    h.confirm.push(o)
    return h.answer
  },
}))
vi.mock('../../lib/happyHour', () => ({
  fetchHappyHourRules: async () => h.rules,
  evaluateHappyHourForNow: async () => [],
  createHappyHourRule: (_rid: string, fields: NewRule) => {
    h.created.push(fields)
    if (!h.holdCreate) return Promise.resolve(h.rules[0])
    return new Promise<void>((resolve, reject) => {
      h.pending = { resolve, reject }
    })
  },
  updateHappyHourRule: async () => {},
  deleteHappyHourRule: async (id: string) => {
    h.deleted.push(id)
  },
}))
vi.mock('../../lib/supabase', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) b[m] = () => b
    b.order = (col: string) => {
      h.orders.push([table, col])
      return b
    }
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({
        data:
          table === 'categories'
            ? [
                { id: 'c1', name: 'Cocktailuri', emoji: '🍹' },
                { id: 'c2', name: 'Bere', emoji: '🍺' },
              ]
            : [],
        error: null,
      }).then(resolve)
    return b
  }
  return { supabase: { from: (t: string) => builder(t) } }
})
vi.mock('../../hooks/usePollWhileVisible', () => ({ usePollWhileVisible: () => {} }))
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))

import HappyHourTab from '../HappyHourTab'

function rule(over: Partial<HappyHourRule>): HappyHourRule {
  return {
    id: 'r1',
    restaurant_id: 'rest-1',
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
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    ...over,
  }
}

beforeEach(() => {
  h.rules = [rule({}), rule({ id: 'r2', name: 'Seara' })]
  h.created = []
  h.deleted = []
  h.pending = null
  h.holdCreate = false
  h.orders = []
  h.confirm = []
  h.answer = false
})

async function openNew() {
  const user = userEvent.setup()
  render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
  await screen.findByText('Seara')
  await user.click(screen.getByRole('button', { name: 'Regulă nouă' }))
  return { user, dlg: screen.getByRole('dialog', { name: 'Regulă nouă' }) }
}

describe('editorul Happy Hour (lotul C4a)', () => {
  it('HHM1 dialog real, cu câmpuri numite', async () => {
    const { user, dlg } = await openNew()
    expect(within(dlg).getByRole('button', { name: 'Creează regulă' })).toBeInTheDocument()
    expect(within(dlg).getByLabelText('Nume *')).toHaveAttribute('placeholder', 'ex: Happy Hour 17-19')
    expect(within(dlg).getByLabelText('De la')).toHaveValue('17:00')
    expect(within(dlg).getByLabelText('Până la')).toHaveValue('19:00')
    expect(within(dlg).getByRole('group', { name: 'Zilele săptămânii (gol = toate)' })).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Categorie' }))
    expect(within(dlg).getByRole('button', { name: 'Categorie' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dlg).getByRole('combobox', { name: 'Categorie' })).toBeInTheDocument()
  })

  it('HHM2 dublu-click: regula se creează o singură dată', async () => {
    h.holdCreate = true
    const { user, dlg } = await openNew()
    await user.type(within(dlg).getByLabelText('Nume *'), 'Seara de joi')
    const create = within(dlg).getByRole('button', { name: 'Creează regulă' })
    await user.dblClick(create)
    await user.click(create)
    expect(h.created).toHaveLength(1)
    const busy = within(dlg).getByRole('button', { name: 'Se salvează…' })
    expect(busy).toBeDisabled()

    // Refuzul deblochează butonul: a doua încercare pleacă (control).
    h.pending?.reject({ message: 'Nu ai voie.', code: '42501' })
    expect(await within(dlg).findByRole('button', { name: 'Creează regulă' })).toBeEnabled()
    h.holdCreate = false
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(h.created).toHaveLength(2))
  })

  it('HHM3 închiderea cu modificări întreabă; fără modificări, nu', async () => {
    const { user, dlg } = await openNew()
    // Control: neatins → „Anulează” închide direct, fără întrebare.
    await user.click(within(dlg).getByRole('button', { name: 'Anulează' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.confirm).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Regulă nouă' }))
    let open = screen.getByRole('dialog', { name: 'Regulă nouă' })
    await user.type(within(open).getByLabelText('Nume *'), 'Brunch')
    await user.click(within(open).getByRole('button', { name: 'Anulează' }))
    await waitFor(() => expect(h.confirm).toHaveLength(1))
    expect(h.confirm[0]).toMatchObject({ title: 'Renunți la modificări?', cancelLabel: 'Rămân în editor' })
    open = screen.getByRole('dialog', { name: 'Regulă nouă' })
    expect(within(open).getByLabelText('Nume *')).toHaveValue('Brunch')

    h.answer = true
    await user.click(within(open).getByRole('button', { name: 'Închide' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.confirm).toHaveLength(2)
    expect(h.created).toHaveLength(0)
  })

  it('HHM4 valoarea și plafonul cu virgulă; plafonul invalid e o eroare', async () => {
    const { user, dlg } = await openNew()
    await user.type(within(dlg).getByLabelText('Nume *'), 'Happy')
    const value = within(dlg).getByLabelText('Valoarea reducerii')
    await user.clear(value)
    await user.type(value, '12,5')
    const cap = within(dlg).getByLabelText('Plafon maxim în lei, opțional')
    await user.type(cap, 'abc')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Plafonul nu e un număr valid')
    expect(cap).toHaveAttribute('aria-invalid', 'true')
    expect(h.created).toHaveLength(0)

    await user.clear(cap)
    await user.type(cap, '7,5')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(h.created).toHaveLength(1))
    expect(h.created[0]).toMatchObject({ discount_type: 'percent', discount_value: 12.5, max_discount: 7.5 })
  })

  it('HHM5 categoriile în ordinea meniului', async () => {
    render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
    await screen.findByText('Seara')
    expect(h.orders).toContainEqual(['categories', 'display_order'])
    expect(h.orders).not.toContainEqual(['categories', 'position'])
  })

  it('HHM6 ștergerea cere confirmare', async () => {
    const user = userEvent.setup()
    render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
    await screen.findByText('Seara')
    await user.click(screen.getByRole('button', { name: 'Șterge regula Seara' }))
    await waitFor(() => expect(h.confirm).toHaveLength(1))
    expect(h.confirm[0]).toMatchObject({
      title: 'Ștergi regula?',
      description: 'Vrei să ștergi Seara? Acțiunea e ireversibilă.',
      confirmLabel: 'Șterge',
      cancelLabel: 'Anulează',
      destructive: true,
    })
    expect(h.deleted).toEqual([])

    h.answer = true
    await user.click(screen.getByRole('button', { name: 'Șterge regula Seara' }))
    await waitFor(() => expect(h.deleted).toEqual(['r2']))
  })
})

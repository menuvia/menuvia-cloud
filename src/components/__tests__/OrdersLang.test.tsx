// Dialogurile de comandă COMUNE în limba personalului (lotul L4a): anularea,
// editarea, foaia de opțiuni, cardul ospătarului citesc textele din
// namespace-ul `orders` (+ „Editează” / „Șterge” / „Se încarcă…” din `common`).
//   LO1  control — fără provider (azi, mereu româna) textele sunt cele de
//        dinainte, inclusiv propoziția cu element (fillNodes) „Preluat de: …”.
//        Mutația care pică: o cheie cu textul românesc schimbat.
//   LO2  CancelOrderDialog în engleză, cu plăți încasate: titlul, suma blocată,
//        metoda, propozițiile cu <strong>, eticheta, placeholder-ul, butoanele —
//        și NICIUN cuvânt românesc. Mutația care pică: un literal românesc lăsat
//        în dialog (ex. „Renunță” scris în cod, sau METHOD_LABEL readus).
//   LO3  OrderCard în germană: starea, „Stornieren” (cheie proprie, nu
//        „Abbrechen” din common), „Bearbeiten” din common, închiderea
//        nefiscală, iar „Închide masa” cu 2 runde neservite cere confirmarea cu
//        pluralul german. Mutația care pică: `tp` înlocuit cu textul românesc
//        `${n} runde…`, sau eticheta stării citită din STATUS_META.label.
//   LO4  OrderCard pe Planul 3 în franceză: pasul următor vine din
//        `waiterForwardStep().labelKey` tradus. Mutația care pică: cardul
//        randează un text fix din lib/waiterSteps.
//   LO5  ModifierSheet în engleză și germană: microcopy-ul grupului (fost
//        `modifierGroupHint`, românesc), „ce mai trebuie ales”, cantitatea,
//        nota și prețul din buton. Mutația care pică: `modifierGroupHint(g)`
//        readus în foaie (ar afișa „Alege între 1 și 2”).
//   LO6  EditOrderSheet în engleză: un refuz cu hint cunoscut
//        (`invalid_source_item`) apare TRADUS, iar un refuz cu mesaj ROMÂNESC
//        al serverului (`missing_required_group`) NU ajunge pe ecran — apare
//        textul englezesc al clasei. Control în română: același refuz arată
//        mesajul serverului, fără prefixul tehnic (comportamentul de dinainte).
//        Mutația care pică: `describeEditOrderError` care întoarce `plain`
//        indiferent de limbă (ecran amestecat), sau `toUserMessage` în locul
//        dicționarului.
//   LO7  helperii puri (`describeAuditEntry`, `describeEditOrderError`) în
//        franceză/germană, cu pluralul real („1 produit” / „3 produits”).
//        Mutația care pică: un text românesc rămas într-o ramură a helperului.
//   LO8  control românesc al foii de opțiuni: microcopy-ul grupurilor e EGAL cu
//        `modifierGroupHint` (lib/qr, oracolul GK5) pe cele șase forme din GK5,
//        plus „ce mai trebuie ales” și prețul din buton. Foaia are propria copie
//        a regulii (`groupHint`), deci fără LO8 româna ei nu e ținută de niciun
//        test. Mutația care pică: o cheie `mod_*` cu textul schimbat sau o
//        ramură din `groupHint` divergentă.
import { Suspense, type ComponentProps, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { confirmMock, updateOrderItemsMock, fetchOrderByIdMock, fetchMenuMock } = vi.hoisted(() => ({
  confirmMock: vi.fn<(opts: { title: string; description?: string; confirmLabel?: string }) => Promise<boolean>>(),
  updateOrderItemsMock: vi.fn(),
  fetchOrderByIdMock: vi.fn(),
  fetchMenuMock: vi.fn(),
}))

// Același tipar ca WaiterOrderCard.test / EditOrderSheet.test: dialogul de
// confirmare e un singleton montat în App; RPC-urile editării sunt mock-uite.
vi.mock('../ui/confirm', () => ({ confirm: confirmMock }))
vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return { ...actual, updateOrderItems: updateOrderItemsMock, fetchOrderById: fetchOrderByIdMock }
})
vi.mock('../../lib/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/qr')>()
  return { ...actual, fetchMenuForRestaurant: fetchMenuMock }
})

import CancelOrderDialog from '../CancelOrderDialog'
import EditOrderSheet from '../EditOrderSheet'
import ModifierSheet from '../ModifierSheet'
import { OrderCard } from '../WaiterOrderCard'
import { describeAuditEntry, describeEditOrderError, type AuditEntry, type Order } from '../../lib/orders'
import { modifierGroupHint, type ModifierGroup } from '../../lib/qr'
import { makeCategory, makeGroup, makeOption, makeOrder, makeOrderItem, makeProduct, makeTable } from './fixtures'
import { makeTranslator, preloadNamespace } from '../../i18n/core'
import { ordersNs } from '../../i18n/ns/orders'
import { commonNs } from '../../i18n/ns/common'
import type ordersRo from '../../i18n/ns/orders/ro'
import ordersFr from '../../i18n/ns/orders/fr'
import ordersDe from '../../i18n/ns/orders/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

// Ce trădează un text românesc rămas pe un ecran în altă limbă.
const ROMANIAN = /[ăâîșțşţĂÂÎȘȚ]|\b(?:Anulează|Renunță|Comanda|comanda|Masa|Motiv|Plată|Închide|Editează|Alege|Cantitate|Mențiuni|Adaugă|lei plăți|Servit|Nou)\b/

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(ordersNs, l), preloadNamespace(commonNs, l)]))
})

beforeEach(() => {
  vi.clearAllMocks()
  confirmMock.mockResolvedValue(true)
})

function inLang(lang: StaffLang | null, node: ReactNode) {
  const tree = <Suspense fallback={null}>{node}</Suspense>
  return render(lang ? <UiLangScope lang={lang}>{tree}</UiLangScope> : tree)
}

const PAYMENTS = [
  { id: 'pay-1', amount: 60, method: 'cash', created_at: '2026-09-07T10:00:00Z' },
  { id: 'pay-2', amount: 15, method: 'card_online', created_at: '2026-09-07T10:05:00Z' },
]

function card(order: Order, extra: Partial<ComponentProps<typeof OrderCard>> = {}) {
  return (
    <OrderCard
      order={order}
      onPayOpen={vi.fn()}
      onSplitOpen={vi.fn()}
      onEdit={vi.fn()}
      onCancel={vi.fn()}
      onCloseOrder={vi.fn()}
      {...extra}
    />
  )
}

describe('dialogurile de comandă în limba personalului', () => {
  it('LO1: control — fără provider, româna de dinainte', () => {
    inLang(
      null,
      <CancelOrderDialog order={makeOrder({ status: 'new' })} payments={[]} onConfirm={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByRole('dialog', { name: 'Anulează comanda' })).toBeInTheDocument()
    expect(screen.getByText('Motiv (opțional)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Renunță' })).toBeInTheDocument()

    inLang(
      null,
      card(makeOrder({ id: 'o-ro', status: 'served', _created_by_profile: { full_name: 'Ana' } }), {
        paymentsEnabled: false,
      }),
    )
    expect(screen.getByRole('button', { name: 'Închide comanda' })).toBeInTheDocument()
    expect(screen.getByText('Servit')).toBeInTheDocument()
    expect(screen.getByText('Fără masă')).toBeInTheDocument()
    expect(screen.getByText('Ana').parentElement).toHaveTextContent('Preluat de: Ana')
    expect(screen.getByText('Plata și bonul se fac pe casa de marcat existentă')).toBeInTheDocument()
  })

  it('LO2: anularea în engleză, cu plăți încasate — fără niciun cuvânt românesc', () => {
    const { container } = inLang(
      'en',
      <CancelOrderDialog
        order={makeOrder({ status: 'served', total: 100, table: makeTable({ name: '7' }) })}
        payments={PAYMENTS}
        onConfirm={vi.fn()}
        onVoidAndCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Cancel order' })
    expect(dialog).toHaveTextContent('Table 7 · 100.00 lei')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(
      'This order has 75.00 lei in payments collected and can’t be cancelled directly.',
    )
    expect(alert).toHaveTextContent('60.00 lei · Cash')
    expect(alert).toHaveTextContent('15.00 lei · Online card')
    expect(within(alert).getByText('returned to the guest').tagName).toBe('STRONG')
    expect(within(alert).getByText('Online payments are refunded manually in Stripe').tagName).toBe('STRONG')
    expect(alert).toHaveTextContent('refunded manually in Stripe before voiding.')
    expect(screen.getByText('Reason (required to void payments)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('E.g. the guest cancelled, item unavailable…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Void payments and cancel' })).toBeDisabled()
    expect(container.textContent ?? '').not.toMatch(ROMANIAN)
  })

  it('LO3: cardul ospătarului în germană; „Închide masa” cu pluralul german', async () => {
    const user = userEvent.setup()
    const onCloseTable = vi.fn()
    const order = makeOrder({
      status: 'served',
      session_id: 's1',
      table: makeTable({ name: '4' }),
      order_items: [makeOrderItem({ product_name_snapshot: 'Pizza', quantity: 2 })],
    })
    const { container } = inLang(
      'de',
      card(order, { paymentsEnabled: false, onCloseTable, sessionUnservedCount: 2 }),
    )
    expect(screen.getByText('Serviert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stornieren' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bestellung abschließen' })).toBeInTheDocument()
    expect(screen.getByText('Zahlung und Beleg laufen über Ihre bestehende Kasse')).toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(ROMANIAN)

    await user.click(screen.getByRole('button', { name: 'Tisch abschließen' }))
    expect(confirmMock).toHaveBeenCalledWith({
      title: 'Tisch abschließen?',
      description:
        'Servierte Bestellungen werden abgeschlossen; 2 nicht servierte Runden (neu oder in Zubereitung) werden STORNIERT. Zahlung und Beleg laufen über die Kasse des Lokals.',
      confirmLabel: 'Tisch abschließen',
    })
    await waitFor(() => expect(onCloseTable).toHaveBeenCalledWith(order))
  })

  it('LO4: pe Planul 3, pasul următor tradus din labelKey (franceză)', () => {
    inLang(
      'fr',
      card(makeOrder({ status: 'new', source: 'waiter' }), { paymentsEnabled: true, onAdvance: vi.fn() }),
    )
    expect(screen.getByText('Nouvelle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Passer en préparation' })).toBeInTheDocument()
    expect(screen.getByText('Manuelle')).toBeInTheDocument()
    expect(screen.queryByText(/Marchează în pregătire/)).toBeNull()
  })

  it('LO5: foaia de opțiuni în engleză și germană', () => {
    const group = makeGroup({
      name: 'Toppings',
      selection_type: 'multiple',
      min_select: 1,
      max_select: 2,
      modifier_options: [makeOption({ name: 'Bacon' }), makeOption({ name: 'Cheddar' })],
    })
    const product = makeProduct({ name: 'Burger', price: 10, modifier_groups: [group] })

    const en = inLang('en', <ModifierSheet product={product} onAdd={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Choose between 1 and 2')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Choose: Toppings')
    expect(screen.getByText('Quantity')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Notes (optional)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to order — 10.00 lei' })).toBeDisabled()
    expect(en.container.textContent ?? '').not.toMatch(ROMANIAN)
    en.unmount()

    inLang('de', <ModifierSheet product={product} onAdd={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Zwischen 1 und 2 wählen')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Bitte wählen: Toppings')
    expect(screen.getByRole('button', { name: 'Zur Bestellung hinzufügen — 10.00 lei' })).toBeInTheDocument()
  })

  it('LO8: foaia de opțiuni în română — microcopy-ul e oglinda lui modifierGroupHint', () => {
    // Cele șase forme din GK5 (guestI18n.test.ts), în aceeași ordine.
    const shapes: ReadonlyArray<
      Pick<ModifierGroup, 'selection_type' | 'is_required' | 'min_select' | 'max_select'>
    > = [
      { selection_type: 'multiple', is_required: true, min_select: 2, max_select: 2 },
      { selection_type: 'multiple', is_required: false, min_select: 1, max_select: 3 },
      { selection_type: 'multiple', is_required: true, min_select: 0, max_select: null },
      { selection_type: 'multiple', is_required: false, min_select: 0, max_select: 4 },
      { selection_type: 'multiple', is_required: false, min_select: 0, max_select: null },
      { selection_type: 'single', is_required: true, min_select: 1, max_select: 1 },
    ]
    const groups = shapes.map((shape, i) => {
      const id = `lo8-g${i + 1}`
      return makeGroup({
        id,
        name: i === 0 ? 'Toppings' : `Grupa ${i + 1}`,
        ...shape,
        modifier_options: [
          makeOption({ id: `${id}-a`, modifier_group_id: id, name: `A${i + 1}` }),
          makeOption({ id: `${id}-b`, modifier_group_id: id, name: `B${i + 1}` }),
        ],
      })
    })
    const product = makeProduct({ name: 'Burger', price: 10, modifier_groups: groups })

    inLang(null, <ModifierSheet product={product} onAdd={vi.fn()} onClose={vi.fn()} />)
    const expected = shapes.map((shape) => modifierGroupHint(shape)).filter((h): h is string => h !== null)
    // Oracolul însuși, ca o modificare a lui să nu treacă neobservată aici.
    expect(expected).toEqual(['Alege exact 2', 'Alege între 1 și 3', 'Alege cel puțin 1', 'Maxim 4'])
    for (const hint of expected) expect(screen.getByText(hint)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Alege: Toppings')
    expect(screen.getByText('Cantitate')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Mențiuni (opțional)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adaugă în comandă — 10.00 lei' })).toBeDisabled()
  })

  it('LO6: editarea în engleză — hint cunoscut tradus, mesajul românesc al serverului nu apare', async () => {
    const user = userEvent.setup()
    const order = makeOrder({
      id: 'o1',
      total: 20,
      table: makeTable({ name: '5' }),
      order_items: [makeOrderItem({ id: 'it1', product_id: 'p1', product_name_snapshot: 'Supă', quantity: 2, item_total: 20 })],
    })
    fetchMenuMock.mockResolvedValue([
      makeCategory({ id: 'c1', name: 'Supe', products: [makeProduct({ id: 'p1', name: 'Supă' })] }),
    ])
    fetchOrderByIdMock.mockResolvedValue(order)
    const romanian = 'grupul "Pâine" pentru produsul "Supă" cere cel puțin 1 opțiune selectată'
    updateOrderItemsMock
      .mockRejectedValueOnce(Object.assign(new Error('update_order_items: linia sursă nu mai există'), { hint: 'invalid_source_item' }))
      .mockRejectedValueOnce(Object.assign(new Error(`update_order_items: ${romanian}`), { hint: 'missing_required_group' }))

    const { container, unmount } = inLang('en', <EditOrderSheet order={order} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('Edit order')).toBeInTheDocument()
    expect(container).toHaveTextContent('Table 5 · #')
    expect(screen.getByText('New subtotal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone else changed this order in the meantime. Close and reopen the order, then try again.',
    )

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The options chosen don’t follow the rules of one of the item’s option groups. Check the item and save again.',
      ),
    )
    expect(screen.queryByText(romanian)).toBeNull()
    expect(container.textContent ?? '').not.toMatch(/Pâine|cere cel puțin|update_order_items/)
    unmount()

    // Control în română: același refuz → mesajul serverului, fără prefixul tehnic.
    updateOrderItemsMock.mockRejectedValueOnce(
      Object.assign(new Error(`update_order_items: ${romanian}`), { hint: 'missing_required_group' }),
    )
    inLang(null, <EditOrderSheet order={order} onClose={vi.fn()} onSaved={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Salvează modificările' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(romanian)
  })

  it('LO7: helperii puri în franceză și germană, cu pluralul limbii', () => {
    const fr = makeTranslator<typeof ordersRo>(ordersFr, 'fr')
    const de = makeTranslator<typeof ordersRo>(ordersDe, 'de')
    const entry = (over: Partial<AuditEntry>): AuditEntry => ({
      id: 1,
      created_at: '2026-01-01T00:00:00Z',
      actor_id: null,
      actor_name: null,
      table_name: 'order_items',
      operation: 'UPDATE',
      row_id: 'o1',
      changed_keys: null,
      diff_short: null,
      ...over,
    })
    const change = (from: number, to: number) =>
      entry({ diff_short: { items: { from: Array(from).fill({}), to: Array(to).fill({}) }, total: { to: 22.5 } } })
    expect(describeAuditEntry(change(2, 1), fr)).toBe('A modifié la commande (2 → 1 produit · total 22.50 lei)')
    expect(describeAuditEntry(change(1, 3), fr)).toBe('A modifié la commande (1 → 3 produits · total 22.50 lei)')
    expect(describeAuditEntry(change(2, 1), de)).toBe('Hat die Bestellung geändert (2 → 1 Produkt · Summe 22.50 lei)')
    expect(
      describeAuditEntry(entry({ table_name: 'orders', changed_keys: ['status'], diff_short: { status: { to: 'paid' } } }), de),
    ).toBe('Hat die Zahlung kassiert')
    expect(
      describeEditOrderError({ message: 'update_order_items: produsul "Supă" este epuizat (0)', hint: 'product_sold_out' }, de),
    ).toBe(
      'Das Produkt „Supă“ ist ausverkauft und kann nicht mehr hinzugefügt werden. Entfernen Sie es aus der Bestellung und speichern Sie erneut.',
    )
    expect(describeEditOrderError(new Error('TypeError: Load failed'), fr)).toMatch(/^Pas de connexion/)
  })
})

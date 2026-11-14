// Ecranul ospătarului în limba personalului (lotul L4b): panoul „Stadiu mese”
// (TableStatusBoard + BoardTableCard + TableStatusMap), alocarea meselor
// (WaiterAssignments), nota de refuz de pe card (ActionErrorNote) și helperii
// puri (`describeCancelRejection`, `describeWaiterOrderSent`, `elapsedT`).
// Pagina /waiter are suita ei: src/pages/__tests__/WaiterPageLang.test.tsx.
//   LW1  control — fără provider (azi, mereu româna) panoul „Stadiu mese” e
//        cel de dinainte: cele 5 stări, „4 loc.”, „1 rundă · de 5 min”,
//        „Vezi (1)”, pastilele. Mutația care pică: o cheie `state_*` / `board_*`
//        cu textul românesc schimbat.
//   LW2  panoul în engleză și germană: stările, locurile cu plural real,
//        rundele, „de cât timp”, butoanele — și NICIUN text românesc al
//        namespace-ului. Mutația care pică: `STATE_META.label` readus, sau
//        `openSince` cu „de ${mins} min” scris în cod.
//   LW3  harta în franceză: comutatorul Grilă/Hartă, eticheta hărții, suma de
//        pe masă și aria-label-ul mesei (cu starea TRADUSĂ venită din panou),
//        indicația de sub hartă. Mutația care pică: `stateById` construit cu
//        eticheta românească (cheia, nu `t(cheie)`).
//   LW4  alocarea meselor: în română pluralul FALS de dinainte („1 mese
//        alocate”) rămâne byte-identic (control); în franceză rolul, pluralul
//        real, propozițiile cu <strong> (fillNodes) și titlul butonului mesei.
//        Mutația care pică: `ROLE_LABELS` readus sau `{n} mese alocate` în cod.
//   LW5  ActionErrorNote: „Închide mesajul” în română, „Meldung schließen” în
//        germană. Mutația care pică: aria-label-ul scris în cod.
//   LW6  `describeCancelRejection` în franceză/germană: hint-urile au textul
//        limbii; mesajul ROMÂNESC al serverului (cu suma) NU ajunge pe ecran;
//        rețeaua are textul ei; un hint necunoscut cade pe textul generic.
//        Mutația care pică: `serverMsg` folosit fără condiția de limbă.
//   LW7  `describeWaiterOrderSent` și `elapsedT`: română == textele/`elapsed()`
//        de dinainte (control), engleză/franceză/germană cu unitățile limbii.
//        Mutația care pică: `elapsedT` cu unitățile românești scrise în cod.
import { Suspense, type ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  members: [] as Array<{ user_id: string; role: string; full_name: string | null; email: string | null }>,
  tables: [] as Array<{ id: string; name: string; seats: number | null }>,
  assignments: [] as Array<{ user_id: string; table_id: string }>,
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }))
// PostgREST pentru WaiterAssignments: membrii (RPC), mesele și alocările.
vi.mock('../../lib/supabase', () => {
  function chain(rows: () => unknown[]): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'order', 'in', 'limit']) c[k] = () => c
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(ok, ko)
    return c
  }
  return {
    supabase: {
      rpc: () => Promise.resolve({ data: h.members, error: null }),
      from: (table: string) => chain(() => (table === 'tables' ? h.tables : h.assignments)),
    },
  }
})

import TableStatusBoard from '../TableStatusBoard'
import TableStatusMap from '../TableStatusMap'
import WaiterAssignments from '../WaiterAssignments'
import { ActionErrorNote } from '../ActionErrorNote'
import { describeCancelRejection, describeWaiterOrderSent, type Order, type WaiterCall } from '../../lib/orders'
import { elapsedT } from '../../i18n/elapsed'
import { makeOrder, makeOrderItem } from './fixtures'
import { makeTranslator, preloadNamespace, type Dict } from '../../i18n/core'
import { waiterNs } from '../../i18n/ns/waiter'
import { ordersNs } from '../../i18n/ns/orders'
import { commonNs } from '../../i18n/ns/common'
import waiterRo from '../../i18n/ns/waiter/ro'
import waiterEn from '../../i18n/ns/waiter/en'
import waiterFr from '../../i18n/ns/waiter/fr'
import waiterDe from '../../i18n/ns/waiter/de'
import ordersRo from '../../i18n/ns/orders/ro'
import ordersFr from '../../i18n/ns/orders/fr'
import ordersDe from '../../i18n/ns/orders/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'
import type { FloorLayout } from '../../lib/floorPlan'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(
    langs.flatMap((l) => [preloadNamespace(waiterNs, l), preloadNamespace(ordersNs, l), preloadNamespace(commonNs, l)]),
  )
})

beforeEach(() => {
  h.members = []
  h.tables = []
  h.assignments = []
})

afterEach(() => {
  vi.useRealTimers()
})

function inLang(lang: StaffLang | null, node: ReactNode) {
  const tree = <Suspense fallback={null}>{node}</Suspense>
  return render(lang ? <UiLangScope lang={lang}>{tree}</UiLangScope> : tree)
}

/** Fragmentele românești ale namespace-ului `waiter` rămase în text (fără cele
 *  identice în limba țintă: „Manager”, „Cash”…). Un text cu locuri `{x}` se
 *  verifică pe bucățile lui fixe de cel puțin 6 caractere. */
function romanianLeftovers(text: string, target: Dict): string[] {
  const forms = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  for (const [k, v] of Object.entries(waiterRo as Dict)) {
    const own = forms(target[k]).join('\n')
    for (const f of forms(v)) {
      for (const piece of f.split(/\{\w+\}/)) {
        const p = piece.trim()
        if (p.length >= 6 && !own.includes(p) && text.includes(p)) out.push(`${k}: ${p}`)
      }
    }
  }
  return out
}

const MIN = 60_000

function boardFixture(now: number): { orders: Order[]; calls: WaiterCall[] } {
  const orders = [
    makeOrder({
      id: 'o-t1',
      table_id: 't1',
      status: 'preparing',
      total: 42,
      created_at: new Date(now - 5 * MIN).toISOString(),
      order_items: [makeOrderItem({ product_name_snapshot: 'Pizza', quantity: 2 })],
    }),
  ]
  const calls: WaiterCall[] = [
    {
      id: 'c1',
      restaurant_id: 'r1',
      table_id: 't1',
      call_type: 'bill',
      tip_amount: null,
      status: 'pending',
      created_at: new Date(now - MIN).toISOString(),
      resolved_at: null,
      table: { name: '1' },
    },
  ]
  return { orders, calls }
}

const TABLES = [
  { id: 't1', name: '1', seats: 4 },
  { id: 't2', name: '2', seats: 1 },
]

function board(orders: Order[], calls: WaiterCall[], floorLayout: FloorLayout | null = null) {
  return (
    <TableStatusBoard
      tables={TABLES}
      orders={orders}
      waiterCalls={calls}
      floorLayout={floorLayout}
      onAddToTable={vi.fn()}
      renderOrderCard={(o) => <div>card-{o.id}</div>}
    />
  )
}

describe('„Stadiu mese” în limba personalului', () => {
  it('LW1: control — fără provider, româna de dinainte', () => {
    const { orders, calls } = boardFixture(Date.now())
    const { container } = inLang(null, board(orders, calls))
    expect(screen.getByText('Cere nota')).toBeInTheDocument()
    expect(screen.getByText('Liberă')).toBeInTheDocument()
    expect(screen.getByText('4 loc.')).toBeInTheDocument()
    expect(screen.getByText('1 loc.')).toBeInTheDocument()
    expect(screen.getByText('42.00 lei')).toBeInTheDocument()
    expect(container).toHaveTextContent('1 rundă · de 5 min')
    expect(screen.getByRole('button', { name: 'Adaugă la masă' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vezi (1)' })).toBeInTheDocument()
    expect(screen.getByText('Nicio comandă deschisă')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deschide comandă' })).toBeInTheDocument()
    expect(screen.getByText('Cer atenție')).toBeInTheDocument()
    expect(screen.getByText('Ocupate')).toBeInTheDocument()
    expect(screen.getByText('Libere')).toBeInTheDocument()
  })

  it('LW1b: control — panoul gol are textul de dinainte', () => {
    inLang(
      null,
      <TableStatusBoard tables={[]} orders={[]} waiterCalls={[]} onAddToTable={vi.fn()} renderOrderCard={() => null} />,
    )
    expect(screen.getByText('Nicio masă configurată')).toBeInTheDocument()
    expect(screen.getByText('Adaugă mese în „Mese & QR” ca să vezi stadiul lor aici.')).toBeInTheDocument()
  })

  it('LW2: panoul în engleză și germană — fără text românesc', async () => {
    const user = userEvent.setup()
    const now = Date.now()
    const { orders, calls } = boardFixture(now)
    const en = inLang('en', board(orders, calls))
    expect(await screen.findByText('Asks for the bill')).toBeInTheDocument()
    // „Free” = starea mesei 2 ȘI eticheta pastilei de rezumat.
    expect(screen.getAllByText('Free')).toHaveLength(2)
    expect(screen.getByText('4 seats')).toBeInTheDocument()
    expect(screen.getByText('1 seat')).toBeInTheDocument()
    expect(en.container).toHaveTextContent('1 round · for 5 min')
    expect(screen.getByRole('button', { name: 'Add to table' })).toBeInTheDocument()
    expect(screen.getByText('No open orders')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open an order' })).toBeInTheDocument()
    expect(screen.getByText('Need attention')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View (1)' }))
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true')
    expect(romanianLeftovers(en.container.textContent ?? '', waiterEn)).toEqual([])
    en.unmount()

    // Germană: două runde pe masă, deschisă de 1h 20m, pluralul german.
    const two = [
      ...orders,
      makeOrder({ id: 'o-t1b', table_id: 't1', status: 'ready', total: 8, created_at: new Date(now - 80 * MIN).toISOString() }),
    ]
    const de = inLang('de', board(two, []))
    expect(await screen.findByText('Zu servieren')).toBeInTheDocument()
    expect(de.container).toHaveTextContent('2 Runden · seit 1 Std. 20 Min.')
    expect(screen.getByText('50.00 lei')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ansehen (2)' })).toBeInTheDocument()
    expect(screen.getAllByText('Frei')).toHaveLength(2)
    expect(romanianLeftovers(de.container.textContent ?? '', waiterDe)).toEqual([])
  })

  it('LW3: harta în franceză — eticheta hărții, aria-label-ul mesei cu starea tradusă', async () => {
    const user = userEvent.setup()
    const { orders, calls } = boardFixture(Date.now())
    const layout: FloorLayout = {
      version: 1,
      savedAt: '2026-01-01T00:00:00Z',
      floors: [
        {
          id: 'f1',
          name: 'Sala',
          walls: [],
          decos: [],
          zones: [],
          tables: [
            { id: 'ft1', x: 10, y: 10, w: 80, h: 80, shape: 'square', label: '1', seats: 4, rotation: 0, status: 'free', tableId: 't1' },
          ],
        },
      ],
    }
    const { container } = inLang('fr', board(orders, calls, layout))
    expect(await screen.findByRole('tab', { name: 'Grille' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Plan' }))
    expect(screen.getByRole('group', { name: 'Plan de salle — état des tables' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 — Demande l’addition' })).toBeInTheDocument()
    expect(screen.getByText('42 lei')).toBeInTheDocument()
    expect(screen.getByText('Touchez une table sur le plan pour voir ses détails.')).toBeInTheDocument()
    expect(romanianLeftovers(container.textContent ?? '', waiterFr)).toEqual([])
  })

  it('LW3b: TableStatusMap în română — eticheta de dinainte (control)', () => {
    const layout: FloorLayout = {
      version: 1,
      savedAt: '2026-01-01T00:00:00Z',
      floors: [
        {
          id: 'f1',
          name: 'Sala',
          walls: [],
          decos: [],
          zones: [],
          tables: [
            { id: 'ft1', x: 10, y: 10, w: 80, h: 80, shape: 'round', label: '1', seats: 4, rotation: 0, status: 'free', tableId: 't1' },
          ],
        },
      ],
    }
    inLang(
      null,
      <TableStatusMap
        layout={layout}
        stateById={new Map([['t1', { color: '#fff', label: 'Ocupată', occupied: true, total: 12.4 }]])}
        tablesByName={new Map()}
        selectedId={null}
        onSelectTable={vi.fn()}
      />,
    )
    expect(screen.getByRole('group', { name: 'Harta sălii — stadiul meselor' })).toBeInTheDocument()
    expect(screen.getByText('12 lei')).toBeInTheDocument()
  })
})

describe('alocarea meselor în limba personalului', () => {
  beforeEach(() => {
    h.members = [
      { user_id: 'w1', role: 'waiter', full_name: 'Jean Dupont', email: 'jean@example.com' },
      { user_id: 'k1', role: 'kitchen', full_name: 'Chef', email: 'chef@example.com' },
    ]
    h.tables = [
      { id: 't1', name: '1', seats: 4 },
      { id: 't2', name: '2', seats: null },
    ]
    h.assignments = [{ user_id: 'w1', table_id: 't1' }]
  })

  it('LW4: română (control, pluralul fals păstrat) și franceză', async () => {
    const ro = inLang(null, <WaiterAssignments restaurantId="r1" />)
    expect(await screen.findByText('Ospătar')).toBeInTheDocument()
    expect(screen.getByText('1 mese alocate')).toBeInTheDocument()
    expect(screen.getByText('Fără alocare').tagName).toBe('STRONG')
    expect(ro.container).toHaveTextContent('Fără alocare — ospătarul vede toate comenzile (comportament implicit).')
    expect(screen.getByRole('button', { name: /^1$/ })).toHaveAttribute('title', '1 · 4 loc.')
    ro.unmount()

    const { container } = inLang('fr', <WaiterAssignments restaurantId="r1" />)
    expect(await screen.findByText('Serveur')).toBeInTheDocument()
    expect(screen.getByText('1 table attribuée')).toBeInTheDocument()
    expect(screen.getByText('Sans attribution').tagName).toBe('STRONG')
    expect(container).toHaveTextContent(
      'Avec attribution — le serveur voit UNIQUEMENT les commandes de ses tables attribuées.',
    )
    expect(screen.getByRole('button', { name: 'Tout supprimer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toutes les tables' })).toBeInTheDocument()
    expect(screen.getByText('Cliquez sur une table pour l’attribuer / la retirer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^1$/ })).toHaveAttribute('title', '1 · 4 places')
    expect(screen.getByRole('button', { name: /^2$/ })).toHaveAttribute('title', '2')
    expect(romanianLeftovers(container.textContent ?? '', waiterFr)).toEqual([])
  })

  it('LW4b: fără ospătari — titlul și propoziția cu <strong>, în germană', async () => {
    h.members = []
    const { container } = inLang('de', <WaiterAssignments restaurantId="r1" />)
    expect(await screen.findByText('Noch keine Servicekraft hinzugefügt.')).toBeInTheDocument()
    expect(screen.getByText('Einstellungen → Team').tagName).toBe('STRONG')
    expect(container).toHaveTextContent('Fügen Sie Mitglieder unter Einstellungen → Team hinzu.')
  })
})

describe('nota de refuz și helperii puri', () => {
  it('LW5: ActionErrorNote — română (control) și germană', () => {
    const ro = inLang(null, <ActionErrorNote error={{ hint: null, network: false }} onDismiss={vi.fn()} />)
    expect(within(ro.container).getByRole('button', { name: 'Închide mesajul' })).toBeInTheDocument()
    ro.unmount()
    inLang('de', <ActionErrorNote error={{ hint: null, network: false }} onDismiss={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Meldung schließen' })).toBeInTheDocument()
  })

  it('LW6: describeCancelRejection în franceză și germană', () => {
    const fr = makeTranslator<typeof ordersRo>(ordersFr, 'fr')
    const de = makeTranslator<typeof ordersRo>(ordersDe, 'de')
    const ro = makeTranslator(ordersRo, 'ro')
    const over = Object.assign(new Error('Comanda are plăți înregistrate (60 lei) și nu poate fi anulată'), {
      hint: 'cancel_over_payments',
    })
    // Control: în română mesajul serverului (cu suma) primează, ca înainte.
    expect(describeCancelRejection(over, ro)).toBe('Comanda are plăți înregistrate (60 lei) și nu poate fi anulată')
    expect(describeCancelRejection(over, fr)).toBe(ordersFr.cancelRej_overPayments)
    expect(describeCancelRejection(over, fr)).not.toMatch(/plăți|lei/)
    expect(describeCancelRejection(Object.assign(new Error('x'), { hint: 'cancel_reason_required' }), de)).toBe(
      'Für das Stornieren einer servierten Bestellung ist ein Grund erforderlich.',
    )
    expect(describeCancelRejection(Object.assign(new Error('x'), { hint: 'role_insufficient' }), fr)).toMatch(
      /propriétaire ou un manager/,
    )
    expect(describeCancelRejection(Object.assign(new Error('x'), { hint: 'order_terminal' }), de)).toBe(
      ordersDe.cancelRej_terminal,
    )
    // Un hint necunoscut cu mesaj românesc: nu se arată în altă limbă.
    expect(describeCancelRejection(new Error('Motiv respins de server'), de)).toBe(ordersDe.cancel_errGeneric)
    expect(describeCancelRejection(new TypeError('Failed to fetch'), fr)).toBe(ordersFr.cancelRej_network)
    // Control: în română aceeași eroare de rețea arată mesajul ei, ca înainte.
    expect(describeCancelRejection(new TypeError('Failed to fetch'), ro)).toBe('Failed to fetch')
  })

  it('LW7: describeWaiterOrderSent și elapsedT — română de dinainte, unitățile celorlalte limbi', () => {
    const ro = makeTranslator(waiterRo, 'ro')
    const en = makeTranslator<typeof waiterRo>(waiterEn, 'en')
    expect(describeWaiterOrderSent({ short_id: 'A1B2C3' }, ro).text).toBe('Comanda #A1B2C3 a fost trimisă la bucătărie.')
    expect(describeWaiterOrderSent({ short_id: 'A1B2C3' }, en)).toEqual({
      kind: 'success',
      text: 'Order #A1B2C3 has been sent to the kitchen.',
    })
    const local = describeWaiterOrderSent({ short_id: 'LOCAL-4821' }, en)
    expect(local.kind).toBe('warning')
    expect(local.text).toMatch(/ONLY on this phone/)
    expect(local.text).toContain('LOCAL-4821')

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-17T12:00:00Z'))
    const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString()
    const cro = makeTranslator(commonRo, 'ro')
    const cen = makeTranslator<typeof commonRo>(commonEn, 'en')
    const cfr = makeTranslator<typeof commonRo>(commonFr, 'fr')
    const cde = makeTranslator<typeof commonRo>(commonDe, 'de')
    // Textele de dinainte ale lui `elapsed()` (șters în L4c, când Bucătăria a
    // trecut și ea pe `elapsedT`).
    const before = ['0s', '30s', '1m', '45m', '1h 0m', '1h 30m']
    for (const [i, s] of [0, 30, 60, 2700, 3600, 5400].entries()) expect(elapsedT(ago(s), cro)).toBe(before[i])
    expect(elapsedT(ago(5400), cro)).toBe('1h 30m')
    expect(elapsedT(ago(5400), cen)).toBe('1h 30m')
    expect(elapsedT(ago(30), cfr)).toBe('30 s')
    expect(elapsedT(ago(2700), cfr)).toBe('45 min')
    expect(elapsedT(ago(5400), cde)).toBe('1 Std. 30 Min.')
  })
})

// Anti-vacuitate pentru `romanianLeftovers`: pe textul românesc chiar găsește.
it('LW0: control pozitiv al verificării „fără text românesc”', () => {
  const { orders, calls } = boardFixture(Date.now())
  const { container } = inLang(null, board(orders, calls))
  expect(romanianLeftovers(container.textContent ?? '', waiterEn).length).toBeGreaterThan(3)
})

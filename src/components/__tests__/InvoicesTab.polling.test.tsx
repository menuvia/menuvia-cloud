// InvoicesTab — reîmprospătarea (poll la 10 s cât există facturi în lucru,
// revenirea în filă) NU are voie să demonteze modalele deschise (lotul O7a).
//
// Bug-ul: `load()` punea `loading = true` la FIECARE rulare, iar garda
// `if (loading) return <Skeleton/>` stătea înaintea arborelui principal, unde
// sunt randate (fără portal) IssueInvoiceModal și OblioConfigModal. La fiecare
// 10 s, cât o factură stătea `queued` (cron-ul Oblio rulează la 15 min),
// formularul de factură revenea la „Alege comanda" cu numele clientului șters,
// iar cel Oblio pierdea secretul tastat.
//
//   IV1  poll pe interval cu formularul de factură la „Date client": pasul,
//        numele tastat și lista de comenzi (citită O SINGURĂ dată) rămân
//        Mutația care pică: M1, garda veche `if (loading)` (fără `!hasData`).
//   IV2  revenirea în filă cu formularul Oblio deschis: secretul și CIF-ul
//        tastate rămân
//        Mutația care pică: M1 (formularul se reface din `existing`).
//   IV3  o reîmprospătare în zbor nu ascunde lista sub schelet; răspunsul ei
//        actualizează lista pe loc (MENU-7). Controlul pozitiv că `.skeleton`
//        chiar se randează e IV5.
//        Mutația care pică: M1.
//   IV4  reîmprospătare EȘUATĂ: lista și modalul rămân, banner-ul spune că e
//        ultima versiune și NU clipește cât următoarea cerere e în zbor; dispare
//        la primul succes
//        Mutațiile care pică: M2, garda veche `if (err && !showConfig)` (QueryError
//        înlocuiește arborele și demontează modalul); M3, `setErr(null)` readus
//        la începutul lui load() (banner-ul dispare în timpul cererii).
//   IV5  CONTROL POZITIV pe prima încărcare: schelet → eroare pe tot ecranul cu
//        Reîncearcă (fără empty-state-ul „Emite facturi automate cu Oblio") →
//        Reîncearcă arată din nou scheletul → datele
//        Mutațiile care pică: garda de eroare ștearsă (cade pe empty-state-ul
//        mincinos); scheletul condiționat și de `!err` (Reîncearcă lasă eroarea
//        pe ecran în loc de schelet).
//   IV6  config `null` + factură în lucru: o reîmprospătare eșuată NU lasă
//        empty-state-ul „Emite facturi automate cu Oblio" să mintă; Reîncearcă
//        de acolo trece prin schelet
//        Mutațiile care pică: M4, garda redusă la `if (err && !hasData)`;
//        `onRetry={() => void load()}` (eroarea rămâne în locul scheletului).
//   IV7  schimbarea restaurantului: niciun cadru cu lista sau formularul
//        restaurantului anterior; eșecul noului restaurant = eroare pe tot
//        ecranul, nu formularul Oblio cu `existing`-ul celuilalt
//        Mutațiile care pică: M2 (excepția veche `!showConfig`); M5,
//        `setLoadedFor(restaurantId)` pus la ÎNCEPUTUL lui load() (lista lui r1
//        sub r2).
//   IV8  tranzițiile configului (salvat) trec prin schelet: după „Salvează" nu
//        apare un RTT empty-state-ul „Configurează Oblio →"
//        Mutația care pică: M6, `onSaved` cu `load()` în loc de `reload()`.
//   IV9  „Reîncearcă" din banner e SILENȚIOS: modalul deschis rămâne, iar
//        butonul e ocupat (aria-busy) cât cererea e în zbor
//        Mutația care pică: banner-ul cu `reload()` (scheletul demontează modalul).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import type { Invoice, OblioConfig } from '../../lib/invoices'

interface Reply {
  data: unknown[] | null
  error: { message: string } | null
}

const { fromCalls } = vi.hoisted(() => ({
  // Tabelele citite direct (doar IssueInvoiceModal, la montare).
  fromCalls: [] as string[],
}))

// Builder thenable minimal pentru efectul de montare al IssueInvoiceModal
// (comenzile plătite + facturile existente).
vi.mock('../../lib/supabase', () => {
  const ORDERS = [
    { id: 'o1-aaaaaaa', table_name: 'Masa 1', total: 42, created_at: '2026-10-20T10:00:00Z' },
    { id: 'o2-bbbbbbb', table_name: 'Masa 2', total: 55, created_at: '2026-10-20T11:00:00Z' },
    { id: 'o3-ccccccc', table_name: 'Masa 3', total: 61, created_at: '2026-10-20T12:00:00Z' },
  ]
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'gte', 'order', 'limit', 'in']) {
      b[m] = vi.fn(() => b)
    }
    b.then = (onFulfilled: (v: Reply) => unknown, onRejected?: (e: unknown) => unknown) => {
      const reply: Reply = { data: table === 'orders' ? ORDERS : [], error: null }
      return Promise.resolve(reply).then(onFulfilled, onRejected)
    }
    return b
  }
  return {
    supabase: {
      from: vi.fn((t: string) => {
        fromCalls.push(t)
        return chain(t)
      }),
      rpc: vi.fn(),
    },
  }
})

// Doar I/O-ul e fals; etichetele/culorile de status rămân cele reale.
vi.mock('../../lib/invoices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/invoices')>()),
  fetchOblioConfig: vi.fn(),
  listInvoices: vi.fn(),
  saveOblioConfig: vi.fn(),
  deleteOblioConfig: vi.fn(),
  cancelInvoice: vi.fn(),
}))

import InvoicesTab from '../InvoicesTab'
import { ToastProvider } from '../ui/Toast'
import { fetchOblioConfig, listInvoices, saveOblioConfig } from '../../lib/invoices'

const fetchConfigMock = vi.mocked(fetchOblioConfig)
const listMock = vi.mocked(listInvoices)
const saveMock = vi.mocked(saveOblioConfig)

const CONFIG: OblioConfig = {
  restaurant_id: 'r1',
  api_email: 'contabil@exemplu.ro',
  company_cif: 'RO12345678',
  company_name: 'Exemplu SRL',
  company_address: null,
  company_state: null,
  company_city: null,
  default_series: 'MENU',
  vat_included: true,
  send_email: true,
  language: 'RO',
  is_active: true,
  test_mode: false,
}

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    order_id: 'o9-zzzzzzz',
    customer_name: 'Client Coadă',
    customer_cif: null,
    is_b2b: false,
    total_with_vat: 42,
    oblio_series: null,
    oblio_number: null,
    oblio_link: null,
    status: 'queued',
    last_error: null,
    issued_at: null,
    created_at: '2026-10-20T10:00:00Z',
    has_einvoice: false,
    ...over,
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

// Un răspuns ținut în zbor până îl eliberează testul.
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const READ_ERROR = 'Citirea facturilor a eșuat'
const BANNER = /Lista facturilor nu s-a putut actualiza/
const EMPTY_CTA = 'Emite facturi automate cu Oblio'
const CUSTOMER_PLACEHOLDER = 'Ion Popescu sau SC Exemplu SRL'
const SECRET_PLACEHOLDER = 'Configurat — lasă gol ca să nu-l schimbi'

let visibility: 'visible' | 'hidden' = 'visible'
function setVisibility(v: 'visible' | 'hidden'): void {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

// Doar cronometrul periodic e fals (setInterval): findBy* și acest flush au
// nevoie de setTimeout REAL — lasă cererile să se așeze în act().
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function tick10s(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(10_000)
  })
  await flush()
}

function skeleton(): Element | null {
  return document.querySelector('.skeleton')
}

function tab(restaurantId: string): ReactElement {
  return (
    <ToastProvider>
      <InvoicesTab restaurantId={restaurantId} restaurantName="Bistro" />
    </ToastProvider>
  )
}

async function mountLoaded(restaurantId = 'r1'): Promise<ReturnType<typeof render>> {
  const view = render(tab(restaurantId))
  await screen.findByText('Client Coadă')
  // Cronometrul pornește dintr-un efect care depinde de lista încărcată
  // (`hasPendingInvoices`): îl lăsăm să se așeze înaintea primului tick.
  await flush()
  return view
}

// Deschide „+ Factură nouă", alege Masa 2, trece la „Date client", tastează numele.
async function openIssueAtDetails(name: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '+ Factură nouă' }))
  fireEvent.click(await screen.findByText(/Masa 2/))
  fireEvent.click(screen.getByRole('button', { name: 'Continuă →' }))
  expect(screen.getByText('Date client')).toBeInTheDocument()
  fireEvent.change(screen.getByPlaceholderText(CUSTOMER_PLACEHOLDER), { target: { value: name } })
}

function expectIssueDetailsIntact(name: string): void {
  expect(screen.getByText('Date client')).toBeInTheDocument()
  expect(screen.queryByText('Alege comanda')).toBeNull()
  expect(screen.getByPlaceholderText(CUSTOMER_PLACEHOLDER)).toHaveValue(name)
}

function readsOf(table: string): number {
  return fromCalls.filter((t: string) => t === table).length
}

beforeEach(() => {
  fromCalls.length = 0
  fetchConfigMock.mockReset()
  listMock.mockReset()
  saveMock.mockReset()
  fetchConfigMock.mockResolvedValue(CONFIG)
  listMock.mockResolvedValue([invoice()])
  saveMock.mockResolvedValue(undefined)
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('InvoicesTab — reîmprospătarea păstrează lista și modalele', () => {
  it('IV1: poll-ul la 10 s nu resetează formularul de factură', async () => {
    await mountLoaded()
    await openIssueAtDetails('SC Exemplu SRL')
    expect(readsOf('orders')).toBe(1)

    await tick10s()

    // Anti-vacuitate: poll-ul chiar a rulat.
    expect(listMock).toHaveBeenCalledTimes(2)
    expectIssueDetailsIntact('SC Exemplu SRL')
    // Efectul de montare al modalului NU a rulat a doua oară.
    expect(readsOf('orders')).toBe(1)
  })

  it('IV2: revenirea în filă nu șterge secretul și CIF-ul tastate', async () => {
    await mountLoaded()
    fireEvent.click(screen.getByText('Configurare'))
    fireEvent.change(screen.getByPlaceholderText(SECRET_PLACEHOLDER), {
      target: { value: 'secret-nou' },
    })
    fireEvent.change(screen.getByPlaceholderText('RO12345678'), { target: { value: 'RO999' } })

    act(() => setVisibility('hidden'))
    act(() => setVisibility('visible'))
    await flush()

    expect(listMock).toHaveBeenCalledTimes(2)
    expect(screen.getByPlaceholderText(SECRET_PLACEHOLDER)).toHaveValue('secret-nou')
    expect(screen.getByPlaceholderText('RO12345678')).toHaveValue('RO999')
  })

  it('IV3: reîmprospătarea în zbor nu ascunde lista; răspunsul o actualizează', async () => {
    await mountLoaded()
    const next = deferred<Invoice[]>()
    listMock.mockReturnValueOnce(next.promise)

    await tick10s()

    expect(listMock).toHaveBeenCalledTimes(2)
    expect(skeleton()).toBeNull()
    expect(screen.getByText('Client Coadă')).toBeInTheDocument()

    await act(async () => {
      next.resolve([
        invoice({
          status: 'issued',
          oblio_series: 'MENU',
          oblio_number: '7',
          oblio_link: 'https://www.oblio.eu/doc/7',
          issued_at: '2026-10-20T10:20:00Z',
        }),
      ])
    })
    await flush()
    expect(screen.getByText('MENU-7')).toBeInTheDocument()
  })

  it('IV4: reîmprospătarea eșuată păstrează lista și modalul, cu banner stabil', async () => {
    await mountLoaded()
    await openIssueAtDetails('SC Exemplu SRL')
    listMock.mockRejectedValueOnce(new Error(READ_ERROR))

    await tick10s()

    expect(listMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText(BANNER)).toBeInTheDocument()
    // Nu eroarea pe tot ecranul (mesajul SINGUR, fără banner în jur).
    expect(screen.queryByText(READ_ERROR)).toBeNull()
    expect(screen.getByText('Client Coadă')).toBeInTheDocument()
    expectIssueDetailsIntact('SC Exemplu SRL')

    // Următorul poll e în zbor: banner-ul NU clipește.
    const next = deferred<Invoice[]>()
    listMock.mockReturnValueOnce(next.promise)
    await tick10s()
    expect(listMock).toHaveBeenCalledTimes(3)
    expect(screen.getByText(BANNER)).toBeInTheDocument()

    // Primul succes îl stinge; modalul a rămas tot timpul.
    await act(async () => {
      next.resolve([invoice()])
    })
    await flush()
    expect(screen.queryByText(BANNER)).toBeNull()
    expectIssueDetailsIntact('SC Exemplu SRL')
  })

  it('IV5: control pozitiv — prima încărcare: schelet, eroare, schelet, date', async () => {
    const first = deferred<OblioConfig | null>()
    fetchConfigMock.mockReturnValueOnce(first.promise)
    render(tab('r1'))
    expect(skeleton()).not.toBeNull()

    await act(async () => {
      first.reject(new Error(READ_ERROR))
    })
    await flush()
    expect(screen.getByText(READ_ERROR)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument()
    expect(screen.queryByText(EMPTY_CTA)).toBeNull()
    expect(skeleton()).toBeNull()

    const second = deferred<OblioConfig | null>()
    fetchConfigMock.mockReturnValueOnce(second.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(skeleton()).not.toBeNull()
    expect(screen.queryByText(READ_ERROR)).toBeNull()

    await act(async () => {
      second.resolve(CONFIG)
    })
    await flush()
    expect(screen.getByText('Facturile emise prin Oblio')).toBeInTheDocument()
    expect(screen.getByText('Client Coadă')).toBeInTheDocument()
  })

  it('IV6: fără config, o reîmprospătare eșuată nu lasă empty-state-ul să mintă', async () => {
    fetchConfigMock.mockResolvedValue(null)
    render(tab('r1'))
    expect(await screen.findByText(EMPTY_CTA)).toBeInTheDocument()
    await flush()

    fetchConfigMock.mockRejectedValueOnce(new Error(READ_ERROR))
    await tick10s()

    expect(listMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText(READ_ERROR)).toBeInTheDocument()
    expect(screen.queryByText(EMPTY_CTA)).toBeNull()

    // Reîncearcă de pe eroarea pe tot ecranul trece prin schelet.
    const held = deferred<OblioConfig | null>()
    fetchConfigMock.mockReturnValueOnce(held.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(skeleton()).not.toBeNull()
    expect(screen.queryByText(READ_ERROR)).toBeNull()

    await act(async () => {
      held.resolve(null)
    })
    await flush()
    expect(screen.getByText(EMPTY_CTA)).toBeInTheDocument()
  })

  it('IV7: schimbarea restaurantului nu arată datele sau formularul celui anterior', async () => {
    const view = await mountLoaded('r1')
    fireEvent.click(screen.getByText('Configurare'))
    expect(screen.getByText('API email (cont Oblio) *')).toBeInTheDocument()

    const r2 = deferred<OblioConfig | null>()
    fetchConfigMock.mockReturnValueOnce(r2.promise)
    view.rerender(tab('r2'))

    expect(fetchConfigMock).toHaveBeenLastCalledWith('r2')
    expect(skeleton()).not.toBeNull()
    expect(screen.queryByText('Client Coadă')).toBeNull()

    await act(async () => {
      r2.reject(new Error(READ_ERROR))
    })
    await flush()
    expect(screen.getByText(READ_ERROR)).toBeInTheDocument()
    expect(screen.queryByText('API email (cont Oblio) *')).toBeNull()
    expect(screen.queryByText('Client Coadă')).toBeNull()
  })

  it('IV8: după salvarea configului nu apare empty-state-ul „Configurează Oblio"', async () => {
    fetchConfigMock.mockResolvedValue(null)
    listMock.mockResolvedValue([])
    const view = render(tab('r1'))
    expect(await screen.findByText(EMPTY_CTA)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Configurează Oblio →' }))
    const email = view.container.querySelector('input[type=email]')
    const secret = view.container.querySelector('input[type=password]')
    expect(email).not.toBeNull()
    expect(secret).not.toBeNull()
    if (!email || !secret) return
    fireEvent.change(email, { target: { value: 'api@exemplu.ro' } })
    fireEvent.change(secret, { target: { value: 'secret' } })
    fireEvent.change(screen.getByPlaceholderText('RO12345678'), {
      target: { value: 'RO12345678' },
    })

    const held = deferred<OblioConfig | null>()
    fetchConfigMock.mockReturnValueOnce(held.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Salvează' }))
    await flush()

    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(fetchConfigMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(EMPTY_CTA)).toBeNull()
    expect(skeleton()).not.toBeNull()

    await act(async () => {
      held.resolve(CONFIG)
    })
    await flush()
    expect(screen.getByText(/Conectat ca Exemplu SRL/)).toBeInTheDocument()
  })

  it('IV9: „Reîncearcă" din banner e silențios — modalul rămâne', async () => {
    await mountLoaded()
    fireEvent.click(screen.getByText('Configurare'))
    fireEvent.change(screen.getByPlaceholderText(SECRET_PLACEHOLDER), {
      target: { value: 'secret-nou' },
    })
    listMock.mockRejectedValueOnce(new Error(READ_ERROR))
    await tick10s()
    expect(screen.getByText(BANNER)).toBeInTheDocument()

    const held = deferred<Invoice[]>()
    listMock.mockReturnValueOnce(held.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    await flush()

    expect(listMock).toHaveBeenCalledTimes(3)
    expect(skeleton()).toBeNull()
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByPlaceholderText(SECRET_PLACEHOLDER)).toHaveValue('secret-nou')

    await act(async () => {
      held.resolve([invoice()])
    })
    await flush()
    expect(screen.queryByText(BANNER)).toBeNull()
    expect(screen.getByPlaceholderText(SECRET_PLACEHOLDER)).toHaveValue('secret-nou')
  })
})

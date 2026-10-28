// Ecranele terminale ale oaspetelui (PR 2, partea C).
//  - `closed` = terminalul Planului 2: ospătarul a închis nota, plata e la casa
//    localului. Înainte OrderTracker arăta AICI „Plată confirmată!" + sumar de
//    plată — fals: Menuvia n-a încasat nimic. Acum: OrderClosedScreen.
//  - `paid` (Plan 3) rămâne pe PaymentConfirmedScreen (control pozitiv).
//  - „Fără branding" respectat pe ambele.
//  - Cheile noi din publicMenuStrings au toate cele 7 limbi.
//  - „Plătește masa" fără plată online devine „Cere nota".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }))
vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return { ...actual, getOrderPublicStatus: statusMock, requestFiscalReceipt: vi.fn() }
})
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))

import { OrderTracker } from '../OrderTracker'
import PaymentConfirmedScreen from '../PaymentConfirmedScreen'
import { PUBLIC_MENU_STRINGS, T } from '../../lib/publicMenuStrings'
import { qrPayTableLabel } from '../../lib/qrPayLabel'
import type { OrderConfirmationPayload } from '../../lib/orders'

const CONF: OrderConfirmationPayload = {
  id: 'o1',
  short_id: 'ABC123',
  status: 'new',
  total: 30,
  created_at: '2026-09-07T10:00:00Z',
}

const RESTAURANT = { name: 'Bistro Test', slug: 'bistro', google_review_url: null }

function payload(status: string, withRestaurant = true): Record<string, unknown> {
  return {
    id: 'o1',
    short_id: 'ABC123',
    status,
    total: 30,
    paid_amount: status === 'paid' ? 30 : null,
    tips_amount: 0,
    ...(withRestaurant ? { restaurant: RESTAURANT } : {}),
  }
}

function renderTracker(props: { lang?: string; hideBranding?: boolean } = {}) {
  return render(
    <OrderTracker
      confirmation={CONF}
      accent="#C8963C"
      onReset={() => {}}
      previousOrders={[]}
      sessionId="s1"
      {...props}
    />,
  )
}

const PAID_TITLE = /plată confirmată|payment confirmed/i

beforeEach(() => {
  statusMock.mockReset()
})

describe('OrderTracker — ecranul terminal după status', () => {
  it('OC1 closed → OrderClosedScreen („plata se face la casă"), NU „Plată confirmată"', async () => {
    statusMock.mockResolvedValue(payload('closed'))
    renderTracker()
    expect(await screen.findByText('Comanda e finalizată')).toBeInTheDocument()
    expect(screen.getByText(/plata se face la casa localului/i)).toBeInTheDocument()
    expect(screen.queryByText(PAID_TITLE)).toBeNull()
    // Bonul fiscal nu există pe Plan 2 — niciun CTA de bon.
    expect(screen.queryByRole('button', { name: /bon/i })).toBeNull()
  })

  it('OC2 paid → PaymentConfirmedScreen (control pozitiv: Plan 3 neschimbat)', async () => {
    statusMock.mockResolvedValue(payload('paid'))
    renderTracker()
    expect(await screen.findByText(PAID_TITLE)).toBeInTheDocument()
    expect(screen.queryByText('Comanda e finalizată')).toBeNull()
  })

  it('OC3 closed în limba aleasă (de) + fără branding', async () => {
    statusMock.mockResolvedValue(payload('closed'))
    renderTracker({ lang: 'de', hideBranding: true })
    expect(await screen.findByText('Deine Bestellung ist abgeschlossen')).toBeInTheDocument()
    expect(screen.queryByText('Menuvia')).toBeNull()
  })

  it('OC4 closed cu branding implicit → „Menuvia" apare (control pentru OC3)', async () => {
    statusMock.mockResolvedValue(payload('closed'))
    renderTracker()
    expect(await screen.findByText('Menuvia')).toBeInTheDocument()
  })

  it('OC5 closed: feedback-ul pornește de la servire, nu de la „plată"', async () => {
    statusMock.mockResolvedValue(payload('closed'))
    renderTracker()
    expect(await screen.findByText(/cum a fost servirea|how was the service/i)).toBeInTheDocument()
    expect(screen.queryByText(/experiența de plată|payment experience/i)).toBeNull()
  })

  it('OC6 closed cu urmărire limitată (fără restaurant în payload) → tot ecranul închis, fără feedback', async () => {
    statusMock.mockResolvedValue(payload('closed', false))
    renderTracker()
    expect(await screen.findByText('Comanda e finalizată')).toBeInTheDocument()
    expect(screen.queryByText(/cum a fost servirea|how was the service/i)).toBeNull()
  })
})

describe('PaymentConfirmedScreen — „Fără branding"', () => {
  const base = {
    confirmation: CONF,
    restaurantName: 'Bistro Test',
    googleReviewUrl: null,
    accent: '#C8963C',
  }
  it('PB-A hideBranding → fără „Menuvia"', () => {
    render(<PaymentConfirmedScreen {...base} hideBranding />)
    expect(screen.queryByText('Menuvia')).toBeNull()
  })
  it('PB-B implicit → „Menuvia" afișat (control pozitiv)', () => {
    render(<PaymentConfirmedScreen {...base} />)
    expect(screen.getByText('Menuvia')).toBeInTheDocument()
  })
})

describe('„Cere nota" în loc de „Plătește masa"', () => {
  const base = { tablePaid: false, onlinePay: false, billRequested: false, lang: 'ro' }
  it('CN1 fără plată online → „Cere nota" (în limba meniului)', () => {
    expect(qrPayTableLabel(base)).toBe('Cere nota')
    expect(qrPayTableLabel({ ...base, lang: 'it' })).toBe('Chiedi il conto')
    expect(qrPayTableLabel(base)).not.toMatch(/plătește/i)
  })
  it('CN2 cu plată online → „Plătește online" (control pozitiv)', () => {
    expect(qrPayTableLabel({ ...base, onlinePay: true })).toBe('Plătește online')
    expect(qrPayTableLabel({ ...base, tablePaid: true, onlinePay: true })).toBe('Plătit online ✓')
  })
})

describe('chei noi în publicMenuStrings — toate cele 7 limbi', () => {
  const KEYS = [
    'order_closed_title',
    'order_closed_pay_at_counter',
    'powered_by',
    'waiter_call_failed',
    'bill_request_failed',
  ] as const
  it.each(KEYS)('%s are ro/en/de/fr/it/hu/es ne-goale', (k) => {
    for (const l of ['ro', 'en', 'de', 'fr', 'it', 'hu', 'es'] as const) {
      expect(PUBLIC_MENU_STRINGS[k][l].trim().length).toBeGreaterThan(0)
      expect(T(l, k)).toBe(PUBLIC_MENU_STRINGS[k][l])
    }
  })
})

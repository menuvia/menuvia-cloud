// Istoricul comenzii (OrderAuditSheet) pe fusul LOCALULUI (lotul G2c): ora
// fiecărei intrări e pe ceasul restaurantului, dat de pagină din
// RestaurantContext — nu pe ceasul dispozitivului. Formatul rămâne `ro-RO`
// (formatarea pe limba personalului e un lot separat, regula L3a).
//   OAZ1 fusul New York: 09:10:05Z → „05:10:05”.
//   OAZ2 fără prop → București: „12:10:05”; fus invalid → București, fără RangeError.
// OAZ1 + OAZ2 sunt PERECHE: o gazdă coincide cu cel mult unul dintre cele două
// fusuri, deci mutația „formatare fără `timeZone`” pică pe ORICE gazdă.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AuditEntry } from '../../lib/orders'

const h = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return { ...actual, fetchOrderAuditHistory: (...a: unknown[]) => h.fetch(...a) }
})

import OrderAuditSheet from '../OrderAuditSheet'

const ENTRY: AuditEntry = {
  id: 1,
  created_at: '2026-07-20T09:10:05Z',
  actor_id: null,
  actor_name: 'Ana',
  table_name: 'orders',
  operation: 'INSERT',
  row_id: 'o1',
  changed_keys: null,
  diff_short: null,
}

beforeEach(() => {
  h.fetch.mockReset()
  h.fetch.mockResolvedValue([ENTRY])
})

describe('OrderAuditSheet — ora pe fusul localului (G2c)', () => {
  it('OAZ1 fusul New York', async () => {
    render(<OrderAuditSheet orderId="o1" orderShortId="O1" onClose={() => {}} timeZone="America/New_York" />)
    expect(await screen.findByText(/05:10:05/)).toBeInTheDocument()
    expect(screen.queryByText(/12:10:05/)).toBeNull()
  })

  it('OAZ2 fără fus → București; fus invalid → București', async () => {
    const { unmount } = render(<OrderAuditSheet orderId="o1" orderShortId="O1" onClose={() => {}} />)
    expect(await screen.findByText(/12:10:05/)).toBeInTheDocument()
    unmount()
    render(<OrderAuditSheet orderId="o1" orderShortId="O1" onClose={() => {}} timeZone="Mars/Olympus" />)
    expect(await screen.findByText(/12:10:05/)).toBeInTheDocument()
  })
})

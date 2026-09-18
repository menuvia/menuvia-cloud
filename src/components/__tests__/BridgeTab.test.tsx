// Teste pe acțiunea „Bonul a ieșit” din BridgeTab (mig 277): pe un bon `error`
// cu markerul POSIBIL DUPLICAT apare butonul de înregistrare a numărului, care
// cheamă bridge_force_resolve_stuck(p_was_printed=true) și NU retrimite bonul
// (un retry = bon fiscal DUBLU); un `error` FĂRĂ marker nu are butonul (nu s-a
// tipărit nimic → calea rămâne retry/anulare); refuzul serverului se afișează
// CU TEXTUL LUI și dialogul rămâne deschis (ca în CancelOrderDialog).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { rpcMock, tables } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  tables: {} as Record<string, unknown[]>,
}))

// Supabase: builder minimal, thenable — `await from(t).select().eq().order().limit()`
// dă {data: rândurile tabelei, error: null}. Orice metodă întoarce același obiect.
vi.mock('../../lib/supabase', () => {
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit', 'delete', 'update', 'insert']) {
      b[m] = vi.fn(() => b)
    }
    b.then = (
      onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(onFulfilled, onRejected)
    return b
  }
  return { supabase: { from: vi.fn((t: string) => chain(t)), rpc: rpcMock } }
})

import BridgeTab from '../BridgeTab'

function receipt(over: Record<string, unknown>) {
  return {
    id: 'r-x',
    restaurant_id: 'r1',
    order_id: 'o1',
    payload: 'S^x',
    status: 'error',
    bridge_device_id: null,
    bon_number: null,
    error_code: 'RESPONSE_TIMEOUT',
    error_info: null,
    retry_count: 0,
    total_snapshot: 42,
    created_at: '2026-09-15T10:00:00Z',
    claimed_at: '2026-09-15T10:00:30Z',
    completed_at: '2026-09-15T10:12:00Z',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  tables.bridge_devices = []
  tables.vat_rates = []
  tables.kitchen_tickets = []
  tables.pending_receipts = [
    receipt({
      id: 'r-amb',
      error_info: 'POSIBIL DUPLICAT — verifică banda casei înainte de retrimitere: RESPONSE_TIMEOUT',
    }),
    receipt({ id: 'r-clear', error_code: 'BONOK0', error_info: 'BONOK=0: casa a respins payload-ul' }),
  ]
})

async function openFailedReceipts() {
  const user = userEvent.setup()
  render(<BridgeTab restaurantId="r1" fiscalEnabled />)
  await user.click(await screen.findByRole('button', { name: /^eșuate$/i }))
  return user
}

describe('BridgeTab — „Bonul a ieșit” (mig 277)', () => {
  it('doar bonul cu marker ambiguu are butonul; înregistrarea cheamă force_resolve cu numărul, fără retry', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null })
    const user = await openFailedReceipts()

    // Două bonuri eșuate, două butoane „Retrimite”, UN singur „Bonul a ieșit”.
    expect(screen.getAllByRole('button', { name: /^retrimite$/i })).toHaveLength(2)
    const printed = screen.getAllByRole('button', { name: /bonul a ieșit/i })
    expect(printed).toHaveLength(1)

    await user.click(printed[0])
    expect(screen.getByText('Bonul a ieșit pe bandă')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: /înregistrează bonul/i })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText(/numărul bonului/i), ' 0042 ')
    expect(save).toBeEnabled()
    await user.click(save)

    expect(rpcMock).toHaveBeenCalledWith('bridge_force_resolve_stuck', {
      p_receipt_id: 'r-amb',
      p_was_printed: true,
      p_bon_number: '0042',
    })
    expect(rpcMock).not.toHaveBeenCalledWith('bridge_retry_receipt', expect.anything())
    // Dialogul se închide după succes (lista se reîncarcă).
    expect(screen.queryByText('Bonul a ieșit pe bandă')).toBeNull()
  })

  it('refuzul serverului se afișează cu textul lui, dialogul rămâne deschis', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Bonul are deja număr fiscal: 0042. Nu poate fi resolvat din nou.', hint: 'already_resolved' },
    })
    const user = await openFailedReceipts()
    await user.click(screen.getByRole('button', { name: /bonul a ieșit/i }))
    await user.type(screen.getByLabelText(/numărul bonului/i), '0043')
    await user.click(screen.getByRole('button', { name: /înregistrează bonul/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/are deja număr fiscal: 0042/)
    expect(screen.getByText('Bonul a ieșit pe bandă')).toBeInTheDocument()
  })
})

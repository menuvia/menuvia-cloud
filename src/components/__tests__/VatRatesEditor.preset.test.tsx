// Presetul de cote TVA legale stă acum în editorul REAL (Setări → Cote TVA):
// „asistentul detaliat" de pe Acasă, unde trăia, a fost scos fiindcă dubla
// checklist-ul și îi ocolea gate-urile (ux-owner-quicksetup-duplicate).
//
//   VE1  „Aplică cotele legale" → confirmare → apply_vat_preset cu presetul unic,
//        mesaj de succes și lista reîncărcată
//        Mutația care pică: butonul scos (presetul rămâne fără nicio cale în UI).
//   VE2  confirmarea refuzată → nimic nu pleacă la server
//   VE3  refuzul serverului (mesaj intern, englezesc) → text românesc
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

const { rpcMock, fetchVatRatesMock, confirmMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fetchVatRatesMock: vi.fn(),
  confirmMock: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: rpcMock } }))
vi.mock('../../lib/vat', () => ({
  fetchVatRates: fetchVatRatesMock,
  updateVatRate: vi.fn(),
}))
vi.mock('../ui/confirm', () => ({ confirm: confirmMock }))

import VatRatesEditor from '../VatRatesEditor'
import { ToastContext, type ToastApi } from '../ui/useToast'

const toast: ToastApi = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}

function withToast(children: ReactNode) {
  return <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
}

const RATES = [1, 2, 3, 4].map((g) => ({
  restaurant_id: 'r1',
  vat_group: g,
  rate_percent: g === 2 ? 21 : g === 4 ? 0 : 11,
  label: `Grupa ${g}`,
  description: null,
  is_active: true,
  updated_at: '2026-10-01T00:00:00Z',
}))

beforeEach(() => {
  vi.clearAllMocks()
  fetchVatRatesMock.mockResolvedValue(RATES)
})

async function clickPreset() {
  render(withToast(<VatRatesEditor restaurantId="r1" />))
  const btn = await screen.findByRole('button', { name: 'Aplică cotele legale' })
  await userEvent.setup().click(btn)
}

describe('VatRatesEditor — presetul legal', () => {
  it('VE1: confirmare → apply_vat_preset → succes și reîncărcare', async () => {
    confirmMock.mockResolvedValue(true)
    rpcMock.mockResolvedValue({
      data: { status: 'success', preset: 'ro_l141_2025', rates_applied: 4 },
      error: null,
    })
    await clickPreset()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('apply_vat_preset', {
        p_restaurant_id: 'r1',
        p_preset: 'ro_l141_2025',
      }),
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('4 grupe')),
    )
    await waitFor(() => expect(fetchVatRatesMock).toHaveBeenCalledTimes(2))
  })

  it('VE2: confirmarea refuzată → nimic la server', async () => {
    confirmMock.mockResolvedValue(false)
    await clickPreset()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    // Lasă orice continuare asincronă să ruleze înainte de verificarea negativă.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('VE3: refuzul serverului se spune în română, nu în engleza internă', async () => {
    confirmMock.mockResolvedValue(true)
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Not admin of this restaurant', code: 'P0001' },
    })
    await clickPreset()
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/proprietarul sau managerul/)),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })
})

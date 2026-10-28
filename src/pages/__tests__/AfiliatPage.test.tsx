// Teste pe ecranul de cerere al panoului de afiliat (mig 295 §1). Pagina e
// TRISTATE pe `program_open` (ramura ne-afiliat din get_affiliate_dashboard):
//   AF1  `false` → „Programul se redeschide", FĂRĂ formular (nu cerem cuiva să
//        completeze ce serverul va refuza)
//   AF2  `true`  → formularul de cerere (control pozitiv — fără el AF1 ar
//        trece și cu formularul șters de tot)
//   AF3  lipsă (DB fără 295) → formularul RĂMÂNE, serverul decide
//   AF4  cererea în analiză NU mai promite apel „în 1–2 zile"
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AffiliateDashboard } from '../../hooks/useAffiliate'

const { state } = vi.hoisted(() => ({
  state: { dashboard: null as AffiliateDashboard | null },
}))

vi.mock('../../hooks/useAffiliate', () => ({
  useAffiliate: () => ({
    dashboard: state.dashboard,
    loading: false,
    error: null,
    refetch: vi.fn(),
    register: vi.fn(),
  }),
}))
vi.mock('../../components/ui/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('../../lib/founder', () => ({
  listPartnerRestaurants: vi.fn(async () => []),
  enterFounderView: vi.fn(),
}))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:,') } }))

import AfiliatPage from '../AfiliatPage'

const DEFAULTS = { setup_bps: 3000, recurring_bps: 1000, recurring_cap_months: 12 }

describe('AfiliatPage — programul de afiliere închis', () => {
  beforeEach(() => {
    state.dashboard = null
  })

  it('AF1: program_open:false → mesaj de redeschidere, fără formular', () => {
    state.dashboard = { ok: true, is_affiliate: false, defaults: DEFAULTS, program_open: false }
    render(<AfiliatPage />)
    expect(screen.getByText('Programul de parteneriat se redeschide')).toBeInTheDocument()
    expect(screen.queryByText('Trimite cererea →')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('07xx xxx xxx')).not.toBeInTheDocument()
  })

  it('AF2 (control pozitiv): program_open:true → formularul', () => {
    state.dashboard = { ok: true, is_affiliate: false, defaults: DEFAULTS, program_open: true }
    render(<AfiliatPage />)
    expect(screen.getByText('Trimite cererea →')).toBeInTheDocument()
    expect(screen.queryByText('Programul de parteneriat se redeschide')).not.toBeInTheDocument()
  })

  it('AF3: program_open lipsă (DB veche) → formularul rămâne', () => {
    state.dashboard = { ok: true, is_affiliate: false, defaults: DEFAULTS }
    render(<AfiliatPage />)
    expect(screen.getByText('Trimite cererea →')).toBeInTheDocument()
  })

  it('AF4: cererea în analiză nu promite un termen de apel', () => {
    state.dashboard = {
      ok: true,
      is_affiliate: true,
      affiliate: {
        id: 'a1',
        referral_code: 'abc12345',
        vanity_slug: null,
        status: 'pending',
        setup_bps: 3000,
        recurring_bps: 1000,
        cascade_bps: 200,
        recurring_cap_months: 12,
        created_at: '2026-10-01T00:00:00Z',
      },
    }
    render(<AfiliatPage />)
    expect(screen.getByText('Cererea ta e în analiză')).toBeInTheDocument()
    expect(screen.queryByText(/1–2 zile/)).not.toBeInTheDocument()
  })
})

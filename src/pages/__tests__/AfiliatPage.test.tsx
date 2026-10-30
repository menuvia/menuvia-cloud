// Teste pe ecranul de cerere al panoului de afiliat (mig 295 §1). Pagina e
// TRISTATE pe `program_open` (ramura ne-afiliat din get_affiliate_dashboard):
//   AF1  `false` → „Programul se redeschide", FĂRĂ formular (nu cerem cuiva să
//        completeze ce serverul va refuza)
//   AF2  `true`  → formularul de cerere (control pozitiv — fără el AF1 ar
//        trece și cu formularul șters de tot)
//   AF3  lipsă (DB fără 295) → formularul RĂMÂNE, serverul decide
//   AF4  cererea în analiză NU mai promite apel „în 1–2 zile"
//
// Panoul activ = UN singur ecran (pachetul 8b-2), rețeaua din get_sales_network
// (useSalesNetwork, mock-uit aici — hook-ul are testele lui, HS1–HS8):
//   AF5  șef → „Echipa ta” + „Invită agent”, titlul „Șef de vânzări”
//        (mutația care arată echipa pe orice rol sau pe niciunul pică aici + AF6)
//   AF6  agent → FĂRĂ „Echipa ta” / „Invită agent”, cu cardul șefului lui
//   AF7  rețea NECUNOSCUTĂ (eroare) → „Reîncearcă”, fără echipă, fără comutator și
//        fără vreun „nu ești în rețea” (mutația `network ?? fallbackFărăRol` pică)
//   AF7b rețea încă în încărcare → mesaj de încărcare, NU „Reîncearcă”
//   AF8  ordinea secțiunilor: Înscrie → Banii tăi → Clienții mei → Echipa ta →
//        Consimțământ → Cum vând (mutația care le reordonează pică)
//   AF9  „Banii tăi” = propoziții, detaliile sunt PLIATE: la deschidere, formularul
//        de plată (IBAN) există încă (mutația care șterge PayoutProfileForm pică)
//   AF10 comutatorul reflectă `contactSharing` de pe server și cheamă
//        setContactSharing(true) (mutația `shared={false}` fix pică)
//   AF11 textele vizibile spun „agent de vânzări”, nu „afiliat/partener”
//   AF13 „Contract nou de colaborare” apare PRIMA doar pentru un membru cu
//        needs_acceptance; nu apare pe flag false și nici pe rol null (afiliatul
//        vechi n-are ce accepta — mutația care uită garda pe rol pică)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AffiliateDashboard } from '../../hooks/useAffiliate'
import type { UseSalesNetwork } from '../../hooks/useSalesNetwork'
import type { SalesNetwork } from '../../lib/salesNetwork'

const { state, sales } = vi.hoisted(() => ({
  state: { dashboard: null as AffiliateDashboard | null },
  sales: { current: null as UseSalesNetwork | null },
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
vi.mock('../../hooks/useSalesNetwork', () => ({
  useSalesNetwork: () => sales.current,
}))
// Formularul de plată citește profilul prin `from(...).select().eq().maybeSingle()`.
vi.mock('../../lib/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  }
  return { supabase: { rpc: vi.fn(), from: vi.fn(() => chain) } }
})
vi.mock('../../lib/founder', () => ({
  listPartnerRestaurants: vi.fn(async () => []),
  listPartnerAttributions: vi.fn(async () => []),
  requestPartnerAccess: vi.fn(async () => ({ ok: true })),
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
    expect(screen.getByText('Programul pentru agenți de vânzări se redeschide')).toBeInTheDocument()
    expect(screen.queryByText('Trimite cererea →')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('07xx xxx xxx')).not.toBeInTheDocument()
  })

  it('AF2 (control pozitiv): program_open:true → formularul', () => {
    state.dashboard = { ok: true, is_affiliate: false, defaults: DEFAULTS, program_open: true }
    render(<AfiliatPage />)
    expect(screen.getByText('Trimite cererea →')).toBeInTheDocument()
    expect(screen.queryByText('Programul pentru agenți de vânzări se redeschide')).not.toBeInTheDocument()
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

// ── Panoul activ ─────────────────────────────────────────────────────────────

function activeDashboard(): AffiliateDashboard {
  return {
    ok: true,
    is_affiliate: true,
    affiliate: {
      id: 'a1',
      referral_code: 'k7mxq2p',
      vanity_slug: null,
      status: 'active',
      setup_bps: 3000,
      recurring_bps: 1000,
      cascade_bps: 2000,
      recurring_cap_months: 12,
      created_at: '2026-10-01T00:00:00Z',
    },
    restaurants: [
      {
        attribution_id: 'att-1',
        status: 'active',
        captured_at: '2026-10-05T00:00:00Z',
        restaurant_names: ['Bistro Test'],
        city: 'Cluj',
        commission_cents: 9000,
      },
    ],
    sub_affiliates: [],
    earnings: {
      currency: 'RON',
      total_cents: 9000,
      confirmed_cents: 9000,
      pending_cents: 0,
      paid_cents: 0,
      clawed_back_cents: 0,
      net_earned_cents: 9000,
      pending_net_cents: 0,
      in_progress_cents: 0,
      available_cents: 9000,
      min_payout_cents: 5000,
    },
    next_payout_at: null,
    next_batch_date: null,
  }
}

function salesNetwork(over: Partial<SalesNetwork> = {}): SalesNetwork {
  return {
    role: 'agent',
    status: 'active',
    affiliateId: 'a1',
    contactSharing: false,
    contract: {
      currentVersion: '1.0',
      acceptedVersion: '1.0',
      acceptedAt: '2026-10-01T10:00:00Z',
      needsAcceptance: false,
      currentTextHash: 'a'.repeat(64),
    },
    head: null,
    team: [],
    openInvites: [],
    limits: { openInvitesMax: 20, inviteTtlDays: 14 },
    ...over,
  }
}

function salesState(over: Partial<UseSalesNetwork> = {}): UseSalesNetwork {
  return {
    network: salesNetwork(),
    loading: false,
    error: null,
    unavailable: false,
    reload: vi.fn(async () => undefined),
    setContactSharing: vi.fn(async () => null),
    ...over,
  }
}

const headingTexts = () => screen.getAllByRole('heading').map((h: HTMLElement) => h.textContent ?? '')

describe('AfiliatPage — panoul de vânzări pe un singur ecran', () => {
  beforeEach(() => {
    state.dashboard = activeDashboard()
    sales.current = salesState()
  })

  it('AF5: șeful vede „Echipa ta” și „Invită agent”', async () => {
    sales.current = salesState({ network: salesNetwork({ role: 'head' }) })
    render(<AfiliatPage />)
    expect(screen.getByRole('heading', { name: 'Echipa ta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invită agent' })).toBeInTheDocument()
    expect(screen.getByText('Șef de vânzări')).toBeInTheDocument()
    await screen.findByText('Bistro Test')
  })

  it('AF6: agentul NU vede echipa, vede cardul șefului', async () => {
    sales.current = salesState({
      network: salesNetwork({
        role: 'agent',
        head: { affiliateId: 'h1', status: 'active', contactShared: true, name: 'Ana Șef', phone: null, email: null },
      }),
    })
    render(<AfiliatPage />)
    expect(screen.queryByRole('heading', { name: 'Echipa ta' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invită agent' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Șeful tău de vânzări' })).toBeInTheDocument()
    expect(screen.getByText('Ana Șef')).toBeInTheDocument()
    expect(screen.getByText('Agent de vânzări')).toBeInTheDocument()
    await screen.findByText('Bistro Test')
  })

  it('AF7: rețea necunoscută (eroare) → „Reîncearcă”, nimic fals', async () => {
    const reload = vi.fn(async () => undefined)
    sales.current = salesState({ network: null, error: null, loading: false, reload })
    render(<AfiliatPage />)
    expect(screen.getByRole('alert')).toHaveTextContent(/nu am putut încărca echipa/i)
    expect(screen.queryByRole('heading', { name: 'Echipa ta' })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(document.body.textContent ?? '').not.toMatch(/nu ești în rețea|nu faci parte/i)
    // Titlul nu ghicește rolul.
    expect(screen.getByText('Panoul de vânzări')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(reload).toHaveBeenCalledTimes(1)
    // Restul panoului (din get_affiliate_dashboard) rămâne.
    expect(screen.getByRole('heading', { name: 'Înscrie un restaurant' })).toBeInTheDocument()
    await screen.findByText('Bistro Test')
  })

  it('AF7b: rețea în încărcare → mesaj de încărcare, fără „Reîncearcă”', async () => {
    sales.current = salesState({ network: null, loading: true })
    render(<AfiliatPage />)
    expect(screen.getByText(/se încarcă echipa/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reîncearcă' })).toBeNull()
    await screen.findByText('Bistro Test')
  })

  it('AF8: ordinea secțiunilor pe ecran', async () => {
    sales.current = salesState({ network: salesNetwork({ role: 'head' }) })
    render(<AfiliatPage />)
    await screen.findByText('Bistro Test')
    const order = ['Înscrie un restaurant', 'Banii tăi', 'Clienții mei', 'Echipa ta', 'Consimțământ de contact']
    const seen = headingTexts().filter((t: string) => order.includes(t))
    expect(seen).toEqual(order)
    // „Cum vând” e ULTIMA secțiune (pliată): butonul vine după comutator.
    const how = screen.getByRole('button', { name: /cum vând/i })
    const sw = screen.getByRole('switch')
    expect(sw.compareDocumentPosition(how) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(how).toHaveAttribute('aria-expanded', 'false')
  })

  it('AF9: banii în propoziții, detaliile pliate păstrează formularul de plată', async () => {
    render(<AfiliatPage />)
    expect(screen.getByText(/^Ai câștigat .*90,00.* până acum/)).toBeInTheDocument()
    expect(screen.getByText(/^Poți primi acum/)).toBeInTheDocument()
    expect(screen.queryByLabelText('IBAN')).toBeNull()
    const details = screen.getByRole('button', { name: /detalii plăți/i })
    expect(details).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(details)
    expect(await screen.findByLabelText('IBAN')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvează datele de plată' })).toBeInTheDocument()
    expect(screen.getByText('Disponibil pentru plată')).toBeInTheDocument()
  })

  it('AF10: comutatorul de contact reflectă serverul și cheamă setContactSharing', async () => {
    const setContactSharing = vi.fn(async () => null)
    sales.current = salesState({ setContactSharing, network: salesNetwork({ contactSharing: false }) })
    const { rerender } = render(<AfiliatPage />)
    const sw = screen.getByRole('switch', { name: 'Arată datele mele de contact' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(sw)
    expect(setContactSharing).toHaveBeenCalledWith(true)

    sales.current = salesState({ setContactSharing, network: salesNetwork({ contactSharing: true }) })
    rerender(<AfiliatPage />)
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'))
    await screen.findByText('Bistro Test')
  })

  it('AF13: secțiunea de reacceptare apare doar pentru membrul cu needs_acceptance', async () => {
    const pending = (role: 'agent' | 'head' | null, needs: boolean) =>
      salesState({
        network: salesNetwork({
          role,
          contract: {
            currentVersion: '2.0',
            acceptedVersion: '1.0',
            acceptedAt: '2026-10-01T10:00:00Z',
            needsAcceptance: needs,
            currentTextHash: 'b'.repeat(64),
          },
        }),
      })
    sales.current = pending('agent', true)
    const { unmount } = render(<AfiliatPage />)
    await screen.findByText('Bistro Test')
    const titles = headingTexts()
    expect(titles).toContain('Contract nou de colaborare')
    expect(titles.indexOf('Contract nou de colaborare')).toBeLessThan(titles.indexOf('Înscrie un restaurant'))
    unmount()

    for (const [role, needs] of [['agent', false], [null, true]] as const) {
      sales.current = pending(role, needs)
      const view = render(<AfiliatPage />)
      await screen.findByText('Bistro Test')
      expect(headingTexts(), `${String(role)}/${String(needs)}`).not.toContain('Contract nou de colaborare')
      view.unmount()
    }
  })

  it('AF11: textele vizibile vorbesc de agent de vânzări, nu de afiliat/partener', async () => {
    render(<AfiliatPage />)
    await screen.findByText('Bistro Test')
    expect(document.body.textContent ?? '').not.toMatch(/afiliat|partener/i)
  })
})

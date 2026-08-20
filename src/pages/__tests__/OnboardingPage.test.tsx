// Teste smoke pe OnboardingPage — funelul de activare (audit aug 2026:
// 4/4 utilizatori reali au murit la pasul „introdu meniul", fără nicio plasă
// de teste pe wizard). Plasa minimă, nu tot wizardul:
//   - Pasul 1 se randează și cere numele (buton dezactivat fără el)
//   - crearea restaurantului avansează la Pasul 2
//   - Pasul 2 oferă importul din poză ca acțiune primară + formularul manual
// Pattern de mock-uri ca în ReservePage.test.tsx (supabase + module).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { createRestaurantMock, trackMock } = vi.hoisted(() => ({
  createRestaurantMock: vi.fn(),
  trackMock: vi.fn(),
}))

vi.mock('../../lib/restaurants', () => ({ createRestaurant: createRestaurantMock }))
vi.mock('../../lib/analytics', () => ({ track: trackMock }))
// Supabase: doar lanțurile atinse de onboarding (markOnboarding = update().eq()).
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))
// Features (folosite doar în Pasul 3) — fără fetch real în smoke test.
vi.mock('../../lib/features', () => ({
  fetchRestaurantFeatures: vi.fn().mockResolvedValue({}),
  getLimit: vi.fn(() => null),
  hasFeature: vi.fn(() => true),
}))
// Presetul demo (RPC apply_business_type_preset) — nu îl exersăm în smoke.
vi.mock('../../lib/quickSetup', () => ({
  applyBusinessTypePreset: vi.fn().mockResolvedValue({ status: 'success' }),
}))
// AiMenuImport e lazy + greu (hooks de date); aici verificăm doar că butonul
// de deschidere există în Pasul 2, nu modalul în sine.
vi.mock('../../components/AiMenuImport', () => ({ default: () => null }))

import OnboardingPage from '../OnboardingPage'

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

// Completează Pasul 1 (nume + Continuă) și așteaptă Pasul 2.
async function reachStep2() {
  const user = userEvent.setup()
  createRestaurantMock.mockResolvedValue({ restaurant_id: 'r1', restaurant_slug: 'la-bella' })
  render(<OnboardingPage onComplete={vi.fn()} />)
  await user.type(screen.getByLabelText(/numele restaurantului/i), 'La Bella')
  await user.click(screen.getByRole('button', { name: /continuă/i }))
  await screen.findByText('Adaugă primul produs')
  return user
}

describe('OnboardingPage — funelul de activare', () => {
  it('Pasul 1 se randează cu titlul și butonul Continuă dezactivat fără nume', () => {
    render(<OnboardingPage onComplete={vi.fn()} />)
    expect(screen.getByText('Configurează restaurantul')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continuă/i })).toBeDisabled()
    // Telemetria pornește la mount — funelul devine măsurabil.
    expect(trackMock).toHaveBeenCalledWith('onboarding_started')
  })

  it('completarea numelui creează restaurantul și avansează la Pasul 2', async () => {
    await reachStep2()
    expect(createRestaurantMock).toHaveBeenCalledTimes(1)
    expect(createRestaurantMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'La Bella' }))
    expect(trackMock).toHaveBeenCalledWith('onboarding_step_completed', { step: 1, skipped: false })
  })

  it('Pasul 2 oferă importul din poză ca acțiune primară, cu formularul manual dedesubt', async () => {
    await reachStep2()
    expect(screen.getByRole('button', { name: /ai meniul tipărit/i })).toBeInTheDocument()
    // Formularul manual rămâne disponibil (nu a fost înlocuit de import).
    expect(screen.getByLabelText('Produs *')).toBeInTheDocument()
    // Și alternativa de Skip cu meniu demo e prezentă.
    expect(screen.getByRole('button', { name: /meniu demo de pizzerie/i })).toBeInTheDocument()
  })
})

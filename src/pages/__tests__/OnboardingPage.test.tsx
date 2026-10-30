// Teste smoke pe OnboardingPage — funelul de activare (audit aug 2026:
// 4/4 utilizatori reali au murit la pasul „introdu meniul", fără nicio plasă
// de teste pe wizard). Plasa minimă, nu tot wizardul:
//   - Pasul 1 se randează și cere numele (buton dezactivat fără el)
//   - crearea restaurantului avansează la Pasul 2
//   - Pasul 2 oferă importul din poză ca acțiune primară + formularul manual
// Pattern de mock-uri ca în ReservePage.test.tsx (supabase + module).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LimitDetail } from '../../lib/features'

const { createRestaurantMock, trackMock, aiImportPropsMock, getLimitDetailedMock } = vi.hoisted(
  () => ({
    createRestaurantMock: vi.fn(),
    trackMock: vi.fn(),
    aiImportPropsMock: vi.fn(),
    getLimitDetailedMock: vi.fn((): LimitDetail => ({ kind: 'unlimited' })),
  }),
)

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
  getLimitDetailed: getLimitDetailedMock,
  hasFeature: vi.fn(() => true),
}))
// AiMenuImport e lazy + greu (hooks de date); aici verificăm doar că butonul
// de deschidere există în Pasul 2 și ce props primește modalul, nu modalul în sine.
vi.mock('../../components/AiMenuImport', () => ({
  default: (props: { remainingSlots?: number }) => {
    aiImportPropsMock(props)
    return null
  },
}))

import OnboardingPage from '../OnboardingPage'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ONBOARDING_SRC = readFileSync(resolve(process.cwd(), 'src/pages/OnboardingPage.tsx'), 'utf8')

beforeEach(() => {
  vi.clearAllMocks()
  getLimitDetailedMock.mockReturnValue({ kind: 'unlimited' })
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

  // OB-S1 (ux-owner-slug): linkul nu mai e un câmp cerut patronului și nu mai
  // rupe diacriticele. Mutația care pică: slugify-ul vechi (`[^a-z0-9]+` direct
  // pe litere mici) → „casa-r-neasc” în previzualizare și în apel.
  it('OB-S1 linkul se creează din nume, cu diacriticele transliterate, fără câmp de slug', async () => {
    const user = userEvent.setup()
    createRestaurantMock.mockResolvedValue({
      restaurant_id: 'r1',
      restaurant_slug: 'casa-taraneasca',
    })
    render(<OnboardingPage onComplete={vi.fn()} />)
    expect(screen.queryByLabelText(/url meniu/i)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/numele restaurantului/i), 'Casa Țărănească')
    expect(screen.getByTestId('ob-link-preview')).toHaveTextContent(/\/m\/casa-taraneasca$/)
    await user.click(screen.getByRole('button', { name: /continuă/i }))
    await screen.findByText('Adaugă primul produs')
    expect(createRestaurantMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Casa Țărănească', slug: 'casa-taraneasca' }),
    )
  })

  // AQ3 (ux-owner-ai-import-plafon): onboarding-ul trimite plafonul planului
  // importului AI, ca un meniu peste plafon să fie oprit ÎNAINTE de salvare.
  // Mutația care pică: <AiMenuImport> fără remainingSlots (comportamentul vechi).
  it('AQ3 importul din poză primește plafonul de produse al planului', async () => {
    getLimitDetailedMock.mockReturnValue({ kind: 'limited', n: 15 })
    const user = await reachStep2()
    await user.click(screen.getByRole('button', { name: /ai meniul tipărit/i }))
    await waitFor(() =>
      expect(aiImportPropsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ restaurantId: 'r1', remainingSlots: 15 }),
      ),
    )
  })

  it('Pasul 2 oferă importul din poză ca acțiune primară, cu formularul manual dedesubt', async () => {
    await reachStep2()
    expect(screen.getByRole('button', { name: /ai meniul tipărit/i })).toBeInTheDocument()
    // Formularul manual rămâne disponibil (nu a fost înlocuit de import).
    expect(screen.getByLabelText('Produs *')).toBeInTheDocument()
    // Și alternativa de Skip cu meniu demo e prezentă (meniul demo PUBLIC, OB-D1).
    expect(screen.getByRole('link', { name: /meniul demo/i })).toBeInTheDocument()
  })

  // OB-D1 (ux-owner-demo-menus): meniul demo NU se mai inserează în restaurantul
  // omului (presetul umplea plafonul gratuit — cafenea = 15/15 — și publica pe QR
  // produse false). Rămâne meniul demo public, într-o filă nouă. Mutația care
  // pică: butoanele de preset readuse (sau importul applyBusinessTypePreset).
  it('OB-D1 meniul demo e cel public, într-o filă nouă; nimic nu se inserează', async () => {
    await reachStep2()
    const demo = screen.getByRole('link', { name: /meniul demo/i })
    expect(demo).toHaveAttribute('href', '/demo')
    expect(demo).toHaveAttribute('target', '_blank')
    expect(demo).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.queryByRole('button', { name: /meniu demo de/i })).not.toBeInTheDocument()
    expect(ONBOARDING_SRC).not.toContain('applyBusinessTypePreset')
  })
})

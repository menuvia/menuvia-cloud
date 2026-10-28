// ReservePage respectă „Fără branding" (theme_settings.hide_branding, gate-uit
// la CITIRE în proiecția publică, mig 281) — înainte „Powered by Menuvia"
// apărea necondiționat pe /rezervare/:slug, deși /m/:slug și QR îl ascundeau.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { fetchRestaurantBySlugMock } = vi.hoisted(() => ({ fetchRestaurantBySlugMock: vi.fn() }))

vi.mock('../../lib/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/qr')>()
  return { ...actual, fetchRestaurantBySlug: fetchRestaurantBySlugMock }
})
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))

import ReservePage from '../ReservePage'

const RESTAURANT = {
  id: 'r1',
  name: 'Bistro Test',
  slug: 'bistro-test',
  primary_color: '#C8963C',
  logo_url: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/rezervare/bistro-test')
})

describe('ReservePage — „Fără branding"', () => {
  it('RB1 hide_branding=true → fără „Menuvia"', async () => {
    fetchRestaurantBySlugMock.mockResolvedValue({
      ...RESTAURANT,
      theme_settings: { preset_id: 'classic', hide_branding: true },
    })
    render(<ReservePage slug="bistro-test" navigate={vi.fn()} />)
    expect(await screen.findByText('Bistro Test')).toBeInTheDocument()
    expect(screen.queryByText('Menuvia')).toBeNull()
  })

  it('RB2 fără flag → „Powered by Menuvia" (control pozitiv)', async () => {
    fetchRestaurantBySlugMock.mockResolvedValue(RESTAURANT)
    render(<ReservePage slug="bistro-test" navigate={vi.fn()} />)
    expect(await screen.findByText('Menuvia')).toBeInTheDocument()
  })
})

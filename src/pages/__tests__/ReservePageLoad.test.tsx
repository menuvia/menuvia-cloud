// /rezervare/:slug pe rețea slabă și cascada de chunk-uri (audit oct 2026).
//
//   QZ5   eroare de transport la încărcarea restaurantului → „Conexiune slabă"
//         + „Reîncearcă", NU „restaurantul nu a fost găsit" (ux-guest-1);
//         „Reîncearcă" chiar reîncarcă.
//   QZ6c  control: pe fluxul de anulare (?cancel=) chunk-ul sheet-ului NU se cere.
//   QZ6   fără ?cancel= chunk-ul sheet-ului e cerut cât RPC-ul e încă în aer
//         (perf-guest-5) — înainte, abia după ce restaurantul se încărca.
//   DL3   `<html lang>` urmează limba browserului și se reface la demontare.
//
// Fișier separat de ReservePage.test.tsx: modulul ReservationSheet e mock-uit
// cu un spion pe IMPORT (fabrica vi.mock rulează la primul import), iar
// registrul de module e per fișier — QZ6c trebuie să ruleze înaintea lui QZ6.
//
// Mutații care pică: `.catch(() => setNotFound(true))` înapoi în ReservePage →
// QZ5; scoaterea efectului de prefetch → QZ6; prefetch necondiționat → QZ6c;
// fără useDocumentLang → DL3.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchRestaurantBySlugMock, sheetModuleLoaded } = vi.hoisted(() => ({
  fetchRestaurantBySlugMock: vi.fn(),
  sheetModuleLoaded: vi.fn(),
}))

vi.mock('../../lib/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/qr')>()
  return { ...actual, fetchRestaurantBySlug: fetchRestaurantBySlugMock }
})
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('../../components/ReservationSheet', () => {
  sheetModuleLoaded()
  return { default: () => null }
})

import ReservePage from '../ReservePage'

const SLUG = 'bistro-test'
const RESTAURANT = {
  id: 'r1',
  name: 'Bistro Test',
  slug: SLUG,
  primary_color: '#C8963C',
  logo_url: null,
}

function setLanguage(value: string): void {
  Object.defineProperty(window.navigator, 'language', { value, configurable: true })
}

beforeEach(() => {
  fetchRestaurantBySlugMock.mockReset()
  setLanguage('ro-RO')
  document.documentElement.setAttribute('lang', 'ro')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('ReservePage — rețea slabă', () => {
  it('QZ5 transportul picat arată „Conexiune slabă" + „Reîncearcă", nu „negăsit"', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', `/rezervare/${SLUG}?cancel=AABBCC11`)
    fetchRestaurantBySlugMock.mockRejectedValueOnce(new Error('TypeError: Load failed'))
    fetchRestaurantBySlugMock.mockResolvedValueOnce(RESTAURANT)

    render(<ReservePage slug={SLUG} navigate={vi.fn()} />)

    expect(await screen.findByText(/conexiune slabă/i)).toBeInTheDocument()
    expect(screen.queryByText(/restaurantul nu a fost găsit/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /reîncearcă/i }))

    expect(await screen.findByText('Bistro Test')).toBeInTheDocument()
    expect(fetchRestaurantBySlugMock).toHaveBeenCalledTimes(2)
  })
})

describe('ReservePage — chunk-ul sheet-ului în paralel cu RPC-ul', () => {
  it('QZ6c control: pe ?cancel= sheet-ul nu se deschide, deci chunk-ul nu se cere', async () => {
    window.history.replaceState({}, '', `/rezervare/${SLUG}?cancel=AABBCC22`)
    fetchRestaurantBySlugMock.mockResolvedValue(RESTAURANT)

    render(<ReservePage slug={SLUG} navigate={vi.fn()} />)

    expect(await screen.findByText('Bistro Test')).toBeInTheDocument()
    expect(sheetModuleLoaded).not.toHaveBeenCalled()
  })

  it('QZ6 fără ?cancel= chunk-ul e cerut cât restaurantul încă se încarcă', async () => {
    window.history.replaceState({}, '', `/rezervare/${SLUG}`)
    // RPC-ul nu se întoarce niciodată: pagina rămâne pe spinner. Pe codul vechi
    // sheet-ul (deci și importul lui) apărea abia DUPĂ restaurant.
    fetchRestaurantBySlugMock.mockReturnValue(new Promise(() => {}))

    render(<ReservePage slug={SLUG} navigate={vi.fn()} />)

    await vi.waitFor(() => expect(sheetModuleLoaded).toHaveBeenCalledTimes(1))
  })
})

describe('ReservePage — limba documentului', () => {
  it('DL3 `<html lang>` = limba browserului, refăcută la demontare', async () => {
    setLanguage('en-US')
    window.history.replaceState({}, '', `/rezervare/${SLUG}?cancel=AABBCC33`)
    fetchRestaurantBySlugMock.mockResolvedValue(RESTAURANT)

    const { unmount } = render(<ReservePage slug={SLUG} navigate={vi.fn()} />)
    expect(await screen.findByText('Bistro Test')).toBeInTheDocument()
    expect(document.documentElement.getAttribute('lang')).toBe('en')

    unmount()
    expect(document.documentElement.getAttribute('lang')).toBe('ro')
  })
})

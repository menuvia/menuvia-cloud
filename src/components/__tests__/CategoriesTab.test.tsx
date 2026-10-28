// Editorul MANUAL de traduceri pe categorii (CategoriesTab). Ce păzesc:
// - câmpurile apar EXACT pentru limbile active din `restaurant.menu_languages`;
// - salvarea scrie numele tastate și NU pierde limbile neactive deja traduse
//   (de mână sau de AI bulk) — o limbă deselectată temporar nu-și pierde munca;
// - eroarea Supabase (venită în `{error}`, supabase-js nu aruncă) e afișată în
//   modal, fără toast de succes;
// - fără limbi configurate nu apare niciun câmp de traducere.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Category } from '../../hooks/useData'

// Tot ce folosesc fabricile `vi.mock` trebuie să fie HOISTED (TDZ altfel).
const h = vi.hoisted(() => ({
  update: vi.fn(),
  create: vi.fn(),
  categories: [] as Category[],
}))

vi.mock('../../hooks/useData', () => ({
  useCategories: () => ({
    categories: h.categories,
    loading: false,
    error: null,
    create: h.create,
    update: h.update,
    remove: vi.fn(async () => ({ error: null })),
    reorder: vi.fn(),
    refetch: vi.fn(),
  }),
}))

// Numărătoarea de produse per categorie: .from('products').select().eq() → thenable.
vi.mock('../../lib/supabase', () => {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve)
  return { supabase: { from: () => builder } }
})

import CategoriesTab from '../CategoriesTab'

function makeCategory(over: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
    restaurant_id: 'rest-1',
    name: 'Feluri principale',
    emoji: '🍽️',
    display_order: 0,
    meta_text: null,
    translations: {
      en: { name: 'Mains' },
      fr: { name: 'Plats principaux' }, // limbă NEactivă mai jos
    },
    ...over,
  }
}

beforeEach(() => {
  h.update.mockReset()
  h.create.mockReset()
  h.categories = [makeCategory()]
})

describe('CategoriesTab — traduceri manuale', () => {
  it('salvează numele pe limbile active și păstrează limbile neactive', async () => {
    h.update.mockResolvedValue({ data: makeCategory(), error: null })
    render(<CategoriesTab restaurantId="rest-1" menuLanguages={['en', 'de']} />)

    await userEvent.click(screen.getByRole('button', { name: 'Editează categorie' }))

    const en = screen.getByLabelText(/Nume \(English\)/)
    const de = screen.getByLabelText(/Nume \(Deutsch\)/)
    expect(en).toHaveValue('Mains')
    expect(de).toHaveValue('')
    // Franceza nu e activă → niciun câmp pentru ea.
    expect(screen.queryByLabelText(/Nume \(Français\)/)).not.toBeInTheDocument()

    await userEvent.clear(en)
    await userEvent.type(en, 'Main courses')
    await userEvent.type(de, 'Hauptgerichte')
    await userEvent.click(screen.getByRole('button', { name: 'Salvează' }))

    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    const [id, payload] = h.update.mock.calls[0] as [string, Partial<Category>]
    expect(id).toBe('cat-1')
    expect(payload.translations).toEqual({
      en: { name: 'Main courses' },
      de: { name: 'Hauptgerichte' },
      fr: { name: 'Plats principaux' },
    })
    expect(await screen.findByText('Actualizat')).toBeInTheDocument()
  })

  it('eroarea Supabase e afișată în modal, fără toast de succes', async () => {
    h.update.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for table categories' },
    })
    render(<CategoriesTab restaurantId="rest-1" menuLanguages={['en']} />)

    await userEvent.click(screen.getByRole('button', { name: 'Editează categorie' }))
    await userEvent.type(screen.getByLabelText(/Nume \(English\)/), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Salvează' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('permission denied for table categories')
    expect(screen.queryByText('Actualizat')).not.toBeInTheDocument()
    // Modalul rămâne deschis, cu textul tastat intact.
    expect(screen.getByLabelText(/Nume \(English\)/)).toHaveValue('Mains!')
  })

  it('fără limbi configurate nu apare niciun câmp și traducerile nu se ating', async () => {
    h.update.mockResolvedValue({ data: makeCategory(), error: null })
    render(<CategoriesTab restaurantId="rest-1" menuLanguages={[]} />)

    await userEvent.click(screen.getByRole('button', { name: 'Editează categorie' }))
    // Control pozitiv: modalul e deschis (câmpul de emoji e acolo).
    expect(screen.getByPlaceholderText('🍽️')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Nume \(/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Traduceri/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Salvează' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    const [, payload] = h.update.mock.calls[0] as [string, Partial<Category>]
    expect(payload.translations).toEqual({
      en: { name: 'Mains' },
      fr: { name: 'Plats principaux' },
    })
  })

  it('categorie nouă: traducerile tastate pleacă la create', async () => {
    h.categories = []
    h.create.mockResolvedValue({ data: makeCategory(), error: null })
    render(<CategoriesTab restaurantId="rest-1" menuLanguages={['de']} />)

    // Butonul din antet (EmptyState are și el unul — luăm primul).
    await userEvent.click(screen.getAllByRole('button', { name: /Adaugă categorie/ })[0])
    await userEvent.type(screen.getByPlaceholderText('Feluri principale'), 'Deserturi')
    await userEvent.type(screen.getByLabelText(/Nume \(Deutsch\)/), 'Nachspeisen')
    await userEvent.click(screen.getByRole('button', { name: 'Salvează' }))

    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1))
    const [payload] = h.create.mock.calls[0] as [Partial<Category>]
    expect(payload.name).toBe('Deserturi')
    expect(payload.translations).toEqual({ de: { name: 'Nachspeisen' } })
    expect(await screen.findByText('Categorie adăugată')).toBeInTheDocument()
  })
})

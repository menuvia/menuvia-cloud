// /rezervare/:slug are selector de limbă (lotul C8e). Limba paginii e și limba
// confirmării: ReservationSheet o trimite ca `guest_language` (mig 328), deci
// SMS-ul și emailul pleacă în ea. Înainte pagina lua DOAR limba browserului,
// fără selector — un român cu telefonul în engleză primea SMS-uri în engleză.
// Prefixul RPL: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md.
//
//   RPL1  browser en-US → pagina în engleză; pastilele (toate cele 7, baza
//         prima) sunt în pagină; „Română” → pagina, foaia și `<html lang>` trec
//         pe română, iar adresa primește `?lang=ro` (replaceState).
//         [PICĂ: pagina de dinainte — fără pastile]
//   RPL2  `?lang=de` bate browserul; pastilele din FOAIE (deschisă din prima,
//         acoperă pastilele din pagină) schimbă și ele limba, cu indicația că
//         confirmarea vine în limba aleasă. [PICĂ: `langSwitch` netransmis]
//   RPL3  pe fluxul de anulare, schimbarea limbii păstrează `?cancel=` în adresă
//         și codul în câmp. [PICĂ: o adresă construită de la zero]
//   RPL4  browser nesuportat (pl) → limba de BAZĂ a localului (fr), nu engleza;
//         prima pastilă e baza. [PICĂ: fallback-ul vechi pe 'en']
//   RPL5  Googlebot (navigator en-US) primește baza, nu engleza.
//         [PICĂ: auto-detectul aplicat și roboților]
//   RPL6  „Vezi meniul” duce la `/m/:slug?lang=<limba paginii>`.
//         [PICĂ: `navigate('/m/' + slug)` de dinainte]
// Controlul pozitiv al lui RPL4/RPL5: RPL1 (browser suportat → limba lui).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { T } from '../../lib/publicMenuStrings'

const { fetchRestaurantBySlugMock } = vi.hoisted(() => ({ fetchRestaurantBySlugMock: vi.fn() }))

vi.mock('../../lib/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/qr')>()
  return { ...actual, fetchRestaurantBySlug: fetchRestaurantBySlugMock }
})
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
// Foaia reală e testată în ReservationSheet.test.tsx; aici contează ce primește:
// limba și selectorul.
vi.mock('../../components/ReservationSheet', async () => {
  const { createElement } = await import('react')
  return {
    default: (props: { lang: string; langSwitch?: ReactNode }) =>
      createElement('div', { 'data-testid': 'sheet', 'data-lang': props.lang }, props.langSwitch ?? null),
  }
})

import ReservePage from '../ReservePage'

const SLUG = 'bistro-test'
const RESTAURANT = { id: 'r1', name: 'Bistro Test', slug: SLUG, primary_color: '#C8963C', logo_url: null }
const ALL = ['Română', 'English', 'Deutsch', 'Français', 'Italiano', 'Magyar', 'Español']

function setNavigator(key: 'language' | 'userAgent', value: string): void {
  Object.defineProperty(window.navigator, key, { value, configurable: true })
}

function open(path: string, navigate = vi.fn()) {
  window.history.replaceState({}, '', path)
  render(<ReservePage slug={SLUG} navigate={navigate} />)
  return navigate
}

/** Grupul de pastile din PAGINĂ (nu cel din foaie). */
function heroGroup(lang: string): HTMLElement {
  const groups = screen.getAllByRole('group', { name: T(lang, 'rp_lang_switch_aria') })
  const hero = groups.find((g) => !g.closest('[data-testid="sheet"]'))
  if (!hero) throw new Error('pastilele din pagină lipsesc')
  return hero
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchRestaurantBySlugMock.mockResolvedValue(RESTAURANT)
  document.documentElement.setAttribute('lang', 'ro')
})
afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'language')
  Reflect.deleteProperty(window.navigator, 'userAgent')
})

describe('ReservePage — limba paginii și a confirmării', () => {
  it('RPL1 browser en → engleză; „Română” schimbă pagina, foaia și adresa', async () => {
    const user = userEvent.setup()
    setNavigator('language', 'en-US')
    open(`/rezervare/${SLUG}`)

    expect(await screen.findByText(T('en', 'rp_tagline'))).toBeInTheDocument()
    // Foaia e lazy (Suspense): se așteaptă, nu se presupune randată.
    expect(await screen.findByTestId('sheet')).toHaveAttribute('data-lang', 'en')
    const hero = heroGroup('en')
    expect(within(hero).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(ALL)
    expect(within(hero).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(hero).getByRole('button', { name: 'Română' }))

    expect(screen.getByText(T('ro', 'rp_tagline'))).toBeInTheDocument()
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-lang', 'ro')
    expect(document.documentElement.getAttribute('lang')).toBe('ro')
    expect(window.location.search).toBe('?lang=ro')
  })

  it('RPL2 `?lang=de` bate browserul; pastilele din foaie schimbă limba', async () => {
    const user = userEvent.setup()
    setNavigator('language', 'en-US')
    open(`/rezervare/${SLUG}?lang=de`)

    expect(await screen.findByText(T('de', 'rp_tagline'))).toBeInTheDocument()
    const sheet = await screen.findByTestId('sheet')
    expect(sheet).toHaveAttribute('data-lang', 'de')
    expect(within(sheet).getByText(T('de', 'rp_lang_hint'))).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Français' }))

    expect(screen.getByTestId('sheet')).toHaveAttribute('data-lang', 'fr')
    expect(screen.getByText(T('fr', 'rp_tagline'))).toBeInTheDocument()
    expect(within(screen.getByTestId('sheet')).getByText(T('fr', 'rp_lang_hint'))).toBeInTheDocument()
    expect(window.location.search).toBe('?lang=fr')
  })

  it('RPL3 pe fluxul de anulare, `?cancel=` rămâne în adresă și codul în câmp', async () => {
    const user = userEvent.setup()
    setNavigator('language', 'ro-RO')
    open(`/rezervare/${SLUG}?cancel=AB12CD34`)

    const input = await screen.findByPlaceholderText(T('ro', 'rp_code_ph'))
    await user.click(within(heroGroup('ro')).getByRole('button', { name: 'Deutsch' }))

    expect(window.location.search).toBe('?cancel=AB12CD34&lang=de')
    expect(screen.getByPlaceholderText(T('de', 'rp_code_ph'))).toBe(input)
    expect(input).toHaveValue('AB12CD34')
    // Foaia nu se deschide peste anulare.
    expect(screen.queryByTestId('sheet')).toBeNull()
  })

  it('RPL4 browser nesuportat → limba de BAZĂ a localului, nu engleza', async () => {
    setNavigator('language', 'pl-PL')
    fetchRestaurantBySlugMock.mockResolvedValue({ ...RESTAURANT, language: 'fr' })
    open(`/rezervare/${SLUG}`)

    expect(await screen.findByText(T('fr', 'rp_tagline'))).toBeInTheDocument()
    expect(await screen.findByTestId('sheet')).toHaveAttribute('data-lang', 'fr')
    const labels = within(heroGroup('fr')).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(labels[0]).toBe('Français')
    expect(labels).toHaveLength(7)
  })

  it('RPL5 Googlebot (în en-US) primește baza localului', async () => {
    setNavigator('language', 'en-US')
    setNavigator(
      'userAgent',
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    )
    open(`/rezervare/${SLUG}`)

    expect(await screen.findByText(T('ro', 'rp_tagline'))).toBeInTheDocument()
    expect(await screen.findByTestId('sheet')).toHaveAttribute('data-lang', 'ro')
  })

  it('RPL6 „Vezi meniul” deschide meniul în limba paginii', async () => {
    const user = userEvent.setup()
    setNavigator('language', 'ro-RO')
    const navigate = open(`/rezervare/${SLUG}?cancel=AB12CD34`)

    await screen.findByText(T('ro', 'rp_tagline'))
    await user.click(within(heroGroup('ro')).getByRole('button', { name: 'Deutsch' }))
    await user.click(screen.getByRole('button', { name: T('de', 'rp_view_menu') }))

    expect(navigate).toHaveBeenCalledWith(`/m/${SLUG}?lang=de`)
  })
})

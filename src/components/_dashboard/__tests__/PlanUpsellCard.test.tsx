// PlanUpsellCard — upsell-ul UNIC al panoului (lotul P, nov 2026).
//
//   UP1  'ordering' → titlul e numele planului din PLAN_LABELS („Meniu +
//        Comenzi") și exact trei beneficii, fără nimic fiscal (Planul 1 nu
//        trebuie să afle de bon ca să vrea comenzi).
//        Mutația care pică: un nume de plan scris de mână sau o a patra linie.
//   UP2  'payments' → „Plata la masă", planul-țintă din PLAN_LABELS.pro, trei
//        beneficii (plata din telefon, bonul automat, raportarea).
//   UP3  „Vezi planul" cheamă navigarea primită (un singur buton).
// Unde apare cardul (doar Acasă, doar proprietarul, doar cu țintă) păzesc
// HU1–HU4 din HomeTab.test.tsx.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlanUpsellCard } from '../PlanUpsellCard'
import { PLAN_LABELS } from '../../../lib/constants'

describe('PlanUpsellCard', () => {
  it('UP1: Planul 1 → „Meniu + Comenzi", trei beneficii, nimic fiscal', () => {
    render(<PlanUpsellCard target="ordering" onSeePlan={vi.fn()} />)
    const card = screen.getByRole('region')
    expect(within(card).getByRole('heading')).toHaveTextContent(PLAN_LABELS.growth)
    expect(within(card).getAllByRole('listitem')).toHaveLength(3)
    expect(card.textContent ?? '').not.toMatch(/\bTVA\b|fiscal|bon/i)
  })

  it('UP2: Planul 2 → „Plata la masă" pe planul Fiscalizare', () => {
    render(<PlanUpsellCard target="payments" onSeePlan={vi.fn()} />)
    const card = screen.getByRole('region', { name: 'Ofertă: Plata la masă' })
    expect(within(card).getByRole('heading')).toHaveTextContent('Plata la masă')
    expect(card).toHaveTextContent(PLAN_LABELS.pro)
    const items = within(card).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      'Oaspetele plătește din telefon',
      'Bonul fiscal se emite automat',
      'Încasările și TVA-ul se raportează singure',
    ])
  })

  it('UP3: „Vezi planul" cheamă navigarea primită', async () => {
    const onSeePlan = vi.fn()
    render(<PlanUpsellCard target="ordering" onSeePlan={onSeePlan} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Vezi planul' }))
    expect(onSeePlan).toHaveBeenCalledTimes(1)
  })
})

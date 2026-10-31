// Benzile de plan din panou (ux-owner-upgrade-banner, perf-staff-3).
//
//   FB1  banda planului gratuit: numele COMERCIAL, utilizarea reală, fără
//        „Upgrade la Pro" (id intern + plan greșit); butonul doar deschide planurile
//        Mutația care pică: textul vechi „Upgrade la Pro →" / „Plan Gratuit".
//   FB2  număr necunoscut → „…/15", fără bară de progres și fără „0/15"
//        Mutația care pică: `productCount ?? 0` (necunoscutul desenat ca 0).
//   FB3  la limită: bara de progres anunță valoarea reală
//   FB4  planul nu s-a încărcat: alertă cu „Reîncearcă" care cheamă reîncărcarea
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FreePlanBanner, PlanUnknownBanner } from '../PlanBanners'
import { PLAN_LABELS } from '../../../lib/constants'

describe('FreePlanBanner', () => {
  it('FB1: nume comercial, utilizarea reală, fără „Upgrade la Pro"', async () => {
    const onShowPlans = vi.fn()
    const { container } = render(
      <FreePlanBanner productCount={0} maxProducts={15} onShowPlans={onShowPlans} />,
    )
    expect(screen.getByText(PLAN_LABELS.free)).toBeInTheDocument()
    expect(screen.getByText('0/15 produse')).toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(/upgrade|\bpro\b|plan gratuit/i)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Vezi planurile →' }))
    expect(onShowPlans).toHaveBeenCalledTimes(1)
  })

  it('FB2: număr necunoscut → „…", fără bară de progres', () => {
    render(<FreePlanBanner productCount={null} maxProducts={15} onShowPlans={vi.fn()} />)
    expect(screen.getByText('…/15 produse')).toBeInTheDocument()
    expect(screen.queryByText('0/15 produse')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('FB3: la limită, bara de progres anunță valoarea reală', () => {
    render(<FreePlanBanner productCount={15} maxProducts={15} onShowPlans={vi.fn()} />)
    const bar = screen.getByRole('progressbar', { name: 'Produse folosite din plan' })
    expect(bar).toHaveAttribute('aria-valuenow', '15')
    expect(bar).toHaveAttribute('aria-valuemax', '15')
  })
})

describe('PlanUnknownBanner', () => {
  it('FB4: alertă cu „Reîncearcă" care cheamă reîncărcarea planului', async () => {
    const onRetry = vi.fn()
    render(<PlanUnknownBanner onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/nu am putut încărca planul/i)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

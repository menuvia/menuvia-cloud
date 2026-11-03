// Benzile de plan din panou (perf-staff-3).
//
//   FB4  planul nu s-a încărcat: alertă cu „Reîncearcă" care cheamă reîncărcarea
//
// FB1–FB3 păzeau banda planului gratuit din bara laterală (FreePlanBanner),
// scoasă în lotul P: upsell-ul e unul singur, pe Acasă — PlanUpsellCard, cu
// testele lui (UP1–UP3 în PlanUpsellCard.test.tsx, HU1–HU4 în HomeTab.test.tsx). Absența benzii din bara
// laterală o ține DS1 din DashboardSidebar.test.tsx.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlanUnknownBanner } from '../PlanBanners'

describe('PlanUnknownBanner', () => {
  it('FB4: alertă cu „Reîncearcă" care cheamă reîncărcarea planului', async () => {
    const onRetry = vi.fn()
    render(<PlanUnknownBanner onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/nu am putut încărca planul/i)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

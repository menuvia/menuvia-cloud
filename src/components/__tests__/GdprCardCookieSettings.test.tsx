// „Setări cookies” din panou (recenzie pe #385, MY-8). Până aici bannerul de
// cookies se redeschidea DOAR din subsolul paginilor legale (LegalFooter), deci
// personalul identificat în PostHog n-avea din panou cum să-și retragă acordul,
// deși politica (04 §4) promite o retragere la fel de ușoară ca acordarea.
// Cardul „Datele mele” (Setări → Abonament & cont) trimite acum același
// eveniment pe care îl ascultă CookieBanner. (Prefixul GC: verificat cu grep în
// src/ și tests/, nefolosit înainte.)
//   GC1  butonul trimite EXACT un `menuvia:open-cookie-settings`; controlul
//        pozitiv: nimic înainte de apăsare, iar ștergerea (alt buton al
//        cardului, refuzată în confirmare) nu-l trimite. Mutația care pică: butonul fără `onClick` sau
//        cu alt nume de eveniment.
//   GC2  cap-coadă, cu bannerul REAL: cu acordul deja salvat bannerul e ascuns
//        (control), apăsarea îl redeschide cu „Performanță” bifat, iar
//        debifarea + salvarea scrie retragerea în `menuvia_cookie_consent`.
//        Mutația care pică: numele evenimentului schimbat doar în card.
//   GC3  în germană: eticheta și descrierea din `settingsCards`, fără text
//        românesc (GQ7 din SettingsCardsLang.test.tsx verifică resturile pe tot
//        cardul). Mutația care pică: eticheta scrisă direct în componentă.
import { Suspense, type ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = () => b
  b.maybeSingle = () => Promise.resolve({ data: { deletion_requested_at: null }, error: null })
  return {
    supabase: {
      from: () => b,
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  }
})
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../ui/useToast', async (importOriginal) => {
  const api = {
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
    dismiss: () => {},
  }
  return { ...((await importOriginal()) as Record<string, unknown>), useToast: () => api }
})
vi.mock('../ui/confirm', () => ({ confirm: async () => false }))

import GdprCard from '../GdprCard'
import CookieBanner from '../CookieBanner'
import { preloadNamespace } from '../../i18n/core'
import { settingsCardsNs } from '../../i18n/ns/settingsCards'
import { commonNs } from '../../i18n/ns/common'
import cardsDe from '../../i18n/ns/settingsCards/de'
import { UiLangScope } from '../../i18n/UiLangContext'

const EVENT = 'menuvia:open-cookie-settings'
const CONSENT_KEY = 'menuvia_cookie_consent'

beforeAll(async () => {
  await Promise.all([preloadNamespace(settingsCardsNs, 'de'), preloadNamespace(commonNs, 'de')])
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function inSuspense(node: ReactNode) {
  return <Suspense fallback={null}>{node}</Suspense>
}

describe('GdprCard — „Setări cookies” din panou', () => {
  it('GC1 butonul trimite exact un eveniment de redeschidere a bannerului', async () => {
    const user = userEvent.setup()
    const seen = vi.fn()
    window.addEventListener(EVENT, seen)
    try {
      render(inSuspense(<GdprCard />))
      const btn = screen.getByRole('button', { name: 'Setări cookies' })
      expect(seen).not.toHaveBeenCalled()
      // Control: alt buton al cardului (ștergerea, refuzată în confirmare) nu
      // redeschide bannerul.
      const del = screen.getByRole('button', { name: 'Șterge contul' })
      await waitFor(() => expect(del).toBeEnabled())
      await user.click(del)
      expect(seen).not.toHaveBeenCalled()
      await user.click(btn)
      expect(seen).toHaveBeenCalledTimes(1)
      expect(
        screen.getByText(/^Statisticile de utilizare \(PostHog\) și raportarea erorilor \(Sentry\)/),
      ).toBeInTheDocument()
    } finally {
      window.removeEventListener(EVENT, seen)
    }
  })

  it('GC2 cu bannerul real: redeschis cu acordul salvat, iar retragerea se salvează', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ necessary: true, performance: true, functional: false, timestamp: 1 }),
    )
    render(
      inSuspense(
        <>
          <GdprCard />
          <CookieBanner />
        </>,
      ),
    )
    // Control: cu acordul deja dat, bannerul nu apare singur.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Setări cookies' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    const perf = screen.getByRole('checkbox', { name: /^Performanță/ })
    expect(perf).toBeChecked()
    await user.click(perf)
    await user.click(screen.getByRole('button', { name: 'Salvează preferințele' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const saved = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '{}') as { performance?: boolean }
    expect(saved.performance).toBe(false)
  })

  it('GC3 în germană: textele din dicționar, nu din componentă', async () => {
    render(
      <UiLangScope lang="de">
        {inSuspense(<GdprCard />)}
      </UiLangScope>,
    )
    expect(await screen.findByRole('button', { name: cardsDe.gdpr_cookies })).toBeInTheDocument()
    expect(screen.getByText(/^Nutzungsstatistik \(PostHog\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Setări cookies' })).not.toBeInTheDocument()
  })
})

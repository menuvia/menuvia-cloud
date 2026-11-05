// Hook-ul ecranelor personalului (lotul L0b).
//   UT1  fără provider: româna, sincron — testele cu text românesc rămân la fel.
//   UT2  franceză: ecranul SUSPENDĂ până sosește dicționarul (spinner-ul
//        Suspense), apoi apare direct în franceză — niciun cadru în română.
//        [PICĂ: fallback pe română cât se încarcă]
//   UT3  namespace fără fișier în limba cerută: textul în engleză, formatele
//        (data) în limba utilizatorului.
//   UT4  provider-ul fără `lang` impus: azi doar româna e activă, deci un cont
//        cu `ui_language: 'fr'` vede tot româna (fundația e invizibilă).
import { describe, it, expect, vi } from 'vitest'
import { Suspense } from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { ui_language: 'fr' } }),
}))

import { UiLangProvider } from '../UiLangContext'
import { useT } from '../useT'
import { commonNs } from '../ns/common'
import { defineNamespace, type Translation } from '../core'

function Save() {
  const { t, tp } = useT(commonNs)
  return (
    <p>
      {t('save')} · {tp('items_count', 3)}
    </p>
  )
}

describe('useT', () => {
  it('UT1 fără provider: română sincronă', () => {
    render(<Save />)
    expect(screen.getByText('Salvează · 3 produse')).toBeTruthy()
  })

  it('UT2 franceză: suspendă, apoi direct în franceză', async () => {
    render(
      <UiLangProvider lang="fr" enabled={['ro', 'fr']}>
        <Suspense fallback={<p>spinner</p>}>
          <Save />
        </Suspense>
      </UiLangProvider>,
    )
    expect(screen.getByText('spinner')).toBeTruthy()
    expect(screen.queryByText(/Salvează/)).toBeNull()
    expect(await screen.findByText('Enregistrer · 3 produits')).toBeTruthy()
  })

  it('UT3 fără fișier fr: text englezesc, data în franceză', async () => {
    const ro = { when: 'La {d}' }
    const en: Translation<typeof ro> = { when: 'On {d}' }
    const ns = defineNamespace('ut3', ro, { en: () => Promise.resolve({ default: en }) })
    function When() {
      const { t, fmt, lang } = useT(ns)
      return <p>{`${lang}: ${t('when', { d: fmt.date('2026-09-04T21:30:00Z', 'Europe/Paris') })}`}</p>
    }
    render(
      <UiLangProvider lang="fr" enabled={['ro', 'fr']}>
        <Suspense fallback={<p>…</p>}>
          <When />
        </Suspense>
      </UiLangProvider>,
    )
    expect(await screen.findByText('en: On 04/09/2026')).toBeTruthy()
  })

  it('UT4 azi doar româna e activă, oricare ar fi alegerea contului', () => {
    render(
      <UiLangProvider>
        <Save />
      </UiLangProvider>,
    )
    expect(screen.getByText('Salvează · 3 produse')).toBeTruthy()
  })
})

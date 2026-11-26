// Hook-ul ecranelor personalului (lotul L0b).
//   UT1  fără provider: româna, sincron — testele cu text românesc rămân la fel.
//   UT2  franceză: ecranul SUSPENDĂ până sosește dicționarul (spinner-ul
//        Suspense), apoi apare direct în franceză — niciun cadru în română.
//        [PICĂ: fallback pe română cât se încarcă]
//   UT3  namespace fără fișier în limba cerută: textul în engleză, formatele
//        (data) în limba utilizatorului.
//   UT4  provider-ul fără `lang` impus, din activarea limbilor: un cont cu
//        `ui_language: 'fr'` vede franceza (după Suspense, fără cadru în
//        română); un cont fără limbă urmează browserul (en-US → engleza); un
//        cont în română rămâne în română cu browserul în engleză (decizia
//        fondatorului pentru conturile existente). Mutația care pică:
//        `ENABLED_STAFF_LANGS` readus la `['ro']`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Suspense } from 'react'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ profileLang: 'fr' as string | null }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: h.profileLang === null ? null : { ui_language: h.profileLang } }),
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

  afterEach(() => {
    h.profileLang = 'fr'
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('UT4 contul în franceză vede franceza; fără limbă, browserul; contul român rămâne român', async () => {
    const tree = () =>
      render(
        <UiLangProvider>
          <Suspense fallback={<p>…</p>}>
            <Save />
          </Suspense>
        </UiLangProvider>,
      )
    const fr = tree()
    expect(await screen.findByText('Enregistrer · 3 produits')).toBeTruthy()
    fr.unmount()

    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
    window.localStorage.clear()
    h.profileLang = null
    const en = tree()
    expect(await screen.findByText('Save · 3 items')).toBeTruthy()
    en.unmount()

    window.localStorage.clear()
    h.profileLang = 'ro'
    tree()
    expect(screen.getByText('Salvează · 3 produse')).toBeTruthy()
  })
})

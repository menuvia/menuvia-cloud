// Limba personalului urmează NAVIGAREA și contul (precondițiile activării
// limbilor). (Prefixul LR: verificat cu grep în src/, tests/, e2e/, supabase/,
// docs și CLAUDE.md, nefolosit înainte.)
//   LR1  `?lang=` se RECITEȘTE la fiecare navigare: butonul de login de pe
//        landing duce la /auth?lang=ro, iar după `replace('/dashboard')` un
//        cont salvat în engleză vede panoul în engleză, fără reîncărcare
//        (ROUTE_CHANGE_EVENT); Back/Forward (`popstate`) la fel.
//        Mutația care pică: `readUrlLang()` citit doar în memo (deps fără ruta).
//   LR2  limba CONTULUI se copiază PE CONT (`menuvia_ui_lang_acct:<uid>`), iar
//        cât profilul se încarcă, rezolvarea o folosește pentru acel cont —
//        primele cadre sunt deja în limba lui; preferința DISPOZITIVULUI
//        (`menuvia_ui_lang`, citită și de funnel) NU se atinge (recenzia
//        adversarială pe #388); copia altui cont nu se aplică. Mutațiile care
//        pică: copia scrisă în `menuvia_ui_lang`; copia citită fără uid.
//   LR3  profilul NU e în memorie (copia contului = română) și reîncărcarea
//        de după salvare pică: limba aleasă rămâne pe ecran — salvarea scrie
//        copia pe cont și o anunță, iar providerul o recitește fără să aștepte
//        profilul (recenzia CodeRabbit pe #388). Cu salvarea și comutatorul
//        REALE (`useSetUiLanguage`), doar Supabase și contul simulate.
//        Mutațiile care pică: copia pe cont nescrisă la salvare; providerul
//        fără ascultătorul ACCOUNT_LANG_EVENT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Suspense } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  profileLang: null as string | null,
  uid: null as string | null,
  profileLoaded: true,
  refreshes: 0,
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: h.uid ? { id: h.uid } : null,
    profile: !h.profileLoaded || h.profileLang === null ? null : { id: h.uid ?? 'u1', ui_language: h.profileLang },
    // Reîncărcarea „pică”: profilul rămâne cum era (null în LR3).
    refreshProfile: async () => {
      h.refreshes += 1
    },
    activeUserId: () => h.uid,
  }),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: () => ({
        eq: (_col: string, id: string) => ({
          select: async () => ({ data: [{ id }], error: null }),
        }),
      }),
    }),
  },
}))

import { UiLangProvider, useUiLang } from '../UiLangContext'
import { useSetUiLanguage } from '../useSetUiLanguage'
import { ROUTE_CHANGE_EVENT } from '../../lib/routeEvents'

function Show() {
  return <p data-testid="lang">{useUiLang().lang}</p>
}
const lang = () => screen.getByTestId('lang').textContent

beforeEach(() => {
  window.localStorage.clear()
  h.profileLang = null
  h.uid = null
  h.profileLoaded = true
  h.refreshes = 0
})
afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('limba personalului urmează navigarea și contul', () => {
  it('LR1 `?lang=` se recitește la navigare (ROUTE_CHANGE_EVENT și popstate)', () => {
    h.profileLang = 'en'
    window.history.replaceState(null, '', '/auth?lang=ro')
    render(
      <UiLangProvider enabled={['ro', 'en']}>
        <Show />
      </UiLangProvider>,
    )
    // Linkul bate contul cât timp e în adresă.
    expect(lang()).toBe('ro')
    act(() => {
      window.history.replaceState(null, '', '/dashboard')
      window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT))
    })
    expect(lang()).toBe('en')
    // Back/Forward: popstate.
    act(() => {
      window.history.replaceState(null, '', '/dashboard?lang=ro')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(lang()).toBe('ro')
    // Control: o limbă inactivă în adresă se sare (contul decide).
    act(() => {
      window.history.replaceState(null, '', '/dashboard?lang=de')
      window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT))
    })
    expect(lang()).toBe('en')
  })

  it('LR2 copia limbii e pe cont și servește doar acelui cont, cât profilul se încarcă', () => {
    const tree = () =>
      render(
        <UiLangProvider enabled={['ro', 'en']}>
          <Show />
        </UiLangProvider>,
      )
    // Dispozitivul ales pe engleză (/en); contul A e în română (mig 323).
    window.localStorage.setItem('menuvia_ui_lang', 'en')
    h.uid = 'uA'
    h.profileLang = 'ro'
    const a = tree()
    expect(lang()).toBe('ro')
    expect(window.localStorage.getItem('menuvia_ui_lang_acct:uA')).toBe('ro')
    // Preferința dispozitivului rămâne cea aleasă (funnel-ul o citește după ieșire).
    expect(window.localStorage.getItem('menuvia_ui_lang')).toBe('en')
    a.unmount()

    // Deschiderea următoare a lui A: profilul încă nu a sosit → copia contului.
    h.profileLoaded = false
    const again = tree()
    expect(lang()).toBe('ro')
    again.unmount()

    // Alt cont (B), fără copie, profil neîncărcat: copia lui A nu se aplică.
    h.uid = 'uB'
    tree()
    expect(lang()).toBe('en')
  })

  it('LR3 profil neîncărcat + reîncărcare picată → limba aleasă rămâne pe ecran', async () => {
    function Pick() {
      const { choose } = useSetUiLanguage()
      return (
        <button type="button" onClick={() => void choose('en')}>
          pick
        </button>
      )
    }
    // Contul A e în română (copia lui), profilul nu a sosit.
    h.uid = 'uA'
    h.profileLoaded = false
    window.localStorage.setItem('menuvia_ui_lang_acct:uA', 'ro')
    render(
      <UiLangProvider enabled={['ro', 'en']}>
        <Show />
        <Suspense fallback={null}>
          <Pick />
        </Suspense>
      </UiLangProvider>,
    )
    expect(lang()).toBe('ro')
    await userEvent.setup().click(await screen.findByRole('button', { name: 'pick' }))
    await waitFor(() => expect(h.refreshes).toBe(1))
    // Profilul e tot null, dar ecranul a trecut pe alegere și rămâne acolo.
    expect(lang()).toBe('en')
    expect(window.localStorage.getItem('menuvia_ui_lang_acct:uA')).toBe('en')
  })
})

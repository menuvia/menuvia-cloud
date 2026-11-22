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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  profileLang: null as string | null,
  uid: null as string | null,
  profileLoaded: true,
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: h.uid ? { id: h.uid } : null,
    profile: !h.profileLoaded || h.profileLang === null ? null : { id: h.uid ?? 'u1', ui_language: h.profileLang },
  }),
}))

import { UiLangProvider, useUiLang } from '../UiLangContext'
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
})

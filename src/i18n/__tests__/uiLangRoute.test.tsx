// Limba personalului urmează NAVIGAREA și contul (precondițiile activării
// limbilor). (Prefixul LR: verificat cu grep în src/, tests/, e2e/, supabase/,
// docs și CLAUDE.md, nefolosit înainte.)
//   LR1  `?lang=` se RECITEȘTE la fiecare navigare: butonul de login de pe
//        landing duce la /auth?lang=ro, iar după `replace('/dashboard')` un
//        cont salvat în engleză vede panoul în engleză, fără reîncărcare
//        (ROUTE_CHANGE_EVENT); Back/Forward (`popstate`) la fel.
//        Mutația care pică: `readUrlLang()` citit doar în memo (deps fără ruta).
//   LR2  limba CONTULUI devine și preferința DISPOZITIVULUI (`menuvia_ui_lang`),
//        ca la deschiderea următoare primele cadre (dinaintea profilului) să
//        fie deja în limba contului; fără limbă în cont, stocarea nu se atinge.
//        Mutația care pică: efectul de copiere scos.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ profileLang: null as string | null }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: h.profileLang === null ? null : { ui_language: h.profileLang } }),
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

  it('LR2 limba contului se copiază pe dispozitiv; fără ea, stocarea rămâne neatinsă', () => {
    const none = render(
      <UiLangProvider enabled={['ro', 'en']}>
        <Show />
      </UiLangProvider>,
    )
    expect(window.localStorage.getItem('menuvia_ui_lang')).toBeNull()
    none.unmount()
    h.profileLang = 'en'
    render(
      <UiLangProvider enabled={['ro', 'en']}>
        <Show />
      </UiLangProvider>,
    )
    expect(window.localStorage.getItem('menuvia_ui_lang')).toBe('en')
    expect(lang()).toBe('en')
  })
})

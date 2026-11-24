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
//   LR4  același caz cu localStorage care ARUNCĂ (Safari „Block All
//        Cookies”): alegerea rămâne pe ecran din copia din memoria tab-ului.
//        Mutația care pică: copia doar în localStorage.
//   LR6  bază fără mig 323 (`ui_language_missing`): panoul e în română chiar
//        cu browserul în germană, iar 'ro'-ul intră și în copia pe cont, deci
//        o deschidere ulterioară cu profilul încă pe drum (și dispozitivul pe
//        engleză) rămâne pe română; funnel-ul (onboarding, autentificare)
//        ignoră semnalul și urmează limba aleasă pe dispozitiv — un englez
//        înscris pe o bază veche nu-și mai face onboarding-ul în română
//        (recenzia adversarială a activării). Mutațiile care pică: semnalul
//        ignorat în UiLangProvider (panoul pe germană); copia derivată doar
//        din `ui_language` (nescrisă pe bază veche). Varianta „'ro' scris
//        direct în `ui_language`” o prinde AU2 (aici contul e simulat).
//   LR7  tab rămas „fără coloană” peste aplicarea mig 323 (`ui_language_missing`,
//        dar copia pe cont are deja limba REALĂ a contului, 'de'): panoul e în
//        germană, iar copia NU e suprascrisă cu 'ro'-ul dedus (a patra rundă
//        de recenzie). Mutația care pică: 'ro' necondiționat pe semnal.
//   LR5  cont logat, profil neîncărcat (sau încărcare picată) și fără copie pe
//        cont: limba lui e NECUNOSCUTĂ, nu a browserului — un cont român pe un
//        browser în germană rămâne pe site (română), nu trece pe germană
//        (recenzia adversarială a activării). Control: fără cont și cu un
//        profil încărcat FĂRĂ limbă, browserul decide. Mutația care pică:
//        `navigatorLangs` trimis și pentru contul în așteptare.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Suspense } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  profileLang: null as string | null,
  uid: null as string | null,
  profileLoaded: true,
  refreshes: 0,
  // Profil ÎNCĂRCAT, dar fără limbă salvată (cont creat fără metadata).
  loadedWithoutLang: false,
  // Profil încărcat de pe o bază FĂRĂ coloana mig 323.
  columnMissing: false,
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: h.uid ? { id: h.uid } : null,
    profile: !h.profileLoaded
      ? null
      : h.columnMissing
        ? { id: h.uid ?? 'u1', ui_language: null, ui_language_missing: true }
        : h.loadedWithoutLang
          ? { id: h.uid ?? 'u1', ui_language: null }
          : h.profileLang === null
            ? null
            : { id: h.uid ?? 'u1', ui_language: h.profileLang },
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

import { FunnelLangProvider, UiLangProvider, useUiLang } from '../UiLangContext'
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
  h.loadedWithoutLang = false
  h.columnMissing = false
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

  it('LR4 localStorage care aruncă: alegerea rămâne pe ecran din memoria tab-ului', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    try {
      function Pick({ to }: { to: string }) {
        const { choose } = useSetUiLanguage()
        return (
          <button type="button" onClick={() => void choose(to)}>
            pick
          </button>
        )
      }
      // Cont propriu (copia din memorie e pe cont), profil neîncărcat; limba de
      // pornire vine din browser — se alege cealaltă.
      h.uid = 'uStorageBlocked'
      h.profileLoaded = false
      const tree = (to: string) =>
        render(
          <UiLangProvider enabled={['ro', 'en']}>
            <Show />
            <Suspense fallback={null}>
              <Pick to={to} />
            </Suspense>
          </UiLangProvider>,
        )
      const probe = tree('ro')
      const before = lang()
      probe.unmount()
      const target = before === 'ro' ? 'en' : 'ro'
      tree(target)
      expect(lang()).toBe(before)
      await userEvent.setup().click(await screen.findByRole('button', { name: 'pick' }))
      await waitFor(() => expect(h.refreshes).toBe(1))
      expect(lang()).toBe(target)
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('LR5 contul cu profilul neîncărcat nu urmează browserul', () => {
    const langs = vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-DE', 'de'])
    try {
      const tree = () =>
        render(
          <UiLangProvider enabled={['ro', 'en', 'fr', 'de']}>
            <Show />
          </UiLangProvider>,
        )
      // Control: fără cont, browserul decide.
      const anon = tree()
      expect(lang()).toBe('de')
      anon.unmount()
      // Cont logat, profilul încă pe drum, fără copie pe cont: site-ul (română).
      h.uid = 'uPending'
      h.profileLoaded = false
      const pending = tree()
      expect(lang()).toBe('ro')
      pending.unmount()
      // Control: profilul a sosit FĂRĂ limbă salvată → browserul decide.
      h.profileLoaded = true
      h.loadedWithoutLang = true
      tree()
      expect(lang()).toBe('de')
    } finally {
      langs.mockRestore()
    }
  })

  it('LR6 bază fără mig 323: panoul în română, funnel-ul pe limba dispozitivului', () => {
    const langs = vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-DE', 'de'])
    try {
      h.uid = 'uOld'
      h.columnMissing = true
      // Panoul: contul „existent” e român, browserul nu contează.
      const staff = render(
        <UiLangProvider enabled={['ro', 'en', 'fr', 'de']}>
          <Show />
        </UiLangProvider>,
      )
      expect(lang()).toBe('ro')
      // 'ro'-ul bazei vechi intră și în copia pe cont (o citește doar panoul).
      expect(window.localStorage.getItem('menuvia_ui_lang_acct:uOld')).toBe('ro')
      staff.unmount()
      // Deschiderea următoare: profilul încă pe drum, dispozitivul pe engleză —
      // copia ține panoul pe română.
      window.localStorage.setItem('menuvia_ui_lang', 'en')
      h.profileLoaded = false
      const reopen = render(
        <UiLangProvider enabled={['ro', 'en', 'fr', 'de']}>
          <Show />
        </UiLangProvider>,
      )
      expect(lang()).toBe('ro')
      reopen.unmount()
      h.profileLoaded = true
      // Funnel-ul: dispozitivul ales pe engleză (/en) decide, nu semnalul.
      render(
        <FunnelLangProvider>
          <Show />
        </FunnelLangProvider>,
      )
      expect(lang()).toBe('en')
    } finally {
      langs.mockRestore()
    }
  })

  it('LR7 semnalul de bază veche nu bate copia cu limba reală a contului', () => {
    h.uid = 'uSwitched'
    h.columnMissing = true
    window.localStorage.setItem('menuvia_ui_lang_acct:uSwitched', 'de')
    render(
      <UiLangProvider enabled={['ro', 'en', 'fr', 'de']}>
        <Show />
      </UiLangProvider>,
    )
    expect(lang()).toBe('de')
    expect(window.localStorage.getItem('menuvia_ui_lang_acct:uSwitched')).toBe('de')
  })
})

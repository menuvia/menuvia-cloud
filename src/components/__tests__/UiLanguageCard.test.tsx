// Comutatorul „Limba interfeței” din Setări → Abonament & cont (lotul L3b).
// Prefixul e UC, nu UL: UL1–UL5 sunt deja asserțiile SQL ale coloanei
// (`tests/sql/auto/323_profile_ui_language.sql`).
//   UC1  o singură limbă activă → cardul NU se randează deloc; fără provider
//        (valoarea implicită a contextului = `ENABLED_STAFF_LANGS`, toate patru
//        din activarea limbilor) cardul APARE, în română, cu cele patru limbi.
//        Mutațiile care pică: garda `enabled.length < 2` scoasă (comutatorul
//        ar apărea cu o singură opțiune) și `ENABLED_STAFF_LANGS` readus la
//        `['ro']` (cardul ar dispărea fără provider).
//   UC2  patru limbi active, interfața în franceză: select-ul cu numele
//        accesibil din dicționar, limba curentă aleasă, fiecare limbă în limba
//        EI și cu `lang` propriu; UC2b: în română, „Limba interfeței”.
//   UC3  alegerea unei limbi: UPDATE pe `profiles` cu `{ ui_language }`, pe
//        id-ul contului; select-ul e dezactivat cât se salvează; stocarea
//        locală e scrisă ÎNAINTE de `refreshProfile()`, chemat o dată.
//        Mutații care pică: `refreshProfile` uitat, stocarea scrisă după
//        reîncărcare, select-ul activ în timpul salvării.
//   UC4  serverul refuză → `role="alert"` cu textul de rezervă, stocarea NU e
//        scrisă, profilul nu se reîncarcă, select-ul revine pe limba de dinainte.
//        Mutația care pică: stocarea scrisă înaintea verificării erorii.
//   UC5  42703 (coloana mig 323 lipsește — clientul înaintea migrației) →
//        mesajul propriu, nu cel generic.
//   UC6  zero rânduri actualizate (UPDATE refuzat de RLS, 200 fără eroare) →
//        eroare de drepturi, nu „salvat”. Mutația care pică: `.select` /
//        `zeroRowsAsDenied` scoase.
//   UC7  stocarea ARUNCĂ (Safari „Block All Cookies”) → limba se salvează
//        oricum în cont, fără alertă. Mutația care pică: try/catch scos.
//   UC8  în germană: textele cardului din dicționar, numele limbilor rămân
//        fiecare în limba lui.
//   UC9  (activarea limbilor) după o salvare reușită: `?lang=` iese din adresă
//        (restul parametrilor rămân), ruta se anunță (ROUTE_CHANGE_EVENT), iar
//        limba intră și în `user_metadata.ui_lang` (șabloanele Supabase Auth).
//        Pe eroare, nici adresa, nici metadata nu se ating. Mutațiile care
//        pică: `dropUrlLang` / `syncAuthMetadata` scoase.
//   UC10 „aceeași limbă” se judecă față de CONT: un cont fără limbă salvată
//        care vede ecranul în franceză își poate salva franceza; un cont deja
//        pe franceză, pe ecranul în franceză, nu face nicio cerere. Mutația
//        care pică: garda veche `raw === lang`.
//   UC11 limba salvată intră în profilul din MEMORIE înaintea reîncărcării
//        (`applyProfileLanguage`, cu id-ul contului care a PORNIT salvarea):
//        dacă `refreshProfile` pică, ecranul rămâne pe alegere (recenzia
//        CodeRabbit pe #388). Mutațiile care pică: apelul scos sau mutat după
//        `refreshProfile`; id-ul contului omis.
import { Suspense } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

type UpdateResult = {
  data: { id: string }[] | null
  error: { code?: string; message: string } | null
}

const h = vi.hoisted(() => ({
  calls: [] as string[],
  authCalls: [] as string[],
  profileLang: null as string | null,
  result: { data: [{ id: 'u1' }], error: null } as UpdateResult,
  hold: null as Promise<void> | null,
  storedAtRefresh: [] as (string | null)[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: (p: unknown) => {
        h.authCalls.push(JSON.stringify(p))
        return Promise.resolve({ data: {}, error: null })
      },
    },
    from: (table: string) => ({
      update: (payload: unknown) => {
        h.calls.push(`update:${table}:${JSON.stringify(payload)}`)
        return {
          eq: (col: string, val: string) => {
            h.calls.push(`eq:${col}:${val}`)
            return {
              select: async (cols: string) => {
                h.calls.push(`select:${cols}`)
                if (h.hold) await h.hold
                return h.result
              },
            }
          },
        }
      },
    }),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    profile: { ui_language: h.profileLang },
    applyProfileLanguage: (l: string, accountId: string) => {
      h.calls.push(`apply:${l}:${accountId}`)
    },
    refreshProfile: async () => {
      h.calls.push('refreshProfile')
      h.storedAtRefresh.push(window.localStorage.getItem('menuvia_ui_lang'))
    },
  }),
}))

import UiLanguageCard from '../UiLanguageCard'
import { useSetUiLanguage } from '../../i18n/useSetUiLanguage'
import { ROUTE_CHANGE_EVENT } from '../../lib/routeEvents'
import { UiLangScope } from '../../i18n/UiLangContext'
import { preloadNamespace } from '../../i18n/core'
import { dashboardNs } from '../../i18n/ns/dashboard'
import { commonNs } from '../../i18n/ns/common'
import type { StaffLang } from '../../i18n/langs'

const ALL: readonly StaffLang[] = ['ro', 'en', 'fr', 'de']
const NAMES = ['Română', 'English', 'Français', 'Deutsch']

beforeAll(async () => {
  const langs: StaffLang[] = ['fr', 'de']
  await Promise.all(
    langs.flatMap((l) => [preloadNamespace(dashboardNs, l), preloadNamespace(commonNs, l)]),
  )
})

beforeEach(() => {
  h.calls = []
  h.authCalls = []
  h.profileLang = null
  h.result = { data: [{ id: 'u1' }], error: null }
  h.hold = null
  h.storedAtRefresh = []
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderCard(lang: StaffLang, enabled: readonly StaffLang[]) {
  return render(
    <UiLangScope lang={lang} enabled={enabled}>
      <Suspense fallback={null}>
        <UiLanguageCard />
      </Suspense>
    </UiLangScope>,
  )
}

const select = () => screen.getByRole('combobox', { name: 'Limba interfeței' }) as HTMLSelectElement

describe('UiLanguageCard — limba interfeței', () => {
  it('UC1: o singură limbă activă → nimic randat; fără provider → cele patru limbi', () => {
    const scoped = renderCard('ro', ['ro'])
    expect(scoped.container.textContent).toBe('')
    expect(screen.queryByRole('combobox')).toBeNull()
    scoped.unmount()
    // Fără provider = valoarea implicită a contextului: din activarea limbilor,
    // `ENABLED_STAFF_LANGS` are toate patru, deci cardul apare, în română.
    render(<UiLanguageCard />)
    const sel = select()
    expect(sel.value).toBe('ro')
    expect((within(sel).getAllByRole('option') as HTMLOptionElement[]).map((o) => o.textContent)).toEqual(NAMES)
  })

  it('UC2: patru limbi → select-ul cu limba curentă și numele în limba lor', () => {
    renderCard('fr', ALL)
    const sel = screen.getByRole('combobox', { name: 'Langue de l’interface' }) as HTMLSelectElement
    expect(sel.value).toBe('fr')
    const opts = within(sel).getAllByRole('option') as HTMLOptionElement[]
    expect(opts.map((o) => o.textContent)).toEqual(NAMES)
    expect(opts.map((o) => o.lang)).toEqual([...ALL])
  })

  it('UC2b: în română, numele accesibil e „Limba interfeței”', () => {
    renderCard('ro', ALL)
    expect(select().value).toBe('ro')
    expect(screen.getByRole('heading', { name: 'Limba interfeței' })).toBeInTheDocument()
  })

  it('UC3: alegerea scrie în profil, apoi local, apoi reîncarcă profilul', async () => {
    let release: () => void = () => {}
    h.hold = new Promise<void>((r) => {
      release = r
    })
    renderCard('ro', ALL)
    await userEvent.setup().selectOptions(select(), 'en')
    expect(h.calls).toEqual(['update:profiles:{"ui_language":"en"}', 'eq:id:u1', 'select:id'])
    // Cât se salvează: select-ul arată alegerea și e dezactivat.
    expect(select()).toBeDisabled()
    expect(select().value).toBe('en')
    expect(screen.getByRole('status')).toHaveTextContent('Se salvează…')
    release()
    await waitFor(() => expect(h.calls).toContain('refreshProfile'))
    expect(h.calls.filter((c) => c === 'refreshProfile')).toHaveLength(1)
    expect(h.storedAtRefresh).toEqual(['en'])
    await waitFor(() => expect(select()).not.toBeDisabled())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('UC4: refuzul serverului → alertă, fără stocare și fără reîncărcare', async () => {
    h.result = { data: null, error: { code: 'XX000', message: 'boom' } }
    renderCard('ro', ALL)
    await userEvent.setup().selectOptions(select(), 'de')
    expect(await screen.findByRole('alert')).toHaveTextContent('Limba nu s-a putut salva. Reîncearcă.')
    expect(window.localStorage.getItem('menuvia_ui_lang')).toBeNull()
    expect(h.calls).not.toContain('refreshProfile')
    expect(select().value).toBe('ro')
    expect(select()).not.toBeDisabled()
  })

  it('UC5: 42703 (coloana lipsește) → mesajul despre actualizarea serverului', async () => {
    h.result = { data: null, error: { code: '42703', message: 'column "ui_language" does not exist' } }
    renderCard('ro', ALL)
    await userEvent.setup().selectOptions(select(), 'fr')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('serverul nu are ultima actualizare')
    expect(alert).not.toHaveTextContent('Limba nu s-a putut salva')
    expect(window.localStorage.getItem('menuvia_ui_lang')).toBeNull()
    expect(h.calls).not.toContain('refreshProfile')
  })

  it('UC6: zero rânduri actualizate → eroare de drepturi, nu „salvat”', async () => {
    h.result = { data: [], error: null }
    renderCard('ro', ALL)
    await userEvent.setup().selectOptions(select(), 'en')
    expect(await screen.findByRole('alert')).toHaveTextContent('Nu ai drepturi pentru această acțiune.')
    expect(window.localStorage.getItem('menuvia_ui_lang')).toBeNull()
    expect(h.calls).not.toContain('refreshProfile')
  })

  it('UC7: stocarea aruncă → limba se salvează în cont, fără alertă', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    renderCard('ro', ALL)
    await userEvent.setup().selectOptions(select(), 'en')
    await waitFor(() => expect(h.calls).toContain('refreshProfile'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('UC8: în germană — textele cardului traduse, numele limbilor neschimbate', () => {
    renderCard('de', ALL)
    const sel = screen.getByRole('combobox', { name: 'Sprache der Oberfläche' }) as HTMLSelectElement
    expect(sel.value).toBe('de')
    expect(screen.getByRole('heading', { name: 'Sprache der Oberfläche' })).toBeInTheDocument()
    expect((within(sel).getAllByRole('option') as HTMLOptionElement[]).map((o) => o.textContent)).toEqual(
      NAMES,
    )
    expect(document.body.textContent ?? '').not.toMatch(/Limba interfeței|panoului/)
  })

  it('UC9: după salvare, `?lang=` iese din adresă, ruta se anunță, metadata primește limba', async () => {
    window.history.replaceState(null, '', '/dashboard?lang=de&tab=billing')
    const routes = vi.fn()
    window.addEventListener(ROUTE_CHANGE_EVENT, routes)
    try {
      renderCard('ro', ALL)
      await userEvent.setup().selectOptions(select(), 'en')
      await waitFor(() => expect(h.calls).toContain('refreshProfile'))
      expect(window.location.pathname).toBe('/dashboard')
      expect(window.location.search).toBe('?tab=billing')
      expect(routes).toHaveBeenCalled()
      expect(h.authCalls).toEqual([JSON.stringify({ data: { ui_lang: 'en' } })])

      // Pe eroare: adresa și metadata rămân neatinse.
      window.history.replaceState(null, '', '/dashboard?lang=de')
      h.authCalls = []
      h.result = { data: null, error: { code: 'XX000', message: 'boom' } }
      await userEvent.setup().selectOptions(select(), 'fr')
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(window.location.search).toBe('?lang=de')
      expect(h.authCalls).toEqual([])
    } finally {
      window.removeEventListener(ROUTE_CHANGE_EVENT, routes)
      window.history.replaceState(null, '', '/')
    }
  })

  it('UC10: aceeași limbă se judecă față de cont, nu doar față de ecran', async () => {
    function Pick({ lang }: { lang: StaffLang }) {
      const s = useSetUiLanguage()
      return (
        <button type="button" onClick={() => void s.choose(lang)}>
          pick
        </button>
      )
    }
    const tree = (
      <UiLangScope lang="fr" enabled={ALL}>
        <Suspense fallback={null}>
          <Pick lang="fr" />
        </Suspense>
      </UiLangScope>
    )
    // Cont fără limbă salvată, ecran în franceză (browserul): franceza se salvează.
    const first = render(tree)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'pick' }))
    await waitFor(() => expect(h.calls).toContain('refreshProfile'))
    expect(h.calls[0]).toBe('update:profiles:{"ui_language":"fr"}')
    first.unmount()

    // Cont deja pe franceză, ecran în franceză: nicio cerere.
    h.calls = []
    h.profileLang = 'fr'
    render(tree)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'pick' }))
    expect(h.calls).toEqual([])
  })

  it('UC11: limba intră în profilul din memorie înaintea reîncărcării', async () => {
    renderCard('ro', ALL)
    await userEvent.setup().selectOptions(select(), 'de')
    await waitFor(() => expect(h.calls).toContain('refreshProfile'))
    // Legată de contul care a pornit salvarea (u1), nu de cel activ la final.
    const apply = h.calls.indexOf('apply:de:u1')
    expect(apply).toBeGreaterThan(-1)
    expect(apply).toBeLessThan(h.calls.indexOf('refreshProfile'))
  })
})

// Moneda meniului în Setări pe un restaurant cu bon fiscal (mig 334, lotul M1).
// Regula de aur: bani + bon fiscal = Planul 3, gate-uit în DATE — serverul
// impune RON la citire (proiecțiile anon) și la scriere (trigger, hint
// `fiscal_currency_ron_only`). Setările doar ARATĂ regula: pe un local din
// România cu bon fiscal doar RON e selectabil, textul nu mai pretinde că
// „fiscalizarea nu e afectată”, iar previzualizarea arată ce vede oaspetele.
// Mock-urile oglindesc SettingsTabPlan.test.tsx / SettingsLang.test.tsx; în
// plus, MenuPreview e un stub care își afișează moneda (`preview-<cod>`).
// (Prefixul FCS: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md, nefolosit înainte.)
//
//   FCS1 Planul 3 în România: valoarea e RON, orice altă monedă e
//        DEZACTIVATĂ (RON rămâne activă), descrierea spune de ce (bonul,
//        factura, plata online în lei) și NU mai spune că fiscalizarea „nu e
//        afectată”; fără notă de drift. Mutația care pică: `disabled` scos de
//        pe opțiuni, sau descrierea veche `cur_descPay` păstrată.
//   FCS2 control POZITIV pe Planul 2 (România): toate monedele active, EUR se
//        alege, previzualizarea o urmează, descrierea e cea generală. Mutația
//        care pică: lock-ul aplicat pe orice plan.
//   FCS3 drift (EUR salvat înainte de urcarea pe Planul 3): selectorul arată
//        EUR, nota o numește și spune că plata online rămâne oprită,
//        previzualizarea arată deja RON (ce vede oaspetele); alegerea RON
//        stinge nota, iar „Salvează” trimite `currency: 'RON'`. Mutația care
//        pică: selectorul dezactivat ÎNTREG (drift-ul n-ar mai putea fi
//        corectat), previzualizarea pe `form.currency` brut, sau nota scoasă.
//   FCS4 local din DE pe Planul 3 cu USD ales de mână, adus înapoi în România
//        din câmpul de țară: moneda devine RON în aceeași schimbare (serverul
//        ar refuza altfel salvarea — rândul NOU e în RO), iar celelalte monede
//        se dezactivează. Control: înainte de schimbare (DE) USD e activ.
//        Mutația care pică: `followCountryDefaults` singur (USD ales de mână ar
//        rămâne, iar salvarea ar pica pe server).
//   FCS5 refuzul serverului (hint `fiscal_currency_ron_only`): în română
//        EXACT mesajul românesc al serverului (ca `toUserMessage`, regula din
//        staffErrors); în engleză textul propriu al hint-ului, fără mesajul
//        românesc brut. Mutația care pică: hint-ul lipsă din `saveHints`
//        (engleza ar cădea pe rezerva generică).
import { Suspense, type ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'
import type { useRestaurantModules } from '../../hooks/useRestaurantModules'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/restaurants', () => ({ changeRestaurantSlug: vi.fn() }))
vi.mock('../VatRatesEditor', () => ({ default: () => null }))
vi.mock('../OnlinePaymentsCard', () => ({ default: () => null }))
vi.mock('../LoyaltySettingsCard', () => ({ default: () => null }))
vi.mock('../SmsNotificationsCard', () => ({ default: () => null }))
vi.mock('../MfaCard', () => ({ default: () => null }))
vi.mock('../GdprCard', () => ({ default: () => null }))
vi.mock('../UiLanguageCard', () => ({ default: () => null }))
vi.mock('../_dashboard/SubscriptionCard', () => ({ SubscriptionCard: () => null }))
// Previzualizarea își afișează moneda primită: ce ar vedea oaspetele.
vi.mock('../menu/MenuPreview', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ currency }: { currency?: string }) =>
      createElement('div', { 'data-testid': 'menu-preview' }, `preview-${currency ?? 'none'}`),
  }
})

import SettingsTab from '../SettingsTab'
import { preloadNamespace } from '../../i18n/core'
import { settingsNs } from '../../i18n/ns/settings'
import { settingsCardsNs } from '../../i18n/ns/settingsCards'
import { commonNs } from '../../i18n/ns/common'
import { translationsNs } from '../../i18n/ns/translations'
import { homeNs } from '../../i18n/ns/home'
import settingsRo from '../../i18n/ns/settings/ro'
import settingsEn from '../../i18n/ns/settings/en'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { SettingsSection } from '../../lib/dashboardNav'
import type { PlanSurface } from '../../lib/planSurface'
import { surfaceFor } from '../../lib/__tests__/planSurfaceFixtures'

beforeAll(async () => {
  await Promise.all([
    preloadNamespace(settingsNs, 'en'),
    preloadNamespace(settingsCardsNs, 'en'),
    preloadNamespace(commonNs, 'en'),
    preloadNamespace(translationsNs, 'en'),
    preloadNamespace(homeNs, 'en'),
  ])
})

function makeRestaurant(over: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'rest-1',
    owner_id: 'owner-1',
    name: 'Bistro Test',
    tagline: null,
    city: 'Sibiu',
    slug: 'bistro-test',
    description: null,
    address: null,
    phone: null,
    hours: null,
    primary_color: '#C8963C',
    logo_url: null,
    cover_url: null,
    is_active: true,
    floor_layout: null,
    socials: null,
    amenities: [],
    hours_structured: null,
    wifi_password: null,
    timezone: 'Europe/Bucharest',
    checkout_suggestion_settings: null,
    theme_settings: null,
    pickup_settings: null,
    google_place_id: null,
    google_review_url: null,
    menu_languages: [],
    currency: 'RON',
    country: 'RO',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...over,
  }
}

const modulesState = {
  modules: {},
  loading: false,
  loadError: false,
  isEnabled: () => false,
  setModule: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
} as unknown as ReturnType<typeof useRestaurantModules>

interface TabOpts {
  restaurant?: Restaurant
  surface: PlanSurface | null
  plan: string
  onUpdate?: (id: string, f: Partial<Restaurant>) => Promise<{ error: Error | null }>
}

const tab = (section: SettingsSection, o: TabOpts) => (
  <SettingsTab
    section={section}
    isOwner
    restaurant={o.restaurant ?? makeRestaurant()}
    onUpdate={o.onUpdate ?? vi.fn(async () => ({ error: null }))}
    plan={o.plan}
    onSignOut={() => {}}
    onPricing={() => {}}
    modulesState={modulesState}
    surface={o.surface}
  />
)

function inEnglish(node: ReactNode) {
  return render(
    <UiLangScope lang="en">
      <Suspense fallback={null}>{node}</Suspense>
    </UiLangScope>,
  )
}

const currencySelect = (label = 'Moneda meniului'): HTMLSelectElement => {
  const el = screen.getByLabelText(label)
  if (!(el instanceof HTMLSelectElement)) throw new Error('selectorul de monedă lipsește')
  return el
}
const option = (select: HTMLSelectElement, code: string): HTMLOptionElement => {
  const o = Array.from(select.options).find((x) => x.value === code)
  if (!o) throw new Error(`opțiunea ${code} lipsește`)
  return o
}

describe('SettingsTab — moneda meniului pe bon fiscal (mig 334)', () => {
  it('FCS1: Planul 3 în România — doar RON, cu motivul spus', () => {
    render(tab('menu', { plan: 'pro', surface: surfaceFor('pro') }))
    const sel = currencySelect()
    expect(sel).toHaveValue('RON')
    expect(sel).not.toBeDisabled()
    expect(option(sel, 'RON').disabled).toBe(false)
    for (const code of ['EUR', 'HUF', 'BGN', 'MDL', 'USD', 'GBP']) expect(option(sel, code).disabled).toBe(true)
    expect(screen.getByText(settingsRo.cur_descFiscal)).toBeInTheDocument()
    expect(screen.queryByText(/fiscalizarea nu sunt afectate/)).toBeNull()
    expect(screen.queryByText(/Moneda salvată e/)).toBeNull()
    expect(screen.getByTestId('menu-preview')).toHaveTextContent('preview-RON')
  })

  it('FCS2: control pozitiv — pe Planul 2 orice monedă se alege', async () => {
    render(tab('menu', { plan: 'growth', surface: surfaceFor('growth') }))
    const sel = currencySelect()
    for (const o of Array.from(sel.options)) expect(o.disabled).toBe(false)
    expect(screen.getByText(settingsRo.cur_desc)).toBeInTheDocument()
    expect(screen.queryByText(settingsRo.cur_descFiscal)).toBeNull()
    await userEvent.setup().selectOptions(sel, 'EUR')
    expect(sel).toHaveValue('EUR')
    expect(screen.getByTestId('menu-preview')).toHaveTextContent('preview-EUR')
  })

  it('FCS3: EUR salvat dinaintea Planului 3 — nota, previzualizarea în lei, RON se salvează', async () => {
    const onUpdate = vi.fn<(id: string, f: Partial<Restaurant>) => Promise<{ error: Error | null }>>(
      async () => ({ error: null }),
    )
    render(
      tab('menu', {
        plan: 'pro',
        surface: surfaceFor('pro'),
        restaurant: makeRestaurant({ currency: 'EUR' }),
        onUpdate,
      }),
    )
    const sel = currencySelect()
    expect(sel).toHaveValue('EUR')
    expect(sel).not.toBeDisabled()
    expect(screen.getByText(/Moneda salvată e EUR/)).toHaveTextContent(/plata online la masă rămâne oprită/)
    // Oaspetele vede deja lei (gate-ul de citire): previzualizarea la fel.
    expect(screen.getByTestId('menu-preview')).toHaveTextContent('preview-RON')
    const user = userEvent.setup()
    await user.selectOptions(sel, 'RON')
    expect(sel).toHaveValue('RON')
    expect(screen.queryByText(/Moneda salvată e/)).toBeNull()
    // Formularul e acum „murdar”: butonul de sus + bara de salvare de jos.
    const save = screen.getAllByRole('button', { name: 'Salvează' })[0]
    if (!save) throw new Error('butonul „Salvează” lipsește')
    await user.click(save)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0]?.[1]).toMatchObject({ currency: 'RON' })
  })

  it('FCS4: local adus înapoi în România pe Planul 3 — moneda devine RON', async () => {
    const r = makeRestaurant({ country: 'DE', currency: 'USD', timezone: 'Europe/Berlin' })
    const surface = surfaceFor('pro', { outsideRo: true })
    const { rerender } = render(tab('menu', { plan: 'pro', surface, restaurant: r }))
    // Control: în DE moneda e liberă și USD (aleasă de mână) e activă.
    expect(currencySelect()).toHaveValue('USD')
    expect(option(currencySelect(), 'USD').disabled).toBe(false)
    rerender(tab('restaurant', { plan: 'pro', surface, restaurant: r }))
    await userEvent.setup().selectOptions(screen.getByLabelText('Țara restaurantului'), 'RO')
    rerender(tab('menu', { plan: 'pro', surface, restaurant: r }))
    expect(currencySelect()).toHaveValue('RON')
    expect(option(currencySelect(), 'USD').disabled).toBe(true)
    expect(screen.getByText(settingsRo.cur_descFiscal)).toBeInTheDocument()
  })

  it('FCS5: refuzul serverului — româna păstrează mesajul, engleza are textul hint-ului', async () => {
    const SERVER =
      'Pe un restaurant cu bon fiscal, moneda meniului rămâne RON (lei): bonul, factura și plata online sunt în lei.'
    const refused = async () => ({
      error: { message: SERVER, code: '23514', hint: 'fiscal_currency_ron_only' } as unknown as Error,
    })
    const user = userEvent.setup()
    const ro = render(tab('menu', { plan: 'pro', surface: surfaceFor('pro'), onUpdate: refused }))
    await user.click(screen.getByRole('button', { name: 'Salvează' }))
    expect(await screen.findByText(SERVER)).toBeInTheDocument()
    ro.unmount()
    inEnglish(tab('menu', { plan: 'pro', surface: surfaceFor('pro'), onUpdate: refused }))
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText(settingsEn.cur_lockedRefusal)).toBeInTheDocument()
    expect(screen.queryByText(SERVER)).toBeNull()
  })
})

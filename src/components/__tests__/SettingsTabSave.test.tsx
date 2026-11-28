// Setări: salvarea paginii (lotul C7c). (Prefixul SJ: verificat cu grep în
// src/, tests/, e2e/, supabase/, docs și CLAUDE.md, nefolosit înainte.)
// Cardul de fidelizare e cel REAL (programul e acum al formularului paginii);
// restul cardurilor cu fetch propriu sunt stub-uri.
//   SJ1  schimbarea slug-ului cere confirmare ÎNAINTEA RPC-ului: distructivă,
//        cu adresa nouă și cea veche și cu tot ce moare (QR-ul general tipărit,
//        linkurile, rezervările, anulările), că QR-urile meselor merg și că
//        noul QR general trebuie descărcat. „Anulează" nu trimite NIMIC.
//        Mutația care pică: confirmarea scoasă (RPC-ul ar pleca pe loc).
//   SJ2  control pozitiv: confirmată, slug-ul pleacă la RPC și restul la
//        `onUpdate`.
//   SJ3  fără schimbare de slug, nicio întrebare; ajutorul de sub câmp există
//        și e legat prin `aria-describedby`.
//   SJ4  orele de ridicare sunt `type="time"`; o oră salvată fără minute („9" —
//        zero sloturi pentru oaspeți) e marcată pe loc și BLOCHEAZĂ salvarea;
//        corectată, salvarea pleacă. Mutația care pică: validarea scoasă din
//        `handleSave` (orele ilizibile s-ar salva tăcut).
//   SJ5  minutele se pot goli și retasta (înainte „20" sărea înapoi la 20, iar
//        „4" spre „45" era respins); golul arată eroarea la ieșire și blochează
//        salvarea; peste plajă se aduce la capăt la ieșire. Mutația care pică:
//        câmpul controlat direct pe numărul din formular (`String(n ?? 20)`).
//   SJ6  „Salvează" de sus doar unde secțiunea are formular: „Meniu QR" pe
//        Planul 1 și pe planul necunoscut nu, pe Planul 2 da. Mutația care pică:
//        `section !== 'account'`.
//   SJ7  fidelizarea trece prin „Salvează" de sus: o modificare e „nesalvată"
//        (bara de jos + `onDirtyChange`), supraviețuiește trecerii pe altă
//        secțiune, iar salvarea scrie programul și curăță starea. Mutațiile care
//        pică: starea ținută în card (se pierde la trecere), `loyalty.dirty`
//        scos din `dirty`, upsert-ul scos din `handleSave`.
//   SJ8  citirea programului EȘUATĂ: câmpurile blocate și „Salvează" nu scrie
//        programul (fail-closed) — chiar cu modulul pornit —, dar restul
//        formularului se salvează. Mutația care pică: `loyaltyNeedsSave` fără
//        verificarea `ready`.
//   SJ9  modulul pornit, programul niciodată salvat: nota cere „Salvează", iar
//        „Salvează" creează programul cu valorile implicite (fidelizarea nu
//        pornește fără rând). Control: modulul oprit, neatins — nimic scris.
//   SJ10 un program invalid oprește TOT „Salvează" cu mesajul cardului (nimic
//        nu pleacă). Mutația care pică: validarea făcută după `onUpdate`.
//   SJ11 refuzul serverului la scrierea programului: în română EXACT textul
//        serverului, în engleză rezerva `common.err_generic`, fără textul
//        românesc (mutat din GQ3, cu salvarea).
//   SJ12 un rând nesalvat din editorul de cote TVA intră în paza de ieșire
//        (`onDirtyChange(true)`), dar nu în bara „Salvează" (salvare pe rând).
//        Mutația care pică: `vatDirty` scos din `unsaved`.
//   SJ13 adresa se poate scrie (o arată meniul, rezervările și SEO, dar nu
//        exista niciun câmp) și pleacă la `onUpdate`; „Program" e acum o notă,
//        cu ajutorul care trimite la „Program detaliat". Mutația care pică:
//        rândul `address` scos din cardul de informații.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'
import type { useRestaurantModules } from '../../hooks/useRestaurantModules'
import type { ConfirmOptions } from '../ui/confirm'

interface LoadRes {
  data: unknown
  error: { message: string; code?: string } | null
}

const h = vi.hoisted(() => ({
  confirm: vi.fn<(o: ConfirmOptions) => Promise<boolean>>(async () => false),
  changeSlug: vi.fn<(i: { restaurantId: string; newSlug: string }) => Promise<unknown>>(
    async () => ({ ok: true, slug: 'bistro-nou' }),
  ),
  loyalty: { data: null, error: null } as LoadRes,
  upsert: vi.fn<(row: Record<string, unknown>) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  })),
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }))
vi.mock('../../lib/supabase', () => {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.maybeSingle = () => Promise.resolve(h.loyalty)
  builder.upsert = (row: Record<string, unknown>) => h.upsert(row)
  return { supabase: { from: () => builder } }
})
vi.mock('../../lib/restaurants', () => ({ changeRestaurantSlug: h.changeSlug }))
vi.mock('../ui/confirm', () => ({ confirm: h.confirm }))
// Stub-ul editorului de cote: un buton care raportează un rând nesalvat.
vi.mock('../VatRatesEditor', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) =>
      createElement('button', { type: 'button', onClick: () => onDirtyChange?.(true) }, 'stub-vat-edit'),
  }
})
vi.mock('../OnlinePaymentsCard', () => ({ default: () => null }))
vi.mock('../SmsNotificationsCard', () => ({ default: () => null }))
vi.mock('../MfaCard', () => ({ default: () => null }))
vi.mock('../GdprCard', () => ({ default: () => null }))
vi.mock('../UiLanguageCard', () => ({ default: () => null }))
vi.mock('../menu/MenuPreview', () => ({ default: () => null }))
vi.mock('../_dashboard/SubscriptionCard', () => ({ SubscriptionCard: () => null }))

import SettingsTab from '../SettingsTab'
import { siteHost } from '../../lib/domain'
import { preloadNamespace } from '../../i18n/core'
import { settingsNs } from '../../i18n/ns/settings'
import { settingsCardsNs } from '../../i18n/ns/settingsCards'
import { commonNs } from '../../i18n/ns/common'
import { translationsNs } from '../../i18n/ns/translations'
import { homeNs } from '../../i18n/ns/home'
import commonEn from '../../i18n/ns/common/en'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'
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

beforeEach(() => {
  h.confirm.mockReset()
  h.confirm.mockImplementation(async () => false)
  h.changeSlug.mockReset()
  h.changeSlug.mockImplementation(async () => ({ ok: true, slug: 'bistro-nou' }))
  h.loyalty = { data: null, error: null }
  h.upsert.mockReset()
  h.upsert.mockImplementation(async () => ({ error: null }))
})

const PICKUP_ON: NonNullable<Restaurant['pickup_settings']> = {
  enabled: true,
  min_lead_time_minutes: 20,
  slot_interval_minutes: 15,
  open_hours: { start: '09:00', end: '21:00' },
  instructions: null,
  pickup_only: false,
}

const SAVED_PROGRAM: LoadRes = {
  data: { points_per_leu: 2, reward_threshold: 250, reward_description: 'O cafea' },
  error: null,
}

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
    language: 'ro',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...over,
  }
}

const modules = (on: boolean) =>
  ({
    modules: {},
    loading: false,
    loadError: false,
    isEnabled: () => on,
    setModule: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
  }) as unknown as ReturnType<typeof useRestaurantModules>

type OnUpdate = (id: string, f: Partial<Restaurant>) => Promise<{ error: Error | null }>

interface TabOpts {
  restaurant?: Restaurant
  surface?: PlanSurface | null
  plan?: string
  onUpdate?: OnUpdate
  onDirtyChange?: (dirty: boolean) => void
  modulesState?: ReturnType<typeof useRestaurantModules>
}

const MODULES_OFF = modules(false)

const tab = (section: SettingsSection, o: TabOpts = {}) => (
  <SettingsTab
    section={section}
    isOwner
    restaurant={o.restaurant ?? makeRestaurant()}
    onUpdate={o.onUpdate ?? (async () => ({ error: null }))}
    plan={o.plan ?? 'growth'}
    onSignOut={() => {}}
    onPricing={() => {}}
    modulesState={o.modulesState ?? MODULES_OFF}
    surface={o.surface === undefined ? surfaceFor('growth') : o.surface}
    onDirtyChange={o.onDirtyChange}
  />
)

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}

const onUpdateOk = () => vi.fn<OnUpdate>(async () => ({ error: null }))
const topSave = (name = 'Salvează') => screen.getAllByRole('button', { name })[0]!

describe('SettingsTab — schimbarea slug-ului (lotul C7c)', () => {
  it('SJ1: confirmare distructivă înaintea RPC-ului; „Anulează" nu trimite nimic', async () => {
    const user = userEvent.setup()
    const onUpdate = onUpdateOk()
    render(tab('menu', { onUpdate }))
    const slug = screen.getByLabelText('Adresa meniului (slug)')
    await user.clear(slug)
    await user.type(slug, 'bistro-nou')
    await user.click(topSave())

    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
    const opts = h.confirm.mock.calls[0]![0]
    expect(opts.destructive).toBe(true)
    expect(opts.title).toBe(`Schimbi adresa meniului în ${siteHost()}/m/bistro-nou?`)
    expect(opts.description).toContain(`${siteHost()}/m/bistro-test`)
    expect(opts.description).toMatch(/QR-ul general deja tipărit/)
    expect(opts.description).toMatch(/Instagram, Google/)
    expect(opts.description).toMatch(/pagina de rezervări și linkurile de anulare/)
    expect(opts.description).toMatch(/QR-urile meselor funcționează în continuare/)
    expect(opts.description).toMatch(/descarcă noul QR general/)
    expect(opts.confirmLabel).toBe('Schimbă adresa')
    expect(opts.cancelLabel).toBe('Anulează')
    expect(h.changeSlug).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('SJ2: confirmată, slug-ul pleacă la RPC și restul la onUpdate', async () => {
    h.confirm.mockImplementation(async () => true)
    const user = userEvent.setup()
    const onUpdate = onUpdateOk()
    render(tab('menu', { onUpdate }))
    const slug = screen.getByLabelText('Adresa meniului (slug)')
    await user.clear(slug)
    await user.type(slug, 'bistro-nou')
    await user.click(topSave())
    await waitFor(() =>
      expect(h.changeSlug).toHaveBeenCalledWith({ restaurantId: 'rest-1', newSlug: 'bistro-nou' }),
    )
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    // Slug-ul NU pleacă prin `.update()` (UPDATE pe coloană revocat, mig 096B).
    expect(onUpdate.mock.calls[0]![1]).not.toHaveProperty('slug')
  })

  it('SJ3: fără schimbare de slug, nicio întrebare; ajutorul e legat de câmp', async () => {
    const user = userEvent.setup()
    const onUpdate = onUpdateOk()
    render(tab('menu', { onUpdate }))
    const slug = screen.getByLabelText('Adresa meniului (slug)')
    const hint = screen.getByText(/QR-urile meselor nu sunt afectate/)
    expect(hint.id).not.toBe('')
    expect(slug).toHaveAttribute('aria-describedby', hint.id)
    await user.click(topSave())
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.changeSlug).not.toHaveBeenCalled()
  })
})

describe('SettingsTab — orele și minutele ridicării (lotul C7c)', () => {
  it('SJ4: ora fără minute e marcată și blochează salvarea; corectată, pleacă', async () => {
    const user = userEvent.setup()
    const onUpdate = onUpdateOk()
    const restaurant = makeRestaurant({
      pickup_settings: { ...PICKUP_ON, open_hours: { start: '9', end: '21:00' } },
    })
    render(tab('orders', { restaurant, onUpdate }))
    const open = screen.getByLabelText('Deschidere ridicare')
    const close = screen.getByLabelText('Închidere ridicare')
    expect(open).toHaveAttribute('type', 'time')
    expect(close).toHaveAttribute('type', 'time')
    expect(open).toHaveAttribute('aria-invalid', 'true')
    expect(close).not.toHaveAttribute('aria-invalid')
    const err = screen.getByText('Alege o oră completă (ex. 09:00).')
    expect(open).toHaveAttribute('aria-describedby', err.id)

    await user.click(topSave())
    expect(
      await screen.findByText(
        'Verifică orele și minutele de la „Comenzi pentru ridicare” înainte să salvezi.',
      ),
    ).toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()

    // Control pozitiv: ora completă → fără eroare, salvarea pleacă.
    fireEvent.change(open, { target: { value: '09:30' } })
    expect(screen.queryByText('Alege o oră completă (ex. 09:00).')).not.toBeInTheDocument()
    expect(open).not.toHaveAttribute('aria-invalid')
    await user.click(topSave())
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(onUpdate.mock.calls[0]![1].pickup_settings?.open_hours).toEqual({
      start: '09:30',
      end: '21:00',
    })
  })

  it('SJ5: minutele se golesc, se retastează și se aduc în plajă la ieșire', async () => {
    const user = userEvent.setup()
    const onUpdate = onUpdateOk()
    const onDirtyChange = vi.fn()
    render(tab('orders', { restaurant: makeRestaurant({ pickup_settings: PICKUP_ON }), onUpdate, onDirtyChange }))
    const lead = screen.getByLabelText('Pregătire minim (minute)')
    expect(lead).toHaveValue(20)
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    await user.clear(lead)
    // Câmpul rămâne gol (înainte sărea înapoi la 20) și e muncă nesalvată.
    expect(lead).toHaveValue(null)
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    // Eroarea apare la ieșirea din câmp, nu la fiecare tastă.
    expect(screen.queryByText('Introdu un număr de minute între 5 și 240.')).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByText('Introdu un număr de minute între 5 și 240.')).toBeInTheDocument()
    expect(lead).toHaveAttribute('aria-invalid', 'true')
    await user.click(topSave())
    expect(onUpdate).not.toHaveBeenCalled()

    // Retastat: „4" în drum spre „45" nu e respins.
    await user.type(lead, '45')
    expect(lead).toHaveValue(45)
    expect(screen.queryByText('Introdu un număr de minute între 5 și 240.')).not.toBeInTheDocument()

    // Peste plajă: adus la capăt la ieșire.
    const slot = screen.getByLabelText('Interval slot (minute)')
    await user.clear(slot)
    await user.type(slot, '90')
    await user.tab()
    expect(slot).toHaveValue(60)
    expect(screen.queryByText('Introdu un număr de minute între 5 și 60.')).not.toBeInTheDocument()

    await user.click(topSave())
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(onUpdate.mock.calls[0]![1].pickup_settings).toMatchObject({
      min_lead_time_minutes: 45,
      slot_interval_minutes: 60,
    })
  })
})

describe('SettingsTab — un singur „Salvează" (lotul C7c)', () => {
  it('SJ6: butonul de sus doar pe secțiunile cu formular', () => {
    const { unmount } = render(tab('orders', { plan: 'starter', surface: surfaceFor('starter') }))
    // Ancora: secțiunea e randată (modulele, pe orice plan).
    expect(screen.getByText('Module opționale')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salvează' })).not.toBeInTheDocument()
    unmount()

    const unknown = render(tab('orders', { plan: 'free', surface: null }))
    expect(screen.getByText('Module opționale')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salvează' })).not.toBeInTheDocument()
    unknown.unmount()

    // Control pozitiv: pe Planul 2, „Comenzi" are ridicarea și sugestiile.
    render(tab('orders'))
    expect(screen.getByRole('button', { name: 'Salvează' })).toBeInTheDocument()
  })

  it('SJ7: fidelizarea e a formularului — nesalvată, păstrată între secțiuni, salvată de sus', async () => {
    h.loyalty = SAVED_PROGRAM
    const user = userEvent.setup()
    const onUpdate = onUpdateOk()
    const onDirtyChange = vi.fn()
    const mods = modules(true)
    const { rerender } = render(tab('orders', { onUpdate, onDirtyChange, modulesState: mods }))
    const threshold = () => screen.getByLabelText('Prag pentru recompensă (puncte)')
    await waitFor(() => expect(threshold()).toHaveValue('250'))
    expect(screen.queryByText('Ai modificări nesalvate')).not.toBeInTheDocument()

    await user.clear(threshold())
    await user.type(threshold(), '300')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByText('Ai modificări nesalvate')).toBeInTheDocument()

    // Trecerea pe altă secțiune (ca în panou: aceeași instanță) nu pierde nimic.
    rerender(tab('restaurant', { onUpdate, onDirtyChange, modulesState: mods }))
    expect(screen.getByText('Ai modificări nesalvate')).toBeInTheDocument()
    rerender(tab('orders', { onUpdate, onDirtyChange, modulesState: mods }))
    expect(threshold()).toHaveValue('300')

    await user.click(topSave())
    await waitFor(() => expect(h.upsert).toHaveBeenCalledTimes(1))
    expect(h.upsert.mock.calls[0]![0]).toMatchObject({
      restaurant_id: 'rest-1',
      points_per_leu: 2,
      reward_threshold: 300,
      reward_description: 'O cafea',
      is_active: true,
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Salvat')).toBeInTheDocument()
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
    expect(screen.queryByText('Ai modificări nesalvate')).not.toBeInTheDocument()
  })

  it('SJ8: citirea programului eșuată — „Salvează" nu-l scrie, dar salvează restul', async () => {
    h.loyalty = { data: null, error: { message: 'Failed to fetch' } }
    const user = userEvent.setup()
    const onUpdate = onUpdateOk()
    render(tab('orders', { onUpdate, modulesState: modules(true) }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nu am putut citi programul/)
    expect(screen.getByLabelText('Prag pentru recompensă (puncte)')).toBeDisabled()
    await user.click(topSave())
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('SJ9: modulul pornit și programul nesalvat — „Salvează" îl creează', async () => {
    const user = userEvent.setup()
    const { unmount } = render(tab('orders', { modulesState: modules(true) }))
    expect(await screen.findByText(/Programul nu e salvat încă/)).toBeInTheDocument()
    await user.click(topSave())
    await waitFor(() => expect(h.upsert).toHaveBeenCalledTimes(1))
    expect(h.upsert.mock.calls[0]![0]).toMatchObject({
      points_per_leu: 1,
      reward_threshold: 100,
      reward_description: 'Un desert din partea casei',
      is_active: true,
    })
    unmount()

    // Control: modulul oprit și programul neatins — nimic de creat.
    const onUpdate = onUpdateOk()
    render(tab('orders', { onUpdate, modulesState: modules(false) }))
    await waitFor(() => expect(screen.getByLabelText('Prag pentru recompensă (puncte)')).toBeEnabled())
    expect(screen.queryByText(/Programul nu e salvat încă/)).not.toBeInTheDocument()
    await user.click(topSave())
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(h.upsert).toHaveBeenCalledTimes(1)
  })

  it('SJ10: un program invalid oprește tot „Salvează"', async () => {
    h.loyalty = SAVED_PROGRAM
    const user = userEvent.setup()
    const onUpdate = onUpdateOk()
    render(tab('orders', { onUpdate, modulesState: modules(true) }))
    const threshold = screen.getByLabelText('Prag pentru recompensă (puncte)')
    await waitFor(() => expect(threshold).toHaveValue('250'))
    await user.clear(threshold)
    await user.type(threshold, '0')
    await user.click(topSave())
    expect(await screen.findByText('Pragul trebuie între 1 și 100.000 de puncte.')).toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('SJ11: refuzul serverului la program — română = serverul, engleză = rezerva', async () => {
    const SERVER = 'Programul nu poate fi salvat: pragul încalcă regula restaurantului.'
    h.loyalty = SAVED_PROGRAM
    h.upsert.mockImplementation(async () => ({ error: { message: SERVER, code: 'P0001' } }))
    const user = userEvent.setup()

    const ro = render(tree(null, tab('orders', { modulesState: modules(true) })))
    const roThreshold = await screen.findByLabelText('Prag pentru recompensă (puncte)')
    await waitFor(() => expect(roThreshold).toHaveValue('250'))
    await user.clear(roThreshold)
    await user.type(roThreshold, '300')
    await user.click(topSave())
    expect(await screen.findByText(SERVER)).toBeInTheDocument()
    expect(screen.queryByText('Salvat')).not.toBeInTheDocument()
    ro.unmount()

    render(tree('en', tab('orders', { modulesState: modules(true) })))
    const enThreshold = await screen.findByLabelText('Reward threshold (points)')
    await waitFor(() => expect(enThreshold).toHaveValue('250'))
    await user.clear(enThreshold)
    await user.type(enThreshold, '300')
    await user.click(topSave('Save'))
    expect(await screen.findByText(commonEn.err_generic)).toBeInTheDocument()
    expect(screen.queryByText(SERVER)).not.toBeInTheDocument()
  })

  it('SJ12: cotele TVA nesalvate intră în paza de ieșire, nu în bara de jos', async () => {
    const user = userEvent.setup()
    const onDirtyChange = vi.fn()
    render(tab('orders', { plan: 'pro', surface: surfaceFor('pro'), onDirtyChange }))
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    await user.click(screen.getByRole('button', { name: 'stub-vat-edit' }))
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect(screen.queryByText('Ai modificări nesalvate')).not.toBeInTheDocument()
  })
})

describe('SettingsTab — adresa și nota de program (lotul C7c)', () => {
  it('SJ13: adresa se scrie și pleacă; „Program" e o notă cu ajutor', async () => {
    const user = userEvent.setup()
    const onUpdate = onUpdateOk()
    render(tab('restaurant', { onUpdate }))
    const address = screen.getByLabelText('Adresă')
    expect(address).toHaveAttribute('placeholder', 'Str. Nicolae Bălcescu 10')
    await user.type(address, 'Str. Avram Iancu 5')
    const note = screen.getByLabelText('Notă despre program (opțional)')
    const hint = screen.getByText(/Orele pe zile și indicatorul de deschis vin din/)
    expect(note).toHaveAttribute('aria-describedby', hint.id)
    // Vechea etichetă („Program", ca un al doilea orar) nu mai există.
    expect(screen.queryByText('Program')).not.toBeInTheDocument()
    await user.click(topSave())
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(onUpdate.mock.calls[0]![1]).toMatchObject({ address: 'Str. Avram Iancu 5' })
  })
})

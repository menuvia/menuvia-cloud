// Fila Setări în limba personalului (lotul L6b): SettingsTab citește
// namespace-ul `settings` (+ „Salvează”/„Șterge”/„Anulează”/„Reîncearcă” din
// `common`, numele limbilor meniului din `translations`) și cere SUS și
// `settingsCards` (cardurile montate static, aici stub-uri — textele lor au
// testele implementatorului lor) și `home` (SubscriptionCard, stub aici). Testele de comportament (planul, ridicarea,
// țara, abonamentul, salvarea) rămân în SettingsTabPlan / SettingsTabPickup,
// NESCHIMBATE — aici e doar limba. Partea pură (ridicarea, zilele, temele,
// țările, pluralele, precondiția structurală) e în
// src/lib/__tests__/settingsLang.test.ts (TW8–TW13).
// (Prefixul TW: verificat cu grep în src/, tests/, e2e/, supabase/tests și
// docs, nefolosit înainte.)
//   TW0  control POZITIV al verificării „fără text românesc”: secțiunea
//        Restaurant randată în română, comparată cu dicționarul englez, ARE
//        resturi. Fără el, TW2–TW5 ar trece și cu o verificare stricată.
//   TW1  fără provider (azi, mereu româna): textele de dinainte — titlurile,
//        zilele „Luni”…„Duminică” cu numele accesibile „Luni deschidere”,
//        facilitățile, textContent-ul ajutorului Google (nodul împărțit de
//        fillNodes), confirmarea „Suprascrie” cu „Anulează” EXPLICIT.
//        Mutația care pică: `google_help` fără spațiul de după „aici:”.
//   TW2  secțiunea Restaurant în engleză: zilele, numele accesibile,
//        ajutorul Google, facilitățile, fără resturi românești. Mutația care
//        pică: un literal românesc lăsat (ex. `aria-label={`${day} deschidere`}`).
//   TW3  Aspect meniu în germană: temele, așezarea produselor, paginile
//        Flipbook (titlu, numele accesibile), mostrele de accent, numele
//        limbilor meniului (`menuLangTitle`), moneda, nota Flipbook — fără
//        resturi. Mutația care pică: `{l.label}` readus pe pastila limbii
//        („English” într-un ecran german).
//   TW4  Comenzi & plăți în franceză, ridicarea pornită pe Flipbook:
//        descrierea cardului spune motivul în franceză (calea până la
//        „Disposition des produits”), nota bucătăriei cu badge-ul „📦 À
//        emporter”, comutatoarele, fără resturi. Mutația care pică:
//        `pickupCardDescription(true, menuFlipbook)` direct (oracolul românesc).
//   TW5  Abonament & cont în engleză: planul necunoscut după o citire eșuată,
//        „Try again” din `common`, „Sign out”, fără „Save”. Mutația care pică:
//        `'Nu am putut verifica planul'` readus.
//   TW6  refuzurile serverului: schimbarea slug-ului refuzată cu un mesaj
//        românesc → în română EXACT mesajul (ca `toUserMessage`), în engleză
//        rezerva tradusă FĂRĂ mesajul brut; slug ocupat tradus; trigger-ul de
//        țară (hint `country_owner_only`, 42501) → în română EXACT textul de
//        dinainte (clasa de drepturi), în engleză textul propriu al hint-ului;
//        modulul refuzat cu text românesc → în engleză rezerva. Mutația care
//        pică: hint-urile aplicate și în română (textul de azi s-ar schimba).
//   TW7  schimbarea limbii pe ACEEAȘI rădăcină `UiLangScope`: planul eșuat și
//        zilele se retraduc (sunt DATE / chei, nu text compus o dată), iar
//        confirmarea din germană are butoanele în germană. Mutația care pică:
//        `confirmLabel` / `cancelLabel` lipsă (dialogul ar cădea pe cromul
//        paginii, nu pe limba filei).
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'
import type { useRestaurantModules } from '../../hooks/useRestaurantModules'

const h = vi.hoisted(() => ({
  confirm: vi.fn<(opts: Record<string, unknown>) => Promise<boolean>>(() => Promise.resolve(false)),
  changeSlug: vi.fn<(input: { restaurantId: string; newSlug: string }) => Promise<unknown>>(),
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/restaurants', () => ({ changeRestaurantSlug: h.changeSlug }))
vi.mock('../ui/confirm', () => ({ confirm: h.confirm }))
// Cardurile cu fetch propriu / cu namespace-ul lor: stub-uri goale.
vi.mock('../VatRatesEditor', () => ({ default: () => null }))
vi.mock('../OnlinePaymentsCard', () => ({ default: () => null }))
vi.mock('../LoyaltySettingsCard', () => ({ default: () => null }))
vi.mock('../SmsNotificationsCard', () => ({ default: () => null }))
vi.mock('../MfaCard', () => ({ default: () => null }))
vi.mock('../GdprCard', () => ({ default: () => null }))
vi.mock('../UiLanguageCard', () => ({ default: () => null }))
vi.mock('../menu/MenuPreview', () => ({ default: () => null }))
vi.mock('../_dashboard/SubscriptionCard', () => ({ SubscriptionCard: () => null }))

import SettingsTab from '../SettingsTab'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { settingsNs } from '../../i18n/ns/settings'
import { settingsCardsNs } from '../../i18n/ns/settingsCards'
import { commonNs } from '../../i18n/ns/common'
import { translationsNs } from '../../i18n/ns/translations'
import { homeNs } from '../../i18n/ns/home'
import settingsRo from '../../i18n/ns/settings/ro'
import settingsEn from '../../i18n/ns/settings/en'
import settingsFr from '../../i18n/ns/settings/fr'
import settingsDe from '../../i18n/ns/settings/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'
import type { SettingsSection } from '../../lib/dashboardNav'
import type { PlanSurface } from '../../lib/planSurface'
import { surfaceFor } from '../../lib/__tests__/planSurfaceFixtures'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(
    langs.flatMap((l) => [
      preloadNamespace(settingsNs, l),
      preloadNamespace(settingsCardsNs, l),
      preloadNamespace(commonNs, l),
      preloadNamespace(translationsNs, l),
      preloadNamespace(homeNs, l),
    ]),
  )
})

beforeEach(() => {
  h.confirm.mockReset()
  h.confirm.mockImplementation(() => Promise.resolve(false))
  h.changeSlug.mockReset()
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
    google_place_id: 'ChIJ1234567890abcdef',
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

const modules = (setModule: () => Promise<void> = async () => {}) =>
  ({
    modules: {},
    loading: false,
    loadError: false,
    isEnabled: () => false,
    setModule: vi.fn(setModule),
    reload: vi.fn(async () => {}),
  }) as unknown as ReturnType<typeof useRestaurantModules>

interface TabOpts {
  restaurant?: Restaurant
  surface?: PlanSurface | null
  plan?: string
  onUpdate?: (id: string, f: Partial<Restaurant>) => Promise<{ error: Error | null }>
  planLoadError?: boolean
  modulesState?: ReturnType<typeof useRestaurantModules>
}

const tab = (section: SettingsSection, o: TabOpts = {}) => (
  <SettingsTab
    section={section}
    restaurant={o.restaurant ?? makeRestaurant()}
    onUpdate={o.onUpdate ?? (async () => ({ error: null }))}
    plan={o.plan ?? 'growth'}
    onSignOut={() => {}}
    onPricing={() => {}}
    modulesState={o.modulesState ?? modules()}
    surface={o.surface === undefined ? surfaceFor('growth') : o.surface}
    planLoadError={o.planLoadError}
    onRetryPlan={() => {}}
  />
)

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [settingsEn as Dict, commonEn as Dict],
  fr: [settingsFr as Dict, commonFr as Dict],
  de: [settingsDe as Dict, commonDe as Dict],
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
// Textul pe NODURI (capcana (b) din L5a2): `textContent` lipește textele
// elementelor vecine, iar granița de cuvânt n-ar mai găsi fragmentul.
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}
/** Plus numele accesibile (aria-label / title / placeholder / alt). */
function attrText(root: Element): string {
  const out: string[] = []
  for (const el of root.querySelectorAll('[aria-label],[title],[placeholder],[alt]'))
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a)
      if (v) out.push(v)
    }
  return out.join('\n')
}
const visible = (root: Element): string => `${nodeText(root)}\n${attrText(root)}`

/** Fragmentele românești ale lui `settings` + `common` rămase în text (fără
 *  cele identice în limba țintă), pe bucățile fixe de cel puțin 6 caractere. */
function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [settingsRo as Dict, commonRo as Dict]
  sources.forEach((src, i) => {
    const target = TARGETS[lang][i]!
    for (const [k, v] of Object.entries(src)) {
      const own = formsOf(target[k]).join('\n')
      for (const form of formsOf(v))
        for (const piece of form.split(/\{\w+\}/)) {
          const p = piece.trim()
          if (p.length >= 6 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
        }
    }
  })
  return out
}

const RO_LETTERS = /[ăĂșȘțȚ]/
const divStartingWith = (root: HTMLElement, start: string) =>
  [...root.querySelectorAll('div')].find((d) => d.textContent?.startsWith(start))

describe('Setări în limba personalului', () => {
  it('TW0: control pozitiv — secțiunea românească are resturi față de engleză', () => {
    const { container } = inLang(null, tab('restaurant'))
    expect(screen.getByText('Informații principale')).toBeInTheDocument()
    const left = romanianLeftovers(visible(container), 'en')
    expect(left.length).toBeGreaterThan(5)
    expect(left.some((l) => l.startsWith('info_title:'))).toBe(true)
    expect(left.some((l) => l.startsWith('day_wed:'))).toBe(true)
  })

  it('TW1: fără provider, româna de dinainte', async () => {
    const { container } = inLang(null, tab('restaurant'))
    expect(screen.getByRole('button', { name: 'Salvează' })).toBeInTheDocument()
    expect(screen.getByText('Nume restaurant *')).toBeInTheDocument()
    expect(screen.getByLabelText('Nume restaurant')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Despre restaurant...')).toBeInTheDocument()
    expect(screen.getByText('Program detaliat')).toBeInTheDocument()
    for (const day of ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică']) {
      expect(screen.getByText(day)).toBeInTheDocument()
      expect(screen.getByLabelText(`${day} deschidere`)).toBeInTheDocument()
      expect(screen.getByLabelText(`${day} închidere`)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('checkbox', { name: 'Deschis' }).length).toBe(7)
    expect(screen.getByRole('button', { name: 'Opțiuni vegane' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Terasă' })).toBeInTheDocument()
    expect(divStartingWith(container, 'Găsești ')?.textContent).toBe(
      'Găsești Place ID-ul aici: Place ID Finder. Caută numele localului tău, copiază ID-ul (începe cu "ChIJ...").',
    )
    expect(divStartingWith(container, 'URL preview: ')?.textContent).toBe(
      'URL preview: search.google.com/local/writereview?placeid=ChIJ12345678...',
    )
    expect(screen.getByText('Configurat')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copiază luni → toate' }))
    expect(h.confirm).toHaveBeenCalledWith({
      title: 'Suprascrii orarul din Marți–Duminică cu cel de Luni?',
      description: 'Nu poți anula această acțiune.',
      confirmLabel: 'Suprascrie',
      cancelLabel: 'Anulează',
      destructive: true,
    })
  })

  it('TW2: Restaurant în engleză, fără resturi românești', () => {
    const { container } = inLang('en', tab('restaurant'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByText('Main details')).toBeInTheDocument()
    expect(screen.getByText('Restaurant name *')).toBeInTheDocument()
    expect(screen.getByLabelText('Restaurant name')).toBeInTheDocument()
    expect(screen.getByText('Detailed opening hours')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Monday → all' })).toBeInTheDocument()
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(screen.getByText(day)).toBeInTheDocument()
      expect(screen.getByLabelText(`${day} opening time`)).toBeInTheDocument()
      expect(screen.getByLabelText(`${day} closing time`)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('checkbox', { name: 'Open' }).length).toBe(7)
    expect(screen.getByRole('button', { name: 'Vegan options' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Terrace' })).toBeInTheDocument()
    expect(screen.getByText('Upload logo')).toBeInTheDocument()
    expect(screen.getByText('Cover image')).toBeInTheDocument()
    expect(screen.getByText('No image — active theme gradient')).toBeInTheDocument()
    expect(screen.getByLabelText('WiFi password')).toBeInTheDocument()
    expect(screen.getByText('Google Reviews (automatic reviews)')).toBeInTheDocument()
    expect(divStartingWith(container, 'Find your ')?.textContent).toBe(
      'Find your Place ID here: Place ID Finder. Search for your venue’s name and copy the ID (it starts with “ChIJ…”).',
    )
    expect(screen.getByRole('link', { name: 'Place ID Finder' })).toBeInTheDocument()
    expect(screen.getByText('Configured')).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'en')).toEqual([])
    expect(nodeText(container)).not.toMatch(RO_LETTERS)
  })

  it('TW3: Aspect meniu în germană — teme, Flipbook, limbi, monedă', () => {
    const restaurant = makeRestaurant({
      theme_settings: { preset_id: 'pizzeria', menu_layout: 'flipbook', flipbook_pages: ['https://x.test/p1.webp'] },
      menu_languages: ['en'],
    })
    const { container } = inLang('de', tab('menu', { restaurant }))
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
    expect(screen.getByText('Vorschau')).toBeInTheDocument()
    expect(screen.getByLabelText('Adresse der Speisekarte (Slug)')).toHaveValue('bistro-test')
    expect(screen.getByRole('button', { name: 'Akzentfarbe Gold' })).toHaveAttribute('title', 'Gold')
    expect(screen.getByText('Design der QR-Speisekarte')).toBeInTheDocument()
    expect(screen.getByText('Italienische Pizzeria')).toBeInTheDocument()
    expect(screen.getAllByTitle('Hintergrund').length).toBeGreaterThan(5)
    expect(screen.getByText('Anordnung der Produkte')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Flipbook \(PDF\/Seiten\)/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Seiten der Speisekarte (1/30)')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Seite 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seite 1 nach oben verschieben' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Seite 1 löschen' })).toHaveTextContent('Löschen')
    expect(screen.getByText(/Bestellen über die Speisekarte ist in diesem Stil nicht möglich/)).toBeInTheDocument()
    expect(screen.getByText('Elemente der Speisekarte')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Titelbild' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Badge „Erstellt mit Menuvia“ anzeigen' })).toBeInTheDocument()
    const base = screen.getByLabelText('Originalsprache der Speisekarte')
    expect(within(base).getByRole('option', { name: '🇷🇴 Rumänisch' })).toBeInTheDocument()
    expect(within(base).getByRole('option', { name: '🇫🇷 Französisch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Englisch$/ })).toHaveAttribute('aria-pressed', 'true')
    const cur = screen.getByLabelText('Währung der Speisekarte')
    expect(within(cur).getByRole('option', { name: 'RON (Lei)' })).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'de')).toEqual([])
    expect(nodeText(container)).not.toMatch(RO_LETTERS)
  })

  it('TW4: Comenzi & plăți în franceză — ridicarea pe Flipbook', () => {
    const restaurant = makeRestaurant({
      theme_settings: { preset_id: 'cafe', menu_layout: 'flipbook', flipbook_pages: ['https://x.test/p1.webp'] },
      pickup_settings: {
        enabled: true,
        min_lead_time_minutes: 20,
        slot_interval_minutes: 15,
        open_hours: { start: '09:00', end: '21:00' },
        instructions: null,
        pickup_only: false,
      },
    })
    const { container } = inLang('fr', tab('orders', { restaurant }))
    expect(screen.getByText('Modules optionnels')).toHaveTextContent('enregistré automatiquement')
    expect(screen.getByRole('switch', { name: 'Réservations' })).toBeInTheDocument()
    expect(screen.getByText('Commandes à emporter (click-and-collect)')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Commandes à emporter' })).toHaveAttribute('aria-checked', 'true')
    const desc = divStartingWith(container, 'Commandes à emporter au restaurant, depuis votre page publique ')
    expect(desc?.textContent).toMatch(/\/m\/bistro-test\. Attention : avec le style Flipbook/)
    expect(desc?.textContent?.endsWith('Paramètres → Apparence du menu → Disposition des produits.')).toBe(true)
    expect(screen.queryByText(/les clients peuvent commander depuis votre page publique/)).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Mode « à emporter uniquement » (sans tables)' })).toBeInTheDocument()
    expect(screen.getByText(settingsFr.po_desc)).toBeInTheDocument()
    expect(screen.getByText('Préparation minimum (min)')).toBeInTheDocument()
    expect(screen.getByLabelText('Préparation minimum (minutes)')).toHaveValue(20)
    expect(screen.getByLabelText('Fermeture des commandes à emporter')).toHaveValue('21:00')
    expect(screen.getByPlaceholderText('Ex. : Appelez à votre arrivée, entrée sur le côté')).toBeInTheDocument()
    expect(screen.getByText('📦 À emporter').tagName).toBe('STRONG')
    expect(divStartingWith(container, ' Les commandes à emporter apparaissent')?.textContent).toBe(
      ' Les commandes à emporter apparaissent sur l’écran Cuisine avec le badge 📦 À emporter. Le nom du client et l’heure de retrait sont visibles.',
    )
    expect(screen.getByRole('switch', { name: 'Suggestions au panier' })).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'fr')).toEqual([])
    expect(nodeText(container)).not.toMatch(RO_LETTERS)
  })

  it('TW5: Abonament & cont în engleză', () => {
    const { container } = inLang('en', tab('account', { surface: null, planLoadError: true }))
    expect(screen.getByText('Current plan')).toBeInTheDocument()
    expect(screen.getByText('We couldn’t check the plan')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'en')).toEqual([])
    expect(nodeText(container)).not.toMatch(RO_LETTERS)
  })

  it('TW6: refuzurile serverului — în română mesajul de azi, în engleză fără el', async () => {
    const user = userEvent.setup()
    const SERVER = 'Slug-ul nu poate fi schimbat acum, încearcă mai târziu.'
    // Lotul C7c: schimbarea slug-ului cere confirmare înaintea RPC-ului — omul
    // o acceptă aici (refuzul și textul ei sunt în SettingsTabSave SJ1–SJ3).
    h.confirm.mockImplementation(() => Promise.resolve(true))
    // (a) schimbarea slug-ului respinsă cu text românesc de la server.
    h.changeSlug.mockRejectedValue({ message: SERVER })
    const ro = inLang(null, tab('menu'))
    await user.clear(screen.getByLabelText('Adresa meniului (slug)'))
    await user.type(screen.getByLabelText('Adresa meniului (slug)'), 'nou')
    await user.click(screen.getAllByRole('button', { name: 'Salvează' })[0]!)
    expect(await screen.findByText(SERVER)).toBeInTheDocument()
    ro.unmount()

    const en = inLang('en', tab('menu'))
    await user.clear(screen.getByLabelText('Menu address (slug)'))
    await user.type(screen.getByLabelText('Menu address (slug)'), 'nou')
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!)
    expect(await screen.findByText('Couldn’t change the slug.')).toBeInTheDocument()
    expect(screen.queryByText(SERVER)).not.toBeInTheDocument()
    // Slug ocupat.
    h.changeSlug.mockResolvedValue({ ok: false, reason: 'slug_taken', slug: 'luat' })
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!)
    expect(await screen.findByText('Slug unavailable: “luat” is already in use')).toBeInTheDocument()
    en.unmount()

    // (b) trigger-ul de țară (mig 296): hint `country_owner_only`, 42501.
    const refused = async () => ({
      error: { message: 'Doar proprietarul poate schimba țara', code: '42501', hint: 'country_owner_only' } as unknown as Error,
    })
    const roB = inLang(null, tab('restaurant', { onUpdate: refused }))
    await user.click(screen.getByRole('button', { name: 'Salvează' }))
    expect(await screen.findByText('Nu ai drepturi pentru această acțiune.')).toBeInTheDocument()
    expect(screen.queryByText('Doar proprietarul restaurantului poate schimba țara.')).not.toBeInTheDocument()
    roB.unmount()
    const enB = inLang('en', tab('restaurant', { onUpdate: refused }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Only the restaurant owner can change the country.')).toBeInTheDocument()
    expect(screen.queryByText(/proprietarul/)).not.toBeInTheDocument()
    enB.unmount()

    // (c) modulul refuzat cu text românesc (set_restaurant_module, fără hint).
    const MOD = 'Doar owner sau manager poate activa module'
    const rejecting = () => modules(async () => Promise.reject(new Error(MOD)))
    const roC = inLang(null, tab('orders', { modulesState: rejecting() }))
    await user.click(screen.getByRole('switch', { name: 'Rezervări' }))
    expect(await screen.findByText(MOD)).toBeInTheDocument()
    roC.unmount()
    inLang('en', tab('orders', { modulesState: rejecting() }))
    await user.click(screen.getByRole('switch', { name: 'Reservations' }))
    expect(await screen.findByText('Couldn’t save')).toBeInTheDocument()
    expect(screen.queryByText(MOD)).not.toBeInTheDocument()
  })

  it('TW7: schimbarea limbii pe aceeași rădăcină retraduce; confirmarea în germană', async () => {
    const r = inLang('en', tab('account', { surface: null, planLoadError: true }))
    expect(screen.getByText('We couldn’t check the plan')).toBeInTheDocument()
    r.rerender(tree('de', tab('account', { surface: null, planLoadError: true })))
    expect(screen.getByText('Der Tarif konnte nicht geprüft werden')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
    expect(screen.queryByText('We couldn’t check the plan')).not.toBeInTheDocument()

    r.rerender(tree('de', tab('restaurant')))
    expect(screen.getByLabelText('Mittwoch Öffnungszeit')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Montag → alle kopieren' }))
    expect(h.confirm).toHaveBeenCalledWith({
      title: settingsDe.hours_confirmTitle,
      description: settingsDe.hours_confirmDesc,
      confirmLabel: 'Überschreiben',
      cancelLabel: 'Abbrechen',
      destructive: true,
    })
    r.rerender(tree('fr', tab('restaurant')))
    expect(screen.getByText('Mercredi')).toBeInTheDocument()
    expect(screen.queryByText('Mittwoch')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copier lundi → tous' })).toBeInTheDocument()
  })
})

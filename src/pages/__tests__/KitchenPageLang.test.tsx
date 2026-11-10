// Bucătăria în limba personalului (lotul L4c): antetul, bannerele, coloanele,
// cardul de comandă și nota de refuz citesc namespace-ul `kitchen` (+ `orders`
// pentru cuvintele comune cu ospătarul, `common` pentru vârsta comenzii).
// Prefixul e LB (Limbă, Bucătărie) — verificat cu grep, nefolosit înainte.
//   LB0  control POZITIV al verificării „fără resturi românești”: pe pagina în
//        română chiar găsește bucățile din `kitchen/ro.ts`. Fără el, LB2 ar
//        trece și cu verificarea stricată.
//   LB1  control — fără provider (azi, mereu româna) pagina are EXACT textele
//        de dinainte: titlul cu restaurantul, „Înapoi la panou”, „Epuizate”,
//        notificările, „Se conectează...” (trei puncte), cele trei bannere,
//        lista trunchiată cu 500, eroarea cu detaliul în paranteză, coloanele,
//        pașii („Confirmă” / „Marchează în pregătire” / „Gata”), sursele
//        („QR” / „Pickup” / „Ospătar”), „Fără masă”, vârsta „5m”, „Ieși din cont”; comutatorul de
//        limbă NU apare (o singură limbă activă). Mutația care pică: o cheie din
//        `kitchen/ro.ts` cu textul schimbat (ex. „Se conectează…”).
//   LB2  în engleză: aceleași locuri traduse, comutatorul compact apare în
//        antet (două limbi active în UiLangScope) și NICIUN text românesc al
//        namespace-ului `kitchen` sau al cuvintelor luate din `orders`.
//        Mutația care pică: un literal românesc lăsat în pagină (ex. „Ospătar”
//        scris în cod, sau coloana „Comenzi noi” folosită ca cheie de stare).
//   LB3  în germană: titlul „Küche — Bistro”, pașii la infinitiv, vârsta în
//        formatul limbii („5 Min.”). Mutația care pică: `elapsed()` (româna
//        scrisă în cod) readus în ElapsedTimer.
//   LB4  în franceză, fără comenzi și cu notificările active: starea goală a
//        fiecărei coloane, indiciul de pe „Nouvelles commandes”, „Connecté”,
//        „Activées”. Mutația care pică: iconița/indiciul stării goale deduse
//        din eticheta românească a coloanei (codul de dinainte compara
//        `col.label === 'Comenzi noi'`).
//   LB5  nota de refuz de pe card: un refuz cu hint cunoscut
//        (`invalid_transition`) se citește în ENGLEZĂ, iar mesajul românesc
//        brut al serverului nu ajunge pe ecran; un hint necunoscut cade pe
//        textul generic; control în română (textul de dinainte). Mutația care
//        pică: nota care afișează un text calculat în `useOrders` (contractul
//        de dinainte, în română) în loc să traducă DATELE la randare.
//   LB6  precondiția din L4b: pagina cere `orders` și `common` SUS, înaintea
//        oricărui return timpuriu (nota de refuz, detaliile de ridicare și
//        panoul „Epuizate” sunt montate condiționat), iar namespace-urile
//        panoului „Epuizate” sunt un subset din cele cerute sus de AMBELE
//        ecrane care îl deschid. Mutația care pică: `useT(ordersNs)` scos din
//        KitchenPage (prima eroare de pe un card ar suspenda tot ecranul).
import { Suspense, type ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { Order, OrderStatus, StaffActionFailure } from '../../lib/orders'

const h = vi.hoisted(() => ({
  useOrders: vi.fn(),
  useCtx: vi.fn(),
  usePush: vi.fn(),
  useAudio: vi.fn(),
}))
vi.mock('../../contexts/RestaurantContext', () => ({ useRestaurantCtx: h.useCtx }))
vi.mock('../../hooks/useOrders', () => ({ useOrders: h.useOrders }))
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: h.usePush }))
vi.mock('../../hooks/useAudioUnlock', () => ({ useAudioUnlock: h.useAudio }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, signOut: vi.fn(), refreshProfile: vi.fn() }),
}))
vi.mock('../../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/utils')>()
  return { ...actual, playSound: vi.fn() }
})

import KitchenPage, { KitchenOrderCard } from '../KitchenPage'
import { makeOrder, makeTable } from '../../components/__tests__/fixtures'
import { staffActionFailure } from '../../lib/orders'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { kitchenNs } from '../../i18n/ns/kitchen'
import { ordersNs } from '../../i18n/ns/orders'
import { commonNs } from '../../i18n/ns/common'
import kitchenRo from '../../i18n/ns/kitchen/ro'
import kitchenEn from '../../i18n/ns/kitchen/en'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

const NOW = new Date('2026-07-20T09:20:00Z')

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(
    langs.flatMap((l) => [
      preloadNamespace(kitchenNs, l),
      preloadNamespace(ordersNs, l),
      preloadNamespace(commonNs, l),
    ]),
  )
})

function inLang(lang: StaffLang | null, node: ReactNode) {
  const tree = <Suspense fallback={null}>{node}</Suspense>
  return render(lang ? <UiLangScope lang={lang}>{tree}</UiLangScope> : tree)
}

/** Bucățile fixe (≥ 6 caractere) ale textelor din `kitchen/ro.ts` rămase în
 *  text, fără cele identice în limba țintă. */
function romanianLeftovers(text: string, target: Dict): string[] {
  const forms = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  for (const [k, v] of Object.entries(kitchenRo as Dict)) {
    const own = forms(target[k]).join('\n')
    for (const f of forms(v)) {
      for (const piece of f.split(/\{\w+\}/)) {
        const p = piece.trim()
        if (p.length >= 6 && !own.includes(p) && text.includes(p)) out.push(`${k}: ${p}`)
      }
    }
  }
  return out
}

function busyKitchen(): Order[] {
  return [
    makeOrder({ id: 'A', status: 'new', source: 'qr', table: makeTable({ name: '7' }), created_at: '2026-07-20T09:15:00Z' }),
    makeOrder({ id: 'B', status: 'confirmed', source: 'waiter', created_at: '2026-07-20T09:18:00Z' }),
    makeOrder({ id: 'C', status: 'preparing', source: 'pickup', customer_name: 'Ana Pop', created_at: '2026-07-20T09:12:00Z' }),
    makeOrder({ id: 'D', status: 'ready', source: 'waiter', table: makeTable({ name: '3' }), created_at: '2026-07-20T09:11:00Z' }),
  ]
}

function setup(
  orders: Order[],
  opts: {
    error?: string | null
    truncated?: boolean
    connection?: 'connected' | 'connecting' | 'disconnected'
    pushSubscribed?: boolean
    soundLocked?: boolean
    actionErrors?: Record<string, StaffActionFailure>
  } = {},
) {
  h.useOrders.mockReturnValue({
    orders,
    loading: false,
    error: opts.error ?? null,
    truncated: opts.truncated ?? false,
    snapshotFor: 'r1',
    connectionStatus: opts.connection ?? 'connected',
    advance: vi.fn(),
    byStatus: (statuses: OrderStatus[]) => orders.filter((o) => statuses.includes(o.status)),
    pendingIds: new Set<string>(),
    actionErrors: opts.actionErrors ?? {},
    dismissActionError: vi.fn(),
  })
  h.usePush.mockReturnValue({
    supported: true,
    permission: opts.pushSubscribed ? 'granted' : 'default',
    subscribed: opts.pushSubscribed ?? false,
    loading: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  })
  h.useAudio.mockReturnValue({ locked: opts.soundLocked ?? false, unlock: vi.fn() })
}

const BUSY = { error: 'boom', truncated: true, connection: 'connecting', soundLocked: true } as const

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  h.useCtx.mockReturnValue({
    activeId: 'r1',
    activeName: 'Bistro',
    activeRole: 'owner',
    memberships: [],
    setActive: vi.fn(),
    loading: false,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Bucătăria în limba personalului', () => {
  it('LB0: control pozitiv al verificării „fără text românesc”', () => {
    setup(busyKitchen(), BUSY)
    const { container } = inLang(null, <KitchenPage />)
    const found = romanianLeftovers(container.textContent ?? '', kitchenEn as Dict)
    expect(found.length).toBeGreaterThan(5)
    expect(found.some((f) => f.startsWith('sound_locked:'))).toBe(true)
  })

  it('LB1: control — fără provider, româna de dinainte', () => {
    setup(busyKitchen(), BUSY)
    const { container } = inLang(null, <KitchenPage />)
    expect(screen.getByRole('heading', { name: 'Bucătărie — Bistro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Înapoi la panou' })).toHaveAttribute(
      'title',
      'Înapoi la panoul de administrare',
    )
    expect(screen.getByRole('button', { name: 'Produse epuizate — marchează ce s-a terminat' })).toHaveTextContent(
      'Epuizate',
    )
    const push = screen.getByRole('button', { name: 'Activează notificările pentru comenzi noi' })
    expect(push).toHaveTextContent('Notificări')
    expect(push).toHaveAttribute('title', 'Activează notificările pentru comenzi noi')
    expect(screen.getByText('Se conectează...')).toBeInTheDocument()
    expect(container).toHaveTextContent(
      'Activează notificările ca să primești alerte pentru comenzi noi, chiar și cu tab-ul închis.',
    )
    expect(screen.getByRole('button', { name: 'Activează →' })).toBeInTheDocument()
    expect(container).toHaveTextContent(
      'Sunetul pentru comenzile noi e oprit de browser până atingi ecranul o dată.',
    )
    expect(screen.getByRole('button', { name: 'Pornește sunetul' })).toBeInTheDocument()
    expect(container).toHaveTextContent(
      'Se afișează doar cele mai noi 500 comenzi active — finalizează comenzile vechi ca lista să fie completă.',
    )
    expect(container).toHaveTextContent(
      'Nu am putut sincroniza comenzile. Verifică conexiunea și reîncearcă. (boom)',
    )
    expect(screen.getByRole('button', { name: 'Închide mesajul de eroare' })).toBeInTheDocument()
    for (const col of ['Comenzi noi', 'În pregătire', 'Gata de servit']) {
      expect(screen.getByText(col)).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Confirmă' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marchează în pregătire' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gata' })).toBeInTheDocument()
    expect(screen.getByText('QR')).toBeInTheDocument()
    expect(screen.getByText('Pickup')).toBeInTheDocument()
    expect(screen.getAllByText('Ospătar')).toHaveLength(2)
    // B (ospătar, fără masă) și C (ridicare).
    expect(screen.getAllByText('Fără masă')).toHaveLength(2)
    expect(screen.getByText('5m')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ieși din cont' })).toBeInTheDocument()
    // O singură limbă activă (azi): comutatorul nu se vede.
    expect(screen.queryByRole('combobox', { name: 'Limba interfeței' })).toBeNull()
  })

  it('LB2: în engleză — textele traduse, comutatorul în antet, fără resturi românești', () => {
    setup(busyKitchen(), BUSY)
    const { container } = inLang('en', <KitchenPage />)
    expect(screen.getByRole('heading', { name: 'Kitchen — Bistro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to dashboard' })).toHaveAttribute(
      'title',
      'Back to the admin dashboard',
    )
    expect(screen.getByRole('button', { name: 'Sold-out items — mark what has run out' })).toHaveTextContent(
      'Sold out',
    )
    expect(screen.getByRole('button', { name: 'Turn on notifications for new orders' })).toHaveTextContent(
      'Notifications',
    )
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
    expect(container).toHaveTextContent(
      'Turn on notifications to get alerts for new orders, even with the tab closed.',
    )
    expect(screen.getByRole('button', { name: 'Turn on →' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on sound' })).toBeInTheDocument()
    expect(container).toHaveTextContent(
      'Only the 500 most recent active orders are shown — finish older orders so the list shows everything.',
    )
    // Detaliul tehnic al erorii rămâne în paranteză (date, netradus).
    expect(container).toHaveTextContent('We couldn’t sync the orders. Check your connection and try again. (boom)')
    expect(screen.getByRole('button', { name: 'Dismiss the error message' })).toBeInTheDocument()
    for (const col of ['New orders', 'Preparing', 'Ready to serve']) {
      expect(screen.getByText(col)).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark as preparing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ready' })).toBeInTheDocument()
    expect(screen.getAllByText('Waiter')).toHaveLength(2)
    expect(screen.getAllByText('No table')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    // Comutatorul compact (două limbi active în UiLangScope): numele limbilor în limba lor.
    const sel = screen.getByRole('combobox', { name: 'Interface language' }) as HTMLSelectElement
    expect(sel.value).toBe('en')
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['Română', 'English'])

    const text = container.textContent ?? ''
    expect(romanianLeftovers(text, kitchenEn as Dict)).toEqual([])
    // Cuvintele luate din `orders` / `common` (nu sunt în `kitchen/ro.ts`).
    for (const ro of ['Fără masă', 'Se salvează', 'Marchează în pregătire', 'Confirmă', 'Ospătar', 'Ieși din cont']) {
      expect(text, ro).not.toContain(ro)
    }
  })

  it('LB3: în germană — titlul, pașii la infinitiv și vârsta în formatul limbii', () => {
    setup(busyKitchen(), BUSY)
    const { container } = inLang('de', <KitchenPage />)
    expect(screen.getByRole('heading', { name: 'Küche — Bistro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bestätigen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'In Zubereitung setzen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fertig' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ton einschalten' })).toBeInTheDocument()
    expect(screen.getByText('Neue Bestellungen')).toBeInTheDocument()
    expect(screen.getByText('Abholung')).toBeInTheDocument()
    expect(screen.getAllByText('Ohne Tisch')).toHaveLength(2)
    expect(screen.getByText('5 Min.')).toBeInTheDocument()
    expect(screen.queryByText('5m')).toBeNull()
    expect(romanianLeftovers(container.textContent ?? '', kitchenEn as Dict)).toEqual([])
  })

  it('LB4: în franceză, fără comenzi — starea goală pe fiecare coloană', () => {
    setup([], { pushSubscribed: true })
    inLang('fr', <KitchenPage />)
    expect(screen.getAllByText('Aucune commande')).toHaveLength(3)
    // Indiciul stă DOAR pe prima coloană (fostul `col.label === 'Comenzi noi'`).
    expect(screen.getAllByText('Les commandes passées par QR apparaîtront ici automatiquement.')).toHaveLength(1)
    expect(screen.getByText('Nouvelles commandes')).toBeInTheDocument()
    expect(screen.getByText('Connecté')).toBeInTheDocument()
    const push = screen.getByRole('button', { name: 'Notifications activées — désactiver' })
    expect(push).toHaveTextContent('Activées')
    expect(push).toHaveAttribute('title', 'Notifications activées — cliquez pour les désactiver')
    expect(screen.queryByText('Nicio comandă')).toBeNull()
  })
})

describe('nota de refuz de pe cardul de bucătărie', () => {
  // Un mesaj ROMÂNESC al serverului: nu are voie să apară pe ecran (nici în
  // română — nota arată textul hint-ului, ca înainte — nici în engleză).
  const RAW = 'Comanda nu mai poate fi pregătită: a fost deja servită de alt coleg'
  const refused = staffActionFailure(Object.assign(new Error(RAW), { hint: 'invalid_transition' }))

  it('LB5: hint cunoscut → engleză; hint necunoscut → generic; control în română', () => {
    const order = makeOrder({ id: 'A', status: 'preparing', created_at: '2026-07-20T09:15:00Z' })
    const en = inLang('en', <KitchenOrderCard order={order} onAdvance={vi.fn()} actionError={refused} onDismissError={vi.fn()} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(
      'The order changed in the meantime — a colleague has probably moved it already.',
    )
    expect(alert.textContent).not.toContain(RAW)
    expect(alert.textContent).not.toMatch(/Comanda|între timp/)
    expect(within(alert).getByRole('button', { name: 'Dismiss the message' })).toBeInTheDocument()
    en.unmount()

    const unknown = staffActionFailure(Object.assign(new Error(RAW), { hint: 'teleport' }))
    const gen = inLang('en', <KitchenOrderCard order={order} onAdvance={vi.fn()} actionError={unknown} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The action wasn’t saved. Please try again.')
    gen.unmount()

    inLang(null, <KitchenOrderCard order={order} onAdvance={vi.fn()} actionError={refused} onDismissError={vi.fn()} />)
    const ro = screen.getByRole('alert')
    expect(ro).toHaveTextContent('Comanda s-a schimbat între timp — probabil a mutat-o deja un coleg.')
    expect(ro.textContent).not.toContain(RAW)
    expect(within(ro).getByRole('button', { name: 'Închide mesajul' })).toBeInTheDocument()
  })
})

describe('precondiția L4b: namespace-urile componentelor montate condiționat', () => {
  const ROOT = process.cwd()
  const src = (f: string): string => readFileSync(resolve(ROOT, f), 'utf8')
  /** Namespace-urile cerute prin `useT(xNs)` într-un text. */
  const nsUsed = (s: string): Set<string> => new Set([...s.matchAll(/useT\((\w+Ns)\)/g)].map((m) => m[1]))
  /** Corpul unei funcții de pagină, până la primul `return` de pe nivelul ei. */
  function topOfPage(file: string, fn: string): string {
    const s = src(file)
    const start = s.indexOf(`export default function ${fn}(`)
    expect(start, `${fn} în ${file}`).toBeGreaterThan(-1)
    const body = s.slice(start)
    const firstReturn = body.search(/\n {2}(if \([^\n]*\) \{\n {4})?return\b/)
    expect(firstReturn).toBeGreaterThan(0)
    return body.slice(0, firstReturn)
  }

  it('LB6: Bucătăria și Ospătarul cer sus tot ce cer nota, ridicarea și panoul „Epuizate”', () => {
    const kitchenTop = nsUsed(topOfPage('src/pages/KitchenPage.tsx', 'KitchenPage'))
    const waiterTop = nsUsed(topOfPage('src/pages/WaiterPage.tsx', 'WaiterPage'))
    // Controlul pozitiv al extragerii: fiecare pagină își cere propriul namespace.
    expect(kitchenTop.has('kitchenNs')).toBe(true)
    expect(waiterTop.has('waiterNs')).toBe(true)
    const conditional = [
      'src/components/ActionErrorNote.tsx',
      'src/components/PickupDetails.tsx',
      'src/components/StaffSoldOutSheet.tsx',
      'src/components/UiLanguageSelect.tsx',
    ]
    for (const f of conditional) {
      const used = nsUsed(src(f))
      expect(used.size, f).toBeGreaterThan(0)
      for (const ns of used) {
        expect(kitchenTop.has(ns), `KitchenPage nu cere sus ${ns} (${f})`).toBe(true)
        expect(waiterTop.has(ns), `WaiterPage nu cere sus ${ns} (${f})`).toBe(true)
      }
    }
  })
})

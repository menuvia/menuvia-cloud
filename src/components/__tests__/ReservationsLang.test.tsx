// Fila Rezervări în limba personalului (lotul L6a): ReservationsTab (contorul
// intervalului, „Butonul tău Google”, secțiunea „Neconfirmate / expirate” din
// mig 289, filtrele, lista pe zile, cardul rezervării cu statusul, badge-ul de
// no-show și acțiunile, confirmările, mesajele de după acțiune, setările)
// citește namespace-ul `reservations` (+ „Reîncearcă”/„Anulează” din
// `common`). Partea pură e în src/lib/__tests__/reservationsLang.test.ts
// (RV7–RV11). (Prefixul RV: verificat cu grep în src/, tests/ și
// supabase/tests, nefolosit înainte.)
//   RV0  control POZITIV al verificării „fără text românesc”: fila randată în
//        română, comparată cu dicționarul englez, ARE resturi.
//   RV1  fără provider (azi, mereu româna): textele de dinainte — „3 rezervări
//        în interval”, „Neconfirmate / expirate: 1 rezervare din trecut”, ziua
//        și ora în formatul „ro-RO”, statusul = `RESERVATION_STATUS_LABEL`,
//        „· 21 de persoane”, „⚠ 2 no-show” cu titlul lui, „· zonă cerută: …”,
//        cererea specială între ghilimele DREPTE, pașii Google (textContent
//        identic cu JSX-ul de dinainte). Mutația care pică: `party: { other:
//        '{n} persoane' }` în ro sau `<b>` scos din pasul 2.
//   RV2  fila în engleză, cu secțiunea de nerezolvate și setările deschise:
//        textele, statusul, ziua în formatul limbii, opțiunile select-urilor,
//        fără resturi românești (pe NODURILE de text și în aria-label/title).
//        Mutația care pică: `{STATUS_LABEL[r.status]}` readus în card sau
//        `formatDay` cu `'ro-RO'` fix.
//   RV3  confirmările în germană, franceză și română: titlul, descrierea,
//        `confirmLabel` ȘI `cancelLabel` EXPLICITE. Mutația care pică:
//        `cancelLabel` scos (dialogul ar cădea pe limba paginii).
//   RV4  refuzul serverului la schimbarea statusului: în română EXACT
//        `toUserMessage(err, 'Rezervarea nu a putut fi actualizată.')`; în
//        engleză rezerva tradusă, fără mesajul românesc al serverului; succesul
//        în germană. Mutația care pică: `toUserMessage` readus în handleStatus.
//   RV5  erorile de încărcare (lista + setările) se retraduc la schimbarea
//        limbii pe ACEEAȘI rădăcină `UiLangScope` (en → de), cu butonul de
//        reîncercare din `common`. Mutația care pică: textul de eroare compus o
//        dată, la montare.
//   RV6  stările goale și salvarea refuzată a setărilor, în franceză (rezerva
//        tradusă, fără mesajul serverului); în română EXACT `toUserMessage(err,
//        'Rezervarea nu a putut fi salvată.')`.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Reservation, ReservationSettings } from '../../hooks/useReservations'
import type { ConfirmOptions } from '../ui/confirm'

const h = vi.hoisted(() => ({
  reservations: [] as Reservation[],
  stale: [] as Reservation[],
  listError: null as unknown,
  settings: null as ReservationSettings | null,
  settingsError: null as unknown,
  updateError: null as unknown,
  saveError: null as unknown,
  confirm: [] as ConfirmOptions[],
  toast: {
    success: [] as string[],
    error: [] as string[],
  },
}))

vi.mock('../ui/confirm', () => ({
  // Răspunsul e „nu”: testele verifică doar ce vede omul în dialog.
  confirm: async (o: ConfirmOptions) => {
    h.confirm.push(o)
    return false
  },
}))
vi.mock('../ui/useToast', () => {
  const api = {
    success: (m: string) => h.toast.success.push(m),
    error: (m: string) => h.toast.error.push(m),
    warning: () => {},
    info: () => {},
    dismiss: () => {},
  }
  return { useToast: () => api }
})
vi.mock('../../lib/supabase', () => {
  const restaurants = {
    select: () => restaurants,
    eq: () => restaurants,
    maybeSingle: async () => ({ data: { slug: 'bistro' }, error: null }),
  }
  return {
    supabase: {
      from: () => restaurants,
      rpc: () => ({
        then: (cb: (v: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: [{ phone_key: '722111222', no_show_count: 2 }], error: null }).then(cb),
      }),
    },
  }
})
vi.mock('../../hooks/useReservations', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../hooks/useReservations')>()
  const refetch = async () => {}
  return {
    ...real,
    // Aceleași REFERINȚE la fiecare randare (efectul de no-show depinde de listă).
    useReservations: () => ({
      reservations: h.reservations,
      loading: false,
      error: h.listError,
      refetch,
      updateStatus: async () => {
        if (h.updateError) throw h.updateError
      },
    }),
    useStaleReservations: () => ({ rows: h.stale, refetch }),
    useReservationSettings: () => ({
      settings: h.settings,
      loading: false,
      error: h.settingsError,
      refetch,
      save: async () => {
        if (h.saveError) throw h.saveError
      },
    }),
  }
})

import ReservationsTab from '../ReservationsTab'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { reservationsNs } from '../../i18n/ns/reservations'
import { commonNs } from '../../i18n/ns/common'
import resvRo from '../../i18n/ns/reservations/ro'
import resvEn from '../../i18n/ns/reservations/en'
import resvFr from '../../i18n/ns/reservations/fr'
import resvDe from '../../i18n/ns/reservations/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'
import { RESERVATION_STATUS_LABEL } from '../../lib/reservations'
import { toUserMessage } from '../../lib/userMessages'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(reservationsNs, l), preloadNamespace(commonNs, l)]))
})

const ISO = '2026-11-12T18:30:00.000Z'
const DAY_OPTS = { weekday: 'long', day: 'numeric', month: 'long' } as const
const TIME_OPTS = { hour: '2-digit', minute: '2-digit' } as const

function resv(over: Partial<Reservation>): Reservation {
  return {
    id: 'r1',
    restaurant_id: 'rest-1',
    table_id: null,
    customer_name: 'Ana Pop',
    customer_phone: '0722 111 222',
    customer_email: 'ana@example.com',
    party_size: 4,
    special_requests: null,
    starts_at: ISO,
    ends_at: '2026-11-12T20:00:00.000Z',
    status: 'pending',
    source: 'public',
    reminder_sent_at: null,
    confirmation_code: 'ABC123',
    requested_zone: null,
    created_at: '2026-11-01T10:00:00.000Z',
    updated_at: '2026-11-01T10:00:00.000Z',
    table: null,
    ...over,
  }
}

const SETTINGS: ReservationSettings = {
  id: 's1',
  restaurant_id: 'rest-1',
  open_days: [1, 2, 3, 4, 5],
  open_time: '12:00:00',
  close_time: '23:00:00',
  slot_interval: 15,
  reservation_duration: 90,
  min_advance_hours: 2,
  max_advance_days: 30,
  max_party_size: 10,
  auto_confirm: true,
  reminder_hours_before: 0,
}

beforeEach(() => {
  h.reservations = [
    resv({ requested_zone: 'Terasă', special_requests: 'Lângă fereastră' }),
    resv({
      id: 'r2',
      customer_name: 'Ion Ionescu',
      customer_phone: '0733 000 000',
      party_size: 21,
      status: 'confirmed',
      table: { id: 't5', name: 'Masa 5', seats: 4, zone: 'Salon' },
    }),
    resv({ id: 'r3', customer_name: 'Dan', customer_phone: '0744 000 000', party_size: 1, status: 'seated' }),
  ]
  h.stale = [resv({ id: 's1', customer_name: 'Vechi', customer_phone: '0755 000 000', party_size: 2 })]
  h.listError = null
  h.settings = SETTINGS
  h.settingsError = null
  h.updateError = null
  h.saveError = null
  h.confirm = []
  h.toast.success = []
  h.toast.error = []
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))
const tab = () => <ReservationsTab restaurantId="rest-1" />

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [resvEn as Dict, commonEn as Dict],
  fr: [resvFr as Dict, commonFr as Dict],
  de: [resvDe as Dict, commonDe as Dict],
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
// Textul pe NODURI, despărțite prin „\n” (capcana (b) din L5a2: `textContent`
// lipește textele elementelor vecine, iar granița de cuvânt ar rata resturi).
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}

/** Fragmentele românești ale lui `reservations` + `common` rămase în text (fără
 *  cele identice în limba țintă), pe bucățile fixe de cel puțin 6 caractere,
 *  ca cuvinte întregi. */
function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [resvRo as Dict, commonRo as Dict]
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

function visibleText(root: HTMLElement): string {
  const attrs = [...root.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  )
  return [nodeText(root), ...attrs].join('\n')
}

/** Deschide tot ce e pliat: pașii Google, secțiunea de nerezolvate, setările. */
async function openAll(user: ReturnType<typeof userEvent.setup>, labels: {
  steps: string
  stale: string
  settings: string
}): Promise<void> {
  await user.click(await screen.findByRole('button', { name: labels.steps }))
  await user.click(screen.getByRole('button', { name: new RegExp(escapeRe(labels.stale)) }))
  await user.click(screen.getByRole('button', { name: labels.settings }))
}

describe('fila Rezervări în limba personalului', () => {
  it('RV0: control pozitiv — fila românească are resturi față de engleză', async () => {
    const user = userEvent.setup()
    const { container } = inLang(null, tab())
    await openAll(user, { steps: 'Cum îl pun pe Google?', stale: 'Neconfirmate', settings: 'Setări rezervări' })
    const left = romanianLeftovers(visibleText(container), 'en')
    expect(left.length).toBeGreaterThan(5)
    expect(left.some((l) => l.startsWith('stale_desc:'))).toBe(true)
    expect(left.some((l) => l.startsWith('set_maxAdvance:'))).toBe(true)
  })

  it('RV1: fără provider, româna de dinainte', async () => {
    const user = userEvent.setup()
    const { container } = inLang(null, tab())
    expect(screen.getByText('3 rezervări în interval')).toBeInTheDocument()
    expect(screen.getByText('Neconfirmate / expirate: 1 rezervare din trecut')).toBeInTheDocument()
    expect(screen.getByText('Arată')).toBeInTheDocument()
    expect(screen.getByText(new Date(ISO).toLocaleDateString('ro-RO', DAY_OPTS))).toBeInTheDocument()
    expect(screen.getAllByText(new Date(ISO).toLocaleTimeString('ro-RO', TIME_OPTS))).toHaveLength(3)
    expect(screen.getByText(RESERVATION_STATUS_LABEL.pending)).toBeInTheDocument()
    expect(screen.getByText(RESERVATION_STATUS_LABEL.confirmed)).toBeInTheDocument()
    expect(screen.getByText(RESERVATION_STATUS_LABEL.seated)).toBeInTheDocument()
    expect(screen.getByText('· 4 persoane')).toBeInTheDocument()
    expect(screen.getByText('· 21 de persoane')).toBeInTheDocument()
    expect(screen.getByText('· 1 persoană')).toBeInTheDocument()
    const badge = await screen.findByText('⚠ 2 no-show')
    expect(badge).toHaveAttribute('title', 'Acest număr de telefon are 2 no-show în istoric')
    expect(screen.getByText('· zonă cerută: Terasă')).toBeInTheDocument()
    expect(screen.getByText('"Lângă fereastră"')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmă' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Așază la masă' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Finalizează' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No-show' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Anulează' })).toHaveLength(3)
    for (const f of ['Azi', 'Mâine', 'Săptămâna asta', 'Reîmprospătează'])
      expect(screen.getByRole('button', { name: f })).toBeInTheDocument()
    expect(screen.getByLabelText('Alege o zi anume')).toBeInTheDocument()
    expect(screen.getByText('Doar în așteptare')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Rezervări neconfirmate sau expirate' })).toBeInTheDocument()

    expect(await screen.findByText('Butonul tău Google')).toBeInTheDocument()
    expect(screen.getByText(`${window.location.origin}/rezervare/bistro`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cum îl pun pe Google?' }))
    const steps = [...container.querySelectorAll('ol > li')]
    expect(steps.map((li) => li.textContent)).toEqual([
      'Intră pe business.google.com cu contul care administrează profilul localului (dacă nu l-ai revendicat încă, apasă „Deții această companie?" pe fișa din Google).',
      'Alege profilul → Editează profilul → secțiunea Rezervări → adaugă linkul de mai sus.',
      'Salvează — în câteva zile, butonul de rezervare apare pe Google Search și Maps. Detalii: docs/GOOGLE_REZERVARI.md.',
    ])
    expect([...steps[1]!.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['Editează profilul', 'Rezervări'])
    expect(steps[2]!.querySelector('code')?.textContent).toBe('docs/GOOGLE_REZERVARI.md')
    expect(screen.getByRole('button', { name: 'Ascunde pașii' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Setări rezervări' }))
    expect(screen.getByText('Se poate rezerva cu maxim (zile înainte)')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '15 min' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '6h' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Fără' })).toBeInTheDocument()
    expect(screen.getByText('Activat')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvează setări' })).toBeInTheDocument()
  })

  it('RV2: fila în engleză, fără resturi românești', async () => {
    const user = userEvent.setup()
    const { container } = inLang('en', tab())
    expect(screen.getByText('3 reservations in this period')).toBeInTheDocument()
    expect(screen.getByText(new Date(ISO).toLocaleDateString('en-GB', DAY_OPTS))).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText('Seated')).toBeInTheDocument()
    expect(screen.getByText('· 4 guests')).toBeInTheDocument()
    expect(screen.getByText('· 21 guests')).toBeInTheDocument()
    expect(screen.getByText('· 1 guest')).toBeInTheDocument()
    const badge = await screen.findByText('⚠ 2 no-shows')
    expect(badge).toHaveAttribute('title', 'This phone number has 2 no-shows on record')
    expect(screen.getByText('· requested area: Terasă')).toBeInTheDocument()
    expect(screen.getByText('“Lângă fereastră”')).toBeInTheDocument()
    for (const b of ['Confirm', 'Complete', 'No-show', 'Today', 'Tomorrow', 'This week', 'Refresh'])
      expect(screen.getByRole('button', { name: b })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Seat at a table' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(3)
    expect(screen.getByText('Pending only')).toBeInTheDocument()
    expect(await screen.findByText('Your Google button')).toBeInTheDocument()

    await openAll(user, { steps: 'How do I add it to Google?', stale: 'Unconfirmed / expired', settings: 'Reservation settings' })
    expect(screen.getByText('Unconfirmed / expired: 1 past reservation')).toBeInTheDocument()
    expect(screen.getByText('Hide')).toBeInTheDocument()
    expect(screen.getByText(resvEn.stale_desc)).toBeInTheDocument()
    // Cardul din secțiunea de nerezolvate are și ziua, în formatul limbii.
    expect(screen.getAllByText(new Date(ISO).toLocaleDateString('en-GB', DAY_OPTS))).toHaveLength(2)
    const steps = [...container.querySelectorAll('ol > li')].map((li) => li.textContent)
    expect(steps[1]).toBe('Choose the profile → Edit profile → the Reservations section → add the link above.')
    expect(screen.getByText('Book at most (days ahead)')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '15 min' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '6h' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument()
    expect(screen.getByText('On')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Unconfirmed or expired reservations' })).toBeInTheDocument()

    expect(romanianLeftovers(visibleText(container), 'en')).toEqual([])
    expect(container.textContent).not.toMatch(/În așteptare|persoane|rezervări|Setări/)
  })

  it('RV3: confirmările cu etichetele explicite (de, fr, ro)', async () => {
    const user = userEvent.setup()
    const de = inLang('de', tab())
    await user.click(screen.getAllByRole('button', { name: 'Stornieren' })[0]!)
    await waitFor(() => expect(h.confirm).toHaveLength(1))
    expect(h.confirm[0]).toEqual({
      title: 'Reservierung stornieren?',
      description: 'Diese Aktion kann in der App nicht rückgängig gemacht werden.',
      confirmLabel: 'Reservierung stornieren',
      cancelLabel: 'Abbrechen',
      destructive: true,
    })
    de.unmount()

    const fr = inLang('fr', tab())
    await user.click(screen.getByRole('button', { name: 'Absent' }))
    await waitFor(() => expect(h.confirm).toHaveLength(2))
    expect(h.confirm[1]).toMatchObject({
      title: 'Marquer comme absent (no-show) ?',
      confirmLabel: 'Marquer absent',
      cancelLabel: 'Annuler',
    })
    fr.unmount()

    inLang(null, tab())
    await user.click(screen.getAllByRole('button', { name: 'Anulează' })[0]!)
    await waitFor(() => expect(h.confirm).toHaveLength(3))
    expect(h.confirm[2]).toEqual({
      title: 'Anulezi rezervarea?',
      description: 'Acțiunea nu poate fi anulată din aplicație.',
      confirmLabel: 'Anulează rezervarea',
      cancelLabel: 'Anulează',
      destructive: true,
    })
    // Răspunsul „nu”: nicio schimbare, niciun mesaj.
    expect(h.toast.success).toEqual([])
  })

  it('RV4: refuzul serverului — româna de dinainte, engleza fără mesajul serverului', async () => {
    const serverRo = 'Rezervarea nu mai poate fi modificată acum.'
    h.updateError = { message: serverRo, code: 'P0001' }
    const user = userEvent.setup()

    const ro = inLang(null, tab())
    await user.click(screen.getByRole('button', { name: 'Confirmă' }))
    await waitFor(() => expect(h.toast.error).toHaveLength(1))
    expect(h.toast.error[0]).toBe(toUserMessage(h.updateError, 'Rezervarea nu a putut fi actualizată.'))
    ro.unmount()

    const en = inLang('en', tab())
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(h.toast.error).toHaveLength(2))
    expect(h.toast.error[1]).toBe(resvEn.err_update)
    expect(h.toast.error[1]).not.toContain(serverRo)
    en.unmount()

    h.updateError = null
    inLang('de', tab())
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }))
    await waitFor(() => expect(h.toast.success).toEqual(['Reservierung bestätigt']))
  })

  it('RV5: erorile de încărcare se retraduc pe aceeași rădăcină', async () => {
    h.listError = new Error('fetch failed')
    h.settingsError = new Error('fetch failed')
    const node = tab()
    const { rerender } = render(tree('en', node))
    expect(screen.getByText('We couldn’t load the reservations.')).toBeInTheDocument()
    expect(screen.getByText('We couldn’t load the reservation settings.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: commonEn.retry })).toHaveLength(2)

    rerender(tree('de', node))
    expect(await screen.findByText('Die Reservierungen konnten nicht geladen werden.')).toBeInTheDocument()
    expect(screen.getByText('Die Reservierungseinstellungen konnten nicht geladen werden.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: commonDe.retry })).toHaveLength(2)
    expect(screen.queryByText('We couldn’t load the reservations.')).not.toBeInTheDocument()

    rerender(tree('ro', node))
    expect(await screen.findByText('Nu am putut încărca rezervările.')).toBeInTheDocument()
    expect(screen.getByText('Nu am putut încărca setările de rezervări.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Reîncearcă' })).toHaveLength(2)
  })

  it('RV6: stările goale și salvarea refuzată a setărilor (fr, ro)', async () => {
    const user = userEvent.setup()
    h.reservations = [h.reservations[1]!] // doar „confirmed”
    const fr = inLang('fr', tab())
    expect(screen.getByText('1 réservation sur la période')).toBeInTheDocument()
    await user.click(screen.getByLabelText('En attente uniquement'))
    expect(screen.getByText('Aucune réservation en attente')).toBeInTheDocument()
    expect(screen.getByText(resvFr.empty_pendingDesc)).toBeInTheDocument()

    const serverRo = 'Setările nu pot fi modificate de acest rol.'
    h.saveError = { message: serverRo, code: 'P0001' }
    await user.click(screen.getByRole('button', { name: 'Réglages des réservations' }))
    expect(screen.getByRole('option', { name: '6 h' })).toBeInTheDocument()
    expect(screen.getByText('Activée')).toBeInTheDocument()
    await user.selectOptions(screen.getByDisplayValue('15 min'), '30')
    await user.click(screen.getByRole('button', { name: 'Enregistrer les réglages' }))
    await waitFor(() => expect(h.toast.error).toEqual([resvFr.settings_saveError]))
    expect(romanianLeftovers(visibleText(fr.container), 'fr')).toEqual([])
    fr.unmount()

    h.reservations = []
    inLang(null, tab())
    expect(screen.getByText('Nicio rezervare în intervalul ales')).toBeInTheDocument()
    expect(screen.getByText('Schimbă filtrul de dată sau verifică setările')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Setări rezervări' }))
    await user.selectOptions(screen.getByDisplayValue('15 min'), '30')
    await user.click(screen.getByRole('button', { name: 'Salvează setări' }))
    await waitFor(() => expect(h.toast.error).toHaveLength(2))
    expect(h.toast.error[1]).toBe(toUserMessage(h.saveError, 'Rezervarea nu a putut fi salvată.'))
  })
})

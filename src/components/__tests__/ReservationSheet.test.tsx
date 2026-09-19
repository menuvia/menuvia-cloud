// Teste pe ReservationSheet — ramura „rând mort" (RESID-32).
//
// De ce există fișierul: `R12` din `reservations-idempotency.test.ts` testează
// funcția de DECIZIE (`isTerminalReservation`), iar comentariul ei consemnează
// exact golul rămas: *„cablajul din componentă (setError + return) nu are test
// de randare — call-site-ul e unul singur."* Adică decizia era acoperită, dar
// ramura care o FOLOSEȘTE putea fi ștearsă fără ca niciun test să pice.
//
// Ce apără: cu idempotență (mig 273), o retrimitere poate întoarce o rezervare
// ANULATĂ între timp — cheia rămâne legată de rândul ei. Ecranul de succes are
// doar două stări („confirmată" / „în așteptare"), deci ar prezenta un rând MORT
// drept rezervare primită. Iar cheia trebuie ROTITĂ înainte, altfel clientul
// rămâne blocat pe rândul mort: orice retrimitere ar întoarce tot pe el.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// TOT ce e folosit dintr-o fabrică `vi.mock` trebuie să fie HOISTED: `vi.mock`
// urcă deasupra importurilor, iar fabrica rulează la evaluarea lui
// `import ReservationSheet` — ADICĂ ÎNAINTE de orice `const` din corpul
// fișierului. O constantă obișnuită referită acolo ar pica în TDZ.
//
// Setările sunt DETERMINISTE, independente de ceasul runner-ului: local deschis
// non-stop, în toate zilele, fără preaviz — altfel o rulare de CI după ora 22
// n-ar avea niciun slot de ales și testul ar pica din motive de fus, nu de cod
// (aceeași capcană ca la sloturile PickupCheckoutSheet).
const h = vi.hoisted(() => ({
  createMock: vi.fn(),
  rotateMock: vi.fn(() => 'cheie-noua'),
  settings: {
    open_days: [1, 2, 3, 4, 5, 6, 7],
    open_time: '00:00',
    close_time: '24:00',
    slot_interval: 30,
    reservation_duration: 90,
    min_advance_hours: 0,
    max_advance_days: 30,
    max_party_size: 20,
  },
}))

vi.mock('../../lib/reservations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/reservations')>()
  return {
    ...actual, // isTerminalReservation rămâne REAL — testăm cablajul, nu un dublu
    createReservationPublic: h.createMock,
    getReservationIdempotencyKey: () => 'cheie-initiala',
    rotateReservationIdempotencyKey: h.rotateMock,
  }
})

// Harta de mese nu e subiectul: o scurtcircuităm ca efectul de disponibilitate
// să nu atingă rețeaua.
vi.mock('../../lib/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/qr')>()
  return {
    ...actual,
    fetchPublicFloorPlan: vi.fn(async () => ({ floor_layout: null, tables: [] })),
    fetchTablesAvailability: vi.fn(async () => []),
  }
})

vi.mock('../../lib/supabase', () => {
  // Builder minimal: componenta lanțuiește .select().eq()...  și așteaptă fie
  // .maybeSingle() (setările), fie direct thenable-ul (zonele).
  function builder(rows: unknown) {
    const b: Record<string, unknown> = {}
    const self = () => b
    for (const m of ['select', 'eq', 'not', 'order', 'limit']) b[m] = self
    b.maybeSingle = async () => ({ data: rows, error: null })
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null })
    return b
  }
  return {
    supabase: {
      from: (table: string) => builder(table === 'reservation_settings' ? h.settings : []),
    },
  }
})

import ReservationSheet from '../ReservationSheet'
import { getTheme } from '../../lib/themes'
import { makeRestaurant } from './fixtures'

const PUB = {
  bg: '#fff',
  surface: '#f6f6f6',
  text: '#111',
  text2: '#444',
  text3: '#777',
  border: '#ddd',
  borderStrong: '#bbb',
}

function renderSheet() {
  return render(
    <ReservationSheet
      restaurant={makeRestaurant({ slug: 'demo' })}
      theme={getTheme('cafe')}
      accent="#c8102e"
      PUB={PUB}
      lang="ro"
      onClose={() => {}}
    />,
  )
}

function byText(role: string, re: RegExp): HTMLElement {
  const el = screen.getAllByRole(role).find((e) => re.test((e.textContent ?? '').trim()))
  if (!el) throw new Error(`niciun ${role} care sa se potriveasca cu ${re}`)
  return el
}

async function fillAndSubmit(): Promise<void> {
  // Ziua de MÂINE, nu „astăzi": cu program non-stop, sloturile de mâine sunt
  // toate cele 48, indiferent de ora la care rulează CI-ul. Pe „astăzi" o
  // rulare la 23:58 n-ar avea niciun slot de ales și testul ar pica din motive
  // de ceas, nu de cod.
  await userEvent.click(byText('button', /^Mâine$/))

  await userEvent.type(screen.getByPlaceholderText(/^Nume$/), 'Ana Pop')
  await userEvent.type(screen.getByPlaceholderText(/^Telefon$/), '0722000111')

  // Slotul se alege din RÂNDUL lui, nu după textul afișat: eticheta depinde de
  // fusul orar al runner-ului (precedentul PickupCheckoutSheet S1–S4).
  const row = await screen.findByTestId('time-slot-row')
  const slot = within(row).getAllByRole('button')[0]
  if (!slot) throw new Error('niciun slot randat')
  await userEvent.click(slot)

  // Text EXACT: „Rezervă" e și începutul titlului („Rezervă o masă"), deci un
  // /rezerv/i ar putea prinde alt element.
  await userEvent.click(byText('button', /^Rezervă$/))
}

function reservationRow(status: string) {
  return {
    reservation_id: 'r-1',
    confirmation_code: 'ABC123',
    status,
    table_name: 'Masa 1',
    starts_at: '2026-10-01T18:00:00.000Z',
    ends_at: '2026-10-01T19:30:00.000Z',
    requested_zone: null,
    party_size: 2,
  }
}

describe('ReservationSheet — rândul mort (RESID-32)', () => {
  beforeEach(() => {
    h.createMock.mockReset()
    h.rotateMock.mockClear()
    sessionStorage.clear()
  })

  it('RS-A: o rezervare ANULATĂ nu se prezintă ca primită — cere retrimiterea', async () => {
    h.createMock.mockResolvedValue(reservationRow('cancelled'))
    renderSheet()
    await fillAndSubmit()

    // Mesajul explicit, nu ecranul de succes.
    // `getAllByText`, nu `getByText`: regexul se potrivește și pe ANCESTORII
    // care conțin textul, iar `getByText` ar arunca „multiple elements".
    await waitFor(() => {
      expect(screen.getAllByText(/a fost anulat/i).length).toBeGreaterThan(0)
    })
    // Ecranul de confirmare NU trebuie să apară pentru un rând mort.
    expect(screen.queryAllByText(/ABC123/)).toHaveLength(0)
  })

  it('RS-B: cheia e ROTITĂ chiar și pe rândul mort (altfel clientul rămâne blocat)', async () => {
    h.createMock.mockResolvedValue(reservationRow('cancelled'))
    renderSheet()
    await fillAndSubmit()

    await waitFor(() => expect(screen.getAllByText(/a fost anulat/i).length).toBeGreaterThan(0))
    // Fără rotire, retrimiterea ar întoarce LA NESFÂRȘIT aceeași rezervare
    // anulată: cheia rămâne legată de rândul ei.
    expect(h.rotateMock).toHaveBeenCalled()
  })

  it('RS-C (control pozitiv): un rând VIU ajunge pe ecranul de confirmare', async () => {
    // Fără el, RS-A/RS-B ar trece și dacă submit-ul ar fi rupt de tot — „nu apare
    // ecranul de succes" e adevărat și când nu se întâmplă nimic.
    h.createMock.mockResolvedValue(reservationRow('confirmed'))
    renderSheet()
    await fillAndSubmit()

    await waitFor(() => {
      expect(screen.getAllByText(/ABC123/).length).toBeGreaterThan(0)
    })
    expect(screen.queryAllByText(/a fost anulat/i)).toHaveLength(0)
  })
})

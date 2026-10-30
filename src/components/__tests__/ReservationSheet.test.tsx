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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
import { legibleOn, readableTextOn } from '../../lib/themes'

const PUB = {
  bg: '#fff',
  surface: '#f6f6f6',
  text: '#111',
  text2: '#444',
  text3: '#777',
  border: '#ddd',
  borderStrong: '#bbb',
}

function renderSheet(lang = 'ro', accent = '#c8102e') {
  return render(
    <ReservationSheet
      restaurant={makeRestaurant({ slug: 'demo' })}
      theme={getTheme('cafe')}
      accent={accent}
      PUB={PUB}
      lang={lang}
      onClose={() => {}}
    />,
  )
}

function byText(role: string, re: RegExp): HTMLElement {
  const el = screen.getAllByRole(role).find((e) => re.test((e.textContent ?? '').trim()))
  if (!el) throw new Error(`niciun ${role} care sa se potriveasca cu ${re}`)
  return el
}

async function fillAndSubmit(phone = '0722000111', cc?: string): Promise<void> {
  // Ziua de MÂINE, nu „astăzi": cu program non-stop, sloturile de mâine sunt
  // toate cele 48, indiferent de ora la care rulează CI-ul. Pe „astăzi" o
  // rulare la 23:58 n-ar avea niciun slot de ales și testul ar pica din motive
  // de ceas, nu de cod.
  await userEvent.click(byText('button', /^Mâine$/))

  await userEvent.type(screen.getByPlaceholderText(/^Nume$/), 'Ana Pop')
  if (cc !== undefined) {
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /prefixul țării/i }), cc)
  }
  await userEvent.type(screen.getByPlaceholderText(/^Telefon$/), phone)

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

// PH-4: telefonul pleacă în E.164, cu prefixul de țară VIZIBIL (implicit +40).
// Forma națională a unui număr străin (SE/CH/FR „07…”) era citită de server
// drept +407… (mig 228) — SMS-ul de confirmare ajungea la un străin din RO.
describe('ReservationSheet — telefonul în E.164 (PH-4)', () => {
  const sentPhone = () =>
    (h.createMock.mock.calls[0]?.[0] as { p_customer_phone?: string } | undefined)?.p_customer_phone

  beforeEach(() => {
    h.createMock.mockReset()
    h.createMock.mockResolvedValue(reservationRow('confirmed'))
    sessionStorage.clear()
  })
  afterEach(() => {
    Reflect.deleteProperty(window.navigator, 'language')
    Reflect.deleteProperty(window.navigator, 'languages')
  })

  it('RS-D: implicitul românesc — 0722000111 pleacă +40722000111', async () => {
    renderSheet()
    await fillAndSubmit()
    await waitFor(() => expect(h.createMock).toHaveBeenCalledTimes(1))
    expect(sentPhone()).toBe('+40722000111')
  })

  it('RS-E: numărul tastat cu „+” e deja internațional', async () => {
    renderSheet()
    await fillAndSubmit('+46 70 123 45 67')
    await waitFor(() => expect(h.createMock).toHaveBeenCalledTimes(1))
    expect(sentPhone()).toBe('+46701234567')
  })

  it('RS-F: țara aleasă + forma națională NU mai devine +40 (miezul bug-ului)', async () => {
    renderSheet()
    await fillAndSubmit('070 123 45 67', '46')
    await waitFor(() => expect(h.createMock).toHaveBeenCalledTimes(1))
    expect(sentPhone()).toBe('+46701234567')
  })

  it('RS-G: un număr inutilizabil nu pleacă la server', async () => {
    renderSheet()
    await fillAndSubmit('12345')
    await waitFor(() => {
      expect(screen.getAllByText(/verifică prefixul țării/i).length).toBeGreaterThan(0)
    })
    expect(h.createMock).not.toHaveBeenCalled()
  })

  it('RS-H: implicitul rămâne +40 și pe un browser în en-US (nu se ghicește din limbă)', () => {
    Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
    Object.defineProperty(window.navigator, 'languages', { value: ['en-US'], configurable: true })
    renderSheet('en')
    expect(screen.getByRole('combobox', { name: /country code/i })).toHaveValue('40')
  })
})

// ux-guest-4 / a11y-guest-cta-white-on-accent: pe auriul implicit din Setări
// albul are 2,66:1. Mutația care pică: `color: '#fff'` readus pe „Rezervă",
// pe chip-ul selectat sau pe bara de titlu.
describe('ReservationSheet — text lizibil peste accent', () => {
  it('RS-I „Rezervă", chip-ul ales și bara de titlu folosesc culoarea calculată', () => {
    renderSheet('ro', '#C8963C')
    const expected = readableTextOn('#C8963C', PUB.text)
    expect(expected).not.toBe('#FFFFFF')
    expect(byText('button', /^Rezervă$/)).toHaveStyle({ color: expected })
    // „Astăzi" e ales implicit — chip plin de accent.
    expect(byText('button', /Astăzi$/)).toHaveStyle({ color: expected })
    // Bara de titlu: numele restaurantului stă pe accent.
    const dialog = screen.getByRole('dialog')
    const closeBtn = within(dialog).getAllByRole('button')[0]
    expect(closeBtn?.parentElement).toHaveStyle({ color: expected })
  })
})

// ux-guest-5 / a11y-autocomplete: sub 16px Safari pe iOS mărește pagina la
// fiecare focus; numele și emailul n-aveau autocomplete. Mutațiile care pică:
// `fontSize: 14` în inputStyle; `autoComplete` scos de pe nume/email.
describe('ReservationSheet — câmpurile formularului', () => {
  it('RS-J toate câmpurile au ≥16px, iar nume/email/telefon au autocomplete', () => {
    const { container } = renderSheet()
    const controls = Array.from(
      container.querySelectorAll('input, textarea, select'),
    ) as HTMLElement[]
    // nume, prefix (select), telefon, email, note
    expect(controls.length).toBeGreaterThanOrEqual(5)
    for (const el of controls) {
      expect(parseFloat(el.style.fontSize), el.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(16)
    }
    expect(screen.getByPlaceholderText(/^Nume$/)).toHaveAttribute('autocomplete', 'name')
    expect(screen.getByPlaceholderText(/^Email/)).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByPlaceholderText(/^Telefon$/)).toHaveAttribute('autocomplete', 'tel')
  })
})

// a11y-reservation-chips-errors: selecția (persoane, dată, zonă, oră) se vedea
// doar prin culoare, iar eroarea roșie (#E05555 pe roz, ~3:1) nu era anunțată.
// Mutațiile care pică: `aria-pressed` scos; bifa scoasă; `role="alert"` scos;
// culoarea veche a erorii.
describe('ReservationSheet — selecție și eroare accesibile', () => {
  it('RS-K chip-urile expun starea (aria-pressed) și o bifă, nu doar culoare', async () => {
    renderSheet()
    const party = within(screen.getByTestId('party-size-row'))
    const two = party.getByRole('button', { name: /^✓?\s*2$/ })
    const three = party.getByRole('button', { name: /^3$/ })
    expect(two).toHaveAttribute('aria-pressed', 'true')
    expect(two.textContent).toContain('✓')
    expect(three).toHaveAttribute('aria-pressed', 'false')
    expect(three.textContent).not.toContain('✓')
    await userEvent.click(three)
    expect(three).toHaveAttribute('aria-pressed', 'true')
    expect(three.textContent).toContain('✓')
    expect(two).toHaveAttribute('aria-pressed', 'false')
    // Rândul are nume: eticheta vizibilă de deasupra.
    expect(screen.getByRole('group', { name: /persoane/i })).toBeInTheDocument()
  })

  it('RS-L eroarea e anunțată (role=alert) și trece AA pe caseta ei', async () => {
    renderSheet()
    // Fără oră aleasă → eroare de validare locală, fără server.
    await userEvent.click(byText('button', /^Rezervă$/))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent?.trim().length).toBeGreaterThan(0)
    const theme = getTheme('cafe')
    expect(alert).toHaveStyle({ color: legibleOn(theme.colors.error, PUB.surface) })
    expect(alert).not.toHaveStyle({ color: '#E05555' })
  })
})

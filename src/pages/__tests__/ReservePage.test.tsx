// Teste pe ReservePage — fluxul PUBLIC de anulare a rezervării (mig 256/257).
// Suprafață anonimă nouă, fără plasă de regresie până acum:
//   - ?cancel=COD deschide cardul cu codul pre-completat (linkul din emailuri
//     și din ecranul de succes al rezervării)
//   - submit → RPC cu (p_slug, p_code) exact, cod normalizat la MAJUSCULE
//   - fiecare hint al RPC-ului (ok / invalid_code / not_cancellable /
//     rate_limited) → mesajul corect pentru client, fără text brut de Postgres
//   - eroare de transport → mesaj prietenos, NU ecran de succes fals
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchRestaurantBySlugMock, rpcMock } = vi.hoisted(() => ({
  fetchRestaurantBySlugMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('../../lib/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/qr')>()
  return { ...actual, fetchRestaurantBySlug: fetchRestaurantBySlugMock }
})
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}))

import ReservePage from '../ReservePage'

const SLUG = 'bistro-test'
const RESTAURANT = {
  id: 'r1',
  name: 'Bistro Test',
  slug: SLUG,
  primary_color: '#C8963C',
  logo_url: null,
  address: 'Str. Testului 1',
}

// Limba paginii se ia din navigator — fixăm 'ro' ca aserțiunile pe mesaje să
// fie deterministe (piața primară e România).
function forceRomanian() {
  Object.defineProperty(window.navigator, 'language', { value: 'ro-RO', configurable: true })
}

function renderWithCancelCode(code: string | null) {
  const path = code == null ? `/rezervare/${SLUG}` : `/rezervare/${SLUG}?cancel=${code}`
  window.history.replaceState({}, '', path)
  return render(<ReservePage slug={SLUG} navigate={vi.fn()} />)
}

const cancelButton = () => screen.getByRole('button', { name: /anulează rezervarea/i })

beforeEach(() => {
  vi.clearAllMocks()
  forceRomanian()
  fetchRestaurantBySlugMock.mockResolvedValue(RESTAURANT)
})

describe('ReservePage — anularea publică pe cod de confirmare', () => {
  it('?cancel=COD deschide cardul cu codul pre-completat și trimite RPC-ul corect', async () => {
    const user = userEvent.setup()
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null })
    renderWithCancelCode('aabbcc11')

    // Codul din link ajunge în input exact cum a venit (normalizarea la
    // MAJUSCULE se face la tastare; RPC-ul face upper() oricum server-side).
    const input = await screen.findByPlaceholderText(/codul de confirmare/i)
    expect(input).toHaveValue('aabbcc11')

    await user.click(cancelButton())

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1))
    expect(rpcMock).toHaveBeenCalledWith('cancel_reservation_by_code', {
      p_slug: SLUG,
      p_code: 'aabbcc11',
    })
    // Confirmare vizibilă + mențiunea că restaurantul a fost anunțat.
    expect(await screen.findByText(/rezervarea a fost anulată/i)).toBeInTheDocument()
    expect(screen.getByText(/restaurantul a fost anunțat/i)).toBeInTheDocument()
  })

  it('codul tastat manual e normalizat la MAJUSCULE înainte de trimitere', async () => {
    const user = userEvent.setup()
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null })
    // Pornim cu un cod în link (ca sheet-ul de rezervare să rămână închis),
    // apoi golim câmpul și tastăm manual — cazul „am codul pe hârtie".
    renderWithCancelCode('SEED0000')

    const input = await screen.findByPlaceholderText(/codul de confirmare/i)
    await user.clear(input)
    await user.type(input, 'ab12cd34')
    expect(input).toHaveValue('AB12CD34')

    await user.click(cancelButton())
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('cancel_reservation_by_code', {
      p_slug: SLUG,
      p_code: 'AB12CD34',
    }))
  })

  it('hint invalid_code → „Cod de confirmare invalid", fără ecran de succes', async () => {
    const user = userEvent.setup()
    rpcMock.mockResolvedValue({ data: { ok: false, hint: 'invalid_code' }, error: null })
    renderWithCancelCode('GRESIT00')

    await user.click(await screen.findByRole('button', { name: /anulează rezervarea/i }))

    expect(await screen.findByText(/cod de confirmare invalid/i)).toBeInTheDocument()
    expect(screen.queryByText(/rezervarea a fost anulată/i)).not.toBeInTheDocument()
  })

  it('hint not_cancellable → mesaj explicit că nu se mai poate online, cu trimitere la telefon', async () => {
    const user = userEvent.setup()
    rpcMock.mockResolvedValue({ data: { ok: false, hint: 'not_cancellable' }, error: null })
    renderWithCancelCode('AABBCC22')

    await user.click(await screen.findByRole('button', { name: /anulează rezervarea/i }))

    const msg = await screen.findByText(/nu mai poate fi anulată online/i)
    expect(msg).toBeInTheDocument()
    expect(msg.textContent).toMatch(/sună restaurantul/i)
  })

  it('hint rate_limited → „prea multe încercări", nu mesaj de cod invalid', async () => {
    const user = userEvent.setup()
    rpcMock.mockResolvedValue({ data: { ok: false, hint: 'rate_limited' }, error: null })
    renderWithCancelCode('AABBCC33')

    await user.click(await screen.findByRole('button', { name: /anulează rezervarea/i }))

    expect(await screen.findByText(/prea multe încercări/i)).toBeInTheDocument()
    expect(screen.queryByText(/cod de confirmare invalid/i)).not.toBeInTheDocument()
  })

  it('eroare de transport (RPC error) → mesaj prietenos, NU succes fals', async () => {
    const user = userEvent.setup()
    rpcMock.mockResolvedValue({ data: null, error: { message: 'network down' } })
    renderWithCancelCode('AABBCC44')

    await user.click(await screen.findByRole('button', { name: /anulează rezervarea/i }))

    expect(await screen.findByText(/nu am putut procesa anularea/i)).toBeInTheDocument()
    expect(screen.queryByText(/rezervarea a fost anulată/i)).not.toBeInTheDocument()
    // Nu expunem textul brut al erorii de backend.
    expect(screen.queryByText(/network down/i)).not.toBeInTheDocument()
  })

  it('cod gol → validare locală, fără apel RPC irosit', async () => {
    const user = userEvent.setup()
    renderWithCancelCode('SEED0000')

    await user.clear(await screen.findByPlaceholderText(/codul de confirmare/i))
    await user.click(await screen.findByRole('button', { name: /anulează rezervarea/i }))

    expect(await screen.findByText(/introdu codul de confirmare/i)).toBeInTheDocument()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('slug inexistent → ecran „restaurantul nu a fost găsit", fără card de anulare', async () => {
    fetchRestaurantBySlugMock.mockResolvedValue(null)
    renderWithCancelCode('AABBCC55')

    expect(await screen.findByText(/restaurantul nu a fost găsit/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/codul de confirmare/i)).not.toBeInTheDocument()
  })
})

// „Adaugă o locație" (lotul A) — dialogul din Setări → Abonament & cont.
//
//   AL1  succes: numele → `create_restaurant` cu numele tăiat și un slug (fără
//        preset de meniu — doar nume + slug), apoi `onCreated(id)` (apelantul
//        face locația ACTIVĂ); dialogul se închide. Mutația care pică:
//        `onCreated` neapelat / apelat cu alt id.
//   AL2  refuzul de limită (hint `upgrade_plan`, `enforce_restaurant_limit`) →
//        mesajul de limită în română, în dialog (`role="alert"`); `onCreated`
//        NU se cheamă; un refuz CLAR (cu cod) nu declanșează verificarea
//        listei. Mutația care pică: textul serverului afișat ca atare
//        (`describeCreateLocationError` ocolit).
//   AL3  numele gol nu pleacă la server. Mutația care pică: validarea scoasă.
//   AL4  RĂSPUNS PIERDUT DUPĂ CREARE (recenzia #344): `createRestaurant` pică
//        pe rețea, dar serverul a comis. Prima verificare a listei nu vede încă
//        locația → eroarea rămâne pe ecran; a DOUA încercare verifică ÎNTÂI,
//        găsește locația și NU mai cheamă `createRestaurant` (o locație dublă
//        nu se mai poate șterge, DELETE revocat din 096B). Verificarea primește
//        numele trimis, momentul trimiterii și id-urile cunoscute la deschidere.
//        Mutația care pică: reîncercarea fără verificare (al doilea
//        `createRestaurant`).
//   AL4b eșec ambiguu + locația găsită IMEDIAT → crearea e tratată ca reușită
//        din prima (un singur `createRestaurant`, `onCreated` pe id-ul găsit).
//   AL5  eșec ambiguu + lista NU se poate citi → „Nu știm sigur…" + „Reîncarcă"
//        (reîncărcare completă); butonul de creare dispare, deci nu există
//        reîncercare oarbă. Mutația care pică: verificarea eșuată tratată ca
//        „negăsită" (butonul rămâne și creează din nou).
//   AL7  eșec ambiguu + locația NEgăsită nici la reîncercare (recenzia
//        CodeRabbit pe #344): „negăsită" nu dovedește că tranzacția s-a
//        anulat — poate fi încă necomisă, iar `create_restaurant` alege alt
//        slug, deci o a doua creare ar face o locație DUBLĂ. În primul minut
//        reîncercarea NU creează (mesaj „Verificăm încă…"); după
//        `CREATE_SETTLE_MS` reîncearcă — cu ACEEAȘI cheie de idempotență (mig
//        315), deci serverul întoarce locația veche dacă a comis totuși.
//        Mutații care pică: ramura `absent` care cade direct pe
//        `createRestaurant`; cheie nouă la reîncercare.
//   AL6  `onCreated` pică DUPĂ ce restaurantul a fost creat → reîncercarea NU
//        mai creează încă unul (tiparul OnboardingPage). Mutația care pică:
//        `createdRef` scos.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const m = vi.hoisted(() => ({ create: vi.fn(), find: vi.fn(), reload: vi.fn() }))
vi.mock('../../lib/restaurants', () => ({ createRestaurant: m.create }))
vi.mock('../../lib/locations', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../lib/locations')),
  findCreatedLocation: m.find,
  hardReloadTo: m.reload,
}))

import AddLocationCard from '../AddLocationCard'
import {
  CREATE_SETTLE_MS,
  MSG_CREATE_SETTLING,
  MSG_CREATE_UNCERTAIN,
  MSG_LOCATION_LIMIT,
} from '../../lib/locations'

const LOST = new TypeError('Failed to fetch')

beforeEach(() => {
  m.create.mockReset()
  m.find.mockReset()
  m.reload.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
})

function renderCard(onCreated: (id: string) => Promise<void>) {
  return render(
    <AddLocationCard onCreated={onCreated} ownerId="owner-1" knownRestaurantIds={['rest-1']} />,
  )
}

async function openAndType(name: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /Adaugă o locație/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Adaugă o locație' })
  if (name) await user.type(screen.getByLabelText('Numele locației'), name)
  return { user, dialog }
}

const submitBtn = () => screen.getByRole('button', { name: 'Creează locația' })

describe('AddLocationCard', () => {
  it('AL1: succes → create_restaurant, apoi onCreated(id), dialogul se închide', async () => {
    m.create.mockResolvedValue({ restaurant_id: 'rest-new', restaurant_slug: 'bistro-gara' })
    const onCreated = vi.fn(async () => {})
    renderCard(onCreated)
    const { user } = await openAndType('  Bistro Gară  ')
    await user.click(submitBtn())
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('rest-new'))
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(m.create).toHaveBeenCalledWith({
      name: 'Bistro Gară',
      slug: expect.any(String),
      idempotencyKey: expect.any(String),
    })
    expect(m.find).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('AL2: refuzul de limită → mesaj în română, onCreated neapelat, fără verificarea listei', async () => {
    m.create.mockRejectedValue({
      code: 'P0001',
      hint: 'upgrade_plan',
      message: 'Limită restaurante atinsă: maxim 1 pe planul curent.',
    })
    const onCreated = vi.fn(async () => {})
    renderCard(onCreated)
    const { user } = await openAndType('Bistro Gară')
    await user.click(submitBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_LOCATION_LIMIT)
    expect(onCreated).not.toHaveBeenCalled()
    expect(m.find).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('AL3: numele gol nu pleacă la server', async () => {
    renderCard(vi.fn(async () => {}))
    const { user } = await openAndType('')
    await user.click(submitBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('Scrie numele locației.')
    expect(m.create).not.toHaveBeenCalled()
  })

  it('AL4: răspuns pierdut după creare → a doua încercare verifică întâi și NU mai creează', async () => {
    m.create.mockRejectedValue(LOST)
    // Prima verificare nu vede încă rândul; a doua îl găsește.
    m.find.mockResolvedValueOnce(null).mockResolvedValueOnce('rest-new')
    const onCreated = vi.fn(async () => {})
    renderCard(onCreated)
    const before = Date.now()
    const { user } = await openAndType('Bistro Gară')
    await user.click(submitBtn())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(m.find).toHaveBeenCalledTimes(1)
    const args = m.find.mock.calls[0][0] as {
      ownerId: string
      name: string
      sentAt: number
      knownIds: ReadonlySet<string>
    }
    expect(args.ownerId).toBe('owner-1')
    expect(args.name).toBe('Bistro Gară')
    expect(args.sentAt).toBeGreaterThanOrEqual(before)
    expect([...args.knownIds]).toEqual(['rest-1'])
    expect(onCreated).not.toHaveBeenCalled()

    await user.click(submitBtn())
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('rest-new'))
    expect(m.find).toHaveBeenCalledTimes(2)
    expect(m.create).toHaveBeenCalledTimes(1)
  })

  it('AL4b: eșec ambiguu, locația găsită imediat → reușită din prima', async () => {
    m.create.mockRejectedValue(LOST)
    m.find.mockResolvedValue('rest-new')
    const onCreated = vi.fn(async () => {})
    renderCard(onCreated)
    const { user } = await openAndType('Bistro Gară')
    await user.click(submitBtn())
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('rest-new'))
    expect(m.create).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('AL5: eșec ambiguu + lista necitibilă → „Nu știm sigur" + „Reîncarcă", fără reîncercare', async () => {
    m.create.mockRejectedValue(LOST)
    m.find.mockRejectedValue(new Error('Nu am putut verifica lista locațiilor.'))
    const onCreated = vi.fn(async () => {})
    renderCard(onCreated)
    const { user } = await openAndType('Bistro Gară')
    await user.click(submitBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_CREATE_UNCERTAIN)
    expect(screen.queryByRole('button', { name: 'Creează locația' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Reîncarcă' }))
    expect(m.reload).toHaveBeenCalledWith('/dashboard')
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('AL7: negăsită la reîncercare → nu creează în primul minut, creează după', async () => {
    let now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    m.create
      .mockRejectedValueOnce(LOST)
      .mockResolvedValueOnce({ restaurant_id: 'rest-new', restaurant_slug: 'bistro-gara' })
    m.find.mockResolvedValue(null)
    const onCreated = vi.fn(async () => {})
    renderCard(onCreated)
    const { user } = await openAndType('Bistro Gară')
    await user.click(submitBtn())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(m.create).toHaveBeenCalledTimes(1)

    // 10 s mai târziu: încă negăsită → fără a doua creare.
    now += 10_000
    await user.click(submitBtn())
    await waitFor(() => expect(m.find).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_CREATE_SETTLING)
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(onCreated).not.toHaveBeenCalled()

    // Peste fereastră: cererea veche nu mai poate comite → se creează.
    now += CREATE_SETTLE_MS
    await user.click(submitBtn())
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('rest-new'))
    expect(m.create).toHaveBeenCalledTimes(2)
    // Aceeași creare, aceeași CHEIE (mig 315): dacă cererea veche a comis
    // totuși, serverul o întoarce pe ea în loc să facă a doua locație.
    const k1 = (m.create.mock.calls[0][0] as { idempotencyKey?: string }).idempotencyKey
    const k2 = (m.create.mock.calls[1][0] as { idempotencyKey?: string }).idempotencyKey
    expect(typeof k1).toBe('string')
    expect(k2).toBe(k1)
  })

  it('AL6: reîncercarea după un onCreated eșuat nu creează a doua locație', async () => {
    m.create.mockResolvedValue({ restaurant_id: 'rest-new', restaurant_slug: 'bistro' })
    const onCreated = vi
      .fn<(id: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Fără conexiune. Verifică internetul și reîncearcă.'))
      .mockResolvedValueOnce(undefined)
    renderCard(onCreated)
    const { user } = await openAndType('Bistro')
    await user.click(submitBtn())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(submitBtn())
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2))
    expect(onCreated).toHaveBeenLastCalledWith('rest-new')
    expect(m.create).toHaveBeenCalledTimes(1)
  })
})

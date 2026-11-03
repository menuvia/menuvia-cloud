// „Adaugă o locație" (lotul A) — dialogul din Setări → Abonament & cont.
//
//   AL1  succes: numele → `create_restaurant` cu numele tăiat și un slug (fără
//        preset de meniu — doar nume + slug), apoi `onCreated(id)` (apelantul
//        face locația ACTIVĂ); dialogul se închide. Mutația care pică:
//        `onCreated` neapelat / apelat cu alt id.
//   AL2  refuzul de limită (hint `upgrade_plan`, `enforce_restaurant_limit`) →
//        mesajul de limită în română, în dialog (`role="alert"`); `onCreated`
//        NU se cheamă; dialogul rămâne deschis. Mutația care pică: textul
//        serverului afișat ca atare (`describeCreateLocationError` ocolit).
//   AL3  numele gol nu pleacă la server. Mutația care pică: validarea scoasă.
//   AL4  dacă `onCreated` pică după ce restaurantul a fost creat, reîncercarea
//        NU mai creează încă unul (tiparul OnboardingPage). Mutația care pică:
//        `createdRef` scos (al doilea `create_restaurant`).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const m = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../lib/restaurants', () => ({ createRestaurant: m.create }))

import AddLocationCard from '../AddLocationCard'
import { MSG_LOCATION_LIMIT } from '../../lib/locations'

beforeEach(() => {
  m.create.mockReset()
})

async function openAndType(name: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /Adaugă o locație/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Adaugă o locație' })
  if (name) await user.type(screen.getByLabelText('Numele locației'), name)
  return { user, dialog }
}

describe('AddLocationCard', () => {
  it('AL1: succes → create_restaurant, apoi onCreated(id), dialogul se închide', async () => {
    m.create.mockResolvedValue({ restaurant_id: 'rest-new', restaurant_slug: 'bistro-gara' })
    const onCreated = vi.fn(async () => {})
    render(<AddLocationCard onCreated={onCreated} />)
    const { user } = await openAndType('  Bistro Gară  ')
    await user.click(screen.getByRole('button', { name: 'Creează locația' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('rest-new'))
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(m.create).toHaveBeenCalledWith({ name: 'Bistro Gară', slug: expect.any(String) })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('AL2: refuzul de limită → mesaj în română, onCreated neapelat', async () => {
    m.create.mockRejectedValue({
      code: 'P0001',
      hint: 'upgrade_plan',
      message: 'Limită restaurante atinsă: maxim 1 pe planul curent.',
    })
    const onCreated = vi.fn(async () => {})
    render(<AddLocationCard onCreated={onCreated} />)
    const { user } = await openAndType('Bistro Gară')
    await user.click(screen.getByRole('button', { name: 'Creează locația' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_LOCATION_LIMIT)
    expect(onCreated).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('AL3: numele gol nu pleacă la server', async () => {
    render(<AddLocationCard onCreated={vi.fn(async () => {})} />)
    const { user } = await openAndType('')
    await user.click(screen.getByRole('button', { name: 'Creează locația' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Scrie numele locației.')
    expect(m.create).not.toHaveBeenCalled()
  })

  it('AL4: reîncercarea după un onCreated eșuat nu creează a doua locație', async () => {
    m.create.mockResolvedValue({ restaurant_id: 'rest-new', restaurant_slug: 'bistro' })
    const onCreated = vi
      .fn<(id: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Fără conexiune. Verifică internetul și reîncearcă.'))
      .mockResolvedValueOnce(undefined)
    render(<AddLocationCard onCreated={onCreated} />)
    const { user } = await openAndType('Bistro')
    await user.click(screen.getByRole('button', { name: 'Creează locația' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Creează locația' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2))
    expect(onCreated).toHaveBeenLastCalledWith('rest-new')
    expect(m.create).toHaveBeenCalledTimes(1)
  })
})

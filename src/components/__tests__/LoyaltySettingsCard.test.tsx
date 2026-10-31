// Cardul de fidelizare din Setări → Comenzi. Ce păzesc:
//   LY1  o citire EȘUATĂ a programului (`{ error }` — supabase-js nu aruncă) nu
//        lasă „Salvează" activ peste valorile implicite: un click ar fi
//        suprascris prin upsert pragul și recompensa reale ale localului.
//        Pică pe codul vechi, care ignora `error` și făcea `setLoaded(true)`
//        (mutația: scoate ramura `if (error)`).
//   LY2  „Reîncearcă" citește din nou și, la succes, afișează valorile salvate
//        și deblochează salvarea (controlul pozitiv al lui LY1).
//   LY3  respingerea de transport (fetch picat) e tratată la fel ca `{ error }`
//        (mutația: scoate `catch`-ul — eroarea devine unhandled și butonul
//        rămâne blocat fără nicio explicație).
//   LY4  comutatorul și câmpurile au nume accesibile.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { useRestaurantModules } from '../../hooks/useRestaurantModules'

interface LoadResult {
  data: unknown
  error: { message: string } | null
}

const h = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('../../lib/supabase', () => {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.maybeSingle = () => h.maybeSingle()
  builder.upsert = (row: unknown) => h.upsert(row)
  return { supabase: { from: () => builder } }
})

import LoyaltySettingsCard from '../LoyaltySettingsCard'

const modulesState = {
  modules: {},
  loading: false,
  loadError: false,
  isEnabled: () => true,
  setModule: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
} as unknown as ReturnType<typeof useRestaurantModules>

const SAVED: LoadResult = {
  data: { points_per_leu: 2, reward_threshold: 250, reward_description: 'O cafea gratuită' },
  error: null,
}

function renderCard() {
  const toast = vi.fn()
  render(
    <LoyaltySettingsCard
      restaurantId="rest-1"
      plan="growth"
      modulesState={modulesState}
      toast={toast}
    />,
  )
  return { toast }
}

beforeEach(() => {
  h.maybeSingle.mockReset()
  h.upsert.mockReset().mockResolvedValue({ error: null })
})

describe('LoyaltySettingsCard — citirea programului', () => {
  it('LY1: citirea eșuată blochează salvarea și spune de ce', async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    renderCard()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Nu am putut citi programul/)
    const save = screen.getByRole('button', { name: 'Salvează programul' })
    expect(save).toBeDisabled()
    await userEvent.click(save)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('LY2: „Reîncearcă" citește din nou și deblochează salvarea', async () => {
    h.maybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
      .mockResolvedValueOnce(SAVED)
    renderCard()

    await userEvent.click(await screen.findByRole('button', { name: 'Reîncearcă' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Salvează programul' })).toBeEnabled(),
    )
    expect(h.maybeSingle).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Prag pentru recompensă (puncte)')).toHaveValue('250')
    expect(screen.getByLabelText('Recompensa (ce primește clientul la prag)')).toHaveValue(
      'O cafea gratuită',
    )
  })

  it('LY3: respingerea de transport e tratată ca eroare de citire', async () => {
    h.maybeSingle.mockRejectedValue(new TypeError('Load failed'))
    renderCard()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Nu am putut citi programul/)
    expect(screen.getByRole('button', { name: 'Salvează programul' })).toBeDisabled()
  })

  it('LY4: comutatorul și câmpurile au nume', async () => {
    h.maybeSingle.mockResolvedValue(SAVED)
    renderCard()

    expect(await screen.findByRole('switch', { name: 'Fidelizarea în meniul QR' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await waitFor(() => expect(screen.getByLabelText('Puncte per leu cheltuit')).toHaveValue('2'))
  })
})

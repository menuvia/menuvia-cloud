// Cardul de fidelizare din Setări → Comenzi. Lotul C7c: câmpurile programului
// sunt ale FORMULARULUI paginii (`useLoyaltyProgramForm`, ținut de SettingsTab)
// și se salvează cu „Salvează" de sus — cardul nu mai are buton propriu. Aici
// harness-ul face exact ce face SettingsTab: cheamă hook-ul și dă programul
// cardului. Salvarea prin pagină e în SettingsTabSave.test.tsx (SJ7–SJ11).
// Ce păzesc:
//   LY1  o citire EȘUATĂ a programului (`{ error }` — supabase-js nu aruncă)
//        nu lasă câmpurile editabile peste valorile implicite: o salvare ar fi
//        suprascris prin upsert pragul și recompensa reale ale localului. Și nu
//        e „nesalvat" (`dirty`/`loyaltyNeedsSave` false — SettingsTab nu scrie).
//        Mutația care pică: ramura `if (error)` scoasă din hook (citirea
//        eșuată ar deveni `ready` cu valorile implicite).
//   LY2  „Reîncearcă" citește din nou și, la succes, afișează valorile salvate
//        și deblochează câmpurile (controlul pozitiv al lui LY1); o modificare
//        face programul „nesalvat", iar revenirea la valoarea salvată îl curăță.
//   LY3  respingerea de transport (fetch picat) e tratată la fel ca `{ error }`
//        (mutația: scoate `catch`-ul — eroarea devine unhandled și câmpurile
//        rămân blocate fără nicio explicație).
//   LY4  comutatorul și câmpurile au nume accesibile; comutatorul (scris
//        imediat) e marcat „se salvează automat", iar butonul propriu nu mai
//        există. Mutația care pică: „Salvează programul" readus în card.
//   LY5  modulul pornit și programul niciodată salvat: nota spune că trebuie
//        apăsat „Salvează"; cu programul salvat (sau modulul oprit), nu.
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
import { useLoyaltyProgramForm, type LoyaltyProgramForm } from '../../hooks/useLoyaltyProgramForm'

const modules = (on: boolean) =>
  ({
    modules: {},
    loading: false,
    loadError: false,
    isEnabled: () => on,
    setModule: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
  }) as unknown as ReturnType<typeof useRestaurantModules>

const SAVED: LoadResult = {
  data: { points_per_leu: 2, reward_threshold: 250, reward_description: 'O cafea gratuită' },
  error: null,
}

// Ultima stare a programului, ca testele să citească `dirty` fără un buton.
const seen: { program: LoyaltyProgramForm | null } = { program: null }

function Harness({ moduleOn }: { moduleOn: boolean }) {
  const program = useLoyaltyProgramForm('rest-1', true, 'ro')
  seen.program = program
  return (
    <LoyaltySettingsCard
      program={program}
      plan="growth"
      modulesState={modules(moduleOn)}
      toast={vi.fn()}
    />
  )
}

function renderCard(moduleOn = true) {
  return render(<Harness moduleOn={moduleOn} />)
}

beforeEach(() => {
  seen.program = null
  h.maybeSingle.mockReset()
  h.upsert.mockReset().mockResolvedValue({ error: null })
})

describe('LoyaltySettingsCard — citirea programului', () => {
  it('LY1: citirea eșuată blochează câmpurile și spune de ce', async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    renderCard()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Nu am putut citi programul/)
    expect(screen.getByLabelText('Prag pentru recompensă (puncte)')).toBeDisabled()
    expect(screen.getByLabelText('Puncte per leu cheltuit')).toBeDisabled()
    expect(screen.getByLabelText('Recompensa (ce primește clientul la prag)')).toBeDisabled()
    expect(seen.program?.loadState).toBe('error')
    expect(seen.program?.dirty).toBe(false)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('LY2: „Reîncearcă" citește din nou și deblochează câmpurile', async () => {
    h.maybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
      .mockResolvedValueOnce(SAVED)
    renderCard()

    await userEvent.click(await screen.findByRole('button', { name: 'Reîncearcă' }))

    const threshold = screen.getByLabelText('Prag pentru recompensă (puncte)')
    await waitFor(() => expect(threshold).toBeEnabled())
    expect(h.maybeSingle).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(threshold).toHaveValue('250')
    expect(screen.getByLabelText('Recompensa (ce primește clientul la prag)')).toHaveValue(
      'O cafea gratuită',
    )
    expect(seen.program?.dirty).toBe(false)
    await userEvent.clear(threshold)
    await userEvent.type(threshold, '300')
    expect(seen.program?.dirty).toBe(true)
    await userEvent.clear(threshold)
    await userEvent.type(threshold, '250')
    expect(seen.program?.dirty).toBe(false)
  })

  it('LY3: respingerea de transport e tratată ca eroare de citire', async () => {
    h.maybeSingle.mockRejectedValue(new TypeError('Load failed'))
    renderCard()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Nu am putut citi programul/)
    expect(screen.getByLabelText('Prag pentru recompensă (puncte)')).toBeDisabled()
  })

  it('LY4: comutatorul și câmpurile au nume; fără buton propriu de salvare', async () => {
    h.maybeSingle.mockResolvedValue(SAVED)
    renderCard()

    expect(await screen.findByRole('switch', { name: 'Fidelizarea în meniul QR' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await waitFor(() => expect(screen.getByLabelText('Puncte per leu cheltuit')).toHaveValue('2'))
    // Comutatorul se scrie imediat — marcat; câmpurile merg cu „Salvează" de sus.
    expect(screen.getByText('Activează fidelizarea în meniul QR')).toHaveTextContent(
      'se salvează automat',
    )
    expect(screen.queryByRole('button', { name: /Salvează/ })).not.toBeInTheDocument()
  })

  it('LY5: nota „nesalvat încă" doar cu modulul pornit și fără program', async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: null })
    const { unmount } = renderCard(true)
    expect(await screen.findByText(/Programul nu e salvat încă/)).toBeInTheDocument()
    // Valorile implicite, editabile (citirea a reușit, doar că rândul lipsește).
    expect(screen.getByLabelText('Prag pentru recompensă (puncte)')).toHaveValue('100')
    expect(seen.program?.exists).toBe(false)
    unmount()

    // Control: modulul oprit — nicio notă.
    renderCard(false)
    await waitFor(() => expect(screen.getByLabelText('Prag pentru recompensă (puncte)')).toBeEnabled())
    expect(screen.queryByText(/Programul nu e salvat încă/)).not.toBeInTheDocument()
  })

  it('LY5b: cu programul salvat, nota nu apare nici cu modulul pornit', async () => {
    h.maybeSingle.mockResolvedValue(SAVED)
    renderCard(true)
    await waitFor(() => expect(screen.getByLabelText('Puncte per leu cheltuit')).toHaveValue('2'))
    expect(screen.queryByText(/Programul nu e salvat încă/)).not.toBeInTheDocument()
  })
})

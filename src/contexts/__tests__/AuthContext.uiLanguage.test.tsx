// Profilul poartă limba interfeței aleasă de cont (lotul L0a, mig 323).
//
//   AU1  baza cu mig 323: profilul se citește CU `ui_language`, valoarea ajunge
//        în context.
//   AU2  baza fără mig 323 (client deployat înaintea migrației): PostgREST dă
//        42703 → o singură reîncercare fără coloană, profilul se încarcă (cu
//        `ui_language: null`) — altfel gate-ul de Termeni ar rămâne orb.
//        [PICĂ: fără reîncercare → profile rămâne null]
//   AU3  după primul 42703 coloana nu se mai cere în sesiune (un cont nou nu
//        mai plătește o cerere eșuată la fiecare încărcare).
//   AU4  o valoare ne-text din bază nu ajunge în context (doar string sau null).
//   AU5  ieșirea din cont în timp ce profilul se încarcă: răspunsul întârziat
//        nu mai repune profilul contului vechi. [PICĂ: fără resetarea cererii]
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

const { state } = vi.hoisted(() => ({
  state: {
    hasColumn: true,
    row: {} as Record<string, unknown>,
    selects: [] as string[],
    gate: null as Promise<void> | null,
    authCb: null as null | ((event: string, s: unknown) => void),
  },
}))

vi.mock('../../lib/supabase', () => {
  const from = () => {
    let cols = ''
    const b: Record<string, unknown> = {}
    b.select = (c: string) => {
      cols = c
      state.selects.push(c)
      return b
    }
    b.eq = () => b
    b.single = async () => {
      if (state.gate) await state.gate
      return !state.hasColumn && cols.includes('ui_language')
        ? { data: null, error: { code: '42703', message: 'column profiles.ui_language does not exist' } }
        : { data: { ...state.row }, error: null }
    }
    return b
  }
  return {
    supabase: {
      from,
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }),
        onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
          state.authCb = cb
          return { data: { subscription: { unsubscribe: () => undefined } } }
        },
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  }
})

async function mount() {
  const { AuthProvider, useAuth } = await import('../AuthContext')
  function Probe() {
    const { profile } = useAuth()
    return <div data-testid="p">{profile ? `lang=${String(profile.ui_language)}` : 'none'}</div>
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
}

beforeEach(() => {
  vi.resetModules()
  state.hasColumn = true
  state.selects = []
  state.authCb = null
  state.gate = null
  state.row = { id: 'u1', email: 'a@b.ro', full_name: 'A', plan: 'growth', terms_accepted_at: null, ui_language: 'fr' }
})

describe('AuthContext — limba contului (mig 323)', () => {
  it('AU1 baza nouă: profilul se citește cu ui_language', async () => {
    await mount()
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('lang=fr'))
    expect(state.selects).toHaveLength(1)
    expect(state.selects[0]).toContain('ui_language')
  })

  it('AU2 + AU3 baza veche: 42703 → reîncercare fără coloană, apoi coloana nu se mai cere', async () => {
    state.hasColumn = false
    delete state.row.ui_language
    await mount()
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('lang=null'))
    expect(state.selects).toHaveLength(2)
    expect(state.selects[1]).not.toContain('ui_language')

    // AU3: alt cont în aceeași sesiune → o singură cerere, fără coloană.
    state.selects = []
    state.row = { ...state.row, id: 'u2' }
    await act(async () => {
      state.authCb?.('SIGNED_IN', { user: { id: 'u2' } })
    })
    await waitFor(() => expect(state.selects).toHaveLength(1))
    expect(state.selects[0]).not.toContain('ui_language')
  })

  it('AU5 un profil sosit DUPĂ ieșirea din cont nu se mai afișează', async () => {
    let release: () => void = () => undefined
    state.gate = new Promise<void>((r) => {
      release = r
    })
    await mount()
    await act(async () => {
      state.authCb?.('SIGNED_OUT', null)
    })
    await act(async () => {
      release()
    })
    expect(screen.getByTestId('p').textContent).toBe('none')
  })

  it('AU4 o valoare ne-text nu ajunge în context', async () => {
    state.row.ui_language = 7
    await mount()
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('lang=null'))
  })
})

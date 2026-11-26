// Profilul poartă limba interfeței aleasă de cont (lotul L0a, mig 323).
//
//   AU1  baza cu mig 323: profilul se citește CU `ui_language`, valoarea ajunge
//        în context.
//   AU2  baza fără mig 323 (client deployat înaintea migrației): PostgREST dă
//        42703 → o singură reîncercare fără coloană, profilul se încarcă —
//        altfel gate-ul de Termeni ar rămâne orb — cu `ui_language: null` și
//        semnalul `ui_language_missing` (panoul îl citește ca 'ro', funnel-ul
//        nu; LR6). [PICĂ: fără reîncercare → profile rămâne null; semnalul
//        lipsă; 'ro' scris direct în `ui_language`, care ajunge și în funnel]
//   AU3  după primul 42703 coloana nu se mai cere pentru ACELAȘI cont (o
//        reîncărcare a profilului nu mai plătește o cerere eșuată), dar se
//        re-verifică o dată la fiecare cont NOU (AU7).
//   AU7  tab deschis înainte de mig 323, migrația se aplică, apoi alt cont
//        intră pe aceeași tabletă: profilul lui se citește CU coloana, deci
//        limba lui salvată ajunge în context (a patra rundă de recenzie).
//        [PICĂ: steagul de sesiune păstrat peste schimbarea de cont]
//   AU8  semnalul „coloana lipsește” e al CERERII: o reîncărcare pornită fără
//        coloană, ținută în zbor peste o salvare reușită (care reînarmează
//        steagul comun), aterizează tot CU semnalul — profilul ei chiar nu are
//        limba (recenzia CodeRabbit pe #391). [PICĂ: marcajul citit din
//        steagul comun la `setProfile`]
//   AU9  două încărcări ale ACELUIAȘI cont: cea veche, sosită ultima, nu mai
//        rescrie profilul celei noi — jetonul e al cererii, nu al contului
//        (recenzia CodeRabbit pe #391). [PICĂ: garda `profileReqRef === userId`]
//   AU4  o valoare ne-text din bază nu ajunge în context (doar string sau null).
//   AU5  ieșirea din cont în timp ce profilul se încarcă: răspunsul întârziat
//        nu mai repune profilul contului vechi. [PICĂ: fără resetarea cererii]
//   AU6  tab deschis înainte de mig 323 (primul select → 42703), migrația se
//        aplică, iar o salvare de limbă REUȘEȘTE: `applyProfileLanguage`
//        reînarmează coloana, deci reîncărcarea o cere din nou și profilul
//        rămâne pe limba salvată, nu „sare” înapoi (recenzia adversarială a
//        activării). [PICĂ: fără `profileHasUiLanguage = true` în
//        `applyProfileLanguage` → ultimul select fără coloană, limba pierdută]
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

const { state } = vi.hoisted(() => ({
  state: {
    hasColumn: true,
    row: {} as Record<string, unknown>,
    selects: [] as string[],
    gate: null as Promise<void> | null,
    // Porți per cerere (în ordinea apelurilor), înaintea porții comune.
    gates: [] as Promise<void>[],
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
      // Răspunsul se fixează la APEL (serverul servește cererea în momentul
      // ei); poarta amână doar sosirea lui.
      const missing = !state.hasColumn && cols.includes('ui_language')
      const row = { ...state.row }
      const gate = state.gates.shift() ?? state.gate
      if (gate) await gate
      return missing
        ? { data: null, error: { code: '42703', message: 'column profiles.ui_language does not exist' } }
        : { data: row, error: null }
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
    const { profile, applyProfileLanguage, refreshProfile } = useAuth()
    return (
      <>
        <div data-testid="p">{profile ? `lang=${String(profile.ui_language)}` : 'none'}</div>
        <div data-testid="m">{profile ? `missing=${String(profile.ui_language_missing === true)}` : 'none'}</div>
        <button type="button" onClick={() => applyProfileLanguage?.('de', 'u1')}>
          apply
        </button>
        <button type="button" onClick={() => void refreshProfile()}>
          refresh
        </button>
      </>
    )
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
  state.gates = []
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
    expect(screen.getByTestId('m').textContent).toBe('missing=true')
    expect(state.selects).toHaveLength(2)
    expect(state.selects[1]).not.toContain('ui_language')

    // AU3: o reîncărcare a profilului ACELUIAȘI cont nu mai cere coloana.
    state.selects = []
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click()
    })
    await waitFor(() => expect(state.selects).toHaveLength(1))
    expect(state.selects[0]).not.toContain('ui_language')

    // Alt cont pe aceeași bază veche: coloana se re-verifică O dată, apoi
    // reîncercarea fără ea.
    state.selects = []
    state.row = { ...state.row, id: 'u2' }
    await act(async () => {
      state.authCb?.('SIGNED_IN', { user: { id: 'u2' } })
    })
    await waitFor(() => expect(state.selects).toHaveLength(2))
    expect(state.selects[0]).toContain('ui_language')
    expect(state.selects[1]).not.toContain('ui_language')
  })

  it('AU7 tab de dinaintea mig 323: contul care intră după migrație își vede limba', async () => {
    state.hasColumn = false
    delete state.row.ui_language
    await mount()
    await waitFor(() => expect(screen.getByTestId('m').textContent).toBe('missing=true'))
    // Migrația se aplică sub tabul deschis; alt ospătar intră în contul lui.
    state.hasColumn = true
    state.row = { ...state.row, id: 'u2', ui_language: 'de' }
    state.selects = []
    await act(async () => {
      state.authCb?.('SIGNED_IN', { user: { id: 'u2' } })
    })
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('lang=de'))
    expect(screen.getByTestId('m').textContent).toBe('missing=false')
    expect(state.selects).toHaveLength(1)
    expect(state.selects[0]).toContain('ui_language')
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

  it('AU6 tab de dinaintea mig 323: o salvare reușită reînarmează coloana', async () => {
    state.hasColumn = false
    delete state.row.ui_language
    await mount()
    await waitFor(() => expect(screen.getByTestId('m').textContent).toBe('missing=true'))
    // Migrația se aplică sub tabul deschis; contul tocmai și-a salvat germana.
    state.hasColumn = true
    state.row = { ...state.row, ui_language: 'de' }
    state.selects = []
    await act(async () => {
      screen.getByRole('button', { name: 'apply' }).click()
    })
    expect(screen.getByTestId('p').textContent).toBe('lang=de')
    expect(screen.getByTestId('m').textContent).toBe('missing=false')
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click()
    })
    await waitFor(() => expect(state.selects).toHaveLength(1))
    expect(state.selects[0]).toContain('ui_language')
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('lang=de'))
    expect(screen.getByTestId('m').textContent).toBe('missing=false')
  })

  it('AU8 semnalul vine din cererea care n-a cerut coloana, nu din steagul comun', async () => {
    state.hasColumn = false
    delete state.row.ui_language
    await mount()
    await waitFor(() => expect(screen.getByTestId('m').textContent).toBe('missing=true'))
    let release: () => void = () => undefined
    state.gate = new Promise<void>((r) => {
      release = r
    })
    // Reîncărcare pornită FĂRĂ coloană (steagul comun e jos), ținută în zbor.
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click()
    })
    // O salvare reușită reînarmează steagul comun cât cererea e pe drum.
    await act(async () => {
      screen.getByRole('button', { name: 'apply' }).click()
    })
    expect(screen.getByTestId('m').textContent).toBe('missing=false')
    await act(async () => {
      release()
    })
    // Profilul adus de cerere n-are limba: semnalul ei rămâne.
    await waitFor(() => expect(screen.getByTestId('m').textContent).toBe('missing=true'))
  })

  it('AU9 o încărcare veche a aceluiași cont nu rescrie profilul unei încărcări noi', async () => {
    await mount()
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('lang=fr'))
    let releaseOld: () => void = () => undefined
    let releaseNew: () => void = () => undefined
    state.gates = [
      new Promise<void>((r) => {
        releaseOld = r
      }),
      new Promise<void>((r) => {
        releaseNew = r
      }),
    ]
    // Încărcarea veche vede încă franceza.
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click()
    })
    // Contul își schimbă limba; încărcarea nouă vede germana.
    state.row = { ...state.row, ui_language: 'de' }
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click()
    })
    await act(async () => {
      releaseNew()
    })
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('lang=de'))
    // Cea veche sosește ultima: nu mai are voie să readucă franceza.
    await act(async () => {
      releaseOld()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.getByTestId('p').textContent).toBe('lang=de')
  })
})

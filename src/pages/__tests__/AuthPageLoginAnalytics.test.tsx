// Telemetria intrării în cont (PostHog, PR #385, recenzia CodeRabbit CR-m6):
// varianta „fără MFA" a evenimentului de intrare se emite DOAR când verificarea
// de asigurare a CONFIRMAT că nu urmează niciun pas MFA. Fallback-ul de UI
// (omul intră oricum când verificarea pică — enforcement-ul real e pe server)
// rămâne separat de telemetrie.
//   LA1  control POZITIV: aal1 → aal1 (cont fără factor) → evenimentul cu
//        `mfa: false`, iar omul intră.
//   LA2  verificarea întoarce EROARE (supabase-js nu aruncă) → omul intră, dar
//        fără eveniment. Mutația care pică: emiterea necondiționată de după try
//        (prima variantă a PR-ului).
//   LA3  verificarea ARUNCĂ → la fel ca LA2. Mutația care pică: aceeași.
//   LA4  pas MFA cerut (aal1 → aal2), dar lista factorilor pică → omul intră
//        prin fallback, fără eveniment. Mutația care pică: `noMfaStepPending`
//        pus pe true și pe ramura cu pas MFA.
//   LA5  control POZITIV pe ramura MFA: factor TOTP verificat → pasul de cod,
//        fără eveniment și fără intrare până la cod; după cod → `mfa: true`.
import { Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const { signInMock, aalMock, listFactorsMock, challengeMock, verifyMock, trackMock } = vi.hoisted(
  () => ({
    signInMock: vi.fn(),
    aalMock: vi.fn(),
    listFactorsMock: vi.fn(),
    challengeMock: vi.fn(),
    verifyMock: vi.fn(),
    trackMock: vi.fn(),
  }),
)
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: signInMock,
      signUp: vi.fn(),
      signOut: vi.fn(async () => ({ error: null })),
      resetPasswordForEmail: vi.fn(),
      mfa: {
        getAuthenticatorAssuranceLevel: aalMock,
        listFactors: listFactorsMock,
        challenge: challengeMock,
        verify: verifyMock,
      },
    },
  },
}))
vi.mock('../../hooks/useSignupAgentCode', () => ({
  useSignupAgentCode: () => ({
    resolveForSubmit: async () => ({ ok: true, code: null }),
    verifiedLinkCode: null,
    dismissed: false,
    dismissLink: () => undefined,
    fieldOpen: false,
    openField: () => undefined,
    typed: '',
    setTyped: () => undefined,
    problem: null,
  }),
}))
vi.mock('../../lib/analytics', () => ({ track: trackMock, bindPendingConsentToAccount: vi.fn() }))
// AuthPage preîncarcă panoul la evaluarea modulului; aici n-are ce căuta.
vi.mock('../DashboardPage', () => ({ default: () => null }))

import AuthPage from '../AuthPage'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  localStorage.clear()
  for (const m of [signInMock, aalMock, listFactorsMock, challengeMock, verifyMock, trackMock]) {
    m.mockReset()
  }
})

function renderLogin(onSuccess: (email: string) => void) {
  window.history.replaceState({}, '', '/auth')
  return render(
    <Suspense fallback={<div>…</div>}>
      <AuthPage onSuccess={onSuccess} />
    </Suspense>,
  )
}

function submitPassword() {
  fireEvent.change(document.getElementById('auth-email') as HTMLInputElement, {
    target: { value: 'ana@bistro.ro' },
  })
  fireEvent.change(document.getElementById('auth-password') as HTMLInputElement, {
    target: { value: 'parola-buna-1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Intră în cont' }))
}

/** Doar apelurile evenimentului de intrare (alte evenimente nu contează aici). */
function loginEvents(): unknown[][] {
  return trackMock.mock.calls.filter((c: unknown[]) => c[0] === 'login_completed')
}

describe('AuthPage — evenimentul de intrare urmează verificarea MFA, nu fallback-ul', () => {
  it('LA1 control: fără factor MFA (aal1 → aal1) → `mfa: false` și intrarea', async () => {
    signInMock.mockResolvedValue({ error: null })
    aalMock.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null })
    const onSuccess = vi.fn()
    renderLogin(onSuccess)
    submitPassword()

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('ana@bistro.ro'))
    expect(loginEvents()).toEqual([['login_completed', { mfa: false }]])
    expect(listFactorsMock).not.toHaveBeenCalled()
  })

  it('LA2 verificarea întoarce eroare → intrarea rămâne, evenimentul nu', async () => {
    signInMock.mockResolvedValue({ error: null })
    aalMock.mockResolvedValue({ data: null, error: { message: 'network down' } })
    const onSuccess = vi.fn()
    renderLogin(onSuccess)
    submitPassword()

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('ana@bistro.ro'))
    // Anti-vacuitate: verificarea chiar a rulat după parolă.
    expect(aalMock).toHaveBeenCalledTimes(1)
    expect(loginEvents()).toEqual([])
  })

  it('LA3 verificarea aruncă → intrarea rămâne, evenimentul nu', async () => {
    signInMock.mockResolvedValue({ error: null })
    aalMock.mockRejectedValue(new Error('boom'))
    const onSuccess = vi.fn()
    renderLogin(onSuccess)
    submitPassword()

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('ana@bistro.ro'))
    expect(aalMock).toHaveBeenCalledTimes(1)
    expect(loginEvents()).toEqual([])
  })

  it('LA4 pas MFA cerut, dar factorii nu se pot citi → fallback fără eveniment', async () => {
    signInMock.mockResolvedValue({ error: null })
    aalMock.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null })
    listFactorsMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const onSuccess = vi.fn()
    renderLogin(onSuccess)
    submitPassword()

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('ana@bistro.ro'))
    expect(listFactorsMock).toHaveBeenCalledTimes(1)
    expect(loginEvents()).toEqual([])
  })

  it('LA5 control pe ramura MFA: pasul de cod, apoi `mfa: true`', async () => {
    signInMock.mockResolvedValue({ error: null })
    aalMock.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null })
    listFactorsMock.mockResolvedValue({
      data: { totp: [{ id: 'f-1', status: 'verified' }], all: [] },
      error: null,
    })
    challengeMock.mockResolvedValue({ data: { id: 'ch-1' }, error: null })
    verifyMock.mockResolvedValue({ data: {}, error: null })
    const onSuccess = vi.fn()
    renderLogin(onSuccess)
    submitPassword()

    const code = await screen.findByLabelText('Cod de verificare')
    // Cât codul nu e dat: nici intrare, nici eveniment.
    expect(onSuccess).not.toHaveBeenCalled()
    expect(loginEvents()).toEqual([])

    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verifică' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('ana@bistro.ro'))
    expect(verifyMock).toHaveBeenCalledWith({
      factorId: 'f-1',
      challengeId: 'ch-1',
      code: '123456',
    })
    expect(loginEvents()).toEqual([['login_completed', { mfa: true }]])
  })
})

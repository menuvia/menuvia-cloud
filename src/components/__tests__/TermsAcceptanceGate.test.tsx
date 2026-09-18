// Teste pe gate-ul de consimțământ (audit v3). Logica pură e acoperită de
// TM1–TM6; aici e păzit WIRING-ul, adică exact partea care a fost ruptă:
//
//   TG-C1  profil NECUNOSCUT → gate-ul NU randează. E ratchet-ul central:
//          un blip de rețea nu are voie să blocheze dashboard-ul cuiva care a
//          acceptat deja (aceeași disciplină tristate ca planul din WaiterPage);
//   TG-C2  profil cu consimțământ → nimic;
//   TG-C3  profil fără consimțământ → ecran, cu butonul blocat până la bifă;
//   TG-C4  intenție păstrată pentru ACELAȘI cont → consemnare automată, fără
//          să i se ceară a doua oară;
//   TG-C5  pe ruta de recuperare a parolei → nimic (sesiunea de recovery e
//          reală, deci fără excepție omul n-ar putea să-și schimbe parola).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const { useAuthMock, recordMock, refreshMock, signOutMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  recordMock: vi.fn(),
  refreshMock: vi.fn(),
  signOutMock: vi.fn(),
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: useAuthMock }))
vi.mock('../../lib/terms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/terms')>()
  return { ...actual, recordTermsAcceptance: recordMock }
})

import TermsAcceptanceGate from '../TermsAcceptanceGate'
import { storePendingTermsConsent } from '../../lib/terms'

const USER = { id: 'u1', email: 'ana@x.test' }

function auth(over: Record<string, unknown> = {}) {
  useAuthMock.mockReturnValue({
    user: USER,
    profile: null,
    refreshProfile: refreshMock,
    signOut: signOutMock,
    loading: false,
    ...over,
  })
}

beforeEach(() => {
  localStorage.clear()
  window.history.pushState({}, '', '/dashboard')
  useAuthMock.mockReset()
  recordMock.mockReset()
  recordMock.mockResolvedValue(undefined)
  refreshMock.mockReset()
  refreshMock.mockResolvedValue(undefined)
  signOutMock.mockReset()
})

describe('TermsAcceptanceGate', () => {
  it('TG-C1: profil necunoscut → nu blochează nimic', () => {
    auth({ profile: null })
    render(<TermsAcceptanceGate />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('TG-C1b: fără user (vizitator anonim la meniul QR) → nimic', () => {
    auth({ user: null, profile: null })
    render(<TermsAcceptanceGate />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('TG-C2: consimțământ deja consemnat → nimic', () => {
    auth({ profile: { id: 'u1', terms_accepted_at: '2026-09-01T10:00:00Z' } })
    render(<TermsAcceptanceGate />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('TG-C3: fără consimțământ și fără intenție → ecran, buton blocat până la bifă', () => {
    auth({ profile: { id: 'u1', terms_accepted_at: null } })
    render(<TermsAcceptanceGate />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByTestId('terms-accept')).toBeDisabled()
    // Ieșirea din cont există: fără ea, cine nu acceptă rămâne blocat.
    expect(screen.getByText('Ieși din cont')).toBeTruthy()
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('TG-C4: intenție păstrată pentru același cont → consemnare automată, fără ecran', async () => {
    storePendingTermsConsent(USER.email, '1.0')
    auth({ profile: { id: 'u1', terms_accepted_at: null } })
    render(<TermsAcceptanceGate />)

    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(recordMock).toHaveBeenCalledWith('1.0', USER.email))
    await waitFor(() => expect(refreshMock).toHaveBeenCalled())
  })

  it('TG-C5: pe ruta de recuperare a parolei → nu blochează', () => {
    window.history.pushState({}, '', '/reset-password')
    auth({ profile: { id: 'u1', terms_accepted_at: null } })
    render(<TermsAcceptanceGate />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

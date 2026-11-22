// Ce află analytics de la AuthContext la pornire (PostHog, PR #385, R4).
// Logica din spatele semnalului are teste proprii (AN15, AN38 în
// lib/__tests__/analytics.test.ts); aici se verifică doar că AuthContext îl dă.
//   AA1  `getSession` cu `error` (refresh de token căzut): semnalul „nerezolvat
//        după eroare”, NU `setAnalyticsUser(null)` (care ar face reset() unui cont
//        poate încă logat). Mutația care pică: ramura `else` scoasă — ce se emite
//        pe ecranul fără cont ar fi preluat de contul care intră apoi.
//   AA2  `getSession` ARUNCĂ: același semnal. Mutația care pică: `.catch` fără el.
//   AA3  control POZITIV: `getSession` reușit fără sesiune → „nimeni logat”, fără
//        semnal; cu sesiune → id-ul contului, fără semnal.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const { state, userMock, unresolvedMock } = vi.hoisted(() => ({
  state: { getSession: null as null | (() => Promise<unknown>) },
  userMock: vi.fn(),
  unresolvedMock: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.single = async () => ({ data: null, error: null })
      return b
    },
    auth: {
      getSession: () =>
        state.getSession
          ? state.getSession()
          : Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: () => Promise.resolve({ error: null }),
    },
  },
}))
vi.mock('../../lib/analytics', () => ({
  setAnalyticsUser: userMock,
  setAnalyticsAuthUnresolved: unresolvedMock,
}))

import { AuthProvider } from '../AuthContext'

function mount(): void {
  render(
    <AuthProvider>
      <div />
    </AuthProvider>,
  )
}

beforeEach(() => {
  state.getSession = null
  userMock.mockClear()
  unresolvedMock.mockClear()
})

describe('AuthContext — semnalul de pornire pentru analytics', () => {
  it('AA1 getSession cu eroare → „nerezolvat după eroare”, nu „nimeni logat”', async () => {
    state.getSession = () =>
      Promise.resolve({
        data: { session: null },
        error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 },
      })
    mount()
    await waitFor(() => expect(unresolvedMock).toHaveBeenCalledTimes(1))
    expect(userMock).not.toHaveBeenCalled()
  })

  it('AA2 getSession aruncă → același semnal', async () => {
    state.getSession = () => Promise.reject(new Error('rețea'))
    mount()
    await waitFor(() => expect(unresolvedMock).toHaveBeenCalledTimes(1))
    expect(userMock).not.toHaveBeenCalled()
  })

  it('AA3 control: răspuns reușit → contul (sau null), fără semnal', async () => {
    mount()
    await waitFor(() => expect(userMock).toHaveBeenCalledWith(null))
    expect(unresolvedMock).not.toHaveBeenCalled()

    userMock.mockClear()
    state.getSession = () =>
      Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null })
    mount()
    await waitFor(() => expect(userMock).toHaveBeenCalledWith('u1'))
    expect(unresolvedMock).not.toHaveBeenCalled()
  })
})

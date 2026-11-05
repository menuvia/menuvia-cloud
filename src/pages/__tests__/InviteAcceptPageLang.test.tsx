// Acceptarea invitației în echipă, în limba omului invitat (lotul L2b).
//   IA1  control: româna de dinainte — titlul, rolul și restaurantul îngroșate în
//        propoziție, data expirării în format românesc.
//   IA2  `?lang=en`: tot ecranul în engleză (rolul tradus, data în format
//        britanic), iar eroarea GoTrue la login e mesajul englezesc al clasei,
//        nu textul brut. Mutația care pică: pagina fără `FunnelLangProvider`.
//   IA3  un rol neprevăzut din RPC rămâne afișat ca atare (fallback-ul de
//        dinainte), nu cheia de traducere.
import { Suspense } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const { rpcMock, signInMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), signInMock: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      signInWithPassword: signInMock,
      signUp: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}))

import InviteAcceptPage from '../InviteAcceptPage'
import { preloadNamespace } from '../../i18n/core'
import { inviteNs } from '../../i18n/ns/invite'

const VALID = (role: string) => ({
  data: {
    status: 'valid',
    email: 'ana@bistro.ro',
    role,
    restaurant_name: 'Bistro Ana',
    expires_at: '2026-12-01T12:00:00Z',
  },
  error: null,
})

beforeAll(async () => {
  await preloadNamespace(inviteNs, 'en')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
  localStorage.clear()
  rpcMock.mockReset()
  signInMock.mockReset()
})

function renderAt(path: string) {
  window.history.replaceState({}, '', path)
  return render(
    <Suspense fallback={null}>
      <InviteAcceptPage token="tok" navigate={() => undefined} />
    </Suspense>,
  )
}

const paragraph = (text: string) => (_: string, el: Element | null) =>
  el?.tagName === 'P' && el.textContent === text

describe('InviteAcceptPage — limba', () => {
  it('IA1 control: româna de dinainte', async () => {
    rpcMock.mockResolvedValue(VALID('waiter'))
    renderAt('/invite/tok')
    expect(await screen.findByRole('heading', { name: 'Invitație la Bistro Ana' })).toBeInTheDocument()
    expect(screen.getByText(paragraph('Ai fost invitat(ă) ca Ospătar la Bistro Ana.'))).toBeInTheDocument()
    expect(screen.getByText('Invitația expiră la 1 decembrie 2026.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Creează cont și acceptă' })).toBeInTheDocument()
  })

  it('IA2 ?lang=en: engleză, inclusiv rolul, data și eroarea de login', async () => {
    rpcMock.mockResolvedValue(VALID('kitchen'))
    signInMock.mockResolvedValue({ error: new Error('Invalid login credentials') })
    renderAt('/invite/tok?lang=en')
    expect(await screen.findByRole('heading', { name: 'Invitation to Bistro Ana' })).toBeInTheDocument()
    expect(screen.getByText(paragraph('You’ve been invited as Kitchen at Bistro Ana.'))).toBeInTheDocument()
    expect(screen.getByText('The invitation expires on 1 December 2026.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'I already have an account' }))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'parola-buna-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in and accept' }))
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument()
    expect(screen.queryByText('Invalid login credentials')).not.toBeInTheDocument()
  })

  it('IA3 rolul neprevăzut rămâne afișat ca atare', async () => {
    rpcMock.mockResolvedValue(VALID('sommelier'))
    renderAt('/invite/tok')
    expect(await screen.findByText(paragraph('Ai fost invitat(ă) ca sommelier la Bistro Ana.'))).toBeInTheDocument()
  })
})

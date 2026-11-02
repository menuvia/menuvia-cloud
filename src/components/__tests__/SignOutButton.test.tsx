// „Ieși din cont" (SignOutButton) — orice rol, cu confirmare.
//
//   SO1  confirmarea refuzată → nimic nu se întâmplă (nici signOut, nici onSignOut).
//   SO2  signOut() respinge (rețea) → mesaj în română sub buton, iar butonul e din
//        nou ACTIV (se poate reîncerca). Mutația care pică: `try/finally` fără
//        `catch` (varianta de dinainte a recenziei pe #333: respingerea se
//        pierdea tăcut, omul credea că a ieșit).
//   SO3  control: cu `onSignOut` reușit, e chemat o dată și nu apare nicio eroare.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  signOut: vi.fn<() => Promise<void>>(),
  confirm: vi.fn<() => Promise<boolean>>(),
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ signOut: h.signOut }) }))
vi.mock('../ui/confirm', () => ({ confirm: h.confirm }))

import { SignOutButton } from '../SignOutButton'

beforeEach(() => {
  h.signOut.mockReset()
  h.confirm.mockReset()
})

describe('SignOutButton', () => {
  it('SO1 confirmarea refuzată → nimic', async () => {
    h.confirm.mockResolvedValue(false)
    const onSignOut = vi.fn(() => Promise.resolve())
    render(<SignOutButton variant="header" onSignOut={onSignOut} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ieși din cont' }))
    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(onSignOut).not.toHaveBeenCalled()
    expect(h.signOut).not.toHaveBeenCalled()
  })

  it('SO2 signOut respins → mesaj vizibil, butonul se reactivează', async () => {
    h.confirm.mockResolvedValue(true)
    h.signOut.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<SignOutButton variant="header" />)
    await userEvent.click(screen.getByRole('button', { name: 'Ieși din cont' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Fără conexiune')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ieși din cont' })).toBeEnabled())
  })

  it('SO3 control: onSignOut reușit, fără eroare', async () => {
    h.confirm.mockResolvedValue(true)
    const onSignOut = vi.fn(() => Promise.resolve())
    render(<SignOutButton variant="sidebar" onSignOut={onSignOut} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ieși din cont' }))
    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(h.signOut).not.toHaveBeenCalled()
  })
})

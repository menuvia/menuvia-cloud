// Teste pe cardurile PWA (instalare / actualizare SW). Regulile păzite:
//  - cardul de ACTUALIZARE are „Mai târziu": amână pe SESIUNE (sessionStorage),
//    fără să cheme applyUpdate — înainte nu avea nicio ieșire în afară de
//    reload, iar cardul stă fix peste bara de navigare mobilă;
//  - cu amânarea deja setată (cheia pe care o pre-setează și E2E-ul în
//    prepPage) NU se randează nimic;
//  - „Actualizează" cheamă applyUpdate;
//  - cardul de INSTALARE apare abia după 30 s și „×" cheamă dismiss.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  canInstall: false,
  updateAvailable: false,
  applyUpdate: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('../../lib/pwa', () => ({
  usePWAInstall: () => ({ canInstall: h.canInstall, install: vi.fn(async () => true), dismiss: h.dismiss }),
  useSWUpdate: () => ({ updateAvailable: h.updateAvailable, applyUpdate: h.applyUpdate }),
}))

import PWAPrompt, { PWA_UPDATE_SNOOZE_KEY } from '../PWAPrompt'

describe('PWAPrompt', () => {
  beforeEach(() => {
    sessionStorage.clear()
    h.canInstall = false
    h.updateAvailable = false
    h.applyUpdate.mockReset()
    h.dismiss.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('update → „Mai târziu" ascunde cardul pe sesiune, fără applyUpdate', async () => {
    h.updateAvailable = true
    render(<PWAPrompt />)
    expect(screen.getByRole('dialog')).toHaveTextContent(/actualizare disponibilă/i)
    await userEvent.click(screen.getByRole('button', { name: /mai târziu/i }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sessionStorage.getItem(PWA_UPDATE_SNOOZE_KEY)).toBe('1')
    expect(h.applyUpdate).not.toHaveBeenCalled()
  })

  it('update cu amânarea deja setată → nu se randează nimic', () => {
    h.updateAvailable = true
    sessionStorage.setItem(PWA_UPDATE_SNOOZE_KEY, '1')
    render(<PWAPrompt />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('update → „Actualizează" cheamă applyUpdate', async () => {
    h.updateAvailable = true
    render(<PWAPrompt />)
    await userEvent.click(screen.getByRole('button', { name: /^actualizează$/i }))
    expect(h.applyUpdate).toHaveBeenCalledTimes(1)
  })

  it('instalare → apare abia după 30 s; „×" cheamă dismiss', () => {
    vi.useFakeTimers()
    h.canInstall = true
    render(<PWAPrompt />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByRole('dialog')).toHaveTextContent(/instalează menuvia/i)
    fireEvent.click(screen.getByRole('button', { name: /închide/i }))
    expect(h.dismiss).toHaveBeenCalledTimes(1)
  })
})

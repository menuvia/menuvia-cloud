// Echipa: schimbarea rolului cere confirmare cu urmările rolului NOU (lotul
// C7c). Înainte, `<select onChange>` chema `changeMemberRole` pe loc: un singur
// clic greșit făcea dintr-un ospătar Manager (admin: setări, echipă, rapoarte,
// încasări), fără nicio întrebare. (Prefixul RJ: verificat cu grep în src/,
// tests/, e2e/, supabase/, docs și CLAUDE.md, nefolosit înainte.)
//   RJ1  promovarea la Manager: dialogul comun, distructiv, spune ce primește
//        managerul; „Anulează" NU cheamă RPC-ul și selectul rămâne pe rolul
//        salvat. Mutația care pică: `changeMemberRole` chemat direct din
//        `onChange` (fără `confirm`), sau o stare optimistă a selectului.
//   RJ2  control pozitiv: confirmat, RPC-ul pleacă cu rolul nou și toast-ul
//        „Rol actualizat" apare.
//   RJ3  retrogradarea unui Manager: întâi ce pierde („Își pierde accesul…"),
//        apoi noul ecran; NU distructiv. Mutația care pică: descrierea fără
//        `role_fromManager` (retrogradarea n-ar spune ce se pierde).
//   RJ4  schimbare laterală (Ospătar → Bucătărie): doar noul ecran, fără „Își
//        pierde accesul…" (nu avea ce pierde).
//   RJ5  formularul de invitație: rândul de sub select spune ce poate face rolul
//        ales și urmează selectul (Ospătar implicit → Manager).
//   RJ6  în engleză: titlul, descrierea și butoanele explicite ale dialogului.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'
import type { ConfirmOptions } from '../ui/confirm'

interface Res {
  data: unknown
  error: { message: string; code?: string } | null
}

// Fixturile stau în `vi.hoisted`, ca fabricile din `vi.mock` (ridicate deasupra
// importurilor) să nu atingă o constantă încă neinițializată.
const h = vi.hoisted(() => ({
  changeRole: vi.fn<(a: { membershipId: string; newRole: string }) => Promise<{ ok: boolean }>>(
    async () => ({ ok: true }),
  ),
  confirm: vi.fn<(o: ConfirmOptions) => Promise<boolean>>(async () => false),
  members: {
    data: [
      { id: 'm1', role: 'owner', joined_at: '2026-01-01T00:00:00Z', user_id: 'u-owner' },
      { id: 'm2', role: 'waiter', joined_at: '2026-02-01T00:00:00Z', user_id: 'u-ana' },
      { id: 'm3', role: 'manager', joined_at: '2026-03-01T00:00:00Z', user_id: 'u-dan' },
    ],
    error: null,
  } as Res,
  names: {
    data: [
      { user_id: 'u-owner', email: 'owner@bistro.ro', full_name: 'Ion Popescu' },
      { user_id: 'u-ana', email: 'ana@bistro.ro', full_name: 'Ana' },
      { user_id: 'u-dan', email: 'dan@bistro.ro', full_name: 'Dan' },
    ],
    error: null,
  } as Res,
  invites: { data: [], error: null } as Res,
}))

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../ui/confirm', () => ({ confirm: h.confirm }))
vi.mock('../../lib/restaurants', () => ({
  changeMemberRole: h.changeRole,
  removeMember: vi.fn(async () => ({ ok: true })),
  revokeInvite: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../../lib/supabase', () => {
  const thenable = (get: () => Res) => {
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'is', 'gt']) b[k] = () => b
    b.order = () => Promise.resolve(get())
    b.then = (ok: (v: Res) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(get()).then(ok, ko)
    return b
  }
  return {
    supabase: {
      from: (table: string) =>
        table === 'restaurant_memberships' ? thenable(() => h.members) : thenable(() => h.invites),
      rpc: () => Promise.resolve(h.names),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    },
  }
})

import TeamManager from '../TeamManager'
import { preloadNamespace } from '../../i18n/core'
import { teamNs } from '../../i18n/ns/team'
import { commonNs } from '../../i18n/ns/common'
import teamRo from '../../i18n/ns/team/ro'
import teamEn from '../../i18n/ns/team/en'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  await Promise.all([preloadNamespace(teamNs, 'en'), preloadNamespace(commonNs, 'en')])
})

beforeEach(() => {
  h.changeRole.mockClear()
  h.confirm.mockReset()
  h.confirm.mockImplementation(async () => false)
})

const restaurant = { id: 'r1', name: 'Bistro', slug: 'bistro' } as unknown as Restaurant
function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const renderTeam = (lang: StaffLang | null = null) =>
  render(tree(lang, <TeamManager restaurant={restaurant} currentUserId="u-owner" canInvite />))

describe('Echipa — confirmarea schimbării de rol', () => {
  it('RJ1: promovarea la Manager cere confirmare; „Anulează" nu schimbă nimic', async () => {
    const user = userEvent.setup()
    renderTeam()
    const select = await screen.findByRole('combobox', { name: 'Rol pentru Ana' })
    await user.selectOptions(select, 'manager')
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
    expect(h.confirm).toHaveBeenCalledWith({
      title: 'Schimbi rolul pentru Ana în Manager?',
      description: teamRo.role_toManager,
      confirmLabel: 'Schimbă rolul',
      cancelLabel: 'Anulează',
      destructive: true,
    })
    expect(h.changeRole).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox', { name: 'Rol pentru Ana' })).toHaveValue('waiter')
  })

  it('RJ2: confirmat, rolul nou pleacă la server', async () => {
    h.confirm.mockImplementation(async () => true)
    const user = userEvent.setup()
    renderTeam()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Rol pentru Ana' }), 'manager')
    await waitFor(() =>
      expect(h.changeRole).toHaveBeenCalledWith({ membershipId: 'm2', newRole: 'manager' }),
    )
    expect(await screen.findByText('Rol actualizat')).toBeInTheDocument()
  })

  it('RJ3: retrogradarea unui Manager spune întâi ce pierde', async () => {
    const user = userEvent.setup()
    renderTeam()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Rol pentru Dan' }), 'kitchen')
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
    const opts = h.confirm.mock.calls[0]![0]
    expect(opts.title).toBe('Schimbi rolul pentru Dan în Bucătărie?')
    expect(opts.description).toBe(`${teamRo.role_fromManager} ${teamRo.role_toKitchen}`)
    expect(opts.destructive).toBe(false)
    expect(h.changeRole).not.toHaveBeenCalled()
  })

  it('RJ4: schimbarea laterală spune doar noul ecran', async () => {
    const user = userEvent.setup()
    renderTeam()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Rol pentru Ana' }), 'kitchen')
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
    const opts = h.confirm.mock.calls[0]![0]
    expect(opts.description).toBe(teamRo.role_toKitchen)
    expect(opts.description).not.toContain(teamRo.role_fromManager)
    expect(opts.destructive).toBe(false)
  })

  it('RJ5: invitația arată ce poate face rolul ales', async () => {
    const user = userEvent.setup()
    renderTeam()
    await screen.findByText('Ana')
    expect(screen.getByText(teamRo.role_toWaiter)).toBeInTheDocument()
    expect(screen.queryByText(teamRo.role_toManager)).not.toBeInTheDocument()
    // Primul select e al invitației (formularul stă deasupra listei).
    const invite = screen.getAllByRole('combobox')[0]!
    expect(invite).toHaveValue('waiter')
    await user.selectOptions(invite, 'manager')
    expect(screen.getByText(teamRo.role_toManager)).toBeInTheDocument()
    expect(screen.queryByText(teamRo.role_toWaiter)).not.toBeInTheDocument()
    // Alegerea din invitație nu e o schimbare de rol.
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('RJ6: dialogul în engleză', async () => {
    const user = userEvent.setup()
    renderTeam('en')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Role for Ana' }), 'manager')
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
    expect(h.confirm).toHaveBeenCalledWith({
      title: 'Change Ana’s role to Manager?',
      description: teamEn.role_toManager,
      confirmLabel: 'Change role',
      cancelLabel: 'Cancel',
      destructive: true,
    })
  })
})

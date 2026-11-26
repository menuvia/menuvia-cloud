// Fila Echipă în limba personalului (lotul L6b): TeamManager citește
// namespace-ul `team` (+ „Anulează”/„Reîncearcă” din `common`). Partea pură
// (pluralul contorului) e în src/lib/__tests__/settingsCardsLang.test.ts (TE8).
// (Prefixul TE: verificat cu grep în src/, tests/ și supabase/tests, nefolosit
// înainte.)
//   TE0  control POZITIV al verificării „fără text românesc”: fila randată în
//        română, comparată cu dicționarul englez, ARE resturi.
//   TE1  fără provider (azi, mereu româna): contorul „2 membri · …”, rolurile
//        (Proprietar / Ospătar), opțiunile selectului, invitația în așteptare
//        „Ospătar · expiră 20.11.2026”, „Tu”, numele accesibile.
//   TE2  fila în engleză: aceleași, traduse; VALORILE opțiunilor rămân
//        `manager`/`waiter`/`kitchen` (DB), data în formatul limbii, fără
//        resturi. Mutația care pică: `ROLE_LABELS` românesc readus.
//   TE3  refuzul invitației: în română EXACT textul serverului (`error` din
//        send-invite); în engleză textul propriu al `code`-ului, FĂRĂ mesajul
//        românesc; pe aceeași rădăcină, trecut în germană, se retraduce
//        (eroarea e ținută ca DATĂ); un `code` necunoscut → rezerva; rețeaua în
//        franceză. Mutația care pică: `setInvErr(d.error || …)` readus.
//   TE4  modalul de eliminare în franceză (textContent-ul nodului împărțit cu
//        numele îngroșat) și toast-ul după eliminare.
//   TE5  încărcarea eșuată: în română textul serverului, în engleză rezerva +
//        „Try again”, în germană după schimbarea limbii. Mutația care pică:
//        `setError(toUserMessage(err, …))` readus.
//   TE6  (lotul C7b) locurile din echipă: cu limita planului RESTAURANTULUI
//        (`useFeatures`, mock-uit) contorul „Locuri ocupate: 3 din 3” = 2
//        membri + 1 invitație; echipa plină explică de ce și dezactivează
//        trimiterea pentru o adresă NOUĂ (niciun fetch), dar o lasă pentru
//        adresa deja în așteptare (retrimiterea o înlocuiește); în engleză,
//        fără resturi românești. Control POZITIV: limita 10 → „3 din 10”, fără
//        explicație, trimiterea merge; nelimitat / plan necunoscut → fără
//        contor. Mutația care pică: butonul fără `seatsBlocked` sau contorul
//        fără invitațiile în așteptare.
//   TE7  refuzul serverului `team_member_limit` (409): în română textul
//        serverului, în engleză textul propriu al codului, iar lista și planul
//        se reîncarcă. Mutația care pică: `team_member_limit` scos din
//        `INVITE_ERROR_KEYS` (engleza ar cădea pe rezerva generică).
import { Suspense, type ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'
import type { RestaurantFeatures } from '../../lib/features'

interface Res {
  data: unknown
  error: { message: string; code?: string } | null
}

const h = vi.hoisted(() => ({
  members: { data: [], error: null } as Res,
  invites: { data: [], error: null } as Res,
  names: { data: [], error: null } as Res,
  remove: vi.fn<(a: { membershipId: string }) => Promise<{ ok: boolean }>>(async () => ({
    ok: true,
  })),
  // Planul restaurantului (lotul C7b); `null` = necunoscut, ca înainte de TE6.
  features: null as RestaurantFeatures | null,
  reloadFeatures: vi.fn<() => Promise<void>>(async () => undefined),
}))

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../../hooks/useFeatures', () => ({
  useFeatures: () => ({
    features: h.features,
    loading: false,
    loadError: false,
    has: () => false,
    limit: () => null,
    within: () => true,
    reload: h.reloadFeatures,
  }),
}))
vi.mock('../../lib/restaurants', () => ({
  changeMemberRole: vi.fn(async () => ({ ok: true })),
  removeMember: h.remove,
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
      auth: {
        getSession: () =>
          Promise.resolve({
            data: { session: { access_token: 'tok', user: { user_metadata: {} } } },
          }),
      },
    },
  }
})

import TeamManager from '../TeamManager'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { teamNs } from '../../i18n/ns/team'
import { commonNs } from '../../i18n/ns/common'
import teamRo from '../../i18n/ns/team/ro'
import teamEn from '../../i18n/ns/team/en'
import teamFr from '../../i18n/ns/team/fr'
import teamDe from '../../i18n/ns/team/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(
    langs.flatMap((l) => [preloadNamespace(teamNs, l), preloadNamespace(commonNs, l)]),
  )
})

const MEMBERS: Res = {
  data: [
    { id: 'm1', role: 'owner', joined_at: '2026-01-01T00:00:00Z', user_id: 'u-owner' },
    { id: 'm2', role: 'waiter', joined_at: '2026-02-01T00:00:00Z', user_id: 'u-ana' },
  ],
  error: null,
}
const NAMES: Res = {
  data: [
    { user_id: 'u-owner', email: 'owner@bistro.ro', full_name: 'Ion Popescu' },
    { user_id: 'u-ana', email: 'ana@bistro.ro', full_name: 'Ana' },
  ],
  error: null,
}
const INVITES: Res = {
  data: [
    {
      id: 'i1',
      email: 'nou@bistro.ro',
      role: 'waiter',
      created_at: '2026-11-13T12:00:00Z',
      expires_at: '2026-11-20T12:00:00Z',
    },
  ],
  error: null,
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
beforeEach(() => {
  h.members = MEMBERS
  h.invites = INVITES
  h.names = NAMES
  h.remove.mockClear()
  h.features = null
  h.reloadFeatures.mockClear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const restaurant = { id: 'r1', name: 'Bistro', slug: 'bistro' } as unknown as Restaurant
function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const tab = () => <TeamManager restaurant={restaurant} currentUserId="u-owner" canInvite />
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))
const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [teamEn as Dict, commonEn as Dict],
  fr: [teamFr as Dict, commonFr as Dict],
  de: [teamDe as Dict, commonDe as Dict],
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}
function attrText(root: Element): string {
  const out: string[] = []
  for (const el of root.querySelectorAll('[aria-label],[title],[placeholder],[alt]'))
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a)
      if (v) out.push(v)
    }
  return out.join('\n')
}
const visible = (root: Element): string => `${nodeText(root)}\n${attrText(root)}`

function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [teamRo as Dict, commonRo as Dict]
  sources.forEach((src, i) => {
    const target = TARGETS[lang][i]!
    for (const [k, v] of Object.entries(src)) {
      const own = formsOf(target[k]).join('\n')
      for (const form of formsOf(v))
        for (const piece of form.split(/\{\w+\}/)) {
          const p = piece.trim()
          if (p.length >= 6 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
        }
    }
  })
  return out
}

const RATE_LIMITED_RO =
  'Ai trimis prea multe invitații în ultimele 24 ore. Reîncearcă mâine sau contactează suportul.'

// Eticheta „Email” nu e legată de câmp (fără `htmlFor`, ca înainte), deci câmpul
// se găsește după placeholder; butonul are o iconiță înaintea textului.
async function sendInvite(
  user: ReturnType<typeof userEvent.setup>,
  placeholder: string,
  sendName: RegExp,
) {
  await user.type(screen.getByPlaceholderText(placeholder), 'nou2@bistro.ro')
  await user.click(screen.getByRole('button', { name: sendName }))
}

describe('Echipa în limba personalului', () => {
  it('TE0: control pozitiv — fila românească are resturi față de engleză', async () => {
    const { container } = inLang(null, tab())
    await screen.findByText('Ana')
    const left = romanianLeftovers(visible(container), 'en')
    expect(left.some((l) => l.startsWith('invite_title:'))).toBe(true)
    expect(left.some((l) => l.startsWith('role_waiter:'))).toBe(true)
  })

  it('TE1: fără provider, româna de dinainte', async () => {
    inLang(null, tab())
    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('2 membri · Invitații expiră în 7 zile')).toBeInTheDocument()
    expect(screen.getByText('Invită un membru nou')).toBeInTheDocument()
    expect(screen.getByText('Invitații în așteptare (1)')).toBeInTheDocument()
    expect(screen.getByText('Ospătar · expiră 20.11.2026')).toBeInTheDocument()
    expect(screen.getByText('Membri actuali (2)')).toBeInTheDocument()
    expect(screen.getByText('Proprietar')).toBeInTheDocument()
    expect(screen.getByText('Tu')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('ion@restaurant.ro')).toBeInTheDocument()
    const roleSel = screen.getByRole('combobox', { name: 'Rol pentru Ana' })
    expect(
      within(roleSel)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Manager', 'Ospătar', 'Bucătărie'])
    expect(screen.getByRole('button', { name: 'Elimină Ana din echipă' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Trimite invitație/ })).toBeInTheDocument()
  })

  it('TE2: fila în engleză, valorile rolurilor neschimbate, fără resturi', async () => {
    const { container } = inLang('en', tab())
    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('2 members · Invitations expire in 7 days')).toBeInTheDocument()
    expect(screen.getByText('Invite a new member')).toBeInTheDocument()
    expect(screen.getByText('Pending invitations (1)')).toBeInTheDocument()
    expect(screen.getByText('Waiter · expires 20/11/2026')).toBeInTheDocument()
    expect(screen.getByText('Current members (2)')).toBeInTheDocument()
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    const roleSel = screen.getByRole('combobox', { name: 'Role for Ana' })
    const opts = within(roleSel).getAllByRole('option') as HTMLOptionElement[]
    expect(opts.map((o) => o.textContent)).toEqual(['Manager', 'Waiter', 'Kitchen'])
    expect(opts.map((o) => o.value)).toEqual(['manager', 'waiter', 'kitchen'])
    expect(roleSel).toHaveValue('waiter')
    expect(screen.getByRole('button', { name: 'Remove Ana from the team' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'en')).toEqual([])
    expect(nodeText(container)).not.toMatch(/[ăĂșȘțȚ]/)
  })

  it('TE3: refuzul invitației — română = serverul; engleză/germană după `code`', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: RATE_LIMITED_RO, code: 'rate_limited' }))
    const user = userEvent.setup()
    const ro = inLang(null, tab())
    await screen.findByText('Ana')
    await sendInvite(user, 'ion@restaurant.ro', /Trimite invitație/)
    expect(await screen.findByText(RATE_LIMITED_RO)).toBeInTheDocument()
    ro.unmount()

    const r = inLang('en', tab())
    await screen.findByText('Ana')
    await sendInvite(user, 'john@restaurant.com', /Send invitation/)
    expect(
      await screen.findByText(
        'You’ve sent too many invitations in the last 24 hours. Try again tomorrow or contact support.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(RATE_LIMITED_RO)).not.toBeInTheDocument()
    r.rerender(tree('de', tab()))
    expect(
      await screen.findByText(
        'Sie haben in den letzten 24 Stunden zu viele Einladungen gesendet. Versuchen Sie es morgen erneut oder wenden Sie sich an den Support.',
      ),
    ).toBeInTheDocument()
    r.unmount()

    // Cod necunoscut cu text românesc → rezerva, nu textul.
    fetchMock.mockResolvedValue(
      jsonResponse(500, { error: 'Ceva nu a mers pe server.', code: 'new_code' }),
    )
    const u = inLang('en', tab())
    await screen.findByText('Ana')
    await sendInvite(user, 'john@restaurant.com', /Send invitation/)
    expect(await screen.findByText('Couldn’t send the invitation')).toBeInTheDocument()
    expect(screen.queryByText('Ceva nu a mers pe server.')).not.toBeInTheDocument()
    u.unmount()

    // Rețeaua, în franceză.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    inLang('fr', tab())
    await screen.findByText('Ana')
    await sendInvite(user, 'jean@restaurant.fr', /Envoyer l’invitation/)
    expect(
      await screen.findByText('Erreur de connexion. Vérifiez votre connexion internet.'),
    ).toBeInTheDocument()
  })

  it('TE4: modalul de eliminare în franceză', async () => {
    const user = userEvent.setup()
    inLang('fr', tab())
    await screen.findByText('Ana')
    await user.click(screen.getByRole('button', { name: 'Retirer Ana de l’équipe' }))
    expect(screen.getByText('Retirer de l’équipe')).toBeInTheDocument()
    const question = screen.getByText(
      (_, el) => el?.tagName === 'P' && /^Voulez-vous vraiment/.test(el.textContent ?? ''),
    )
    expect(question.textContent).toBe('Voulez-vous vraiment retirer Ana ?')
    expect(screen.getAllByRole('button', { name: 'Annuler' }).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Retirer' }))
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith({ membershipId: 'm2' }))
    expect(await screen.findByText('Membre retiré')).toBeInTheDocument()
  })

  it('TE5: încărcarea eșuată — română = serverul, engleză/germană fără el', async () => {
    const SERVER = 'Echipa nu poate fi citită: restaurantul e suspendat.'
    h.members = { data: null, error: { message: SERVER, code: 'P0001' } }
    const ro = inLang(null, tab())
    expect(await screen.findByText(SERVER)).toBeInTheDocument()
    ro.unmount()
    const r = inLang('en', tab())
    expect(await screen.findByText('The team couldn’t be loaded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText(SERVER)).not.toBeInTheDocument()
    r.rerender(tree('de', tab()))
    expect(screen.getByText('Das Team konnte nicht geladen werden')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
  })

  it('TE6: locurile din echipă — contor, echipa plină, retrimiterea', async () => {
    const seatsPlan = (limit: number | null): RestaurantFeatures => ({
      plan: 'growth',
      features: { max_team_members: { enabled: true, limit } },
    })
    const FULL_RO = /^Toate locurile din echipă sunt ocupate\./
    const user = userEvent.setup()

    // Control pozitiv: 2 membri + 1 invitație din 10 → contor, fără explicație.
    h.features = seatsPlan(10)
    const free = inLang(null, tab())
    await screen.findByText('Ana')
    expect(screen.getByText('Locuri ocupate: 3 din 10 (membri și invitații în așteptare)')).toBeInTheDocument()
    expect(screen.queryByText(FULL_RO)).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('ion@restaurant.ro'), 'nou2@bistro.ro')
    expect(screen.getByRole('button', { name: /Trimite invitație/ })).toBeEnabled()
    free.unmount()

    // Plin: 3 din 3 → explicația, trimiterea oprită pentru o adresă nouă.
    h.features = seatsPlan(3)
    const full = inLang(null, tab())
    await screen.findByText('Ana')
    expect(screen.getByText('Locuri ocupate: 3 din 3 (membri și invitații în așteptare)')).toBeInTheDocument()
    expect(screen.getByText(FULL_RO)).toBeInTheDocument()
    const input = screen.getByPlaceholderText('ion@restaurant.ro')
    await user.type(input, 'nou2@bistro.ro')
    const send = screen.getByRole('button', { name: /Trimite invitație/ })
    expect(send).toBeDisabled()
    await user.click(send)
    // Nici Enter din câmp nu trimite (garda din `sendInvite`, nu doar butonul).
    await user.type(input, '{Enter}')
    expect(fetchMock).not.toHaveBeenCalled()
    // Adresa deja în așteptare: retrimiterea o înlocuiește, deci butonul revine.
    await user.clear(input)
    await user.type(input, 'NOU@bistro.ro')
    expect(screen.getByRole('button', { name: /Trimite invitație/ })).toBeEnabled()
    full.unmount()

    // Engleză, plin: textele traduse, fără resturi românești.
    const en = inLang('en', tab())
    await screen.findByText('Ana')
    expect(screen.getByText('Seats taken: 3 of 3 (members and pending invitations)')).toBeInTheDocument()
    expect(screen.getByText(/^All team seats are taken\./)).toBeInTheDocument()
    expect(romanianLeftovers(visible(en.container), 'en')).toEqual([])
    en.unmount()

    // Nelimitat / plan necunoscut → fără contor, trimiterea rămâne deschisă.
    for (const f of [seatsPlan(null), seatsPlan(1000), null]) {
      h.features = f
      const r = inLang(null, tab())
      await screen.findByText('Ana')
      expect(screen.queryByText(/^Locuri ocupate/)).not.toBeInTheDocument()
      expect(screen.queryByText(FULL_RO)).not.toBeInTheDocument()
      r.unmount()
    }
  })

  it('TE7: refuzul `team_member_limit` — română = serverul, engleză după cod, lista reîncărcată', async () => {
    const SERVER_RO =
      'Toate locurile din echipă sunt ocupate (membri și invitații în așteptare). Elimină un membru ' +
      'sau anulează o invitație ca să eliberezi un loc.'
    fetchMock.mockResolvedValue(jsonResponse(409, { error: SERVER_RO, code: 'team_member_limit' }))
    const user = userEvent.setup()
    const ro = inLang(null, tab())
    await screen.findByText('Ana')
    await sendInvite(user, 'ion@restaurant.ro', /Trimite invitație/)
    expect(await screen.findByText(SERVER_RO)).toBeInTheDocument()
    await waitFor(() => expect(h.reloadFeatures).toHaveBeenCalledTimes(1))
    ro.unmount()

    inLang('en', tab())
    await screen.findByText('Ana')
    await sendInvite(user, 'john@restaurant.com', /Send invitation/)
    expect(
      await screen.findByText(
        'All team seats are taken (members and pending invitations). Remove a member or cancel an ' +
          'invitation to free up a seat.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Couldn’t send the invitation')).not.toBeInTheDocument()
  })
})

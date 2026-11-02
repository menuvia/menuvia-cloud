// Vizita de fondator / partener e legată de contul care a cerut-o.
//
// Raportul fondatorului (02.11.2026): „intru de pe alt cont și îmi apare panoul
// de fondator”. Cheile `menuvia_founder_view*` stau în localStorage, deci
// supraviețuiesc unei delogări și unei sesiuni noi deschise dintr-un link, iar
// RestaurantContext nu vedea schimbarea de identitate în cazul ăsta.
//
//   FV1  cheia scrisă de contul A, citită pe contul B → null și ȘTEARSĂ
//        (mutație: fără comparația cu proprietarul → B primește restaurantul)
//   FV2  control: contul A își citește propria vizită
//   FV3  cheie fără proprietar (versiune veche a clientului) → null + ștearsă
//   FV4  fără sesiune, enterFounderView nu scrie nimic; cu sesiune scrie și
//        proprietarul (mutație: fără cheia de proprietar → FV1 nu mai poate
//        funcționa, FV4 pică)
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: m.getSession },
    rpc: m.rpc,
  },
}))

import { getFounderView, enterFounderView, clearFounderView } from '../founder'

const KEYS = ['menuvia_founder_view', 'menuvia_founder_view_from', 'menuvia_founder_view_uid']

beforeEach(() => {
  localStorage.clear()
  m.getSession.mockReset()
  m.rpc.mockReset().mockResolvedValue({ data: null, error: null })
})

describe('getFounderView — vizita aparține contului care a cerut-o', () => {
  it('FV1 cheia contului A nu se aplică pe contul B și se șterge', () => {
    localStorage.setItem('menuvia_founder_view', 'r-1')
    localStorage.setItem('menuvia_founder_view_from', 'founder')
    localStorage.setItem('menuvia_founder_view_uid', 'user-a')
    expect(getFounderView('user-b')).toBeNull()
    for (const k of KEYS) expect(localStorage.getItem(k), k).toBeNull()
  })

  it('FV2 control: contul A își vede vizita', () => {
    localStorage.setItem('menuvia_founder_view', 'r-1')
    localStorage.setItem('menuvia_founder_view_uid', 'user-a')
    expect(getFounderView('user-a')).toBe('r-1')
  })

  it('FV3 o cheie fără proprietar nu se folosește', () => {
    localStorage.setItem('menuvia_founder_view', 'r-1')
    expect(getFounderView('user-a')).toBeNull()
    expect(localStorage.getItem('menuvia_founder_view')).toBeNull()
  })

  it('fără user nu există vizită', () => {
    localStorage.setItem('menuvia_founder_view', 'r-1')
    localStorage.setItem('menuvia_founder_view_uid', 'user-a')
    expect(getFounderView(null)).toBeNull()
  })

  it('clearFounderView șterge toate cele trei chei', () => {
    for (const k of KEYS) localStorage.setItem(k, 'x')
    clearFounderView()
    for (const k of KEYS) expect(localStorage.getItem(k), k).toBeNull()
  })
})

describe('enterFounderView — scrie și proprietarul', () => {
  it('FV4 fără sesiune nu scrie nimic; cu sesiune scrie restaurantul și proprietarul', async () => {
    m.getSession.mockResolvedValueOnce({ data: { session: null } })
    await enterFounderView('r-1')
    for (const k of KEYS) expect(localStorage.getItem(k), k).toBeNull()

    m.getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'user-a' } } } })
    await enterFounderView('r-2', 'afiliat')
    expect(localStorage.getItem('menuvia_founder_view')).toBe('r-2')
    expect(localStorage.getItem('menuvia_founder_view_uid')).toBe('user-a')
    expect(getFounderView('user-a')).toBe('r-2')
    expect(getFounderView('user-b')).toBeNull()
  })
})

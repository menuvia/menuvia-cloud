// Fila Bridge după lotul C7a: starea reală a dispozitivului și instalarea în
// 3 pași. (Prefixele BQ/BW: verificate cu grep în src/, tests/, e2e/,
// supabase/, docs/, bridge/ și CLAUDE.md, nefolosite înainte; BQ1/BW1–BW3 sunt
// testele pure din src/lib/__tests__.)
//
//   BQ2  un device cu `status='online'` (flagul LIPICIOS din mig 265) dar
//        `last_seen_at` acum 10 minute e afișat „○ Offline"; unul văzut acum
//        30 s e „● Online" (control pozitiv). Iar `status` nici nu se mai cere.
//        Mutația care pică: pastila desenată din `d.status` (vechiul
//        `DEVICE_STATUS[d.status]`).
//   BW4  Planul 2, fără `VITE_BRIDGE_DOWNLOAD_URL`: fereastra cheii are cei 3
//        pași, NICIUN link de descărcare (niciodată unul mort) ci explicația
//        cum se obține programul; „Descarcă config.json" dă fișierul
//        `config.json` cu cheia dispozitivului și `kitchen.enabled: true`.
//        Mutația care pică: config.json fără secțiunea de bucătărie pe Planul 2,
//        sau un link de rezervă scris în cod.
//   BW5  cu linkul configurat: butonul installer-ului duce exact la el, în
//        fereastra cheii ȘI în starea goală (aceiași pași). Control pozitiv al
//        lui BW4 — fără el, „niciun link" ar trece și cu pasul 1 șters.
//   BW6  Planul 3: config.json FĂRĂ secțiunea de bucătărie, iar fereastra
//        rămâne în română (fiscal). Mutația care pică: `kitchenOnly: true`
//        necondiționat.
//   BW8  pasul 2 arată COADA cheii noi (`…zz99`, ce afișează wizardul) — un
//        config.json vechi păstrat de installer se vede la instalare — iar
//        pasul 3, pe AMBELE planuri, cere pornirea bridge-ului și „● Online”
//        și după 3 minute: `--check` scrie singur last_seen_at, deci „apare
//        Online după verificare” era o dovadă falsă. Mutațiile care pică:
//        rândul cu coada scos; textul vechi al pasului 3 („apoi apare aici
//        «● Online»”) pe oricare plan. Control pozitiv: rândul cu coada NU
//        conține cheia întreagă (altfel „conține …zz99” ar trece și dacă s-ar
//        afișa cheia în locul cozii).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const SECRET = 'dev-secret-0123456789abcdef-zz99'

const { h } = vi.hoisted(() => ({
  h: {
    tables: {} as Record<string, unknown[]>,
    selects: [] as Array<{ table: string; columns: string }>,
    downloadUrl: null as string | null,
    publicConfig: { supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'anon-test' } as {
      supabaseUrl: string
      supabaseAnonKey: string
    } | null,
  },
}))

vi.mock('../../lib/supabase', () => {
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['eq', 'order', 'limit', 'delete', 'update', 'insert']) {
      b[m] = vi.fn(() => b)
    }
    b.select = vi.fn((columns: string) => {
      h.selects.push({ table, columns })
      return b
    })
    b.then = (
      onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: h.tables[table] ?? [], error: null }).then(onFulfilled, onRejected)
    return b
  }
  return {
    supabase: {
      from: vi.fn((t: string) => chain(t)),
      rpc: vi.fn((fn: string) =>
        Promise.resolve(
          fn === 'bridge_register'
            ? { data: [{ device_id: 'dev-new', device_secret: SECRET }], error: null }
            : { data: null, error: null },
        ),
      ),
    },
  }
})

vi.mock('../../lib/bridgeSetup', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getBridgeDownloadUrl: () => h.downloadUrl,
  getBridgePublicConfig: () => h.publicConfig,
}))

import BridgeTab from '../BridgeTab'

const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString()

// Ce pleacă la descărcare: conținutul Blob-ului și numele fișierului.
const blobParts: unknown[][] = []
const downloads: string[] = []
const spies: Array<{ mockRestore: () => void }> = []

beforeEach(() => {
  h.tables = { bridge_devices: [], kitchen_tickets: [], pending_receipts: [], vat_rates: [] }
  h.selects = []
  h.downloadUrl = null
  h.publicConfig = { supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'anon-test' }
  blobParts.length = 0
  downloads.length = 0
  const OrigBlob = Blob
  class CapturingBlob extends OrigBlob {
    constructor(p?: BlobPart[], o?: BlobPropertyBag) {
      super(p, o)
      blobParts.push(p ?? [])
    }
  }
  vi.stubGlobal('Blob', CapturingBlob)
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:cfg'), revokeObjectURL: vi.fn() })
  spies.push(
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    }),
  )
})

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore()
  vi.unstubAllGlobals()
})

async function registerDevice(fiscal: boolean) {
  const user = userEvent.setup()
  render(<BridgeTab restaurantId="r1" fiscalEnabled={fiscal} />)
  const open = await screen.findAllByRole('button', {
    name: fiscal ? /^înregistrează casă$/i : /^înregistrează dispozitiv$/i,
  })
  await user.click(open[0])
  await user.click(screen.getByRole('button', { name: /^înregistrează$/i }))
  const steps = await screen.findByTestId('bridge-key-steps')
  return { user, steps }
}

function downloadedConfig(): Record<string, unknown> {
  expect(downloads).toEqual(['config.json'])
  return JSON.parse(String(blobParts[blobParts.length - 1]?.[0])) as Record<string, unknown>
}

describe('BridgeTab — starea dispozitivului (C7a)', () => {
  it('BQ2: „Online" doar cu semnal în ultimele 3 minute, nu din flagul `status`', async () => {
    h.tables.bridge_devices = [
      { id: 'd-old', name: 'PC vechi', status: 'online', last_seen_at: minutesAgo(10), fiscalnet_brand: null, fiscalnet_model: null, prints_kitchen_receipts: true },
      { id: 'd-live', name: 'PC nou', status: 'online', last_seen_at: new Date(Date.now() - 30_000).toISOString(), fiscalnet_brand: null, fiscalnet_model: null, prints_kitchen_receipts: true },
    ]
    render(<BridgeTab restaurantId="r1" fiscalEnabled={false} />)
    expect(await screen.findByText('PC vechi')).toBeInTheDocument()
    const pills = screen.getAllByTestId('bridge-device-status').map((el) => el.textContent)
    expect(pills).toEqual(['○ Offline', '● Online'])
    expect(screen.getByText('Ultim semnal 10 min')).toBeInTheDocument()
    const deviceReads = h.selects.filter((s) => s.table === 'bridge_devices')
    expect(deviceReads.length).toBeGreaterThan(0)
    for (const r of deviceReads) {
      expect(r.columns.split(',')).toContain('last_seen_at')
      expect(r.columns.split(',')).not.toContain('status')
    }
  })
})

describe('BridgeTab — instalarea în 3 pași (C7a)', () => {
  it('BW4: Planul 2 fără link — pașii, explicația, config.json cu bucătăria', async () => {
    const { user, steps } = await registerDevice(false)
    expect(screen.getByText('Dispozitiv înregistrat')).toBeInTheDocument()
    expect(within(steps).getByText('Descarcă Menuvia Bridge')).toBeInTheDocument()
    expect(within(steps).queryByRole('link')).toBeNull()
    expect(within(steps).getByText(/Linkul de descărcare nu e publicat încă/)).toBeInTheDocument()
    expect(within(steps).getByText('Pornește bridge-ul și verifică')).toBeInTheDocument()
    expect(within(steps).getByTestId('bridge-device-secret')).toHaveTextContent(SECRET)
    // Starea goală din spate: aceiași pași, tot fără link.
    expect(within(screen.getByTestId('bridge-empty-steps')).queryByRole('link')).toBeNull()

    await user.click(within(steps).getByRole('button', { name: /descarcă config\.json/i }))
    expect(downloadedConfig()).toEqual({
      supabaseUrl: 'https://proj.supabase.co',
      supabaseAnonKey: 'anon-test',
      deviceSecret: SECRET,
      fiscalnet: { required: false },
      kitchen: { enabled: true, mode: 'tcp' },
    })
  })

  it('BW5: linkul configurat apare în fereastra cheii și în starea goală', async () => {
    h.downloadUrl = 'https://files.example.org/menuvia-bridge-setup.exe'
    const { steps } = await registerDevice(false)
    const link = within(steps).getByRole('link', { name: /descarcă installer-ul/i })
    expect(link).toHaveAttribute('href', 'https://files.example.org/menuvia-bridge-setup.exe')
    expect(within(steps).queryByText(/Linkul de descărcare nu e publicat încă/)).toBeNull()
    const empty = within(screen.getByTestId('bridge-empty-steps')).getByRole('link')
    expect(empty).toHaveAttribute('href', 'https://files.example.org/menuvia-bridge-setup.exe')
  })

  it('BW6: Planul 3 — config.json fără bucătărie, fereastra în română', async () => {
    const { user, steps } = await registerDevice(true)
    expect(screen.getByText('Casă înregistrată')).toBeInTheDocument()
    expect(within(steps).getByText(/pe PC-ul cu FiscalNet/)).toBeInTheDocument()
    await user.click(within(steps).getByRole('button', { name: /descarcă config\.json/i }))
    expect(downloadedConfig()).toEqual({
      supabaseUrl: 'https://proj.supabase.co',
      supabaseAnonKey: 'anon-test',
      deviceSecret: SECRET,
    })
  })

  it.each([false, true])('BW8: coada cheii la pasul 2, pornirea + 3 minute la pasul 3 (fiscal=%s)', async (fiscal) => {
    const { steps } = await registerDevice(fiscal)
    const tail = within(steps).getByTestId('bridge-secret-tail')
    expect(tail).toHaveTextContent('…zz99')
    expect(tail.textContent).not.toContain(SECRET)

    const step3 = within(steps).getByText('Pornește bridge-ul și verifică').closest('li')
    expect(step3).not.toBeNull()
    const text = step3?.textContent ?? ''
    expect(text).toMatch(/Installer-ul pornește bridge-ul la final/)
    expect(text).toMatch(/„Pornește bridge-ul”/)
    expect(text).toMatch(/și după 3 minute/)
    expect(text).not.toMatch(/apoi (dispozitivul|casa) apare aici/)
  })
})

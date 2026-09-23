// Teste pe `recordQrScan` (RESID-14 / decizia C10).
//
// De ce există: RPC-ul `record_qr_scan` (mig 013→261) a stat NECHEMAT din mai
// 2026 — măsurat pe producție la 20 sept 2026, `qr_scans` avea 0 rânduri, cu 35
// de mese cu token QR activ. E singura măsură de ACTIVARE pe QR.
//
// Ce păzește: analytics-ul NU are voie să atingă fluxul de comandă. Wrapper-ul
// e fire-and-forget prin construcție — dacă ar arunca, `loadQr` din QrMenuPage
// ar propaga eroarea în `.catch`-ul care setează `networkError`, adică o
// scanare neînregistrată ar deveni „meniul nu se încarcă" pentru oaspetele de
// la masă. Exact clasa RESID-15, pe altă cale.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import { recordQrScan } from '../qr'

// S4/S5 citesc SURSA paginii. Calea se rezolvă din `process.cwd()` (rădăcina
// repo-ului — `vitest.config.ts` nu setează `root`), NU din `import.meta.url`:
// sub vitest acela nu e un URL `file://`, iar `readFileSync(new URL(...))`
// aruncă ERR_INVALID_URL_SCHEME înainte de orice asserție (CI roșu pe #269).
const QR_MENU_PAGE = resolve(process.cwd(), 'src/pages/QrMenuPage.tsx')

describe('recordQrScan — RESID-14', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    vi.restoreAllMocks()
  })

  it('S1 cheamă RPC-ul cu numele și parametrii din mig 261', async () => {
    rpcMock.mockResolvedValue({ error: null })
    await recordQrScan('rest-1', 'tok-1')
    expect(rpcMock).toHaveBeenCalledTimes(1)
    // Numele parametrilor e CONTRACT: PostgREST rezolvă supraîncărcarea pe ele.
    // `record_qr_scan(p_restaurant_id uuid, p_qr_token_id uuid)` — mig 261.
    expect(rpcMock).toHaveBeenCalledWith('record_qr_scan', {
      p_restaurant_id: 'rest-1',
      p_qr_token_id: 'tok-1',
    })
  })

  it('S2 NU aruncă atunci când RPC-ul întoarce eroare', async () => {
    // Cazul real: RPC nedeployat (PGRST202) pe un client livrat înaintea
    // migrației. Meniul trebuie să se încarce oricum.
    rpcMock.mockResolvedValue({ error: { message: 'function does not exist', code: 'PGRST202' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(recordQrScan('rest-1', 'tok-1')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('S3 NU aruncă nici când promisiunea RPC-ului e respinsă (rețea moartă)', async () => {
    // Defect găsit de test, înainte de push: apelantul face `void recordQrScan(...)`,
    // iar o promisiune `void`-uită care se respinge e UNHANDLED REJECTION în
    // browserul oaspetelui. Prima variantă a wrapper-ului lăsa respingerea să
    // treacă. Acum e prinsă în wrapper — imposibil de folosit greșit.
    rpcMock.mockRejectedValue(new Error('Failed to fetch'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(recordQrScan('rest-1', 'tok-1')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('S4 apelul din QrMenuPage e `void`-uit (intenția fire-and-forget e explicită)', () => {
    const src = readFileSync(QR_MENU_PAGE, 'utf8')
    expect(src).toMatch(/void recordQrScan\(/)
  })

  it('S5 guard-ul de o-singură-dată e un SET pe token, nu un boolean', () => {
    // O scanare = un rând. `loadQr` se re-execută la schimbarea token-ului, iar
    // sub StrictMode efectul rulează de două ori la montare — un boolean ar
    // bloca a doua MASĂ, un set contorizează corect ambele.
    const src = readFileSync(QR_MENU_PAGE, 'utf8')
    expect(src).toMatch(/scanReportedRef\s*=\s*useRef<Set<string>>/)
    expect(src).toMatch(/scanReportedRef\.current\.has\(token\)/)
    expect(src).toMatch(/scanReportedRef\.current\.add\(token\)/)
  })
})

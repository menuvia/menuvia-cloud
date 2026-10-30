// Teste pe OnboardingPage — funelul de activare (audit aug 2026: 4/4
// utilizatori reali au murit la pasul „introdu meniul", fără nicio plasă de
// teste pe wizard):
//   - Pasul 1 se randează și cere numele (buton dezactivat fără el); linkul
//     meniului se creează din nume (OB-S1)
//   - crearea restaurantului avansează la Pasul 2
//   - Pasul 2 oferă importul din poză ca acțiune primară + formularul manual;
//     importul primește plafonul planului (AQ3); meniul demo e cel public (OB-D1)
//   - Pasul 3: ridicarea doar pe planurile care o au (OB-P1, OB-P1b, OB-P2)
//   - ecranul final: bifele din ce s-a creat real și PDF-ul cu QR-uri (OQ1–OQ3);
//     cu plan ales înainte de cont, butonul final duce la activarea lui (RQ8)
// Pattern de mock-uri ca în ReservePage.test.tsx (supabase + module).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LimitDetail } from '../../lib/features'

const {
  createRestaurantMock,
  trackMock,
  aiImportPropsMock,
  getLimitDetailedMock,
  fetchFeaturesMock,
  hasFeatureMock,
  downloadQrPdfMock,
  db,
} = vi.hoisted(() => ({
  createRestaurantMock: vi.fn(),
  trackMock: vi.fn(),
  aiImportPropsMock: vi.fn(),
  getLimitDetailedMock: vi.fn((): LimitDetail => ({ kind: 'unlimited' })),
  // `{}` = un răspuns oarecare (nenul) al RPC-ului; `null` = RPC picat.
  fetchFeaturesMock: vi.fn<() => Promise<object | null>>(() => Promise.resolve({})),
  hasFeatureMock: vi.fn<(features: unknown, name: string) => boolean>(() => true),
  downloadQrPdfMock: vi.fn<(input: Record<string, unknown>) => Promise<string>>(() =>
    Promise.resolve('qr.pdf'),
  ),
  // Ce scrie onboarding-ul în bază (UPDATE-uri), pe tabelă; `failTokens` = inserarea
  // token-urilor QR pică.
  db: {
    updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
    failTokens: false,
  },
}))

vi.mock('../../lib/restaurants', () => ({ createRestaurant: createRestaurantMock }))
vi.mock('../../lib/analytics', () => ({ track: trackMock }))
// Supabase: doar lanțurile atinse de onboarding (markOnboarding = update().eq()).
// Fiecare UPDATE se înregistrează în `db.updates`, pe tabelă.
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        db.updates.push({ table, payload })
        return { eq: () => Promise.resolve({ error: null }) }
      },
      // Pasul 3: mesele (id + nume) și token-urile lor QR se întorc la inserare.
      insert: (rows: Array<Record<string, unknown>>) => ({
        select: () => {
          if (table === 'tables')
            return Promise.resolve({
              data: rows.map((r, i) => ({ id: `t${i + 1}`, name: r.name })),
              error: null,
            })
          if (table === 'qr_tokens' && db.failTokens)
            return Promise.resolve({ data: null, error: { message: 'boom' } })
          if (table === 'qr_tokens')
            return Promise.resolve({
              data: rows.map((r, i) => ({ table_id: r.table_id, token: `tok${i + 1}` })),
              error: null,
            })
          return Promise.resolve({ data: rows, error: null })
        },
      }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))
// Features (Pașii 2–4) — fără fetch real; tristate controlat per test.
vi.mock('../../lib/features', () => ({
  fetchRestaurantFeatures: fetchFeaturesMock,
  getLimit: vi.fn(() => null),
  getLimitDetailed: getLimitDetailedMock,
  hasFeature: hasFeatureMock,
}))
// PDF-ul cu QR-uri (lib/qrPdf.ts, încărcat la cerere de ecranul final).
vi.mock('../../lib/qrPdf', () => ({ downloadQrPdf: downloadQrPdfMock }))
// AiMenuImport e lazy + greu (hooks de date); aici verificăm doar că butonul
// de deschidere există în Pasul 2 și ce props primește modalul, nu modalul în sine.
vi.mock('../../components/AiMenuImport', () => ({
  default: (props: { remainingSlots?: number }) => {
    aiImportPropsMock(props)
    return null
  },
}))

import OnboardingPage from '../OnboardingPage'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ONBOARDING_SRC = readFileSync(resolve(process.cwd(), 'src/pages/OnboardingPage.tsx'), 'utf8')

beforeEach(() => {
  vi.clearAllMocks()
  getLimitDetailedMock.mockReturnValue({ kind: 'unlimited' })
  fetchFeaturesMock.mockImplementation(() => Promise.resolve({}))
  hasFeatureMock.mockImplementation(() => true)
  db.updates.length = 0
  db.failTokens = false
  downloadQrPdfMock.mockImplementation(() => Promise.resolve('qr.pdf'))
  window.localStorage.clear()
})

// Completează Pasul 1 (nume + Continuă) și așteaptă Pasul 2.
async function reachStep2() {
  const user = userEvent.setup()
  createRestaurantMock.mockResolvedValue({ restaurant_id: 'r1', restaurant_slug: 'la-bella' })
  render(<OnboardingPage onComplete={vi.fn()} />)
  await user.type(screen.getByLabelText(/numele restaurantului/i), 'La Bella')
  await user.click(screen.getByRole('button', { name: /continuă/i }))
  await screen.findByText('Adaugă primul produs')
  return user
}

// Pasul 2 → „Sari peste” → Pasul 3.
async function reachStep3() {
  const user = await reachStep2()
  await user.click(screen.getByRole('button', { name: /sari peste acest pas/i }))
  await screen.findByText('Câte mese are restaurantul?')
  return user
}

type DbUpdate = { table: string; payload: Record<string, unknown> }
const pickupWrites = (): DbUpdate[] =>
  db.updates.filter((u: DbUpdate) => u.table === 'restaurants' && 'pickup_settings' in u.payload)

describe('OnboardingPage — funelul de activare', () => {
  it('Pasul 1 se randează cu titlul și butonul Continuă dezactivat fără nume', () => {
    render(<OnboardingPage onComplete={vi.fn()} />)
    expect(screen.getByText('Configurează restaurantul')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continuă/i })).toBeDisabled()
    // Telemetria pornește la mount — funelul devine măsurabil.
    expect(trackMock).toHaveBeenCalledWith('onboarding_started')
  })

  it('completarea numelui creează restaurantul și avansează la Pasul 2', async () => {
    await reachStep2()
    expect(createRestaurantMock).toHaveBeenCalledTimes(1)
    expect(createRestaurantMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'La Bella' }))
    expect(trackMock).toHaveBeenCalledWith('onboarding_step_completed', { step: 1, skipped: false })
  })

  // OB-S1 (ux-owner-slug): linkul nu mai e un câmp cerut patronului și nu mai
  // rupe diacriticele. Mutația care pică: slugify-ul vechi (`[^a-z0-9]+` direct
  // pe litere mici) → „casa-r-neasc” în previzualizare și în apel.
  it('OB-S1 linkul se creează din nume, cu diacriticele transliterate, fără câmp de slug', async () => {
    const user = userEvent.setup()
    createRestaurantMock.mockResolvedValue({
      restaurant_id: 'r1',
      restaurant_slug: 'casa-taraneasca',
    })
    render(<OnboardingPage onComplete={vi.fn()} />)
    expect(screen.queryByLabelText(/url meniu/i)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/numele restaurantului/i), 'Casa Țărănească')
    expect(screen.getByTestId('ob-link-preview')).toHaveTextContent(/\/m\/casa-taraneasca$/)
    await user.click(screen.getByRole('button', { name: /continuă/i }))
    await screen.findByText('Adaugă primul produs')
    expect(createRestaurantMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Casa Țărănească', slug: 'casa-taraneasca' }),
    )
  })

  // AQ3 (ux-owner-ai-import-plafon): onboarding-ul trimite plafonul planului
  // importului AI, ca un meniu peste plafon să fie oprit ÎNAINTE de salvare.
  // Mutația care pică: <AiMenuImport> fără remainingSlots (comportamentul vechi).
  it('AQ3 importul din poză primește plafonul de produse al planului', async () => {
    getLimitDetailedMock.mockReturnValue({ kind: 'limited', n: 15 })
    const user = await reachStep2()
    await user.click(screen.getByRole('button', { name: /ai meniul tipărit/i }))
    await waitFor(() =>
      expect(aiImportPropsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ restaurantId: 'r1', remainingSlots: 15 }),
      ),
    )
  })

  it('Pasul 2 oferă importul din poză ca acțiune primară, cu formularul manual dedesubt', async () => {
    await reachStep2()
    expect(screen.getByRole('button', { name: /ai meniul tipărit/i })).toBeInTheDocument()
    // Formularul manual rămâne disponibil (nu a fost înlocuit de import).
    expect(screen.getByLabelText('Produs *')).toBeInTheDocument()
    // Și alternativa de Skip cu meniu demo e prezentă (meniul demo PUBLIC, OB-D1).
    expect(screen.getByRole('link', { name: /meniul demo/i })).toBeInTheDocument()
  })

  // OB-D1 (ux-owner-demo-menus): meniul demo NU se mai inserează în restaurantul
  // omului (presetul umplea plafonul gratuit — cafenea = 15/15 — și publica pe QR
  // produse false). Rămâne meniul demo public, într-o filă nouă. Mutația care
  // pică: butoanele de preset readuse (sau importul applyBusinessTypePreset).
  it('OB-D1 meniul demo e cel public, într-o filă nouă; nimic nu se inserează', async () => {
    await reachStep2()
    const demo = screen.getByRole('link', { name: /meniul demo/i })
    expect(demo).toHaveAttribute('href', '/demo')
    expect(demo).toHaveAttribute('target', '_blank')
    expect(demo).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.queryByRole('button', { name: /meniu demo de/i })).not.toBeInTheDocument()
    expect(ONBOARDING_SRC).not.toContain('applyBusinessTypePreset')
  })

  // OB-P1 (ux-owner-pickup-tier1): pe un plan FĂRĂ `pickup_orders`, „Nu am mese”
  // nu mai pornește ridicarea (meniul public o oferea oaspeților, iar serverul
  // le respingea toate comenzile) — rămâne QR-ul general. Mutația care pică:
  // butonul vechi, care scria `pickup_settings.enabled = true` pe orice plan.
  it('OB-P1 fără pickup_orders: QR-ul general, ridicarea NU se pornește', async () => {
    hasFeatureMock.mockImplementation((_f: unknown, name: string) => name !== 'pickup_orders')
    const user = await reachStep3()
    // Așteptăm planul citit (până atunci butonul e cel neutru, „doar ridicare”).
    const generalQr = await screen.findByRole('button', { name: /qr-ul general al meniului/i })
    expect(screen.queryByRole('button', { name: /doar ridicare/i })).not.toBeInTheDocument()
    expect(screen.getByText(/ridicare necesită planul/i)).toBeInTheDocument()
    await user.click(generalQr)
    await screen.findByRole('heading', { name: /gata!/i })
    expect(pickupWrites()).toHaveLength(0)
  })

  it('OB-P1b cu pickup_orders: „doar ridicare” pornește ridicarea + pickup_only', async () => {
    const user = await reachStep3()
    await user.click(await screen.findByRole('button', { name: /doar ridicare/i }))
    await screen.findByRole('heading', { name: /gata!/i })
    const writes = pickupWrites()
    expect(writes).toHaveLength(1)
    expect(writes[0]!.payload.pickup_settings).toEqual(
      expect.objectContaining({ enabled: true, pickup_only: true }),
    )
  })

  // OB-P2: planul NECUNOSCUT (RPC picat) nu pornește ridicarea „pe încredere”:
  // la apăsare se mai citește o dată, iar dacă tot nu se știe, eroare și nimic
  // scris. Mutația care pică: tristate-ul înlocuit cu implicitul vechi `true`.
  it('OB-P2 plan necunoscut: nicio ridicare pornită, mesaj de reîncercare', async () => {
    fetchFeaturesMock.mockImplementation(() => Promise.resolve(null))
    const user = await reachStep3()
    await user.click(screen.getByRole('button', { name: /doar ridicare/i }))
    expect(await screen.findByText(/nu am putut verifica planul/i)).toBeInTheDocument()
    expect(pickupWrites()).toHaveLength(0)
    expect(screen.getByText('Câte mese are restaurantul?')).toBeInTheDocument()
  })
})

// Ecranul final (ux-owner-final-screen): bifele vin din ce s-a creat REAL, iar
// PDF-ul cu QR-uri se descarcă de aici, nu „din tab-ul Mese & QR”.
describe('OnboardingPage — ecranul final', () => {
  // OQ1: meniu și mese sărite → „Aproape gata!”, meniul și mesele „de făcut”, iar
  // QR-ul de tipărit e posterul meniului general. Mutația care pică: bifele
  // hard-codate de dinainte (patru bife verzi pe un restaurant gol).
  it('OQ1 totul sărit: bifele spun adevărul, QR-ul de tipărit e al meniului', async () => {
    const user = await reachStep3()
    await user.click(screen.getByRole('button', { name: /sari peste acest pas/i }))
    expect(await screen.findByRole('heading', { name: 'Aproape gata!' })).toBeInTheDocument()
    expect(screen.getByTestId('ob-summary-restaurant')).toHaveTextContent('Restaurant creat')
    expect(screen.getByTestId('ob-summary-menu-empty')).toHaveTextContent(/de făcut/)
    expect(screen.getByTestId('ob-summary-tables-skipped')).toHaveTextContent(/de făcut/)
    expect(screen.queryByText('Meniu configurat')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /descarcă qr-ul meniului/i }))
    await waitFor(() => expect(downloadQrPdfMock).toHaveBeenCalledTimes(1))
    const arg = downloadQrPdfMock.mock.calls[0]![0] as {
      format: string
      canOrder: boolean
      filePrefix?: string
      restaurantName: string
      cards: Array<{ label: string; url: string }>
    }
    expect(arg.format).toBe('poster')
    expect(arg.canOrder).toBe(false)
    expect(arg.filePrefix).toBe('QR-Meniu')
    expect(arg.restaurantName).toBe('La Bella')
    expect(arg.cards).toHaveLength(1)
    expect(arg.cards[0]!.url).toMatch(/\/m\/la-bella$/)
  })

  // OQ2: mesele create → „N mese cu QR-uri” bifat și PDF-ul (grilă) cu token-ul
  // fiecărei mese. Mutația care pică: ecranul fără butonul de descărcare (doar
  // trimiterea spre Mese & QR) sau token-urile neîntoarse de la inserare.
  it('OQ2 mese create: PDF-ul cu QR-ul fiecărei mese, direct de pe ecranul final', async () => {
    const user = await reachStep3()
    await user.click(screen.getByRole('button', { name: /creează 5 mese/i }))
    expect(await screen.findByTestId('ob-summary-tables-qr')).toHaveTextContent(/5 mese cu QR-uri/)
    // Planul citit (comenzi prin QR) înainte de descărcare.
    await screen.findByTestId('ob-summary-orders-ready')
    await user.click(screen.getByRole('button', { name: /descarcă pdf-ul cu qr-urile/i }))
    await waitFor(() => expect(downloadQrPdfMock).toHaveBeenCalledTimes(1))
    const arg = downloadQrPdfMock.mock.calls[0]![0] as {
      format: string
      canOrder: boolean
      cards: Array<{ label: string; url: string }>
    }
    expect(arg.format).toBe('grid')
    expect(arg.canOrder).toBe(true)
    expect(arg.cards.map((c) => c.label)).toEqual([
      'Masa 1',
      'Masa 2',
      'Masa 3',
      'Masa 4',
      'Masa 5',
    ])
    expect(arg.cards[0]!.url).toMatch(/\/q\/tok1$/)
    expect(arg.cards[4]!.url).toMatch(/\/q\/tok5$/)
  })

  // OQ3: token-urile QR n-au putut fi create → mesele „de făcut”, iar PDF-ul care
  // se oferă e cel al meniului (nu un PDF de mese fără QR); un PDF eșuat spune de
  // ce și unde e alternativa.
  it('OQ3 fără token-uri: mesele „de făcut”; PDF eșuat → mesaj, nu tăcere', async () => {
    db.failTokens = true
    downloadQrPdfMock.mockImplementation(() => Promise.reject(new Error('jspdf')))
    const user = await reachStep3()
    await user.click(screen.getByRole('button', { name: /creează 5 mese/i }))
    expect(await screen.findByTestId('ob-summary-tables-no-qr')).toHaveTextContent(/de făcut/)
    await user.click(screen.getByRole('button', { name: /descarcă qr-ul meniului/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Mese & QR/)
  })

  // RQ8: cu un plan ales înainte de cont, butonul final numește pasul următor
  // (activarea planului), nu „Deschide dashboard-ul”.
  it('RQ8 cu plan ales: butonul final duce la activarea planului', async () => {
    const user = userEvent.setup()
    createRestaurantMock.mockResolvedValue({ restaurant_id: 'r1', restaurant_slug: 'la-bella' })
    const onComplete = vi.fn()
    render(<OnboardingPage onComplete={onComplete} pendingPlan="growth" />)
    await user.type(screen.getByLabelText(/numele restaurantului/i), 'La Bella')
    await user.click(screen.getByRole('button', { name: /continuă/i }))
    await user.click(await screen.findByRole('button', { name: /sari peste acest pas/i }))
    await screen.findByText('Câte mese are restaurantul?')
    await user.click(screen.getByRole('button', { name: /sari peste acest pas/i }))
    const cta = await screen.findByRole('button', { name: /continuă cu planul meniu \+ comenzi/i })
    await user.click(cta)
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  })
})

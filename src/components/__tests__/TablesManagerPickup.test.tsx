// Mese & QR fără nicio masă: QR-ul general și empty state-ul modului „doar
// ridicare”, pe planul restaurantului și pe stilul meniului (reziduurile R1 și
// R2 ale lui #324).
//
//   MQ1  plan CUNOSCUT fără ridicare, ridicarea + „doar ridicare” stocate
//        (downgrade): modul e SUSPENDAT — empty state-ul nu mai spune „activ —
//        nu ai nevoie de mese”, ci că panoul arată mesele și rezervările, iar
//        generatorul de mese rămâne. Mutația care pică: textul vechi pe
//        feature=false („Mod … activ”).
//   MQ2  control pozitiv: pe Meniu + Comenzi modul e activ și promite comenzi.
//   MQ3  stilul EFECTIV Flipbook (cu pagini) pe Meniu + Comenzi: nici QR-ul
//        general, nici empty state-ul nu promit comenzi; spun de ce. Mutația
//        care pică: textele fără stil (promiteau și pe flipbook).
//   MQ4  „doar ridicare” cu ridicarea OPRITĂ în setare e inert, ca în nav
//        (DashboardPage): fără empty state de mod. Mutația care pică: condiția
//        veche, doar pe `pickup_only`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Restaurant } from '../../hooks/useData'
import type { RestaurantFeatures } from '../../lib/features'

const h = vi.hoisted(() => ({
  features: null as RestaurantFeatures | null,
}))

vi.mock('../../hooks/useFeatures', () => ({
  useFeatures: () => ({
    features: h.features,
    loading: false,
    loadError: false,
    has: () => false,
    limit: () => null,
    within: () => true,
    reload: () => Promise.resolve(),
  }),
}))
vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,x') },
}))
// Niciun rând de masă: lista e goală, deci token-urile nu se mai citesc.
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'tables')
        return {
          select: () => ({
            eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
          }),
        }
      throw new Error('tabelă neașteptată: ' + table)
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))

import TablesManager from '../TablesManager'

const PAGE = 'https://cdn.example.com/meniu-1.webp'

const pickupFeatures = (pickup: boolean): RestaurantFeatures => ({
  plan: pickup ? 'growth' : 'free',
  features: { pickup_orders: { enabled: pickup, limit: null } },
})

function makeRestaurant(over: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'r1',
    name: 'Food Truck',
    slug: 'food-truck',
    primary_color: '#C8963C',
    theme_settings: null,
    pickup_settings: {
      enabled: true,
      min_lead_time_minutes: 20,
      slot_interval_minutes: 15,
      open_hours: { start: '09:00', end: '21:00' },
      instructions: null,
      pickup_only: true,
    },
    ...over,
  } as unknown as Restaurant
}

const ACTIVE = /^Mod „doar ridicare" activ/
const SUSPENDED = /^Mod „doar ridicare" suspendat/
const PROMISE = /(?<!nu )pot (și )?comanda|comandă și ridică/
const FLIPBOOK_WHY = /stilul Flipbook/

// Ancora: lista s-a încărcat (gol), deci absența empty state-ului nu vine
// dintr-un ecran de încărcare sau de eroare.
async function renderLoaded(restaurant: Restaurant) {
  render(<TablesManager restaurant={restaurant} />)
  expect(await screen.findByText('Nu ai mese configurate încă')).toBeInTheDocument()
}

beforeEach(() => {
  h.features = null
})

describe('TablesManager — modul „doar ridicare” pe planul restaurantului', () => {
  it('MQ1: plan fără ridicare — modul e suspendat, mesele rămân la îndemână', async () => {
    h.features = pickupFeatures(false)
    await renderLoaded(makeRestaurant())
    expect(screen.getByText(SUSPENDED)).toBeInTheDocument()
    expect(screen.getByText(/panoul îți arată mesele și rezervările/)).toBeInTheDocument()
    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument()
    expect(screen.queryByText(/nu ai nevoie de mese/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generează mese și QR-uri' })).toBeInTheDocument()
  })

  it('MQ2: control — pe Meniu + Comenzi modul e activ și promite comenzi', async () => {
    h.features = pickupFeatures(true)
    await renderLoaded(makeRestaurant())
    const box = screen.getByText(ACTIVE)
    expect(box.textContent).toMatch(PROMISE)
    expect(screen.queryByText(SUSPENDED)).not.toBeInTheDocument()
    expect(screen.getByText(/cu comenzile pentru ridicare active pot și comanda/)).toBeInTheDocument()
  })

  it('MQ3: Flipbook cu pagini pe Meniu + Comenzi — fără promisiune, cu motivul', async () => {
    h.features = pickupFeatures(true)
    await renderLoaded(
      makeRestaurant({
        theme_settings: { preset_id: 'cafe', menu_layout: 'flipbook', flipbook_pages: [PAGE] },
      }),
    )
    const box = screen.getByText(ACTIVE)
    expect(box.textContent).not.toMatch(PROMISE)
    expect(box.textContent).toMatch(FLIPBOOK_WHY)
    // QR-ul general (al doilea text despre comenzi de pe ecran) spune același lucru.
    expect(screen.queryByText(/pot și comanda/)).not.toBeInTheDocument()
    expect(screen.getAllByText(FLIPBOOK_WHY)).toHaveLength(2)
  })

  it('MQ4: ridicarea oprită în setare — „doar ridicare” e inert, ca în nav', async () => {
    h.features = pickupFeatures(true)
    await renderLoaded(
      makeRestaurant({
        pickup_settings: {
          enabled: false,
          min_lead_time_minutes: 20,
          slot_interval_minutes: 15,
          open_hours: { start: '09:00', end: '21:00' },
          instructions: null,
          pickup_only: true,
        },
      }),
    )
    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument()
    expect(screen.queryByText(SUSPENDED)).not.toBeInTheDocument()
  })
})

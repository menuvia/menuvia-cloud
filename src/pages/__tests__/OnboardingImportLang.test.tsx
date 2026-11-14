// Importul din poze în ONBOARDING, în limba funnel-ului (lotul L5a2). Funnel-ul
// e VIU în engleză (FunnelLangProvider, lotul L2b), deci modalul AiMenuImport —
// leneș, sub propriul `<Suspense fallback={null}>` din Pasul 2 — trebuie să
// apară în engleză, iar cât își încarcă dicționarul să nu suspende pagina.
// OnboardingPage.test.tsx (AQ3 & co.) mock-uiește modalul; aici e cel REAL.
// (Prefixul IM: vezi src/components/__tests__/ImportsLang.test.tsx.)
//   IM5  `?lang=en`: deschiderea modalului NU suspendă onboarding-ul (Pasul 2
//        rămâne pe ecran, rezerva exterioară nu apare), modalul vine în
//        engleză, iar un refuz al asistentului (cotă, mesaj românesc) are
//        textul englezesc, cu ieșirea „Add the products manually” — fără
//        resturi românești ale lui `imports`/`common`. Mutația care pică:
//        `<Suspense>` scos din jurul lui `<AiMenuImport>` (rezerva exterioară
//        înlocuiește Pasul 2) sau titlul modalului literal în română.
//   IM6  control: fără `?lang`, modalul și refuzul în română, ca înainte.
import { Suspense } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LimitDetail } from '../../lib/features'

const h = vi.hoisted(() => ({
  createRestaurant: vi.fn(),
  aiMenuImport: vi.fn(),
  getLimitDetailed: vi.fn((): LimitDetail => ({ kind: 'unlimited' })),
}))

vi.mock('../../lib/restaurants', () => ({ createRestaurant: h.createRestaurant }))
vi.mock('../../lib/analytics', () => ({ track: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: (rows: unknown[]) => ({ select: () => Promise.resolve({ data: rows, error: null }) }),
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
  },
}))
vi.mock('../../lib/features', () => ({
  fetchRestaurantFeatures: vi.fn(() => Promise.resolve({})),
  getLimit: vi.fn(() => null),
  getLimitDetailed: h.getLimitDetailed,
  hasFeature: vi.fn(() => true),
}))
vi.mock('../../lib/qrPdf', () => ({ downloadQrPdf: vi.fn() }))
vi.mock('../../hooks/useData', () => ({
  useProducts: () => ({ createMany: vi.fn(), create: vi.fn() }),
  useCategories: () => ({ categories: [], create: vi.fn() }),
}))
vi.mock('../../lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ai')>()
  return { ...actual, aiMenuImport: h.aiMenuImport }
})

import OnboardingPage from '../OnboardingPage'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { onboardingNs } from '../../i18n/ns/onboarding'
import { commonNs } from '../../i18n/ns/common'
import importsRo from '../../i18n/ns/imports/ro'
import importsEn from '../../i18n/ns/imports/en'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'

// Onboarding-ul și `common` gata în engleză; `imports` NU — modalul își
// încarcă dicționarul la deschidere, exact ca în producție.
beforeAll(async () => {
  await Promise.all([preloadNamespace(onboardingNs, 'en'), preloadNamespace(commonNs, 'en')])
})

beforeEach(() => {
  h.createRestaurant.mockReset().mockResolvedValue({ restaurant_id: 'r1', restaurant_slug: 'la-bella' })
  h.aiMenuImport.mockReset()
  h.getLimitDetailed.mockReturnValue({ kind: 'limited', n: 15 })
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
  window.localStorage.clear()
})

const QUOTA_RO = 'Ai atins limita lunară a asistentului AI.'
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)

function romanianLeftovers(text: string): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const pairs: [Dict, Dict][] = [
    [importsRo as Dict, importsEn as Dict],
    [commonRo as Dict, commonEn as Dict],
  ]
  for (const [src, tgt] of pairs)
    for (const [k, v] of Object.entries(src)) {
      const own = formsOf(tgt[k]).join('\n')
      for (const form of formsOf(v))
        for (const piece of form.split(/\{\w+\}/)) {
          const p = piece.trim()
          if (p.length >= 6 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
        }
    }
  return out
}

function aiErr(code: string, status: number, message: string): Error {
  return Object.assign(new Error(message), { code, status })
}

async function openImport(path: string, names: { label: RegExp; next: RegExp; step2: string; photo: RegExp }) {
  window.history.replaceState({}, '', path)
  const user = userEvent.setup()
  render(
    <Suspense fallback={<div>REZERVA-EXTERIOARĂ</div>}>
      <OnboardingPage onComplete={vi.fn()} />
    </Suspense>,
  )
  await user.type(await screen.findByLabelText(names.label), 'La Bella')
  await user.click(screen.getByRole('button', { name: names.next }))
  await screen.findByText(names.step2)
  await user.click(screen.getByRole('button', { name: names.photo }))
  return user
}

function modalOf(title: string): HTMLElement {
  const card = screen.getByText(title).parentElement?.parentElement
  if (!card) throw new Error('modalul lipsește')
  return card
}

async function upload(card: HTMLElement): Promise<void> {
  const input = card.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('input-ul de poze lipsește')
  await userEvent.upload(input, new File(['x'], 'meniu.png', { type: 'image/png' }))
}

describe('Onboarding — importul din poze în limba funnel-ului', () => {
  it('IM5 ?lang=en: modalul în engleză, fără să suspende Pasul 2', async () => {
    h.aiMenuImport.mockRejectedValueOnce(aiErr('quota_exceeded', 429, QUOTA_RO))
    const user = await openImport('/onboarding?lang=en', {
      label: /restaurant name/i,
      next: /continue/i,
      step2: 'Add your first product',
      photo: /printed menu/i,
    })
    // Cât se încarcă modalul (chunk + dicționar), Pasul 2 rămâne pe ecran.
    expect(screen.getByText('Add your first product')).toBeInTheDocument()
    expect(screen.queryByText('REZERVA-EXTERIOARĂ')).not.toBeInTheDocument()

    // Chunk-ul modalului + dicționarul `imports` (en) se încarcă la cerere.
    expect(await screen.findByText('📸 Import the menu from photos', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByText('REZERVA-EXTERIOARĂ')).not.toBeInTheDocument()
    const card = modalOf('📸 Import the menu from photos')
    expect(card.textContent).toContain('Take or upload up to 4 clear photos of the menu')
    expect(romanianLeftovers(card.textContent ?? '')).toEqual([])

    await upload(card)
    expect(await screen.findByText(importsEn.err_aiQuota)).toBeInTheDocument()
    expect(screen.queryByText(QUOTA_RO)).not.toBeInTheDocument()
    // Onboarding-ul oferă doar ieșirea manuală (nu are CSV).
    expect(screen.queryByRole('button', { name: 'Import from CSV' })).not.toBeInTheDocument()
    expect(romanianLeftovers(modalOf('📸 Import the menu from photos').textContent ?? '')).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Add the products manually' }))
    expect(screen.queryByText('📸 Import the menu from photos')).not.toBeInTheDocument()
    expect(screen.getByText('Add your first product')).toBeInTheDocument()
  })

  it('IM6 control: fără ?lang, modalul și refuzul în română', async () => {
    h.aiMenuImport.mockRejectedValueOnce(aiErr('quota_exceeded', 429, QUOTA_RO))
    await openImport('/onboarding', {
      label: /numele restaurantului/i,
      next: /continuă/i,
      step2: 'Adaugă primul produs',
      photo: /ai meniul tipărit/i,
    })
    await screen.findByText('📸 Import meniu din poze', {}, { timeout: 5000 })
    await upload(modalOf('📸 Import meniu din poze'))
    expect(await screen.findByText(QUOTA_RO)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adaugă produsele manual' })).toBeInTheDocument()
  })
})

// Scorul de sănătate în limba personalului (lotul L7): HealthScoreTab citește
// namespace-ul `health` („Reîncearcă” și clasele de erori din `common`);
// textele calculate vin din lib/healthLang.ts. Testele de comportament
// (HealthScoreTab.test HT-S1/HT-S2) rămân NESCHIMBATE — aici e doar limba.
// (Prefixul HQ: verificat cu grep în src/, tests/, e2e/, supabase/tests, docs
// și CLAUDE.md, nefolosit înainte; HQ6–HQ10 sunt pure, în
// src/lib/__tests__/healthLang.test.ts.)
//   HQ0  control POZITIV al verificării „fără text românesc”: scorul randat în
//        română, comparat cu dicționarul englez, ARE resturi.
//   HQ1  fără provider (azi, mereu româna): antetul „Customer Health Score” /
//        „Cum stă cafeneaua ta”, „Ultima recalculare: acum 5 minute”, delta
//        „(-15 față de scorul precedent)”, compoziția, sugestiile, nota de la
//        final — textele de dinainte.
//   HQ2  Planul 3 în engleză, fără resturi românești: „Critical — needs
//        attention”, „(-15 vs. the previous score)”, „Last recalculated: 5
//        minutes ago”, componenta „Fiscal Bridge errors”. Mutația care pică:
//        `getActionableSuggestions` (românesc) readus în HealthScoreTab.
//   HQ3  fără bon, în germană și franceză: scorul normalizat „Mittel”/„Moyen”,
//        fără componenta de bonuri și fără tendință (gate-ul `fiscal`
//        neschimbat), fără resturi.
//   HQ4  citirea eșuată: în română EXACT mesajul de dinainte (textul
//        românesc al erorii); în engleză rezerva tradusă, FĂRĂ textul
//        românesc, și „Try again”; pe ACEEAȘI rădăcină, trecut în franceză, se
//        retraduce. Mutația care pică: `setErr(toUserMessage(e, …))`.
//   HQ5  recalcularea refuzată pe cooldown (mig 178, hint `cooldown`): în
//        română EXACT textul serverului (hint-ul NU se aplică în română); în
//        engleză textul propriu, fără cel românesc, retradus în franceză; un
//        refuz fără hint în germană → rezerva „…neu berechnet…”. Mutația care
//        pică: `hints` aplicat și în română (ar schimba textul de azi).
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HealthScore } from '../../lib/health'

const h = vi.hoisted(() => ({ fetch: vi.fn(), recompute: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../contexts/RestaurantContext', () => ({
  useRestaurantCtx: () => ({ activeId: 'r1' }),
}))
vi.mock('../../lib/health', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../lib/health')),
  fetchHealthScore: h.fetch,
  recomputeHealthScore: h.recompute,
}))

import HealthScoreTab from '../HealthScoreTab'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { healthNs } from '../../i18n/ns/health'
import { commonNs } from '../../i18n/ns/common'
import hRo from '../../i18n/ns/health/ro'
import hEn from '../../i18n/ns/health/en'
import hFr from '../../i18n/ns/health/fr'
import hDe from '../../i18n/ns/health/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(healthNs, l), preloadNamespace(commonNs, l)]))
})

const DAY = 86_400_000
function row(): HealthScore {
  const now = Date.now()
  return {
    score: 35,
    previous_score: 50,
    trend: 'critical',
    score_login: 10,
    score_orders: 15,
    score_team: 5,
    score_tickets: 0,
    score_engagement: 5,
    // 5 minute și 10 secunde: departe de pragul de minut.
    computed_at: new Date(now - 5 * 60_000 - 10_000).toISOString(),
    details: {
      last_login: new Date(now - 10 * DAY - 3_600_000).toISOString(),
      orders_this_week: 3,
      orders_prev_week: 3,
      team_size: 2,
      open_alerts: 4,
    },
  }
}

beforeEach(() => {
  h.fetch.mockReset().mockImplementation(async () => row())
  h.recompute.mockReset()
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [hEn as Dict, commonEn as Dict],
  fr: [hFr as Dict, commonFr as Dict],
  de: [hDe as Dict, commonDe as Dict],
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
function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [hRo as Dict, commonRo as Dict]
  sources.forEach((src, i) => {
    const target = TARGETS[lang][i]!
    for (const [k, v] of Object.entries(src)) {
      const own = formsOf(target[k]).join('\n')
      for (const form of formsOf(v))
        for (const piece of form.split(/\{\w+\}/)) {
          const p = piece.trim()
          if (p.length >= 4 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
        }
    }
  })
  return out
}

describe('Scorul de sănătate în limba personalului', () => {
  it('HQ0: control pozitiv — scorul românesc are resturi față de engleză', async () => {
    const { container } = render(tree(null, <HealthScoreTab fiscal />))
    await screen.findByText('Cum stă cafeneaua ta')
    const left = romanianLeftovers(nodeText(container), 'en')
    expect(left.some((l) => l.startsWith('title:'))).toBe(true)
    expect(left.some((l) => l.startsWith('sc_tickets:'))).toBe(true)
  })

  it('HQ1: fără provider, româna de dinainte', async () => {
    const { container } = render(tree(null, <HealthScoreTab fiscal />))
    expect(await screen.findByText('Cum stă cafeneaua ta')).toBeInTheDocument()
    expect(screen.getByText('Customer Health Score')).toBeInTheDocument()
    expect(screen.getByText('Ultima recalculare: acum 5 minute')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '↻ Recalculează' })).toBeInTheDocument()
    expect(screen.getByText('(-15 față de scorul precedent)')).toBeInTheDocument()
    expect(container.textContent).toContain('⚠ Critic — necesită atenție')
    for (const s of ['Compoziție scor', 'Login frecvență', 'Volum comenzi', 'Echipă', 'Stabilitate', 'Engagement'])
      expect(screen.getAllByText(s).length, s).toBeGreaterThan(0)
    expect(screen.getByText('Ce poți face pentru a crește scorul')).toBeInTheDocument()
    expect(screen.getByText('Erori Bridge fiscal')).toBeInTheDocument()
    expect(
      screen.getByText(
        '4 bonuri în eroare în ultimele 7 zile. Verifică Setări → Casă & tichete — casa de marcat, hârtie, conexiune.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Ultimul login: acum 10 zile. Conectează-te cel puțin de 2-3 ori pe săptămână.'),
    ).toBeInTheDocument()
    expect(screen.getByText('2 membri. Invită încă 1 pentru scor maxim.')).toBeInTheDocument()
    expect(screen.getByText('Cum funcționează scorul')).toBeInTheDocument()
    expect(container.textContent).toContain(
      'Scor 0-100, recalculat la 30 de minute, din 5 componente: login (20), comenzi (30), echipă (15), stabilitatea casei de marcat (20) și folosirea funcțiilor (15).',
    )
  })

  it('HQ2: Planul 3 în engleză, fără resturi românești', async () => {
    const { container } = render(tree('en', <HealthScoreTab fiscal />))
    expect(await screen.findByText('How your café is doing')).toBeInTheDocument()
    expect(screen.getByText('Last recalculated: 5 minutes ago')).toBeInTheDocument()
    expect(screen.getByText('(-15 vs. the previous score)')).toBeInTheDocument()
    expect(container.textContent).toContain('⚠ Critical — needs attention')
    expect(screen.getByText('Fiscal Bridge errors')).toBeInTheDocument()
    expect(screen.getByText('Stability')).toBeInTheDocument()
    expect(screen.getByText('2 members. Invite 1 more for the maximum score.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '↻ Recalculate' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), 'en')).toEqual([])
  })

  it('HQ3: fără bon, în germană și franceză', async () => {
    const de = render(tree('de', <HealthScoreTab fiscal={false} />))
    expect(await screen.findByText('Mittel')).toBeInTheDocument()
    expect(screen.getByText('44')).toBeInTheDocument()
    expect(screen.queryByText('Stabilität')).toBeNull()
    expect(screen.queryByText('Fehler der Fiskal-Bridge')).toBeNull()
    expect(de.container.textContent).not.toMatch(/Kritisch|gegenüber dem vorherigen Score/)
    expect(screen.getByText('Zuletzt berechnet: vor 5 Minuten')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(de.container), 'de')).toEqual([])
    de.unmount()
    const fr = render(tree('fr', <HealthScoreTab fiscal={false} />))
    expect(await screen.findByText('Moyen')).toBeInTheDocument()
    expect(screen.getByText('Dernier recalcul : il y a 5 minutes')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(fr.container), 'fr')).toEqual([])
  })

  it('HQ4: citirea eșuată — româna de dinainte, rezerva tradusă, retradusă', async () => {
    const RO_ERR = 'Nu s-a putut încărca scorul: timeout'
    h.fetch.mockRejectedValue(new Error(RO_ERR))
    const ro = render(tree(null, <HealthScoreTab fiscal />))
    expect(await screen.findByText('Nu am putut încărca scorul')).toBeInTheDocument()
    expect(screen.getByText(RO_ERR)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument()
    ro.unmount()

    const r = render(tree('en', <HealthScoreTab fiscal />))
    expect(await screen.findByText('We couldn’t load the score')).toBeInTheDocument()
    expect(screen.getByText('Couldn’t load the score')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(r.container.textContent).not.toContain(RO_ERR)
    r.rerender(tree('fr', <HealthScoreTab fiscal />))
    expect(await screen.findByText('Impossible de charger le score')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(r.container), 'fr')).toEqual([])
  })

  it('HQ5: recalcularea refuzată pe cooldown', async () => {
    const SERVER_RO = 'Scor recalculat recent. Reîncearcă peste 3 minute.'
    const cooldown = () => Object.assign(new Error(SERVER_RO), { hint: 'cooldown' })
    h.fetch.mockResolvedValue(null)
    h.recompute.mockRejectedValue(cooldown())
    const user = userEvent.setup()
    const ro = render(tree(null, <HealthScoreTab fiscal />))
    await user.click(await screen.findByRole('button', { name: 'Calculează acum' }))
    expect(await screen.findByText(SERVER_RO)).toBeInTheDocument()
    expect(screen.getByText('Scorul nu a fost încă calculat')).toBeInTheDocument()
    ro.unmount()

    const r = render(tree('en', <HealthScoreTab fiscal />))
    await user.click(await screen.findByRole('button', { name: 'Calculate now' }))
    expect(await screen.findByText('The score was recalculated recently. Try again in a few minutes.')).toBeInTheDocument()
    expect(r.container.textContent).not.toContain(SERVER_RO)
    r.rerender(tree('fr', <HealthScoreTab fiscal />))
    expect(
      await screen.findByText('Le score a été recalculé récemment. Réessayez dans quelques minutes.'),
    ).toBeInTheDocument()
    r.unmount()

    h.recompute.mockRejectedValue(new Error('Recalculare eșuată: conexiune pierdută la bază'))
    const de = render(tree('de', <HealthScoreTab fiscal />))
    await user.click(await screen.findByRole('button', { name: 'Jetzt berechnen' }))
    expect(await screen.findByText('Der Score konnte nicht neu berechnet werden')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(de.container), 'de')).toEqual([])
  })
})

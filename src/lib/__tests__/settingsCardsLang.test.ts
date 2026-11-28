// Cardurile Setărilor, Echipa, Locațiile și Setările AI în limba personalului
// (lotul L6b) — partea PURĂ, rulabilă fără DOM. Ecranele randate sunt în
// src/components/__tests__/{SettingsCardsLang,TeamLang,LocationsLang,AiSettingsLang}.test.tsx.
// (Prefixele GQ / TE / LN / LQ: verificate cu grep în src/, tests/ și
// supabase/tests, nefolosite înainte.)
//   LN8  „Ultima comandă” (`formatLastOrderT`): în română EXACT
//        `formatLastOrder` (oracolul) pe azi / ieri / altă zi / fără comandă /
//        ISO invalid, inclusiv granița de fus (21:30Z = 00:30 a zilei
//        următoare în România); în en/fr/de fără litere românești, cu ora
//        HH:mm a României și data în formatul limbii. Mutația care pică:
//        `last_today` cu „azi ” (spațiu în plus) în ro, sau ziua calculată în
//        UTC.
//   LN8c lotul G2b: `formatLastOrderT` pe fusul dat (New York, acum 03:30Z pe
//        5 sept = 23:30 pe 4): „azi, 23:00”, „ieri, 23:30”, „01.09.2026, 12:05”;
//        control pe București „azi, 06:00”. Mutația care pică: oricare dintre
//        `isoToZonedYMD` / `formatTimeInZone` / `toZonedYMD` pe fusul implicit
//        în loc de `timeZone` (LC10 testează doar oracolul `formatLastOrder`).
//   LN8b dicționarul SERVIT căzut pe română (engleza n-a putut fi încărcată) cu
//        limba utilizatorului `en`: textul rămâne românesc („azi, …”,
//        controlul pozitiv că traducătorul e cel românesc), data e „31/10/2026”
//        (formatul limbii alese, ca `fmt`). Mutația care pică: `tr.lang` în loc
//        de `lang` în formatLastOrderT (ar ieși „31.10.2026”).
//   LN9  refuzul „Adaugă o locație” (`describeCreateLocationErrorT`): în
//        română EXACT `describeCreateLocationError` (limita de plan pe AMBELE
//        hint-uri, textul românesc al serverului, rețeaua, eroarea englezească
//        → rezerva); în en/fr/de limita are text propriu, iar textul românesc
//        al serverului NU ajunge pe ecran. Mutația care pică: `hints` scos
//        (limita cade pe rezervă) sau `toUserMessage` readus în altă limbă.
//   GQ10 refuzurile fără hint ale cardurilor de cont (lib/accountRefusals):
//        recunoscute după ÎNCEPUTUL textului serverului (mig 042 / 235), cu
//        control NEGATIV pe un alt mesaj românesc. Mutația care pică:
//        `includes` în loc de `startsWith` (un mesaj care doar CITEAZĂ fraza
//        ar fi luat drept refuzul).
//   GQ10b (lotul L8d, mig 330) HINT-ul e contractul și se verifică ÎNTÂI:
//        `active_subscription` / `mfa_aal2_required` recunoscute oricare ar fi
//        textul (o reformulare a mesajului nu mai rupe nimic), fiecare hint
//        DOAR pentru refuzul lui, un hint recunoscut BATE un text care începe
//        cu prefixul CELUILALT refuz (hint aal2 + „Aveți un abonament activ…”
//        = refuzul MFA, nu abonamentul — și invers), iar un hint necunoscut /
//        ne-șir cade pe potrivirea pe text (rezerva unei baze fără 330).
//        Mutațiile care pică: verificarea hint-ului scoasă (rămâne doar
//        textul); predicatele `hint === X || prefix(X)` independente (hint-ul
//        celuilalt refuz nu mai oprește prefixul).
//   TE8  contorul echipei: în română EXACT regula de dinainte (`membr` + „u”
//        doar la 1, altfel „i” — deci „0 membri”, „20 membri”, nu „20 de
//        membri”) pe n = 0…200; en/fr/de acordă la singular. Mutația care
//        pică: `other: '{n} de membri …'` în ro.
//   GQ11 precondiția L4b/L4c, ca clichet STRUCTURAL: fiecare componentă a
//        lotului cere namespace-urile SUS, înaintea primului `return`; fișierul
//        nu folosește alt namespace decât al lui + `common`; filele leneșe
//        rămân `lazy` în DashboardPage; lib/locations (în graful static al
//        panoului) importă din i18n/ns doar TIPURI. Mutația care pică:
//        `useT(teamNs)` mutat sub `if (error) return` în TeamManager.
//   GQ12 datele NU trec prin traducător: recompensa implicită a fidelizării
//        (o vede OASPETELE în meniu) vine din limba de BAZĂ a meniului, nu din
//        dicționarul personalului (`loyaltyDefaultReward(baseLang)`, TW14 — din
//        lotul C7c în `useLoyaltyProgramForm`, fără niciun traducător), cu
//        româna „Un desert din partea casei”,
//        valorile rolurilor din <select> rămân `manager`/`waiter`/`kitchen`,
//        numele planului e `PLAN_LABELS.growth`. Mutația care pică:
//        `useState(tr.t('loy_rewardPlaceholder'))` sau `value={tm.t(…)}`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { makeTranslator } from '../../i18n/core'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import locRo from '../../i18n/ns/locations/ro'
import locEn from '../../i18n/ns/locations/en'
import locFr from '../../i18n/ns/locations/fr'
import locDe from '../../i18n/ns/locations/de'
import cardsRo from '../../i18n/ns/settingsCards/ro'
import cardsEn from '../../i18n/ns/settingsCards/en'
import cardsFr from '../../i18n/ns/settingsCards/fr'
import cardsDe from '../../i18n/ns/settingsCards/de'
import teamRo from '../../i18n/ns/team/ro'
import teamEn from '../../i18n/ns/team/en'
import teamFr from '../../i18n/ns/team/fr'
import teamDe from '../../i18n/ns/team/de'
import {
  MSG_LOCATION_LIMIT,
  describeCreateLocationError,
  describeCreateLocationErrorT,
  formatLastOrder,
  formatLastOrderT,
} from '../locations'
import { isActiveSubscriptionRefusal, isMfaAal2Refusal } from '../accountRefusals'

const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
const RO_LETTERS = /[ăĂâÂîÎșȘțȚşŞţŢ]/
const NOW = new Date('2026-11-15T10:00:00Z')
const LAST_ORDERS: ReadonlyArray<string | null> = [
  null,
  'nu-e-o-dată',
  '2026-11-15T08:32:00Z', // azi, 10:32
  '2026-11-14T21:30:00Z', // 23:30 ieri
  '2026-11-13T22:30:00Z', // 00:30 pe 14 — ieri în România, alaltăieri în UTC
  '2026-10-31T10:05:00Z', // altă zi
]
const OTHER = [
  ['en', locEn, cardsEn, commonEn],
  ['fr', locFr, cardsFr, commonFr],
  ['de', locDe, cardsDe, commonDe],
] as const

describe('„Ultima comandă” și refuzul locației noi', () => {
  it('LN8: formatLastOrderT — româna = oracolul; en/fr/de fără resturi', () => {
    const ro = makeTranslator(locRo, 'ro')
    for (const iso of LAST_ORDERS)
      expect(formatLastOrderT(ro, 'ro', iso, NOW), String(iso)).toBe(formatLastOrder(iso, NOW))
    // Granița de fus: 22:30Z pe 13 = 00:30 pe 14 în România = „ieri”.
    expect(formatLastOrderT(ro, 'ro', '2026-11-13T22:30:00Z', NOW)).toBe('ieri, 00:30')
    expect(formatLastOrderT(ro, 'ro', '2026-10-31T10:05:00Z', NOW)).toBe('31.10.2026, 12:05')
    const expected = {
      en: ['No orders yet', 'today, 10:32', 'yesterday, 23:30', '31/10/2026, 12:05'],
      fr: [
        'Aucune commande pour l’instant',
        'aujourd’hui, 10:32',
        'hier, 23:30',
        '31/10/2026, 12:05',
      ],
      de: ['Noch keine Bestellung', 'heute, 10:32', 'gestern, 23:30', '31.10.2026, 12:05'],
    } as const
    for (const [lang, loc] of OTHER) {
      const tr = makeTranslator(loc, lang)
      const got = [
        formatLastOrderT(tr, lang, null, NOW),
        formatLastOrderT(tr, lang, '2026-11-15T08:32:00Z', NOW),
        formatLastOrderT(tr, lang, '2026-11-14T21:30:00Z', NOW),
        formatLastOrderT(tr, lang, '2026-10-31T10:05:00Z', NOW),
      ]
      expect(got, lang).toEqual(expected[lang])
      for (const iso of LAST_ORDERS) {
        const text = formatLastOrderT(tr, lang, iso, NOW)
        expect(text, `${lang} ${String(iso)}`).not.toMatch(RO_LETTERS)
        expect(text).not.toMatch(/\{\w+\}/)
      }
    }
  })

  it('LN8c: formatLastOrderT pe fusul dat (lotul G2b)', () => {
    // 03:30Z pe 5 sept = 23:30 pe 4 sept la New York.
    const now = new Date('2026-09-05T03:30:00Z')
    const ny = 'America/New_York'
    const ro = makeTranslator(locRo, 'ro')
    expect(formatLastOrderT(ro, 'ro', '2026-09-05T03:00:00Z', now, ny)).toBe('azi, 23:00')
    expect(formatLastOrderT(ro, 'ro', '2026-09-04T03:30:00Z', now, ny)).toBe('ieri, 23:30')
    expect(formatLastOrderT(ro, 'ro', '2026-09-01T16:05:00Z', now, ny)).toBe('01.09.2026, 12:05')
    // Control: fără fus (București) același moment e „azi, 06:00”.
    expect(formatLastOrderT(ro, 'ro', '2026-09-05T03:00:00Z', now)).toBe('azi, 06:00')
    const en = makeTranslator(locEn, 'en')
    expect(formatLastOrderT(en, 'en', '2026-09-04T03:30:00Z', now, ny)).toBe('yesterday, 23:30')
  })

  it('LN8b: dicționar căzut pe română + limba aleasă en → text românesc, dată en-GB', () => {
    const ro = makeTranslator(locRo, 'ro')
    expect(formatLastOrderT(ro, 'en', '2026-11-15T08:32:00Z', NOW)).toBe('azi, 10:32')
    expect(formatLastOrderT(ro, 'en', '2026-10-31T10:05:00Z', NOW)).toBe('31/10/2026, 12:05')
    expect(formatLastOrderT(ro, 'de', '2026-10-31T10:05:00Z', NOW)).toBe('31.10.2026, 12:05')
  })

  it('LN9: describeCreateLocationErrorT — româna = oracolul; altă limbă fără serverul românesc', () => {
    const SERVER_RO = 'Numele restaurantului este prea lung pentru acest câmp.'
    const errors: unknown[] = [
      {
        hint: 'upgrade_plan',
        message: 'Limita de restaurante a planului free a fost atinsă',
        code: 'P0001',
      },
      { hint: 'plan_upgrade_required', message: 'cere un plan superior', code: 'P0001' },
      { message: SERVER_RO, code: 'P0001' },
      new TypeError('Failed to fetch'),
      { message: 'duplicate key value violates unique constraint', code: '23505' },
      { message: 'something exploded', code: 'XX000' },
      null,
    ]
    const roCards = makeTranslator(cardsRo, 'ro')
    const roCommon = makeTranslator(commonRo, 'ro')
    for (const e of errors)
      expect(describeCreateLocationErrorT(e, roCards, roCommon)).toBe(
        describeCreateLocationError(e),
      )
    expect(describeCreateLocationErrorT(errors[0], roCards, roCommon)).toBe(MSG_LOCATION_LIMIT)
    for (const [lang, , cards, common] of OTHER) {
      const tr = makeTranslator(cards, lang)
      const tc = makeTranslator(common, lang)
      expect(describeCreateLocationErrorT(errors[0], tr, tc), lang).toBe(cards.loc_err_limit)
      expect(describeCreateLocationErrorT(errors[1], tr, tc), lang).toBe(cards.loc_err_limit)
      expect(describeCreateLocationErrorT(errors[2], tr, tc), lang).toBe(cards.loc_err_create)
      expect(describeCreateLocationErrorT(errors[3], tr, tc), lang).toBe(common.err_network)
      expect(describeCreateLocationErrorT(errors[4], tr, tc), lang).toBe(common.err_duplicate)
      for (const e of errors)
        expect(describeCreateLocationErrorT(e, tr, tc), lang).not.toMatch(RO_LETTERS)
    }
  })
})

describe('refuzurile fără hint ale cardurilor de cont', () => {
  it('GQ10: recunoscute după începutul textului serverului', () => {
    const SUB = 'Aveți un abonament activ. Anulați-l prin Portal Stripe înainte de a șterge contul.'
    const AAL2 = 'Dezactivarea MFA cere o sesiune verificată cu MFA (aal2)'
    expect(isActiveSubscriptionRefusal(new Error(SUB))).toBe(true)
    expect(isActiveSubscriptionRefusal({ message: `  ${SUB}` })).toBe(true)
    expect(isActiveSubscriptionRefusal(SUB)).toBe(true)
    expect(isMfaAal2Refusal(new Error(AAL2))).toBe(true)
    // Control NEGATIV: alt mesaj românesc, citarea frazei, forme goale.
    for (const e of [
      new Error('Autentificare necesară'),
      new Error(`Eroare: ${SUB}`),
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isActiveSubscriptionRefusal(e)).toBe(false)
      expect(isMfaAal2Refusal(e)).toBe(false)
    }
    expect(isMfaAal2Refusal(new Error(SUB))).toBe(false)
    expect(isActiveSubscriptionRefusal(new Error(AAL2))).toBe(false)
  })

  it('GQ10b: hint-ul din mig 330 câștigă; textul rămâne rezerva', () => {
    const reworded = (hint: unknown) => Object.assign(new Error('Mesaj reformulat de server.'), { hint })
    expect(isActiveSubscriptionRefusal(reworded('active_subscription'))).toBe(true)
    expect(isMfaAal2Refusal(reworded('mfa_aal2_required'))).toBe(true)
    // Fiecare hint doar pentru refuzul lui.
    expect(isMfaAal2Refusal(reworded('active_subscription'))).toBe(false)
    expect(isActiveSubscriptionRefusal(reworded('mfa_aal2_required'))).toBe(false)
    // Hint necunoscut / ne-șir: decide textul (ca pe o bază fără 330).
    for (const hint of ['auth_required', '', null, 42]) {
      expect(isActiveSubscriptionRefusal(reworded(hint))).toBe(false)
      expect(isMfaAal2Refusal(reworded(hint))).toBe(false)
    }
    // Hint recunoscut + text cu prefixul CELUILALT refuz: câștigă hint-ul.
    const SUB = 'Aveți un abonament activ. Anulați-l prin Portal Stripe înainte de a șterge contul.'
    const AAL2 = 'Dezactivarea MFA cere o sesiune verificată cu MFA (aal2)'
    const conflict = (hint: string, message: string) => Object.assign(new Error(message), { hint })
    expect(isMfaAal2Refusal(conflict('mfa_aal2_required', SUB))).toBe(true)
    expect(isActiveSubscriptionRefusal(conflict('mfa_aal2_required', SUB))).toBe(false)
    expect(isActiveSubscriptionRefusal(conflict('active_subscription', AAL2))).toBe(true)
    expect(isMfaAal2Refusal(conflict('active_subscription', AAL2))).toBe(false)
    // Control: același text cu un hint NErecunoscut decide prin prefix (rezerva).
    expect(isActiveSubscriptionRefusal(conflict('auth_required', SUB))).toBe(true)
    expect(isMfaAal2Refusal(conflict('auth_required', AAL2))).toBe(true)
  })
})

describe('contorul echipei', () => {
  it('TE8: româna = regula de dinainte pe n = 0…200; en/fr/de acordă', () => {
    const ro = makeTranslator(teamRo, 'ro')
    for (let n = 0; n <= 200; n++)
      expect(ro.tp('members_count', n)).toBe(
        `${n} membr${n === 1 ? 'u' : 'i'} · Invitații expiră în 7 zile`,
      )
    expect(makeTranslator(teamEn, 'en').tp('members_count', 1)).toBe(
      '1 member · Invitations expire in 7 days',
    )
    expect(makeTranslator(teamEn, 'en').tp('members_count', 3)).toBe(
      '3 members · Invitations expire in 7 days',
    )
    expect(makeTranslator(teamFr, 'fr').tp('members_count', 1)).toBe(
      '1 membre · Les invitations expirent sous 7 jours',
    )
    expect(makeTranslator(teamFr, 'fr').tp('members_count', 3)).toBe(
      '3 membres · Les invitations expirent sous 7 jours',
    )
    expect(makeTranslator(teamDe, 'de').tp('members_count', 1)).toBe(
      '1 Mitglied · Einladungen laufen nach 7 Tagen ab',
    )
    expect(makeTranslator(teamDe, 'de').tp('members_count', 3)).toBe(
      '3 Mitglieder · Einladungen laufen nach 7 Tagen ab',
    )
  })
})

describe('precondiția L4b/L4c (lotul L6b)', () => {
  const nsUsed = (src: string) => new Set([...src.matchAll(/useT\((\w+Ns)\)/g)].map((m) => m[1]))
  const FILES = [
    {
      file: 'src/components/LoyaltySettingsCard.tsx',
      start: 'export default function LoyaltySettingsCard(',
      own: 'settingsCards',
    },
    {
      file: 'src/components/MfaCard.tsx',
      start: 'export default function MfaCard(',
      own: 'settingsCards',
    },
    {
      file: 'src/components/GdprCard.tsx',
      start: 'export default function GdprCard(',
      own: 'settingsCards',
    },
    {
      file: 'src/components/AddLocationCard.tsx',
      start: 'export default function AddLocationCard(',
      own: 'settingsCards',
    },
    {
      file: 'src/components/SmsNotificationsCard.tsx',
      start: 'export default function SmsNotificationsCard(',
      own: 'settingsCards',
    },
    {
      file: 'src/components/TeamManager.tsx',
      start: 'export default function TeamManager(',
      own: 'team',
    },
    {
      file: 'src/components/LocationsTab.tsx',
      start: 'export default function LocationsTab(',
      own: 'locations',
    },
    {
      file: 'src/components/AiSettingsTab.tsx',
      start: 'export default function AiSettingsTab(',
      own: 'aiSettings',
    },
  ] as const

  it('GQ11: fiecare componentă cere namespace-urile înaintea primului return', () => {
    for (const { file, start, own } of FILES) {
      const src = read(file)
      const s = src.indexOf(start)
      expect(s, file).toBeGreaterThan(0)
      const m = /^[ \t]*(?:if \([^\n]*\)\s*)?return\b/m.exec(src.slice(s))
      expect(m, file).not.toBeNull()
      const top = nsUsed(src.slice(s, s + (m?.index ?? 0)))
      // Control pozitiv: scanerul vede cererile de sus.
      expect([...top].sort(), file).toEqual([`${own}Ns`, 'commonNs'].sort())
      expect([...nsUsed(src)].sort(), file).toEqual([`${own}Ns`, 'commonNs'].sort())
      const imported = [...src.matchAll(/from '\.\.\/i18n\/ns\/(\w+)(?:\/\w+)?'/g)].map((x) => x[1])
      expect([...new Set(imported)].sort(), file).toEqual(['common', own].sort())
    }
    const dash = read('src/pages/DashboardPage.tsx')
    for (const c of ['TeamManager', 'LocationsTab', 'AiSettingsTab', 'SettingsTab'])
      expect(dash, c).toContain(`lazy(() => import('../components/${c}'))`)
    // lib/locations e în graful STATIC al panoului: din i18n/ns doar tipuri.
    const lib = read('src/lib/locations.ts')
    expect(lib).toContain("import type locationsRo from '../i18n/ns/locations/ro'")
    expect(lib).not.toMatch(/^import (?!type)[^\n]*i18n\/ns\//m)
  })

  it('GQ12: datele nu trec prin traducător', () => {
    const loy = read('src/components/LoyaltySettingsCard.tsx')
    const form = read('src/hooks/useLoyaltyProgramForm.ts')
    expect(form).toContain('reward: loyaltyDefaultReward(baseLang),')
    expect(form).not.toMatch(/\buseT\(|\btr\.t\(|i18n\/ns\//)
    expect(loy).not.toMatch(/useState\(tr\.t\(/)
    expect(read('src/lib/settingsLang.ts')).toContain("export const LOYALTY_DEFAULT_REWARD = 'Un desert din partea casei'")
    expect(loy).toContain('{PLAN_LABELS.growth}')
    const team = read('src/components/TeamManager.tsx')
    for (const v of ['manager', 'waiter', 'kitchen'])
      expect(team).toContain(`<option value="${v}">`)
    expect(team).not.toMatch(/value=\{tm\.t\(/)
    // Placeholderul recompensei se traduce, valoarea implicită nu.
    expect(cardsEn.loy_rewardPlaceholder).not.toBe(cardsRo.loy_rewardPlaceholder)
  })
})

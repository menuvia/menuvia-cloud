// Zilele săptămânii din fila Promoții (Happy Hour) în limba personalului
// (lotul L5b) — partea PURĂ (`lib/happyHourDays.ts`). Randarea e în
// src/components/__tests__/HappyHourLang.test.tsx (HP0–HP6).
//   HP7  în română EXACT `DAY_LABELS` de dinainte — ['Du','Lu','Ma','Mi','Jo',
//        'Vi','Sâ'], byte cu byte —, iar `dayLabel(d)` = `DAY_LABELS[d - 1]`
//        pentru 1..7 (1 = duminică, ca `days_of_week`) și „?” în afara
//        intervalului, ca înainte. Mutația care pică: `day_7: 'Sa'` în ro.ts
//        sau `DAY_KEYS` rotit cu o poziție.
//   HP8  în fiecare limbă indexul 0 e DUMINICA și ordinea e a zilelor
//        (duminică → sâmbătă): fiecare etichetă e începutul numelui LUNG al
//        zilei după `Intl` (numele lungi sunt stabile între ICU-uri; doar
//        verificarea le folosește, afișarea rămâne pe dicționar). Mutația care
//        pică: zilele en/fr/de începute cu luni („Mo” pe `day_1`).
import { describe, it, expect, vi } from 'vitest'

// lib/happyHour importă clientul supabase (CRUD-ul regulilor); aici e nevoie
// doar de constanta `DAY_LABELS`, oracolul românesc.
vi.mock('../supabase', () => ({ supabase: {} }))

import { DAY_LABELS } from '../happyHour'
import { DAY_KEYS, dayLabel, dayLabels } from '../happyHourDays'
import { makeTranslator } from '../../i18n/core'
import promotionsRo from '../../i18n/ns/promotions/ro'
import promotionsEn from '../../i18n/ns/promotions/en'
import promotionsFr from '../../i18n/ns/promotions/fr'
import promotionsDe from '../../i18n/ns/promotions/de'

const ro = makeTranslator(promotionsRo, 'ro')
const LANGS = [
  { lang: 'en' as const, tr: makeTranslator(promotionsEn, 'en'), sunday: 'Su' },
  { lang: 'fr' as const, tr: makeTranslator(promotionsFr, 'fr'), sunday: 'Di' },
  { lang: 'de' as const, tr: makeTranslator(promotionsDe, 'de'), sunday: 'So' },
]

describe('zilele Happy Hour', () => {
  it('HP7 româna e exact cea de dinainte, cu 1 = duminică', () => {
    expect(dayLabels(ro)).toEqual(['Du', 'Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ'])
    expect(dayLabels(ro)).toEqual([...DAY_LABELS])
    for (let d = 1; d <= 7; d++) expect(dayLabel(d, ro)).toBe(DAY_LABELS[d - 1])
    for (const d of [0, 8, -1, 1.5]) expect(dayLabel(d, ro)).toBe('?')
    expect(DAY_KEYS).toHaveLength(7)
  })

  it('HP8 în fiecare limbă indexul 0 e duminica, în ordinea zilelor', () => {
    // 15 noiembrie 2026 e duminică; +i zile = ziua i a săptămânii.
    const longNames = (lang: string): string[] =>
      Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 15 + i))),
      )
    expect(longNames('en')[0]).toBe('Sunday')
    for (const { lang, tr, sunday } of [{ lang: 'ro' as const, tr: ro, sunday: 'Du' }, ...LANGS]) {
      const labels = dayLabels(tr)
      expect(labels[0]).toBe(sunday)
      expect(dayLabel(1, tr)).toBe(sunday)
      expect(new Set(labels).size).toBe(7)
      const names = longNames(lang)
      labels.forEach((l, i) =>
        expect(names[i]!.toLocaleLowerCase(lang).startsWith(l.toLocaleLowerCase(lang)), `${lang} ${i}: ${l} / ${names[i]}`).toBe(true),
      )
    }
  })
})

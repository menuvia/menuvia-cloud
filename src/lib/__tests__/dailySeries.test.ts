// Seria graficelor zilnice (lotul C6a): Vânzări și Statistici au FIECARE zi a
// intervalului, în ordine, cu 0 pe zilele fără vânzări. (Prefixul XD: verificat
// cu grep în src/, tests/, e2e/, supabase/, docs și CLAUDE.md, nefolosit
// înainte.) Datele sunt FIXE (șiruri YYYY-MM-DD și instante ISO), niciodată ceasul
// mașinii.
//   XD1  zilele-gol și ziua doar-cu-încasări: comenzi create pe 12, 13 și 15,
//        una creată pe 12 și PLĂTITĂ pe 14 (ziua 14 are doar venit), nimic pe
//        11 și 16 → șase puncte 11…16, în ordine, cu 0 unde nu s-a vândut
//        nimic. Mutația care pică: seria din cheile Map-ului (codul vechi: doar
//        zilele cu date, ziua doar-cu-încasări la COADĂ, după celelalte).
//   XD2  control: o singură zi = un punct (fila ascunde graficul, ca înainte);
//        zilele din afara intervalului nu apar.
//   XD3  peste 62 de zile → săptămâni calendaristice (luni–duminică), cu
//        totalurile CONSERVATE (suma săptămânilor = suma zilelor); 62 de zile
//        rămân pe zile. Mutația care pică: pragul pe `>=` sau găleți de 7 zile
//        de la prima zi (o săptămână ar începe miercuri).
//   XD4  numărarea pe ȘIR: ziua de 25 h (25 oct 2026) și 28 → 1 martie nu
//        dublează și nu sar nicio zi.
//   XD5  intrări invalide (30 februarie, `from` > `to`, gunoi) → nicio zi, nu o
//        buclă fără sfârșit.
//   XD6  `reportDayTotals`: ziua în fusul DAT (23:30Z pe 14 nov = 15 la
//        București, 14 la New York), `paid_amount` altfel `total`, timestamp
//        neparsabil sărit (înainte o bară cu cheie-gunoi).
//   XD7  `isValidYmd` / `weekStartYmd` (lib/dates): datele reale, lunea
//        săptămânii pe șir (duminica 15 nov → luni 9 nov).
//   XD8  eticheta: ziua în formatul limbii; anul doar când seria pe săptămâni
//        trece peste un an calendaristic.
//   XD9  `viewDayTotals` (Statistici): rândurile `v_daily_orders` pe zile, un
//        rând fără dată validă sărit, două rânduri ale aceleiași zile adunate.
import { describe, it, expect } from 'vitest'
import {
  WEEKLY_AFTER_DAYS,
  chartSeries,
  daysInRange,
  reportDayTotals,
  seriesPointLabel,
  seriesSpansYears,
  viewDayTotals,
  type DayTotals,
} from '../dailySeries'
import { isValidYmd, weekStartYmd } from '../dates'

const totals = (entries: Array<[string, number, number]>): Map<string, DayTotals> =>
  new Map(entries.map(([d, orders, revenue]) => [d, { orders, revenue }]))

describe('seria zilnică a graficelor (C6a)', () => {
  it('XD1: ziua fără vânzări și ziua doar cu încasări, în ordine', () => {
    const t = reportDayTotals(
      [
        { created_at: '2026-11-13T09:00:00Z' },
        { created_at: '2026-11-13T15:00:00Z' },
        { created_at: '2026-11-15T10:00:00Z' },
        { created_at: '2026-11-12T19:00:00Z' }, // creată pe 12…
      ],
      [
        { paid_at: '2026-11-13T15:30:00Z', paid_amount: 40, total: 40 },
        { paid_at: '2026-11-15T10:30:00Z', paid_amount: 25, total: 25 },
        { paid_at: '2026-11-14T08:00:00Z', paid_amount: 30, total: 30 }, // …plătită pe 14
      ],
      'Europe/Bucharest',
    )
    // Ordinea de inserție a Map-ului e cea a codului vechi: 14 vine ULTIMA.
    expect([...t.keys()]).toEqual(['2026-11-13', '2026-11-15', '2026-11-12', '2026-11-14'])
    const s = chartSeries('2026-11-11', '2026-11-16', t)
    expect(s.granularity).toBe('day')
    expect(s.points.map((p) => [p.from, p.orders, p.revenue])).toEqual([
      ['2026-11-11', 0, 0],
      ['2026-11-12', 1, 0],
      ['2026-11-13', 2, 40],
      ['2026-11-14', 0, 30],
      ['2026-11-15', 1, 25],
      ['2026-11-16', 0, 0],
    ])
    for (const p of s.points) expect(p.to).toBe(p.from)
  })

  it('XD2: o singură zi = un punct; zilele din afara intervalului nu apar', () => {
    const t = totals([
      ['2026-11-14', 3, 90],
      ['2026-11-15', 1, 10],
      ['2026-11-16', 9, 999],
    ])
    const one = chartSeries('2026-11-15', '2026-11-15', t)
    expect(one.points).toEqual([{ from: '2026-11-15', to: '2026-11-15', orders: 1, revenue: 10 }])
    const two = chartSeries('2026-11-14', '2026-11-15', t)
    expect(two.points.map((p) => p.revenue)).toEqual([90, 10])
  })

  it('XD3: peste 62 de zile pe săptămâni luni–duminică, cu totalurile conservate', () => {
    expect(WEEKLY_AFTER_DAYS).toBe(62)
    // 2 martie 2026 e luni; 3 mai 2026 e duminică → exact 63 de zile = 9 săptămâni.
    expect(daysInRange('2026-03-02', '2026-05-03')).toHaveLength(63)
    const t = new Map<string, DayTotals>()
    for (const [i, d] of daysInRange('2026-03-02', '2026-05-03').entries()) t.set(d, { orders: 1, revenue: i })
    const weekly = chartSeries('2026-03-02', '2026-05-03', t)
    expect(weekly.granularity).toBe('week')
    expect(weekly.points).toHaveLength(9)
    expect(weekly.points[0]).toMatchObject({ from: '2026-03-02', to: '2026-03-08', orders: 7 })
    expect(weekly.points[8]).toMatchObject({ from: '2026-04-27', to: '2026-05-03', orders: 7 })
    const sum = (ps: ReadonlyArray<DayTotals>) => ps.reduce((a, p) => a + p.revenue, 0)
    expect(sum(weekly.points)).toBe(sum([...t.values()]))
    // Început de miercuri: prima săptămână e PARȚIALĂ (miercuri–duminică).
    const midweek = chartSeries('2026-03-04', '2026-05-07', t)
    expect(midweek.granularity).toBe('week')
    expect(midweek.points[0]).toMatchObject({ from: '2026-03-04', to: '2026-03-08', orders: 5 })
    expect(midweek.points[1]!.from).toBe('2026-03-09')
    // 62 de zile rămân pe zile.
    const daily = chartSeries('2026-03-02', '2026-05-02', t)
    expect(daily.granularity).toBe('day')
    expect(daily.points).toHaveLength(62)
  })

  it('XD4: zilele se numără pe șir (ziua de 25 h, sfârșit de februarie)', () => {
    expect(daysInRange('2026-10-24', '2026-10-26')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26'])
    expect(daysInRange('2026-03-28', '2026-03-30')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30'])
    expect(daysInRange('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
    expect(daysInRange('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
    expect(daysInRange('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01'])
  })

  it('XD5: intrările invalide nu dau nicio zi', () => {
    expect(daysInRange('2026-02-30', '2026-03-02')).toEqual([])
    expect(daysInRange('2026-11-16', '2026-11-15')).toEqual([])
    expect(daysInRange('', '2026-11-15')).toEqual([])
    expect(daysInRange('ieri', 'azi')).toEqual([])
    expect(chartSeries('2026-11-15', 'x', new Map()).points).toEqual([])
    // Control: un interval valid de o zi chiar dă o zi.
    expect(daysInRange('2026-11-15', '2026-11-15')).toEqual(['2026-11-15'])
  })

  it('XD6: totalurile pe zi în fusul dat; venitul din paid_amount, altfel total', () => {
    const late = '2026-11-14T23:30:00Z' // 01:30 pe 15 la București, 18:30 pe 14 la New York
    const ro = reportDayTotals([{ created_at: late }], [{ paid_at: late, paid_amount: null, total: 12 }], 'Europe/Bucharest')
    expect([...ro.entries()]).toEqual([['2026-11-15', { orders: 1, revenue: 12 }]])
    const ny = reportDayTotals([{ created_at: late }], [{ paid_at: late, paid_amount: 7, total: 12 }], 'America/New_York')
    expect([...ny.entries()]).toEqual([['2026-11-14', { orders: 1, revenue: 7 }]])
    const junk = reportDayTotals([{ created_at: 'nu e o dată' }, { created_at: null }], [{ paid_at: undefined }], 'Europe/Bucharest')
    expect(junk.size).toBe(0)
  })

  it('XD7: isValidYmd și weekStartYmd', () => {
    for (const ok of ['2026-11-15', '2028-02-29', '2026-12-31']) expect(isValidYmd(ok), ok).toBe(true)
    for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-11-5', '15.11.2026', '', null, 20261115, undefined])
      expect(isValidYmd(bad), String(bad)).toBe(false)
    expect(weekStartYmd('2026-11-15')).toBe('2026-11-09') // duminică → lunea de dinainte
    expect(weekStartYmd('2026-11-09')).toBe('2026-11-09') // lunea rămâne
    expect(weekStartYmd('2026-11-11')).toBe('2026-11-09')
    expect(weekStartYmd('2027-01-03')).toBe('2026-12-28') // peste an
    expect(weekStartYmd('gunoi')).toBe('gunoi')
  })

  it('XD8: eticheta în formatul limbii, cu anul doar peste un an calendaristic', () => {
    const p = { from: '2026-11-15', to: '2026-11-15', orders: 0, revenue: 0 }
    expect(seriesPointLabel(p, 'ro-RO')).toBe('15.11')
    expect(seriesPointLabel(p, 'en-GB')).toBe('15/11')
    expect(seriesPointLabel(p, 'de-DE')).toBe('15.11.')
    expect(seriesPointLabel({ ...p, from: '2026-12-28' }, 'ro-RO', true)).toBe('28.12.26')
    const t = new Map<string, DayTotals>()
    const crossing = chartSeries('2026-11-02', '2027-02-14', t)
    expect(crossing.granularity).toBe('week')
    expect(seriesSpansYears(crossing)).toBe(true)
    expect(seriesSpansYears(chartSeries('2026-03-02', '2026-05-03', t))).toBe(false)
    expect(seriesSpansYears(chartSeries('x', 'y', t))).toBe(false)
  })

  it('XD9: viewDayTotals pe rândurile v_daily_orders', () => {
    const t = viewDayTotals(
      [
        { day: '2026-11-03', total_orders: 4, revenue: 200 },
        { day: '2026-11-03', total_orders: 1, revenue: '10.5' },
        { day: null, total_orders: 9, revenue: 900 },
        { day: '2026-11-05', total_orders: null, revenue: null },
      ],
      'total_orders',
      'revenue',
    )
    expect([...t.entries()]).toEqual([
      ['2026-11-03', { orders: 5, revenue: 210.5 }],
      ['2026-11-05', { orders: 0, revenue: 0 }],
    ])
    const s = chartSeries('2026-11-02', '2026-11-05', t)
    expect(s.points.map((p) => p.orders)).toEqual([0, 5, 0, 0])
  })
})

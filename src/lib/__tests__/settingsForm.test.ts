// Regulile pure ale formularului de Setări (lotul C7c, lib/settingsForm.ts).
// (Prefixul SY: verificat cu grep în src/, tests/, e2e/, supabase/, docs și
// CLAUDE.md, nefolosit înainte.)
//   SY1  orele de ridicare: validarea acceptă ce CITEȘTE `buildPickupSlots`
//        (recenzia lotului C7c — varianta strictă HH:MM respingea „9:00" și
//        „24:00", valori salvate din câmpul vechi cu care oaspeții comandă).
//        Respinse: formele care dau ZERO sloturi („9", „9.00", „9 AM", gol,
//        ne-text) și cele fără sens („24:30", „25:00", „09:60", „9:"). Testul
//        compară cu `buildPickupSlots` însuși, pe o oră fixă: orice oră
//        acceptată produce sloturi și ca deschidere, și ca închidere. Mutațiile
//        care pică: regexul strict de dinainte (`9:00`/`24:00` respinse) sau
//        unul slăbit la `/\d+:\d+/` / scos („9" ar trece cu zero sloturi).
//   SY6  valoarea pentru `<input type="time">` (care golește orice nu e
//        „HH:MM"): „9:00" → „09:00", „9:5" → „09:05", „24:00" → „00:00",
//        secundele cad; ilizibil → „" (câmp gol cu eroare). Mutația care pică:
//        valoarea brută dată câmpului (o oră bună ar apărea goală).
//   SY2  minutele: doar un întreg ÎN plajă intră în formular; gol, fracție,
//        sub/peste plajă = `null` (câmpul păstrează textul, nu sare înapoi).
//        Mutația care pică: `parseInt` lejer („20.5" → 20, „45abc" → 45).
//   SY3  la ieșire: un întreg în afara plajei se aduce la capăt (300 → 240,
//        4 → 5); gol / ne-numeric rămâne `null` (eroare, nu o valoare ghicită).
//        Mutația care pică: `clampMinutes('')` → min (golul ar deveni 5).
//   SY4  „Salvează" de sus doar pe secțiunile cu formular: Restaurant și
//        Aspect meniu da (orice plan), Abonament & cont nu, iar „Comenzi" doar
//        cu ridicare sau comenzi — Planul 1, free și planul NECUNOSCUT nu.
//        Mutația care pică: regula veche `section !== 'account'`.
//   SY5  confirmarea slug-ului doar când moare o adresă VECHE: schimbare reală
//        da; același slug, slug nou gol sau niciun slug salvat nu.
import { describe, it, expect } from 'vitest'
import {
  PICKUP_LEAD_RANGE,
  PICKUP_SLOT_RANGE,
  clampMinutes,
  isPickupTime,
  parseMinutes,
  pickupTimeInputValue,
  sectionHasFormFields,
  slugChangeNeedsConfirm,
} from '../settingsForm'
import { buildPickupSlots } from '../pickupSlots'
import { surfaceFor } from './planSurfaceFixtures'

describe('settingsForm — ridicarea', () => {
  it('SY1: ora de ridicare e acceptată exact când produce sloturi', () => {
    // 08:00 la București; 08:00–21:00 cu 20 min pregătire are sloturi.
    const now = new Date('2026-11-28T06:00:00Z')
    const slots = (start: string, end: string) =>
      buildPickupSlots(
        {
          min_lead_time_minutes: 20,
          slot_interval_minutes: 15,
          open_hours: { start, end },
        },
        now,
        'Europe/Bucharest',
      ).length
    const OK = ['09:00', '9:00', '9:5', '23:59', '00:00', '24:00', '21:00:00', '12:30', ' 09:00']
    for (const ok of OK) {
      expect(isPickupTime(ok), ok).toBe(true)
      // Paritate cu oaspeții: ce acceptă validarea, `buildPickupSlots` citește.
      expect(slots(ok, '23:00'), `${ok} ca deschidere`).toBeGreaterThan(0)
      expect(slots('08:00', ok), `${ok} ca închidere`).toBeGreaterThan(0)
    }
    // Zero sloturi pentru oaspeți — respinse (blochează „Salvează").
    for (const bad of ['9', '9.00', '9 AM', '']) {
      expect(isPickupTime(bad), bad).toBe(false)
      expect(slots(bad, '23:00'), `${bad} ca deschidere`).toBe(0)
    }
    // Fără sens (sau ne-text) — respinse, deși unele s-ar citi cumva.
    for (const bad of ['24:30', '25:00', '09:60', '9:', '-1:00', null, undefined, 900])
      expect(isPickupTime(bad), String(bad)).toBe(false)
  })

  it('SY6: valoarea dată câmpului `type="time"` e „HH:MM"', () => {
    expect(pickupTimeInputValue('09:00')).toBe('09:00')
    expect(pickupTimeInputValue('9:00')).toBe('09:00')
    expect(pickupTimeInputValue('9:5')).toBe('09:05')
    expect(pickupTimeInputValue('24:00')).toBe('00:00')
    expect(pickupTimeInputValue('21:00:00')).toBe('21:00')
    expect(pickupTimeInputValue(' 09:00')).toBe('09:00')
    for (const bad of ['9', '9.00', '', '25:00', null, undefined])
      expect(pickupTimeInputValue(bad), String(bad)).toBe('')
  })

  it('SY2: minutele intră în formular doar ca întreg în plajă', () => {
    expect(parseMinutes('20', PICKUP_LEAD_RANGE)).toBe(20)
    expect(parseMinutes(' 45 ', PICKUP_LEAD_RANGE)).toBe(45)
    expect(parseMinutes('240', PICKUP_LEAD_RANGE)).toBe(240)
    expect(parseMinutes('5', PICKUP_LEAD_RANGE)).toBe(5)
    for (const bad of ['', '4', '241', '20.5', '45abc', '-10', 'abc'])
      expect(parseMinutes(bad, PICKUP_LEAD_RANGE), bad).toBeNull()
    expect(parseMinutes('60', PICKUP_SLOT_RANGE)).toBe(60)
    expect(parseMinutes('61', PICKUP_SLOT_RANGE)).toBeNull()
  })

  it('SY3: la ieșire, întregul se aduce în plajă; golul rămâne eroare', () => {
    expect(clampMinutes('300', PICKUP_LEAD_RANGE)).toBe(240)
    expect(clampMinutes('4', PICKUP_LEAD_RANGE)).toBe(5)
    expect(clampMinutes('45', PICKUP_LEAD_RANGE)).toBe(45)
    expect(clampMinutes('90', PICKUP_SLOT_RANGE)).toBe(60)
    for (const bad of ['', '  ', 'abc', '20.5'])
      expect(clampMinutes(bad, PICKUP_LEAD_RANGE), bad).toBeNull()
  })
})

describe('settingsForm — secțiunile și slug-ul', () => {
  it('SY4: „Salvează" doar unde secțiunea are câmpuri de formular', () => {
    for (const surface of [null, surfaceFor('free'), surfaceFor('starter'), surfaceFor('pro')]) {
      expect(sectionHasFormFields('restaurant', surface)).toBe(true)
      expect(sectionHasFormFields('menu', surface)).toBe(true)
      expect(sectionHasFormFields('account', surface)).toBe(false)
    }
    // „Meniu QR" pe Planul 1 / free / plan necunoscut: doar carduri auto.
    expect(sectionHasFormFields('orders', null)).toBe(false)
    expect(sectionHasFormFields('orders', surfaceFor('free'))).toBe(false)
    expect(sectionHasFormFields('orders', surfaceFor('starter'))).toBe(false)
    // Control pozitiv: cu comenzi / ridicare, formularul există.
    expect(sectionHasFormFields('orders', surfaceFor('growth'))).toBe(true)
    expect(sectionHasFormFields('orders', surfaceFor('pro'))).toBe(true)
  })

  it('SY5: confirmarea slug-ului doar când moare o adresă veche', () => {
    expect(slugChangeNeedsConfirm('bistro-test', 'bistro-nou')).toBe(true)
    expect(slugChangeNeedsConfirm('bistro-test', 'bistro-test')).toBe(false)
    expect(slugChangeNeedsConfirm('bistro-test', '')).toBe(false)
    expect(slugChangeNeedsConfirm(null, 'bistro-nou')).toBe(false)
    expect(slugChangeNeedsConfirm(undefined, 'bistro-nou')).toBe(false)
    expect(slugChangeNeedsConfirm('', 'bistro-nou')).toBe(false)
  })
})

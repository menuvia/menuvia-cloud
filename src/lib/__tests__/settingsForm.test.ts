// Regulile pure ale formularului de Setări (lotul C7c, lib/settingsForm.ts).
// (Prefixul SY: verificat cu grep în src/, tests/, e2e/, supabase/, docs și
// CLAUDE.md, nefolosit înainte.)
//   SY1  orele de ridicare: doar HH:MM întreg (secunde opționale) — „9",
//        „9.00", „9 AM", „24:00" sunt respinse, fiindcă `buildPickupSlots` le
//        transformă în ZERO sloturi. Mutația care pică: regexul slăbit la
//        `/\d+:\d+/` („24:00", „9:5") sau scos. Control pozitiv: 09:00, 23:59,
//        00:00, 21:00:00 trec.
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
  sectionHasFormFields,
  slugChangeNeedsConfirm,
} from '../settingsForm'
import { surfaceFor } from './planSurfaceFixtures'

describe('settingsForm — ridicarea', () => {
  it('SY1: ora de ridicare e HH:MM întreg', () => {
    for (const ok of ['09:00', '23:59', '00:00', '21:00:00', '12:30'])
      expect(isPickupTime(ok), ok).toBe(true)
    for (const bad of ['9', '9.00', '9 AM', '24:00', '9:5', '09:60', '', ' 09:00', null, undefined, 900])
      expect(isPickupTime(bad), String(bad)).toBe(false)
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

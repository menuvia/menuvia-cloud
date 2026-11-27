// fiscalCurrency — moneda meniului pe un restaurant cu bon fiscal (mig 334,
// lotul M1). Autoritatea e serverul (gate la CITIRE în proiecțiile anon + gate
// la SCRIERE pe `restaurants.currency`); aici e oglinda din Setări, judecată pe
// țara din FORMULAR ca serverul pe rândul NOU. Suprafața vine din matricea
// ÎNGHEȚATĂ a lui `plan_features` (planSurfaceFixtures), nu din valori scrise
// de mână. (Prefixul FCL: verificat cu grep în src/, tests/, e2e/, supabase/,
// docs/ și CLAUDE.md, nefolosit înainte.)
//
//   FCL1 plan NECUNOSCUT (`surface` null) → `null`: nimic blocat, nicio notă;
//        moneda efectivă rămâne cea din formular. Mutația care pică: un
//        fallback „blocat” pe necunoscut (un local de pe Planul 1 n-ar mai
//        putea alege EUR cât timp planul se încarcă) — sau `false` în loc de
//        `null` (tristate-ul pierdut).
//   FCL2 Planul 3 în România (pro ȘI enterprise) → blocat; moneda efectivă e
//        RON oricare ar fi cea salvată; nota apare doar cu o monedă ≠ RON.
//        Mutația care pică: lock-ul ignoră suprafața (mereu `false`), sau
//        `effectiveMenuCurrency` care întoarce moneda brută.
//   FCL3 control POZITIV: Planurile 1–2 în România (free/starter/growth) rămân
//        libere și moneda efectivă e cea aleasă. Mutația care pică: lock pe
//        orice plan (mereu `true`) sau pe `surface.ordering`.
//   FCL4 ȚARA din formular decide, ca serverul pe rândul NOU: Plan 3 RO mutat
//        în DE → liber; Plan 3 din DE adus înapoi în RO → blocat (nivelul de
//        bani era coborât de țara VECHE, deci contează planul); Plan 3 din DE
//        rămas în DE → liber. Mutația care pică: lock judecat pe țara SALVATĂ
//        (prima jumătate) sau doar pe `surface.fiscal` (a doua).
//   FCL5 normalizarea țării: lipsa / șirul gol = RO (coloana e NOT NULL cu
//        default 'RO'), litere mici și spații acceptate. Mutația care pică: o
//        comparație strictă `=== 'RO'` (un `null` ar elibera moneda).
//   FCL6 „Adaugă o locație” (recenzia lotului M1): dintr-o sursă românească pe
//        Planul 3 cu EUR salvat dinaintea upgrade-ului, patch-ul locației noi
//        NU poartă moneda (serverul ar refuza UPDATE-ul ÎNTREG), dar fusul și
//        limba rămân; doar moneda → nimic de trimis. Control POZITIV: Planul 2
//        în România, Planul 3 dintr-o sursă din DE (țara se copiază odată cu
//        moneda) și planul necunoscut (decide serverul) își păstrează moneda.
//        Mutații care pică: `regionalPatchFrom(source)` neschimbat (prima
//        jumătate), moneda scoasă mereu (controalele), lock judecat doar pe
//        `surface.payments` fără țara țintă (sursa din DE ar pierde EUR).
//   FCL7 refuzul se recunoaște pe HINT, nu pe text; patch-ul fără monedă nu
//        mută nimic altceva și dă `null` când rămâne gol. Mutații care pică:
//        potrivirea pe mesaj (un mesaj tradus / schimbat ar rata refuzul), sau
//        `{}` în loc de `null` (al doilea UPDATE ar pleca gol).
import { describe, it, expect } from 'vitest'
import {
  effectiveMenuCurrency,
  fiscalCurrencyDrift,
  fiscalCurrencyLocked,
  isFiscalCurrencyRefusal,
  newLocationRegionalPatch,
  regionalPatchWithoutCurrency,
} from '../fiscalCurrency'
import { surfaceFor } from './planSurfaceFixtures'

describe('fiscalCurrency — moneda meniului pe bon fiscal (mig 334)', () => {
  it('FCL1: planul necunoscut nu blochează nimic', () => {
    expect(fiscalCurrencyLocked(null, 'RO', 'RO')).toBeNull()
    expect(effectiveMenuCurrency('EUR', null)).toBe('EUR')
    expect(fiscalCurrencyDrift('EUR', null)).toBe(false)
  })

  it('FCL2: Planul 3 în România — RON, cu notă doar pe o monedă salvată ≠ RON', () => {
    for (const plan of ['pro', 'enterprise'] as const) {
      const locked = fiscalCurrencyLocked(surfaceFor(plan), 'RO', 'RO')
      expect(locked).toBe(true)
      expect(effectiveMenuCurrency('EUR', locked)).toBe('RON')
      expect(effectiveMenuCurrency('RON', locked)).toBe('RON')
      expect(fiscalCurrencyDrift('EUR', locked)).toBe(true)
      expect(fiscalCurrencyDrift('RON', locked)).toBe(false)
    }
  })

  it('FCL3: control pozitiv — Planurile 1–2 aleg liber moneda', () => {
    for (const plan of ['free', 'starter', 'growth'] as const) {
      const locked = fiscalCurrencyLocked(surfaceFor(plan), 'RO', 'RO')
      expect(locked).toBe(false)
      expect(effectiveMenuCurrency('EUR', locked)).toBe('EUR')
      expect(effectiveMenuCurrency('HUF', locked)).toBe('HUF')
      expect(fiscalCurrencyDrift('EUR', locked)).toBe(false)
    }
  })

  it('FCL4: țara din formular decide, ca serverul pe rândul nou', () => {
    // Plan 3 RO mutat în DE în aceeași salvare: moneda se eliberează.
    expect(fiscalCurrencyLocked(surfaceFor('pro'), 'RO', 'DE')).toBe(false)
    // Plan 3 din DE (bonul nu există acolo, deci `fiscal` e false)…
    const de = surfaceFor('pro', { outsideRo: true })
    expect(de.fiscal).toBe(false)
    expect(fiscalCurrencyLocked(de, 'DE', 'DE')).toBe(false)
    // …adus înapoi în România: serverul judecă rândul NOU → blocat.
    expect(fiscalCurrencyLocked(de, 'DE', 'RO')).toBe(true)
    // Planul 2 din DE adus în România rămâne liber (fără bon pe plan).
    expect(fiscalCurrencyLocked(surfaceFor('growth', { outsideRo: true }), 'DE', 'RO')).toBe(false)
  })

  it('FCL5: țara lipsă = RO; litere mici și spații acceptate', () => {
    const pro = surfaceFor('pro')
    expect(fiscalCurrencyLocked(pro, null, null)).toBe(true)
    expect(fiscalCurrencyLocked(pro, undefined, '')).toBe(true)
    expect(fiscalCurrencyLocked(pro, ' ro ', 'ro')).toBe(true)
    expect(fiscalCurrencyLocked(pro, 'RO', 'de')).toBe(false)
  })

  it('FCL6: locația nouă nu copiază o monedă pe care serverul o refuză', () => {
    const roEur = { country: 'RO', currency: 'EUR', timezone: 'Europe/London', language: 'en' }
    // Planul 3 în România: moneda cade, fusul și limba rămân.
    for (const plan of ['pro', 'enterprise'] as const) {
      expect(newLocationRegionalPatch(roEur, surfaceFor(plan))).toEqual({
        timezone: 'Europe/London',
        language: 'en',
      })
      // Doar moneda de copiat → nimic de trimis (niciun UPDATE).
      expect(newLocationRegionalPatch({ country: 'RO', currency: 'EUR' }, surfaceFor(plan))).toBeNull()
    }
    // O sursă fără țară salvată = România (default-ul coloanei).
    expect(newLocationRegionalPatch({ currency: 'EUR', language: 'de' }, surfaceFor('pro'))).toEqual({
      language: 'de',
    })
    // Control POZITIV: Planul 2 în România își copiază moneda.
    expect(newLocationRegionalPatch(roEur, surfaceFor('growth'))).toEqual({
      currency: 'EUR',
      timezone: 'Europe/London',
      language: 'en',
    })
    // Control POZITIV: Planul 3 dintr-o sursă din DE — țara pleacă odată cu
    // moneda, iar serverul judecă rândul NOU (DE, fără bon fiscal).
    expect(
      newLocationRegionalPatch(
        { country: 'DE', currency: 'EUR', timezone: 'Europe/Berlin', language: 'de' },
        surfaceFor('pro', { outsideRo: true }),
      ),
    ).toEqual({ country: 'DE', currency: 'EUR', timezone: 'Europe/Berlin', language: 'de' })
    // Control POZITIV: planul necunoscut nu scoate nimic (decide serverul).
    expect(newLocationRegionalPatch(roEur, null)).toEqual({
      currency: 'EUR',
      timezone: 'Europe/London',
      language: 'en',
    })
    // Fluxul românesc obișnuit rămâne fără niciun apel.
    expect(newLocationRegionalPatch({ country: 'RO', currency: 'RON' }, surfaceFor('pro'))).toBeNull()
  })

  it('FCL7: refuzul se recunoaște pe hint; patch-ul fără monedă', () => {
    expect(
      isFiscalCurrencyRefusal({ message: 'orice text', code: '23514', hint: 'fiscal_currency_ron_only' }),
    ).toBe(true)
    // Același text, alt hint (sau fără hint) → nu e refuzul monedei.
    const msg = 'Pe un restaurant cu bon fiscal, moneda meniului rămâne RON (lei)'
    expect(isFiscalCurrencyRefusal({ message: msg, code: '23514' })).toBe(false)
    expect(isFiscalCurrencyRefusal({ message: msg, hint: 'country_owner_only' })).toBe(false)
    expect(isFiscalCurrencyRefusal(null)).toBe(false)
    expect(isFiscalCurrencyRefusal('fiscal_currency_ron_only')).toBe(false)
    expect(regionalPatchWithoutCurrency({ currency: 'EUR', timezone: 'Europe/London', language: 'en' })).toEqual({
      timezone: 'Europe/London',
      language: 'en',
    })
    expect(regionalPatchWithoutCurrency({ currency: 'EUR' })).toBeNull()
    const src = { country: 'DE', currency: 'EUR' as const }
    expect(regionalPatchWithoutCurrency(src)).toEqual({ country: 'DE' })
    // Patch-ul primit nu se mută.
    expect(src).toEqual({ country: 'DE', currency: 'EUR' })
  })
})

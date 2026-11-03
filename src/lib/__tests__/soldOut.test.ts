// „Epuizat” — biblioteca clientului (mig 313, lotul B).
//
//   SL1  soldOutSourceLabel: 'din stoc' / 'manual' / 'deblocat manual' / null.
//        Mutația care pică: sursa ignorată (tot „manual”) sau deblocarea
//        manuală raportată ca nimic.
//   SL2  setProductSoldOut cheamă `set_product_sold_out` cu argumentele exacte
//        și întoarce starea serverului; un refuz aruncă un Error REAL cu
//        hint/code (contractul createOrder), pe care toUserMessage îl dă ca
//        refuz de drepturi. Mutația care pică: obiectul PostgREST aruncat brut
//        (fără `instanceof Error`) sau hint/code pierdute.
//   SL3  fetchStaffSoldOutProducts: epuizatele întâi, apoi ordinea meniului;
//        pe o bază fără mig 313 (42703 pe `sold_out_source`) reîncearcă fără
//        coloană. Mutația care pică: fallback-ul scos (panoul gol pe DB veche).
//   SL4  menuVersionChanged + fetchMenuVersion: sondă picată = „nu știu” = fără
//        refetch; versiune diferită = refetch. Mutația care pică: `null`
//        tratat ca schimbare (refetch complet la fiecare revenire în tab).
//   SL5  hint-ul `product_sold_out` (și mesajul brut al trigger-ului 130, fără
//        hint) → `err_product_sold_out` în TOATE cele 7 limbi, nu textul
//        serverului. Mutația care pică: hint-ul scos din HINT_KEYS (ar cădea pe
//        fallback-ul „comanda nu s-a trimis”).
//   SL6  soldOutFormTarget: doar o schimbare FĂCUTĂ în formular pleacă (prin
//        RPC); un formular neatins nu trimite nimic, oricât de vechi ar fi.
//        Mutația care pică: comparația scoasă (orice `is_sold_out` din formular
//        pleacă — exact deblocarea tăcută din recenzie).
//   SL7  isSoldOutGuestError: refuzul `product_sold_out` (hint SAU mesajul brut)
//        cere reîncărcarea meniului în QrMenuPage, ca linia din coș să arate
//        CARE produs s-a epuizat; alte refuzuri și rețeaua NU. Mutația care
//        pică: predicatul întors mereu false (meniul nu se mai reface).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  selects: [] as string[],
  results: [] as Array<{ data: unknown; error: unknown }>,
}))

interface Chain {
  eq: () => Chain
  order: () => Promise<{ data: unknown; error: unknown }>
}

vi.mock('../supabase', () => {
  const chain = (columns: string): Chain => {
    m.selects.push(columns)
    const res = m.results.shift() ?? { data: [], error: null }
    const c: Chain = {
      eq: () => c,
      order: () => Promise.resolve(res),
    }
    return c
  }
  return { supabase: { rpc: m.rpc, from: () => ({ select: chain }) } }
})

import {
  fetchStaffSoldOutProducts,
  isMissingSoldOutRpc,
  setProductSoldOut,
  soldOutFormTarget,
  soldOutSourceLabel,
} from '../soldOut'
import { fetchMenuVersion, menuVersionChanged } from '../menuVersion'
import { describeGuestError, guestErrorKey, isSoldOutGuestError } from '../guestErrors'
import { T } from '../publicMenuStrings'
import { toUserMessage, MSG_NO_PERMISSION } from '../userMessages'

const LANGS = ['ro', 'en', 'de', 'fr', 'it', 'hu', 'es'] as const

beforeEach(() => {
  m.rpc.mockReset()
  m.selects = []
  m.results = []
})

describe('soldOut — eticheta sursei', () => {
  it('SL1 din stoc / manual / deblocat manual / nimic', () => {
    expect(soldOutSourceLabel(true, 'stock')).toBe('din stoc')
    expect(soldOutSourceLabel(true, 'manual')).toBe('manual')
    expect(soldOutSourceLabel(true, null)).toBe('manual')
    expect(soldOutSourceLabel(true, undefined)).toBe('manual')
    expect(soldOutSourceLabel(false, 'manual')).toBe('deblocat manual')
    expect(soldOutSourceLabel(false, null)).toBeNull()
    expect(soldOutSourceLabel(false, undefined)).toBeNull()
  })
})

describe('soldOut — RPC-ul personalului', () => {
  it('SL2 argumente exacte, starea serverului; refuzul = Error cu hint/code', async () => {
    m.rpc.mockResolvedValueOnce({
      data: { ok: true, product_id: 'p1', is_sold_out: false, sold_out_source: 'manual' },
      error: null,
    })
    await expect(setProductSoldOut('p1', false)).resolves.toEqual({
      is_sold_out: false,
      sold_out_source: 'manual',
    })
    expect(m.rpc).toHaveBeenCalledWith('set_product_sold_out', {
      p_product_id: 'p1',
      p_sold_out: false,
    })

    m.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Nu ai acces la acest produs.', code: '42501', hint: 'not_member' },
    })
    const err = await setProductSoldOut('p1', true).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as { hint?: string }).hint).toBe('not_member')
    expect((err as { code?: string }).code).toBe('42501')
    expect(toUserMessage(err)).toBe(MSG_NO_PERMISSION)
    expect(isMissingSoldOutRpc(err)).toBe(false)
    expect(isMissingSoldOutRpc({ code: 'PGRST202' })).toBe(true)
  })

  it('SL3 epuizatele întâi; fallback fără sold_out_source pe 42703', async () => {
    m.results = [
      {
        data: null,
        error: { message: 'column products.sold_out_source does not exist', code: '42703' },
      },
      {
        data: [
          { id: 'a', name: 'Apă', emoji: '💧', is_sold_out: false, display_order: 0 },
          { id: 'b', name: 'Supă', emoji: null, is_sold_out: true, display_order: 5 },
          { id: 'c', name: 'Pâine', emoji: '🍞', is_sold_out: false, display_order: 1 },
        ],
        error: null,
      },
    ]
    const rows = await fetchStaffSoldOutProducts('r1')
    expect(m.selects).toHaveLength(2)
    expect(m.selects[0]).toContain('sold_out_source')
    expect(m.selects[1]).not.toContain('sold_out_source')
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'c'])
    expect(rows[0]).toMatchObject({ is_sold_out: true, sold_out_source: null })

    m.results = [{ data: null, error: { message: 'permission denied', code: '42501' } }]
    await expect(fetchStaffSoldOutProducts('r1')).rejects.toBeInstanceOf(Error)
  })
})

describe('menuVersion — sonda', () => {
  it('SL4 „nu știu” nu declanșează refetch; o versiune nouă da', async () => {
    expect(menuVersionChanged('v1', 'v1')).toBe(false)
    expect(menuVersionChanged('v1', 'v2')).toBe(true)
    expect(menuVersionChanged('v1', null)).toBe(false)
    expect(menuVersionChanged(null, null)).toBe(false)
    expect(menuVersionChanged(null, 'v1')).toBe(true)

    m.rpc.mockResolvedValueOnce({ data: 'abc', error: null })
    await expect(fetchMenuVersion('r1')).resolves.toBe('abc')
    expect(m.rpc).toHaveBeenCalledWith('get_menu_version', { p_restaurant_id: 'r1' })
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x', code: 'PGRST202' } })
    await expect(fetchMenuVersion('r1')).resolves.toBeNull()
    m.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(fetchMenuVersion('r1')).resolves.toBeNull()
  })
})

describe('guestErrors — produsul epuizat', () => {
  it('SL5 hint-ul și mesajul brut al trigger-ului 130 → err_product_sold_out, în 7 limbi', () => {
    const byHint = Object.assign(new Error('P0001'), { hint: 'product_sold_out' })
    expect(guestErrorKey(byHint)).toBe('err_product_sold_out')
    expect(guestErrorKey(new Error('Produsul "Supă" este epuizat'))).toBe('err_product_sold_out')
    for (const l of LANGS) {
      const out = describeGuestError(l, byHint, { fallback: 'err_order_not_sent' })
      expect(out, l).toBe(T(l, 'err_product_sold_out'))
      expect(out.length, l).toBeGreaterThan(10)
      expect(T(l, 'cart_sold_out_notice').length, l).toBeGreaterThan(10)
    }
  })
})

describe('soldOutFormTarget — formularul de produs', () => {
  it('SL6 doar comutatorul mutat în formular pleacă; formularul neatins nu trimite nimic', () => {
    // Lista a fost încărcată cu produsul disponibil; între timp stocul l-a
    // epuizat. Formularul neatins (false, ca la deschidere) → nimic de trimis.
    expect(soldOutFormTarget({ is_sold_out: false }, { is_sold_out: false })).toBeNull()
    expect(soldOutFormTarget({ is_sold_out: true }, { is_sold_out: true })).toBeNull()
    expect(soldOutFormTarget({ is_sold_out: false }, {})).toBeNull()
    // Omul a mutat comutatorul → starea ALEASĂ pleacă.
    expect(soldOutFormTarget({ is_sold_out: false }, { is_sold_out: true })).toBe(true)
    expect(soldOutFormTarget({ is_sold_out: true }, { is_sold_out: false })).toBe(false)
    // Fără rând deschis, „neatins” înseamnă disponibil.
    expect(soldOutFormTarget(null, { is_sold_out: false })).toBeNull()
    expect(soldOutFormTarget(undefined, { is_sold_out: true })).toBe(true)
  })
})

describe('isSoldOutGuestError — reîncărcarea meniului în QrMenuPage', () => {
  it('SL7 product_sold_out (hint sau mesaj) → da; alte refuzuri și rețeaua → nu', () => {
    expect(isSoldOutGuestError(Object.assign(new Error('P0001'), { hint: 'product_sold_out' }))).toBe(true)
    expect(isSoldOutGuestError({ message: 'Produsul "Supă" este epuizat', code: 'P0001' })).toBe(true)
    expect(isSoldOutGuestError(Object.assign(new Error('x'), { hint: 'product_inactive' }))).toBe(false)
    expect(isSoldOutGuestError(Object.assign(new Error('x'), { hint: 'missing_required_group' }))).toBe(false)
    expect(isSoldOutGuestError(new Error('TypeError: Load failed'))).toBe(false)
    expect(isSoldOutGuestError(null)).toBe(false)
  })

  it('SL7b QrMenuPage reface meniul pe refuzul de epuizare (cablajul, nu doar predicatul)', () => {
    // Mutația care pică: apelul scos din handleSubmit — predicatul ar rămâne
    // corect, dar coșul n-ar mai arăta CARE linie s-a epuizat.
    const src = readFileSync(resolve(process.cwd(), 'src/pages/QrMenuPage.tsx'), 'utf8')
    expect(src).toMatch(/if \(isSoldOutGuestError\(lastError\)\) (void )?refreshMenu\(\)/)
  })
})

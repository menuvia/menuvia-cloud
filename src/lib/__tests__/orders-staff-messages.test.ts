// Mesajele de pe ecranele de staff (ux-staff-action-errors / ux-staff-edit-error):
// refuzurile serverului ajung la ospătar/bucătar ÎN ROMÂNĂ, cu motivul real,
// iar textele brute în engleză ale lui advance_order / update_order_items nu
// se mai arată. Contractul stabil e HINT-ul (și codul 40001 al lock-ului
// optimist), nu textul.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import {
  updateOrderItems,
  advanceOrderStatus,
  describeEditOrderError,
  describeStaffActionError,
  describeWaiterOrderSent,
} from '../orders'

// Cuvinte care trădează un text brut al serverului ajuns pe ecran.
const RAW_ENGLISH =
  /\b(order|cannot|invalid|not found|role|terminal|state|payments|product|failed|load)\b/i

beforeEach(() => {
  rpcMock.mockReset()
})

describe('updateOrderItems — eroarea păstrează motivul', () => {
  it('SM1 aruncă un Error REAL cu code/hint (nu obiectul PostgREST brut)', async () => {
    // Mutație: revino la `if (error) throw error` → rejects nu mai e
    // `instanceof Error` și EditOrderSheet cădea pe „Eroare la salvare".
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        message:
          'update_order_items: comanda a fost modificată între timp (total 25, așteptat 20). Redeschide comanda și încearcă din nou.',
        code: '40001',
        hint: null,
        details: null,
      },
    })
    const p = updateOrderItems(
      'o1',
      [{ product_id: 'p1', quantity: 1, option_ids: [], notes: null }],
      20,
    )
    await expect(p).rejects.toBeInstanceOf(Error)
    await p.catch((e: unknown) => {
      expect((e as { code?: string }).code).toBe('40001')
      expect(describeEditOrderError(e)).toMatch(/modificată între timp de altcineva/i)
    })
  })
})

describe('describeEditOrderError', () => {
  const cases: ReadonlyArray<[string, { message: string; code?: string; hint?: string }, RegExp]> =
    [
      [
        'lock optimist (40001)',
        {
          message:
            'update_order_items: comanda a fost modificată între timp (total 25, așteptat 20).',
          code: '40001',
        },
        /modificată între timp de altcineva/i,
      ],
      [
        'plăți parțiale',
        {
          message:
            'update_order_items: order has partial payments (12.00 lei). Anulează plățile întâi.',
        },
        /plăți înregistrate/i,
      ],
      [
        'stare terminală',
        { message: 'update_order_items: order is paid — cannot edit terminal state' },
        /deja finalizată/i,
      ],
      ['rol', { message: 'update_order_items: role kitchen cannot edit orders' }, /rolul tău/i],
      [
        'produs inactiv',
        { message: 'update_order_items: product "Ciorbă" is inactive' },
        /nu mai e disponibil în meniu/i,
      ],
      [
        'comandă dispărută',
        { message: 'update_order_items: order 7c9e not found' },
        /nu mai există/i,
      ],
      [
        'opțiuni invalide',
        { message: 'update_order_items: invalid options for product "Pizza"' },
        /opțiune aleasă/i,
      ],
      ['cantitate', { message: 'update_order_items: invalid quantity (1-99)' }, /între 1 și 99/],
      [
        'necunoscut',
        { message: 'update_order_items: something new and unexpected' },
        /nu a fost salvată/i,
      ],
    ]

  it('SM2 fiecare refuz cunoscut → text RO, fără textul brut al serverului', () => {
    for (const [name, err, re] of cases) {
      const text = describeEditOrderError(err)
      expect(text, name).toMatch(re)
      expect(text, name).not.toMatch(/update_order_items/)
      expect(text, name).not.toMatch(RAW_ENGLISH)
    }
  })

  it('SM3 grupele de opțiuni: mesajul serverului (deja în română) fără prefixul tehnic', () => {
    const text = describeEditOrderError({
      message:
        'update_order_items: grupul "Pâine" pentru produsul "Ciorbă" cere cel puțin 1 opțiune selectată',
      hint: 'missing_required_group',
    })
    expect(text).toBe('grupul "Pâine" pentru produsul "Ciorbă" cere cel puțin 1 opțiune selectată')
  })

  it('SM4 rețeaua (iPhone) → mesaj de conexiune', () => {
    expect(describeEditOrderError(new Error('TypeError: Load failed'))).toMatch(/fără conexiune/i)
  })
})

describe('describeStaffActionError — acțiunile rapide (Confirmă / Gata / Servit / Închide)', () => {
  it('SM5 hint-urile lui advance_order → text RO; textul englezesc al serverului nu apare', () => {
    const byHint: ReadonlyArray<[string, string, RegExp]> = [
      [
        'invalid_transition',
        'Order not in a servable state (current: served)',
        /s-a schimbat între timp/i,
      ],
      ['order_terminal', 'Order is already terminal (status: paid)', /deja finalizată/i],
      ['order_not_found', 'Order not found', /nu mai există/i],
      ['role_insufficient', 'Role kitchen cannot mark orders served', /rolul tău/i],
      ['unauthorized', 'Not authorized for this restaurant', /nu ai acces/i],
      ['auth_required', 'Authentication required', /sesiunea a expirat/i],
      [
        'fiscal_plan_requires_payment',
        'Pe planul cu fiscalizare comanda se finalizează prin plată (bon fiscal), nu prin închidere',
        /fiscalizare/i,
      ],
    ]
    for (const [hint, message, re] of byHint) {
      const text = describeStaffActionError(Object.assign(new Error(message), { hint }))
      expect(text, hint).toMatch(re)
      expect(text, hint).not.toMatch(RAW_ENGLISH)
    }
  })

  it('SM6 hint necunoscut → text generic RO, NU mesajul brut', () => {
    const text = describeStaffActionError(
      Object.assign(new Error('Unknown action: teleport'), { hint: 'unknown_action' }),
    )
    expect(text).toMatch(/nu a fost salvată/i)
    expect(text).not.toMatch(/unknown/i)
  })

  it('SM7 cădere de rețea (Chrome și iPhone) → „Fără conexiune"', () => {
    expect(describeStaffActionError(new Error('TypeError: Failed to fetch'))).toMatch(
      /fără conexiune/i,
    )
    expect(describeStaffActionError({ message: 'TypeError: Load failed', code: '' })).toMatch(
      /fără conexiune/i,
    )
  })

  it('SM8 cap-coadă: eroarea reală a lui advanceOrderStatus își păstrează hint-ul până la text', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Order not in a servable state (current: served)',
        hint: 'invalid_transition',
        code: 'P0001',
      },
    })
    const err = await advanceOrderStatus('o1', { status: 'served', _currentStatus: 'ready' }).catch(
      (e: unknown) => e,
    )
    expect(describeStaffActionError(err)).toMatch(/s-a schimbat între timp/i)
  })
})

describe('describeWaiterOrderSent — ospătarul află unde a ajuns comanda', () => {
  it('SM9 comanda rămasă DOAR pe telefon (coada offline, LOCAL-) → avertisment explicit', () => {
    const m = describeWaiterOrderSent({ short_id: 'LOCAL-4821' })
    expect(m.kind).toBe('warning')
    expect(m.text).toMatch(/DOAR pe acest telefon/)
    expect(m.text).toContain('LOCAL-4821')
  })

  it('SM10 comanda ajunsă la server → confirmare cu numărul ei', () => {
    const m = describeWaiterOrderSent({ short_id: 'A1B2C3' })
    expect(m.kind).toBe('success')
    expect(m.text).toBe('Comanda #A1B2C3 a fost trimisă la bucătărie.')
  })
})

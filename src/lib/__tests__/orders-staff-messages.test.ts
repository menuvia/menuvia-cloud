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
  staffActionFailure,
} from '../orders'
import { makeTranslator } from '../../i18n/core'
import ordersRo from '../../i18n/ns/orders/ro'
import waiterRo from '../../i18n/ns/waiter/ro'

// Textele vin din namespace-ul `orders` (lotul L4a); aici, în română.
const ro = makeTranslator(ordersRo, 'ro')
// `describeWaiterOrderSent` citește namespace-ul `waiter` (lotul L4b).
const roWaiter = makeTranslator(waiterRo, 'ro')

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
      expect(describeEditOrderError(e, ro)).toMatch(/modificată între timp de altcineva/i)
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
        'linie-sursă dispărută (mig 320: editare concurentă cu același total)',
        {
          message: 'update_order_items: linia sursă nu aparține comenzii sau produsului "Burger"',
          hint: 'invalid_source_item',
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
      [
        'cantitate (mig 320)',
        { message: 'update_order_items: invalid quantity (1-20)', hint: 'invalid_quantity' },
        /între 1 și 20\./,
      ],
      [
        'cantitate, linie păstrată peste 20',
        { message: 'update_order_items: invalid quantity (1-25)', hint: 'invalid_quantity' },
        /între 1 și 25\./,
      ],
      ['cantitate (server vechi)', { message: 'update_order_items: invalid quantity (1-99)' }, /între 1 și 99\./],
      [
        'produs scos din meniu (mig 320)',
        {
          message:
            'update_order_items: produsul "Cola" nu mai e în meniu — poți păstra cel mult cantitatea deja comandată (2)',
          hint: 'product_inactive',
        },
        /„Cola” nu mai e în meniu\. Poți păstra cel mult cantitatea deja comandată \(2\)/,
      ],
      [
        'produs nou scos din meniu (mig 320)',
        {
          message:
            'update_order_items: produsul "Cola" nu mai e în meniu — poți păstra cel mult cantitatea deja comandată (0)',
          hint: 'product_inactive',
        },
        /„Cola” nu mai e în meniu și nu mai poate fi adăugat/,
      ],
      [
        'necunoscut',
        { message: 'update_order_items: something new and unexpected' },
        /nu a fost salvată/i,
      ],
    ]

  it('SM2 fiecare refuz cunoscut → text RO, fără textul brut al serverului', () => {
    for (const [name, err, re] of cases) {
      const text = describeEditOrderError(err, ro)
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
    }, ro)
    expect(text).toBe('grupul "Pâine" pentru produsul "Ciorbă" cere cel puțin 1 opțiune selectată')
  })

  it('SM3b produsul epuizat între timp (mig 313): numele + cantitatea păstrabilă, fără textul tehnic', () => {
    // Mutația care pică: ramura product_sold_out scoasă → „Modificarea nu a
    // fost salvată” generic, fără să spună CE produs și cât se poate păstra.
    const surplus = describeEditOrderError({
      message:
        'update_order_items: produsul "Supă" este epuizat — poți păstra cel mult cantitatea deja comandată (2)',
      hint: 'product_sold_out',
      code: 'P0001',
    }, ro)
    expect(surplus).toMatch(/„Supă”/)
    expect(surplus).toMatch(/epuizat/i)
    expect(surplus).toMatch(/cel mult cantitatea deja comandată \(2\)/)
    expect(surplus).not.toMatch(/update_order_items/)
    expect(surplus).not.toMatch(RAW_ENGLISH)

    const added = describeEditOrderError({
      message:
        'update_order_items: produsul "Clătită" este epuizat — poți păstra cel mult cantitatea deja comandată (0)',
      hint: 'product_sold_out',
    }, ro)
    expect(added).toMatch(/„Clătită” e epuizat și nu mai poate fi adăugat/)
    expect(added).not.toMatch(RAW_ENGLISH)

    // Mesajul trigger-ului 130 (fără cantitate, fără hint pe o cale veche).
    const raw = describeEditOrderError({ message: 'Produsul "Apă" este epuizat' }, ro)
    expect(raw).toMatch(/„Apă” s-a epuizat între timp/)
    expect(raw).not.toMatch(/nu a fost salvată/i)
  })

  it('SM4 rețeaua (iPhone) → mesaj de conexiune', () => {
    expect(describeEditOrderError(new Error('TypeError: Load failed'), ro)).toMatch(/fără conexiune/i)
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
      const text = describeStaffActionError(staffActionFailure(Object.assign(new Error(message), { hint })), ro)
      expect(text, hint).toMatch(re)
      expect(text, hint).not.toMatch(RAW_ENGLISH)
    }
  })

  it('SM6 hint necunoscut → text generic RO, NU mesajul brut', () => {
    const text = describeStaffActionError(
      staffActionFailure(Object.assign(new Error('Unknown action: teleport'), { hint: 'unknown_action' })),
      ro,
    )
    expect(text).toMatch(/nu a fost salvată/i)
    expect(text).not.toMatch(/unknown/i)
  })

  it('SM7 cădere de rețea (Chrome și iPhone) → „Fără conexiune"', () => {
    expect(describeStaffActionError(staffActionFailure(new Error('TypeError: Failed to fetch')), ro)).toMatch(
      /fără conexiune/i,
    )
    expect(describeStaffActionError(staffActionFailure({ message: 'TypeError: Load failed', code: '' }), ro)).toMatch(
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
    expect(describeStaffActionError(staffActionFailure(err), ro)).toMatch(/s-a schimbat între timp/i)
  })
})

describe('describeWaiterOrderSent — ospătarul află unde a ajuns comanda', () => {
  it('SM9 comanda rămasă DOAR pe telefon (coada offline, LOCAL-) → avertisment explicit', () => {
    const m = describeWaiterOrderSent({ short_id: 'LOCAL-4821' }, roWaiter)
    expect(m.kind).toBe('warning')
    expect(m.text).toMatch(/DOAR pe acest telefon/)
    expect(m.text).toContain('LOCAL-4821')
  })

  it('SM10 comanda ajunsă la server → confirmare cu numărul ei', () => {
    const m = describeWaiterOrderSent({ short_id: 'A1B2C3' }, roWaiter)
    expect(m.kind).toBe('success')
    expect(m.text).toBe('Comanda #A1B2C3 a fost trimisă la bucătărie.')
  })
})

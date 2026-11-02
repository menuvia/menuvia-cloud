// toUserMessage — ce vede omul când o acțiune din panou eșuează (lib/userMessages.ts).
//
//   UM1  tabelul contractului: drepturi (42501 / RLS / „permission denied" /
//        refuzurile englezești de autorizare din RPC-urile vechi), PGRST116,
//        HTTP 403 / „Forbidden", 23505, rețea (TypeError + textele Safari/Chrome)
//        → mesajul românesc fix. Mutația care pică: orice ramură scoasă (ex.
//        fără PGRST116 → textul englezesc sau rezerva).
//   UM2  mesajele DEJA românești (raise exception din migrații, Error-uri din
//        client) trec neatinse — CONTROL: fără el, o funcție care întoarce mereu
//        rezerva ar trece UM1/UM3. Mutația care pică: detecția de română scoasă.
//   UM3  englezescul necunoscut / null / non-obiect → rezerva dată sau cea
//        implicită. Mutația care pică: `return message` în loc de rezervă.
//   UM4  drepturile bat textul românesc: un 42501 cu mesaj românesc tot „Nu ai
//        drepturi…" (ordinea ramurilor). Mutația care pică: testul de română
//        mutat înaintea celui de drepturi.
//   ZR1  zeroRowsAsDenied: 0 rânduri FĂRĂ eroare (refuz RLS tăcut) → eroare de
//        drepturi; un rând → null (control); eroarea originală trece mai departe.
//        Mutația care pică: `data.length === 0` scos (codul vechi „Șters").
import { describe, it, expect } from 'vitest'
import {
  toUserMessage,
  zeroRowsAsDenied,
  MSG_NO_PERMISSION,
  MSG_NOT_FOUND,
  MSG_FORBIDDEN,
  MSG_DUPLICATE,
  MSG_NETWORK,
  MSG_GENERIC,
} from '../userMessages'

describe('toUserMessage', () => {
  it('UM1 tabelul contractului', () => {
    const table: Array<[unknown, string]> = [
      [{ message: 'new row violates row-level security policy for table "products"', code: '42501' }, MSG_NO_PERMISSION],
      [{ message: 'permission denied for function is_admin', code: '' }, MSG_NO_PERMISSION],
      [{ message: 'Not authorized for this restaurant', code: 'P0001' }, MSG_NO_PERMISSION],
      [{ message: 'Role waiter cannot cancel orders', code: 'P0001' }, MSG_NO_PERMISSION],
      [{ message: 'Only owners/managers can force-resolve receipts', code: 'P0001' }, MSG_NO_PERMISSION],
      [{ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, MSG_NOT_FOUND],
      [{ message: 'Forbidden', status: 403 }, MSG_FORBIDDEN],
      ['Forbidden', MSG_FORBIDDEN],
      [{ message: 'duplicate key value violates unique constraint "x_key"', code: '23505' }, MSG_DUPLICATE],
      [new TypeError('Failed to fetch'), MSG_NETWORK],
      [{ message: 'TypeError: Load failed', code: '' }, MSG_NETWORK],
    ]
    for (const [err, want] of table) expect(toUserMessage(err)).toBe(want)
  })

  it('UM2 mesajele românești trec neatinse', () => {
    expect(toUserMessage({ message: 'Masa nu există.', code: 'P0001' })).toBe('Masa nu există.')
    expect(toUserMessage(new Error('Acces interzis: doar owner/manager pot roti token-urile.'))).toBe(
      'Acces interzis: doar owner/manager pot roti token-urile.',
    )
    expect(toUserMessage(new Error('Eroare la categoria "Supe": network'))).toBe(
      'Eroare la categoria "Supe": network',
    )
  })

  it('UM3 englezescul necunoscut cade pe rezervă', () => {
    expect(toUserMessage({ message: 'Order not found', code: 'P0001' }, 'Nu am putut salva.')).toBe(
      'Nu am putut salva.',
    )
    expect(toUserMessage(new Error('boom'))).toBe(MSG_GENERIC)
    expect(toUserMessage(null)).toBe(MSG_GENERIC)
    expect(toUserMessage(42, 'Rezervă.')).toBe('Rezervă.')
  })

  it('UM4 drepturile bat textul românesc', () => {
    expect(toUserMessage({ message: 'Acces interzis la produse', code: '42501' })).toBe(
      MSG_NO_PERMISSION,
    )
  })
})

describe('zeroRowsAsDenied', () => {
  it('ZR1 zero rânduri = refuz; un rând = ok; eroarea trece', () => {
    const denied = zeroRowsAsDenied({ data: [], error: null })
    expect(denied).not.toBeNull()
    expect(toUserMessage(denied)).toBe(MSG_NO_PERMISSION)
    expect(zeroRowsAsDenied({ data: null, error: null })).not.toBeNull()
    expect(zeroRowsAsDenied({ data: [{ id: 'x' }], error: null })).toBeNull()
    expect(zeroRowsAsDenied({ data: null, error: { message: 'boom', code: '500' } })).toEqual({
      message: 'boom',
      code: '500',
    })
  })
})

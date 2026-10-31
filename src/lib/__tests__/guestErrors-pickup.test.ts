// src/lib/__tests__/guestErrors-pickup.test.ts
// ux-guest-10 (pasul A): pe un local fără `pickup_orders` (Planul 1, downgrade)
// ridicarea apare încă oaspetelui — proiecția publică nu expune planul, iar
// helperul public e o migrație separată (pasul B, amânat). Refuzul serverului
// (enforce_ordering_enabled, mig 290: hint `plan_upgrade_required`) cădea pe
// fallback-ul „Comanda nu s-a trimis. Încearcă din nou." — o invitație la o
// retrimitere care nu poate reuși. Acum se spune pe față.
//   GP1  hint-ul de plan → „Comenzile pentru ridicare nu sunt disponibile"
//        (ridicare) / „Restaurantul nu primește comenzi online" (QR). Mutația
//        care pică: `plan_upgrade_required` scos din HINT_KEYS.
//   GP2  aceleași refuzuri FĂRĂ hint (serverele vechi, comenzi oprite manual).
//   GP3  control: rețeaua și necunoscutul rămân reîncercabile (nu sunt refuz).
//   GP4  refuzul nu e textul generic de reîncercare în NICIUNA din cele 7 limbi.
import { describe, it, expect } from 'vitest'
import { guestErrorKey, isPickupRefusal, PICKUP_ERROR_OPTS } from '../guestErrors'
import { T } from '../publicMenuStrings'

function serverError(message: string, hint?: string): Error {
  return Object.assign(new Error(message), hint ? { hint, code: '23514' } : { code: '23514' })
}

// Contractul e HINT-ul, nu textul (mig 290): un mesaj reformulat pe server nu
// trebuie să cadă pe „încearcă din nou".
const PLAN_GATE = serverError('Text reformulat pe server.', 'plan_upgrade_required')

describe('Refuzul de plan la ridicare (ux-guest-10, pasul A)', () => {
  it('GP1 hint-ul de plan → mesaj de indisponibilitate, nu „încearcă din nou"', () => {
    expect(guestErrorKey(PLAN_GATE, PICKUP_ERROR_OPTS)).toBe('err_pickup_disabled')
    expect(isPickupRefusal(guestErrorKey(PLAN_GATE, PICKUP_ERROR_OPTS))).toBe(true)
    // Fără contextul ridicării (comanda QR): localul nu primește comenzi online.
    expect(guestErrorKey(PLAN_GATE)).toBe('err_restaurant_inactive')
  })

  it('GP2 aceleași refuzuri fără hint (mesajele brute ale gate-ului)', () => {
    for (const msg of [
      'Comenzile sunt oprite momentan pentru acest restaurant.',
      'Restaurantul este dezactivat.',
      'Comenzile nu sunt disponibile pe planul curent al restaurantului. Funcția cere un plan superior.',
    ]) {
      expect(guestErrorKey(serverError(msg), PICKUP_ERROR_OPTS), msg).toBe('err_pickup_disabled')
    }
    // Modulul oprit pe ridicare (hint existent) → același refuz.
    expect(guestErrorKey(serverError('x', 'pickup_disabled'), PICKUP_ERROR_OPTS)).toBe(
      'err_pickup_disabled',
    )
  })

  it('GP3 control: rețeaua și eroarea necunoscută rămân reîncercabile', () => {
    const net = guestErrorKey(new TypeError('Failed to fetch'), PICKUP_ERROR_OPTS)
    expect(net).toBe('err_order_not_sent_network')
    expect(isPickupRefusal(net)).toBe(false)
    const unknown = guestErrorKey(serverError('ceva neașteptat'), PICKUP_ERROR_OPTS)
    expect(unknown).toBe('err_order_not_sent')
    expect(isPickupRefusal(unknown)).toBe(false)
  })

  it('GP4 în toate cele 7 limbi refuzul diferă de textul de reîncercare', () => {
    for (const lang of ['ro', 'en', 'de', 'fr', 'it', 'hu', 'es']) {
      const refusal = T(lang, 'err_pickup_disabled')
      expect(refusal.length, lang).toBeGreaterThan(0)
      expect(refusal, lang).not.toBe(T(lang, 'err_order_not_sent'))
    }
  })
})

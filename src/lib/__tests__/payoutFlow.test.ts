// src/lib/__tests__/payoutFlow.test.ts — oglinda UI a mașinii de stări (mig 294)
import { describe, it, expect } from 'vitest'
import {
  availablePayoutActions,
  cancelNeedsMoneyReturnConfirm,
  currentPayoutPeriod,
  describePayoutRefusal,
  formatIban,
  payoutActionNeedsInput,
} from '../payoutFlow'

describe('availablePayoutActions — oglinda matricei din trg_affiliate_payout_transition', () => {
  it('PFU1: fiecare stare ne-terminală oferă exact tranzițiile permise de server', () => {
    expect(availablePayoutActions('draft', false)).toEqual(['request_invoice', 'cancel'])
    expect(availablePayoutActions('awaiting_invoice', false)).toEqual(['match_invoice', 'cancel'])
    expect(availablePayoutActions('invoice_matched', false)).toEqual(['start_transfer', 'cancel'])
    expect(availablePayoutActions('processing', true)).toEqual(['mark_paid', 'hold', 'mark_failed'])
    expect(availablePayoutActions('on_hold', true)).toEqual(['mark_paid', 'mark_failed'])
  })

  it('PFU2: failed CU referință (banii pot fi plecat) nu se mai poate reîncerca, doar anula', () => {
    expect(availablePayoutActions('failed', true)).toEqual(['cancel'])
    expect(availablePayoutActions('failed', false)).toEqual(['match_invoice', 'cancel'])
  })

  it('PFU3: stările terminale și cele necunoscute nu oferă nimic', () => {
    expect(availablePayoutActions('paid', true)).toEqual([])
    expect(availablePayoutActions('canceled', false)).toEqual([])
    expect(availablePayoutActions('ceva_nou', false)).toEqual([])
  })

  it('PFU4: acțiunile cu motiv/factură/referință cer input, celelalte nu', () => {
    expect(payoutActionNeedsInput('request_invoice')).toBe(false)
    expect(payoutActionNeedsInput('mark_paid')).toBe(false)
    expect(payoutActionNeedsInput('start_transfer')).toBe(true)
    expect(payoutActionNeedsInput('cancel')).toBe(true)
  })
})

describe('currentPayoutPeriod — luna în ora României', () => {
  it('PFU5: 00:30 EEST pe 1 octombrie (21:30Z pe 30 sept) e deja octombrie', () => {
    expect(currentPayoutPeriod(new Date('2026-09-30T21:30:00Z'))).toBe('2026-10-01')
  })
  it('PFU6: mijlocul lunii', () => {
    expect(currentPayoutPeriod(new Date('2026-03-15T12:00:00Z'))).toBe('2026-03-01')
  })
})

describe('formatIban / describePayoutRefusal', () => {
  it('PFU7: IBAN în grupe de 4', () => {
    expect(formatIban('RO49AAAA1B31007593840000')).toBe('RO49 AAAA 1B31 0075 9384 0000')
  })
  it('PFU8: mesajul românesc al serverului se păstrează; codurile tehnice se traduc', () => {
    expect(describePayoutRefusal({ reason: 'invalid_transition', error: 'Mesaj server' })).toBe('Mesaj server')
    expect(describePayoutRefusal({ reason: 'payout_exceeds_eligible', error: 'payout: gross 1 …' })).toMatch(/stornat/)
    expect(describePayoutRefusal({ reason: 'batch_in_progress' })).toMatch(/Alt batch/)
    expect(describePayoutRefusal({})).toMatch(/nu a putut/)
  })
})

describe('cancelNeedsMoneyReturnConfirm — anti plată dublă (mig 294, money_return_unconfirmed)', () => {
  it('PFU9: DOAR failed CU referință cere confirmarea întoarcerii banilor', () => {
    expect(cancelNeedsMoneyReturnConfirm('failed', true)).toBe(true)
    // Control: aceeași stare fără referință (nimic n-a plecat) și celelalte
    // stări anulabile nu trimit nimic în plus.
    expect(cancelNeedsMoneyReturnConfirm('failed', false)).toBe(false)
    expect(cancelNeedsMoneyReturnConfirm('draft', false)).toBe(false)
    expect(cancelNeedsMoneyReturnConfirm('awaiting_invoice', false)).toBe(false)
    expect(cancelNeedsMoneyReturnConfirm('invoice_matched', false)).toBe(false)
  })
  it('PFU10: refuzul serverului pe lipsa confirmării se explică (nu codul brut)', () => {
    expect(describePayoutRefusal({ reason: 'money_return_unconfirmed' })).toMatch(/extras/)
  })
})

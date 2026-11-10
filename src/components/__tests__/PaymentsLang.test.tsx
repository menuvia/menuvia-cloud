// Încasarea și reducerea în limba personalului (lotul L4b, partea a doua):
// PayModal (din WaiterOrderCard), DiscountModal și refuzul serverului la
// încasare (`describePayRejection`) citesc namespace-ul `payments` (+
// „Anulează” din `common`). Testele de bani ale PayModal (sursa unică
// `handed`, preflight-ul în cenți, „Trece X lei la bacșiș”) rămân în
// PayModal.test.tsx, NESCHIMBATE — aici e doar limba.
// (Prefixul LP: verificat cu grep în src/ și tests/, nefolosit înainte.)
//   LP0  control POZITIV al verificării „fără text românesc”: textul românesc
//        al modalului, comparat cu dicționarul englez, ARE resturi. Fără el,
//        LP2/LP3/LP4/LP6/LP7 ar trece și cu o verificare stricată.
//   LP1  PayModal fără provider (azi, mereu româna): textele de dinainte —
//        titlul, „Masă: 7”, metodele, „Bacșiș ” cu spațiul de dinainte urmat de
//        butoane, promoția „HH · 10%”, reducerea „Reducere (10%):” + „− 5.00
//        lei”, „Plătit parțial:”, „Rest de plată:”, nota de reducere blocată,
//        „— include bacșiș”, „Anulează”. Mutația care pică: o cheie `pay_*` cu
//        textul românesc schimbat (ex. „Reducere {value}%:” fără paranteze).
//   LP2  PayModal în engleză: titlul, metodele, bacșișul, preflight-ul SUB și
//        PESTE rest (fragmentele unice ale fiecărei ramuri), „Move 5.00 lei to
//        tip”, refuzul serverului afișat ca atare și textul de rezervă pe un
//        refuz fără mesaj — și NICIUN rest românesc. Mutația care pică: un
//        literal românesc lăsat în modal (ex. `'Fără'` la bacșiș, sau
//        `res.message || 'Plata nu a fost înregistrată…'` readus).
//   LP3  PayModal în germană, cu reducere procentuală și plăți parțiale:
//        „Rabatt (10 %):”, „Teilweise bezahlt:”, „Offener Betrag:”, nota
//        blocată, „Abbrechen” (common). Mutația care pică: eticheta reducerii
//        compusă în cod („Reducere” + procent).
//   LP4  PayModal în franceză: promoția Happy Hour (numele regulii e DATĂ,
//        neschimbat), butoanele de procent „5 %”, iar un rethrow cu text
//        englezesc de rol ajunge tradus prin `describeStaffError`. Mutația
//        care pică: `toUserMessage` readus în `.catch` (ar afișa româna).
//   LP5  DiscountModal fără provider: textele de dinainte, inclusiv
//        „(5.00 lei off)”, „Motiv: …”, „Se aplică...” cu trei puncte nu apare
//        (nu e în curs), iar un refuz cu hint `discount_over_payments` arată în
//        română MESAJUL SERVERULUI (comportamentul de dinainte — hint-urile NU
//        se aplică în română). Mutația care pică: hint-urile trecute și în
//        română (ar înlocui textul serverului).
//   LP6  DiscountModal în engleză: același refuz apare cu textul hint-ului,
//        iar mesajul ROMÂNESC al serverului NU ajunge pe ecran; fără resturi
//        românești. Mutația care pică: `toUserMessage(e, …)` readus.
//   LP7  DiscountModal în germană: comutarea pe sumă fixă schimbă eticheta și
//        placeholder-ul, previzualizarea („− 5.00 lei”, „Neuer Gesamtbetrag:”),
//        iar ștergerea refuzată pe plată online are textul german. Mutația care
//        pică: eticheta modului scrisă în cod.
//   LP8  `describePayRejection`: în română textele de dinainte (control, pe
//        fiecare ramură, cu mesajul serverului prioritar acolo unde era);
//        în en/fr/de hint-urile au textul limbii, mesajul ROMÂNESC al
//        serverului nu trece, rețeaua are textul ei, un hint necunoscut cade
//        pe textul generic. Mutația care pică: `serverMsg` fără condiția de
//        limbă, sau o ramură cu textul românesc scris în cod.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { applyMock, removeMock } = vi.hoisted(() => ({
  applyMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
  removeMock: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return { ...actual, applyOrderDiscount: applyMock, removeOrderDiscount: removeMock }
})

import { PayModal } from '../WaiterOrderCard'
import DiscountModal from '../DiscountModal'
import { describePayRejection, type Order } from '../../lib/orders'
import { makeOrder, makeOrderItem, makeTable } from './fixtures'
import { makeTranslator, preloadNamespace, type Dict } from '../../i18n/core'
import { paymentsNs } from '../../i18n/ns/payments'
import { commonNs } from '../../i18n/ns/common'
import paymentsRo from '../../i18n/ns/payments/ro'
import paymentsEn from '../../i18n/ns/payments/en'
import paymentsFr from '../../i18n/ns/payments/fr'
import paymentsDe from '../../i18n/ns/payments/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(paymentsNs, l), preloadNamespace(commonNs, l)]))
})

beforeEach(() => {
  vi.clearAllMocks()
  applyMock.mockResolvedValue(undefined)
  removeMock.mockResolvedValue(undefined)
})

function inLang(lang: StaffLang | null, node: ReactNode) {
  const tree = <Suspense fallback={null}>{node}</Suspense>
  return render(lang ? <UiLangScope lang={lang}>{tree}</UiLangScope> : tree)
}

/** Fragmentele românești ale namespace-ului `payments` rămase în text (fără
 *  cele identice în limba țintă: „Cash”, „Subtotal:”…). Un text cu locuri
 *  `{x}` se verifică pe bucățile lui fixe de cel puțin 6 caractere. */
function romanianLeftovers(text: string, target: Dict): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(paymentsRo as Dict)) {
    const own = typeof target[k] === 'string' ? (target[k] as string) : ''
    if (typeof v !== 'string') continue
    for (const piece of v.split(/\{\w+\}/)) {
      const p = piece.trim()
      if (p.length >= 6 && !own.includes(p) && text.includes(p)) out.push(`${k}: ${p}`)
    }
  }
  return out
}

const HH = { rule_name: 'Happy Hour Seara', computed_discount: 5, discount_type: 'percent' as const, discount_value: 10 }

function payModal(order: Order, extra: { alreadyPaid?: number; onConfirm?: (...a: unknown[]) => unknown } = {}) {
  return (
    <PayModal
      order={order}
      alreadyPaid={extra.alreadyPaid ?? 0}
      onConfirm={(extra.onConfirm ?? vi.fn().mockResolvedValue({ ok: true })) as never}
      onClose={vi.fn()}
      onDiscountClick={vi.fn()}
      happyHourSuggestion={HH}
      onApplyHappyHour={vi.fn()}
    />
  )
}

const PLAIN = () => makeOrder({ status: 'served', total: 100, table: makeTable({ name: '7' }) })
const DISCOUNTED = () =>
  makeOrder({
    status: 'served',
    total: 90,
    table: makeTable({ name: '7' }),
    discount_type: 'percent',
    discount_value: 10,
    discount_amount: 10,
  })

describe('PayModal în limba personalului', () => {
  it('LP0: control pozitiv — textul românesc are resturi față de engleză', () => {
    const { container } = inLang(null, payModal(PLAIN()))
    const left = romanianLeftovers(container.textContent ?? '', paymentsEn as Dict)
    expect(left.length).toBeGreaterThan(3)
    expect(left.some((l) => l.startsWith('pay_title:'))).toBe(true)
  })

  it('LP1: fără provider, româna de dinainte', async () => {
    const user = userEvent.setup()
    const a = inLang(null, payModal(PLAIN()))
    expect(screen.getByText('Înregistrează plată')).toBeInTheDocument()
    expect(screen.getByText('Masă: 7')).toBeInTheDocument()
    expect(screen.getByText('100.00 lei')).toBeInTheDocument()
    for (const m of ['Cash', 'Card POS', 'Tichete de masă', 'Altă metodă', 'Fără', '5%', '10%', '15%', 'Sumă'])
      expect(screen.getByRole('button', { name: m })).toBeInTheDocument()
    // „Bacșiș ” are spațiul de dinainte, urmat direct de butoane (textContent).
    expect(a.container.textContent).toContain('Bacșiș Fără5%10%15%Sumă')
    expect(screen.getByText('Promoție activă!')).toBeInTheDocument()
    expect(screen.getByText('Happy Hour Seara · 10%')).toBeInTheDocument()
    expect(screen.getByText('−5.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplică promoția' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplică reducere' })).toBeInTheDocument()
    expect(screen.getByText('Sumă încasată (lei)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmă plata' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anulează' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '10%' }))
    expect(a.container.textContent).toContain('Bacșiș (10.00 lei)')
    expect(screen.getByText('— include bacșiș')).toBeInTheDocument()
    a.unmount()

    inLang(null, payModal(DISCOUNTED(), { alreadyPaid: 40 }))
    expect(screen.getByText('Subtotal:')).toBeInTheDocument()
    expect(screen.getByText('Reducere (10%):')).toBeInTheDocument()
    expect(screen.getByText('− 10.00 lei')).toBeInTheDocument()
    expect(screen.getByText('Total de plată:')).toBeInTheDocument()
    expect(screen.getByText('Plătit parțial:')).toBeInTheDocument()
    expect(screen.getByText('− 40.00 lei')).toBeInTheDocument()
    expect(screen.getByText('Rest de plată:')).toBeInTheDocument()
    expect(screen.getByText('50.00 lei')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(
      'Reducerea nu se mai poate modifica: comanda are deja plăți înregistrate.',
    )
  })

  it('LP2: în engleză — preflight-ul, mutarea în bacșiș, refuzul serverului, fără resturi românești', async () => {
    const user = userEvent.setup()
    const onConfirm = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: 'Server says no' })
      .mockResolvedValueOnce({ ok: false })
    const { container } = inLang('en', payModal(PLAIN(), { onConfirm }))
    expect(screen.getByText('Record payment')).toBeInTheDocument()
    expect(screen.getByText('Table: 7')).toBeInTheDocument()
    for (const m of ['Cash', 'Card (POS)', 'Meal vouchers', 'Other', 'None', '5%', 'Amount'])
      expect(screen.getByRole('button', { name: m })).toBeInTheDocument()
    expect(container.textContent).toContain('Tip None')
    expect(screen.getByText('Promotion active!')).toBeInTheDocument()
    expect(screen.getByText('Amount received (lei)')).toBeInTheDocument()

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '50')
    expect(screen.getByRole('status')).toHaveTextContent(
      'The amount received without tip (50.00) is less than what’s left to pay (100.00).',
    )
    await user.clear(input)
    await user.type(input, '105')
    expect(screen.getByRole('status')).toHaveTextContent('the system will reject the payment')
    expect(container.textContent ?? '').not.toMatch(/[ăâîșțĂÂÎȘȚ]/)
    expect(romanianLeftovers(container.textContent ?? '', paymentsEn as Dict)).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Move 5.00 lei to tip' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.textContent).toContain('Tip (5.00 lei)')
    expect(screen.getByText('— includes tip')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm payment' }))
    expect(onConfirm).toHaveBeenCalledWith('cash', 105, 5)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server says no')
    await user.click(screen.getByRole('button', { name: 'Confirm payment' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('The payment wasn’t recorded. Check and try again.'),
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(romanianLeftovers(container.textContent ?? '', paymentsEn as Dict)).toEqual([])
  })

  it('LP3: în germană, cu reducere procentuală și plăți parțiale', () => {
    const { container } = inLang('de', payModal(DISCOUNTED(), { alreadyPaid: 40 }))
    expect(screen.getByText('Zahlung erfassen')).toBeInTheDocument()
    expect(screen.getByText('Tisch: 7')).toBeInTheDocument()
    expect(screen.getByText('Zwischensumme:')).toBeInTheDocument()
    expect(screen.getByText('Rabatt (10 %):')).toBeInTheDocument()
    expect(screen.getByText('Zu zahlen:')).toBeInTheDocument()
    expect(screen.getByText('Teilweise bezahlt:')).toBeInTheDocument()
    expect(screen.getByText('Offener Betrag:')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Der Rabatt kann nicht mehr geändert werden')
    for (const m of ['Bar', 'Karte (Terminal)', 'Gutscheine', 'Andere', 'Ohne', 'Betrag'])
      expect(screen.getByRole('button', { name: m })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zahlung bestätigen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(/[ăâîșțĂÂÎȘȚ]/)
    expect(romanianLeftovers(container.textContent ?? '', paymentsDe as Dict)).toEqual([])
  })

  it('LP4: în franceză — promoția (numele regulii e dată), procentele, rethrow-ul de rol tradus', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValue(new Error('Role waiter cannot mark orders paid'))
    const { container } = inLang('fr', payModal(PLAIN(), { onConfirm }))
    expect(screen.getByText('Enregistrer le paiement')).toBeInTheDocument()
    expect(screen.getByText('Promotion en cours !')).toBeInTheDocument()
    expect(screen.getByText('Happy Hour Seara · 10 %')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Appliquer la promotion' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Appliquer une remise' })).toBeInTheDocument()
    for (const m of ['Espèces', 'Carte (TPE)', 'Titres-restaurant', 'Aucun', '5 %', '10 %', '15 %', 'Montant'])
      expect(screen.getByRole('button', { name: m })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmer le paiement' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Vous n’avez pas les droits pour cette action.')
    expect(alert).not.toHaveTextContent(/waiter cannot|drepturi/)
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument()
    expect(romanianLeftovers(container.textContent ?? '', paymentsFr as Dict)).toEqual([])
  })
})

const SERVER_RO =
  'Comanda are plăți înregistrate (40 lei) — reducerea nu se mai poate modifica; stornează plățile sau finalizează comanda'
function overPaymentsError(): Error & { hint: string } {
  return Object.assign(new Error(SERVER_RO), { hint: 'discount_over_payments' })
}

const WITH_DISCOUNT = () =>
  makeOrder({
    status: 'served',
    total: 45,
    order_items: [makeOrderItem({ item_total: 50 })],
    discount_type: 'percent',
    discount_value: 10,
    discount_amount: 5,
    discount_reason: 'client fidel',
  })

function discountModal(order: Order) {
  return <DiscountModal order={order} onClose={vi.fn()} onApplied={vi.fn()} />
}

describe('DiscountModal în limba personalului', () => {
  it('LP5: fără provider, româna de dinainte; refuzul serverului arătat ca atare', async () => {
    const user = userEvent.setup()
    applyMock.mockRejectedValue(overPaymentsError())
    const { container } = inLang(null, discountModal(WITH_DISCOUNT()))
    expect(screen.getByText('🎁 Reducere pe comandă')).toBeInTheDocument()
    expect(screen.getByText('Reducere activă:').parentElement).toHaveTextContent(
      'Reducere activă: 10% (5.00 lei off)',
    )
    expect(screen.getByText('Motiv: client fidel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Procent (%)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sumă fixă (lei)' })).toBeInTheDocument()
    expect(screen.getByText('Procent (1-100)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('ex: 10')).toBeInTheDocument()
    expect(screen.getByText('Motiv (opțional)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('ex: client fidel, problemă cu mâncarea, happy hour')).toBeInTheDocument()
    expect(container.textContent).toContain('Subtotal:50.00 lei')
    expect(container.textContent).toContain('Reducere:− 5.00 lei')
    expect(container.textContent).toContain('Total nou:45.00 lei')
    expect(screen.getByRole('button', { name: '🗑 Șterge reducerea actuală' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anulează' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Modifică' }))
    expect(await screen.findByText(SERVER_RO)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sumă fixă (lei)' }))
    expect(screen.getByText('Sumă în lei')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('ex: 5.00')).toBeInTheDocument()
  })

  it('LP6: în engleză — hint-ul tradus, mesajul românesc al serverului NU apare', async () => {
    const user = userEvent.setup()
    applyMock.mockRejectedValue(overPaymentsError())
    const { container } = inLang('en', discountModal(WITH_DISCOUNT()))
    expect(screen.getByText('🎁 Order discount')).toBeInTheDocument()
    expect(screen.getByText('Active discount:').parentElement).toHaveTextContent(
      'Active discount: 10% (5.00 lei off)',
    )
    expect(screen.getByText('Reason: client fidel')).toBeInTheDocument()
    expect(screen.getByText('Percent (1–100)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. 10')).toBeInTheDocument()
    expect(container.textContent).toContain('New total:45.00 lei')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(
      await screen.findByText('The order already has payments recorded — the discount can no longer be changed.'),
    ).toBeInTheDocument()
    expect(container.textContent).not.toContain('Comanda are plăți')
    // „client fidel” e motivul scris în DB (dată), nu text de ecran.
    const text = (container.textContent ?? '').replace('client fidel', '')
    expect(text).not.toMatch(/[ăâîșțĂÂÎȘȚ]/)
    expect(romanianLeftovers(text, paymentsEn as Dict)).toEqual([])
  })

  it('LP7: în germană — modul sumă fixă, previzualizarea, refuzul pe plată online', async () => {
    const user = userEvent.setup()
    removeMock.mockRejectedValue(
      Object.assign(new Error('Comanda are o plată online în curs'), { hint: 'discount_online_payment' }),
    )
    const order = makeOrder({ status: 'served', total: 50, order_items: [makeOrderItem({ item_total: 50 })] })
    const { container, unmount } = inLang('de', discountModal(order))
    expect(screen.getByText('🎁 Rabatt auf die Bestellung')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Fester Betrag (lei)' }))
    expect(screen.getByText('Betrag in lei')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('z. B. 5.00'), '5')
    expect(container.textContent).toContain('Rabatt:− 5.00 lei')
    expect(container.textContent).toContain('Neuer Gesamtbetrag:45.00 lei')
    expect(screen.getByRole('button', { name: 'Anwenden' })).toBeEnabled()
    expect(romanianLeftovers(container.textContent ?? '', paymentsDe as Dict)).toEqual([])
    unmount()

    inLang('de', discountModal(WITH_DISCOUNT()))
    await user.click(screen.getByRole('button', { name: '🗑 Aktuellen Rabatt entfernen' }))
    expect(
      await screen.findByText(
        'Für die Bestellung läuft eine Online-Zahlung — der Rabatt kann erst nach deren Abschluss geändert werden.',
      ),
    ).toBeInTheDocument()
  })
})

describe('describePayRejection în limba personalului', () => {
  const err = (hint: string | undefined, msg: string) => Object.assign(new Error(msg), hint ? { hint } : {})
  const SERVER = 'Suma încasată (50.00 fără bacșiș) e sub restul de plată (100.00)'

  it('LP8: română (control) și en/fr/de', () => {
    const ro = makeTranslator(paymentsRo, 'ro')
    // Româna: textele de dinainte, mesajul serverului prioritar unde era.
    expect(describePayRejection(err('underpayment', SERVER), ro)).toBe(SERVER)
    expect(describePayRejection(err('overpayment', ''), ro)).toBe(
      'Suma nu corespunde restului de plată. Verifică suma (fără bacșiș) și reîncearcă.',
    )
    expect(describePayRejection(err('paid_amount_required', 'x'), ro)).toBe('Introdu suma încasată.')
    expect(describePayRejection(err('invalid_payment_method', 'x'), ro)).toBe(
      'Metoda de plată nu poate fi înregistrată manual (plățile online vin din Stripe).',
    )
    expect(describePayRejection(err('fiscal_plan_requires_payment', 'x'), ro)).toBe(
      'Pe planul cu fiscalizare comanda se finalizează prin plată (bon fiscal).',
    )
    expect(describePayRejection(err('role_insufficient', 'x'), ro)).toBe('Rolul tău nu permite înregistrarea plăților.')
    expect(describePayRejection(err('order_terminal', 'x'), ro)).toBe('Comanda e deja finalizată.')
    expect(describePayRejection(err(undefined, 'boom'), ro)).toBe('Plata nu a fost înregistrată: boom')
    expect(describePayRejection(null, ro)).toBe('Plata nu a fost înregistrată. Verifică și reîncearcă.')

    const en = makeTranslator<typeof paymentsRo>(paymentsEn, 'en')
    expect(describePayRejection(err('underpayment', SERVER), en)).toBe(
      'The amount doesn’t match what’s left to pay. Check the amount (without tip) and try again.',
    )
    expect(describePayRejection(err(undefined, 'eroare românească'), en)).toBe(
      'The payment wasn’t recorded. Check and try again.',
    )
    expect(describePayRejection(new TypeError('Failed to fetch'), en)).toBe(
      'No connection — the payment wasn’t sent. Try again.',
    )

    const fr = makeTranslator<typeof paymentsRo>(paymentsFr, 'fr')
    expect(describePayRejection(err('overpayment', SERVER), fr)).toBe(
      'Le montant ne correspond pas au reste à payer. Vérifiez le montant (sans pourboire) et réessayez.',
    )
    expect(describePayRejection(err('role_insufficient', 'x'), fr)).toBe(
      'Votre rôle ne permet pas d’enregistrer des paiements.',
    )

    const de = makeTranslator<typeof paymentsRo>(paymentsDe, 'de')
    expect(describePayRejection(err('fiscal_plan_requires_payment', 'x'), de)).toBe(
      'Im Tarif mit Fiskalisierung wird die Bestellung mit einer Zahlung abgeschlossen (Fiskalbeleg).',
    )
    expect(describePayRejection(err('neu_unbekannt', SERVER), de)).toBe(
      'Die Zahlung wurde nicht erfasst. Bitte prüfen und erneut versuchen.',
    )
    for (const tr of [en, fr, de])
      for (const h of ['underpayment', 'overpayment', undefined, 'xyz'])
        expect(describePayRejection(err(h, SERVER), tr)).not.toContain('fără bacșiș')
  })
})

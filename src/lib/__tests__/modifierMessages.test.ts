// Fila Meniu → Opțiuni în limba personalului (lotul L5b) — partea PURĂ:
// refuzurile serverului (`describeModifierError`). Randarea e în
// src/components/__tests__/ModifiersLang.test.tsx (MG0–MG6).
//   MG7  în română EGAL cu `toUserMessage(err, fallback)` de dinainte pe toate
//        formele de eroare — inclusiv mesajul românesc al serverului CU hint
//        (`group_not_found`, mig 319) și eroarea aruncată de
//        lib/modifierLinks.ts cu rezerva ei românească: hint-urile NU se aplică
//        în română. Mutația care pică: hint-urile trecute și în română.
//   MG8  în en/fr/de: hint-ul are textul limbii, mesajul ROMÂNESC al
//        serverului NU trece (cade pe rezerva contextului sau pe
//        `err_generic`), rețeaua și drepturile au textul din `common`.
//        Mutația care pică: `toUserMessage` readus în loc de
//        `describeStaffError`, sau un hint scos din `modifierErrorHints`.
//   MG9  cele trei hint-uri au text în fiecare limbă, diferit de română.
import { describe, it, expect } from 'vitest'
import { describeModifierError, modifierErrorHints } from '../modifierMessages'
import { toUserMessage } from '../userMessages'
import { makeTranslator } from '../../i18n/core'
import modifiersRo from '../../i18n/ns/modifiers/ro'
import modifiersEn from '../../i18n/ns/modifiers/en'
import modifiersFr from '../../i18n/ns/modifiers/fr'
import modifiersDe from '../../i18n/ns/modifiers/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'

const ro = makeTranslator(modifiersRo, 'ro')
const roC = makeTranslator(commonRo, 'ro')
const LANGS = [
  { lang: 'en', m: makeTranslator(modifiersEn, 'en'), c: makeTranslator(commonEn, 'en'), mDict: modifiersEn, cDict: commonEn },
  { lang: 'fr', m: makeTranslator(modifiersFr, 'fr'), c: makeTranslator(commonFr, 'fr'), mDict: modifiersFr, cDict: commonFr },
  { lang: 'de', m: makeTranslator(modifiersDe, 'de'), c: makeTranslator(commonDe, 'de'), mDict: modifiersDe, cDict: commonDe },
] as const

const GROUP_GONE = Object.assign(new Error('Grupul nu există'), { code: 'P0002', hint: 'group_not_found' })
const DUPLICATE = { message: 'Produs duplicat în listă', code: '22023', hint: 'duplicate_products' }
const PRODUCT_GONE = { message: 'Produs lipsă', code: '22023', hint: 'product_not_found' }
// Rezerva aruncată de lib/modifierLinks.ts (`toError`) când serverul nu dă mesaj.
const LINKS_FALLBACK = Object.assign(new Error('Nu am putut salva produsele grupului.'), { code: 'XX000' })
const PLAIN_RO = { message: 'Opțiunea nu poate fi salvată acum.', code: 'P0001' }
const NETWORK = new TypeError('Failed to fetch')
const DENIED = { message: 'permission denied for table modifier_options', code: '42501' }
const ALL = [GROUP_GONE, DUPLICATE, PRODUCT_GONE, LINKS_FALLBACK, PLAIN_RO, NETWORK, DENIED]

describe('refuzurile filei Opțiuni', () => {
  it('MG7 în română: exact toUserMessage de dinainte', () => {
    const fallback = ro.t('err_pickSave')
    for (const err of ALL) {
      expect(describeModifierError(err, ro, roC, fallback)).toBe(toUserMessage(err, fallback))
      expect(describeModifierError(err, ro, roC)).toBe(toUserMessage(err))
    }
    // Mesajul românesc al serverului rămâne pe ecran, chiar cu hint.
    expect(describeModifierError(GROUP_GONE, ro, roC, fallback)).not.toBe(ro.t('hint_groupNotFound'))
  })

  it('MG8 în en/fr/de: hint-ul tradus, niciun mesaj românesc', () => {
    for (const { m, c, mDict, cDict } of LANGS) {
      const fallback = m.t('err_pickSave')
      expect(describeModifierError(GROUP_GONE, m, c, fallback)).toBe(mDict.hint_groupNotFound)
      expect(describeModifierError(DUPLICATE, m, c, fallback)).toBe(mDict.hint_duplicateProducts)
      expect(describeModifierError(PRODUCT_GONE, m, c, fallback)).toBe(mDict.hint_productNotFound)
      expect(describeModifierError(LINKS_FALLBACK, m, c, fallback)).toBe(fallback)
      expect(describeModifierError(PLAIN_RO, m, c, fallback)).toBe(fallback)
      expect(describeModifierError(PLAIN_RO, m, c)).toBe(cDict.err_generic)
      expect(describeModifierError(NETWORK, m, c, fallback)).toBe(cDict.err_network)
      expect(describeModifierError(DENIED, m, c, fallback)).toBe(cDict.err_permission)
      for (const err of ALL) {
        const out = describeModifierError(err, m, c, fallback)
        // „î”/„â” există și în franceză („apparaît”) — doar ă/ș/ț sunt românești.
        expect(out).not.toMatch(/[ășțȘȚ]|Grupul|Produs |Opțiunea|Nu am/)
      }
    }
  })

  it('MG9 fiecare hint are text în fiecare limbă, diferit de română', () => {
    const roHints = modifierErrorHints(ro)
    expect(Object.keys(roHints).sort()).toEqual(['duplicate_products', 'group_not_found', 'product_not_found'])
    for (const { m } of LANGS) {
      const hints = modifierErrorHints(m)
      for (const [hint, text] of Object.entries(hints)) {
        expect(text.length).toBeGreaterThan(10)
        expect(text).not.toBe(roHints[hint])
      }
    }
  })
})

// ─────────────────────────────────────────────────────────────
// phone — telefonul OASPETELUI în E.164 (PH-4).
// ─────────────────────────────────────────────────────────────
// `fn_sms_normalize_ro_phone` (mig 228) face din ORICE „07” + 8 cifre un
// `+407…`, iar mobilele naționale din SE/CH/FR (seria 07)/KE au exact forma
// asta: turistul care își scria numărul în format național primea confirmarea,
// reminderul sau „comanda e gata” pe telefonul unui STRĂIN din România. Cifrele
// sunt identice, deci serverul nu le poate deosebi — corectura e la INPUT.
//
// Prefixul e VIZIBIL, implicit +40 (toate restaurantele sunt azi în RO, iar
// `restaurants` n-are coloană de țară). Implicitul NU se deduce din
// `navigator.language` (românii cu browserul în en-US ar primi +1 — bug-ul
// invers, mai frecvent) și nici din `lang` (pe /rezervare, `lang` VINE din
// navigator.language).

export interface CallingCode {
  label: string
  cc: string
  /** Prefixul național („trunk”) care se scoate după codul țării. */
  trunk: string
}

// Tipat `string`, NU literal: altfel useState(DEFAULT) inferă '40' și
// setCc(e.target.value) pică TS2345 (capcana `as const` din CLAUDE.md).
export const DEFAULT_CALLING_CODE: string = '40'
// Opțiunea liberă „+…”: cifrele tastate SUNT numărul internațional.
export const FREE_CALLING_CODE: string = ''

// Ordinea din select: RO, MD, UE alfabetic, UK, CH, NO, US/CA. Codurile E.164
// sunt prefix-free (PH13 ține asta). Trunchiul '0' la țările fără trunchi e
// inofensiv (niciun număr național de acolo nu începe cu 0). IT își PĂSTREAZĂ
// 0-ul (fixele 06…), HU are trunchiul 06, NANP are 1.
export const CALLING_CODES: readonly CallingCode[] = [
  { label: 'RO', cc: '40', trunk: '0' },
  { label: 'MD', cc: '373', trunk: '0' },
  { label: 'AT', cc: '43', trunk: '0' },
  { label: 'BE', cc: '32', trunk: '0' },
  { label: 'BG', cc: '359', trunk: '0' },
  { label: 'CY', cc: '357', trunk: '0' },
  { label: 'CZ', cc: '420', trunk: '0' },
  { label: 'DE', cc: '49', trunk: '0' },
  { label: 'DK', cc: '45', trunk: '0' },
  { label: 'EE', cc: '372', trunk: '0' },
  { label: 'ES', cc: '34', trunk: '0' },
  { label: 'FI', cc: '358', trunk: '0' },
  { label: 'FR', cc: '33', trunk: '0' },
  { label: 'GR', cc: '30', trunk: '0' },
  { label: 'HR', cc: '385', trunk: '0' },
  { label: 'HU', cc: '36', trunk: '06' },
  { label: 'IE', cc: '353', trunk: '0' },
  { label: 'IT', cc: '39', trunk: '' },
  { label: 'LT', cc: '370', trunk: '0' },
  { label: 'LU', cc: '352', trunk: '0' },
  { label: 'LV', cc: '371', trunk: '0' },
  { label: 'MT', cc: '356', trunk: '0' },
  { label: 'NL', cc: '31', trunk: '0' },
  { label: 'PL', cc: '48', trunk: '0' },
  { label: 'PT', cc: '351', trunk: '0' },
  { label: 'SE', cc: '46', trunk: '0' },
  { label: 'SI', cc: '386', trunk: '0' },
  { label: 'SK', cc: '421', trunk: '0' },
  { label: 'UK', cc: '44', trunk: '0' },
  { label: 'CH', cc: '41', trunk: '0' },
  { label: 'NO', cc: '47', trunk: '0' },
  { label: 'US/CA', cc: '1', trunk: '1' },
]

export function isInternationalInput(raw: string): boolean {
  const t = raw.trim()
  return t.startsWith('+') || t.replace(/\D/g, '').startsWith('00')
}

// „+40 0722…”, „+44 (0)7700…”: trunchiul rătăcit după prefix se scoate
// (codul se identifică pe tabela prefix-free).
function dropTrunk(intl: string): string {
  const code = CALLING_CODES.find((c) => intl.startsWith(c.cc))
  if (!code || code.trunk === '') return intl
  const rest = intl.slice(code.cc.length)
  return rest.startsWith(code.trunk) ? code.cc + rest.slice(code.trunk.length) : intl
}

/** `+CC…` sau null dacă inputul nu poate fi un număr valid. */
export function toE164(cc: string, raw: string): string | null {
  const text = raw.trim().replace(/\(\s*0\s*\)/g, '')
  const digits = text.replace(/\D/g, '')
  if (digits === '') return null
  let intl: string
  if (text.startsWith('+')) {
    intl = digits // deja internațional: selectul se IGNORĂ
  } else if (digits.startsWith('00')) {
    intl = digits.slice(2) // idem, forma cu 00
  } else if (cc === FREE_CALLING_CODE) {
    intl = digits // „+…” ales: fără prefix NU se ghicește +40
  } else if (!CALLING_CODES.some((c) => c.cc === cc)) {
    return null
  } else if (cc === '40' && /^40[2-9]\d{8}$/.test(digits)) {
    intl = digits // „40722…” fără +: paritate cu mig 228 / 226
  } else {
    intl = cc + digits
  }
  intl = dropTrunk(intl)
  // 8–15 cifre (E.164 max 15; paritate cu fn_loyalty_phone_hash).
  return /^[1-9]\d{7,14}$/.test(intl) ? '+' + intl : null
}

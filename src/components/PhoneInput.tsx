// PhoneInput — telefonul OASPETELUI cu prefixul de țară VIZIBIL (PH-4).
// Componentă controlată, fără stare proprie: părintele convertește cu
// `toE164` la trimitere. Implicitul NU vine din navigator.language / lang
// (motivul e în lib/phone.ts). Se importă DOAR din chunk-uri lazy
// (ReservationSheet / PickupCheckoutSheet), ca publicMenuStrings să rămână în
// afara chunk-ului de intrare.
import { useId } from 'react'
import type { CSSProperties } from 'react'
import { T } from '../lib/publicMenuStrings'
import { CALLING_CODES, FREE_CALLING_CODE, isInternationalInput } from '../lib/phone'

export interface PhoneInputProps {
  cc: string
  national: string
  onCcChange: (cc: string) => void
  onNationalChange: (value: string) => void
  lang: string
  placeholder: string
  /** Stilul câmpurilor formularului-gazdă, aplicat și selectului. */
  inputStyle: CSSProperties
  hintColor: string
}

export default function PhoneInput({
  cc,
  national,
  onCcChange,
  onNationalChange,
  lang,
  placeholder,
  inputStyle,
  hintColor,
}: PhoneInputProps) {
  const hintId = useId()
  // Un număr tastat cu „+”/„00” e deja internațional, iar toE164 IGNORĂ
  // selectul — îl arătăm dezactivat, altfel un „+40” vizibil ar minți.
  const typedIntl = isInternationalInput(national)
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          value={cc}
          onChange={(e) => onCcChange(e.target.value)}
          disabled={typedIntl}
          aria-label={T(lang, 'phone_cc_aria')}
          style={{
            ...inputStyle,
            width: 'auto',
            flex: '0 0 auto',
            margin: 0,
            paddingRight: 8,
            opacity: typedIntl ? 0.5 : 1,
          }}
        >
          {CALLING_CODES.map((c) => (
            <option key={c.cc} value={c.cc}>
              {c.label} +{c.cc}
            </option>
          ))}
          <option value={FREE_CALLING_CODE}>{T(lang, 'phone_cc_other')}</option>
        </select>
        <input
          value={national}
          onChange={(e) => onNationalChange(e.target.value)}
          placeholder={placeholder}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          aria-describedby={hintId}
          style={{ ...inputStyle, width: 'auto', flex: 1, minWidth: 0, margin: 0 }}
        />
      </div>
      <div id={hintId} style={{ fontSize: 11, color: hintColor, marginTop: 5, lineHeight: 1.45 }}>
        {T(lang, 'phone_cc_hint')}
      </div>
    </div>
  )
}

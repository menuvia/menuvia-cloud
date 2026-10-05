// PickupCheckoutSheet — extras din PublicMenuPage pentru code-splitting.
// Lazy-loaded: apare doar când utilizatorul deschide checkout-ul de pickup.
import { useState, useMemo, useRef, useEffect } from 'react'
import { FocusTrap } from './ui/FocusTrap'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { createOrder, getPickupIdempotencyKey, rotatePickupIdempotencyKey } from '../lib/orders'
import { buildPickupSlots } from '../lib/pickupSlots'
import type { CartItem } from '../lib/orders'
import { fmtPrice, type MenuCurrency } from '../lib/currency'
import type { Restaurant } from '../lib/qr'
import type { MenuTheme } from '../lib/themes'
import PhoneInput from './PhoneInput'
import { DEFAULT_CALLING_CODE, toE164 } from '../lib/phone'
import { T } from '../lib/publicMenuStrings'
import { describeGuestError } from '../lib/guestErrors'

interface PUBColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

export interface PickupCheckoutProps {
  restaurant: Restaurant
  cart: CartItem[]
  cartTotal: number
  theme: MenuTheme
  accent: string
  PUB: PUBColors
  onClose: () => void
  onSuccess: (short_id: string, pickup_time: string | null, total: number) => void
  // Moneda meniului (mig 205) — default RON, ca la call-site-urile istorice.
  currency?: MenuCurrency
  // Limba aleasă de oaspete — toate textele sheet-ului. NU decide prefixul
  // implicit al telefonului (PH-4, lib/phone.ts).
  lang?: string
}

export default function PickupCheckoutSheet({
  restaurant,
  cart,
  cartTotal,
  theme,
  accent,
  PUB,
  onClose,
  onSuccess,
  currency = 'RON',
  lang = 'ro',
}: PickupCheckoutProps) {
  useBodyScrollLock(true)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  // PH-4: prefixul VIZIBIL, implicit +40. `<string>` explicit (capcana `as const`).
  const [phoneCc, setPhoneCc] = useState<string>(DEFAULT_CALLING_CODE)
  const [pickupTime, setPickupTime] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Cheie de idempotență PERSISTATĂ (sessionStorage per restaurant): retry-urile
  // după un răspuns pierdut refolosesc aceeași cheie chiar dacă sheet-ul a fost
  // închis/redeschis sau pagina reîncărcată → serverul dedup-uiește, fără comenzi
  // duplicate (audit v3 FC-01 — înainte cheia murea cu sheet-ul).
  const idemScope = String(restaurant.slug ?? restaurant.id ?? 'pickup')
  const idempotencyKeyRef = useRef<string>(getPickupIdempotencyKey(idemScope))

  // Semantică de dialog modal (paritate cu QrCartSheet/ProductSheet): Escape
  // închide, focusul intră în panou la deschidere și se restaurează la închidere.
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      prev?.focus()
    }
  }, [])

  // Helper pur (lib/pickupSlots) — suportă și programul peste miezul nopții
  // (ex. food truck 18:00–02:00), cu aceeași doctrină ca rezervările (mig 201).
  const slots = useMemo(
    () => buildPickupSlots(restaurant.pickup_settings),
    [restaurant.pickup_settings],
  )

  async function submitOrder() {
    if (slots.length === 0) {
      setError(T(lang, 'pk_closed_now'))
      return
    }
    if (name.trim().length === 0) {
      setError(T(lang, 'err_name_required'))
      return
    }
    // Telefonul e OBLIGATORIU pentru pickup: create_order respinge comenzile
    // pickup fără telefon valid (is_valid_phone, mig 046/191). PH-4: îl trimitem
    // în E.164, cu prefixul VIZIBIL ales — forma națională a unui număr străin
    // ar fi primit „comanda e gata” pe telefonul unui străin din România (mig 228).
    const phoneE164 = toE164(phoneCc, phone)
    if (!phoneE164) {
      setError(T(lang, 'phone_invalid'))
      return
    }
    if (!pickupTime) {
      setError(T(lang, 'err_pickup_time_missing'))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const result = await createOrder({
        restaurant_id: restaurant.id,
        source: 'pickup',
        table_id: null,
        qr_token_id: null,
        notes: null,
        cart,
        idempotency_key: idempotencyKeyRef.current,
        pickup_time: pickupTime || null,
        customer_name: name.trim(),
        customer_phone: phoneE164,
      })
      // Rotește cheia înainte de a propaga succesul: dacă părintele lasă
      // sheet-ul montat și user-ul mai trimite o comandă, a doua nu va fi
      // dedup-uită silențios de server pe aceeași idempotency_key.
      idempotencyKeyRef.current = rotatePickupIdempotencyKey(idemScope)
      onSuccess(result.short_id, pickupTime || null, result.total)
    } catch (err) {
      console.error('[PickupCheckout] error:', err)
      // Hint-urile din create_order (mig 191) + mesajele brute → text în limba
      // oaspetelui (lib/guestErrors); niciodată textul serverului.
      setError(
        describeGuestError(lang, err, {
          fallback: 'err_order_not_sent',
          network: 'err_order_not_sent_network',
        }),
      )
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,18,8,0.55)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 150,
      }}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={T(lang, 'pk_title')}
        tabIndex={-1}
        style={{
          background: PUB.bg,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        <FocusTrap />
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: PUB.borderStrong,
            margin: '10px auto 0',
          }}
        />
        <div style={{ padding: '20px 22px 14px', flex: 1, overflowY: 'auto' }}>
          <div
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 22,
              fontWeight: 600,
              color: PUB.text,
              marginBottom: 6,
              letterSpacing: '-0.01em',
            }}
          >
            {T(lang, 'pk_title')}
          </div>
          <div style={{ fontSize: 13, color: PUB.text2, marginBottom: 20 }}>
            {T(lang, 'pk_pay_note')}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: PUB.text2,
                marginBottom: 6,
              }}
            >
              {T(lang, 'pk_name')} *
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={T(lang, 'pk_name_ph')}
              style={{
                width: '100%',
                padding: '12px 14px',
                border: `1.5px solid ${PUB.border}`,
                borderRadius: 10,
                fontSize: 14,
                fontFamily: theme.fonts.body,
                background: PUB.surface,
                color: PUB.text,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: PUB.text2,
                marginBottom: 6,
              }}
            >
              {T(lang, 'reserve_phone')}
            </label>
            <PhoneInput
              cc={phoneCc}
              national={phone}
              onCcChange={setPhoneCc}
              onNationalChange={setPhone}
              lang={lang}
              placeholder="07XX XXX XXX"
              inputStyle={{
                padding: '12px 14px',
                border: `1.5px solid ${PUB.border}`,
                borderRadius: 10,
                fontSize: 14,
                fontFamily: theme.fonts.body,
                background: PUB.surface,
                color: PUB.text,
                outline: 'none',
                boxSizing: 'border-box',
              }}
              hintColor={PUB.text3}
            />
            <div style={{ fontSize: 11, color: PUB.text3, marginTop: 5 }}>
              {T(lang, 'pk_phone_hint')}
            </div>
          </div>

          {slots.length > 0 ? (
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: PUB.text2,
                  marginBottom: 8,
                }}
              >
                {T(lang, 'pk_come_at')} *
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                  gap: 8,
                }}
              >
                {slots.map((iso) => {
                  const t = new Date(iso)
                  const label = t.toLocaleTimeString('ro-RO', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  const isSel = pickupTime === iso
                  return (
                    <button
                      key={iso}
                      onClick={() => setPickupTime(iso)}
                      style={{
                        padding: '10px 6px',
                        border: `1.5px solid ${isSel ? accent : PUB.border}`,
                        background: isSel ? `${accent}14` : PUB.surface,
                        color: isSel ? accent : PUB.text,
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: isSel ? 700 : 500,
                        cursor: 'pointer',
                        fontFamily: theme.fonts.body,
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: '12px 14px',
                background: PUB.surface,
                border: `1px solid ${PUB.border}`,
                borderRadius: 10,
                fontSize: 13,
                color: PUB.text2,
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              ⚠️ {T(lang, 'pk_closed_banner')}
            </div>
          )}

          {restaurant.pickup_settings?.instructions && (
            <div
              style={{
                padding: '12px 14px',
                background: PUB.surface,
                border: `1px solid ${PUB.border}`,
                borderRadius: 10,
                fontSize: 12,
                color: PUB.text2,
                marginBottom: 16,
                lineHeight: 1.55,
              }}
            >
              ℹ️ {restaurant.pickup_settings.instructions}
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '10px 14px',
                background: '#FBE5E5',
                border: '1px solid #C0392B22',
                borderRadius: 8,
                fontSize: 13,
                color: '#C0392B',
                marginBottom: 14,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '14px 22px 22px',
            borderTop: `1px solid ${PUB.border}`,
            background: PUB.bg,
          }}
        >
          <button
            disabled={submitting || (slots.length > 0 && !pickupTime)}
            onClick={() => void submitOrder()}
            style={{
              width: '100%',
              padding: '15px',
              background:
                submitting || (slots.length > 0 && !pickupTime) ? PUB.borderStrong : accent,
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontFamily: theme.fonts.body,
              fontSize: 15,
              fontWeight: 700,
              cursor: submitting || (slots.length > 0 && !pickupTime) ? 'not-allowed' : 'pointer',
              boxShadow: submitting ? 'none' : `0 4px 14px ${accent}55`,
            }}
          >
            {submitting
              ? T(lang, 'sending')
              : `${T(lang, 'qc_send_order')} · ${fmtPrice(cartTotal, currency)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

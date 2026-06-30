// PickupCheckoutSheet — extras din PublicMenuPage pentru code-splitting.
// Lazy-loaded: apare doar când utilizatorul deschide checkout-ul de pickup.
import { useState, useMemo, useRef } from 'react'
import { createOrder } from '../lib/orders'
import type { CartItem } from '../lib/orders'
import type { Restaurant } from '../lib/qr'
import type { MenuTheme } from '../lib/themes'

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
}: PickupCheckoutProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pickupTime, setPickupTime] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Cheie de idempotență stabilă pe durata sheet-ului: retry-urile (după
  // ambiguitate de rețea) refolosesc aceeași cheie → fără comenzi duplicate.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID())

  const slots = useMemo(() => {
    const settings = restaurant.pickup_settings
    if (!settings) return []
    const now = new Date()
    const lead = settings.min_lead_time_minutes
    const interval = settings.slot_interval_minutes
    const earliest = new Date(now.getTime() + lead * 60_000)

    // Lower bound = ora de deschidere (nu putem oferi sloturi înainte de open).
    const [openH, openM] = settings.open_hours.start.split(':').map(Number)
    const open = new Date(now)
    open.setHours(openH, openM, 0, 0)
    if (earliest.getTime() < open.getTime()) {
      earliest.setTime(open.getTime())
    }

    const min = earliest.getMinutes()
    const remainder = min % interval
    if (remainder > 0) earliest.setMinutes(min + (interval - remainder))
    earliest.setSeconds(0)
    earliest.setMilliseconds(0)

    const [closeH, closeM] = settings.open_hours.end.split(':').map(Number)
    const close = new Date(now)
    close.setHours(closeH, closeM, 0, 0)
    if (close.getTime() < earliest.getTime()) return []

    const result: string[] = []
    let cursor = new Date(earliest)
    while (cursor.getTime() <= close.getTime() && result.length < 16) {
      result.push(cursor.toISOString())
      cursor = new Date(cursor.getTime() + interval * 60_000)
    }
    return result
  }, [restaurant.pickup_settings])

  async function submitOrder() {
    if (slots.length === 0) {
      setError('Restaurantul este închis acum. Revino în programul de funcționare.')
      return
    }
    if (name.trim().length === 0) {
      setError('Te rog completează numele')
      return
    }
    // Telefonul e OBLIGATORIU pentru pickup: create_order (mig 145) respinge
    // comenzile pickup fără telefon valid (7-15 cifre). Validăm client-side
    // ca să nu eșueze tăcut cu mesaj generic.
    const phoneDigits = phone.match(/\d/g)?.length ?? 0
    if (phoneDigits < 7 || phoneDigits > 15) {
      setError('Te rog completează un număr de telefon valid (7–15 cifre)')
      return
    }
    if (!pickupTime) {
      setError('Te rog alege un interval')
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
        customer_phone: phone.trim(),
      })
      // Rotește cheia înainte de a propaga succesul: dacă părintele lasă
      // sheet-ul montat și user-ul mai trimite o comandă, a doua nu va fi
      // dedup-uită silențios de server pe aceeași idempotency_key.
      idempotencyKeyRef.current = crypto.randomUUID()
      onSuccess(result.short_id, pickupTime || null, result.total)
    } catch (err) {
      console.error('[PickupCheckout] error:', err)
      // Mapăm hint-urile cunoscute din create_order (mig 145) la mesaje clare,
      // în loc să afișăm același text generic pentru orice eșec.
      const msg = err instanceof Error ? err.message : ''
      const friendly = /invalid_customer_phone|valid customer_phone/i.test(msg)
        ? 'Număr de telefon invalid. Verifică-l și încearcă din nou.'
        : /pickup_disabled|dezactivate/i.test(msg)
          ? 'Comenzile pickup nu sunt disponibile momentan.'
          : /pickup_time_too_soon|min.?lead|too soon/i.test(msg)
            ? 'Intervalul ales e prea aproape. Alege unul mai târziu.'
            : /missing_pickup_time/i.test(msg)
              ? 'Te rog alege un interval de ridicare.'
              : /rate.?limit|too many|prea multe/i.test(msg)
                ? 'Prea multe comenzi într-un timp scurt. Reîncearcă în câteva minute.'
                : 'Comanda nu s-a trimis. Încearcă din nou.'
      setError(friendly)
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
        onClick={(e) => e.stopPropagation()}
        style={{
          background: PUB.bg,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
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
            Detalii ridicare
          </div>
          <div style={{ fontSize: 13, color: PUB.text2, marginBottom: 20 }}>
            Plata se face cash la ridicare.
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
              Nume *
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ion Popescu"
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
              Telefon
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07XX XXX XXX"
              type="tel"
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
            <div style={{ fontSize: 11, color: PUB.text3, marginTop: 5 }}>
              Obligatoriu — pentru a putea fi sunat dacă întârzii
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
                Vino la *
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
              ⚠️ Restaurantul este închis acum. Vino mâine în orele de program.
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
            {submitting ? 'Se trimite...' : `Trimite comanda · ${cartTotal.toFixed(2)} lei`}
          </button>
        </div>
      </div>
    </div>
  )
}

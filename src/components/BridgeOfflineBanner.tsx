// =============================================================
// Menuvia — src/components/BridgeOfflineBanner.tsx
// „Fiscalizare activă, casa nu e conectată" (audit v3, rangul 8).
// =============================================================
import { D } from '../lib/constants'
import { Icon } from './ui/Icon'
import type { BridgeConnectionStatus } from '../lib/bridgeStatus'

/**
 * Avertizare operațională pentru planurile cu bon fiscal: comenzile se
 * încasează normal, dar fără bridge conectat NU se emite niciun bon — tăcut.
 * Fereastra periculoasă e chiar începutul abonamentului, când nimeni nu se uită
 * încă la tab-ul Casă de marcat.
 *
 * Se randează DOAR pe o stare cunoscută cu `connected === false`. Apelantul
 * trebuie să paseze `status = null` cât timp planul sau starea sunt necunoscute
 * (tristate) — un fals pozitiv aici e mai scump decât lipsa alertei, fiindcă
 * antrenează staff-ul să ignore exact ecranul care contează.
 */
export function BridgeOfflineBanner({
  status,
  compact = false,
  onOpenBridge,
}: {
  status: BridgeConnectionStatus | null
  /** Variantă îngustă, pentru bara de sus din Ospătar. */
  compact?: boolean
  /** Deschide tab-ul „Casă de marcat"; lipsă pe ecranele fără navigație (Ospătar). */
  onOpenBridge?: () => void
}) {
  if (status == null || status.connected) return null

  const titlu = status.registered
    ? 'Fiscalizare activă, casa nu e conectată'
    : 'Fiscalizare activă, nicio casă înregistrată'
  const detaliu = status.registered
    ? 'Bridge-ul nu a mai răspuns de câteva minute. Comenzile se încasează normal, dar NU se emite niciun bon fiscal până revine.'
    : 'Planul include bon fiscal, dar nu există niciun dispozitiv bridge înregistrat. Până îl conectezi, comenzile plătite rămân fără bon.'

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: compact ? 'center' : 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        padding: compact ? '10px 14px' : '14px 16px',
        borderRadius: compact ? 10 : 12,
        background: D.amberA,
        border: `1px solid ${D.amber}`,
        color: D.t1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 220 }}>
        <Icon name="alert" size={compact ? 15 : 18} color={D.amber} />
        <div>
          <div style={{ fontWeight: 700, fontSize: compact ? 13 : 14.5, lineHeight: 1.35 }}>
            {titlu}
          </div>
          {!compact && (
            <div style={{ color: D.t2, fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>
              {detaliu}
            </div>
          )}
        </div>
      </div>
      {onOpenBridge != null && (
        <button
          type="button"
          onClick={onOpenBridge}
          style={{
            background: D.amber,
            color: '#000',
            border: 'none',
            borderRadius: 8,
            padding: '8px 14px',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Deschide Casa de marcat
        </button>
      )}
    </div>
  )
}

// Refuzul unei acțiuni rapide de staff (Confirmă / Gata / Servit / Închide
// comanda), afișat PE CARD, lângă butonul apăsat — nu ca banner de pagină,
// unde nu se vedea a cărei comenzi era și rămânea până la următoarea acțiune
// (ux-staff-action-errors). Textul vine deja în română din
// describeStaffActionError; dispare singur (useOrders) sau la „✕".
import { D } from '../lib/constants'
import { Icon } from './ui/Icon'

export function ActionErrorNote({
  message,
  onDismiss,
}: {
  message: string
  onDismiss?: () => void
}) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        background: `${D.red}1A`,
        border: `1px solid ${D.red}55`,
        borderRadius: 8,
        padding: '6px 4px 6px 10px',
        color: D.red,
        fontSize: 13,
        lineHeight: 1.35,
      }}
    >
      <span style={{ minWidth: 0 }}>{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={'Închide mesajul'}
          style={{
            background: 'transparent',
            border: 'none',
            color: D.red,
            cursor: 'pointer',
            minWidth: 44,
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            padding: 0,
          }}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  )
}

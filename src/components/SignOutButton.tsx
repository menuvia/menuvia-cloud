// „Ieși din cont" pentru ORICE rol. Până acum singura ieșire era în Setări →
// Cont, un tab doar pentru owner/manager: ospătarul și bucătarul nu se puteau
// deloc deconecta — pe o tabletă comună, următorul om lucra pe contul lor.
// Confirmare înainte (o atingere greșită pe ecranul de lucru te scoate din cont
// în mijlocul serviciului). Fără `onSignOut`, ieșirea face o încărcare completă
// pe /auth: starea paginii de lucru (comenzi, cozi, abonări realtime) dispare
// odată cu sesiunea, iar următorul om pornește de la autentificare.
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { D } from '../lib/constants'
import { Icon } from './ui/Icon'
import { confirm as confirmDialog } from './ui/confirm'

export function SignOutButton({
  variant,
  onSignOut,
  warning,
}: {
  /** `sidebar` = rând lat în bara laterală; `header` = buton compact în antet. */
  variant: 'sidebar' | 'header'
  onSignOut?: () => Promise<void>
  /** Ce se pierde/rămâne la ieșire (ex. comenzi offline netrimise), în confirmare. */
  warning?: string
}) {
  const { signOut } = useAuth()
  const [busy, setBusy] = useState(false)

  async function handleClick(): Promise<void> {
    const ok = await confirmDialog({
      title: 'Ieși din cont?',
      description: [warning, 'Pe acest dispozitiv va trebui să te autentifici din nou.']
        .filter(Boolean)
        .join(' '),
      confirmLabel: 'Ieși din cont',
    })
    if (!ok) return
    setBusy(true)
    try {
      if (onSignOut) {
        await onSignOut()
      } else {
        await signOut()
        window.location.replace('/auth')
      }
    } finally {
      setBusy(false)
    }
  }

  const sidebar = variant === 'sidebar'
  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      aria-label="Ieși din cont"
      title="Ieși din cont"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: sidebar ? 8 : 5,
        width: sidebar ? '100%' : undefined,
        minHeight: 44,
        padding: sidebar ? '10px 12px' : '5px 10px',
        borderRadius: sidebar ? 9 : 7,
        border: `1px solid ${sidebar ? D.border : D.s3}`,
        cursor: busy ? 'wait' : 'pointer',
        background: 'transparent',
        color: D.t2,
        fontSize: sidebar ? '0.85rem' : 12,
        fontWeight: sidebar ? 400 : 600,
        fontFamily: 'DM Sans,sans-serif',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Icon name="logout" size={sidebar ? 16 : 14} />
      {busy ? 'Se iese…' : 'Ieși din cont'}
    </button>
  )
}

export default SignOutButton

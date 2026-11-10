// „Ieși din cont" pentru ORICE rol. Până acum singura ieșire era în Setări →
// Cont, un tab doar pentru owner/manager: ospătarul și bucătarul nu se puteau
// deloc deconecta — pe o tabletă comună, următorul om lucra pe contul lor.
// Confirmare înainte (o atingere greșită pe ecranul de lucru te scoate din cont
// în mijlocul serviciului). Fără `onSignOut`, ieșirea face o încărcare completă
// pe /auth: starea paginii de lucru (comenzi, cozi, abonări realtime) dispare
// odată cu sesiunea, iar următorul om pornește de la autentificare.
// Lotul L4c: textele vin din `common` (butonul stă în Panou, la Ospătar și în
// Bucătărie); `warning` vine deja tradus de la pagină. Eroarea se ține ca
// DATE și se traduce la randare, prin describeStaffError (în română exact
// `toUserMessage` de dinainte).
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { D } from '../lib/constants'
import { Icon } from './ui/Icon'
import { confirm as confirmDialog } from './ui/confirm'
import { useT } from '../i18n/useT'
import { commonNs } from '../i18n/ns/common'
import { describeStaffError } from '../i18n/staffErrors'

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
  const tc = useT(commonNs)
  const { t } = tc
  const [busy, setBusy] = useState(false)
  // Refuzul ieșirii, ca DATE (`{ err }`: o respingere poate fi și `undefined`).
  const [failure, setFailure] = useState<{ err: unknown } | null>(null)

  async function handleClick(): Promise<void> {
    const ok = await confirmDialog({
      title: t('signOut_confirmTitle'),
      description: [warning, t('signOut_confirmDesc')].filter(Boolean).join(' '),
      confirmLabel: t('signOut'),
      // Explicit: fără el, ConfirmDialog ia „Anulează” din cromul care urmează
      // `<html lang>` (rămas `ro` pe rutele de personal) → dialog amestecat.
      cancelLabel: t('cancel'),
    })
    if (!ok) return
    setBusy(true)
    setFailure(null)
    try {
      if (onSignOut) {
        await onSignOut()
      } else {
        await signOut()
        window.location.replace('/auth')
      }
    } catch (e) {
      // O ieșire eșuată NU are voie să pară reușită (sau să tacă): omul crede
      // că a lăsat tableta liberă, iar sesiunea lui e încă deschisă.
      setFailure({ err: e })
    } finally {
      setBusy(false)
    }
  }

  const sidebar = variant === 'sidebar'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: sidebar ? 'stretch' : 'flex-end',
        gap: 4,
        width: sidebar ? '100%' : undefined,
        flexShrink: 0,
      }}
    >
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      aria-label={t('signOut')}
      title={t('signOut')}
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
      {busy ? t('signOut_busy') : t('signOut')}
    </button>
    {failure != null && (
      <span role="alert" style={{ color: D.red, fontSize: '0.72rem', lineHeight: 1.4 }}>
        {describeStaffError(failure.err, tc, { fallback: t('signOut_failed') })}
      </span>
    )}
    </div>
  )
}

export default SignOutButton

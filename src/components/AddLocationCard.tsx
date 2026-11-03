// „Adaugă o locație" (lotul A) — în Setări → Abonament & cont, DOAR pentru
// proprietar: limita de restaurante e a CONTULUI proprietarului
// (`enforce_restaurant_limit`, mig 131/290), deci managerul n-ar avea ce crea.
//
// Decizia fondatorului: locația nouă e GOALĂ — doar numele, prin RPC-ul
// existent `create_restaurant` (mig 096A/221: fără preset de meniu, fără
// categorii; cotele TVA / setările de rezervare vin din triggerele de la
// INSERT, ca la onboarding). După succes, apelantul face noul restaurant
// ACTIV. Refuzul de limită (hint `upgrade_plan`) ajunge la om în română
// (`describeCreateLocationError`, lib/locations.ts), nu ca text de server.
import { useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { D } from '../lib/constants'
import { describeCreateLocationError } from '../lib/locations'
import { createRestaurant } from '../lib/restaurants'
import { slugify } from '../lib/slug'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { FocusTrap } from './ui/FocusTrap'
import { Icon } from './ui/Icon'
import '../styles/components/confirm-dialog.css'

export default function AddLocationCard({
  onCreated,
}: {
  // Reîncarcă listele (restaurante + membership-uri) și face locația activă.
  onCreated: (restaurantId: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Locația deja creată într-o încercare a cărei a doua jumătate (reîncărcarea
  // listelor) a picat: la reîncercare NU se mai creează încă un restaurant
  // (tiparul OnboardingPage).
  const createdRef = useRef<string | null>(null)
  useBodyScrollLock(open)

  const close = () => {
    if (saving) return
    setOpen(false)
    setError(null)
    setName('')
    createdRef.current = null
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Scrie numele locației.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const id =
        createdRef.current ??
        (await createRestaurant({ name: trimmed, slug: slugify(trimmed) })).restaurant_id
      createdRef.current = id
      await onCreated(id)
      setSaving(false)
      setOpen(false)
      setName('')
      createdRef.current = null
    } catch (err) {
      setError(describeCreateLocationError(err))
      setSaving(false)
    }
  }

  return (
    <>
      <Card variant="flat">
        <h2
          style={{
            fontFamily: D.fontBody,
            fontSize: '0.92rem',
            fontWeight: 600,
            color: D.t1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: '0 0 6px',
          }}
        >
          <Icon name="mapPin" size={16} color={D.gold} />
          Locații
        </h2>
        <div style={{ fontSize: '0.75rem', color: D.t2, marginBottom: 14, lineHeight: 1.5 }}>
          Ai mai multe localuri? Adaugă o locație nouă — pornește goală, cu meniul și mesele
          ei. Câte locații poți avea depinde de planul contului.
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)} icon={<Icon name="plus" size={16} />}>
          Adaugă o locație
        </Button>
      </Card>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="confirm-backdrop" onClick={close} role="presentation">
            <div
              className="confirm-dialog"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-location-title"
            >
              <FocusTrap onEscape={close} />
              <h3 id="add-location-title" className="confirm-dialog__title">
                Adaugă o locație
              </h3>
              <p className="confirm-dialog__desc">
                Locația nouă pornește goală: adaugi apoi produsele, mesele și echipa ei. Restaurantul
                pe care îl administrezi acum rămâne neschimbat.
              </p>
              <form onSubmit={(e) => void submit(e)}>
                <label
                  htmlFor="add-location-name"
                  style={{ display: 'block', fontSize: '0.78rem', color: D.t2, marginBottom: 6 }}
                >
                  Numele locației
                </label>
                <input
                  id="add-location-name"
                  type="text"
                  value={name}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(e) => setName(e.target.value)}
                  disabled={saving}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: D.s3,
                    border: `1px solid ${D.border}`,
                    color: D.t1,
                    padding: '10px 12px',
                    minHeight: 44,
                    borderRadius: 8,
                    fontSize: '0.9rem',
                    fontFamily: D.fontBody,
                    marginBottom: 12,
                  }}
                />
                {error && (
                  <div
                    role="alert"
                    style={{ color: D.redText, fontSize: '0.8rem', lineHeight: 1.45, marginBottom: 12 }}
                  >
                    {error}
                  </div>
                )}
                <div className="confirm-dialog__actions">
                  <Button variant="ghost" onClick={close} disabled={saving}>
                    Anulează
                  </Button>
                  <Button type="submit" variant="primary" loading={saving}>
                    Creează locația
                  </Button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

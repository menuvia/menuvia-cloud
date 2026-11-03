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
//
// Fără a doua creare la reîncercare (recenzia #344): un restaurant nu se mai
// poate șterge (DELETE revocat din 096B), deci o locație dublă ar ocupa
// PERMANENT un loc din limita planului. Garanția e în DATE: fiecare creare
// poartă o cheie de idempotență (mig 315), iar reîncercarea o REFOLOSEȘTE.
// Un eșec AMBIGUU (rețea, răspuns pierdut după COMMIT) NU se reîncearcă orb:
// întâi se recitesc restaurantele deținute (`findCreatedLocation`); dacă
// locația există, crearea a reușit; dacă lista nu se poate citi, dialogul
// spune că nu știm și oferă doar „Reîncarcă" (MSG_CREATE_UNCERTAIN). Până la
// o verificare reușită, ORICE reîncercare verifică întâi.
import { useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { D } from '../lib/constants'
import {
  MSG_CREATE_UNCERTAIN,
  describeCreateLocationError,
  findCreatedLocation,
  hardReloadTo,
  isAmbiguousCreateFailure,
} from '../lib/locations'
import { createRestaurant } from '../lib/restaurants'
import { slugify } from '../lib/slug'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { FocusTrap } from './ui/FocusTrap'
import { Icon } from './ui/Icon'
import '../styles/components/confirm-dialog.css'

export interface AddLocationProps {
  // Reîncarcă listele (restaurante + membership-uri) și face locația activă.
  onCreated: (restaurantId: string) => Promise<void>
  // Proprietarul (auth.uid()) — lista restaurantelor DEȚINUTE e a lui.
  ownerId: string
  // Id-urile restaurantelor deținute deja, la deschiderea dialogului: o
  // locație găsită după un eșec ambiguu trebuie să fie NOUĂ.
  knownRestaurantIds: readonly string[]
}

type PendingCheck =
  | { status: 'found'; id: string }
  | { status: 'absent' }
  | { status: 'unknown' }

export default function AddLocationCard({ onCreated, ownerId, knownRestaurantIds }: AddLocationProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Nu știm dacă s-a creat și nici nu putem verifica: doar „Reîncarcă".
  const [uncertain, setUncertain] = useState(false)
  // Locația deja creată într-o încercare a cărei a doua jumătate (reîncărcarea
  // listelor) a picat: la reîncercare NU se mai creează încă un restaurant
  // (tiparul OnboardingPage).
  const createdRef = useRef<string | null>(null)
  // O creare terminată AMBIGUU, încă neverificată (supraviețuiește închiderii
  // dialogului — altfel redeschiderea ar permite exact reîncercarea oarbă).
  // `key` = cheia de idempotență a creării (mig 315): reîncercarea o
  // REFOLOSEȘTE, deci serverul întoarce locația deja creată în loc de una nouă.
  // `sentAt` = PRIMA trimitere (marginea de jos a căutării în listă).
  const pendingRef = useRef<{ name: string; sentAt: number; key: string } | null>(null)
  const knownIdsRef = useRef<ReadonlySet<string>>(new Set())
  useBodyScrollLock(open)

  const openDialog = () => {
    // Instantaneul se ia doar când nu există o creare în curs de lămurire.
    if (pendingRef.current == null && createdRef.current == null) {
      knownIdsRef.current = new Set(knownRestaurantIds)
    }
    setOpen(true)
  }

  const close = () => {
    if (saving) return
    setOpen(false)
    setError(null)
  }

  // A creat serverul locația, deși răspunsul s-a pierdut?
  const checkPending = async (): Promise<PendingCheck> => {
    const pending = pendingRef.current
    if (!pending) return { status: 'absent' }
    try {
      const found = await findCreatedLocation({
        ownerId,
        name: pending.name,
        sentAt: pending.sentAt,
        knownIds: knownIdsRef.current,
      })
      if (found == null) return { status: 'absent' }
      pendingRef.current = null
      return { status: 'found', id: found }
    } catch {
      return { status: 'unknown' }
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (uncertain) return
    const trimmed = name.trim()
    if (!trimmed && createdRef.current == null && pendingRef.current == null) {
      setError('Scrie numele locației.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let id = createdRef.current
      if (id == null && pendingRef.current != null) {
        // O încercare anterioară a eșuat ambiguu: întâi verificăm, abia apoi
        // reîncercăm — cu ACEEAȘI cheie, deci „negăsită" (cerere încă în drum
        // sau necomisă) nu mai poate produce o locație dublă: serverul o
        // întoarce pe cea veche dacă a comis (mig 315).
        const check = await checkPending()
        if (check.status === 'unknown') {
          setUncertain(true)
          setSaving(false)
          return
        }
        if (check.status === 'found') id = check.id
      }
      if (id == null) {
        if (!trimmed && pendingRef.current == null) {
          setError('Scrie numele locației.')
          setSaving(false)
          return
        }
        // O reîncercare după un eșec ambiguu păstrează numele și CHEIA cererii
        // inițiale: e aceeași creare, nu una nouă.
        const prev = pendingRef.current
        const pending = prev ?? { name: trimmed, sentAt: Date.now(), key: crypto.randomUUID() }
        pendingRef.current = pending
        try {
          id = (
            await createRestaurant({
              name: pending.name,
              slug: slugify(pending.name),
              idempotencyKey: pending.key,
              // O REÎNCERCARE fără protecția cheii (bază fără mig 315) e
              // interzisă: ar putea dubla o creare care a comis totuși.
              requireIdempotency: prev != null,
            })
          ).restaurant_id
          pendingRef.current = null
        } catch (err) {
          const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : null
          if (prev != null && code === 'PGRST202') {
            // Baza nu deduplică (fără mig 315): nu putem reîncerca în siguranță.
            setUncertain(true)
            setSaving(false)
            return
          }
          if (!isAmbiguousCreateFailure(err)) {
            // Refuz CLAR: nu s-a creat nimic, reîncercarea e sigură.
            pendingRef.current = null
            throw err
          }
          const check = await checkPending()
          if (check.status === 'unknown') {
            setUncertain(true)
            setSaving(false)
            return
          }
          // Negăsită ÎNCĂ: eroarea rămâne vizibilă, iar următoarea încercare
          // verifică din nou înainte de a crea (`pendingRef` rămâne).
          if (check.status === 'absent') throw err
          id = check.id
        }
      }
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
        <Button variant="secondary" onClick={openDialog} icon={<Icon name="plus" size={16} />}>
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
                  disabled={saving || uncertain}
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
                {uncertain ? (
                  <>
                    <div
                      role="alert"
                      style={{ color: D.redText, fontSize: '0.8rem', lineHeight: 1.45, marginBottom: 12 }}
                    >
                      {MSG_CREATE_UNCERTAIN}
                    </div>
                    <div className="confirm-dialog__actions">
                      <Button variant="ghost" onClick={close}>
                        Închide
                      </Button>
                      <Button variant="primary" onClick={() => hardReloadTo('/dashboard')}>
                        Reîncarcă
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="confirm-dialog__actions">
                    <Button variant="ghost" onClick={close} disabled={saving}>
                      Anulează
                    </Button>
                    <Button type="submit" variant="primary" loading={saving}>
                      Creează locația
                    </Button>
                  </div>
                )}
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

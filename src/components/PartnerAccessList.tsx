// PartnerAccessList — panoul afiliatului (AfiliatPage › Restaurante): accesul de
// partener la restaurantele aduse, mig 286.
//
// Accesul e OPT-IN: afiliatul CERE, ownerul aprobă. „Intră pe dashboard"
// apare DOAR când accesul e acordat; în rest se vede starea (cerere trimisă /
// revocat). Partenerul vede în dashboard doar meniul și mesele/QR — nu comenzi,
// rezervări, date fiscale sau setări. Starea vine din DB (list_partner_attributions),
// nu din UI: ce vede aici e exact ce RLS-ul îi permite.
import { useState, useEffect, useCallback } from 'react'
import { D } from '../lib/constants'
import {
  listPartnerAttributions,
  requestPartnerAccess,
  enterFounderView,
  type PartnerAttribution,
} from '../lib/founder'
import { describePartnerState } from '../lib/partnerAccess'

const card = {
  background: D.s2,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: '18px 20px',
} as const

const goldBtn = {
  background: D.gold,
  color: '#000',
  border: 'none',
  borderRadius: 9,
  padding: '10px 16px',
  minHeight: 44,
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
} as const

const disabledBtn = { opacity: 0.55, cursor: 'not-allowed' } as const

const TONE_COLOR = { ok: D.green, wait: D.gold, bad: D.red, neutral: D.t2 } as const

// „Intră pe dashboard" cu feedback: enterFounderView așteaptă audit-ul
// vizitei (până la ~2s) înainte să navigheze — fără busy, butonul părea mort.
function PartnerEnterButton({ restaurantId }: { restaurantId: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      onClick={() => {
        setBusy(true)
        void enterFounderView(restaurantId, 'afiliat')
      }}
      disabled={busy}
      style={{ ...goldBtn, ...(busy ? disabledBtn : null) }}
    >
      {busy ? 'Se deschide…' : 'Intră pe dashboard'}
    </button>
  )
}

export default function PartnerAccessList() {
  const [items, setItems] = useState<PartnerAttribution[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (isStale?: () => boolean) => {
    try {
      const rows = await listPartnerAttributions()
      if (isStale?.()) return
      setItems(rows)
    } catch (e: unknown) {
      // Secțiunea nu se afișează pe eroare (decizie deliberată), DAR lăsăm o
      // urmă de diagnostic — altfel un blip de rețea e indistinguibil de o
      // revocare reală de acces la debugging în prod.
      console.error('[PartnerAccessList] listPartnerAttributions error:', e)
    }
    if (isStale?.()) return
    setLoaded(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  async function request(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await requestPartnerAccess(id)
      if (!res.ok) throw new Error(res.error ?? 'Nu am putut trimite cererea')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu am putut trimite cererea')
    } finally {
      setBusyId(null)
    }
  }

  if (!loaded || items.length === 0) return null

  return (
    <div style={{ ...card, marginBottom: 12 }} data-testid="partner-access-list">
      <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>
        Acces de partener
      </div>
      <div style={{ color: D.t2, fontSize: '0.78rem', marginBottom: 12 }}>
        Poți cere acces la meniul și mesele/QR ale restaurantelor aduse de tine, ca să le ajuți cu
        configurarea. Accesul se acordă doar dacă ownerul aprobă, acoperă DOAR meniul și mesele/QR
        (nu comenzi, rezervări sau date fiscale) și poate fi revocat de owner oricând.
      </div>
      {error && (
        <div role="alert" style={{ color: D.red, fontSize: '0.78rem', marginBottom: 8 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((a) => {
          const view = describePartnerState(a.state)
          const names = a.restaurant_names.length > 0 ? a.restaurant_names.join(', ') : 'Cont nou'
          const busy = busyId === a.attribution_id
          return (
            <div
              key={a.attribution_id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '10px 12px',
                background: D.s3,
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: D.t1,
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {names}
                  </div>
                  <div style={{ color: TONE_COLOR[view.tone], fontSize: '0.72rem' }}>
                    {view.label}
                  </div>
                </div>

                {a.state === 'none' && (
                  <button
                    onClick={() => void request(a.attribution_id)}
                    disabled={busy}
                    style={{ ...goldBtn, ...(busy ? disabledBtn : null) }}
                  >
                    {busy ? 'Se trimite…' : 'Cere acces'}
                  </button>
                )}
                {a.state === 'revoked' && (
                  <button
                    onClick={() => void request(a.attribution_id)}
                    disabled={busy}
                    style={{ ...goldBtn, ...(busy ? disabledBtn : null) }}
                  >
                    {busy ? 'Se trimite…' : 'Cere din nou'}
                  </button>
                )}
              </div>

              {a.state === 'requested' && (
                <div style={{ color: D.t2, fontSize: '0.75rem' }}>
                  Cererea a fost trimisă. Ownerul o vede în tab-ul Echipă și trebuie să o aprobe.
                </div>
              )}
              {a.state === 'revoked' && (
                <div style={{ color: D.t2, fontSize: '0.75rem' }}>
                  Ownerul a revocat accesul. Poți trimite o cerere nouă.
                </div>
              )}

              {a.state === 'granted' &&
                a.restaurants.map((r) => (
                  <div
                    key={r.restaurant_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ color: D.t2, fontSize: '0.78rem' }}>
                      {r.name + ' · ' + (r.city ?? '—') + ' · ' + (r.is_active ? 'activ' : 'inactiv')}
                    </div>
                    <PartnerEnterButton restaurantId={r.restaurant_id} />
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

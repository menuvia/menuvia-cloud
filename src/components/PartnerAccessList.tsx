// PartnerAccessList — „Clienții mei” din panoul agentului de vânzări (AfiliatPage,
// pachetul 8b-2): UN rând per client (restaurant atribuit), cu O SINGURĂ acțiune,
// cea care contează acum pentru accesul de agent (mig 286 + 303).
//
// Accesul e OPT-IN: agentul CERE, patronul aprobă (sau îl acordă direct, din
// cardul „Agentul tău Menuvia”, mig 303). „Editează meniul” apare DOAR când
// accesul e acordat; în rest se vede starea (cerere trimisă / revocat). Agentul
// vede în dashboard doar meniul și mesele/QR — nu comenzi, rezervări, date
// fiscale sau setări. Starea vine din DB (list_partner_attributions), nu din UI:
// ce vede aici e exact ce RLS-ul îi permite.
//
// Două moduri:
//   • cu `clients` (lista din get_affiliate_dashboard): rândurile sunt clienții,
//     iar starea accesului se potrivește pe `attribution_id`. O citire eșuată a
//     stării NU ascunde clienții: rândurile rămân, fără acțiune, cu „Reîncearcă”;
//   • fără `clients`: doar atribuirile cu stare (forma veche a secțiunii), care
//     nu randează nimic cât lista e goală sau necunoscută.
import { useState, useEffect, useCallback } from 'react'
import { D } from '../lib/constants'
import {
  listPartnerAttributions,
  requestPartnerAccess,
  enterFounderView,
  type PartnerAttribution,
} from '../lib/founder'
import { describePartnerState } from '../lib/partnerAccess'

export interface ClientSummary {
  attribution_id: string
  status: string
  restaurant_names: string[]
  city: string | null
  commission_cents: number
}

const card = {
  background: D.s2,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: '18px 20px',
} as const

const goldBtn = {
  background: D.gold,
  color: D.onGold,
  border: 'none',
  borderRadius: 9,
  padding: '10px 16px',
  minHeight: 44,
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: D.fontBody,
} as const

const disabledBtn = { opacity: 0.55, cursor: 'not-allowed' } as const

const TONE_COLOR = { ok: D.green, wait: D.gold, bad: D.red, neutral: D.t2 } as const

// Starea atribuirii (contul clientului), nu a accesului.
const CLIENT_STATUS: Record<string, string> = {
  active: 'abonat',
  pending: 'cont nou, încă fără abonament plătit',
  paused: 'abonament în pauză',
  canceled: 'abonament anulat',
  refunded: 'rambursat',
  expired: 'expirat',
  downgraded: 'trecut pe un plan mai mic',
}

// „Editează meniul” cu feedback: enterFounderView așteaptă audit-ul vizitei
// (până la ~2s) înainte să navigheze — fără busy, butonul părea mort.
function PartnerEnterButton({ restaurantId, label }: { restaurantId: string; label: string }) {
  const [busy, setBusy] = useState<boolean>(false)
  return (
    <button
      type="button"
      aria-label={busy ? undefined : label}
      onClick={() => {
        setBusy(true)
        void enterFounderView(restaurantId, 'afiliat')
      }}
      disabled={busy}
      style={{ ...goldBtn, ...(busy ? disabledBtn : null) }}
    >
      {busy ? 'Se deschide…' : 'Editează meniul'}
    </button>
  )
}

interface Row {
  id: string
  names: string
  detail: string | null
  commission: string | null
  access: PartnerAttribution | null
}

export default function PartnerAccessList({
  clients,
  formatMoney,
}: {
  /** Clienții din get_affiliate_dashboard; lipsă = doar atribuirile cu stare. */
  clients?: ClientSummary[]
  /** Formatarea comisionului per client (cenți → text); lipsă = fără sumă. */
  formatMoney?: (cents: number) => string
}) {
  const [items, setItems] = useState<PartnerAttribution[]>([])
  const [loaded, setLoaded] = useState<boolean>(false)
  const [failed, setFailed] = useState<boolean>(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (isStale?: () => boolean) => {
    try {
      const rows = await listPartnerAttributions()
      if (isStale?.()) return
      setItems(rows)
      setFailed(false)
    } catch (e: unknown) {
      // Lăsăm o urmă de diagnostic — altfel un blip de rețea e indistinguibil
      // de o revocare reală de acces la debugging în prod.
      console.error('[PartnerAccessList] listPartnerAttributions error:', e)
      if (isStale?.()) return
      setFailed(true)
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

  const byId = new Map(items.map((a) => [a.attribution_id, a]))
  const rows: Row[] = clients
    ? clients.map((c) => ({
        id: c.attribution_id,
        names: c.restaurant_names.length > 0 ? c.restaurant_names.join(', ') : 'Cont nou',
        detail: [c.city, CLIENT_STATUS[c.status] ?? c.status].filter(Boolean).join(' · ') || null,
        commission: formatMoney ? formatMoney(c.commission_cents) : null,
        access: byId.get(c.attribution_id) ?? null,
      }))
    : items.map((a) => ({
        id: a.attribution_id,
        names: a.restaurant_names.length > 0 ? a.restaurant_names.join(', ') : 'Cont nou',
        detail: null,
        commission: null,
        access: a,
      }))

  // Forma veche: nimic de arătat cât lista e necunoscută sau goală.
  if (!clients && (!loaded || rows.length === 0)) return null

  return (
    <section aria-labelledby="clients-title" style={card} data-testid="partner-access-list">
      <h2 id="clients-title" style={{ margin: '0 0 4px', fontSize: '1.05rem', color: D.t1 }}>
        Clienții mei
      </h2>
      <div style={{ color: D.t2, fontSize: '0.78rem', marginBottom: 12, lineHeight: 1.5 }}>
        Poți cere acces la meniul și mesele/QR ale restaurantelor aduse de tine, ca să le ajuți cu
        configurarea. Accesul îl dă doar patronul, acoperă DOAR meniul și mesele/QR (nu comenzi,
        rezervări sau date fiscale) și patronul îl poate retrage oricând.
      </div>
      {error && (
        <div role="alert" style={{ color: D.red, fontSize: '0.78rem', marginBottom: 8 }}>
          {error}
        </div>
      )}
      {clients && failed ? (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: 10,
            color: D.t2,
            fontSize: '0.78rem',
          }}
        >
          <span>Nu am putut încărca starea accesului la clienți.</span>
          <button
            type="button"
            onClick={() => void load()}
            style={{
              ...goldBtn,
              background: 'transparent',
              color: D.gold,
              border: `1px solid ${D.gold}55`,
            }}
          >
            Reîncearcă
          </button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div style={{ color: D.t2, fontSize: '0.82rem' }}>
          Încă n-ai niciun client. Trimite-i unui patron linkul sau codul tău de mai sus.
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row) => {
          const a = row.access
          const view = a ? describePartnerState(a.state) : null
          const busy = busyId === row.id
          const granted = a?.state === 'granted' ? a.restaurants : []
          return (
            <div
              key={row.id}
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
                    {row.names}
                  </div>
                  {row.detail || row.commission ? (
                    <div style={{ color: D.t2, fontSize: '0.72rem' }}>
                      {[row.detail, row.commission ? `comisionul tău: ${row.commission}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  ) : null}
                  {view ? (
                    <div style={{ color: TONE_COLOR[view.tone], fontSize: '0.72rem' }}>
                      {view.label}
                    </div>
                  ) : null}
                </div>

                {a?.state === 'none' && (
                  <button
                    type="button"
                    onClick={() => void request(row.id)}
                    disabled={busy}
                    style={{ ...goldBtn, ...(busy ? disabledBtn : null) }}
                  >
                    {busy ? 'Se trimite…' : 'Cere acces'}
                  </button>
                )}
                {a?.state === 'revoked' && (
                  <button
                    type="button"
                    onClick={() => void request(row.id)}
                    disabled={busy}
                    style={{ ...goldBtn, ...(busy ? disabledBtn : null) }}
                  >
                    {busy ? 'Se trimite…' : 'Cere din nou'}
                  </button>
                )}
                {granted.length === 1 && (
                  <PartnerEnterButton
                    restaurantId={granted[0].restaurant_id}
                    label={`Editează meniul: ${granted[0].name}`}
                  />
                )}
              </div>

              {a?.state === 'requested' && (
                <div style={{ color: D.t2, fontSize: '0.75rem' }}>
                  Cererea a fost trimisă. Patronul primește un email și o vede în panoul lui, pe
                  pagina Acasă; trebuie să o aprobe.
                </div>
              )}
              {a?.state === 'revoked' && (
                <div style={{ color: D.t2, fontSize: '0.75rem' }}>
                  Patronul a retras accesul. Poți trimite o cerere nouă.
                </div>
              )}

              {granted.length > 1 &&
                granted.map((r) => (
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
                      {r.name +
                        ' · ' +
                        (r.city ?? '—') +
                        ' · ' +
                        (r.is_active ? 'activ' : 'inactiv')}
                    </div>
                    <PartnerEnterButton
                      restaurantId={r.restaurant_id}
                      label={`Editează meniul: ${r.name}`}
                    />
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}

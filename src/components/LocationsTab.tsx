// „Toate locațiile" (lotul A, mig 314) — un card per local al adminului cu
// mai multe localuri: comenzile de azi, câte sunt deschise acum, încasările de
// azi (DOAR pe planurile cu bani) și ultima comandă, plus „Deschide".
//
// Vizibilitatea (≥ 2 localuri la care omul e admin) o decide bara laterală
// (lib/dashboardNav.ts `multiLocationOnly`); ecranul doar arată ce întoarce
// `get_locations_summary()`. Stările, fără afirmații pe necunoscut:
//   - se încarcă      → schelet, nicio cifră;
//   - eroare          → mesajul în română + „Reîncearcă";
//   - RPC nedeployat  → „rezumatul nu e încă disponibil" (nu „nicio locație");
//   - încasări `null` → câmpul NU apare (nu „0 lei" pe un plan fără bani).
// Limba (lotul L6b): textele vin din `locations` („Reîncearcă” din `common`);
// erorile sunt ținute ca DATE și traduse la randare (`describeStaffError` — în
// română exact `toUserMessage`). Suma rămâne `fmtPrice` în RON, ca azi.
import { useEffect, useState, type CSSProperties } from 'react'
import { D } from '../lib/constants'
import { fmtPrice } from '../lib/currency'
import { fetchLocationsSummary, formatLastOrderT, type LocationSummary } from '../lib/locations'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'
import { Skeleton } from './ui/Skeleton'
import { useT } from '../i18n/useT'
import { useUiLang } from '../i18n/UiLangContext'
import { describeStaffError } from '../i18n/staffErrors'
import { locationsNs } from '../i18n/ns/locations'
import { commonNs } from '../i18n/ns/common'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; err: unknown }
  | { status: 'unavailable' }
  | { status: 'ready'; locations: LocationSummary[] }

const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: 12,
}

const STAT_LABEL: CSSProperties = {
  fontSize: '0.7rem',
  color: D.t3,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const STAT_VALUE: CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 600,
  color: D.t1,
  fontVariantNumeric: 'tabular-nums',
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={STAT_LABEL}>{label}</span>
      <span style={STAT_VALUE}>{value}</span>
    </div>
  )
}

export default function LocationsTab({
  activeId,
  onOpen,
}: {
  // Restaurantul deschis acum în panou (cardul lui nu mai are „Deschide").
  activeId: string | null
  // Face restaurantul activ (RestaurantContext.setActive) și duce omul pe Acasă.
  // Respinge când localul nu poate fi adus în listele panoului (DashboardPage
  // recitește întâi un id necunoscut) — eroarea apare aici, fără comutare.
  onOpen: (restaurantId: string) => Promise<void>
}) {
  const tr = useT(locationsNs)
  const tc = useT(commonNs)
  // Formatele urmează limba UTILIZATORULUI, nu `tr.lang` (dicționarul servit).
  const { lang: uiLang } = useUiLang()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [opening, setOpening] = useState<string | null>(null)
  // Eroarea deschiderii, ca DATĂ (`{ err }`): se traduce la randare.
  const [openError, setOpenError] = useState<{ err: unknown } | null>(null)

  const open = async (restaurantId: string) => {
    setOpening(restaurantId)
    setOpenError(null)
    try {
      await onOpen(restaurantId)
    } catch (err) {
      setOpenError({ err })
    }
    setOpening(null)
  }

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    fetchLocationsSummary()
      .then((rows) => {
        if (cancelled) return
        setState(rows == null ? { status: 'unavailable' } : { status: 'ready', locations: rows })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({ status: 'error', err })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const intro = (
    <p style={{ color: D.t2, fontSize: '0.85rem', lineHeight: 1.5, margin: '0 0 16px' }}>
      {tr.t('intro')}
    </p>
  )

  if (state.status === 'loading') {
    return (
      <div>
        {intro}
        <div style={GRID} aria-busy="true">
          <Skeleton variant="card" count={2} />
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div>
        {intro}
        <Card variant="flat">
          <div role="alert" style={{ color: D.redText, fontSize: '0.85rem', marginBottom: 12 }}>
            {describeStaffError(state.err, tc, { fallback: tr.t('err_load') })}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            {tc.t('retry')}
          </Button>
        </Card>
      </div>
    )
  }

  if (state.status === 'unavailable') {
    return (
      <div>
        {intro}
        <Card variant="flat">
          <div style={{ color: D.t2, fontSize: '0.85rem' }}>{tr.t('unavailable')}</div>
        </Card>
      </div>
    )
  }

  return (
    <div>
      {intro}
      {openError && (
        <div role="alert" style={{ color: D.redText, fontSize: '0.85rem', marginBottom: 12 }}>
          {describeStaffError(openError.err, tc, { fallback: tr.t('err_open') })}
        </div>
      )}
      {state.locations.length === 0 ? (
        <Card variant="flat">
          <div style={{ color: D.t2, fontSize: '0.85rem' }}>{tr.t('empty')}</div>
        </Card>
      ) : (
        <div style={GRID}>
          {state.locations.map((loc) => {
            const isCurrent = loc.id === activeId
            return (
              <Card key={loc.id} variant="flat" data-testid="location-card">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 14,
                  }}
                >
                  <h2
                    style={{
                      fontFamily: D.fontBody,
                      fontSize: '0.98rem',
                      fontWeight: 600,
                      color: D.t1,
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      minWidth: 0,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    <Icon name="mapPin" size={16} color={D.gold} />
                    {loc.name}
                  </h2>
                  {isCurrent && (
                    <span style={{ fontSize: '0.72rem', color: D.goldL, whiteSpace: 'nowrap' }}>
                      {tr.t('current')}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <Stat label={tr.t('stat_ordersToday')} value={String(loc.ordersToday)} />
                  <Stat label={tr.t('stat_open')} value={String(loc.openOrders)} />
                  {loc.revenueToday != null && (
                    <Stat label={tr.t('stat_revenue')} value={fmtPrice(loc.revenueToday, 'RON')} />
                  )}
                  <Stat label={tr.t('stat_last')} value={formatLastOrderT(tr, uiLang, loc.lastOrderAt)} />
                </div>
                {!isCurrent && (
                  <Button
                    variant="secondary"
                    fullWidth
                    loading={opening === loc.id}
                    disabled={opening != null}
                    onClick={() => void open(loc.id)}
                    aria-label={tr.t('open_aria', { name: loc.name })}
                  >
                    {tr.t('open')}
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

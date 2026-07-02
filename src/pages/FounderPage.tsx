// FounderPage — dashboardul fondatorului (/founder), DOAR platform admin.
// „Văd tot / modific tot": KPI global, toate restaurantele (plan, health,
// intrare pe cont), cozile operaționale (email + facturi Oblio, cu retry),
// afiliații (arbore + restaurantele lor + payouts), consumul AI și auditul.
// Datele vin exclusiv din RPC-urile admin_* (mig 186, gate is_platform_admin).
import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import type { CSSProperties } from 'react'
import { D, PLAN_LABELS } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import { isPlatformAdmin } from '../lib/ai'
import { confirm } from '../components/ui/confirm'
import { useToast } from '../components/ui/useToast'
import { Icon } from '../components/ui/Icon'
import { EmptyState } from '../components/ui/EmptyState'
import { InlineSpinner } from '../components/PageLoader'
import {
  getPlatformOverview,
  listRestaurants,
  listEmailFailures,
  retryEmail,
  listInvoiceFailures,
  retryInvoice,
  listPayouts,
  markPayoutPaid,
  listAffiliates,
  setRestaurantPlan,
  toggleRestaurantActive,
  listAuditLog,
  enterFounderView,
  getAffiliateDefaults,
  setAffiliateDefaults,
  setAffiliateCommission,
  applyDefaultsToAllAffiliates,
  type AffiliateCommissionDefaults,
  type CommissionInput,
  type PlatformOverview,
  type AdminRestaurantRow,
  type AdminEmailFailure,
  type AdminInvoiceFailure,
  type AdminPayoutRow,
  type AdminAffiliateRow,
  type AdminAuditRow,
} from '../lib/founder'

const FounderAiPanel = lazy(() => import('../components/FounderAiPanel'))

type Section = 'overview' | 'restaurante' | 'operatiuni' | 'afiliati' | 'ai' | 'audit'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Vedere generală' },
  { id: 'restaurante', label: 'Restaurante' },
  { id: 'operatiuni', label: 'Operațiuni' },
  { id: 'afiliati', label: 'Afiliați' },
  { id: 'ai', label: 'Consum AI' },
  { id: 'audit', label: 'Audit' },
]

const PLANS = ['free', 'starter', 'growth', 'pro', 'enterprise'] as const

function formatRon(cents: number): string {
  return (cents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2 }) + ' lei'
}

// Payout-urile pot fi și în EUR (enum affiliate_currency, mig 098) — sufixul
// „lei" e corect doar pentru RON.
function formatMoney(cents: number, currency: string): string {
  const v = (cents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2 })
  return currency === 'RON' ? v + ' lei' : v + ' ' + currency
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ro-RO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Props {
  onBack: () => void
}

export default function FounderPage({ onBack }: Props) {
  const isMobile = useIsMobile()
  // Guard: null = se verifică; false = interzis (redirect); true = ok.
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [section, setSection] = useState<Section>('overview')

  useEffect(() => {
    let cancelled = false
    void isPlatformAdmin().then((ok) => {
      if (cancelled) return
      setAllowed(ok)
      if (!ok) onBack()
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (allowed !== true) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: D.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: D.t2,
        }}
      >
        Se verifică accesul...
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: D.bg, color: D.t1 }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: isMobile ? '20px 14px' : '32px 28px' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 18,
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: isMobile ? 26 : 32,
                fontWeight: 600,
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              Panou fondator
            </h1>
            <div style={{ fontSize: 13, color: D.t3, marginTop: 4 }}>
              Toată platforma, într-un singur loc. Acțiunile de modificare se înregistrează în audit.
            </div>
          </div>
          <button onClick={onBack} className="pressable" style={ghostBtn}>
            ← Înapoi la dashboard
          </button>
        </div>

        {/* Nav secțiuni */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: 22 }}>
          {SECTIONS.map((s) => {
            const active = section === s.id
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className="pressable"
                style={{
                  flexShrink: 0,
                  padding: '9px 16px',
                  minHeight: 40,
                  fontSize: '0.82rem',
                  fontFamily: 'DM Sans,sans-serif',
                  fontWeight: active ? 600 : 400,
                  border: `1px solid ${active ? D.gold + '55' : D.border}`,
                  borderRadius: 100,
                  cursor: 'pointer',
                  background: active ? D.goldA : 'transparent',
                  color: active ? D.goldL : D.t2,
                  whiteSpace: 'nowrap',
                }}
              >
                {s.label}
              </button>
            )
          })}
        </div>

        {section === 'overview' && <OverviewSection onGoTo={setSection} />}
        {section === 'restaurante' && <RestaurantsSection />}
        {section === 'operatiuni' && <OperationsSection />}
        {section === 'afiliati' && <AffiliatesSection />}
        {section === 'ai' && (
          <Suspense fallback={<InlineSpinner label="Se încarcă consumul AI..." />}>
            <FounderAiPanel />
          </Suspense>
        )}
        {section === 'audit' && <AuditSection />}
      </div>
    </div>
  )
}

// ── Stiluri comune ───────────────────────────────────────────
const ghostBtn: CSSProperties = {
  padding: '9px 16px',
  minHeight: 40,
  borderRadius: 10,
  border: `1px solid ${D.border}`,
  background: 'transparent',
  color: D.t2,
  cursor: 'pointer',
  fontSize: '0.82rem',
  fontFamily: 'DM Sans,sans-serif',
}

const primaryBtn: CSSProperties = {
  padding: '8px 14px',
  minHeight: 38,
  borderRadius: 9,
  border: 'none',
  background: D.gold,
  color: '#141414',
  cursor: 'pointer',
  fontSize: '0.78rem',
  fontWeight: 600,
  fontFamily: 'DM Sans,sans-serif',
}

const cardStyle: CSSProperties = {
  background: D.s2,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: 18,
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: '0.68rem',
  fontWeight: 700,
  color: D.t3,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '8px 10px',
  borderBottom: `1px solid ${D.border}`,
  whiteSpace: 'nowrap',
}

const tdStyle: CSSProperties = {
  fontSize: '0.82rem',
  color: D.t1,
  padding: '10px 10px',
  borderBottom: `1px solid ${D.border}`,
  verticalAlign: 'middle',
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        background: 'rgba(224,85,85,0.08)',
        border: '1px solid rgba(224,85,85,0.20)',
        color: D.red,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 13 }}>{message}</span>
      <button onClick={onRetry} className="pressable" style={ghostBtn}>
        Reîncearcă
      </button>
    </div>
  )
}

// Hook mic de fetch cu loading/error/reload — evită copy-paste în secțiuni.
function useAdminData<T>(fetcher: () => Promise<T>): {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetcher())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, error, reload }
}

// ── Vedere generală (KPI) ────────────────────────────────────
function OverviewSection({ onGoTo }: { onGoTo: (s: Section) => void }) {
  const { data, loading, error, reload } = useAdminData<PlatformOverview>(getPlatformOverview)

  if (loading) return <InlineSpinner label="Se încarcă vederea generală..." />
  if (error || !data) return <SectionError message={error ?? 'Eroare'} onRetry={() => void reload()} />

  const kpis: { label: string; value: number; alert?: boolean; goTo?: Section }[] = [
    { label: 'Restaurante active', value: data.restaurants_active, goTo: 'restaurante' },
    { label: 'Restaurante total', value: data.restaurants_total, goTo: 'restaurante' },
    { label: 'Comenzi azi', value: data.orders_today },
    { label: 'Rezervări azi', value: data.reservations_today },
    { label: 'Email-uri eșuate', value: data.emails_failed, alert: data.emails_failed > 0, goTo: 'operatiuni' },
    { label: 'Facturi eșuate', value: data.invoices_failed, alert: data.invoices_failed > 0, goTo: 'operatiuni' },
    { label: 'Payout-uri deschise', value: data.payouts_open, alert: data.payouts_open > 0, goTo: 'afiliati' },
    { label: 'Health critic (<50)', value: data.health_critical, alert: data.health_critical > 0, goTo: 'restaurante' },
  ]

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 18,
        }}
      >
        {kpis.map((k) => (
          <button
            key={k.label}
            onClick={() => k.goTo && onGoTo(k.goTo)}
            className="pressable"
            style={{
              ...cardStyle,
              textAlign: 'left',
              cursor: k.goTo ? 'pointer' : 'default',
              borderColor: k.alert ? 'rgba(224,85,85,0.35)' : D.border,
            }}
          >
            <div style={{ fontSize: '0.7rem', color: D.t3, marginBottom: 6 }}>{k.label}</div>
            <div
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: 28,
                fontWeight: 600,
                color: k.alert ? D.red : D.t1,
              }}
            >
              {k.value}
            </div>
          </button>
        ))}
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: '0.72rem', color: D.t3, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
          Restaurante pe plan
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PLANS.map((p) => (
            <span
              key={p}
              style={{
                padding: '6px 12px',
                borderRadius: 100,
                border: `1px solid ${D.border}`,
                background: D.s3,
                fontSize: '0.78rem',
                color: D.t2,
              }}
            >
              {PLAN_LABELS[p] || p}: <strong style={{ color: D.t1 }}>{data.restaurants_by_plan[p] ?? 0}</strong>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Restaurante ──────────────────────────────────────────────
function RestaurantsSection() {
  const toast = useToast()
  const { data, loading, error, reload } = useAdminData<AdminRestaurantRow[]>(listRestaurants)
  const [query, setQuery] = useState('')
  const [planFilter, setPlanFilter] = useState<string>('')
  const [busyId, setBusyId] = useState<string | null>(null)

  if (loading) return <InlineSpinner label="Se încarcă restaurantele..." />
  if (error || !data) return <SectionError message={error ?? 'Eroare'} onRetry={() => void reload()} />

  const filtered = data.filter((r) => {
    if (planFilter && r.plan !== planFilter) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      r.name.toLowerCase().includes(q) ||
      r.slug.toLowerCase().includes(q) ||
      (r.city ?? '').toLowerCase().includes(q) ||
      r.owner_email.toLowerCase().includes(q)
    )
  })

  async function changePlan(r: AdminRestaurantRow, plan: string) {
    if (plan === r.plan) return
    const ok = await confirm({
      title: `Schimbi planul pentru ${r.name}?`,
      description: `${PLAN_LABELS[r.plan] || r.plan} → ${PLAN_LABELS[plan] || plan}. Webhook-ul Stripe poate suprascrie la următorul eveniment de abonament.`,
      confirmLabel: 'Schimbă planul',
    })
    if (!ok) return
    setBusyId(r.restaurant_id)
    try {
      const res = await setRestaurantPlan(r.restaurant_id, plan)
      if (!res.ok) throw new Error(res.error ?? 'Eroare')
      toast.success(`Plan schimbat: ${PLAN_LABELS[plan] || plan}`)
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare la schimbarea planului')
    } finally {
      setBusyId(null)
    }
  }

  async function toggleActive(r: AdminRestaurantRow) {
    const ok = await confirm({
      title: r.is_active ? `Dezactivezi ${r.name}?` : `Reactivezi ${r.name}?`,
      description: r.is_active
        ? 'Meniul public și comenzile nu vor mai fi accesibile clienților.'
        : 'Restaurantul redevine vizibil clienților.',
      destructive: r.is_active,
      confirmLabel: r.is_active ? 'Dezactivează' : 'Reactivează',
    })
    if (!ok) return
    setBusyId(r.restaurant_id)
    try {
      const res = await toggleRestaurantActive(r.restaurant_id, !r.is_active)
      if (!res.ok) throw new Error(res.error ?? 'Eroare')
      toast.success(r.is_active ? 'Restaurant dezactivat' : 'Restaurant reactivat')
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Caută după nume, slug, oraș, email..."
          style={{
            flex: '1 1 240px',
            padding: '10px 14px',
            border: `1px solid ${D.border}`,
            borderRadius: 10,
            background: D.s3,
            color: D.t1,
            fontSize: 13,
            outline: 'none',
          }}
        />
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          style={{
            padding: '10px 14px',
            border: `1px solid ${D.border}`,
            borderRadius: 10,
            background: D.s3,
            color: D.t1,
            fontSize: 13,
          }}
        >
          <option value="">Toate planurile</option>
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {PLAN_LABELS[p] || p}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="table" title="Niciun restaurant" description="Schimbă filtrul sau căutarea." compact />
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={thStyle}>Restaurant</th>
                <th style={thStyle}>Plan</th>
                <th style={thStyle}>Health</th>
                <th style={thStyle}>Comenzi 7z</th>
                <th style={thStyle}>Stare</th>
                <th style={thStyle}>Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.restaurant_id}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: '0.72rem', color: D.t3 }}>
                      /{r.slug}
                      {r.city ? ` · ${r.city}` : ''} · {r.owner_email}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <select
                      value={r.plan}
                      disabled={busyId === r.restaurant_id}
                      onChange={(e) => void changePlan(r, e.target.value)}
                      aria-label={`Planul pentru ${r.name}`}
                      style={{
                        padding: '6px 8px',
                        border: `1px solid ${D.border}`,
                        borderRadius: 8,
                        background: D.s3,
                        color: D.t1,
                        fontSize: 12,
                      }}
                    >
                      {PLANS.map((p) => (
                        <option key={p} value={p}>
                          {PLAN_LABELS[p] || p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={tdStyle}>
                    {r.health_score == null ? (
                      <span style={{ color: D.t3 }}>—</span>
                    ) : (
                      <span
                        style={{
                          color: r.health_score < 50 ? D.red : r.health_score < 70 ? D.amber : D.green,
                          fontWeight: 600,
                        }}
                      >
                        {r.health_score}
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>{r.orders_7d}</td>
                  <td style={tdStyle}>
                    <span style={{ color: r.is_active ? D.green : D.red, fontSize: '0.78rem' }}>
                      {r.is_active ? 'Activ' : 'Inactiv'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => void enterFounderView(r.restaurant_id)}
                        className="pressable"
                        style={primaryBtn}
                        title="Deschide dashboardul acestui restaurant în mod fondator"
                      >
                        Intră pe cont
                      </button>
                      <button
                        onClick={() => void toggleActive(r)}
                        disabled={busyId === r.restaurant_id}
                        className="pressable"
                        style={{ ...ghostBtn, minHeight: 38, color: r.is_active ? D.red : D.green }}
                      >
                        {r.is_active ? 'Dezactivează' : 'Reactivează'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Operațiuni (cozi email + facturi) ────────────────────────
function OperationsSection() {
  const toast = useToast()
  const emails = useAdminData<AdminEmailFailure[]>(listEmailFailures)
  const invoices = useAdminData<AdminInvoiceFailure[]>(listInvoiceFailures)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function doRetryEmail(id: string) {
    setBusyId(id)
    try {
      const res = await retryEmail(id)
      if (!res.ok) throw new Error(res.error ?? 'Eroare')
      toast.success('Email repus în coadă')
      await emails.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare la retrimitere')
    } finally {
      setBusyId(null)
    }
  }

  async function doRetryInvoice(id: string) {
    setBusyId(id)
    try {
      const res = await retryInvoice(id)
      if (!res.ok) throw new Error(res.error ?? 'Eroare')
      toast.success('Factura repusă în coadă')
      await invoices.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare la reîncercare')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="mail" size={16} color={D.t2} />
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Email-uri eșuate</span>
        </div>
        {emails.loading ? (
          <InlineSpinner label="Se încarcă..." />
        ) : emails.error ? (
          <SectionError message={emails.error} onRetry={() => void emails.reload()} />
        ) : (emails.data ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: D.t3 }}>Nimic în dead-letter. Totul se trimite.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(emails.data ?? []).map((e) => (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '10px 12px',
                  background: D.s3,
                  borderRadius: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {e.recipient_email}{' '}
                    <span style={{ color: D.t3, fontWeight: 400 }}>· {e.template_kind}</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: D.red, overflowWrap: 'anywhere' }}>
                    {e.failed_attempts} încercări · {e.last_error ?? 'fără detalii'}
                  </div>
                </div>
                <button
                  onClick={() => void doRetryEmail(e.id)}
                  disabled={busyId === e.id}
                  className="pressable"
                  style={primaryBtn}
                >
                  Retrimite
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="chart" size={16} color={D.t2} />
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Facturi Oblio eșuate</span>
        </div>
        {invoices.loading ? (
          <InlineSpinner label="Se încarcă..." />
        ) : invoices.error ? (
          <SectionError message={invoices.error} onRetry={() => void invoices.reload()} />
        ) : (invoices.data ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: D.t3 }}>Nicio factură blocată.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(invoices.data ?? []).map((i) => (
              <div
                key={i.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '10px 12px',
                  background: D.s3,
                  borderRadius: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                    {i.restaurant_name}{' '}
                    <span style={{ color: D.t3, fontWeight: 400 }}>
                      · {i.customer_name} · {i.total_with_vat} {i.currency}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: D.red, overflowWrap: 'anywhere' }}>
                    {i.failed_attempts} încercări · {i.last_error ?? 'fără detalii'}
                  </div>
                </div>
                <button
                  onClick={() => void doRetryInvoice(i.id)}
                  disabled={busyId === i.id}
                  className="pressable"
                  style={primaryBtn}
                >
                  Reîncearcă
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Afiliați (arbore + restaurante + payouts) ────────────────
function AffiliatesSection() {
  const toast = useToast()
  const affiliates = useAdminData<AdminAffiliateRow[]>(listAffiliates)
  const payouts = useAdminData<AdminPayoutRow[]>(listPayouts)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function doMarkPaid(p: AdminPayoutRow) {
    const ok = await confirm({
      title: `Marchezi payout-ul ca plătit?`,
      description: `${p.affiliate_email} · ${formatMoney(p.gross_cents, p.currency)}. Debitul se înscrie în ledger — acțiune ireversibilă.`,
      confirmLabel: 'Marchează plătit',
    })
    if (!ok) return
    setBusyId(p.id)
    try {
      const res = await markPayoutPaid(p.id)
      if (!res.ok) throw new Error(res.error ?? 'Eroare')
      toast.success('Payout marcat plătit')
      // Plata scrie un rând negativ în ledger (trg_affiliate_payout_settle,
      // mig 098) → soldul din cardul „Afiliați" trebuie și el reîncărcat,
      // altfel arată o valoare bănească veche imediat după acțiune.
      await Promise.all([payouts.reload(), affiliates.reload()])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare')
    } finally {
      setBusyId(null)
    }
  }

  const affRows = affiliates.data ?? []
  // Arbore 1 nivel: părinți întâi, sub-afiliații imediat sub părinte, indentați.
  const parents = affRows.filter((a) => a.parent_affiliate_id == null)
  const children = affRows.filter((a) => a.parent_affiliate_id != null)
  const ordered: { row: AdminAffiliateRow; depth: number }[] = []
  for (const p of parents) {
    ordered.push({ row: p, depth: 0 })
    for (const c of children.filter((c) => c.parent_affiliate_id === p.affiliate_id)) {
      ordered.push({ row: c, depth: 1 })
    }
  }
  // Orfani (părinte inactiv/șters) — îi arătăm la final, nu-i pierdem.
  for (const c of children.filter((c) => !parents.some((p) => p.affiliate_id === c.parent_affiliate_id))) {
    ordered.push({ row: c, depth: 0 })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <CommissionDefaultsCard onApplied={() => void affiliates.reload()} />
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="users" size={16} color={D.t2} />
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Afiliați și restaurantele lor</span>
        </div>
        {affiliates.loading ? (
          <InlineSpinner label="Se încarcă afiliații..." />
        ) : affiliates.error ? (
          <SectionError message={affiliates.error} onRetry={() => void affiliates.reload()} />
        ) : ordered.length === 0 ? (
          <div style={{ fontSize: 13, color: D.t3 }}>Niciun afiliat înregistrat încă.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ordered.map(({ row: a, depth }) => (
              <div
                key={a.affiliate_id}
                style={{
                  padding: '12px 14px',
                  background: D.s3,
                  borderRadius: 10,
                  marginLeft: depth * 22,
                  borderLeft: depth > 0 ? `2px solid ${D.gold}55` : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {depth > 0 && <span style={{ color: D.t3 }}>↳ </span>}
                      {a.full_name || a.email}
                      <span style={{ color: D.t3, fontWeight: 400 }}> · cod {a.referral_code}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: D.t3, overflowWrap: 'anywhere' }}>
                      {a.email} · status {a.status}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: a.balance_ron_cents > 0 ? D.green : D.t2 }}>
                    Sold: {formatRon(a.balance_ron_cents)}
                  </div>
                </div>
                <AffiliateCommissionRow affiliate={a} onSaved={() => void affiliates.reload()} />
                {a.restaurants.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {a.restaurants.map((r) => (
                      <button
                        key={r.restaurant_id}
                        onClick={() => void enterFounderView(r.restaurant_id)}
                        className="pressable"
                        title="Deschide dashboardul restaurantului în mod fondator"
                        style={{
                          padding: '6px 12px',
                          minHeight: 34,
                          borderRadius: 100,
                          border: `1px solid ${D.border}`,
                          background: D.s2,
                          color: r.is_active ? D.t1 : D.t3,
                          fontSize: '0.74rem',
                          cursor: 'pointer',
                        }}
                      >
                        {r.name} · {PLAN_LABELS[r.plan] || r.plan}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="chart" size={16} color={D.t2} />
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Payout-uri</span>
        </div>
        {payouts.loading ? (
          <InlineSpinner label="Se încarcă payout-urile..." />
        ) : payouts.error ? (
          <SectionError message={payouts.error} onRetry={() => void payouts.reload()} />
        ) : (payouts.data ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: D.t3 }}>Niciun payout încă.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(payouts.data ?? []).map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '10px 12px',
                  background: D.s3,
                  borderRadius: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {p.affiliate_email} · {formatMoney(p.gross_cents, p.currency)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: D.t3 }}>
                    {p.status}
                    {p.invoice_number ? ` · factura ${p.invoice_number}` : ''}
                    {p.paid_at ? ` · plătit ${formatDate(p.paid_at)}` : ''}
                    {p.failure_reason ? ` · ${p.failure_reason}` : ''}
                  </div>
                </div>
                {(p.status === 'processing' || p.status === 'on_hold') && (
                  <button
                    onClick={() => void doMarkPaid(p)}
                    disabled={busyId === p.id}
                    className="pressable"
                    style={primaryBtn}
                  >
                    Marchează plătit
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Comisioane afiliat (mig 188) ─────────────────────────────
// UI-ul lucrează în PROCENTE (bps/100); conversia la bps se face la trimitere.
interface CommissionDraft {
  setup: string
  recurring: string
  cascade: string
  cap: string
}

function draftFromBps(setup: number, recurring: number, cascade: number, cap: number): CommissionDraft {
  return {
    setup: String(setup / 100),
    recurring: String(recurring / 100),
    cascade: String(cascade / 100),
    cap: String(cap),
  }
}

// null = draft invalid (mesajul de eroare se afișează în UI).
function draftToInput(d: CommissionDraft): CommissionInput | null {
  const setup = Math.round(parseFloat(d.setup) * 100)
  const recurring = Math.round(parseFloat(d.recurring) * 100)
  const cascade = Math.round(parseFloat(d.cascade) * 100)
  const cap = parseInt(d.cap, 10)
  if (
    !isFinite(setup) || setup < 0 || setup > 10000 ||
    !isFinite(recurring) || recurring < 0 || recurring > 10000 ||
    !isFinite(cascade) || cascade < 0 || cascade > 10000 ||
    !isFinite(cap) || cap < 0 || cap > 120
  ) {
    return null
  }
  return { setupBps: setup, recurringBps: recurring, cascadeBps: cascade, capMonths: cap }
}

function CommissionFields({
  draft,
  onChange,
}: {
  draft: CommissionDraft
  onChange: (d: CommissionDraft) => void
}) {
  const fieldStyle: CSSProperties = {
    width: 90,
    padding: '8px 10px',
    border: `1px solid ${D.border}`,
    borderRadius: 8,
    background: D.s3,
    color: D.t1,
    fontSize: 13,
  }
  const labelStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: '0.68rem',
    color: D.t3,
  }
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <label style={labelStyle}>
        Activare (%)
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={draft.setup}
          onChange={(e) => onChange({ ...draft, setup: e.target.value })}
          style={fieldStyle}
        />
      </label>
      <label style={labelStyle}>
        Lunar (%)
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={draft.recurring}
          onChange={(e) => onChange({ ...draft, recurring: e.target.value })}
          style={fieldStyle}
        />
      </label>
      <label style={labelStyle}>
        Cascade (%)
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={draft.cascade}
          onChange={(e) => onChange({ ...draft, cascade: e.target.value })}
          style={fieldStyle}
        />
      </label>
      <label style={labelStyle}>
        Plafon (luni)
        <input
          type="number"
          min={0}
          max={120}
          step={1}
          value={draft.cap}
          onChange={(e) => onChange({ ...draft, cap: e.target.value })}
          style={fieldStyle}
        />
      </label>
    </div>
  )
}

function CommissionDefaultsCard({ onApplied }: { onApplied: () => void }) {
  const toast = useToast()
  const defaults = useAdminData<AffiliateCommissionDefaults>(getAffiliateDefaults)
  const [draft, setDraft] = useState<CommissionDraft | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (defaults.data && draft == null) {
      setDraft(
        draftFromBps(
          defaults.data.setup_bps,
          defaults.data.recurring_bps,
          defaults.data.cascade_bps,
          defaults.data.recurring_cap_months,
        ),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults.data])

  async function save() {
    if (!draft) return
    const input = draftToInput(draft)
    if (!input) {
      toast.error('Valori invalide: procentele 0–100, plafonul 0–120 luni.')
      return
    }
    setBusy(true)
    try {
      const res = await setAffiliateDefaults(input)
      if (!res.ok) throw new Error(res.error ?? 'Eroare')
      toast.success('Comisionul implicit salvat — se aplică afiliaților NOI')
      await defaults.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare la salvare')
    } finally {
      setBusy(false)
    }
  }

  async function applyToAll() {
    const ok = await confirm({
      title: 'Aplici comisionul implicit la TOȚI afiliații?',
      description:
        'Suprascrie orice comision individual setat manual. Are efect imediat pe facturile viitoare (cele deja creditate nu se schimbă).',
      confirmLabel: 'Aplică la toți',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await applyDefaultsToAllAffiliates()
      if (!res.ok) throw new Error(res.error ?? 'Eroare')
      toast.success(`Comision aplicat la ${res.updated_count ?? 0} afiliați`)
      onApplied()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare la aplicare')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon name="settings" size={16} color={D.t2} />
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Comision implicit</span>
      </div>
      <div style={{ fontSize: '0.72rem', color: D.t3, marginBottom: 12 }}>
        Se aplică automat afiliaților noi la înscriere. „Aplică la toți" îl suprascrie și pe cei
        existenți. Modificările au efect imediat pe facturile viitoare.
      </div>
      {/* Eroarea SE VERIFICĂ înaintea draft-ului: la eșecul fetch-ului inițial
          draft rămâne null pentru totdeauna și spinner-ul ar câștiga mereu. */}
      {defaults.error ? (
        <SectionError message={defaults.error} onRetry={() => void defaults.reload()} />
      ) : defaults.loading || draft == null ? (
        <InlineSpinner label="Se încarcă..." />
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <CommissionFields draft={draft} onChange={setDraft} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => void save()} disabled={busy} className="pressable" style={primaryBtn}>
              Salvează
            </button>
            <button
              onClick={() => void applyToAll()}
              disabled={busy}
              className="pressable"
              style={{ ...ghostBtn, minHeight: 38, color: D.red, borderColor: 'rgba(224,85,85,0.3)' }}
            >
              Aplică la toți
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AffiliateCommissionRow({
  affiliate,
  onSaved,
}: {
  affiliate: AdminAffiliateRow
  onSaved: () => void
}) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CommissionDraft | null>(null)
  const [busy, setBusy] = useState(false)

  const hasBps =
    affiliate.setup_bps != null &&
    affiliate.recurring_bps != null &&
    affiliate.cascade_bps != null &&
    affiliate.recurring_cap_months != null

  function startEdit() {
    if (!hasBps) return
    setDraft(
      draftFromBps(
        affiliate.setup_bps!,
        affiliate.recurring_bps!,
        affiliate.cascade_bps!,
        affiliate.recurring_cap_months!,
      ),
    )
    setEditing(true)
  }

  async function save() {
    if (!draft) return
    const input = draftToInput(draft)
    if (!input) {
      toast.error('Valori invalide: procentele 0–100, plafonul 0–120 luni.')
      return
    }
    setBusy(true)
    try {
      const res = await setAffiliateCommission(affiliate.affiliate_id, input)
      if (!res.ok) throw new Error(res.error ?? 'Eroare')
      toast.success('Comision actualizat — efect imediat pe facturile viitoare')
      setEditing(false)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare la salvare')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      {!editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', color: D.t2 }}>
            {hasBps
              ? `Activare ${(affiliate.setup_bps! / 100).toLocaleString('ro-RO')}% · Lunar ${(affiliate.recurring_bps! / 100).toLocaleString('ro-RO')}% (${affiliate.recurring_cap_months} luni) · Cascade ${(affiliate.cascade_bps! / 100).toLocaleString('ro-RO')}%`
              : 'Comision: — (rulează migrația 188)'}
          </span>
          {hasBps && (
            <button
              onClick={startEdit}
              className="pressable"
              style={{
                padding: '4px 12px',
                minHeight: 30,
                borderRadius: 100,
                border: `1px solid ${D.border}`,
                background: 'transparent',
                color: D.t2,
                fontSize: '0.7rem',
                cursor: 'pointer',
              }}
            >
              Modifică
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {draft && <CommissionFields draft={draft} onChange={setDraft} />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => void save()} disabled={busy} className="pressable" style={primaryBtn}>
              Salvează
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className="pressable"
              style={{ ...ghostBtn, minHeight: 38 }}
            >
              Anulează
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Audit ────────────────────────────────────────────────────
function AuditSection() {
  const { data, loading, error, reload } = useAdminData<AdminAuditRow[]>(() => listAuditLog(100))

  if (loading) return <InlineSpinner label="Se încarcă auditul..." />
  if (error || !data) return <SectionError message={error ?? 'Eroare'} onRetry={() => void reload()} />
  if (data.length === 0)
    return (
      <EmptyState
        icon="settings"
        title="Nicio acțiune înregistrată"
        description="Acțiunile de modificare din panoul de fondator apar aici."
        compact
      />
    )

  return (
    <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
        <thead>
          <tr>
            <th style={thStyle}>Când</th>
            <th style={thStyle}>Cine</th>
            <th style={thStyle}>Acțiune</th>
            <th style={thStyle}>Restaurant</th>
            <th style={thStyle}>Detalii</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id}>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(row.created_at)}</td>
              <td style={tdStyle}>
                {row.actor_email}
                <span style={{ color: D.t3 }}> ({row.actor_kind})</span>
              </td>
              <td style={tdStyle}>{row.action}</td>
              <td style={tdStyle}>{row.restaurant_name ?? '—'}</td>
              <td style={{ ...tdStyle, fontSize: '0.72rem', color: D.t3, overflowWrap: 'anywhere' }}>
                {JSON.stringify(row.details)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

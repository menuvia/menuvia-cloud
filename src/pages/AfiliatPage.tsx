// src/pages/AfiliatPage.tsx
// Panoul afiliatului: vede restaurantele aduse, sub-afiliații, câștigurile și
// își ia link-ul/QR-ul de referral. Date prin RPC get_affiliate_dashboard
// (vezi mig 097D). Stil inline cu tokens `D`, fără Tailwind, UI în română.

import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { D } from '../lib/constants'
import { useAffiliate } from '../hooks/useAffiliate'
import { formatRON, referralUrl } from '../lib/affiliate'
import { useToast } from '../components/ui/useToast'
import { PageSpinner } from '../components/PageLoader'

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
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
} as const

function MetricCard({
  label,
  value,
  hint,
  accent,
  big,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
  big?: boolean
}) {
  return (
    <div style={{ ...card, ...(accent ? { border: `1px solid ${D.gold}44` } : null) }}>
      <div
        style={{
          fontSize: '0.7rem',
          color: D.t2,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'Fraunces,serif',
          fontSize: big ? '2.4rem' : '1.7rem',
          color: accent ? D.gold : D.t1,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {hint ? <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 6 }}>{hint}</div> : null}
    </div>
  )
}

type Tab = 'acasa' | 'restaurante' | 'subafiliati' | 'unelte'

const TABS: { id: Tab; label: string }[] = [
  { id: 'acasa', label: 'Acasă' },
  { id: 'restaurante', label: 'Restaurante' },
  { id: 'subafiliati', label: 'Sub-afiliați' },
  { id: 'unelte', label: 'Unelte' },
]

function formatDateRo(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AfiliatPage() {
  const { dashboard, loading, error, register } = useAffiliate()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('acasa')
  const [registering, setRegistering] = useState(false)

  if (loading) return <PageSpinner label="Se încarcă panoul de afiliat…" />

  if (error) {
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: 24, textAlign: 'center', color: D.t2 }}>
        Nu am putut încărca panoul de afiliat. Reîncarcă pagina.
      </div>
    )
  }

  // ── Onboarding: userul nu e încă afiliat ──────────────────────────────────
  if (!dashboard || !dashboard.is_affiliate) {
    const join = async () => {
      setRegistering(true)
      const res = await register()
      setRegistering(false)
      if (res.ok) toast.success('Bun venit în programul de afiliere!')
      else toast.error('Nu te-am putut înscrie. Încearcă din nou.')
    }
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: 24 }}>
        <div style={{ ...card, textAlign: 'center', padding: '40px 28px' }}>
          <div style={{ fontSize: '2.4rem', marginBottom: 12 }}>🤝</div>
          <h1 style={{ fontFamily: 'Fraunces,serif', color: D.t1, fontSize: '1.6rem', margin: '0 0 10px' }}>
            Devino afiliat Menuvia
          </h1>
          <p style={{ color: D.t2, fontSize: '0.95rem', lineHeight: 1.5, margin: '0 0 24px' }}>
            Recomandă Menuvia restaurantelor și câștigi comision din fiecare abonament adus —
            o singură dată la activare și apoi lunar, cât timp restaurantul rămâne client.
          </p>
          <button style={{ ...goldBtn, padding: '12px 22px' }} disabled={registering} onClick={() => void join()}>
            {registering ? 'Se înscrie…' : 'Înscrie-mă →'}
          </button>
        </div>
      </div>
    )
  }

  const aff = dashboard.affiliate
  const earnings = dashboard.earnings
  const restaurants = dashboard.restaurants ?? []
  const subs = dashboard.sub_affiliates ?? []
  if (!aff) return <PageSpinner />

  const activeCount = restaurants.filter((r) => r.status === 'active').length

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 16px 64px', color: D.t1 }}>
      <header style={{ marginBottom: 20 }}>
        <div style={{ fontSize: '0.72rem', color: D.t2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Program de afiliere
        </div>
        <h1 style={{ fontFamily: 'Fraunces,serif', fontSize: '1.8rem', margin: '4px 0 0' }}>Panoul tău</h1>
      </header>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? D.goldA : 'transparent',
              color: tab === t.id ? D.gold : D.t2,
              border: `1px solid ${tab === t.id ? `${D.gold}55` : D.border}`,
              borderRadius: 9,
              padding: '8px 14px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'acasa' ? (
        <AcasaTab
          activeCount={activeCount}
          totalCount={restaurants.length}
          subsCount={subs.length}
          earnings={earnings}
          nextPayoutAt={dashboard.next_payout_at}
        />
      ) : null}
      {tab === 'restaurante' ? <RestauranteTab restaurants={restaurants} /> : null}
      {tab === 'subafiliati' ? <SubafiliatiTab subs={subs} cascadeBps={aff.cascade_bps} /> : null}
      {tab === 'unelte' ? <UnelteTab code={aff.referral_code} toast={toast} /> : null}
    </div>
  )
}

// ── Tab: Acasă ───────────────────────────────────────────────────────────────
function AcasaTab({
  activeCount,
  totalCount,
  subsCount,
  earnings,
  nextPayoutAt,
}: {
  activeCount: number
  totalCount: number
  subsCount: number
  earnings?: { total_cents: number; confirmed_cents: number; pending_cents: number; paid_cents: number }
  nextPayoutAt?: string | null
}) {
  const e = earnings
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        <MetricCard label="Restaurante active" value={String(activeCount)} hint={`${totalCount} aduse în total`} accent />
        <MetricCard label="Confirmat (de plată)" value={formatRON(e?.confirmed_cents)} accent />
        <MetricCard label="În așteptare" value={formatRON(e?.pending_cents)} hint="trece de hold în curând" />
        <MetricCard label="Total câștigat" value={formatRON(e?.total_cents)} />
        <MetricCard label="Plătit" value={formatRON(e?.paid_cents)} />
        <MetricCard label="Sub-afiliați" value={String(subsCount)} />
      </div>

      <div style={card}>
        <div style={{ fontSize: '0.72rem', color: D.t2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Următoarea plată estimată
        </div>
        <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.3rem', color: D.t1, marginTop: 6 }}>
          {formatDateRo(nextPayoutAt)}
        </div>
        <div style={{ fontSize: '0.78rem', color: D.t2, marginTop: 8, lineHeight: 1.5 }}>
          Comisioanele de activare au un hold de 60 de zile (protecție anti-fraudă); cele lunare, 14 zile.
          Plata se face după ce emiți factura către Menuvia.
        </div>
      </div>
    </div>
  )
}

// ── Tab: Restaurante ─────────────────────────────────────────────────────────
function RestauranteTab({
  restaurants,
}: {
  restaurants: {
    attribution_id: string
    status: string
    captured_at: string
    restaurant_names: string[]
    city: string | null
    commission_cents: number
  }[]
}) {
  if (restaurants.length === 0) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: '40px 24px', color: D.t2 }}>
        Încă n-ai adus niciun restaurant. Împărtășește link-ul tău din tab-ul „Unelte".
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {restaurants.map((r) => {
        const name = r.restaurant_names[0] ?? 'Cont nou'
        return (
          <div
            key={r.attribution_id}
            style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
          >
            <div>
              <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.95rem' }}>{name}</div>
              <div style={{ color: D.t2, fontSize: '0.78rem', marginTop: 2 }}>
                {(r.city ?? '—') + ' · ' + statusLabel(r.status)}
              </div>
            </div>
            <div style={{ color: D.gold, fontFamily: 'Fraunces,serif', fontSize: '1.1rem', fontWeight: 700 }}>
              {formatRON(r.commission_cents)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Tab: Sub-afiliați ────────────────────────────────────────────────────────
function SubafiliatiTab({
  subs,
  cascadeBps,
}: {
  subs: { referral_code: string; status: string; joined_at: string; attributions_count: number }[]
  cascadeBps: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, fontSize: '0.82rem', color: D.t2, lineHeight: 1.5 }}>
        Primești <strong style={{ color: D.gold }}>{(cascadeBps / 100).toFixed(0)}%</strong> din comisioanele
        afiliaților pe care îi recomanzi tu (un singur nivel).
      </div>
      {subs.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '32px 24px', color: D.t2 }}>
          N-ai încă sub-afiliați.
        </div>
      ) : (
        subs.map((s) => (
          <div
            key={s.referral_code}
            style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <div>
              <div style={{ color: D.t1, fontWeight: 600 }}>cod: {s.referral_code}</div>
              <div style={{ color: D.t2, fontSize: '0.78rem', marginTop: 2 }}>
                {statusLabel(s.status)} · înscris {formatDateRo(s.joined_at)}
              </div>
            </div>
            <div style={{ color: D.t2, fontSize: '0.82rem' }}>{s.attributions_count} aduse</div>
          </div>
        ))
      )}
    </div>
  )
}

// ── Tab: Unelte (link + QR + share) ──────────────────────────────────────────
function UnelteTab({ code, toast }: { code: string; toast: ReturnType<typeof useToast> }) {
  const url = referralUrl(code)
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void QRCode.toDataURL(url, { width: 600, margin: 1, color: { dark: '#1A1208', light: '#F8F3EB' } }).then(
      (dataUrl) => {
        if (!cancelled) setQr(dataUrl)
      },
    )
    return () => {
      cancelled = true
    }
  }, [url])

  const copy = () => {
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Link copiat'))
      .catch(() => toast.error('Nu s-a putut copia link-ul'))
  }

  const share = () => {
    const nav = navigator as Navigator & { share?: (data: { title: string; text: string; url: string }) => Promise<void> }
    if (nav.share) {
      void nav.share({ title: 'Menuvia', text: 'Încearcă Menuvia pentru restaurantul tău', url }).catch(() => {
        /* user a anulat — ignor */
      })
    } else {
      copy()
    }
  }

  const downloadQr = () => {
    if (!qr) return
    const a = document.createElement('a')
    a.href = qr
    a.download = `menuvia-afiliat-${code}.png`
    a.click()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: '0.72rem', color: D.t2, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Link-ul tău de referral
        </div>
        <div
          style={{
            background: D.s1,
            border: `1px solid ${D.border}`,
            borderRadius: 9,
            padding: '10px 12px',
            color: D.t1,
            fontSize: '0.85rem',
            wordBreak: 'break-all',
            marginBottom: 12,
          }}
        >
          {url}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={goldBtn} onClick={copy}>
            Copiază
          </button>
          <button
            style={{
              background: 'transparent',
              color: D.t1,
              border: `1px solid ${D.border}`,
              borderRadius: 9,
              padding: '10px 16px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
            }}
            onClick={share}
          >
            Distribuie
          </button>
        </div>
      </div>

      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: '0.72rem', color: D.t2, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          Cod QR (printabil pentru flyere)
        </div>
        {qr ? (
          <img src={qr} alt="QR referral" style={{ width: 220, height: 220, borderRadius: 12 }} />
        ) : (
          <div style={{ color: D.t2, fontSize: '0.82rem', padding: 40 }}>Se generează…</div>
        )}
        <div style={{ marginTop: 12 }}>
          <button style={goldBtn} disabled={!qr} onClick={downloadQr}>
            Descarcă PNG
          </button>
        </div>
      </div>
    </div>
  )
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Activ'
    case 'pending':
      return 'În așteptare'
    case 'paused':
      return 'Pauzat'
    case 'canceled':
      return 'Anulat'
    case 'refunded':
      return 'Refundat'
    default:
      return status
  }
}

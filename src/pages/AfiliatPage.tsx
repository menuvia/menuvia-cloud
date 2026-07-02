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
import { supabase } from '../lib/supabase'
import {
  listPartnerRestaurants,
  enterFounderView,
  type PartnerRestaurant,
} from '../lib/founder'

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
  const [parentCode, setParentCode] = useState('')

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
      const res = await register(parentCode.trim() || undefined)
      setRegistering(false)
      if (res.ok) toast.success('Bun venit în programul de afiliere!')
      else if (res.reason === 'parent_not_found') toast.error('Codul celui care te-a invitat nu e valid.')
      else toast.error('Nu te-am putut înscrie. Încearcă din nou.')
    }
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: 24 }}>
        <div style={{ ...card, textAlign: 'center', padding: '40px 28px' }}>
          <div style={{ fontSize: '2.4rem', marginBottom: 12 }}>🤝</div>
          <h1 style={{ fontFamily: 'Fraunces,serif', color: D.t1, fontSize: '1.6rem', margin: '0 0 10px' }}>
            Devino afiliat Menuvia
          </h1>
          <p style={{ color: D.t2, fontSize: '0.95rem', lineHeight: 1.5, margin: '0 0 20px' }}>
            {dashboard?.defaults ? (
              <>
                Recomandă Menuvia restaurantelor și primești{' '}
                <strong style={{ color: D.t1 }}>
                  {(dashboard.defaults.setup_bps / 100).toLocaleString('ro-RO')}%
                </strong>{' '}
                din prima factură a fiecărui restaurant adus, apoi{' '}
                <strong style={{ color: D.t1 }}>
                  {(dashboard.defaults.recurring_bps / 100).toLocaleString('ro-RO')}%
                </strong>{' '}
                din abonament, lunar, timp de {dashboard.defaults.recurring_cap_months} luni.
              </>
            ) : (
              <>
                Recomandă Menuvia restaurantelor și câștigi comision din fiecare abonament adus —
                o singură dată la activare și apoi lunar, cât timp restaurantul rămâne client.
              </>
            )}
          </p>
          {/* Cod opțional al celui care te-a invitat (sub-afiliere). */}
          <input
            value={parentCode}
            onChange={(e) => setParentCode(e.target.value)}
            placeholder="Cod de invitație (opțional)"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: D.s1,
              border: `1px solid ${D.border}`,
              borderRadius: 9,
              padding: '10px 12px',
              color: D.t1,
              fontSize: '0.85rem',
              marginBottom: 16,
              fontFamily: 'DM Sans,sans-serif',
            }}
          />
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
          commission={{
            setupBps: aff.setup_bps,
            recurringBps: aff.recurring_bps,
            cascadeBps: aff.cascade_bps,
            capMonths: aff.recurring_cap_months,
          }}
        />
      ) : null}
      {tab === 'restaurante' ? (
        <RestauranteTab restaurants={restaurants} currency={earnings?.currency || 'RON'} />
      ) : null}
      {tab === 'subafiliati' ? (
        <SubafiliatiTab subs={subs} cascadeBps={aff.cascade_bps} code={aff.referral_code} toast={toast} />
      ) : null}
      {tab === 'unelte' ? (
        <UnelteTab code={aff.referral_code} affiliateId={aff.id} toast={toast} />
      ) : null}
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
  commission,
}: {
  activeCount: number
  totalCount: number
  subsCount: number
  earnings?: {
    currency: string
    total_cents: number
    confirmed_cents: number
    pending_cents: number
    paid_cents: number
    clawed_back_cents: number
  }
  nextPayoutAt?: string | null
  commission: {
    setupBps: number
    recurringBps: number
    cascadeBps: number
    capMonths: number
  }
}) {
  const e = earnings
  // Moneda câștigurilor (default 'RON' dacă lipsește) — o pasăm la formatRON.
  const cur = e?.currency || 'RON'
  const pct = (bps: number) => (bps / 100).toLocaleString('ro-RO') + '%'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Comisioanele reale ale afiliatului (setate de platformă, mig 188) —
          transparență: cifrele exacte, nu text generic. */}
      <div style={card}>
        <div style={{ fontSize: '0.72rem', color: D.t2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Comisioanele tale
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10 }}>
          <div>
            <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.3rem', color: D.gold }}>
              {pct(commission.setupBps)}
            </div>
            <div style={{ fontSize: '0.74rem', color: D.t2 }}>din prima factură (activare)</div>
          </div>
          <div>
            <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.3rem', color: D.gold }}>
              {pct(commission.recurringBps)}
            </div>
            <div style={{ fontSize: '0.74rem', color: D.t2 }}>
              lunar, max {commission.capMonths} luni
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.3rem', color: D.gold }}>
              {pct(commission.cascadeBps)}
            </div>
            <div style={{ fontSize: '0.74rem', color: D.t2 }}>din comisioanele sub-afiliaților</div>
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        <MetricCard label="Restaurante active" value={String(activeCount)} hint={`${totalCount} aduse în total`} accent />
        <MetricCard label="Confirmat (de plată)" value={formatRON(e?.confirmed_cents, cur)} accent />
        <MetricCard label="În așteptare" value={formatRON(e?.pending_cents, cur)} hint="trece de hold în curând" />
        <MetricCard label="Total câștigat" value={formatRON(e?.total_cents, cur)} />
        <MetricCard label="Plătit" value={formatRON(e?.paid_cents, cur)} />
        {/* Stornat (clawback): afișat doar când e > 0, ca să nu apară 0 inutil. */}
        {e && e.clawed_back_cents > 0 ? (
          <MetricCard label="Stornat (clawback)" value={formatRON(e.clawed_back_cents, cur)} hint="comisioane retrase" />
        ) : null}
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
// Restaurantele partenere cu acces activ (mig 187): afiliatul poate intra
// pe dashboardul lor (rol virtual de manager, revocabil de owner, cu banner
// „Mod partener" + vizită logată în audit).
function PartnerAccessList() {
  const [partners, setPartners] = useState<PartnerRestaurant[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    listPartnerRestaurants()
      .then((rows) => {
        if (!cancelled) setPartners(rows)
      })
      .catch(() => {
        /* fără acces / eroare — secțiunea nu se afișează */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!loaded || partners.length === 0) return null

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>
        Acces de partener
      </div>
      <div style={{ color: D.t2, fontSize: '0.78rem', marginBottom: 12 }}>
        Poți intra pe dashboardul restaurantelor aduse de tine ca să le ajuți cu configurarea.
        Ownerul vede accesul tău și îl poate opri oricând.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {partners.map((p) => (
          <div
            key={p.restaurant_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              padding: '10px 12px',
              background: D.s3,
              borderRadius: 10,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.85rem' }}>{p.name}</div>
              <div style={{ color: D.t2, fontSize: '0.72rem' }}>
                {(p.city ?? '—') + ' · ' + (p.is_active ? 'activ' : 'inactiv')}
              </div>
            </div>
            <button onClick={() => void enterFounderView(p.restaurant_id)} style={goldBtn}>
              Intră pe dashboard
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function RestauranteTab({
  restaurants,
  currency,
}: {
  restaurants: {
    attribution_id: string
    status: string
    captured_at: string
    restaurant_names: string[]
    city: string | null
    commission_cents: number
  }[]
  currency: string
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
      <PartnerAccessList />
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
              {formatRON(r.commission_cents, currency)}
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
  code,
  toast,
}: {
  subs: { referral_code: string; status: string; joined_at: string; attributions_count: number }[]
  cascadeBps: number
  code: string
  toast: ReturnType<typeof useToast>
}) {
  // Cei pe care îi recrutezi se înscriu cu CODUL TĂU în câmpul „Cod de invitație".
  const copyCode = () => {
    // navigator.clipboard e undefined pe context non-secure → guard ca să nu arunce sincron.
    if (!navigator.clipboard) {
      toast.error('Copierea nu e disponibilă în acest browser')
      return
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => toast.success('Cod copiat'))
      .catch(() => toast.error('Nu s-a putut copia codul'))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, fontSize: '0.82rem', color: D.t2, lineHeight: 1.5 }}>
        Primești <strong style={{ color: D.gold }}>{(cascadeBps / 100).toFixed(0)}%</strong> din comisioanele
        afiliaților pe care îi recomanzi tu (un singur nivel).
      </div>

      {/* Recrutare: codul propriu, de pus de noul afiliat la înscriere. */}
      <div style={card}>
        <div
          style={{
            fontSize: '0.72rem',
            color: D.t2,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 8,
          }}
        >
          Recrutează un afiliat
        </div>
        <div style={{ fontSize: '0.82rem', color: D.t2, lineHeight: 1.5, marginBottom: 10 }}>
          Dă-i codul tău. Când se înscrie ca afiliat, îl pune în câmpul „Cod de invitație" și intră
          sub tine.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <code
            style={{
              background: D.s1,
              border: `1px solid ${D.border}`,
              borderRadius: 9,
              padding: '8px 14px',
              color: D.gold,
              fontSize: '1rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}
          >
            {code}
          </code>
          <button style={goldBtn} onClick={copyCode}>
            Copiază codul
          </button>
        </div>
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

// ── Tab: Unelte (link + QR + share + date de plată) ──────────────────────────
function UnelteTab({
  code,
  affiliateId,
  toast,
}: {
  code: string
  affiliateId: string
  toast: ReturnType<typeof useToast>
}) {
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
    // navigator.clipboard e undefined pe context non-secure → guard ca să nu arunce sincron.
    if (!navigator.clipboard) {
      toast.error('Copierea nu e disponibilă în acest browser')
      return
    }
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

      <PayoutProfileForm affiliateId={affiliateId} toast={toast} />
    </div>
  )
}

// ── Date fiscale/bancare (payout) ────────────────────────────────────────────
// Citire prin RLS (policy „read own payout profile", mig 098); scriere prin RPC
// SECURITY DEFINER upsert_payout_profile (mig 101) — scrierile directe sunt REVOKE.
function PayoutProfileForm({
  affiliateId,
  toast,
}: {
  affiliateId: string
  toast: ReturnType<typeof useToast>
}) {
  const [legalForm, setLegalForm] = useState<'pfa' | 'srl' | 'other'>('pfa')
  const [cui, setCui] = useState('')
  const [iban, setIban] = useState('')
  const [beneficiary, setBeneficiary] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void supabase
      .from('affiliate_payout_profile')
      .select('legal_form, cui, iban, beneficiary_name')
      .eq('affiliate_id', affiliateId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) {
          if (!cancelled) setLoading(false)
          return
        }
        const row = data as {
          legal_form: 'pfa' | 'srl' | 'other'
          cui: string | null
          iban: string | null
          beneficiary_name: string | null
        }
        setLegalForm(row.legal_form ?? 'pfa')
        setCui(row.cui ?? '')
        setIban(row.iban ?? '')
        setBeneficiary(row.beneficiary_name ?? '')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [affiliateId])

  const save = () => {
    // Normalizăm IBAN-ul: scoatem spațiile (interne și de capăt) și uppercase.
    // Trimitem forma normalizată; RPC-ul rămâne sursa de adevăr a validării.
    const ibanNorm = iban.replace(/\s+/g, '').toUpperCase()
    // Feedback rapid pe client: pattern RO de bază (RO + 2 cifre + 20 alfanumerice).
    if (!/^RO\d{2}[A-Z0-9]{20}$/.test(ibanNorm)) {
      toast.error('IBAN invalid. Format așteptat: RO urmat de 22 de caractere (ex: RO49AAAA1B31007593840000).')
      return
    }
    setSaving(true)
    void supabase
      .rpc('upsert_payout_profile', {
        p_legal_form: legalForm,
        p_cui: cui.trim() || null,
        p_iban: ibanNorm,
        p_beneficiary_name: beneficiary.trim() || null,
      })
      .then(
        ({ data, error }) => {
          setSaving(false)
          const res = data as { ok: boolean; reason?: string } | null
          if (error || !res?.ok) {
            if (res?.reason === 'invalid_iban') toast.error('IBAN invalid.')
            else if (res?.reason === 'invalid_legal_form') toast.error('Formă juridică invalidă.')
            else toast.error('Nu am putut salva datele de plată.')
            return
          }
          toast.success('Date de plată salvate.')
        },
        () => {
          setSaving(false)
          toast.error('Nu am putut salva datele de plată.')
        },
      )
  }

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    background: D.s1,
    border: `1px solid ${D.border}`,
    borderRadius: 9,
    padding: '10px 12px',
    color: D.t1,
    fontSize: '0.85rem',
    fontFamily: 'DM Sans,sans-serif',
  } as const
  const labelStyle = { fontSize: '0.75rem', color: D.t2, marginBottom: 4, display: 'block' } as const

  return (
    <div style={card}>
      <div
        style={{
          fontSize: '0.72rem',
          color: D.t2,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        Date de plată
      </div>
      <div style={{ fontSize: '0.78rem', color: D.t2, lineHeight: 1.5, marginBottom: 14 }}>
        Comisioanele se plătesc pe baza facturii pe care o emiți către Menuvia. Completează datele
        de facturare și IBAN-ul ca să putem face plata.
      </div>
      {loading ? (
        <div style={{ color: D.t2, fontSize: '0.82rem', padding: 8 }}>Se încarcă…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Formă juridică</label>
            <select
              value={legalForm}
              onChange={(e) => setLegalForm(e.target.value as 'pfa' | 'srl' | 'other')}
              style={inputStyle}
            >
              <option value="pfa">PFA / Întreprindere individuală</option>
              <option value="srl">SRL</option>
              <option value="other">Altă formă</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>CUI / CIF</label>
            <input value={cui} onChange={(e) => setCui(e.target.value)} placeholder="RO12345678" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Nume beneficiar (cont)</label>
            <input
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder="Ex: Popescu Ion PFA"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>IBAN</label>
            <input
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              placeholder="RO49 AAAA 1B31 0075 9384 0000"
              style={inputStyle}
            />
          </div>
          <div>
            <button style={goldBtn} disabled={saving} onClick={save}>
              {saving ? 'Se salvează…' : 'Salvează datele de plată'}
            </button>
          </div>
        </div>
      )}
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

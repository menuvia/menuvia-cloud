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
import { Icon } from '../components/ui/Icon'
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
  minHeight: 44,
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
} as const

// Stil aplicat peste goldBtn când butonul e disabled — altfel butonul rămâne
// gold plin cu cursor pointer și utilizatorul nu vede că nu poate apăsa.
const disabledBtn = { opacity: 0.55, cursor: 'not-allowed' } as const

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

type Tab = 'acasa' | 'restaurante' | 'subafiliati' | 'unelte' | 'ghid'

const TABS: { id: Tab; label: string }[] = [
  { id: 'acasa', label: 'Acasă' },
  { id: 'restaurante', label: 'Restaurante' },
  { id: 'subafiliati', label: 'Sub-afiliați' },
  { id: 'unelte', label: 'Unelte' },
  { id: 'ghid', label: 'Ghid' },
]

function formatDateRo(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Basis points → procent formatat ro-RO, FĂRĂ sufixul „%" (semnul se pune la
// locul afișării). Ex: 1250 → „12,5". Formatarea trebuie să rămână identică
// cu expresia repetată `(bps / 100).toLocaleString('ro-RO')`.
function bpsToPct(bps: number): string {
  return (bps / 100).toLocaleString('ro-RO')
}

export default function AfiliatPage() {
  const { dashboard, loading, error, register } = useAffiliate()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('acasa')
  const [registering, setRegistering] = useState(false)
  const [parentCode, setParentCode] = useState('')
  // Cererea de afiliere (mig 224): telefonul e obligatoriu (interviu telefonic).
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')

  if (loading) return <PageSpinner label="Se încarcă panoul de afiliat…" />

  if (error) {
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: 24, textAlign: 'center', color: D.t2 }}>
        <div style={{ marginBottom: 14 }}>Nu am putut încărca panoul de afiliat.</div>
        <button style={goldBtn} onClick={() => window.location.reload()}>
          Reîncearcă
        </button>
      </div>
    )
  }

  // ── Cererea de afiliere (mig 224): userul nu a aplicat încă ────────────────
  // Fluxul e cu APROBARE: candidatul trimite telefon + cum va recomanda,
  // fondatorul îl sună pentru o discuție scurtă, apoi aprobă/respinge.
  if (!dashboard || !dashboard.is_affiliate) {
    const phoneOk = phone.trim().length >= 5 && phone.trim().length <= 32
    const join = async () => {
      if (!phoneOk) {
        toast.error('Te rugăm să lași un număr de telefon — te sunăm pentru o discuție scurtă.')
        return
      }
      setRegistering(true)
      const res = await register(parentCode.trim() || undefined, phone.trim(), note.trim() || undefined)
      setRegistering(false)
      if (res.ok) toast.success('Cererea a fost trimisă! Te contactăm telefonic.')
      else if (res.reason === 'parent_not_found') toast.error('Codul celui care te-a invitat nu e valid.')
      else if (res.reason === 'phone_required') toast.error('Numărul de telefon nu pare valid.')
      else toast.error('Nu am putut trimite cererea. Încearcă din nou.')
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
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: 24 }}>
        <div style={{ ...card, padding: '36px 28px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="users" size={40} color={D.gold} />
          </div>
          <h1
            style={{
              fontFamily: 'Fraunces,serif',
              color: D.t1,
              fontSize: '1.6rem',
              margin: '0 0 10px',
              textAlign: 'center',
            }}
          >
            Devino partener Menuvia
          </h1>
          <p style={{ color: D.t2, fontSize: '0.95rem', lineHeight: 1.5, margin: '0 0 18px', textAlign: 'center' }}>
            {dashboard?.defaults ? (
              <>
                Recomanzi Menuvia restaurantelor și primești{' '}
                <strong style={{ color: D.t1 }}>
                  {bpsToPct(dashboard.defaults.setup_bps)}%
                </strong>{' '}
                din prima factură a fiecărui restaurant adus, apoi{' '}
                <strong style={{ color: D.t1 }}>
                  {bpsToPct(dashboard.defaults.recurring_bps)}%
                </strong>{' '}
                din abonament, lunar, timp de {dashboard.defaults.recurring_cap_months} luni.
              </>
            ) : (
              <>
                Recomanzi Menuvia restaurantelor și câștigi comision din fiecare abonament adus —
                o singură dată la activare și apoi lunar, cât timp restaurantul rămâne client.
              </>
            )}
          </p>

          {/* Cum decurge: transparență ca să nu pară un formular-gaură-neagră. */}
          <div style={{ background: D.s3, borderRadius: 10, padding: '12px 14px', marginBottom: 18 }}>
            {[
              ['1', 'Trimiți cererea de mai jos (durează un minut).'],
              ['2', 'Te sunăm pentru o discuție scurtă de cunoaștere.'],
              ['3', 'Primești acces la panoul de partener și linkul tău.'],
            ].map(([n, txt]) => (
              <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '3px 0' }}>
                <span style={{ color: D.gold, fontWeight: 700, fontSize: '0.8rem' }}>{n}.</span>
                <span style={{ color: D.t2, fontSize: '0.8rem', lineHeight: 1.5 }}>{txt}</span>
              </div>
            ))}
          </div>

          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t1, fontWeight: 600, marginBottom: 6 }}>
            Telefon <span style={{ color: D.gold }}>*</span>
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="07xx xxx xxx"
            type="tel"
            autoComplete="tel"
            style={{ ...inputStyle, marginBottom: 14 }}
          />
          <label style={{ display: 'block', fontSize: '0.78rem', color: D.t1, fontWeight: 600, marginBottom: 6 }}>
            Cum ai de gând să recomanzi Menuvia? <span style={{ color: D.t2, fontWeight: 400 }}>(opțional)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            placeholder="Ex: lucrez în HoReCa și cunosc mulți proprietari de restaurante…"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', marginBottom: 14 }}
          />
          <input
            value={parentCode}
            onChange={(e) => setParentCode(e.target.value)}
            placeholder="Cod de invitație (opțional)"
            aria-label="Cod de invitație (opțional)"
            style={{ ...inputStyle, marginBottom: 18 }}
          />
          <button
            style={{
              ...goldBtn,
              padding: '12px 22px',
              width: '100%',
              opacity: phoneOk ? 1 : 0.6,
              ...(registering ? disabledBtn : null),
            }}
            disabled={registering}
            onClick={() => void join()}
          >
            {registering ? 'Se trimite…' : 'Trimite cererea →'}
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

  // ── Cerere în analiză / respinsă / cont oprit (mig 224) ────────────────────
  // Codul de referral e INERT până la aprobare (gate-urile server-side pe
  // status='active'), deci nu arătăm panoul complet — doar starea.
  if (aff.status === 'pending') {
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: 24 }}>
        <div style={{ ...card, textAlign: 'center', padding: '40px 28px' }}>
          <div style={{ fontSize: '2.4rem', marginBottom: 12 }} aria-hidden="true">📞</div>
          <h1 style={{ fontFamily: 'Fraunces,serif', color: D.t1, fontSize: '1.5rem', margin: '0 0 10px' }}>
            Cererea ta e în analiză
          </h1>
          <p style={{ color: D.t2, fontSize: '0.92rem', lineHeight: 1.6, margin: '0 0 16px' }}>
            Mulțumim! Te sunăm în 1–2 zile lucrătoare pentru o discuție scurtă de
            cunoaștere. Imediat după aprobare primești aici panoul de partener,
            linkul tău de recomandare și ghidul de start.
          </p>
          <div style={{ background: D.s3, borderRadius: 10, padding: '10px 14px', fontSize: '0.8rem', color: D.t2 }}>
            Ai o întrebare între timp? Scrie-ne la{' '}
            <a href="mailto:contact@menuvia.ro" style={{ color: D.gold, textDecoration: 'none' }}>
              contact@menuvia.ro
            </a>
          </div>
        </div>
      </div>
    )
  }
  if (aff.status === 'rejected') {
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: 24 }}>
        <div style={{ ...card, textAlign: 'center', padding: '40px 28px' }}>
          <div style={{ fontSize: '2.4rem', marginBottom: 12 }} aria-hidden="true">🤍</div>
          <h1 style={{ fontFamily: 'Fraunces,serif', color: D.t1, fontSize: '1.5rem', margin: '0 0 10px' }}>
            Nu am putut aproba cererea, deocamdată
          </h1>
          <p style={{ color: D.t2, fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>
            Mulțumim pentru interes! Programul de parteneriat pornește treptat și
            momentan nu am putut accepta toate cererile. Dacă situația ta s-a
            schimbat, scrie-ne la{' '}
            <a href="mailto:contact@menuvia.ro" style={{ color: D.gold, textDecoration: 'none' }}>
              contact@menuvia.ro
            </a>{' '}
            — reanalizăm cu drag.
          </p>
        </div>
      </div>
    )
  }
  if (aff.status === 'suspended' || aff.status === 'closed') {
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: 24 }}>
        <div style={{ ...card, textAlign: 'center', padding: '40px 28px' }}>
          <h1 style={{ fontFamily: 'Fraunces,serif', color: D.t1, fontSize: '1.5rem', margin: '0 0 10px' }}>
            {aff.status === 'suspended' ? 'Contul de partener e suspendat' : 'Contul de partener e închis'}
          </h1>
          <p style={{ color: D.t2, fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>
            Pentru detalii, scrie-ne la{' '}
            <a href="mailto:contact@menuvia.ro" style={{ color: D.gold, textDecoration: 'none' }}>
              contact@menuvia.ro
            </a>
            .
          </p>
        </div>
      </div>
    )
  }

  const activeCount = restaurants.filter((r) => r.status === 'active').length

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 16px 64px', color: D.t1 }}>
      <header style={{ marginBottom: 20 }}>
        <div style={{ fontSize: '0.72rem', color: D.t2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Program de afiliere
        </div>
        <h1 style={{ fontFamily: 'Fraunces,serif', fontSize: '1.8rem', margin: '4px 0 0' }}>Panoul tău</h1>
      </header>

      {/* Tab bar — semantică de tabs pentru screen readere; starea activă e
          comunicată și non-cromatic (greutatea fontului), nu doar prin culoare. */}
      <div role="tablist" aria-label="Secțiunile panoului de afiliat" style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`aff-tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? D.goldA : 'transparent',
              color: tab === t.id ? D.gold : D.t2,
              border: `1px solid ${tab === t.id ? `${D.gold}55` : D.border}`,
              borderRadius: 9,
              padding: '8px 14px',
              minHeight: 44,
              fontSize: '0.85rem',
              fontWeight: tab === t.id ? 700 : 500,
              cursor: 'pointer',
              fontFamily: 'DM Sans,sans-serif',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-labelledby={`aff-tab-${tab}`}>
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
          onGoTo={setTab}
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
      {tab === 'ghid' ? (
        <GhidTab
          commission={{
            setupBps: aff.setup_bps,
            recurringBps: aff.recurring_bps,
            cascadeBps: aff.cascade_bps,
            capMonths: aff.recurring_cap_months,
          }}
          code={aff.referral_code}
          toast={toast}
        />
      ) : null}
      </div>
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
  onGoTo,
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
  onGoTo: (tab: Tab) => void
}) {
  const e = earnings
  // Moneda câștigurilor (default 'RON' dacă lipsește) — o pasăm la formatRON.
  const cur = e?.currency || 'RON'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Primii pași — doar cât timp partenerul n-a adus încă niciun restaurant.
          Trei acțiuni concrete, fiecare cu drum direct spre tab-ul potrivit. */}
      {totalCount === 0 ? (
        <div style={{ ...card, border: `1px solid ${D.gold}44` }}>
          <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>
            Primii pași
          </div>
          <div style={{ color: D.t2, fontSize: '0.78rem', marginBottom: 12 }}>
            Trei lucruri mici și ești gata de prima recomandare.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(
              [
                {
                  n: '1',
                  t: 'Citește ghidul de start',
                  d: 'Cum funcționează comisioanele și cum prezinți Menuvia (5 min).',
                  cta: 'Deschide ghidul',
                  tab: 'ghid' as Tab,
                },
                {
                  n: '2',
                  t: 'Ia-ți linkul și codul QR',
                  d: 'Linkul tău unic de recomandare — orice cont creat prin el e al tău.',
                  cta: 'Vezi uneltele',
                  tab: 'unelte' as Tab,
                },
                {
                  n: '3',
                  t: 'Completează datele de plată',
                  d: 'IBAN + date de facturare, ca să-ți putem trimite comisioanele.',
                  cta: 'Completează',
                  tab: 'unelte' as Tab,
                },
              ]
            ).map((s) => (
              <div
                key={s.n}
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
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.85rem' }}>
                    <span style={{ color: D.gold }}>{s.n}.</span> {s.t}
                  </div>
                  <div style={{ color: D.t2, fontSize: '0.74rem', marginTop: 2 }}>{s.d}</div>
                </div>
                <button
                  onClick={() => onGoTo(s.tab)}
                  style={{
                    background: 'transparent',
                    color: D.gold,
                    border: `1px solid ${D.gold}55`,
                    borderRadius: 8,
                    padding: '8px 12px',
                    minHeight: 44,
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'DM Sans,sans-serif',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.cta} →
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {/* Comisioanele reale ale afiliatului (setate de platformă, mig 188) —
          transparență: cifrele exacte, nu text generic. */}
      <div style={card}>
        <div style={{ fontSize: '0.72rem', color: D.t2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Comisioanele tale
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10 }}>
          <div>
            <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.3rem', color: D.gold }}>
              {bpsToPct(commission.setupBps)}%
            </div>
            <div style={{ fontSize: '0.74rem', color: D.t2 }}>din prima factură (activare)</div>
          </div>
          <div>
            <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.3rem', color: D.gold }}>
              {bpsToPct(commission.recurringBps)}%
            </div>
            <div style={{ fontSize: '0.74rem', color: D.t2 }}>
              lunar, max {commission.capMonths} luni
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.3rem', color: D.gold }}>
              {bpsToPct(commission.cascadeBps)}%
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
        {/* „De plată" = confirmat − deja plătit (nu brutul confirmat, care ar
            arăta bani deja trimiși). Clamp la 0; „Plătit" apare separat mai jos. */}
        <MetricCard
          label="De plată"
          value={formatRON(Math.max(0, (e?.confirmed_cents ?? 0) - (e?.paid_cents ?? 0)), cur)}
          accent
        />
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
        {nextPayoutAt ? (
          <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.3rem', color: D.t1, marginTop: 6 }}>
            {formatDateRo(nextPayoutAt)}
          </div>
        ) : (
          <div style={{ fontSize: '0.85rem', color: D.t1, marginTop: 6, lineHeight: 1.5 }}>
            Nimic programat încă — data apare după primul comision confirmat.
          </div>
        )}
        <div style={{ fontSize: '0.78rem', color: D.t2, marginTop: 8, lineHeight: 1.5 }}>
          Comisioanele de activare au un hold de 60 de zile (protecție anti-fraudă); cele lunare, 14 zile.
          Plata se face după ce emiți factura către Menuvia.
        </div>
      </div>
    </div>
  )
}

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
      .catch((e: unknown) => {
        // Secțiunea nu se afișează pe eroare (decizie deliberată), DAR lăsăm o
        // urmă de diagnostic — altfel un blip de rețea e indistinguibil de o
        // revocare reală de acces la debugging în prod.
        console.error('[AfiliatPage] listPartnerRestaurants error:', e)
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
            <PartnerEnterButton restaurantId={p.restaurant_id} />
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
        Încă n-ai adus niciun restaurant. Împărtășește link-ul tău din tab-ul „Unelte”.
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
            style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
          >
            <div style={{ minWidth: 0 }}>
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
        Primești <strong style={{ color: D.gold }}>{bpsToPct(cascadeBps)}%</strong> din comisioanele
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
          Dă-i codul tău. Când se înscrie ca afiliat, îl pune în câmpul „Cod de invitație” și intră
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
            style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: D.t1, fontWeight: 600, wordBreak: 'break-all' }}>cod: {s.referral_code}</div>
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
          Link-ul tău de recomandare
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
              minHeight: 44,
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
          <img src={qr} alt="Cod QR cu link-ul tău de recomandare" style={{ width: 220, height: 220, borderRadius: 12 }} />
        ) : (
          <div style={{ color: D.t2, fontSize: '0.82rem', padding: 40 }}>Se generează…</div>
        )}
        <div style={{ marginTop: 12 }}>
          <button style={{ ...goldBtn, ...(qr ? null : disabledBtn) }} disabled={!qr} onClick={downloadQr}>
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
  // Eșec la CITIREA profilului (audit aff-page-panel): fără această stare,
  // o eroare de load (RLS/rețea/timeout) era tratată identic cu „nu există
  // încă profil" → formular GOL, iar un Salvează suprascria silențios
  // IBAN/CUI reale cu date goale (upsert-ul din mig 101 e complet, nu parțial).
  const [loadError, setLoadError] = useState(false)
  // Incrementat de butonul „Reîncearcă" → re-rulează efectul de load.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    void supabase
      .from('affiliate_payout_profile')
      .select('legal_form, cui, iban, beneficiary_name')
      .eq('affiliate_id', affiliateId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // NU tratăm eroarea ca „profil inexistent": ascundem formularul
          // (deci și Salvează) până reușește citirea, ca să nu poată fi
          // suprascrise datele fiscale existente cu un formular gol.
          console.error('[AfiliatPage] payout profile load failed:', error)
          setLoadError(true)
          setLoading(false)
          return
        }
        if (!data) {
          setLoading(false)
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
  }, [affiliateId, reloadKey])

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
      ) : loadError ? (
        // Load eșuat → NU afișăm formularul (un save ar suprascrie datele reale).
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 8 }}>
          <div style={{ color: D.t1, fontSize: '0.82rem', lineHeight: 1.5 }}>
            Nu am putut încărca datele tale de plată. Ca să nu-ți suprascriem din greșeală
            datele deja salvate, formularul e ascuns până reușește încărcarea.
          </div>
          <div>
            <button style={goldBtn} onClick={() => setReloadKey((k) => k + 1)}>
              Reîncearcă
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label htmlFor="payout-legal-form" style={labelStyle}>Formă juridică</label>
            <select
              id="payout-legal-form"
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
            <label htmlFor="payout-cui" style={labelStyle}>CUI / CIF</label>
            <input
              id="payout-cui"
              value={cui}
              onChange={(e) => setCui(e.target.value)}
              placeholder="RO12345678"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="payout-beneficiary" style={labelStyle}>Nume beneficiar (cont)</label>
            <input
              id="payout-beneficiary"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder="Ex: Popescu Ion PFA"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="payout-iban" style={labelStyle}>IBAN</label>
            <input
              id="payout-iban"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              placeholder="RO49 AAAA 1B31 0075 9384 0000"
              style={inputStyle}
            />
          </div>
          <div>
            <button style={{ ...goldBtn, ...(saving ? disabledBtn : null) }} disabled={saving} onClick={save}>
              {saving ? 'Se salvează…' : 'Salvează datele de plată'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Ghid — tutorialul de start al partenerului ──────────────────────────
// Experiența „te învăț eu": pașii concreți, cu procentele REALE ale
// partenerului (nu text generic), un mini-script de prezentare gata de
// copiat și întrebările care apar mereu la început.
function GhidTab({
  commission,
  code,
  toast,
}: {
  commission: { setupBps: number; recurringBps: number; cascadeBps: number; capMonths: number }
  code: string
  toast: ReturnType<typeof useToast>
}) {
  const url = referralUrl(code)
  // Mini-script de prezentare — onest (fiscal = pilot, fără promisiuni false).
  const pitch =
    `Salut! Folosesc Menuvia — meniu digital cu comenzi direct de la masă, fără aparatură nouă. ` +
    `Clienții scanează un cod QR, comanda ajunge direct în bucătărie. ` +
    `Se configurează în câteva minute și ai 30 de zile gratuit. ` +
    `Uite linkul meu, dacă vrei să încerci: ${url}`

  const copyPitch = async () => {
    try {
      await navigator.clipboard.writeText(pitch)
      toast.success('Mesajul a fost copiat!')
    } catch {
      toast.error('Nu am putut copia. Selectează textul manual.')
    }
  }

  const steps: { t: string; d: string }[] = [
    {
      t: 'Ia-ți linkul din tab-ul „Unelte”',
      d: 'Linkul și codul QR sunt ale tale. Oricine își face cont prin ele rămâne recomandarea ta — chiar dacă plătește abia peste câteva săptămâni.',
    },
    {
      t: 'Recomandă localurilor pe care le cunoști',
      d: 'Cel mai bine funcționează față în față sau pe WhatsApp, cu localuri unde ești deja client sau ai o relație. Trimite-le linkul tău și oferă-te să-i ajuți la primul pas.',
    },
    {
      t: 'Ajută-i să pornească (opțional, dar face diferența)',
      d: 'După ce restaurantul se abonează prin linkul tău, primești automat acces de partener pe dashboard-ul lui — îl poți ajuta cu meniul și setările. Ownerul vede accesul și îl poate opri oricând.',
    },
    {
      t: 'Urmărește câștigurile și emite factura',
      d: 'În „Acasă” vezi banii în timp real. Comisioanele de activare au un hold de 60 de zile (anti-fraudă), cele lunare de 14 zile. Plata vine după ce emiți factura către Menuvia — datele de plată le completezi în „Unelte”.',
    },
  ]

  const faq: { q: string; a: string }[] = [
    {
      q: 'Cât câștig, concret?',
      a: `Primești ${bpsToPct(commission.setupBps)}% din prima factură a fiecărui restaurant adus, apoi ${bpsToPct(commission.recurringBps)}% din abonamentul lui, lunar, timp de ${commission.capMonths} luni. Dacă aduci alți parteneri (sub-afiliați), primești și ${bpsToPct(commission.cascadeBps)}% din comisioanele lor.`,
    },
    {
      q: 'Ce spun dacă mă întreabă de bonul fiscal?',
      a: 'Onest: Menuvia nu înlocuiește casa de marcat — restaurantul o păstrează pe a lui. Puntea de fiscalizare automată (FiscalNet) e în pilot. Nu promite ce nu e încă live.',
    },
    {
      q: 'Restaurantul vrea o demonstrație. Ce fac?',
      a: 'Trimite-i pagina de demo (menuvia.netlify.app/demo) — e un meniu real, interactiv. Sau arată-i direct de pe telefonul tău, la masă.',
    },
    {
      q: 'Trebuie să fiu firmă ca să primesc banii?',
      a: 'Plata se face pe bază de factură (PFA, SRL sau altă formă). Completezi datele o singură dată în „Unelte” → Date de plată.',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>
          Cum funcționează, pas cu pas
        </div>
        <div style={{ color: D.t2, fontSize: '0.78rem', marginBottom: 14 }}>
          Tot ce ai nevoie ca să faci prima recomandare azi.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {steps.map((s, i) => (
            <div key={s.t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: D.goldA,
                  color: D.gold,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                }}
              >
                {i + 1}
              </div>
              <div>
                <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.85rem' }}>{s.t}</div>
                <div style={{ color: D.t2, fontSize: '0.78rem', lineHeight: 1.55, marginTop: 2 }}>
                  {s.d}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>
          Mesaj de prezentare gata de trimis
        </div>
        <div style={{ color: D.t2, fontSize: '0.78rem', marginBottom: 12 }}>
          Un punct de plecare pentru WhatsApp — personalizează-l cu vocea ta.
        </div>
        <div
          style={{
            background: D.s3,
            borderRadius: 10,
            padding: '12px 14px',
            color: D.t1,
            fontSize: '0.82rem',
            lineHeight: 1.6,
            marginBottom: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {pitch}
        </div>
        <button style={goldBtn} onClick={() => void copyPitch()}>
          Copiază mesajul
        </button>
      </div>

      <div style={card}>
        <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.95rem', marginBottom: 12 }}>
          Întrebări frecvente
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {faq.map((f) => (
            <div key={f.q}>
              <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.83rem', marginBottom: 3 }}>
                {f.q}
              </div>
              <div style={{ color: D.t2, fontSize: '0.78rem', lineHeight: 1.55 }}>{f.a}</div>
            </div>
          ))}
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
      return 'Rambursat'
    case 'expired':
      return 'Expirat'
    case 'downgraded':
      return 'Retrogradat'
    case 'rejected':
      return 'Respins'
    case 'suspended':
      return 'Suspendat'
    case 'closed':
      return 'Închis'
    default:
      return status
  }
}

// src/pages/AfiliatPage.tsx
// Panoul agentului / șefului de vânzări (ruta veche /afiliat, pachetul 8b-2):
// UN singur ecran, de sus în jos —
//   0. „Contract nou de colaborare”: DOAR când serverul cere reacceptarea unei
//      versiuni publicate (mig 308, components/afiliat/ContractReacceptSection);
//   1. „Înscrie un restaurant”: codul mare, linkul, QR pe tot ecranul, „Arată demo”;
//   2. „Banii tăi”: două propoziții din cifrele serverului (get_affiliate_dashboard,
//      mig 295), cu „Detalii plăți” pliat (sume, comisioane, data plății, IBAN);
//   3. „Clienții mei”: un rând per restaurant atribuit, cu acțiunea de acces
//      (components/PartnerAccessList.tsx, mig 286/303);
//   4. „Echipa ta”: DOAR pentru șef (get_sales_network, mig 304); agentul vede
//      cardul șefului lui;
//   5. „Consimțământ de contact”: comutatorul set_my_contact_sharing (mig 304);
//   6. „Cum vând”: pliat.
// Rețeaua e TRISTATE (useSalesNetwork): `network === null` = necunoscut →
// „Reîncearcă”, niciodată un ecran fals de „nu ești în rețea”. Programul public
// rămâne închis (mig 295): nicio înscriere publică nouă de aici.
// Stil inline cu tokens `D`, fără Tailwind, UI în română.

import { useState, useEffect } from 'react'
import { D } from '../lib/constants'
import { CONTACT_EMAIL } from '../lib/domain'
import { useAffiliate, type AffiliateDashboard, type AffiliateProfile } from '../hooks/useAffiliate'
import { useSalesNetwork } from '../hooks/useSalesNetwork'
import { formatRON, referralUrl } from '../lib/affiliate'
import { summarizeEarnings, type EarningsInput } from '../lib/affiliateEarnings'
import { moneySentences, salesRoleTitle } from '../lib/salesPanel'
import { useToast, type ToastApi } from '../components/ui/useToast'
import { Icon } from '../components/ui/Icon'
import { PageSpinner } from '../components/PageLoader'
import { supabase } from '../lib/supabase'
import PartnerAccessList from '../components/PartnerAccessList'
import Collapsible from '../components/afiliat/Collapsible'
import EnrollSection from '../components/afiliat/EnrollSection'
import TeamSection, { HeadCard } from '../components/afiliat/TeamSection'
import ContactConsentSection from '../components/afiliat/ContactConsentSection'
import ContractReacceptSection from '../components/afiliat/ContractReacceptSection'

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
  const [registering, setRegistering] = useState(false)
  const [parentCode, setParentCode] = useState('')
  // Cererea de afiliere (mig 224): telefonul e obligatoriu (interviu telefonic).
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')

  if (loading) return <PageSpinner label="Se încarcă panoul tău de vânzări…" />

  if (error) {
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: 24, textAlign: 'center', color: D.t2 }}>
        <div style={{ marginBottom: 14 }}>Nu am putut încărca panoul tău de vânzări.</div>
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
    // mig 295: programul nu primește cereri noi. TRISTATE — doar `false`
    // CUNOSCUT ascunde formularul; `undefined` (DB fără 295) îl lasă, iar
    // serverul decide (răspunde `program_closed`).
    if (dashboard?.program_open === false) return <ProgramClosedNotice />
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
      else if (res.reason === 'program_closed')
        toast.error('Programul pentru agenți de vânzări nu primește cereri noi acum. Se redeschide în curând.')
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
            Devino agent de vânzări Menuvia
          </h1>
          <p style={{ color: D.t2, fontSize: '0.95rem', lineHeight: 1.5, margin: '0 0 18px', textAlign: 'center' }}>
            {dashboard?.defaults ? (
              <>
                Recomanzi Menuvia restaurantelor și primești{' '}
                <strong style={{ color: D.t1 }}>
                  {bpsToPct(dashboard.defaults.setup_bps)}%
                </strong>{' '}
                din prima factură a fiecărui restaurant adus (plătit după ce restaurantul
                achită și a doua factură), apoi{' '}
                <strong style={{ color: D.t1 }}>
                  {bpsToPct(dashboard.defaults.recurring_bps)}%
                </strong>{' '}
                din fiecare dintre următoarele {dashboard.defaults.recurring_cap_months} facturi lunare.
              </>
            ) : (
              <>
                Recomanzi Menuvia restaurantelor și câștigi comision din abonamentele aduse —
                o dată la activare și apoi din facturile lunare, pe un număr limitat de luni.
              </>
            )}
          </p>

          {/* Cum decurge: transparență ca să nu pară un formular-gaură-neagră. */}
          <div style={{ background: D.s3, borderRadius: 10, padding: '12px 14px', marginBottom: 18 }}>
            {[
              ['1', 'Trimiți cererea de mai jos (durează un minut).'],
              ['2', 'Te sunăm pentru o discuție scurtă de cunoaștere.'],
              ['3', 'Primești acces la panoul tău de agent, cu codul și linkul tău.'],
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
            Mulțumim! Cererea ta a ajuns la noi. Te sunăm pentru o discuție scurtă
            de cunoaștere când deschidem programul pentru agenți noi — nu îți
            putem promite încă o dată. După aprobare primești aici panoul tău
            de agent, codul și linkul tău de recomandare și ghidul de start.
          </p>
          <div style={{ background: D.s3, borderRadius: 10, padding: '10px 14px', fontSize: '0.8rem', color: D.t2 }}>
            Ai o întrebare între timp? Scrie-ne la{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: D.gold, textDecoration: 'none' }}>
              {CONTACT_EMAIL}
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
            Mulțumim pentru interes! Programul pentru agenți de vânzări pornește treptat și
            momentan nu am putut accepta toate cererile. Dacă situația ta s-a
            schimbat, scrie-ne la{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: D.gold, textDecoration: 'none' }}>
              {CONTACT_EMAIL}
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
            {aff.status === 'suspended' ? 'Contul tău de vânzări e suspendat' : 'Contul tău de vânzări e închis'}
          </h1>
          <p style={{ color: D.t2, fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>
            Pentru detalii, scrie-ne la{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: D.gold, textDecoration: 'none' }}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      </div>
    )
  }

  return <SalesPanel dashboard={dashboard} aff={aff} toast={toast} />
}

// ── Programul închis pentru cereri noi (mig 295) ───────────────────────────
// Fără formular și fără promisiunea unui apel: nu cerem cuiva să completeze un
// formular pe care serverul îl va refuza.
function ProgramClosedNotice() {
  return (
    <div style={{ maxWidth: 560, margin: '80px auto', padding: 24 }}>
      <div style={{ ...card, textAlign: 'center', padding: '40px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <Icon name="users" size={40} color={D.gold} />
        </div>
        <h1 style={{ fontFamily: 'Fraunces,serif', color: D.t1, fontSize: '1.5rem', margin: '0 0 10px' }}>
          Programul pentru agenți de vânzări se redeschide
        </h1>
        <p style={{ color: D.t2, fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>
          Momentan nu primim cereri noi de agenți. Pregătim programul pentru
          lansare și îl redeschidem în curând — revino pe această pagină.
        </p>
      </div>
    </div>
  )
}

// ── Panoul activ: un singur ecran ───────────────────────────────────────────
function SalesPanel({
  dashboard,
  aff,
  toast,
}: {
  dashboard: AffiliateDashboard
  aff: AffiliateProfile
  toast: ToastApi
}) {
  const sales = useSalesNetwork(true)
  const network = sales.network
  // `undefined` = rol necunoscut (rețeaua n-a răspuns): titlu neutru.
  const role = network === null ? undefined : network.role
  const restaurants = dashboard.restaurants ?? []
  const subs = dashboard.sub_affiliates ?? []
  const earnings = dashboard.earnings
  const cur = earnings?.currency || 'RON'
  const fmt = (cents: number) => formatRON(cents, cur)
  const money = moneySentences(summarizeEarnings(earnings), earnings?.paid_cents ?? 0, fmt)
  const commission = {
    setupBps: aff.setup_bps,
    recurringBps: aff.recurring_bps,
    cascadeBps: aff.cascade_bps,
    capMonths: aff.recurring_cap_months,
  }
  // Bonusul din vânzările echipei are sens doar pentru șef (agenții nu au recruți).
  const showCascade = role === 'head'

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 64px', color: D.t1 }}>
      <header style={{ marginBottom: 20 }}>
        <div style={{ fontSize: '0.72rem', color: D.t2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {salesRoleTitle(role)}
        </div>
        <h1 style={{ fontFamily: 'Fraunces,serif', fontSize: '1.8rem', margin: '4px 0 0' }}>Panoul tău</h1>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Versiune nouă a contractului (mig 308): PRIMA, ca să nu treacă neobservată.
            Doar pentru membrii rețelei — afiliatul vechi (rol null) n-are ce accepta. */}
        {network !== null && network.role !== null && network.contract.needsAcceptance ? (
          <ContractReacceptSection contract={network.contract} onAccepted={sales.reload} />
        ) : null}
        <EnrollSection code={aff.referral_code} clientsCount={restaurants.length} toast={toast} />

        <section aria-labelledby="money-title" style={card}>
          <h2 id="money-title" style={{ margin: '0 0 8px', fontSize: '1.05rem', color: D.t1 }}>
            Banii tăi
          </h2>
          <p style={{ margin: '0 0 6px', fontSize: '0.92rem', lineHeight: 1.55, color: D.t1 }}>{money.earned}</p>
          <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.55, color: D.t1 }}>{money.payout}</p>
        </section>
        <Collapsible
          title="Detalii plăți"
          hint="Sumele pe categorii, comisioanele tale, data plății și datele de plată (IBAN)"
        >
          <PaymentDetails
            earnings={earnings}
            nextPayoutAt={dashboard.next_payout_at}
            nextBatchDate={dashboard.next_batch_date}
            commission={commission}
            showCascade={showCascade}
          />
          <PayoutProfileForm affiliateId={aff.id} toast={toast} />
        </Collapsible>

        <PartnerAccessList clients={restaurants} formatMoney={fmt} />

        {network === null ? (
          <NetworkUnknown loading={sales.loading} message={sales.error?.message ?? null} onRetry={() => void sales.reload()} />
        ) : (
          <>
            {network.role === 'head' ? <TeamSection network={network} onChanged={sales.reload} /> : null}
            {network.role === 'agent' && network.head ? <HeadCard head={network.head} /> : null}
            {network.role !== 'head' && subs.length > 0 ? <LegacySubs subs={subs} /> : null}
            <ContactConsentSection
              role={network.role}
              shared={network.contactSharing}
              onChange={sales.setContactSharing}
            />
          </>
        )}

        <Collapsible title="Cum vând" hint="Pașii, un mesaj gata de trimis și întrebările de la început">
          <HowToSell commission={commission} showCascade={showCascade} code={aff.referral_code} toast={toast} />
        </Collapsible>
      </div>
    </div>
  )
}

// Rețeaua n-a răspuns (încă): NU spunem „nu ești în rețea” — nu știm. Echipa și
// consimțământul de contact apar după o citire reușită.
function NetworkUnknown({
  loading,
  message,
  onRetry,
}: {
  loading: boolean
  message: string | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div role="status" style={{ ...card, color: D.t2, fontSize: '0.85rem' }}>
        Se încarcă echipa și consimțământul de contact…
      </div>
    )
  }
  return (
    <div role="alert" style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ color: D.t1, fontSize: '0.88rem', lineHeight: 1.5 }}>
        Nu am putut încărca echipa și consimțământul tău de contact.
        {message ? ` ${message}` : ''}
      </div>
      <div>
        <button type="button" style={goldBtn} onClick={onRetry}>
          Reîncearcă
        </button>
      </div>
    </div>
  )
}

// Recomandările din programul public vechi (sub-afiliați cu codul tău), doar
// pentru conturile care NU sunt șefi în rețeaua pe invitații: programul e
// închis (mig 295), deci nu mai oferim recrutarea prin cod, doar lista.
function LegacySubs({
  subs,
}: {
  subs: { referral_code: string; status: string; joined_at: string; attributions_count: number }[]
}) {
  return (
    <Collapsible title="Recomandările tale din programul vechi" hint={`${subs.length} conturi înscrise cu codul tău`}>
      {subs.map((s) => (
        <div
          key={s.referral_code}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ color: D.t1, fontWeight: 600, wordBreak: 'break-all', fontSize: '0.85rem' }}>
              cod: {s.referral_code}
            </div>
            <div style={{ color: D.t2, fontSize: '0.76rem', marginTop: 2 }}>
              {statusLabel(s.status)} · înscris {formatDateRo(s.joined_at)}
            </div>
          </div>
          <div style={{ color: D.t2, fontSize: '0.82rem' }}>{s.attributions_count} aduse</div>
        </div>
      ))}
    </Collapsible>
  )
}

// ── Detalii plăți (pliat sub „Banii tăi”) ───────────────────────────────────
function PaymentDetails({
  earnings,
  nextPayoutAt,
  nextBatchDate,
  commission,
  showCascade,
}: {
  earnings?: EarningsInput & { currency: string; clawed_back_cents: number }
  nextPayoutAt?: string | null
  nextBatchDate?: string | null
  commission: {
    setupBps: number
    recurringBps: number
    cascadeBps: number
    capMonths: number
  }
  /** Doar șeful primește bonus din vânzările echipei. */
  showCascade: boolean
}) {
  const e = earnings
  // Moneda câștigurilor (default 'RON' dacă lipsește) — o pasăm la formatRON.
  const cur = e?.currency || 'RON'
  // mig 295: cifrele NETE vin de la server (disponibil = confirmat − angajat,
  // aceeași formulă ca batch-ul); pe o DB veche, calculul vechi.
  const sum = summarizeEarnings(e)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Comisioanele reale ale agentului (setate de platformă, mig 188) —
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
            <div style={{ fontSize: '0.74rem', color: D.t2 }}>
              din prima factură, plătit după a doua factură achitată
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.3rem', color: D.gold }}>
              {bpsToPct(commission.recurringBps)}%
            </div>
            <div style={{ fontSize: '0.74rem', color: D.t2 }}>
              din fiecare dintre următoarele {commission.capMonths} facturi lunare
            </div>
          </div>
          {showCascade ? (
            <div>
              <div style={{ fontFamily: 'Fraunces,serif', fontSize: '1.3rem', color: D.gold }}>
                {bpsToPct(commission.cascadeBps)}%
              </div>
              <div style={{ fontSize: '0.74rem', color: D.t2 }}>din comisioanele agenților din echipa ta</div>
            </div>
          ) : null}
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        {/* „Disponibil" = confirmat net − ce e deja angajat în plăți (draft-uri
            în curs + plătite), calculat pe server (mig 295). Sub prag, suma se
            reportează — o spunem explicit, nu lăsăm cifra să pară „de primit". */}
        <MetricCard
          label="Disponibil pentru plată"
          value={formatRON(sum.availableCents, cur)}
          hint={
            sum.belowMinimum
              ? `sub pragul de ${formatRON(sum.minPayoutCents, cur)} — se reportează`
              : `peste pragul de ${formatRON(sum.minPayoutCents, cur)}`
          }
          accent
        />
        {sum.inProgressCents > 0 ? (
          <MetricCard label="Plată în curs" value={formatRON(sum.inProgressCents, cur)} hint="factură / transfer în lucru" />
        ) : null}
        <MetricCard
          label="În așteptare"
          value={formatRON(sum.pendingCents, cur)}
          hint="în perioada de siguranță, net de stornări"
        />
        <MetricCard
          label={sum.serverNet ? 'Câștigat (net)' : 'Total câștigat'}
          value={formatRON(sum.netEarnedCents, cur)}
          hint={sum.serverNet ? 'după stornări (clawback)' : undefined}
        />
        <MetricCard label="Plătit" value={formatRON(e?.paid_cents, cur)} />
        {/* Stornat (clawback): afișat doar când e > 0, ca să nu apară 0 inutil. */}
        {e && e.clawed_back_cents > 0 ? (
          <MetricCard label="Stornat (clawback)" value={formatRON(e.clawed_back_cents, cur)} hint="comisioane retrase" />
        ) : null}
      </div>

      <div style={card}>
        <div style={{ fontSize: '0.72rem', color: D.t2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Următoarea plată estimată
        </div>
        {nextBatchDate ? (
          <div style={{ fontSize: '0.85rem', color: D.t1, marginTop: 6, lineHeight: 1.5 }}>
            Următoarea listă de plată se generează pe{' '}
            <strong>{formatDateRo(`${nextBatchDate}T12:00:00`)}</strong>
            {sum.belowMinimum
              ? ` — disponibilul tău e sub pragul de ${formatRON(sum.minPayoutCents, cur)}, deci se reportează.`
              : ' și include disponibilul de mai sus.'}
          </div>
        ) : null}
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
          Un refund sau o dispută a clientului stornează (clawback) comisionul aferent, și după hold.
          Plata se face după ce emiți factura către Menuvia.
        </div>
      </div>
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
            if (res?.reason === 'invalid_iban') toast.error('IBAN invalid (verifică cifrele — cifra de control nu se potrivește).')
            // mig 294: datele de plată sunt înghețate cât o plată e în curs.
            else if (res?.reason === 'payout_in_progress')
              toast.error('Ai o plată în curs — datele de plată se pot schimba după ce se încheie. Scrie-ne dacă IBAN-ul e greșit.')
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

// ── „Cum vând” (pliat) — tutorialul de start al agentului ────────────────────
// Experiența „te învăț eu": pașii concreți, cu procentele REALE ale
// agentului (nu text generic), un mini-script de prezentare gata de
// copiat și întrebările care apar mereu la început.
function HowToSell({
  commission,
  showCascade,
  code,
  toast,
}: {
  commission: { setupBps: number; recurringBps: number; cascadeBps: number; capMonths: number }
  /** Doar șeful primește bonus din vânzările echipei. */
  showCascade: boolean
  code: string
  toast: ToastApi
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
      t: 'Folosește codul și linkul din „Înscrie un restaurant”',
      d: 'Codul, linkul și codul QR sunt ale tale. Restaurantul îți rămâne atribuit când patronul își face contul din linkul tău sau scrie codul tău la înscriere („Am un cod de agent”). Dacă doar deschide linkul și își face contul mai târziu, browserul lui păstrează codul o vreme (pe iPhone uneori doar 7 zile), deci cel mai sigur e să-și facă contul pe loc. Conturile care existau deja nu se atribuie, iar primul agent înregistrat pe cont rămâne.',
    },
    {
      t: 'Recomandă localurilor pe care le cunoști',
      d: 'Cel mai bine funcționează față în față sau pe WhatsApp, cu localuri unde ești deja client sau ai o relație. Trimite-le linkul tău și oferă-te să-i ajuți la primul pas.',
    },
    {
      t: 'Ajută-i să pornească (opțional, dar face diferența)',
      d: 'După ce restaurantul își face contul cu codul tău, poți cere din „Clienții mei” acces la meniul și mesele/QR ale lui. Accesul îl dă doar patronul, nu include comenzi, rezervări sau date fiscale și îl poate retrage oricând.',
    },
    {
      t: 'Urmărește câștigurile și emite factura',
      d: 'În „Banii tăi” vezi cât ai câștigat și cât poți primi. Comisioanele de activare au un hold de 60 de zile (anti-fraudă), cele lunare de 14 zile. Plata vine după ce emiți factura către Menuvia — datele de plată le completezi în „Detalii plăți”.',
    },
  ]

  const faq: { q: string; a: string }[] = [
    {
      q: 'Cât câștig, concret?',
      a: `Primești ${bpsToPct(commission.setupBps)}% din prima factură a fiecărui restaurant adus (plătit după ce restaurantul achită și a doua factură), apoi ${bpsToPct(commission.recurringBps)}% din fiecare dintre următoarele ${commission.capMonths} facturi lunare — pe orice plan plătit.${showCascade ? ` Ca șef de vânzări primești și ${bpsToPct(commission.cascadeBps)}% din comisioanele agenților din echipa ta.` : ''} Un refund sau o dispută stornează comisionul aferent.`,
    },
    {
      q: 'Ce spun dacă mă întreabă de bonul fiscal?',
      a: 'Onest: Menuvia nu înlocuiește casa de marcat — restaurantul o păstrează pe a lui. Puntea de fiscalizare automată (FiscalNet) e în pilot. Nu promite ce nu e încă live.',
    },
    {
      q: 'Restaurantul vrea o demonstrație. Ce fac?',
      a: 'Apasă „Arată demo” din „Înscrie un restaurant” — e un meniu real, interactiv — sau arată-i direct de pe telefonul tău, la masă.',
    },
    {
      q: 'Trebuie să fiu firmă ca să primesc banii?',
      a: 'Plata se face pe bază de factură (PFA, SRL sau altă formă). Completezi datele o singură dată în „Detalii plăți” → Date de plată.',
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

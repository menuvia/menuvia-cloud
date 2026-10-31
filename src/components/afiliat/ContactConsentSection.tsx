// src/components/afiliat/ContactConsentSection.tsx
// „Consimțământ de contact” — comutatorul EXPLICIT pentru `affiliates.contact_sharing`
// (`set_my_contact_sharing`, mig 304). Până la acest ecran bifa de la acceptarea
// invitației promitea „poți retrage oricând”, dar niciun ecran nu permitea
// retragerea.
//
// Starea afișată e cea a SERVERULUI (`network.contactSharing`, reîncărcată după
// fiecare schimbare de `useSalesNetwork.setContactSharing`), nu una optimistă:
// un refuz lasă comutatorul pe poziția reală și arată mesajul.
//
// Textul spune ADEVĂRAT cine vede ce (lib/salesPanel.ts › contactAudience): același
// consimțământ deschide contactul către DOUĂ audiențe — patronii restaurantelor
// aduse (`get_my_agent`, mig 303) și rețeaua (`get_sales_network`, mig 304).
import { useState } from 'react'
import { D } from '../../lib/constants'
import { contactAudience } from '../../lib/salesPanel'
import type { SalesNetworkError, SalesRole } from '../../lib/salesNetwork'

export default function ContactConsentSection({
  role,
  shared,
  onChange,
}: {
  role: SalesRole | null
  /** Consimțământul curent, de pe server. */
  shared: boolean
  onChange: (share: boolean) => Promise<SalesNetworkError | null>
}) {
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const err = await onChange(!shared)
    setBusy(false)
    if (err !== null) setError(err.message)
  }

  return (
    <section
      aria-labelledby="consent-title"
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 14,
        padding: '18px 20px',
      }}
    >
      <h2 id="consent-title" style={{ margin: '0 0 10px', fontSize: '1.05rem', color: D.t1 }}>
        Consimțământ de contact
      </h2>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span
          id="consent-label"
          style={{ color: D.t1, fontSize: '0.88rem', fontWeight: 600, flex: '1 1 200px' }}
        >
          Arată datele mele de contact
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={shared}
          aria-labelledby="consent-label"
          aria-describedby="consent-audience"
          disabled={busy}
          onClick={() => void toggle()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            minHeight: 44,
            padding: '6px 14px 6px 6px',
            borderRadius: 999,
            border: `1px solid ${shared ? D.gold : D.border}`,
            background: shared ? D.goldA : D.s3,
            color: shared ? D.gold : D.t2,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.7 : 1,
            fontFamily: D.fontBody,
            fontSize: '0.82rem',
            fontWeight: 600,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: shared ? D.gold : D.t3,
            }}
          />
          {busy ? 'Se salvează…' : shared ? 'Pornit' : 'Oprit'}
        </button>
      </div>
      <ul
        id="consent-audience"
        style={{
          margin: '12px 0 0',
          paddingLeft: 18,
          color: D.t2,
          fontSize: '0.78rem',
          lineHeight: 1.55,
        }}
      >
        {contactAudience(role, shared).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {error !== null ? (
        <div role="alert" style={{ color: D.red, fontSize: '0.82rem', marginTop: 10 }}>
          {error}
        </div>
      ) : null}
    </section>
  )
}

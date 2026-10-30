// src/components/sales/OneTimeLinkBox.tsx
// Caseta „linkul se vede o singură dată”, comună celor două locuri care creează
// invitații în rețeaua de vânzări (mig 304): panoul fondatorului
// (founder/SalesNetworkPanel, invitații de șef) și „Echipa ta”
// (afiliat/TeamSection, invitații de agent). Înainte erau două copii ale
// aceluiași markup, cu mesaje de copiere care începuseră deja să difere.
//
// Tokenul NU stă aici: părintele ține linkul în starea lui (nu în storage, nu în
// console) și îl scoate la `onHide`. Caseta doar îl arată, îl copiază și îl
// trimite. Părintele o montează cu `key={link}`, ca mesajul de copiere al unui
// link vechi să nu rămână lângă unul nou.
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { D } from '../../lib/constants'

const boxStyle: CSSProperties = {
  marginTop: 14,
  padding: 14,
  borderRadius: 10,
  border: `1px solid ${D.amber}`,
  background: D.amberA,
}
const inputStyle: CSSProperties = {
  width: '100%',
  background: D.s1,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 12px',
  minHeight: 44,
  fontSize: '0.85rem',
  color: D.t1,
  fontFamily: D.fontBody,
  boxSizing: 'border-box',
}
const primaryBtn: CSSProperties = {
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
}
const ghostBtn: CSSProperties = {
  ...primaryBtn,
  background: 'transparent',
  color: D.t1,
  border: `1px solid ${D.border}`,
  fontWeight: 500,
}

type CopyMsg = { kind: 'ok' | 'err'; text: string } | null

export interface OneTimeLinkBoxProps {
  link: string
  /** Cum se numește anularea în locul respectiv: „retragi” (agent) / „revoci” (fondator). */
  revokeVerb: 'retragi' | 'revoci'
  onHide: () => void
}

export default function OneTimeLinkBox({ link, revokeVerb, onHide }: OneTimeLinkBoxProps) {
  const [copyMsg, setCopyMsg] = useState<CopyMsg>(null)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link)
      setCopyMsg({ kind: 'ok', text: 'Link copiat.' })
    } catch {
      setCopyMsg({
        kind: 'err',
        text: 'Nu am putut copia automat. Selectează linkul din câmp și copiază-l manual.',
      })
    }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const share = async (): Promise<void> => {
    try {
      await navigator.share({ title: 'Invitație Menuvia', url: link })
    } catch {
      /* omul a închis fereastra de partajare: nimic de raportat */
    }
  }

  return (
    <section aria-label="Linkul invitației" style={boxStyle}>
      <p style={{ margin: '0 0 10px', fontSize: '0.84rem', fontWeight: 600, color: D.t1 }}>
        Linkul se vede o singură dată. Copiază-l sau trimite-l acum: după ce îl ascunzi nu îl mai
        poți recupera (poți doar să {revokeVerb} invitația și să creezi alta).
      </p>
      <input
        aria-label="Link invitație"
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" onClick={() => void copy()} style={primaryBtn}>
          Copiază
        </button>
        {canShare ? (
          <button type="button" onClick={() => void share()} style={ghostBtn}>
            Trimite
          </button>
        ) : null}
        <button type="button" onClick={onHide} style={ghostBtn}>
          Am salvat linkul, ascunde-l
        </button>
      </div>
      {copyMsg !== null ? (
        <div
          role={copyMsg.kind === 'err' ? 'alert' : 'status'}
          style={{
            marginTop: 8,
            fontSize: '0.82rem',
            color: copyMsg.kind === 'err' ? D.red : D.green,
          }}
        >
          {copyMsg.text}
        </div>
      ) : null}
    </section>
  )
}

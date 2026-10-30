// src/components/afiliat/ContractReacceptSection.tsx
// „Contract nou”: apare în panoul agentului / șefului DOAR când serverul spune
// `needs_acceptance` (mig 308 — pe perechea versiune + hash, doar pentru membrii
// rețelei). Acceptarea trece prin `accept_sales_contract`.
//
// Aceeași poartă ca pagina de invitație (lib/salesInviteFlow `contractGate`):
// textul se arată și se poate accepta NUMAI dacă sha256-ul textului din bundle e
// exact amprenta publicată. Lipsă / nepotrivire / verificare în curs → nu există
// buton (nu se acceptă un document care nu a fost afișat). Bifa e legată de
// hash-ul afișat: dacă textul se schimbă, bifa veche nu mai valorează.
//
// Nu blochează restul panoului: pe server nimic nu e încă gate-uit pe acceptarea
// la zi (decizie de fondator, consemnată în CLAUDE.md).
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { D } from '../../lib/constants'
import { useContractTextHash } from '../../hooks/useContractTextHash'
import { contractTextFor } from '../../lib/salesContract'
import { contractGate, contractVersionLabel, reacceptMessage } from '../../lib/salesInviteFlow'
import {
  acceptSalesContract,
  describeSalesError,
  SalesNetworkError,
  type SalesContractStatus,
} from '../../lib/salesNetwork'

const sectionStyle: CSSProperties = {
  background: D.s2,
  border: `1px solid ${D.amber}`,
  borderRadius: 14,
  padding: '18px 20px',
}
const hintStyle: CSSProperties = { margin: '0 0 12px', color: D.t2, fontSize: '0.84rem', lineHeight: 1.55 }
const textBoxStyle: CSSProperties = {
  maxHeight: 260,
  overflowY: 'auto',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 10,
  padding: 14,
  fontSize: '0.84rem',
  lineHeight: 1.55,
  color: D.t1,
  whiteSpace: 'pre-wrap',
  marginBottom: 12,
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

export default function ContractReacceptSection({
  contract,
  onAccepted,
}: {
  contract: SalesContractStatus
  /** Reîncarcă get_sales_network după o acceptare reușită. */
  onAccepted: () => Promise<void>
}) {
  const text = contractTextFor(contract.currentVersion)
  const localHash = useContractTextHash(text)
  const gate = contractGate(contract.currentVersion, contract.currentTextHash, text, localHash)
  // Bifa ține minte hash-ul textului pe care l-a văzut omul, nu un boolean.
  const [checkedHash, setCheckedHash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checked = gate.state === 'ready' && checkedHash === gate.hash
  const canSubmit = gate.state === 'ready' && checked && !busy

  const submit = async (): Promise<void> => {
    if (gate.state !== 'ready' || !checked || busy) return
    setBusy(true)
    setError(null)
    try {
      await acceptSalesContract(gate.version, gate.hash)
      await onAccepted()
    } catch (e) {
      setError(e instanceof SalesNetworkError ? reacceptMessage(e.reason) : describeSalesError(e))
    } finally {
      setBusy(false)
    }
  }

  const versionLabel = contract.currentVersion !== null ? contractVersionLabel(contract.currentVersion) : ''

  return (
    <section aria-labelledby="contract-reaccept-title" style={sectionStyle}>
      <h2 id="contract-reaccept-title" style={{ margin: '0 0 4px', fontSize: '1.05rem', color: D.t1 }}>
        Contract nou de colaborare
      </h2>
      <p style={hintStyle}>
        Menuvia a publicat versiunea {versionLabel} a contractului.
        {contract.acceptedVersion !== null
          ? ` Ai acceptat ultima dată versiunea ${contractVersionLabel(contract.acceptedVersion)}.`
          : ''}{' '}
        Citește textul de mai jos; CUI-ul declarat la intrarea în rețea rămâne același.
      </p>

      {gate.state === 'missing_text' ? (
        <p role="status" style={{ ...hintStyle, color: D.amber }}>
          Textul versiunii {versionLabel} nu este încă în aplicație. Reîncarcă pagina mai târziu.
        </p>
      ) : null}
      {gate.state === 'mismatch' ? (
        <p role="alert" style={{ ...hintStyle, color: D.red }}>
          Textul din aplicație nu este cel publicat pentru versiunea {versionLabel}, deci nu îl poți
          accepta. Reîncarcă pagina.
        </p>
      ) : null}
      {gate.state === 'checking' ? (
        <p role="status" style={hintStyle}>
          Se verifică textul contractului…
        </p>
      ) : null}
      {gate.state === 'hash_error' ? (
        <p role="alert" style={{ ...hintStyle, color: D.red }}>
          {gate.message}
        </p>
      ) : null}

      {gate.state === 'ready' ? (
        <>
          <div
            tabIndex={0}
            role="region"
            aria-label={`Contract de colaborare, versiunea ${gate.version}`}
            style={textBoxStyle}
          >
            {gate.text}
          </div>
          <label
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              fontSize: '0.86rem',
              color: D.t1,
              marginBottom: 12,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setCheckedHash(e.target.checked ? gate.hash : null)}
              style={{ width: 20, height: 20, flexShrink: 0, marginTop: 1 }}
            />
            <span>Am citit și accept contractul de colaborare (versiunea {gate.version}).</span>
          </label>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            style={canSubmit ? primaryBtn : { ...primaryBtn, opacity: 0.5, cursor: 'not-allowed' }}
          >
            {busy ? 'Se trimite…' : 'Accept contractul'}
          </button>
        </>
      ) : null}

      {error !== null ? (
        <div role="alert" style={{ color: D.red, fontSize: '0.82rem', marginTop: 10 }}>
          {error}
        </div>
      ) : null}
    </section>
  )
}

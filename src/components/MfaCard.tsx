// Card „Autentificare în doi pași (MFA)" — SettingsTab → Cont (mig 235).
// Enrollment TOTP prin supabase.auth.mfa (enroll → QR → challenge/verify),
// apoi activarea enforcement-ului server-side (set_my_mfa_enforced): din acel
// moment is_platform_admin() cere sesiune aal2. Dezactivarea cere un cod TOTP
// valid (verify → aal2) — clichetul anti-downgrade e în RPC, nu doar în UI.
// Limba (lotul L6b): textele vin din `settingsCards` (același chunk cu fila
// Setări), „Se încarcă…” din `common`. Eroarea e ținută ca DATĂ (`MfaError`:
// cheia de rezervă + cauza) și se traduce la randare: erorile Supabase Auth și
// ale RPC-ului prin `describeStaffError` (în română exact `toUserMessage`).
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { useToast } from './ui/useToast'
import { useT } from '../i18n/useT'
import { describeStaffError } from '../i18n/staffErrors'
import { settingsCardsNs } from '../i18n/ns/settingsCards'
import { commonNs } from '../i18n/ns/common'
import { fillNodes } from '../i18n/fillNodes'
import { isMfaAal2Refusal } from '../lib/accountRefusals'
import type { Translator } from '../i18n/core'
import type settingsCardsRo from '../i18n/ns/settingsCards/ro'
import type commonRo from '../i18n/ns/common/ro'

interface EnrollState {
  factorId: string
  qrCode: string
  secret: string
}

// qr_code vine de la GoTrue fie ca data-URI gata de pus în <img>, fie ca SVG
// brut — normalizăm o singură dată aici.
function qrSrc(qr: string): string {
  return qr.startsWith('data:') ? qr : 'data:image/svg+xml;utf8,' + encodeURIComponent(qr)
}

type MfaErrKey =
  | 'mfa_err_load'
  | 'mfa_err_start'
  | 'mfa_err_badCode'
  | 'mfa_err_verify'
  | 'mfa_err_disable'
  | 'mfa_err_reactivate'

// Eroarea cardului, ca DATĂ: cheia (mesajul propriu sau rezerva) și, când
// există, cauza (eroarea Supabase Auth / RPC).
type MfaError = { key: MfaErrKey } | { key: MfaErrKey; cause: unknown }

function mfaErrorText(
  e: MfaError,
  tr: Translator<typeof settingsCardsRo>,
  tc: Translator<typeof commonRo>,
): string {
  if (!('cause' in e)) return tr.t(e.key)
  // Refuzul `set_my_mfa_enforced` fără hint (mig 235): doar în celelalte limbi
  // (în română textul serverului rămâne afișat ca atare).
  if (tc.lang !== 'ro' && isMfaAal2Refusal(e.cause)) {
    return tr.t('mfa_err_aal2')
  }
  return describeStaffError(e.cause, tc, { fallback: tr.t(e.key) })
}

const inputStyle: CSSProperties = {
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 8,
  color: D.t1,
  padding: '10px 12px',
  fontSize: 15,
  width: 140,
  letterSpacing: '0.2em',
  fontVariantNumeric: 'tabular-nums',
}

const primaryBtn: CSSProperties = {
  minHeight: 44,
  padding: '10px 16px',
  background: D.gold,
  color: '#1a1610',
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
}

const ghostBtn: CSSProperties = {
  minHeight: 44,
  padding: '10px 16px',
  background: D.s2,
  color: D.t2,
  border: `1px solid ${D.border}`,
  borderRadius: 8,
  fontWeight: 500,
  fontSize: 14,
  cursor: 'pointer',
}

export default function MfaCard() {
  const tr = useT(settingsCardsNs)
  const tc = useT(commonNs)
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MfaError | null>(null)
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null)
  const [enforced, setEnforced] = useState(false)
  const [enroll, setEnroll] = useState<EnrollState | null>(null)
  const [code, setCode] = useState('')
  const [disabling, setDisabling] = useState(false)
  // Factor verificat + enforcement oprit (ex. rpc-ul a eșuat după verify, sau
  // dezactivare parțială): reactivăm cu FACTORUL EXISTENT — un enroll nou ar
  // pica pe conflictul de friendly_name cu factorul verificat.
  const [reactivating, setReactivating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors()
      if (fErr) throw fErr
      const verified = (factors?.totp ?? []).find((f) => f.status === 'verified')
      setVerifiedFactorId(verified?.id ?? null)

      const { data: userData } = await supabase.auth.getUser()
      const uid = userData?.user?.id
      if (uid) {
        const { data: prof, error: pErr } = await supabase
          .from('profiles')
          .select('mfa_enforced')
          .eq('id', uid)
          .maybeSingle()
        // Coloana apare abia în mig 235 — un 400 aici (frontend înaintea
        // migrației) lasă doar toggle-ul pe „inactiv", nu strică cardul.
        if (!pErr && prof) setEnforced(Boolean((prof as { mfa_enforced?: boolean }).mfa_enforced))
      }
    } catch (e) {
      setError({ key: 'mfa_err_load', cause: e })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const startEnroll = async () => {
    setBusy(true)
    setError(null)
    try {
      // Factorii TOTP neverificați (enrolări abandonate) blochează un enroll
      // nou — îi curățăm întâi.
      const { data: factors } = await supabase.auth.mfa.listFactors()
      for (const f of factors?.totp ?? []) {
        if (f.status !== 'verified') {
          await supabase.auth.mfa.unenroll({ factorId: f.id })
        }
      }
      const { data, error: eErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Menuvia',
      })
      if (eErr) throw eErr
      if (!data || data.type !== 'totp') throw new Error('Răspuns neașteptat la enrollment')
      setEnroll({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
      setCode('')
    } catch (e) {
      setError({ key: 'mfa_err_start', cause: e })
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async (factorId: string): Promise<boolean> => {
    const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({ factorId })
    if (cErr) throw cErr
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: ch.id,
      code: code.trim(),
    })
    if (vErr) {
      setError({ key: 'mfa_err_badCode' })
      return false
    }
    return true
  }

  const confirmEnroll = async () => {
    if (!enroll || code.trim().length < 6) return
    setBusy(true)
    setError(null)
    try {
      if (!(await verifyCode(enroll.factorId))) return
      // Sesiunea e acum aal2 — pornim enforcement-ul server-side.
      const { error: rpcErr } = await supabase.rpc('set_my_mfa_enforced', { p_enforced: true })
      if (rpcErr) throw rpcErr
      toast.success(tr.t('mfa_enabledToast'))
      setEnroll(null)
      setCode('')
      await load()
    } catch (e) {
      setError({ key: 'mfa_err_verify', cause: e })
    } finally {
      setBusy(false)
    }
  }

  const confirmDisable = async () => {
    if (!verifiedFactorId || code.trim().length < 6) return
    setBusy(true)
    setError(null)
    try {
      // verify → sesiunea devine aal2 → RPC-ul acceptă dezactivarea.
      if (!(await verifyCode(verifiedFactorId))) return
      const { error: rpcErr } = await supabase.rpc('set_my_mfa_enforced', { p_enforced: false })
      if (rpcErr) throw rpcErr
      // Un unenroll eșuat NU e succes: fără verificare, cardul ar afișa
      // „dezactivat" cu factorul încă înrolat (stare derutantă la re-login).
      const { error: unErr } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactorId })
      if (unErr) throw unErr
      toast.success(tr.t('mfa_disabledToast'))
      setDisabling(false)
      setCode('')
      await load()
    } catch (e) {
      setError({ key: 'mfa_err_disable', cause: e })
    } finally {
      setBusy(false)
    }
  }

  const confirmReactivate = async () => {
    if (!verifiedFactorId || code.trim().length < 6) return
    setBusy(true)
    setError(null)
    try {
      // verify → aal2, apoi repornim enforcement-ul pe factorul existent.
      if (!(await verifyCode(verifiedFactorId))) return
      const { error: rpcErr } = await supabase.rpc('set_my_mfa_enforced', { p_enforced: true })
      if (rpcErr) throw rpcErr
      toast.success(tr.t('mfa_reactivatedToast'))
      setReactivating(false)
      setCode('')
      await load()
    } catch (e) {
      setError({ key: 'mfa_err_reactivate', cause: e })
    } finally {
      setBusy(false)
    }
  }

  const active = Boolean(verifiedFactorId) && enforced

  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 12,
        padding: 18,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ fontWeight: 600, color: D.t1, fontSize: '0.95rem' }}>
          {tr.t('mfa_title')}
        </div>
        <span
          style={{
            padding: '3px 10px',
            borderRadius: 100,
            fontSize: 11,
            fontWeight: 600,
            background: active ? 'rgba(94,190,131,0.12)' : D.s3,
            color: active ? D.green : D.t3,
          }}
        >
          {active ? tr.t('mfa_active') : tr.t('mfa_inactive')}
        </span>
      </div>
      <p style={{ color: D.t2, fontSize: '0.82rem', margin: '0 0 14px', lineHeight: 1.5 }}>
        {tr.t('mfa_desc')}
      </p>

      {loading ? (
        <div style={{ color: D.t3, fontSize: '0.82rem' }}>{tc.t('loading')}</div>
      ) : enroll ? (
        <div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <img
              src={qrSrc(enroll.qrCode)}
              alt={tr.t('mfa_qrAlt')}
              width={160}
              height={160}
              style={{ background: '#fff', borderRadius: 8, padding: 8 }}
            />
            <div style={{ flex: 1, minWidth: 220 }}>
              <p style={{ color: D.t2, fontSize: '0.82rem', margin: '0 0 8px' }}>
                {tr.t('mfa_scan')}
              </p>
              <div style={{ color: D.t3, fontSize: '0.75rem', marginBottom: 12 }}>
                {fillNodes(tr.t('mfa_manual'), {
                  key: <code style={{ color: D.t2, wordBreak: 'break-all' }}>{enroll.secret}</code>,
                })}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  aria-label={tr.t('mfa_codeAria')}
                  style={inputStyle}
                />
                <button onClick={confirmEnroll} disabled={busy || code.length < 6} style={primaryBtn}>
                  {busy ? tr.t('mfa_verifying') : tr.t('mfa_confirmEnable')}
                </button>
                <button
                  onClick={() => {
                    setEnroll(null)
                    setCode('')
                    setError(null)
                  }}
                  disabled={busy}
                  style={ghostBtn}
                >
                  {tr.t('mfa_dismiss')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : disabling ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: D.t2, fontSize: '0.82rem' }}>
            {tr.t('mfa_confirmWithCode')}
          </span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-label={tr.t('mfa_codeAria')}
            style={inputStyle}
          />
          <button onClick={confirmDisable} disabled={busy || code.length < 6} style={primaryBtn}>
            {busy ? tr.t('mfa_verifying') : tr.t('mfa_disable')}
          </button>
          <button
            onClick={() => {
              setDisabling(false)
              setCode('')
              setError(null)
            }}
            disabled={busy}
            style={ghostBtn}
          >
            {tr.t('mfa_dismiss')}
          </button>
        </div>
      ) : active ? (
        <button onClick={() => setDisabling(true)} style={ghostBtn}>
          {tr.t('mfa_disableStart')}
        </button>
      ) : verifiedFactorId ? (
        reactivating ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: D.t2, fontSize: '0.82rem' }}>
              {tr.t('mfa_confirmWithCode')}
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label={tr.t('mfa_codeAria')}
              style={inputStyle}
            />
            <button
              onClick={confirmReactivate}
              disabled={busy || code.length < 6}
              style={primaryBtn}
            >
              {busy ? tr.t('mfa_verifying') : tr.t('mfa_reactivate')}
            </button>
            <button
              onClick={() => {
                setReactivating(false)
                setCode('')
                setError(null)
              }}
              disabled={busy}
              style={ghostBtn}
            >
              {tr.t('mfa_dismiss')}
            </button>
          </div>
        ) : (
          <button onClick={() => setReactivating(true)} style={primaryBtn}>
            {tr.t('mfa_enable')}
          </button>
        )
      ) : (
        <button onClick={startEnroll} disabled={busy} style={primaryBtn}>
          {busy ? tr.t('mfa_preparing') : tr.t('mfa_enable')}
        </button>
      )}

      {error && (
        <div style={{ color: D.red, fontSize: '0.8rem', marginTop: 10 }} role="alert">
          {mfaErrorText(error, tr, tc)}
        </div>
      )}
    </div>
  )
}

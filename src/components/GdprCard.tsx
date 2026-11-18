// Card „Datele mele (GDPR)" — SettingsTab → Cont.
// Cablează în UI drepturile care EXISTAU în DB din mig 042 dar nu erau
// apelate de nicăieri (auditul de conformitate aug 2026: „toată suprafața
// GDPR e cod mort dinspre utilizator"):
//   - Art. 15/20: export_user_data → descarcă JSON cu datele contului
//   - Art. 17:    request_account_deletion → ștergere programată la D+30
//                 (cu fereastră de grație și cancel_deletion_request)
// RPC-urile sunt SECURITY DEFINER pe auth.uid() — nu primesc niciun parametru.
// Limba (lotul L6b): textele cardului vin din `settingsCards` (același chunk
// cu fila Setări), „Anulează” din `common`; erorile prin `describeStaffError`
// (în română exact `toUserMessage`). Linkul duce tot la Politica de
// confidențialitate (documentul legal rămâne cum e); doar textul lui se
// traduce. Data programării se formatează în limba personalului.
import { useEffect, useState } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './ui/useToast'
import { confirm } from './ui/confirm'
import { useT } from '../i18n/useT'
import { useUiLang } from '../i18n/UiLangContext'
import { describeStaffError } from '../i18n/staffErrors'
import { staffLocale } from '../i18n/format'
import { settingsCardsNs } from '../i18n/ns/settingsCards'
import { commonNs } from '../i18n/ns/common'
import { fillNodes } from '../i18n/fillNodes'
import { isActiveSubscriptionRefusal } from '../lib/accountRefusals'
import { track } from '../lib/analytics'

const btnStyle = (variant: 'neutral' | 'danger' | 'safe'): React.CSSProperties => ({
  background: variant === 'danger' ? D.redA : D.s3,
  color: variant === 'danger' ? D.red : variant === 'safe' ? D.green : D.t1,
  border: `1px solid ${variant === 'danger' ? `${D.red}44` : D.border}`,
  borderRadius: 8,
  padding: '10px 14px',
  minHeight: 42,
  fontSize: '0.82rem',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
})

export default function GdprCard() {
  const tr = useT(settingsCardsNs)
  const tc = useT(commonNs)
  // Data programării în formatul limbii UTILIZATORULUI, nu `tr.lang`.
  const { lang: uiLang } = useUiLang()
  const { user } = useAuth()
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // null = necunoscut (încă se încarcă / eroare de citire) — NU afișăm greșit
  // starea de ștergere pe un blip de rețea (aceeași disciplină ca useData).
  const [deletionRequestedAt, setDeletionRequestedAt] = useState<string | null | undefined>(
    undefined,
  )

  useEffect(() => {
    if (!user) return
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('deletion_requested_at')
        .eq('id', user.id)
        .maybeSingle()
      if (cancelled || error) return
      setDeletionRequestedAt((data?.deletion_requested_at as string | null) ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const { data, error } = await supabase.rpc('export_user_data')
      if (error) throw new Error(error.message)
      // Descărcare client-side — datele nu tranzitează niciun alt serviciu.
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `menuvia-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      track('export_data_requested')
      toast.success(tr.t('gdpr_exported'))
    } catch (e) {
      toast.error(describeStaffError(e, tc, { fallback: tr.t('gdpr_err_export') }))
    } finally {
      setExporting(false)
    }
  }

  const handleRequestDeletion = async () => {
    if (deleting) return
    const ok = await confirm({
      title: tr.t('gdpr_confirmTitle'),
      description: tr.t('gdpr_confirmDesc'),
      confirmLabel: tr.t('gdpr_confirmOk'),
      cancelLabel: tc.t('cancel'),
      destructive: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      const { data, error } = await supabase.rpc('request_account_deletion')
      if (error) throw new Error(error.message)
      const d = data as { deletion_scheduled_at?: string } | null
      setDeletionRequestedAt(new Date().toISOString())
      track('account_deletion_requested')
      toast.success(
        d?.deletion_scheduled_at
          ? tr.t('gdpr_scheduledFor', {
              date: new Date(d.deletion_scheduled_at).toLocaleDateString(staffLocale(uiLang)),
            })
          : tr.t('gdpr_scheduled'),
      )
    } catch (e) {
      // Mesajul RPC-ului e deja prietenos (ex. „Aveți un abonament activ...") —
      // în română rămâne ca atare; în altă limbă refuzul cunoscut are text propriu.
      toast.error(
        tc.lang !== 'ro' && isActiveSubscriptionRefusal(e)
          ? tr.t('gdpr_err_activeSub')
          : describeStaffError(e, tc, { fallback: tr.t('gdpr_err_request') }),
      )
    } finally {
      setDeleting(false)
    }
  }

  const handleCancelDeletion = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      const { error } = await supabase.rpc('cancel_deletion_request')
      if (error) throw new Error(error.message)
      setDeletionRequestedAt(null)
      toast.success(tr.t('gdpr_cancelled'))
    } catch (e) {
      toast.error(describeStaffError(e, tc, { fallback: tr.t('gdpr_err_cancel') }))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 14,
        padding: 22,
      }}
    >
      <div style={{ fontWeight: 700, color: D.t1, marginBottom: 4 }}>{tr.t('gdpr_title')}</div>
      <p style={{ fontSize: '0.78rem', color: D.t2, lineHeight: 1.5, margin: '0 0 14px' }}>
        {fillNodes(tr.t('gdpr_desc'), {
          policy: (
            <a href="/confidentialitate" target="_blank" rel="noopener noreferrer" style={{ color: D.gold }}>
              {tr.t('gdpr_policy')}
            </a>
          ),
        })}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button onClick={() => void handleExport()} disabled={exporting} style={btnStyle('neutral')}>
          {exporting ? tr.t('gdpr_preparing') : tr.t('gdpr_export')}
        </button>

        {deletionRequestedAt ? (
          <button
            onClick={() => void handleCancelDeletion()}
            disabled={deleting}
            style={btnStyle('safe')}
          >
            {deleting ? tr.t('gdpr_cancelling') : tr.t('gdpr_cancelDeletion')}
          </button>
        ) : (
          <button
            onClick={() => void handleRequestDeletion()}
            disabled={deleting || deletionRequestedAt === undefined}
            style={btnStyle('danger')}
          >
            {deleting ? tr.t('gdpr_sending') : tr.t('gdpr_delete')}
          </button>
        )}
      </div>

      {deletionRequestedAt ? (
        <p style={{ fontSize: '0.75rem', color: D.red, margin: '12px 0 0', lineHeight: 1.5 }}>
          {tr.t('gdpr_pendingNote')}
        </p>
      ) : null}
    </div>
  )
}

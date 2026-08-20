// Card „Datele mele (GDPR)" — SettingsTab → Cont.
// Cablează în UI drepturile care EXISTAU în DB din mig 042 dar nu erau
// apelate de nicăieri (auditul de conformitate aug 2026: „toată suprafața
// GDPR e cod mort dinspre utilizator"):
//   - Art. 15/20: export_user_data → descarcă JSON cu datele contului
//   - Art. 17:    request_account_deletion → ștergere programată la D+30
//                 (cu fereastră de grație și cancel_deletion_request)
// RPC-urile sunt SECURITY DEFINER pe auth.uid() — nu primesc niciun parametru.
import { useEffect, useState } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './ui/useToast'
import { confirm } from './ui/confirm'

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
      toast.success('Exportul a fost descărcat.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Exportul a eșuat. Reîncearcă.')
    } finally {
      setExporting(false)
    }
  }

  const handleRequestDeletion = async () => {
    if (deleting) return
    const ok = await confirm({
      title: 'Ștergi contul?',
      description:
        'Contul și datele tale (restaurante, meniuri, membri) vor fi șterse definitiv după 30 de zile. ' +
        'În această perioadă te poți răzgândi de aici. Facturile fiscale rămân arhivate conform legii (10 ani).',
      confirmLabel: 'Programează ștergerea',
      destructive: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      const { data, error } = await supabase.rpc('request_account_deletion')
      if (error) throw new Error(error.message)
      const d = data as { deletion_scheduled_at?: string } | null
      setDeletionRequestedAt(new Date().toISOString())
      toast.success(
        d?.deletion_scheduled_at
          ? `Ștergerea e programată pentru ${new Date(d.deletion_scheduled_at).toLocaleDateString('ro-RO')}.`
          : 'Ștergerea contului a fost programată (30 de zile).',
      )
    } catch (e) {
      // Mesajul RPC-ului e deja prietenos (ex. „Aveți un abonament activ...").
      toast.error(e instanceof Error ? e.message : 'Cererea de ștergere a eșuat.')
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
      toast.success('Cererea de ștergere a fost anulată. Contul rămâne activ.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Anularea a eșuat. Reîncearcă.')
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
      <div style={{ fontWeight: 700, color: D.t1, marginBottom: 4 }}>Datele mele (GDPR)</div>
      <p style={{ fontSize: '0.78rem', color: D.t2, lineHeight: 1.5, margin: '0 0 14px' }}>
        Poți descărca o copie a datelor contului tău sau poți cere ștergerea contului. Detalii în{' '}
        <a href="/confidentialitate" target="_blank" rel="noopener noreferrer" style={{ color: D.gold }}>
          Politica de confidențialitate
        </a>
        .
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button onClick={() => void handleExport()} disabled={exporting} style={btnStyle('neutral')}>
          {exporting ? 'Se pregătește…' : '⬇ Exportă datele mele (JSON)'}
        </button>

        {deletionRequestedAt ? (
          <button
            onClick={() => void handleCancelDeletion()}
            disabled={deleting}
            style={btnStyle('safe')}
          >
            {deleting ? 'Se anulează…' : '↩ Anulează ștergerea programată'}
          </button>
        ) : (
          <button
            onClick={() => void handleRequestDeletion()}
            disabled={deleting || deletionRequestedAt === undefined}
            style={btnStyle('danger')}
          >
            {deleting ? 'Se trimite…' : 'Șterge contul'}
          </button>
        )}
      </div>

      {deletionRequestedAt ? (
        <p style={{ fontSize: '0.75rem', color: D.red, margin: '12px 0 0', lineHeight: 1.5 }}>
          ⚠️ Ștergerea contului e programată (la 30 de zile de la cerere). Până atunci contul
          funcționează normal și poți anula oricând de aici.
        </p>
      ) : null}
    </div>
  )
}

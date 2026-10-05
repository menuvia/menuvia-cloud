// PartnerAccessSection — tab-ul Echipă, ownerul: cererile și accesul partenerului
// (afiliatul care a adus restaurantul), mig 286.
//
// Accesul e OPT-IN: partenerul cere, ownerul APROBĂ sau REFUZĂ, și poate REVOCA
// oricând. Accesul acordat acoperă doar meniul și mesele/QR (politici dedicate
// în DB) — nu comenzi, rezervări, date fiscale, setări sau echipă. Gate-ul real
// e server-side (RPC-urile grant/revoke); secțiunea e randată doar ownerului.
import { useState, useEffect, useCallback } from 'react'
import { D } from '../lib/constants'
import {
  getPartnerAccess,
  grantPartnerAccess,
  revokePartnerAccess,
  type PartnerAccessRow,
} from '../lib/founder'
import { describePartnerState } from '../lib/partnerAccess'

const btn = (e: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 14px',
  minHeight: 44,
  borderRadius: 9,
  fontSize: '0.85rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  whiteSpace: 'nowrap',
  ...e,
})

const TONE_COLOR = { ok: D.green, wait: D.gold, bad: D.red, neutral: D.t2 } as const

export default function PartnerAccessSection({
  restaurantId,
  toast,
}: {
  restaurantId: string
  toast: (msg: string, type?: string) => void
}) {
  const [rows, setRows] = useState<PartnerAccessRow[]>([])
  const [loaded, setLoaded] = useState(false)
  // attribution_id-ul pentru care așteptăm confirmarea unei revocări/refuz.
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(
    async (isStale?: () => boolean) => {
      // Reset la început: fără el, la schimbarea restaurantului (sau pe eroare)
      // rămâneau afișate rândurile VECHIULUI restaurant sub cel curent.
      setLoaded(false)
      setRows([])
      try {
        const fetched = await getPartnerAccess(restaurantId)
        if (isStale?.()) return
        setRows(fetched)
      } catch {
        /* non-owner sau eroare — secțiunea rămâne goală */
      }
      if (isStale?.()) return
      setLoaded(true)
    },
    [restaurantId],
  )

  useEffect(() => {
    // Flag de anulare: două load-uri în zbor la switch rapid de restaurant
    // nu au voie să se rezolve out-of-order peste state.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  if (!loaded || rows.length === 0) return null

  async function act(
    row: PartnerAccessRow,
    fn: (id: string) => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
  ) {
    setBusyId(row.attribution_id)
    try {
      const res = await fn(row.attribution_id)
      if (!res.ok) throw new Error(res.error ?? 'Eroare')
      toast(okMsg)
      setConfirming(null)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Eroare', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      data-testid="partner-access-section"
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 14,
        padding: 20,
        marginTop: 24,
      }}
    >
      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: D.t1, marginBottom: 4 }}>
        Acces partener
      </div>
      <p style={{ color: D.t2, fontSize: '0.78rem', marginBottom: 14 }}>
        Partenerul care ți-a recomandat Menuvia poate cere acces ca să te ajute cu configurarea. Îl
        primește doar dacă îl aprobi, vede DOAR meniul și mesele/QR (nu comenzi, rezervări, date
        fiscale sau setări) și îl poți revoca oricând — nu îți afectează abonamentul.
      </p>
      {rows.map((r) => {
        const view = describePartnerState(r.state)
        const busy = busyId === r.attribution_id
        return (
          <div
            key={r.attribution_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              padding: '10px 12px',
              background: D.s3,
              borderRadius: 10,
              marginBottom: 8,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{ color: D.t1, fontWeight: 600, fontSize: '0.85rem', overflowWrap: 'anywhere' }}
              >
                {r.affiliate_name || r.affiliate_email}
              </div>
              <div style={{ color: TONE_COLOR[view.tone], fontSize: '0.72rem' }}>{view.label}</div>
            </div>

            {r.state === 'requested' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => void act(r, grantPartnerAccess, 'Accesul partenerului a fost acordat')}
                  disabled={busy}
                  style={btn({ background: D.gold, color: D.bg })}
                >
                  Aprobă
                </button>
                <button
                  onClick={() => void act(r, revokePartnerAccess, 'Cererea a fost refuzată')}
                  disabled={busy}
                  style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
                >
                  Refuză
                </button>
              </div>
            )}

            {r.state === 'granted' &&
              (confirming === r.attribution_id ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: D.t2, fontSize: '0.8rem' }}>
                    Sigur revoci accesul partenerului?
                  </span>
                  <button
                    onClick={() =>
                      void act(r, revokePartnerAccess, 'Accesul partenerului a fost revocat')
                    }
                    disabled={busy}
                    style={btn({ background: D.red, color: '#fff' })}
                  >
                    Da, revocă
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
                  >
                    Anulează
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(r.attribution_id)}
                  style={btn({
                    background: 'transparent',
                    color: D.red,
                    border: '1px solid rgba(224,85,85,0.3)',
                  })}
                >
                  Revocă accesul
                </button>
              ))}
          </div>
        )
      })}
    </div>
  )
}

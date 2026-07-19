// OnlinePaymentsCard — Setări → Comenzi: plata online la masă (Etapa 1).
// Design: docs/ONLINE_PAYMENT.md. Trei chei, toate vizibile aici:
//   1. planul (pro/enterprise) — gate-ul REAL e server-side; aici doar UX
//   2. contul Stripe Connect (onboarding prin funcția stripe-connect)
//   3. toggle-ul modulului `online_payments` (opt-in-ul localului)
import { useCallback, useEffect, useState } from 'react'
import { D } from '../lib/constants'
import { planTier } from '../lib/features'
import { supabase } from '../lib/supabase'
import { Toggle } from './_dashboard/sharedUI'
import { Icon } from './ui/Icon'
import type { useRestaurantModules } from '../hooks/useRestaurantModules'

interface ConnectStatus {
  connected: boolean
  charges_enabled?: boolean
  details_submitted?: boolean
}

interface Props {
  restaurantId: string
  plan: string
  modulesState: ReturnType<typeof useRestaurantModules>
  toast: (msg: string, type?: string) => void
}

async function callConnect(
  restaurantId: string,
  action: 'link' | 'status',
): Promise<Record<string, unknown>> {
  const { data: sessionData } = await supabase.auth.getSession()
  const jwt = sessionData.session?.access_token
  if (!jwt) throw new Error('Sesiune expirată — reautentifică-te.')
  const res = await fetch('/.netlify/functions/stripe-connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ restaurant_id: restaurantId, action }),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Operațiunea a eșuat.')
  }
  return body
}

export default function OnlinePaymentsCard({ restaurantId, plan, modulesState, toast }: Props) {
  const eligible = planTier(plan) >= 3
  const [status, setStatus] = useState<ConnectStatus | null>(null)
  // Eroare de VERIFICARE ≠ „neconectat": pe blip, cardul afișa fals butonul
  // „Conectează contul", sugerând că un cont deja conectat s-ar fi pierdut.
  const [statusError, setStatusError] = useState(false)
  const [busy, setBusy] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const body = await callConnect(restaurantId, 'status')
      setStatus({
        connected: body.connected === true,
        charges_enabled: body.charges_enabled === true,
        details_submitted: body.details_submitted === true,
      })
      setStatusError(false)
    } catch {
      // Status necunoscut (funcție nedeployată / rețea) — semnalăm distinct,
      // NU cădem pe „neconectat".
      setStatus(null)
      setStatusError(true)
    }
  }, [restaurantId])

  useEffect(() => {
    if (eligible) void refreshStatus()
  }, [eligible, refreshStatus])

  async function handleConnect(): Promise<void> {
    setBusy(true)
    try {
      const body = await callConnect(restaurantId, 'link')
      if (typeof body.url === 'string') {
        window.location.href = body.url
        return
      }
      throw new Error('Stripe nu a întors link-ul de onboarding.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Conectarea a eșuat.', 'error')
      setBusy(false)
    }
  }

  const connected = status?.connected === true
  const chargesReady = status?.charges_enabled === true

  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 14,
        padding: 22,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon name="receipt" size={16} color={D.gold} />
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1 }}>
          Plăți online la masă
        </span>
      </div>
      <div style={{ fontSize: '0.75rem', color: D.t2, lineHeight: 1.6, marginBottom: 14 }}>
        Clienții plătesc nota direct din telefon (card, Apple Pay, Google Pay). Banii ajung în
        contul tău Stripe, iar bonul fiscal se emite tot pe casa ta de marcat — nimic nu se
        schimbă la fiscalizare.
      </div>

      {!eligible ? (
        <div
          style={{
            background: D.s3,
            borderRadius: 10,
            padding: '12px 14px',
            fontSize: '0.78rem',
            color: D.t2,
          }}
        >
          Disponibil pe planul <strong style={{ color: D.gold }}>Fiscalizare</strong> — plata
          online atinge banii și bonul fiscal, deci cere planul complet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Pasul 1 — contul Stripe */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: D.t1 }}>
                1. Contul de încasare (Stripe)
              </div>
              <div style={{ fontSize: '0.72rem', color: statusError ? D.red : D.t2, marginTop: 2 }}>
                {statusError
                  ? 'Nu am putut verifica starea contului — reîncearcă. (Dacă ai deja un cont conectat, e în siguranță.)'
                  : connected
                    ? chargesReady
                      ? 'Cont conectat și activ — poți încasa.'
                      : 'Cont creat, dar onboarding-ul Stripe nu e finalizat.'
                    : 'Creezi contul și completezi datele firmei la Stripe (~5 min).'}
              </div>
            </div>
            {statusError ? (
              <button
                onClick={() => void refreshStatus()}
                style={{
                  background: D.s3,
                  color: D.t1,
                  border: `1px solid ${D.border}`,
                  borderRadius: 8,
                  padding: '9px 16px',
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  minHeight: 44,
                }}
              >
                Reîncearcă
              </button>
            ) : (
            <button
              onClick={() => void handleConnect()}
              disabled={busy}
              style={{
                background: connected && chargesReady ? D.s3 : D.gold,
                color: connected && chargesReady ? D.t1 : D.bg,
                border: 'none',
                borderRadius: 8,
                padding: '9px 16px',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? 'wait' : 'pointer',
                minHeight: 44,
              }}
            >
              {busy
                ? 'Se deschide…'
                : connected
                  ? chargesReady
                    ? 'Gestionează contul'
                    : 'Finalizează onboarding-ul'
                  : 'Conectează contul Stripe'}
            </button>
            )}
          </div>

          {/* Pasul 2 — toggle-ul modulului */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: D.t1 }}>
                2. Activează butonul „Plătește online" în meniul QR
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                Fără cont conectat, clienții văd în continuare „Cere nota" — serverul refuză
                plata oricum (gate-urile sunt pe server, nu doar aici).
              </div>
            </div>
            <Toggle
              value={modulesState.isEnabled('online_payments')}
              onChange={(v) => {
                modulesState
                  .setModule('online_payments', v)
                  .then(() => toast(v ? 'Plata online activată' : 'Plata online dezactivată'))
                  .catch((err) =>
                    toast(err instanceof Error ? err.message : 'Eroare la salvare', 'error'),
                  )
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

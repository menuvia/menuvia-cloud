// SmsNotificationsCard — Setări: SMS tranzacționale (mig 228). Pattern-ul
// LoyaltySettingsCard: gate-ul REAL e server-side (plan_features +
// modulul `sms_notifications` + plafonul lunar, toate în enqueue_sms);
// aici doar UX-ul: toggle + contorul lunar din get_sms_usage.
import { useEffect, useState } from 'react'
import { D } from '../lib/constants'
import { planTier } from '../lib/features'
import { supabase } from '../lib/supabase'
import { Toggle } from './_dashboard/sharedUI'
import { Icon } from './ui/Icon'
import type { useRestaurantModules } from '../hooks/useRestaurantModules'

interface Props {
  restaurantId: string
  plan: string
  modulesState: ReturnType<typeof useRestaurantModules>
  toast: (msg: string, type?: string) => void
}

interface SmsUsage {
  used: number
  cap: number | null
  module_enabled: boolean
  plan_enabled: boolean
}

export default function SmsNotificationsCard({ restaurantId, plan, modulesState, toast }: Props) {
  const eligible = planTier(plan) >= 1 && plan !== 'free'
  const enabled = modulesState.isEnabled('sms_notifications')
  const [usage, setUsage] = useState<SmsUsage | null>(null)

  useEffect(() => {
    if (!eligible) return
    let cancelled = false
    void supabase
      .rpc('get_sms_usage', { p_restaurant_id: restaurantId })
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        setUsage(data as SmsUsage)
      })
    return () => {
      cancelled = true
    }
    // enabled în deps: contorul se reîmprospătează la toggle.
  }, [restaurantId, eligible, enabled])

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
        <Icon name="bell" size={16} color={D.gold} />
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1 }}>
          Notificări SMS către clienți
        </span>
      </div>
      <div style={{ fontSize: '0.75rem', color: D.t2, lineHeight: 1.6, marginBottom: 14 }}>
        Clientul primește SMS la confirmarea rezervării și când comanda de ridicare e gata.
        Doar numere de mobil românești; mesajele sunt strict tranzacționale (fără marketing).
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
          Disponibil pe planurile plătite — fiecare plan include un număr de SMS-uri pe lună.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                Activează SMS-urile
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                Confirmare rezervare + „comanda e gata" la ridicare. Se opresc automat când
                atingi plafonul lunar al planului.
              </div>
            </div>
            <Toggle
              value={enabled}
              onChange={(v) => {
                modulesState
                  .setModule('sms_notifications', v)
                  .then(() => toast(v ? 'SMS-urile au fost activate' : 'SMS-urile au fost dezactivate'))
                  .catch((err) =>
                    toast(err instanceof Error ? err.message : 'Eroare la salvare', 'error'),
                  )
              }}
            />
          </div>

          {usage && (
            <div
              style={{
                background: D.s3,
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: '0.78rem',
                color: D.t2,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="chart" size={14} color={D.t2} />
              <span>
                Luna aceasta:{' '}
                <strong style={{ color: D.t1 }}>
                  {usage.used}
                  {usage.cap != null ? ` / ${usage.cap}` : ''} SMS
                </strong>
                {usage.cap != null && usage.used >= usage.cap && (
                  <span style={{ color: D.amber }}> — plafon atins; reia luna viitoare</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

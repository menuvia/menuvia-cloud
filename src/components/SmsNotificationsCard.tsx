// SmsNotificationsCard — Setări: SMS tranzacționale (mig 228). Pattern-ul
// LoyaltySettingsCard: gate-ul REAL e server-side (plan_features +
// modulul `sms_notifications` + plafonul lunar, toate în enqueue_sms);
// aici doar UX-ul: toggle + contorul lunar din get_sms_usage.
// Limba (lotul L6b): textele vin din `settingsCards` (același chunk cu fila
// Setări); erorile prin `describeStaffError` (în română exact `toUserMessage`).
// SMS-urile TRIMISE oaspeților nu sunt aici (L8).
import { useEffect, useState } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { Toggle, AutoSaveHint } from './_dashboard/sharedUI'
import { Icon } from './ui/Icon'
import type { useRestaurantModules } from '../hooks/useRestaurantModules'
import { useT } from '../i18n/useT'
import { describeStaffError } from '../i18n/staffErrors'
import { settingsCardsNs } from '../i18n/ns/settingsCards'
import { commonNs } from '../i18n/ns/common'
import { fillNodes } from '../i18n/fillNodes'

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
  const tr = useT(settingsCardsNs)
  const tc = useT(commonNs)
  // `planTier(plan) >= 1` era mereu adevărat (tier-ul e 1–3), deci condiția
  // reală a fost dintotdeauna „nu e free" — oglinda `sms_notifications` din
  // plan_features (starter+). Din lotul P, SettingsTab montează cardul doar pe
  // planSurface.sms, deci starea blocată rămâne doar ca plasă.
  const eligible = plan !== 'free'
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
          {tr.t('sms_title')}
        </span>
        {/* Comutatorul scrie imediat (setModule) — fără „Salvează" (lotul R2). */}
        {eligible && <AutoSaveHint />}
      </div>
      <div style={{ fontSize: '0.75rem', color: D.t2, lineHeight: 1.6, marginBottom: 14 }}>
        {tr.t('sms_desc')}
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
          {tr.t('sms_locked')}
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
                {tr.t('sms_enableTitle')}
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                {tr.t('sms_enableDesc')}
              </div>
            </div>
            <Toggle
              label={tr.t('sms_toggle')}
              value={enabled}
              onChange={(v) => {
                modulesState
                  .setModule('sms_notifications', v)
                  .then(() => toast(tr.t(v ? 'sms_enabled' : 'sms_disabled')))
                  .catch((err: unknown) =>
                    toast(describeStaffError(err, tc, { fallback: tr.t('err_save') }), 'error'),
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
                {fillNodes(tr.t('sms_usage'), {
                  count: (
                    <strong style={{ color: D.t1 }}>
                      {usage.cap != null
                        ? tr.t('sms_usageCap', { used: usage.used, cap: usage.cap })
                        : tr.t('sms_usageNoCap', { used: usage.used })}
                    </strong>
                  ),
                })}
                {usage.cap != null && usage.used >= usage.cap && (
                  <span style={{ color: D.amber }}> {tr.t('sms_capReached')}</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

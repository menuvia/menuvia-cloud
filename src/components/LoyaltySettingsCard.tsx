// LoyaltySettingsCard — Setări → Comenzi: programul de fidelizare (Loyalty v1,
// mig 226). Pattern-ul OnlinePaymentsCard: gate-ul REAL e server-side
// (plan_features.loyalty growth+ + modulul `loyalty` + program activ);
// aici doar UX-ul. Configurația (puncte/leu, prag, recompensă) se scrie
// direct în loyalty_programs — RLS permite doar adminilor restaurantului.
// Lotul C7c: câmpurile programului sunt ale FORMULARULUI paginii
// (`useLoyaltyProgramForm`, ținut de SettingsTab): se salvează cu „Salvează”
// de sus, iar paza de modificări nesalvate le acoperă. Cardul nu mai are buton
// propriu și nici stare proprie (cu ea, o trecere pe altă secțiune pierdea
// modificările). Doar comutatorul modulului se scrie imediat — marcat ca atare.
// Limba (lotul L6b): textele vin din `settingsCards` (același chunk cu fila
// Setări), „Reîncearcă” din `common`; erorile serverului prin
// `describeStaffError` (în română exact `toUserMessage`). Recompensa
// IMPLICITĂ e o valoare a meniului (o vede oaspetele), nu un text al
// personalului: vine din limba de BAZĂ a meniului (`loyaltyDefaultReward`,
// în hook).
import { useId, type CSSProperties } from 'react'
import { D, PLAN_LABELS } from '../lib/constants'
import { planTier } from '../lib/features'
import { AutoSaveHint, Toggle } from './_dashboard/sharedUI'
import { Icon } from './ui/Icon'
import type { useRestaurantModules } from '../hooks/useRestaurantModules'
import type { LoyaltyProgramForm } from '../hooks/useLoyaltyProgramForm'
import { LOYALTY_REWARD_MAX } from '../lib/loyaltyProgramForm'
import { useT } from '../i18n/useT'
import { describeStaffError } from '../i18n/staffErrors'
import { settingsCardsNs } from '../i18n/ns/settingsCards'
import { commonNs } from '../i18n/ns/common'
import { fillNodes } from '../i18n/fillNodes'

interface Props {
  plan: string
  modulesState: ReturnType<typeof useRestaurantModules>
  toast: (msg: string, type?: string) => void
  /** Programul, ca parte a formularului paginii (SettingsTab). */
  program: LoyaltyProgramForm
}

const inp: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 8,
  padding: '9px 12px',
  color: D.t1,
  fontSize: '0.85rem',
  fontFamily: 'DM Sans,sans-serif',
}

// Câmpurile se pot edita DOAR pe `ready`: pe o citire eșuată, valorile afișate
// sunt cele implicite, iar un „Salvează" le-ar fi scris peste pragul și
// recompensa reale ale localului (fail-closed, LY1).

export default function LoyaltySettingsCard({ plan, modulesState, toast, program }: Props) {
  const tr = useT(settingsCardsNs)
  const tc = useT(commonNs)
  const eligible = planTier(plan) >= 2
  const fieldId = useId()
  const loaded = program.loadState === 'ready'
  const moduleOn = modulesState.isEnabled('loyalty')

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
        <Icon name="star" size={16} color={D.gold} />
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: D.t1 }}>
          {tr.t('loy_title')}
        </span>
      </div>
      <div style={{ fontSize: '0.75rem', color: D.t2, lineHeight: 1.6, marginBottom: 14 }}>
        {tr.t('loy_desc')}
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
          {fillNodes(tr.t('loy_locked'), {
            plan: <strong style={{ color: D.gold }}>{PLAN_LABELS.growth}</strong>,
          })}
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
              {/* Comutatorul modulului se scrie IMEDIAT (setModule), spre
                  deosebire de câmpurile de dedesubt — marcat ca atare (lotul C7c). */}
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: D.t1 }}>
                {tr.t('loy_enableTitle')}
                <AutoSaveHint />
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                {tr.t('loy_enableDesc')}
              </div>
            </div>
            <Toggle
              label={tr.t('loy_toggle')}
              value={moduleOn}
              onChange={(v) => {
                modulesState
                  .setModule('loyalty', v)
                  .then(() => toast(tr.t(v ? 'loy_enabled' : 'loy_disabled')))
                  .catch((err: unknown) =>
                    toast(describeStaffError(err, tc, { fallback: tr.t('err_save') }), 'error'),
                  )
              }}
            />
          </div>

          {program.loadState === 'error' && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                background: D.redA,
                border: `1px solid ${D.red}`,
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: '0.78rem',
                color: D.t1,
              }}
            >
              <span>{tr.t('loy_loadError')}</span>
              <button
                type="button"
                onClick={program.reload}
                style={{
                  background: D.s3,
                  color: D.t1,
                  border: `1px solid ${D.border}`,
                  borderRadius: 8,
                  padding: '8px 14px',
                  minHeight: 44,
                  fontFamily: 'DM Sans,sans-serif',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {tc.t('retry')}
              </button>
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
            }}
          >
            <div>
              <label
                htmlFor={`${fieldId}-ppl`}
                style={{ display: 'block', fontSize: '0.72rem', color: D.t2, marginBottom: 5 }}
              >
                {tr.t('loy_ppl')}
              </label>
              <input
                id={`${fieldId}-ppl`}
                value={program.values.pointsPerLeu}
                onChange={(e) => program.setField('pointsPerLeu', e.target.value)}
                disabled={!loaded}
                inputMode="decimal"
                style={inp}
              />
            </div>
            <div>
              <label
                htmlFor={`${fieldId}-thr`}
                style={{ display: 'block', fontSize: '0.72rem', color: D.t2, marginBottom: 5 }}
              >
                {tr.t('loy_threshold')}
              </label>
              <input
                id={`${fieldId}-thr`}
                value={program.values.threshold}
                onChange={(e) => program.setField('threshold', e.target.value)}
                disabled={!loaded}
                inputMode="numeric"
                style={inp}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor={`${fieldId}-reward`}
              style={{ display: 'block', fontSize: '0.72rem', color: D.t2, marginBottom: 5 }}
            >
              {tr.t('loy_reward')}
            </label>
            <input
              id={`${fieldId}-reward`}
              value={program.values.reward}
              onChange={(e) =>
                program.setField('reward', e.target.value.slice(0, LOYALTY_REWARD_MAX))
              }
              disabled={!loaded}
              placeholder={tr.t('loy_rewardPlaceholder')}
              style={inp}
            />
          </div>
          {/* Modulul e pornit, dar programul n-a fost salvat niciodată:
              fidelizarea nu pornește fără rândul din loyalty_programs
              (`fn_loyalty_active`, mig 226) — „Salvează” de sus îl creează. */}
          {loaded && !program.exists && moduleOn && (
            <div style={{ fontSize: '0.74rem', color: D.gold, lineHeight: 1.5 }}>
              {tr.t('loy_notSaved')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

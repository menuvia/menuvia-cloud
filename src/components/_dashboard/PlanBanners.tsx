// ─────────────────────────────────────────────────────────────
// PlanBanners — benzile panoului legate de planul restaurantului.
//
// Regula comună (perf-staff-3): o bandă despre plan se arată DOAR pe un plan
// CUNOSCUT. Cât planul se încarcă sau citirea lui a eșuat, panoul nu are voie
// să afirme „Plan gratuit 0/15" unui plătitor — pe eroare apare PlanUnknownBanner.
// Banda planului gratuit din bara laterală (FreePlanBanner, „Vezi planurile")
// a ieșit în lotul P: upsell-ul e unul singur, pe Acasă (PlanUpsellCard).
// ─────────────────────────────────────────────────────────────
import { D } from '../../lib/constants'
import { useT } from '../../i18n/useT'
import { homeNs } from '../../i18n/ns/home'
import { commonNs } from '../../i18n/ns/common'

/**
 * Citirea planului a EȘUAT (useFeatures.loadError, fără un plan cunoscut din
 * cache). Panoul rămâne pe varianta cea mai restrictivă (fără suprafețe de
 * bani), dar spune DE CE lipsesc secțiuni, în loc să pară un plan gratuit.
 * Inline (nu fixată jos): nu interceptează click-urile din bara de navigare.
 */
export function PlanUnknownBanner({ onRetry }: { onRetry: () => void }) {
  const { t } = useT(homeNs)
  const tc = useT(commonNs)
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        background: D.s2,
        border: `1px solid ${D.gold}55`,
        borderRadius: 12,
        padding: '12px 16px',
        marginBottom: 18,
      }}
    >
      <div style={{ flex: '1 1 240px', color: D.t1, fontSize: '0.85rem', lineHeight: 1.5 }}>
        {t('planUnknown_text')}
      </div>
      <button
        onClick={onRetry}
        className="pressable"
        style={{
          background: D.gold,
          color: '#000',
          border: 'none',
          borderRadius: 9,
          padding: '9px 16px',
          minHeight: 40,
          fontFamily: 'DM Sans,sans-serif',
          fontSize: '0.82rem',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {tc.t('retry')}
      </button>
    </div>
  )
}

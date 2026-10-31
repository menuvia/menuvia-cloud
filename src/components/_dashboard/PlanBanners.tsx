// ─────────────────────────────────────────────────────────────
// PlanBanners — benzile panoului legate de planul restaurantului.
//
// Regula comună (perf-staff-3): o bandă despre plan se arată DOAR pe un plan
// CUNOSCUT. Cât planul se încarcă sau citirea lui a eșuat, panoul nu are voie
// să afirme „Plan gratuit 0/15" unui plătitor — DashboardPage montează
// FreePlanBanner doar pe `free` cunoscut, iar pe eroare PlanUnknownBanner.
// ─────────────────────────────────────────────────────────────
import { D, PLAN_LABELS } from '../../lib/constants'

/**
 * Banda din sidebar pe planul gratuit (ux-owner-upgrade-banner). Înainte scria
 * „Upgrade la Pro" (id intern + un plan care nici nu e următorul pas) și
 * deschidea modalul cu „Ai atins limita de produse" și la 0/15. Acum: numele
 * comercial al planului, utilizarea reală (sau „…" când nu o știm) și un buton
 * care doar deschide comparația — motivul îl dă `planUsageReason`.
 */
export function FreePlanBanner({
  productCount,
  maxProducts,
  onShowPlans,
}: {
  /** null = necunoscut (încă se citește sau citirea a eșuat). */
  productCount: number | null
  maxProducts: number
  onShowPlans: () => void
}) {
  // Necunoscutul (null) nu se desenează ca 0: bara rămâne goală, cifra e „…".
  const pct =
    productCount != null
      ? Math.min(100, Math.round((productCount / Math.max(1, maxProducts)) * 100))
      : 0
  const isAtLimit = productCount != null && productCount >= maxProducts
  const isNearLimit = productCount != null && !isAtLimit && pct >= 70

  return (
    <div
      style={{
        margin: '8px 8px 4px',
        background: D.s2,
        border: `1px solid ${isAtLimit ? D.red + '44' : isNearLimit ? D.gold + '44' : D.border}`,
        borderRadius: 10,
        padding: '12px 14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 7,
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: isAtLimit ? D.red : isNearLimit ? D.gold : D.t2,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {PLAN_LABELS.free}
        </span>
        <span style={{ fontSize: '0.7rem', color: isAtLimit ? D.red : D.t2 }}>
          {productCount ?? '…'}/{maxProducts} produse
        </span>
      </div>
      <div
        role={productCount != null ? 'progressbar' : undefined}
        aria-label={productCount != null ? 'Produse folosite din plan' : undefined}
        aria-valuenow={productCount ?? undefined}
        aria-valuemin={productCount != null ? 0 : undefined}
        aria-valuemax={productCount != null ? maxProducts : undefined}
        style={{
          height: 3,
          background: D.s3,
          borderRadius: 2,
          overflow: 'hidden',
          marginBottom: 10,
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: 2,
            background: isAtLimit ? D.red : isNearLimit ? D.amber : D.t3,
            width: `${pct}%`,
            transition: 'width .4s',
          }}
        />
      </div>
      <button
        onClick={onShowPlans}
        style={{
          width: '100%',
          background: D.gold,
          color: '#000',
          border: 'none',
          borderRadius: 7,
          padding: '8px 0',
          fontFamily: 'DM Sans,sans-serif',
          fontSize: '0.78rem',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Vezi planurile →
      </button>
    </div>
  )
}

/**
 * Citirea planului a EȘUAT (useFeatures.loadError, fără un plan cunoscut din
 * cache). Panoul rămâne pe varianta cea mai restrictivă (fără suprafețe de
 * bani), dar spune DE CE lipsesc secțiuni, în loc să pară un plan gratuit.
 * Inline (nu fixată jos): nu interceptează click-urile din bara de navigare.
 */
export function PlanUnknownBanner({ onRetry }: { onRetry: () => void }) {
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
        Nu am putut încărca planul restaurantului. Până se încarcă, unele secțiuni rămân ascunse.
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
        Reîncearcă
      </button>
    </div>
  )
}

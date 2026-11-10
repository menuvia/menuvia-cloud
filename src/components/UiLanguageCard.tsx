// Card „Limba interfeței” — Setări → Abonament & cont (lotul L3b).
// Alegerea e a CONTULUI (`profiles.ui_language`, mig 323 — coloană scriibilă
// de `authenticated`), deci aceeași pe orice dispozitiv; o copie merge și în
// stocarea locală (`menuvia_ui_lang`), preferința dispozitivului pentru
// ecranele de dinaintea logării. `refreshProfile()` reîncarcă profilul, iar
// `UiLangProvider` schimbă limba întregului arbore.
//
// Cardul NU apare cât timp e activă o singură limbă (`ENABLED_STAFF_LANGS`):
// comutatorul apare abia când panoul, ospătarul și bucătăria sunt complete în
// limba nouă (decizia din plan) — azi nu se vede nimic schimbat.
//
// Salvarea (UPDATE pe profil, stocarea locală, `refreshProfile`, erorile —
// inclusiv 42703 și zero rânduri) stă în `useSetUiLanguage` (lotul L4c), hook
// comun cu comutatorul compact din antetul Ospătarului și al Bucătăriei
// (UiLanguageSelect): cele două nu au voie să se despartă.
import { D } from '../lib/constants'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'
import { inp } from './_dashboard/sharedUI'
import { useT } from '../i18n/useT'
import { dashboardNs } from '../i18n/ns/dashboard'
import { commonNs } from '../i18n/ns/common'
import { LANG_NAME_KEY, useSetUiLanguage } from '../i18n/useSetUiLanguage'

export default function UiLanguageCard() {
  const { t } = useT(dashboardNs)
  const tc = useT(commonNs)
  const { visible, enabled, value, saving, error, choose } = useSetUiLanguage()

  if (!visible) return null

  return (
    <Card variant="flat">
      <h2
        style={{
          fontFamily: D.fontBody,
          fontSize: '0.92rem',
          fontWeight: 600,
          color: D.t1,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          margin: '0 0 6px',
        }}
      >
        <Icon name="info" size={16} color={D.gold} />
        {tc.t('lang_title')}
      </h2>
      <div style={{ fontSize: '0.75rem', color: D.t2, marginBottom: 14, lineHeight: 1.5 }}>
        {t('lang_desc')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <select
          disabled={saving}
          aria-label={tc.t('lang_title')}
          value={value}
          onChange={(e) => void choose(e.target.value)}
          style={{ ...inp, width: 'auto', minWidth: 200, cursor: saving ? 'wait' : 'pointer' }}
        >
          {enabled.map((l) => (
            <option key={l} value={l} lang={l}>
              {tc.t(LANG_NAME_KEY[l])}
            </option>
          ))}
        </select>
        {saving && (
          <span role="status" style={{ fontSize: '0.78rem', color: D.t3 }}>
            {tc.t('lang_saving')}
          </span>
        )}
      </div>
      {error != null && (
        <div
          role="alert"
          style={{ marginTop: 10, fontSize: '0.78rem', color: D.red, lineHeight: 1.5 }}
        >
          {error}
        </div>
      )}
    </Card>
  )
}

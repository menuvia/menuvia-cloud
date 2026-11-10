// Comutatorul COMPACT de limbă din antetul Ospătarului și al Bucătăriei
// (lotul L4c): pe o tabletă comună, fiecare om își alege limba fără să intre
// în Setări. Un singur <select>, cu numele limbilor în limba LOR; aceleași
// reguli ca cardul din Setări (UiLanguageCard), prin ACELAȘI hook
// (`useSetUiLanguage`) — nu se randează deloc cât timp e activă o singură
// limbă (azi `ENABLED_STAFF_LANGS = ['ro']` → nimic vizibil), salvarea merge
// în cont, apoi în stocarea locală, apoi `refreshProfile()`; pe eroare
// alegerea revine pe limba de dinainte și mesajul apare sub comutator
// (`compactError`: la 42703 varianta scurtă, fără „Panoul rămâne…”).
// Textele vin din `common` (cerut sus de ambele ecrane), nu din `dashboard`:
// Ospătarul și Bucătăria nu încarcă dicționarul panoului.
import { D } from '../lib/constants'
import { useT } from '../i18n/useT'
import { commonNs } from '../i18n/ns/common'
import { LANG_NAME_KEY, useSetUiLanguage } from '../i18n/useSetUiLanguage'

export function UiLanguageSelect() {
  const tc = useT(commonNs)
  const { visible, enabled, value, saving, compactError: error, choose } = useSetUiLanguage()

  if (!visible) return null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
        flexShrink: 0,
      }}
    >
      <select
        disabled={saving}
        aria-label={tc.t('lang_title')}
        title={tc.t('lang_title')}
        value={value}
        onChange={(e) => void choose(e.target.value)}
        style={{
          background: D.s3,
          border: `1px solid ${D.s3}`,
          borderRadius: 7,
          color: D.t1,
          minHeight: 44,
          padding: '6px 8px',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: D.fontBody,
          cursor: saving ? 'wait' : 'pointer',
          outline: 'none',
          opacity: saving ? 0.6 : 1,
        }}
      >
        {enabled.map((l) => (
          <option key={l} value={l} lang={l}>
            {tc.t(LANG_NAME_KEY[l])}
          </option>
        ))}
      </select>
      {error != null && (
        <span
          role="alert"
          style={{ color: D.red, fontSize: '0.72rem', lineHeight: 1.4, maxWidth: 220, textAlign: 'right' }}
        >
          {error}
        </span>
      )}
    </div>
  )
}

export default UiLanguageSelect

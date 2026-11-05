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
// Erorile: supabase-js întoarce `{ error }` (nu aruncă), iar un UPDATE refuzat
// de RLS întoarce zero rânduri (`zeroRowsAsDenied`). Pe eroare valoarea rămâne
// cea de dinainte și nu se scrie nimic local; 42703 (coloana lipsește:
// clientul a ajuns înaintea migrației) are mesajul lui.
import { useState } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { zeroRowsAsDenied } from '../lib/userMessages'
import { useAuth } from '../contexts/AuthContext'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'
import { inp } from './_dashboard/sharedUI'
import { useUiLang } from '../i18n/UiLangContext'
import { UI_LANG_STORAGE_KEY, isStaffLang, type StaffLang } from '../i18n/langs'
import { useT } from '../i18n/useT'
import { dashboardNs } from '../i18n/ns/dashboard'
import { commonNs } from '../i18n/ns/common'
import { describeStaffError } from '../i18n/staffErrors'

// Numele fiecărei limbi, în limba EI (identic în toate dicționarele).
const LANG_NAME_KEY = {
  ro: 'lang_name_ro',
  en: 'lang_name_en',
  fr: 'lang_name_fr',
  de: 'lang_name_de',
} as const satisfies Record<StaffLang, string>

function storeDeviceLang(lang: StaffLang): void {
  try {
    window.localStorage.setItem(UI_LANG_STORAGE_KEY, lang)
  } catch {
    /* Safari „Block All Cookies” (RESID-15): limba rămâne doar în cont */
  }
}

export default function UiLanguageCard() {
  const { user, refreshProfile } = useAuth()
  const { lang, enabled } = useUiLang()
  const { t } = useT(dashboardNs)
  const tc = useT(commonNs)
  // Limba aleasă cât se salvează (select-ul o arată); `null` = cea curentă.
  const [pending, setPending] = useState<StaffLang | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (enabled.length < 2 || !user) return null

  const saving = pending != null

  const choose = async (raw: string) => {
    if (!isStaffLang(raw) || raw === lang || saving) return
    setPending(raw)
    setError(null)
    try {
      // `.select`: un UPDATE refuzat de RLS întoarce 200 cu zero rânduri, nu o
      // eroare — fără numărare, limba ar fi „salvată” doar local.
      const res = await supabase
        .from('profiles')
        .update({ ui_language: raw })
        .eq('id', user.id)
        .select('id')
      const upErr = zeroRowsAsDenied(res)
      if (upErr) {
        setError(
          upErr.code === '42703'
            ? t('lang_columnMissing')
            : describeStaffError(upErr, tc, { fallback: t('lang_saveFailed') }),
        )
        return
      }
      storeDeviceLang(raw)
      await refreshProfile()
    } catch (e) {
      setError(describeStaffError(e, tc, { fallback: t('lang_saveFailed') }))
    } finally {
      setPending(null)
    }
  }

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
        {t('lang_title')}
      </h2>
      <div style={{ fontSize: '0.75rem', color: D.t2, marginBottom: 14, lineHeight: 1.5 }}>
        {t('lang_desc')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <select
          disabled={saving}
          aria-label={t('lang_title')}
          value={pending ?? lang}
          onChange={(e) => void choose(e.target.value)}
          style={{ ...inp, width: 'auto', minWidth: 200, cursor: saving ? 'wait' : 'pointer' }}
        >
          {enabled.map((l) => (
            <option key={l} value={l} lang={l}>
              {t(LANG_NAME_KEY[l])}
            </option>
          ))}
        </select>
        {saving && (
          <span role="status" style={{ fontSize: '0.78rem', color: D.t3 }}>
            {t('lang_saving')}
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

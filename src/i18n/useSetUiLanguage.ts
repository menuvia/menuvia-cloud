// src/i18n/useSetUiLanguage.ts — schimbarea limbii interfeței, o SINGURĂ
// implementare pentru ambele comutatoare (lotul L4c): cardul din Setări →
// Abonament & cont (UiLanguageCard, lotul L3b) și varianta compactă din
// antetul Ospătarului și al Bucătăriei (UiLanguageSelect) — personalul de pe
// o tabletă comună își schimbă limba fără să intre în Setări.
//
// Regulile (cele din L3b, mutate aici neschimbate):
//   - comutatorul NU se arată cât timp e activă o singură limbă
//     (`ENABLED_STAFF_LANGS`) sau nu există cont (`visible`);
//   - alegerea e a CONTULUI: UPDATE pe `profiles.ui_language` cu `.select('id')`
//     + `zeroRowsAsDenied` (un UPDATE refuzat de RLS întoarce 200 cu zero
//     rânduri, nu o eroare); apoi copia locală `menuvia_ui_lang` (try/catch —
//     Safari „Block All Cookies”), apoi `refreshProfile()`, care schimbă limba
//     întregului arbore prin `UiLangProvider`;
//   - pe eroare nu se scrie nimic local, alegerea revine pe limba de dinainte
//     și se arată mesajul; 42703 (coloana mig 323 lipsește — clientul a ajuns
//     înaintea migrației) are mesajul lui.
// Din activarea limbilor (precondițiile auditului):
//   - „aceeași limbă” se judecă față de limba CONTULUI, nu doar față de cea de
//     pe ecran: un cont fără limbă salvată care vede panoul în limba
//     browserului trebuie să-și poată salva limba asta, iar un `?lang=` din
//     link (care bate contul) nu are voie să facă alegerea explicită inutilă;
//   - după o salvare reușită, `?lang=` iese din adresă (o alegere explicită în
//     cont bate linkul cu care ai intrat) și ruta se anunță, ca
//     `UiLangProvider` să recitească adresa;
//   - limba intră și în `user_metadata.ui_lang` (best-effort, fără efect pe
//     eroare): șabloanele Supabase Auth (resetarea parolei, schimbarea
//     emailului) o citesc de acolo, nu din profil.
// Eroarea se ține ca DATE și se traduce la randare (textul urmează limba).
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { zeroRowsAsDenied } from '../lib/userMessages'
import { useAuth } from '../contexts/AuthContext'
import { useUiLang } from './UiLangContext'
import { UI_LANG_STORAGE_KEY, isStaffLang, type StaffLang } from './langs'
import { useT } from './useT'
import { commonNs } from './ns/common'
import { describeStaffError } from './staffErrors'
import { ROUTE_CHANGE_EVENT } from '../lib/routeEvents'

/** Numele fiecărei limbi, în limba EI (identic în toate dicționarele `common`). */
export const LANG_NAME_KEY = {
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

/** Scoate `?lang=` din adresă (fără intrare nouă în istoric) și anunță ruta. */
function dropUrlLang(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('lang')) return
    url.searchParams.delete('lang')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT))
  } catch {
    /* fără `window`/`history` (teste izolate): nimic de curățat */
  }
}

/** Limba și în `user_metadata`, pentru șabloanele Supabase Auth. Best-effort:
 *  eșecul (rețea, client vechi, mock fără `auth`) nu atinge salvarea. */
function syncAuthMetadata(lang: StaffLang): void {
  try {
    void Promise.resolve(supabase.auth.updateUser({ data: { ui_lang: lang } })).catch(() => undefined)
  } catch {
    /* clientul Supabase fără `auth` (teste): metadata rămâne cea de la signup */
  }
}

type SaveFailure = { kind: 'columnMissing' } | { kind: 'error'; err: unknown }

export interface SetUiLanguage {
  /** false → comutatorul nu se randează deloc (o singură limbă / fără cont). */
  visible: boolean
  lang: StaffLang
  enabled: readonly StaffLang[]
  /** Valoarea pe care o arată comutatorul: alegerea în curs de salvare sau limba curentă. */
  value: StaffLang
  saving: boolean
  /** Refuzul ultimei salvări, deja tradus (null = nimic de arătat) — textul cardului din Setări. */
  error: string | null
  /**
   * Același refuz pentru comutatorul COMPACT din antet: identic cu `error`, în
   * afară de 42703, unde cardul spune „Panoul rămâne…” (pe Ospătar/Bucătărie
   * nu e niciun panou, iar sub select e loc puțin) — aici varianta scurtă.
   */
  compactError: string | null
  choose: (raw: string) => Promise<void>
}

export function useSetUiLanguage(): SetUiLanguage {
  const { user, profile, refreshProfile, applyProfileLanguage } = useAuth()
  const { lang, enabled } = useUiLang()
  const tc = useT(commonNs)
  // Limba aleasă cât se salvează (comutatorul o arată); `null` = cea curentă.
  const [pending, setPending] = useState<StaffLang | null>(null)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const saving = pending != null

  const choose = async (raw: string): Promise<void> => {
    if (!user || !isStaffLang(raw) || saving) return
    // Nimic de făcut doar dacă limba aleasă e ȘI a contului, ȘI cea de pe ecran.
    if (raw === lang && raw === (profile?.ui_language ?? null)) return
    setPending(raw)
    setFailure(null)
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
        setFailure(upErr.code === '42703' ? { kind: 'columnMissing' } : { kind: 'error', err: upErr })
        return
      }
      storeDeviceLang(raw)
      // Profilul din memorie primește limba ÎNAINTE ca `?lang=` să iasă din
      // adresă: dacă reîncărcarea de mai jos pică, ecranul rămâne pe alegere.
      applyProfileLanguage?.(raw)
      syncAuthMetadata(raw)
      dropUrlLang()
      await refreshProfile()
    } catch (e) {
      setFailure({ kind: 'error', err: e })
    } finally {
      setPending(null)
    }
  }

  const error =
    failure == null
      ? null
      : failure.kind === 'columnMissing'
        ? tc.t('lang_columnMissing')
        : describeStaffError(failure.err, tc, { fallback: tc.t('lang_saveFailed') })
  const compactError = failure?.kind === 'columnMissing' ? tc.t('lang_columnMissingShort') : error

  return {
    visible: enabled.length >= 2 && user != null,
    lang,
    enabled,
    value: pending ?? lang,
    saving,
    error,
    compactError,
    choose,
  }
}

// src/i18n/UiLangContext.tsx — limba personalului pentru tot arborele (L0b).
// Stă în INTRAREA aplicației (App.tsx), deci importă doar module mici, fără
// dicționare: `langs`, `resolveLang`, `lib/domain` (deja în intrare).
// Fără provider (teste, componente randate izolat) limba e 'ro' — testele cu
// text românesc rămân neschimbate.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { browserSite, defaultUiLang } from '../lib/domain'
import { ENABLED_STAFF_LANGS, UI_LANG_STORAGE_KEY, type StaffLang } from './langs'
import { resolveUiLang } from './resolveLang'

interface UiLangValue {
  lang: StaffLang
  /** Limbile care pot fi alese azi (comutatorul le listează doar pe acestea). */
  enabled: readonly StaffLang[]
}

const UiLangContext = createContext<UiLangValue>({ lang: 'ro', enabled: ENABLED_STAFF_LANGS })

function readStoredLang(): string | null {
  try {
    return window.localStorage.getItem(UI_LANG_STORAGE_KEY)
  } catch {
    return null // Safari „Block All Cookies": accesul ARUNCĂ (RESID-15)
  }
}

function readUrlLang(): string | null {
  if (typeof window === 'undefined' || !window.location) return null
  return new URLSearchParams(window.location.search).get('lang')
}

function readNavigatorLangs(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : []
}

export function UiLangProvider({
  children,
  lang: forced,
  enabled = ENABLED_STAFF_LANGS,
}: {
  children: ReactNode
  /** Doar pentru teste și previzualizări: limba impusă, fără rezolvare. */
  lang?: StaffLang
  enabled?: readonly StaffLang[]
}) {
  const { profile } = useAuth()
  const profileLang = profile?.ui_language ?? null
  const value = useMemo<UiLangValue>(() => {
    const lang =
      forced ??
      resolveUiLang({
        urlLang: readUrlLang(),
        profileLang,
        storedLang: readStoredLang(),
        navigatorLangs: readNavigatorLangs(),
        siteLang: defaultUiLang(browserSite()),
        enabled,
      })
    return { lang, enabled }
  }, [forced, profileLang, enabled])
  return <UiLangContext.Provider value={value}>{children}</UiLangContext.Provider>
}

export function useUiLang(): UiLangValue {
  return useContext(UiLangContext)
}

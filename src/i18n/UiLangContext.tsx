// src/i18n/UiLangContext.tsx — limba personalului pentru tot arborele (L0b).
// Stă în INTRAREA aplicației (App.tsx), deci importă doar module mici, fără
// dicționare: `langs`, `resolveLang`, `lib/domain` (deja în intrare).
// Fără provider (teste, componente randate izolat) limba e 'ro' — testele cu
// text românesc rămân neschimbate.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { browserSite, defaultUiLang } from '../lib/domain'
import { ENABLED_STAFF_LANGS, FUNNEL_LANGS, UI_LANG_STORAGE_KEY, isStaffLang, type StaffLang } from './langs'
import { resolveFunnelLang, resolveUiLang } from './resolveLang'

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

/**
 * O limbă fixă pentru un sub-arbore, fără rezolvare și fără `useAuth`: pentru
 * teste și pentru `FunnelLangProvider`. `useT` din interior o folosește exact
 * ca pe cea a providerului de sus.
 */
export function UiLangScope({
  lang,
  enabled = FUNNEL_LANGS,
  children,
}: {
  lang: StaffLang
  enabled?: readonly StaffLang[]
  children: ReactNode
}) {
  const value = useMemo<UiLangValue>(() => ({ lang, enabled }), [lang, enabled])
  return <UiLangContext.Provider value={value}>{children}</UiLangContext.Provider>
}

/** `?lang=` din URL devine preferința DISPOZITIVULUI (ca la /en): un om venit
 *  cu linkul englezesc rămâne în engleză și pe ecranul următor. */
function persistUrlLang(): void {
  const raw = readUrlLang()
  const p = raw?.trim().toLowerCase().split(/[-_]/)[0]
  if (!p || !isStaffLang(p) || !FUNNEL_LANGS.includes(p)) return
  try {
    window.localStorage.setItem(UI_LANG_STORAGE_KEY, p)
  } catch {
    /* stocare indisponibilă (mod privat): limba rămâne doar pentru vizita asta */
  }
}

/**
 * Limba ecranelor de DINAINTEA panoului (autentificare, confirmarea emailului,
 * resetarea parolei, Termenii — lotul L2): `resolveFunnelLang`, citită o dată
 * la montare (ca formularul să nu-și schimbe limba sub degetele omului) și
 * recalculată doar când apare limba contului.
 */
export function FunnelLangProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const profileLang = profile?.ui_language ?? null
  const lang = useMemo(
    () =>
      resolveFunnelLang({
        urlLang: readUrlLang(),
        profileLang,
        storedLang: readStoredLang(),
        siteLang: defaultUiLang(browserSite()),
      }),
    [profileLang],
  )
  useEffect(persistUrlLang, [])
  return <UiLangScope lang={lang}>{children}</UiLangScope>
}

// Hook-ul stă lângă provider (ca useAuth): un singur context, o singură sursă.
// eslint-disable-next-line react-refresh/only-export-components
export function useUiLang(): UiLangValue {
  return useContext(UiLangContext)
}

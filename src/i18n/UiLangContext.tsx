// src/i18n/UiLangContext.tsx — limba personalului pentru tot arborele (L0b).
// Stă în INTRAREA aplicației (App.tsx), deci importă doar module mici, fără
// dicționare: `langs`, `resolveLang`, `lib/domain` (deja în intrare) și
// `hooks/useScreenDocument` (doar `chrome.ts` + `useDocumentLang`, lotul L4d).
// Fără provider (teste, componente randate izolat) limba e 'ro' — testele cu
// text românesc rămân neschimbate.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { browserSite, defaultUiLang } from '../lib/domain'
import { ENABLED_STAFF_LANGS, FUNNEL_LANGS, UI_LANG_STORAGE_KEY, isStaffLang, type StaffLang } from './langs'
import { resolveFunnelLang, resolveUiLang } from './resolveLang'
import { useScreenDocument } from '../hooks/useScreenDocument'

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

/** Limba funnel-ului, rezolvată la montare și recalculată doar când apare
 *  limba contului — sursa comună a lui `FunnelLangProvider` și
 *  `FunnelDocumentLang`. */
function useResolvedFunnelLang(): StaffLang {
  const { profile } = useAuth()
  const profileLang = profile?.ui_language ?? null
  return useMemo(
    () =>
      resolveFunnelLang({
        urlLang: readUrlLang(),
        profileLang,
        storedLang: readStoredLang(),
        siteLang: defaultUiLang(browserSite()),
      }),
    [profileLang],
  )
}

/** Limba pusă de `FunnelDocumentLang`; `null` = nicio rută de funnel deasupra. */
const FunnelRouteLangContext = createContext<StaffLang | null>(null)

/**
 * Limba ecranelor de DINAINTEA panoului (autentificare, confirmarea emailului,
 * resetarea parolei, Termenii — lotul L2): `resolveFunnelLang`, citită o dată
 * la montare (ca formularul să nu-și schimbe limba sub degetele omului) și
 * recalculată doar când apare limba contului.
 *
 * `scope="page"` (implicit — AuthPage, OnboardingPage, ResetPasswordPage,
 * InviteAcceptPage) pune limba și pe `<html lang>` + titlul tab-ului (lotul
 * L4d), ca tot cromul comun să urmeze ecranul: funnel-ul e VIU în engleză, iar
 * până la L4d confirmarea implicită spunea „Anulează” pe un ecran englezesc.
 * `scope="overlay"` (poarta de Termeni, montată PESTE orice rută, inclusiv
 * peste meniul oaspetelui) nu atinge documentul: limba paginii de dedesubt nu
 * e a ei — poarta își declară limba pe propriul dialog.
 *
 * Fără `<Suspense>` propriu, deliberat: o limbă ne-română suspendă la prima
 * randare tot sub-arborele paginii, dar în App.tsx fiecare pagină a
 * funnel-ului stă sub `FunnelDocumentLang` + `<Suspense>`-ul rutei, deci
 * documentul și spinner-ul sunt deja în limba ecranului (IY12 îngheață
 * `<FunnelLangProvider>` direct peste `<OnboardingFlow`).
 */
export function FunnelLangProvider({
  children,
  scope = 'page',
}: {
  children: ReactNode
  scope?: 'page' | 'overlay'
}) {
  const own = useResolvedFunnelLang()
  // Sub `FunnelDocumentLang` (rutele din App.tsx) limba și documentul sunt ale
  // RUTEI: un singur scriitor pe `<html lang>`. Două scrieri suprapuse cu
  // aceeași valoare s-ar restaura greșit după o schimbare de limbă (cleanup-ul
  // la actualizare rulează copil-întâi, cel la demontare părinte-întâi).
  const routeLang = useContext(FunnelRouteLangContext)
  const lang = routeLang ?? own
  useEffect(persistUrlLang, [])
  useScreenDocument(scope === 'page' && routeLang === null ? lang : null)
  return <UiLangScope lang={lang}>{children}</UiLangScope>
}

/**
 * Rutele FUNNEL-ului în App.tsx (autentificarea, onboarding-ul, parola nouă,
 * invitația): `<html lang>` + titlul tab-ului urmează limba funnel-ului încă
 * de la spinner-ul RUTEI (fallback-ul `<Suspense>` cât se descarcă chunk-ul
 * paginii, redirectul spre /auth, așteptarea sesiunii) — `FunnelLangProvider`
 * din pagină se montează abia după chunk, deci până atunci cromul ar fi rămas
 * în română pe un /auth?lang=en. Pagina de dedesubt preia limba RUTEI (aceeași
 * rezolvare) și nu mai scrie ea documentul.
 */
export function FunnelDocumentLang({ children }: { children: ReactNode }) {
  const lang = useResolvedFunnelLang()
  useScreenDocument(lang)
  return <FunnelRouteLangContext.Provider value={lang}>{children}</FunnelRouteLangContext.Provider>
}

/**
 * Rutele PERSONALULUI (panoul, ospătarul, bucătăria — App.tsx): `<html lang>`
 * și titlul tab-ului urmează limba personalului (lotul L4d), deci și cromul
 * comun. Azi `ENABLED_STAFF_LANGS = ['ro']`, deci limba e mereu „ro”, ca
 * `index.html`: nimic vizibil. NU se montează deasupra paginilor oaspetelui
 * (vezi `useScreenDocument`): acolo limba e a meniului.
 */
export function StaffDocumentLang({ children }: { children: ReactNode }) {
  const { lang } = useContext(UiLangContext)
  useScreenDocument(lang)
  return <>{children}</>
}

// Hook-ul stă lângă provider (ca useAuth): un singur context, o singură sursă.
// eslint-disable-next-line react-refresh/only-export-components
export function useUiLang(): UiLangValue {
  return useContext(UiLangContext)
}

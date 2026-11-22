// src/i18n/UiLangContext.tsx — limba personalului pentru tot arborele (L0b).
// Stă în INTRAREA aplicației (App.tsx), deci importă doar module mici, fără
// dicționare: `langs`, `resolveLang`, `lib/domain` (deja în intrare) și
// `hooks/useScreenDocument` (doar `chrome.ts` + `useDocumentLang`, lotul L4d).
// Fără provider (teste, componente randate izolat) limba e 'ro' — testele cu
// text românesc rămân neschimbate.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { browserSite, defaultUiLang } from '../lib/domain'
import { ENABLED_STAFF_LANGS, FUNNEL_LANGS, UI_LANG_STORAGE_KEY, isStaffLang, type StaffLang } from './langs'
import { resolveFunnelLang, resolveUiLang } from './resolveLang'
import { useScreenDocument } from '../hooks/useScreenDocument'
import { ROUTE_CHANGE_EVENT } from '../lib/routeEvents'

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

/** Copia limbii CONTULUI, pe cont (nu preferința dispozitivului): o citește
 *  doar rezolvarea personalului, pentru ACEST cont, cât profilul se încarcă. */
const ACCOUNT_LANG_PREFIX = 'menuvia_ui_lang_acct:'

function readAccountLang(uid: string): string | null {
  try {
    return window.localStorage.getItem(ACCOUNT_LANG_PREFIX + uid)
  } catch {
    return null
  }
}

function storeAccountLang(uid: string, lang: StaffLang): void {
  try {
    const key = ACCOUNT_LANG_PREFIX + uid
    if (window.localStorage.getItem(key) !== lang) window.localStorage.setItem(key, lang)
  } catch {
    /* Safari „Block All Cookies”: limba rămâne doar în cont */
  }
}

function readUrlLang(): string | null {
  if (typeof window === 'undefined' || !window.location) return null
  return new URLSearchParams(window.location.search).get('lang')
}

/** `?hl=` — indiciul de limbă din linkul invitației (send-invite.js), NEPERSISTAT. */
function readUrlHint(): string | null {
  if (typeof window === 'undefined' || !window.location) return null
  return new URLSearchParams(window.location.search).get('hl')
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
  const { user, profile } = useAuth()
  const uid = user?.id ?? null
  // Cât profilul se încarcă (AuthContext termină `loading` ÎNAINTEA lui), limba
  // contului vine din copia locală a ACESTUI cont; altfel un cont în română pe
  // un browser în engleză ar vedea la FIECARE deschidere câteva cadre în
  // engleză (și ar descărca dicționarele englezești). Copia e pe cont, nu
  // `menuvia_ui_lang`: preferința dispozitivului (pe care o citește și
  // funnel-ul, scrisă de /en și de `?lang=`) nu se rescrie implicit —
  // recenzia adversarială pe #388: un „ro” pus automat de mig 323 contului
  // vechi ar fi mutat pe română /auth-ul unui dispozitiv ales pe engleză.
  const profileLang =
    profile != null ? (profile.ui_language ?? null) : uid != null ? readAccountLang(uid) : null
  // `?lang=` se RECITEȘTE la fiecare navigare (precondiția B3 a activării):
  // providerul stă deasupra routerului și nu se remontează, deci o valoare
  // citită doar în memo îngheța limba linkului de intrare — butonul de login
  // de pe landing duce la /auth?lang=ro, profilul se încarcă înainte de
  // `replace('/dashboard')`, iar un cont salvat în engleză rămânea pe un panou
  // în română până la reîncărcare (la fel previzualizarea /m/<slug>?lang=de din
  // Traduceri → înapoi pe /dashboard). App anunță fiecare commit al ruterului
  // prin ROUTE_CHANGE_EVENT; Back/Forward emit `popstate`.
  const [urlLang, setUrlLang] = useState<string | null>(readUrlLang)
  useEffect(() => {
    const sync = () => setUrlLang(readUrlLang())
    window.addEventListener('popstate', sync)
    window.addEventListener(ROUTE_CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener(ROUTE_CHANGE_EVENT, sync)
    }
  }, [])
  // Copia pe cont se actualizează la fiecare profil încărcat cu limbă.
  const loadedLang = profile?.ui_language ?? null
  const loadedUid = profile?.id ?? null
  useEffect(() => {
    if (loadedUid && loadedLang && isStaffLang(loadedLang)) storeAccountLang(loadedUid, loadedLang)
  }, [loadedUid, loadedLang])
  const value = useMemo<UiLangValue>(() => {
    const lang =
      forced ??
      resolveUiLang({
        urlLang,
        profileLang,
        storedLang: readStoredLang(),
        navigatorLangs: readNavigatorLangs(),
        siteLang: defaultUiLang(browserSite()),
        enabled,
      })
    return { lang, enabled }
  }, [forced, urlLang, profileLang, enabled])
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

/** Limba funnel-ului pentru `?lang=` primit, recalculată doar când se schimbă
 *  acesta sau limba contului — sursa comună a lui `FunnelLangProvider` și
 *  `FunnelDocumentLang`. Limba păstrată în `localStorage` NU e o dependență,
 *  deliberat: din ACELAȘI tab o scriu doar `persistUrlLang` (din același
 *  `?lang=`, care oricum o bate) și `useSetUiLanguage` (odată cu profilul, deci
 *  memo-ul se recalculează prin `profileLang`); o scriere din ALT tab nu
 *  răstoarnă limba ecranului deschis (controlul LD9). */
function useResolvedFunnelLang(urlLang: string | null, hintLang: string | null): StaffLang {
  const { profile } = useAuth()
  const profileLang = profile?.ui_language ?? null
  return useMemo(
    () =>
      resolveFunnelLang({
        urlLang,
        profileLang,
        hintLang,
        storedLang: readStoredLang(),
        siteLang: defaultUiLang(browserSite()),
      }),
    [urlLang, profileLang, hintLang],
  )
}

/** Limba pusă de `FunnelDocumentLang`; `null` = nicio rută de funnel deasupra. */
const FunnelRouteLangContext = createContext<StaffLang | null>(null)

/**
 * Limba ecranelor de DINAINTEA panoului (autentificare, confirmarea emailului,
 * resetarea parolei, Termenii — lotul L2): `resolveFunnelLang`. Sub
 * `FunnelDocumentLang` (rutele din App.tsx) pagina preia limba RUTEI, care
 * urmează `?lang=` la navigare; fără rută (poarta overlay, teste) `?lang=` se
 * citește o dată, la montare (ca formularul să nu-și schimbe limba sub
 * degetele omului), iar limba se recalculează doar când apare limba contului.
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
  // `?lang=` citit O DATĂ, la montare: poarta (overlay) rămâne montată peste
  // orice navigare și nu-și schimbă limba sub degetele omului.
  const [mountUrlLang] = useState(readUrlLang)
  const [mountHint] = useState(readUrlHint)
  const own = useResolvedFunnelLang(mountUrlLang, mountHint)
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
 *
 * `?lang=` se citește la FIECARE randare (recenzie CodeRabbit pe #372): App.tsx
 * întoarce `<FunnelDocumentLang>` pe aceeași poziție pentru toate rutele
 * funnel-ului, deci React păstrează instanța la /reset-password → /auth (inclusiv
 * pe Back/Forward). Cu memo-ul doar pe limba contului, un /auth?lang=ro atins
 * dintr-un ecran englezesc rămânea în engleză — formularul și documentul.
 * Spinner → pagină pe același URL nu schimbă `?lang=`, deci instanța și limba
 * rămân stabile.
 */
export function FunnelDocumentLang({ children }: { children: ReactNode }) {
  const lang = useResolvedFunnelLang(readUrlLang(), readUrlHint())
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

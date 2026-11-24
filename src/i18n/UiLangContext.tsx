// src/i18n/UiLangContext.tsx — limba personalului pentru tot arborele (L0b).
// Stă în INTRAREA aplicației (App.tsx), deci importă doar module mici, fără
// dicționare: `langs`, `resolveLang`, `accountLang`, `lib/domain` (deja în
// intrare) și `hooks/useScreenDocument` (doar `chrome.ts` + `useDocumentLang`,
// lotul L4d).
// Fără provider (teste, componente randate izolat) limba e 'ro' — testele cu
// text românesc rămân neschimbate.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { browserSite, defaultUiLang } from '../lib/domain'
import { ENABLED_STAFF_LANGS, FUNNEL_LANGS, UI_LANG_STORAGE_KEY, isStaffLang, type StaffLang } from './langs'
import { resolveFunnelLang, resolveUiLang } from './resolveLang'
import { ACCOUNT_LANG_EVENT, readAccountLang, storeAccountLang } from './accountLang'
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
  // Pe o bază fără mig 323 (`ui_language_missing`) contul e român pentru
  // PANOU — exact ce îi dă 323 la aplicare; funnel-ul nu citește semnalul. O
  // copie pe cont deja scrisă (dintr-o limbă REALĂ, citită sau salvată cu
  // coloana prezentă) bate acel 'ro' dedus: un tab rămas „fără coloană” peste
  // aplicarea migrației nu mai suprascrie limba reală a contului (a patra rundă
  // de recenzie). Pe o bază chiar veche copia e cel mult 'ro' — singurul ei
  // scriitor acolo e chiar această regulă —, deci rezultatul nu se schimbă.
  const accountCopy = uid != null ? readAccountLang(uid) : null
  const copiedLang = accountCopy != null && isStaffLang(accountCopy) ? accountCopy : null
  const profileLang =
    profile != null
      ? (profile.ui_language ?? (profile.ui_language_missing ? (copiedLang ?? 'ro') : null))
      : accountCopy
  // Cont logat, profil încă neîncărcat (sau încărcarea a picat) și fără copie
  // pe cont: limba lui e NECUNOSCUTĂ, nu „a browserului”. Un cont român pe un
  // browser în franceză vedea altfel primele cadre — ori toată sesiunea, dacă
  // încărcarea profilului pica — în franceză (recenzia adversarială a
  // activării; copia pe cont lipsește pe orice dispozitiv la prima deschidere
  // după #388). Rezolvarea merge atunci URL → indiciu → dispozitiv → site;
  // browserul contează doar fără cont sau cu un profil încărcat fără limbă.
  const pendingAccount = uid != null && profile == null && profileLang == null
  // `?lang=` se RECITEȘTE la fiecare navigare (precondiția B3 a activării):
  // providerul stă deasupra routerului și nu se remontează, deci o valoare
  // citită doar în memo îngheța limba linkului de intrare — butonul de login
  // de pe landing duce la /auth?lang=ro, profilul se încarcă înainte de
  // `replace('/dashboard')`, iar un cont salvat în engleză rămânea pe un panou
  // în română până la reîncărcare (la fel previzualizarea /m/<slug>?lang=de din
  // Traduceri → înapoi pe /dashboard). App anunță fiecare commit al ruterului
  // prin ROUTE_CHANGE_EVENT; Back/Forward emit `popstate`.
  const [urlLang, setUrlLang] = useState<string | null>(readUrlLang)
  // Copia pe cont se citește la randare; o limbă tocmai ALEASĂ (salvarea din
  // `useSetUiLanguage`) cere o randare nouă și când profilul nu e în memorie,
  // altfel ecranul ar rămâne pe copia veche (recenzia CodeRabbit pe #388).
  const [, setAccountLangTick] = useState(0)
  useEffect(() => {
    const sync = () => setUrlLang(readUrlLang())
    const onAccountLang = () => setAccountLangTick((n) => n + 1)
    window.addEventListener('popstate', sync)
    window.addEventListener(ROUTE_CHANGE_EVENT, sync)
    window.addEventListener(ACCOUNT_LANG_EVENT, onAccountLang)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener(ROUTE_CHANGE_EVENT, sync)
      window.removeEventListener(ACCOUNT_LANG_EVENT, onAccountLang)
    }
  }, [])
  // Copia pe cont se actualizează la fiecare profil încărcat cu limbă — aceeași
  // derivare ca rezolvarea, deci și 'ro'-ul unei baze fără mig 323: altfel, pe
  // producția la 291, copia nu se scria niciodată și fiecare deschidere a
  // panoului arăta limba dispozitivului/site-ului până sosea profilul (sau
  // toată sesiunea, dacă încărcarea pica). Copia o citește doar panoul.
  const loadedLang = profile != null ? profileLang : null
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
        navigatorLangs: pendingAccount ? [] : readNavigatorLangs(),
        siteLang: defaultUiLang(browserSite()),
        enabled,
      })
    return { lang, enabled }
  }, [forced, urlLang, profileLang, pendingAccount, enabled])
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
 * comun (din activarea limbilor: oricare dintre cele patru; pe română, ca
 * `index.html`). NU se montează deasupra paginilor oaspetelui
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

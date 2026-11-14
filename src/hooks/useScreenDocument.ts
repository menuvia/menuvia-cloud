// src/hooks/useScreenDocument.ts — `<html lang>` și titlul tab-ului pentru
// rutele PERSONALULUI și ale FUNNEL-ului (lotul L4d, Partea II).
//
// Cromul comun (ConfirmDialog fără etichete explicite, PageSpinner, fallback-ul
// `<Suspense>`, QueryError, ErrorBoundary, CookieBanner, Toast, cardurile PWA)
// urmează `<html lang>` (lotul L1). Paginile oaspetelui îl setau deja; panoul
// și funnel-ul nu, deci pe un /auth în engleză confirmarea spunea „Anulează”.
//
// Se cheamă O SINGURĂ DATĂ per ecran, la nivelul lui (`StaffDocumentLang`,
// `FunnelDocumentLang` pe rutele funnel-ului și `FunnelLangProvider` doar fără
// rută deasupra, în UiLangContext.tsx), NICIODATĂ deasupra paginilor
// oaspetelui: efectele copiilor rulează ÎNAINTEA celor ale părintelui, deci un
// strămoș ar suprascrie limba setată de meniul QR. Din același motiv, o pagină
// copil care își pune propriul titlu ar fi suprascrisă de cel de aici — azi
// niciuna dintre paginile acoperite (panou, ospătar, bucătărie, autentificare,
// onboarding, parola nouă, invitația) nu-și pune titlul.
//
// Titlul în română e EXACT `<title>`-ul din index.html (testul îl compară), deci
// nimic nu se schimbă cât timp ecranul e în română. La demontare ambele se
// refac (navigarea spre o pagină de oaspete sau de marketing pornește curat).
// `null`/gol = nu atinge nimic.
import { useEffect } from 'react'
import { chromeLangOf, chromeT } from '../i18n/chrome'
import { useDocumentLang } from './useDocumentLang'

export function useScreenDocument(lang: string | null | undefined): void {
  useDocumentLang(lang)
  useEffect(() => {
    if (typeof document === 'undefined' || !lang) return
    const prev = document.title
    document.title = chromeT(chromeLangOf(lang), 'app_doc_title')
    return () => {
      document.title = prev
    }
  }, [lang])
}

export default useScreenDocument

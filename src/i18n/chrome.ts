// src/i18n/chrome.ts — textele „cromului” comun din bundle-ul de INTRARE
// (lotul L1, Partea II): bannerul de cookies, încărcarea, ecranul de eroare,
// 404, butoanele implicite din Confirm și eticheta de închidere a notificării.
// Toate sunt montate global (App.tsx), deci le vede și oaspetele străin care
// scanează un QR. Până la L1 erau doar în română.
//
// De ce un micro-tabel aici și nu un namespace din `src/i18n/ns/`: dicționarele
// personalului NU au voie în graful static al intrării (SK4 — meniul QR rămâne
// mic), iar `guestStrings` (7 limbi, ~95 KB) nici atât. Tabelul are patru limbi
// (ale personalului); orice altă limbă a paginii (it/hu/es, oricare) cade pe
// engleză, nu pe română.
//
// Limba e cea a PAGINII: `<html lang>`. Paginile oaspetelui o setează după
// limba afișată (`useDocumentLang`), panoul rămâne pe `lang="ro"` din
// index.html cât timp româna e singura limbă activă a personalului — un ecran
// amestecat (panou în română, „Confirm” în engleză) ar fi mai rău decât unul
// întreg. Când L3 activează alte limbi pentru personal, UiLangProvider va
// seta tot `<html lang>`, iar cromul îl urmează fără altă schimbare.
//
// Fără importuri: modulul intră în intrare și trebuie să rămână mic.

export type ChromeLang = 'ro' | 'en' | 'fr' | 'de'

const RO = {
  loading: 'Se încarcă…',
  retry: 'Reîncearcă',
  err_title: 'Ceva nu a mers bine',
  err_generic: 'A apărut o eroare neașteptată. Reîncarcă pagina; dacă se repetă, scrie-ne.',
  err_network: 'Fără conexiune. Verifică internetul și reîncearcă.',
  err_reload: 'Reîncarcă pagina',
  nf_doc_title: 'Pagina nu a fost găsită — Menuvia',
  nf_heading: 'Pagina nu a fost găsită.',
  nf_home: 'Acasă',
  toast_close: 'Închide notificarea',
  toast_region: 'Notificări',
  confirm_ok: 'Confirmă',
  confirm_cancel: 'Anulează',
  cookie_title: 'Cookies',
  cookie_body:
    'Folosim cookies strict necesare pentru funcționare. Cu acordul tău, folosim și cookies de performanță (Sentry + analytics) și funcționale (notificări).',
  cookie_details: 'Detalii',
  cookie_necessary: 'Strict necesare',
  cookie_necessary_desc: 'Autentificare, sesiune. Nu pot fi dezactivate.',
  cookie_perf: 'Performanță',
  cookie_perf_desc: 'Sentry (monitorizare erori) + PostHog (analytics anonim).',
  cookie_func: 'Funcționale',
  cookie_func_desc: 'Push notifications, temă, preferințe avansate.',
  cookie_accept: 'Acceptă toate',
  cookie_reject: 'Doar necesare',
  cookie_custom: 'Personalizează',
  cookie_save: 'Salvează preferințele',
} as const

export type ChromeKey = keyof typeof RO
type ChromeTable = Readonly<Record<ChromeKey, string>>

// Pagina /cookies e doar în română (documentele legale cer avocat, nu
// traducător), deci linkul spune asta în celelalte limbi.
export const CHROME_STRINGS: Readonly<Record<ChromeLang, ChromeTable>> = {
  ro: RO,
  en: {
    loading: 'Loading…',
    retry: 'Try again',
    err_title: 'Something went wrong',
    err_generic: 'An unexpected error occurred. Reload the page; if it happens again, contact us.',
    err_network: 'No connection. Check your internet and try again.',
    err_reload: 'Reload the page',
    nf_doc_title: 'Page not found — Menuvia',
    nf_heading: 'Page not found.',
    nf_home: 'Home',
    toast_close: 'Close notification',
    toast_region: 'Notifications',
    confirm_ok: 'Confirm',
    confirm_cancel: 'Cancel',
    cookie_title: 'Cookies',
    cookie_body:
      'We use strictly necessary cookies to make the site work. With your consent, we also use performance cookies (Sentry + analytics) and functional cookies (notifications).',
    cookie_details: 'Details (in Romanian)',
    cookie_necessary: 'Strictly necessary',
    cookie_necessary_desc: 'Sign-in and session. They cannot be turned off.',
    cookie_perf: 'Performance',
    cookie_perf_desc: 'Sentry (error monitoring) + PostHog (anonymous analytics).',
    cookie_func: 'Functional',
    cookie_func_desc: 'Push notifications, theme, advanced preferences.',
    cookie_accept: 'Accept all',
    cookie_reject: 'Necessary only',
    cookie_custom: 'Customize',
    cookie_save: 'Save preferences',
  },
  fr: {
    loading: 'Chargement…',
    retry: 'Réessayer',
    err_title: 'Un problème est survenu',
    err_generic: 'Une erreur inattendue s’est produite. Rechargez la page ; si cela se reproduit, contactez-nous.',
    err_network: 'Pas de connexion. Vérifiez votre connexion internet et réessayez.',
    err_reload: 'Recharger la page',
    nf_doc_title: 'Page introuvable — Menuvia',
    nf_heading: 'Page introuvable.',
    nf_home: 'Accueil',
    toast_close: 'Fermer la notification',
    toast_region: 'Notifications',
    confirm_ok: 'Confirmer',
    confirm_cancel: 'Annuler',
    cookie_title: 'Cookies',
    cookie_body:
      'Nous utilisons des cookies strictement nécessaires au fonctionnement. Avec votre accord, nous utilisons aussi des cookies de performance (Sentry + statistiques) et fonctionnels (notifications).',
    cookie_details: 'Détails (en roumain)',
    cookie_necessary: 'Strictement nécessaires',
    cookie_necessary_desc: 'Connexion et session. Ils ne peuvent pas être désactivés.',
    cookie_perf: 'Performance',
    cookie_perf_desc: 'Sentry (suivi des erreurs) + PostHog (statistiques anonymes).',
    cookie_func: 'Fonctionnels',
    cookie_func_desc: 'Notifications push, thème, préférences avancées.',
    cookie_accept: 'Tout accepter',
    cookie_reject: 'Nécessaires uniquement',
    cookie_custom: 'Personnaliser',
    cookie_save: 'Enregistrer les préférences',
  },
  de: {
    loading: 'Wird geladen…',
    retry: 'Erneut versuchen',
    err_title: 'Etwas ist schiefgelaufen',
    err_generic:
      'Ein unerwarteter Fehler ist aufgetreten. Laden Sie die Seite neu; wenn es erneut passiert, schreiben Sie uns.',
    err_network: 'Keine Verbindung. Prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.',
    err_reload: 'Seite neu laden',
    nf_doc_title: 'Seite nicht gefunden — Menuvia',
    nf_heading: 'Seite nicht gefunden.',
    nf_home: 'Startseite',
    toast_close: 'Benachrichtigung schließen',
    toast_region: 'Benachrichtigungen',
    confirm_ok: 'Bestätigen',
    confirm_cancel: 'Abbrechen',
    cookie_title: 'Cookies',
    cookie_body:
      'Wir verwenden unbedingt erforderliche Cookies für den Betrieb. Mit Ihrer Zustimmung verwenden wir außerdem Leistungs-Cookies (Sentry + Analyse) und funktionale Cookies (Benachrichtigungen).',
    cookie_details: 'Details (auf Rumänisch)',
    cookie_necessary: 'Unbedingt erforderlich',
    cookie_necessary_desc: 'Anmeldung und Sitzung. Sie können nicht deaktiviert werden.',
    cookie_perf: 'Leistung',
    cookie_perf_desc: 'Sentry (Fehlerüberwachung) + PostHog (anonyme Analyse).',
    cookie_func: 'Funktional',
    cookie_func_desc: 'Push-Benachrichtigungen, Design, erweiterte Einstellungen.',
    cookie_accept: 'Alle akzeptieren',
    cookie_reject: 'Nur notwendige',
    cookie_custom: 'Anpassen',
    cookie_save: 'Einstellungen speichern',
  },
}

const CHROME_LANGS: readonly ChromeLang[] = ['ro', 'en', 'fr', 'de']

function primaryTag(code: string | null | undefined): string {
  return (typeof code === 'string' ? code : '').trim().toLowerCase().split(/[-_]/)[0] ?? ''
}

/** Limba cromului pentru limba unei pagini: ro/fr/de/en rămân, orice altă
 *  limbă declarată (it, hu, es, …) cade pe engleză; nimic declarat = română
 *  (`index.html` pornește cu `lang="ro"`). */
export function chromeLangOf(code: string | null | undefined): ChromeLang {
  const tag = primaryTag(code)
  if (!tag) return 'ro'
  return (CHROME_LANGS as readonly string[]).includes(tag) ? (tag as ChromeLang) : 'en'
}

/** Limba cromului după `<html lang>` (citită acum). */
export function documentChromeLang(): ChromeLang {
  if (typeof document === 'undefined') return 'ro'
  return chromeLangOf(document.documentElement.getAttribute('lang'))
}

/** Prima limbă a browserului dintre cele patru; niciuna → engleză. Pentru
 *  paginile fără o limbă proprie (404). */
export function browserChromeLang(): ChromeLang {
  if (typeof navigator === 'undefined') return 'ro'
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const p of prefs) {
    const tag = primaryTag(p)
    if ((CHROME_LANGS as readonly string[]).includes(tag)) return tag as ChromeLang
  }
  return 'en'
}

/**
 * Limba de DECLARAT pe o etichetă a cromului când tabelul a căzut pe altă
 * limbă decât a paginii: pe o pagină `lang="it"`, „Cancel” e în engleză, iar
 * moștenit ar fi citit de cititorul de ecran cu pronunția italiană (recenzia
 * CodeRabbit pe #357). `undefined` = aceeași limbă, eticheta moștenește.
 */
export function chromeFallbackLang(pageLang: string | null | undefined, chrome: ChromeLang): ChromeLang | undefined {
  const tag = primaryTag(pageLang)
  return tag !== '' && tag !== chrome ? chrome : undefined
}

export function chromeT(lang: ChromeLang, key: ChromeKey): string {
  return CHROME_STRINGS[lang][key]
}

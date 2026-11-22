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
// limba afișată (`useDocumentLang`); din lotul L4d o setează și rutele
// personalului (`StaffDocumentLang`: panoul, ospătarul, bucătăria — limba
// personalului, azi mereu „ro”, fiindcă `ENABLED_STAFF_LANGS = ['ro']`) și ale
// funnel-ului (`FunnelLangProvider`: autentificarea, onboarding-ul, parola
// nouă, invitația — limba funnel-ului, care poate fi deja engleza). Cromul îl
// urmează fără altă schimbare.
//
// Tot din L4d stau aici și textele de crom scrise înainte direct în
// componente din graful intrării: cardurile PWA, numele accesibil implicit al
// `Spinner`, ecranul de eroare la pornire (main.tsx), poarta de rol din
// App.tsx și titlul tab-ului pe rutele personalului și ale funnel-ului
// (`app_doc_title` — în română EXACT `<title>`-ul din index.html).
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
  // Bannerul apare și pe paginile oaspeților (meniul QR, /m/, rezervarea), unde
  // PostHog nu pornește niciodată (lib/analytics.ts). Acordul e însă per
  // browser și se aplică apoi și pe site-ul Menuvia, deci textul spune UNDE
  // rulează statisticile, nu doar ce se întâmplă pe pagina curentă.
  cookie_body:
    'Folosim cookies strict necesare pentru funcționare. Cu acordul tău, folosim și cookies de performanță (Sentry; analytics doar pe site-ul și în panoul Menuvia) și funcționale (notificări).',
  cookie_details: 'Detalii',
  cookie_necessary: 'Strict necesare',
  cookie_necessary_desc: 'Autentificare, sesiune. Nu pot fi dezactivate.',
  cookie_perf: 'Performanță',
  cookie_perf_desc:
    'Sentry (monitorizare erori) + PostHog (statistici de utilizare, doar pe site-ul și în panoul Menuvia, nu pe meniul sau rezervarea unui restaurant).',
  cookie_func: 'Funcționale',
  cookie_func_desc: 'Push notifications, temă, preferințe avansate.',
  cookie_accept: 'Acceptă toate',
  cookie_reject: 'Doar necesare',
  cookie_custom: 'Personalizează',
  cookie_save: 'Salvează preferințele',
  spinner_label: 'Se încarcă',
  boot_error: 'A apărut o eroare. Reîncarcă pagina.',
  app_doc_title: 'Menuvia — Meniu digital și comenzi QR pentru restaurante',
  gate_perms_error: 'Nu am putut încărca permisiunile. Verifică conexiunea și reîncearcă.',
  gate_no_access: 'Nu ai acces la această pagină. Contactează managerul restaurantului.',
  gate_go_home: 'Mergi la ecranul tău',
  pwa_update_title: 'Actualizare disponibilă',
  pwa_update_body: 'O versiune nouă a aplicației e gata. Poți actualiza acum sau la următoarea deschidere.',
  pwa_update_action: 'Actualizează',
  pwa_update_later: 'Mai târziu',
  pwa_install_title: 'Instalează Menuvia',
  pwa_install_body: 'Folosește aplicația direct de pe ecranul principal.',
  pwa_install_action: 'Instalează',
  pwa_close: 'Închide',
  // Bannerul de întoarcere din Stripe (CheckoutReturnBanner, montat global).
  // Copy NEUTRU pe bani: pe planurile cu trial nu s-a încasat nimic la
  // întoarcere — CB1 păzește orice formulare care pretinde o încasare.
  checkout_activating_title: 'Activăm planul…',
  checkout_activating_body: 'Abonamentul a fost înregistrat — activăm planul în contul tău, durează câteva secunde.',
  checkout_active_title: 'Planul tău e activ',
  checkout_active_body: 'Mulțumim! Funcțiile noului plan sunt disponibile de acum.',
  checkout_slow_title: 'Activarea durează mai mult decât de obicei',
  checkout_slow_body:
    'Abonamentul a fost înregistrat, dar planul nu apare încă în cont. Reîncarcă pagina peste un minut; dacă nu se schimbă, scrie-ne.',
  checkout_cancelled_title: 'Plata a fost anulată',
  checkout_cancelled_body: 'Nu s-a încasat nimic. Poți alege un plan oricând de pe această pagină.',
  checkout_close: 'Închide mesajul',
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
      'We use strictly necessary cookies to make the site work. With your consent, we also use performance cookies (Sentry; analytics only on the Menuvia website and dashboard) and functional cookies (notifications).',
    cookie_details: 'Details (in Romanian)',
    cookie_necessary: 'Strictly necessary',
    cookie_necessary_desc: 'Sign-in and session. They cannot be turned off.',
    cookie_perf: 'Performance',
    cookie_perf_desc:
      'Sentry (error monitoring) + PostHog (usage analytics, only on the Menuvia website and dashboard, not on a restaurant’s menu or booking page).',
    cookie_func: 'Functional',
    cookie_func_desc: 'Push notifications, theme, advanced preferences.',
    cookie_accept: 'Accept all',
    cookie_reject: 'Necessary only',
    cookie_custom: 'Customize',
    cookie_save: 'Save preferences',
    spinner_label: 'Loading',
    boot_error: 'Something went wrong. Reload the page.',
    app_doc_title: 'Menuvia — Digital menu and QR ordering for restaurants',
    gate_perms_error: 'We couldn’t load your permissions. Check your connection and try again.',
    gate_no_access: 'You don’t have access to this page. Contact the restaurant manager.',
    gate_go_home: 'Go to your screen',
    pwa_update_title: 'Update available',
    pwa_update_body: 'A new version of the app is ready. You can update now or the next time you open it.',
    pwa_update_action: 'Update',
    pwa_update_later: 'Later',
    pwa_install_title: 'Install Menuvia',
    pwa_install_body: 'Use the app straight from your home screen.',
    pwa_install_action: 'Install',
    pwa_close: 'Close',
    checkout_activating_title: 'Activating your plan…',
    checkout_activating_body:
      'Your subscription has been recorded — we’re activating the plan on your account, it takes a few seconds.',
    checkout_active_title: 'Your plan is active',
    checkout_active_body: 'Thank you! The new plan’s features are available now.',
    checkout_slow_title: 'Activation is taking longer than usual',
    checkout_slow_body:
      'Your subscription has been recorded, but the plan doesn’t show on your account yet. Reload the page in a minute; if nothing changes, contact us.',
    checkout_cancelled_title: 'The payment was cancelled',
    checkout_cancelled_body: 'Nothing was charged. You can choose a plan any time from this page.',
    checkout_close: 'Close message',
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
      'Nous utilisons des cookies strictement nécessaires au fonctionnement. Avec votre accord, nous utilisons aussi des cookies de performance (Sentry ; statistiques uniquement sur le site et l’espace Menuvia) et fonctionnels (notifications).',
    cookie_details: 'Détails (en roumain)',
    cookie_necessary: 'Strictement nécessaires',
    cookie_necessary_desc: 'Connexion et session. Ils ne peuvent pas être désactivés.',
    cookie_perf: 'Performance',
    cookie_perf_desc:
      'Sentry (suivi des erreurs) + PostHog (statistiques d’utilisation, uniquement sur le site et l’espace Menuvia, pas sur le menu ni la page de réservation d’un restaurant).',
    cookie_func: 'Fonctionnels',
    cookie_func_desc: 'Notifications push, thème, préférences avancées.',
    cookie_accept: 'Tout accepter',
    cookie_reject: 'Nécessaires uniquement',
    cookie_custom: 'Personnaliser',
    cookie_save: 'Enregistrer les préférences',
    spinner_label: 'Chargement',
    boot_error: 'Une erreur est survenue. Rechargez la page.',
    app_doc_title: 'Menuvia — Menu numérique et commandes QR pour restaurants',
    gate_perms_error: 'Impossible de charger vos autorisations. Vérifiez votre connexion et réessayez.',
    gate_no_access: 'Vous n’avez pas accès à cette page. Contactez le responsable du restaurant.',
    gate_go_home: 'Aller à votre écran',
    pwa_update_title: 'Mise à jour disponible',
    pwa_update_body:
      'Une nouvelle version de l’application est prête. Vous pouvez la mettre à jour maintenant ou à la prochaine ouverture.',
    pwa_update_action: 'Mettre à jour',
    pwa_update_later: 'Plus tard',
    pwa_install_title: 'Installer Menuvia',
    pwa_install_body: 'Utilisez l’application directement depuis l’écran d’accueil.',
    pwa_install_action: 'Installer',
    pwa_close: 'Fermer',
    checkout_activating_title: 'Activation de votre formule…',
    checkout_activating_body:
      'Votre abonnement a été enregistré — nous activons la formule sur votre compte, cela prend quelques secondes.',
    checkout_active_title: 'Votre formule est active',
    checkout_active_body: 'Merci ! Les fonctionnalités de la nouvelle formule sont disponibles dès maintenant.',
    checkout_slow_title: 'L’activation prend plus de temps que d’habitude',
    checkout_slow_body:
      'Votre abonnement a été enregistré, mais la formule n’apparaît pas encore sur votre compte. Rechargez la page dans une minute ; si rien ne change, contactez-nous.',
    checkout_cancelled_title: 'Le paiement a été annulé',
    checkout_cancelled_body: 'Rien n’a été prélevé. Vous pouvez choisir une formule à tout moment depuis cette page.',
    checkout_close: 'Fermer le message',
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
      'Wir verwenden unbedingt erforderliche Cookies für den Betrieb. Mit Ihrer Zustimmung verwenden wir außerdem Leistungs-Cookies (Sentry; Analyse nur auf der Menuvia-Website und im Verwaltungsbereich) und funktionale Cookies (Benachrichtigungen).',
    cookie_details: 'Details (auf Rumänisch)',
    cookie_necessary: 'Unbedingt erforderlich',
    cookie_necessary_desc: 'Anmeldung und Sitzung. Sie können nicht deaktiviert werden.',
    cookie_perf: 'Leistung',
    cookie_perf_desc:
      'Sentry (Fehlerüberwachung) + PostHog (Nutzungsstatistik, nur auf der Menuvia-Website und im Verwaltungsbereich, nicht auf der Speisekarte oder Reservierungsseite eines Restaurants).',
    cookie_func: 'Funktional',
    cookie_func_desc: 'Push-Benachrichtigungen, Design, erweiterte Einstellungen.',
    cookie_accept: 'Alle akzeptieren',
    cookie_reject: 'Nur notwendige',
    cookie_custom: 'Anpassen',
    cookie_save: 'Einstellungen speichern',
    spinner_label: 'Wird geladen',
    boot_error: 'Ein Fehler ist aufgetreten. Laden Sie die Seite neu.',
    app_doc_title: 'Menuvia — Digitale Speisekarte und QR-Bestellungen für Restaurants',
    gate_perms_error:
      'Ihre Berechtigungen konnten nicht geladen werden. Prüfen Sie die Verbindung und versuchen Sie es erneut.',
    gate_no_access: 'Sie haben keinen Zugriff auf diese Seite. Wenden Sie sich an die Restaurantleitung.',
    gate_go_home: 'Zu Ihrer Ansicht wechseln',
    pwa_update_title: 'Update verfügbar',
    pwa_update_body: 'Eine neue Version der App ist bereit. Sie können jetzt oder beim nächsten Öffnen aktualisieren.',
    pwa_update_action: 'Aktualisieren',
    pwa_update_later: 'Später',
    pwa_install_title: 'Menuvia installieren',
    pwa_install_body: 'Nutzen Sie die App direkt vom Startbildschirm aus.',
    pwa_install_action: 'Installieren',
    pwa_close: 'Schließen',
    checkout_activating_title: 'Ihr Tarif wird aktiviert…',
    checkout_activating_body:
      'Ihr Abonnement wurde erfasst — wir aktivieren den Tarif in Ihrem Konto, das dauert einige Sekunden.',
    checkout_active_title: 'Ihr Tarif ist aktiv',
    checkout_active_body: 'Vielen Dank! Die Funktionen des neuen Tarifs stehen ab sofort zur Verfügung.',
    checkout_slow_title: 'Die Aktivierung dauert länger als üblich',
    checkout_slow_body:
      'Ihr Abonnement wurde erfasst, aber der Tarif erscheint noch nicht in Ihrem Konto. Laden Sie die Seite in einer Minute neu; wenn sich nichts ändert, schreiben Sie uns.',
    checkout_cancelled_title: 'Die Zahlung wurde abgebrochen',
    checkout_cancelled_body: 'Es wurde nichts abgebucht. Sie können jederzeit auf dieser Seite einen Tarif wählen.',
    checkout_close: 'Meldung schließen',
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

// Namespace `settingsCards` — cardurile montate STATIC de fila Setări (lotul
// L6b): LoyaltySettingsCard (fidelizarea), MfaCard (autentificarea în doi
// pași), GdprCard (exportul și ștergerea contului), AddLocationCard (locația
// nouă) și SmsNotificationsCard (SMS-urile către clienți). Sunt în ACELAȘI
// chunk leneș cu SettingsTab, deci SettingsTab cere namespace-ul SUS, împreună
// cu `settings` (o singură suspendare la prima randare într-o limbă nouă).
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — „…” (nu „...”) pe toate stările în
// curs ale acestor carduri, ghilimeaua DREAPTĂ de închidere din „„comanda e
// gata"”, emoji-urile și săgețile de pe butoanele GDPR („⬇”, „↩”, „⚠️”),
// mesajele de eroare ale serverului afișate ca atare în română (prin
// `describeStaffError` = `toUserMessage`). Textele locației noi sunt și ale lui
// `describeCreateLocationErrorT` (lib/locations.ts; `MSG_LOCATION_LIMIT` /
// `MSG_CREATE_UNCERTAIN` de acolo rămân oracolul românesc).
// NU sunt aici (din `common`): „Anulează”, „Închide”, „Reîncearcă”,
// „Se încarcă…”.
// NU se traduc (date): numele COMERCIAL al planului (`PLAN_LABELS`, nume
// propriu), numele restaurantului și al locației, cheia TOTP, numele
// fișierului de export, recompensa SALVATĂ și valoarea ei implicită („Un
// desert din partea casei” — o vede OASPETELE în meniu, deci e dată a
// meniului, nu text al personalului; rămâne în LoyaltySettingsCard.tsx),
// linkul spre Politica de confidențialitate (documentul legal rămâne în
// română; se traduce doar textul linkului).
// Mesajele serverului FĂRĂ hint (mig 042: „Aveți un abonament activ…”, mig
// 235: „Dezactivarea MFA cere o sesiune verificată…”) se recunosc după
// începutul textului (lib/accountRefusals.ts) DOAR în celelalte limbi (în
// română rămân afișate ca atare) — `gdpr_err_activeSub` / `mfa_err_aal2`.
const ro = {
  // ── Fidelizare (LoyaltySettingsCard) ──
  loy_title: 'Fidelizare — puncte și recompense',
  loy_desc:
    'Clienții primesc puncte la fiecare comandă din meniul QR și o recompensă când ating pragul. ' +
    'Punctele merg pe un card digital în telefonul clientului — opțional legat de numărul lui de ' +
    'telefon (stocat criptat, ca hash).',
  // `{plan}` = numele comercial (element îngroșat, `PLAN_LABELS.growth`).
  loy_locked: 'Disponibil de la planul {plan} — punctele se acordă pe comenzile din QR.',
  loy_enableTitle: 'Activează fidelizarea în meniul QR',
  loy_enableDesc:
    'Clienții văd cardul de puncte în meniu; ospătarii răscumpără recompensele din pagina lor, ' +
    'pe codul cardului.',
  loy_toggle: 'Fidelizarea în meniul QR',
  loy_enabled: 'Fidelizarea activată',
  loy_disabled: 'Fidelizarea dezactivată',
  loy_loadError:
    'Nu am putut citi programul de fidelizare salvat. Ca să nu-l suprascriem cu valorile ' +
    'implicite, salvarea e blocată până îl citim.',
  loy_ppl: 'Puncte per leu cheltuit',
  loy_threshold: 'Prag pentru recompensă (puncte)',
  loy_reward: 'Recompensa (ce primește clientul la prag)',
  loy_rewardPlaceholder: 'Ex: Un desert din partea casei',
  // Lotul C7c: câmpurile se salvează cu „Salvează” de sus (formularul
  // paginii); cardul nu mai are buton propriu. Nota apare când modulul e
  // pornit, dar programul n-a fost salvat niciodată (fidelizarea cere rândul).
  loy_notSaved: 'Programul nu e salvat încă: apasă „Salvează” ca fidelizarea să pornească în meniu.',
  loy_err_ppl: 'Punctele pe leu trebuie între 0,1 și 100.',
  loy_err_threshold: 'Pragul trebuie între 1 și 100.000 de puncte.',
  loy_err_reward: 'Descrie recompensa (max. 200 de caractere).',
  // Rezerva comutatoarelor (fidelizare + SMS) — `describeStaffError`.
  err_save: 'Eroare la salvare',

  // ── SMS-uri (SmsNotificationsCard) ──
  sms_title: 'Notificări SMS către clienți',
  sms_desc:
    'Clientul primește SMS la confirmarea rezervării și când comanda de ridicare e gata. Doar ' +
    'numere de mobil românești; mesajele sunt strict tranzacționale (fără marketing).',
  sms_locked: 'Disponibil pe planurile plătite — fiecare plan include un număr de SMS-uri pe lună.',
  sms_enableTitle: 'Activează SMS-urile',
  sms_enableDesc:
    'Confirmare rezervare + „comanda e gata" la ridicare. Se opresc automat când atingi plafonul ' +
    'lunar al planului.',
  sms_toggle: 'SMS-uri către clienți',
  sms_enabled: 'SMS-urile au fost activate',
  sms_disabled: 'SMS-urile au fost dezactivate',
  // „Luna aceasta: <strong>3 / 50 SMS</strong>”: `{count}` e elementul.
  sms_usage: 'Luna aceasta: {count}',
  sms_usageCap: '{used} / {cap} SMS',
  sms_usageNoCap: '{used} SMS',
  sms_capReached: '— plafon atins; reia luna viitoare',

  // ── Autentificare în doi pași (MfaCard) ──
  mfa_title: 'Autentificare în doi pași (MFA)',
  mfa_active: 'Activ',
  mfa_inactive: 'Inactiv',
  mfa_desc:
    'Protejează contul cu un cod generat de o aplicație de autentificare (Google Authenticator, ' +
    '1Password, Aegis). Recomandat obligatoriu pentru conturile cu acces de platformă.',
  mfa_qrAlt: 'Cod QR pentru aplicația de autentificare',
  mfa_scan:
    'Scanează codul QR cu aplicația de autentificare, apoi introdu codul de 6 cifre generat.',
  // `{key}` = cheia TOTP (element `<code>`).
  mfa_manual: 'Nu poți scana? Introdu manual cheia: {key}',
  mfa_codeAria: 'Cod de verificare din aplicație',
  mfa_verifying: 'Se verifică…',
  mfa_confirmEnable: 'Confirmă și activează',
  mfa_dismiss: 'Renunță',
  mfa_confirmWithCode: 'Confirmă cu codul din aplicație:',
  mfa_disable: 'Dezactivează MFA',
  mfa_disableStart: 'Dezactivează MFA…',
  mfa_reactivate: 'Reactivează MFA',
  mfa_enable: 'Activează MFA',
  mfa_preparing: 'Se pregătește…',
  mfa_enabledToast: 'MFA activat — contul cere de acum codul din aplicație',
  mfa_disabledToast: 'MFA dezactivat',
  mfa_reactivatedToast: 'MFA reactivat — contul cere de acum codul din aplicație',
  mfa_err_load: 'Nu am putut încărca starea MFA',
  mfa_err_start: 'Nu am putut porni activarea MFA',
  mfa_err_badCode: 'Cod incorect sau expirat. Încearcă din nou cu codul curent din aplicație.',
  mfa_err_verify: 'Verificarea nu a reușit',
  mfa_err_disable: 'Dezactivarea nu a reușit',
  mfa_err_reactivate: 'Reactivarea nu a reușit',
  // Doar în celelalte limbi: refuzul RPC-ului `set_my_mfa_enforced` (mig 235).
  mfa_err_aal2: 'Dezactivarea MFA cere o sesiune verificată cu MFA (aal2)',

  // ── Datele mele (GdprCard) ──
  gdpr_title: 'Datele mele (GDPR)',
  // `{policy}` = linkul spre /confidentialitate (element).
  gdpr_desc:
    'Poți descărca o copie a datelor contului tău sau poți cere ștergerea contului. Detalii în {policy}.',
  gdpr_policy: 'Politica de confidențialitate',
  gdpr_preparing: 'Se pregătește…',
  gdpr_export: '⬇ Exportă datele mele (JSON)',
  gdpr_cancelling: 'Se anulează…',
  gdpr_cancelDeletion: '↩ Anulează ștergerea programată',
  gdpr_sending: 'Se trimite…',
  gdpr_delete: 'Șterge contul',
  gdpr_pendingNote:
    '⚠️ Ștergerea contului e programată (la 30 de zile de la cerere). Până atunci contul ' +
    'funcționează normal și poți anula oricând de aici.',
  gdpr_exported: 'Exportul a fost descărcat.',
  gdpr_err_export: 'Exportul a eșuat. Reîncearcă.',
  gdpr_confirmTitle: 'Ștergi contul?',
  gdpr_confirmDesc:
    'Contul și datele tale (restaurante, meniuri, membri) vor fi șterse definitiv după 30 de zile. ' +
    'În această perioadă te poți răzgândi de aici. Facturile fiscale rămân arhivate conform legii (10 ani).',
  gdpr_confirmOk: 'Programează ștergerea',
  gdpr_scheduledFor: 'Ștergerea e programată pentru {date}.',
  gdpr_scheduled: 'Ștergerea contului a fost programată (30 de zile).',
  gdpr_err_request: 'Cererea de ștergere a eșuat.',
  gdpr_cancelled: 'Cererea de ștergere a fost anulată. Contul rămâne activ.',
  gdpr_err_cancel: 'Anularea a eșuat. Reîncearcă.',
  // Doar în celelalte limbi: refuzul RPC-ului `request_account_deletion` (mig 042).
  gdpr_err_activeSub:
    'Aveți un abonament activ. Anulați-l prin Portal Stripe înainte de a șterge contul.',
  // Bannerul de cookies redeschis din cont (recenzie pe #385, MY-8): până aici
  // „Setări cookies” exista doar în subsolul paginilor legale, deci personalul
  // identificat în statistici n-avea din panou cum să-și retragă acordul.
  gdpr_cookiesDesc:
    'Statisticile de utilizare (PostHog) și raportarea erorilor (Sentry) pornesc doar cu acordul tău din ' +
    'bannerul de cookies, dat în acest browser. Îl poți schimba sau retrage oricând.',
  gdpr_cookies: 'Setări cookies',

  // ── Locația nouă (AddLocationCard + describeCreateLocationErrorT) ──
  loc_title: 'Locații',
  loc_desc:
    'Ai mai multe localuri? Adaugă o locație nouă — pornește goală, cu meniul și mesele ei. Câte ' +
    'locații poți avea depinde de planul contului.',
  loc_add: 'Adaugă o locație',
  loc_dialogDesc:
    'Locația nouă pornește goală: adaugi apoi produsele, mesele și echipa ei. Restaurantul pe care ' +
    'îl administrezi acum rămâne neschimbat.',
  loc_name: 'Numele locației',
  loc_err_nameRequired: 'Scrie numele locației.',
  loc_reload: 'Reîncarcă',
  loc_create: 'Creează locația',
  loc_uncertain: 'Nu știm sigur dacă locația s-a creat — reîncarcă pagina și verifică lista.',
  loc_err_limit:
    'Planul actual nu permite încă o locație. Pentru mai multe locații e nevoie de un plan superior.',
  loc_err_create: 'Locația nu a putut fi creată. Reîncearcă.',
}

export default ro

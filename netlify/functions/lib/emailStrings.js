// netlify/functions/lib/emailStrings.js
// Textele emailurilor Menuvia, pe limbi (lotul L8a).
//
//   EMAIL_STRINGS[kind][lang] — un obiect de chei; `ro` e SURSA și e textul
//   EXACT de dinainte, byte cu byte (oracolul EO1 compară cu worker-ul vechi).
//   Placeholderele sunt `{nume}`; valorile vin DEJA escapate de la apelant (cu
//   același `esc()` ca înainte), iar etichetele HTML din șiruri (`<b>`,
//   `<strong>`) sunt de încredere.
//
// Audiențe (registrul EMAIL_AUDIENCE din process-email-queue.js):
//   • personalul (patron / echipă): ro, en, fr, de — se folosește doar o limbă
//     ACTIVĂ (`ENABLED_STAFF_LANGS`), deci fr/de stau gata, nevăzute;
//   • oaspetele (`reservation_reminder`): cele 7 limbi ale meniului;
//   • `team_invite` (send-invite.js) și `signup_welcome` (welcome-email.js): 4.
//
// O limbă INCOMPLETĂ pentru un kind (o cheie lipsă sau goală) cade ÎNTREG pe
// engleză — niciodată cheie cu cheie, deci niciodată un email amestecat
// (EL9). Testul EL1 cere aceleași chei, aceleași placeholdere și aceleași
// etichete HTML în toate limbile unui kind; EL2 caută resturi românești.
//
// Fără domenii aici (clichetul DR): linkurile le construiește apelantul.
'use strict'

/** Rezervele de nume coapte în SQL (mig 061): nu sunt nume, doar o adresare românească. */
const RO_PLACEHOLDER_NAMES = Object.freeze(['Stimate patron', 'Stimate utilizator'])

const COMMON = {
  ro: {
    relative_today: 'astăzi',
    relative_tomorrow: 'mâine',
    relative_on_date: 'pe {date}',
    greet: 'Bună, {name},',
    greet_anon: 'Bună,',
  },
  en: {
    relative_today: 'today',
    relative_tomorrow: 'tomorrow',
    relative_on_date: 'on {date}',
    greet: 'Hello {name},',
    greet_anon: 'Hello,',
  },
  fr: {
    relative_today: 'aujourd’hui',
    relative_tomorrow: 'demain',
    relative_on_date: 'le {date}',
    greet: 'Bonjour {name},',
    greet_anon: 'Bonjour,',
  },
  de: {
    relative_today: 'heute',
    relative_tomorrow: 'morgen',
    relative_on_date: 'am {date}',
    greet: 'Hallo {name},',
    greet_anon: 'Hallo,',
  },
  it: {
    relative_today: 'oggi',
    relative_tomorrow: 'domani',
    relative_on_date: 'il {date}',
    greet: 'Ciao {name},',
    greet_anon: 'Buongiorno,',
  },
  hu: {
    relative_today: 'ma',
    relative_tomorrow: 'holnap',
    relative_on_date: '{date}',
    greet: 'Kedves {name}!',
    greet_anon: 'Üdvözöljük!',
  },
  es: {
    relative_today: 'hoy',
    relative_tomorrow: 'mañana',
    relative_on_date: 'el {date}',
    greet: 'Hola, {name}:',
    greet_anon: 'Hola:',
  },
}

const EMAIL_STRINGS = {
  // ── Facturarea abonamentului (owner) ─────────────────────────────────────
  payment_failed: {
    ro: {
      subject: '⚠️ Plata nu s-a putut procesa (încercarea {attempt})',
      title: 'Plata nu s-a putut procesa',
      greet: 'Bună {name},',
      greet_anon: 'Bună patron,',
      intro: 'Am încercat să procesăm plata abonamentului dar n-a reușit. Cele mai comune cauze:',
      cause_card: 'Card expirat sau date schimbate',
      cause_funds: 'Sold insuficient',
      cause_blocked: 'Card blocat de bancă pentru tranzacții online',
      retry: 'Vom reîncerca automat în 3 zile. Până atunci, contul rămâne activ.',
      cta: 'Actualizează metoda de plată →',
    },
    en: {
      subject: '⚠️ Your payment could not be processed (attempt {attempt})',
      title: 'Your payment could not be processed',
      greet: 'Hello {name},',
      greet_anon: 'Hello,',
      intro: 'We tried to process your subscription payment, but it did not go through. The most common causes:',
      cause_card: 'Expired card or changed card details',
      cause_funds: 'Insufficient funds',
      cause_blocked: 'Card blocked by the bank for online transactions',
      retry: 'We will retry automatically in 3 days. Until then, your account stays active.',
      cta: 'Update payment method →',
    },
    fr: {
      subject: '⚠️ Le paiement n’a pas pu être traité (tentative {attempt})',
      title: 'Le paiement n’a pas pu être traité',
      greet: 'Bonjour {name},',
      greet_anon: 'Bonjour,',
      intro: 'Nous avons essayé de traiter le paiement de votre abonnement, sans succès. Les causes les plus fréquentes :',
      cause_card: 'Carte expirée ou coordonnées modifiées',
      cause_funds: 'Solde insuffisant',
      cause_blocked: 'Carte bloquée par la banque pour les paiements en ligne',
      retry: 'Nous réessaierons automatiquement dans 3 jours. D’ici là, votre compte reste actif.',
      cta: 'Mettre à jour le moyen de paiement →',
    },
    de: {
      subject: '⚠️ Die Zahlung konnte nicht verarbeitet werden (Versuch {attempt})',
      title: 'Die Zahlung konnte nicht verarbeitet werden',
      greet: 'Hallo {name},',
      greet_anon: 'Hallo,',
      intro: 'Wir haben versucht, die Zahlung für Ihr Abonnement durchzuführen, leider ohne Erfolg. Die häufigsten Ursachen:',
      cause_card: 'Abgelaufene Karte oder geänderte Kartendaten',
      cause_funds: 'Unzureichende Deckung',
      cause_blocked: 'Karte von der Bank für Online-Zahlungen gesperrt',
      retry: 'Wir versuchen es in 3 Tagen automatisch erneut. Bis dahin bleibt Ihr Konto aktiv.',
      cta: 'Zahlungsmethode aktualisieren →',
    },
  },

  payment_recovered: {
    ro: {
      subject: '✅ Plata s-a procesat cu succes',
      title: 'Plata s-a procesat cu succes',
      greet: 'Bună {name},',
      greet_anon: 'Bună patron,',
      body: 'Vestea bună: plata abonamentului a reușit, iar contul rămâne activ fără întreruperi. Mulțumesc pentru încredere.',
      cta: 'Vezi detalii facturare →',
    },
    en: {
      subject: '✅ Your payment went through',
      title: 'Your payment went through',
      greet: 'Hello {name},',
      greet_anon: 'Hello,',
      body: 'Good news: your subscription payment succeeded and your account stays active without interruption. Thank you for your trust.',
      cta: 'View billing details →',
    },
    fr: {
      subject: '✅ Le paiement a bien été traité',
      title: 'Le paiement a bien été traité',
      greet: 'Bonjour {name},',
      greet_anon: 'Bonjour,',
      body: 'Bonne nouvelle : le paiement de votre abonnement a réussi et votre compte reste actif sans interruption. Merci de votre confiance.',
      cta: 'Voir les détails de facturation →',
    },
    de: {
      subject: '✅ Die Zahlung war erfolgreich',
      title: 'Die Zahlung war erfolgreich',
      greet: 'Hallo {name},',
      greet_anon: 'Hallo,',
      body: 'Gute Nachricht: Die Zahlung für Ihr Abonnement war erfolgreich, Ihr Konto bleibt ohne Unterbrechung aktiv. Danke für Ihr Vertrauen.',
      cta: 'Abrechnungsdetails ansehen →',
    },
  },

  // ── Praguri (owner) ──────────────────────────────────────────────────────
  milestone_first_month: {
    ro: {
      subject: '☕ Prima comandă! Felicitări',
      title: 'Prima comandă! 🎊',
      intro: '{name}, tocmai s-a procesat prima comandă plătită prin Menuvia ({total}). E doar începutul!',
      intro_anon: 'Patron, tocmai s-a procesat prima comandă plătită prin Menuvia ({total}). E doar începutul!',
      help: 'Dacă ceva nu merge cum ar trebui, scrie-mi imediat.',
    },
    en: {
      subject: '☕ Your first order! Congratulations',
      title: 'Your first order! 🎊',
      intro: '{name}, the first paid order has just gone through Menuvia ({total}). This is only the beginning!',
      intro_anon: 'The first paid order has just gone through Menuvia ({total}). This is only the beginning!',
      help: 'If anything does not work the way it should, write to me right away.',
    },
    fr: {
      subject: '☕ Première commande ! Félicitations',
      title: 'Première commande ! 🎊',
      intro: '{name}, la première commande payée vient de passer par Menuvia ({total}). Ce n’est que le début !',
      intro_anon: 'La première commande payée vient de passer par Menuvia ({total}). Ce n’est que le début !',
      help: 'Si quelque chose ne fonctionne pas comme prévu, écrivez-moi tout de suite.',
    },
    de: {
      subject: '☕ Die erste Bestellung! Herzlichen Glückwunsch',
      title: 'Die erste Bestellung! 🎊',
      intro: '{name}, soeben wurde die erste bezahlte Bestellung über Menuvia abgewickelt ({total}). Das ist erst der Anfang!',
      intro_anon: 'Soeben wurde die erste bezahlte Bestellung über Menuvia abgewickelt ({total}). Das ist erst der Anfang!',
      help: 'Wenn etwas nicht so funktioniert, wie es sollte, schreiben Sie mir sofort.',
    },
  },

  milestone_100_orders: {
    ro: {
      subject: '🎉 100 comenzi prin Menuvia!',
      title: '100 comenzi! 🎉',
      intro: 'Felicitări {name}! Tocmai ai depășit pragul de <b>100 comenzi procesate prin Menuvia</b>.',
      intro_anon: 'Felicitări ! Tocmai ai depășit pragul de <b>100 comenzi procesate prin Menuvia</b>.',
      thanks: 'Mulțumesc că ai încredere în noi. Continuă tot așa!',
    },
    en: {
      subject: '🎉 100 orders through Menuvia!',
      title: '100 orders! 🎉',
      intro: 'Congratulations, {name}! You have just passed <b>100 orders processed through Menuvia</b>.',
      intro_anon: 'Congratulations! You have just passed <b>100 orders processed through Menuvia</b>.',
      thanks: 'Thank you for trusting us. Keep it up!',
    },
    fr: {
      subject: '🎉 100 commandes avec Menuvia !',
      title: '100 commandes ! 🎉',
      intro: 'Félicitations, {name} ! Vous venez de dépasser <b>100 commandes traitées avec Menuvia</b>.',
      intro_anon: 'Félicitations ! Vous venez de dépasser <b>100 commandes traitées avec Menuvia</b>.',
      thanks: 'Merci de votre confiance. Continuez ainsi !',
    },
    de: {
      subject: '🎉 100 Bestellungen über Menuvia!',
      title: '100 Bestellungen! 🎉',
      intro: 'Herzlichen Glückwunsch, {name}! Sie haben soeben die Marke von <b>100 über Menuvia abgewickelten Bestellungen</b> überschritten.',
      intro_anon: 'Herzlichen Glückwunsch! Sie haben soeben die Marke von <b>100 über Menuvia abgewickelten Bestellungen</b> überschritten.',
      thanks: 'Danke für Ihr Vertrauen. Weiter so!',
    },
  },

  milestone_1000_orders: {
    ro: {
      subject: '🏆 1.000 comenzi! Diploma vine prin poștă!',
      title: '1.000 comenzi!',
      intro: '{name}, ai atins un milestone important. <b>1.000 de comenzi</b> procesate prin Menuvia.',
      intro_anon: ', ai atins un milestone important. <b>1.000 de comenzi</b> procesate prin Menuvia.',
      gift: 'Ca recunoștință, îți trimit prin poștă o diplomă personalizată. Dă-mi adresa pe WhatsApp.',
    },
    en: {
      subject: '🏆 1,000 orders! Your certificate is on its way!',
      title: '1,000 orders!',
      intro: '{name}, you have reached a major landmark: <b>1,000 orders</b> processed through Menuvia.',
      intro_anon: 'You have reached a major landmark: <b>1,000 orders</b> processed through Menuvia.',
      gift: 'As a thank-you, I am sending you a personalised certificate by post. Send me your address on WhatsApp.',
    },
    fr: {
      subject: '🏆 1 000 commandes ! Votre diplôme arrive par la poste !',
      title: '1 000 commandes !',
      intro: '{name}, vous avez franchi une étape importante : <b>1 000 commandes</b> traitées avec Menuvia.',
      intro_anon: 'Vous avez franchi une étape importante : <b>1 000 commandes</b> traitées avec Menuvia.',
      gift: 'En remerciement, je vous envoie par la poste un diplôme personnalisé. Envoyez-moi votre adresse sur WhatsApp.',
    },
    de: {
      subject: '🏆 1.000 Bestellungen! Die Urkunde kommt per Post!',
      title: '1.000 Bestellungen!',
      intro: '{name}, Sie haben einen wichtigen Meilenstein erreicht: <b>1.000 Bestellungen</b> über Menuvia.',
      intro_anon: 'Sie haben einen wichtigen Meilenstein erreicht: <b>1.000 Bestellungen</b> über Menuvia.',
      gift: 'Als Dankeschön schicke ich Ihnen eine persönliche Urkunde per Post. Schicken Sie mir Ihre Adresse über WhatsApp.',
    },
  },

  // ── Rapoartele (owner; ziua de raportare = București, vezi EMAIL_AUDIENCE) ──
  weekly_report: {
    ro: {
      subject: '📊 Raportul săptămânal: {revenue} venit',
      title: 'Raport săptămânal',
      label_revenue: 'Venit total',
      trend_vs_prev: '{pct}% vs săpt. trecută',
      no_data: 'date insuficiente',
      label_orders: 'Comenzi:',
      label_avg: 'Valoare medie bon:',
      label_peak: 'Ora de vârf:',
      top_title: 'Top produse',
      units: '{n} buc',
      cta: 'Vezi raport detaliat →',
      footer: 'Primești acest raport săptămânal pentru că ai un cont Menuvia activ. Poți dezactiva în setări.',
    },
    en: {
      subject: '📊 Weekly report: {revenue} in revenue',
      title: 'Weekly report',
      label_revenue: 'Total revenue',
      trend_vs_prev: '{pct}% vs last week',
      no_data: 'not enough data',
      label_orders: 'Orders:',
      label_avg: 'Average ticket:',
      label_peak: 'Peak hour:',
      top_title: 'Top products',
      units: '{n} sold',
      cta: 'View detailed report →',
      footer: 'You receive this weekly report because you have an active Menuvia account. You can turn it off in settings.',
    },
    fr: {
      subject: '📊 Rapport hebdomadaire : {revenue} de chiffre d’affaires',
      title: 'Rapport hebdomadaire',
      label_revenue: 'Chiffre d’affaires total',
      trend_vs_prev: '{pct} % par rapport à la semaine précédente',
      no_data: 'données insuffisantes',
      label_orders: 'Commandes :',
      label_avg: 'Ticket moyen :',
      label_peak: 'Heure de pointe :',
      top_title: 'Top produits',
      units: '{n} vendus',
      cta: 'Voir le rapport détaillé →',
      footer: 'Vous recevez ce rapport hebdomadaire parce que vous avez un compte Menuvia actif. Vous pouvez le désactiver dans les paramètres.',
    },
    de: {
      subject: '📊 Wochenbericht: {revenue} Umsatz',
      title: 'Wochenbericht',
      label_revenue: 'Gesamtumsatz',
      trend_vs_prev: '{pct} % ggü. Vorwoche',
      no_data: 'zu wenig Daten',
      label_orders: 'Bestellungen:',
      label_avg: 'Durchschnittsbon:',
      label_peak: 'Stoßzeit:',
      top_title: 'Top-Produkte',
      units: '{n} Stk.',
      cta: 'Detaillierten Bericht ansehen →',
      footer: 'Sie erhalten diesen Wochenbericht, weil Sie ein aktives Menuvia-Konto haben. Sie können ihn in den Einstellungen deaktivieren.',
    },
  },

  daily_report: {
    ro: {
      subject: '☀️ Ieri {revenue} ({orders} comenzi) — {restaurant}',
      title: 'Raport zilnic',
      label_revenue: 'Venit ieri',
      trend_vs_prev: '{pct}% vs ziua precedentă',
      no_data: 'date insuficiente',
      label_orders: 'Comenzi:',
      label_avg: 'Valoare medie bon:',
      label_peak: 'Ora de vârf:',
      top_title: 'Top produse',
      units: '{n} buc',
      cta: 'Vezi dashboard →',
      footer: 'Primești acest raport zilnic pentru că ai un cont Menuvia activ. Răspunde la acest email cu „stop daily" și îl oprim.',
    },
    en: {
      subject: '☀️ Yesterday {revenue} (orders: {orders}) — {restaurant}',
      title: 'Daily report',
      label_revenue: 'Revenue yesterday',
      trend_vs_prev: '{pct}% vs the previous day',
      no_data: 'not enough data',
      label_orders: 'Orders:',
      label_avg: 'Average ticket:',
      label_peak: 'Peak hour:',
      top_title: 'Top products',
      units: '{n} sold',
      cta: 'Open dashboard →',
      footer: 'You receive this daily report because you have an active Menuvia account. Reply to this email with “stop daily” and we will turn it off.',
    },
    fr: {
      subject: '☀️ Hier {revenue} (commandes : {orders}) — {restaurant}',
      title: 'Rapport quotidien',
      label_revenue: 'Chiffre d’affaires d’hier',
      trend_vs_prev: '{pct} % par rapport à la veille',
      no_data: 'données insuffisantes',
      label_orders: 'Commandes :',
      label_avg: 'Ticket moyen :',
      label_peak: 'Heure de pointe :',
      top_title: 'Top produits',
      units: '{n} vendus',
      cta: 'Voir mon espace →',
      footer: 'Vous recevez ce rapport quotidien parce que vous avez un compte Menuvia actif. Répondez à cet e-mail avec « stop daily » et nous l’arrêterons.',
    },
    de: {
      subject: '☀️ Gestern {revenue} (Bestellungen: {orders}) — {restaurant}',
      title: 'Tagesbericht',
      label_revenue: 'Umsatz gestern',
      trend_vs_prev: '{pct} % ggü. Vortag',
      no_data: 'zu wenig Daten',
      label_orders: 'Bestellungen:',
      label_avg: 'Durchschnittsbon:',
      label_peak: 'Stoßzeit:',
      top_title: 'Top-Produkte',
      units: '{n} Stk.',
      cta: 'Verwaltungsbereich öffnen →',
      footer: 'Sie erhalten diesen Tagesbericht, weil Sie ein aktives Menuvia-Konto haben. Antworten Sie auf diese E-Mail mit „stop daily“, und wir stellen ihn ab.',
    },
  },

  // ── Rezervările (owner; orele pe fusul LOCALULUI) ────────────────────────
  reservation_created: {
    ro: {
      subject: '🍽 Rezervare nouă — {restaurant}: {customer}, {party} pers.',
      title: 'Rezervare nouă la {restaurant}',
      label_client: 'Client',
      label_phone: 'Telefon',
      label_datetime: 'Data și ora',
      label_party: 'Persoane',
      label_notes: 'Mențiuni',
      status_confirmed: 'Rezervarea e <b>confirmată automat</b> — clientul a primit deja confirmarea.',
      status_pending: 'Rezervarea e <b>în așteptare</b> — confirm-o din dashboard ca clientul să primească răspunsul.',
      cta: 'Vezi în dashboard →',
    },
    en: {
      subject: '🍽 New reservation — {restaurant}: {customer}, party of {party}',
      title: 'New reservation at {restaurant}',
      label_client: 'Guest',
      label_phone: 'Phone',
      label_datetime: 'Date and time',
      label_party: 'Guests',
      label_notes: 'Notes',
      status_confirmed: 'The reservation was <b>confirmed automatically</b> — the guest has already received the confirmation.',
      status_pending: 'The reservation is <b>pending</b> — confirm it from the dashboard so the guest gets a reply.',
      cta: 'View in dashboard →',
    },
    fr: {
      subject: '🍽 Nouvelle réservation — {restaurant} : {customer}, {party} personnes',
      title: 'Nouvelle réservation chez {restaurant}',
      label_client: 'Client',
      label_phone: 'Téléphone',
      label_datetime: 'Date et heure',
      label_party: 'Personnes',
      label_notes: 'Remarques',
      status_confirmed: 'La réservation est <b>confirmée automatiquement</b> — le client a déjà reçu la confirmation.',
      status_pending: 'La réservation est <b>en attente</b> — confirmez-la depuis votre espace pour que le client reçoive une réponse.',
      cta: 'Voir dans votre espace →',
    },
    de: {
      subject: '🍽 Neue Reservierung — {restaurant}: {customer}, {party} Personen',
      title: 'Neue Reservierung bei {restaurant}',
      label_client: 'Gast',
      label_phone: 'Telefonnummer',
      label_datetime: 'Datum und Uhrzeit',
      label_party: 'Personen',
      label_notes: 'Anmerkungen',
      status_confirmed: 'Die Reservierung wurde <b>automatisch bestätigt</b> — der Gast hat die Bestätigung bereits erhalten.',
      status_pending: 'Die Reservierung ist <b>ausstehend</b> — bestätigen Sie sie im Verwaltungsbereich, damit der Gast eine Antwort erhält.',
      cta: 'Im Verwaltungsbereich ansehen →',
    },
  },

  reservation_cancelled: {
    ro: {
      subject: '❌ Rezervare anulată — {restaurant}: {customer}, {when}',
      title: 'Rezervare anulată de client',
      label_client: 'Client',
      label_was_for: 'Era pentru',
      when_party: '{when} · {party} pers.',
      freed: 'Masa s-a eliberat — o poți oferi mai departe.',
    },
    en: {
      subject: '❌ Reservation cancelled — {restaurant}: {customer}, {when}',
      title: 'Reservation cancelled by the guest',
      label_client: 'Guest',
      label_was_for: 'It was for',
      when_party: '{when} · party of {party}',
      freed: 'The table is free again — you can offer it to someone else.',
    },
    fr: {
      subject: '❌ Réservation annulée — {restaurant} : {customer}, {when}',
      title: 'Réservation annulée par le client',
      label_client: 'Client',
      label_was_for: 'Prévue pour',
      when_party: '{when} · {party} personnes',
      freed: 'La table est libérée — vous pouvez la proposer à quelqu’un d’autre.',
    },
    de: {
      subject: '❌ Reservierung storniert — {restaurant}: {customer}, {when}',
      title: 'Reservierung vom Gast storniert',
      label_client: 'Gast',
      label_was_for: 'Geplant für',
      when_party: '{when} · {party} Personen',
      freed: 'Der Tisch ist wieder frei — Sie können ihn weitergeben.',
    },
  },

  // ── Fondatorul către patroni (răspunsurile vin la fondator) ──────────────
  win_back_7d: {
    ro: {
      subject: '{restaurant} — văd că ai pauză. Pot ajuta cu ceva?',
      greet: 'Bună {name},',
      greet_anon: 'Bună Patron,',
      noticed: 'Am observat că ultima comandă prin Menuvia la <b>{restaurant}</b> a fost acum <b>{days} zile</b>.',
      ask: 'Nu trag concluzii — patroni inteligenți au săptămâni încărcate, sezon scăzut, sau pur și simplu testează altceva. Dar vreau să întreb direct: <b>e ceva ce nu merge cu Menuvia?</b>',
      reply: 'Răspunde la acest email cu un cuvânt sau două. Dacă e un bug, îl rezolv în 24h. Dacă lipsește o feature, o pun în roadmap. Dacă e altceva — ascult.',
    },
    en: {
      subject: '{restaurant} — I see you are taking a break. Can I help with anything?',
      greet: 'Hello {name},',
      greet_anon: 'Hello,',
      noticed: 'I noticed that the last order through Menuvia at <b>{restaurant}</b> was <b>{days} days</b> ago.',
      ask: 'I am not jumping to conclusions — smart owners have busy weeks, a slow season, or are simply trying something else. But I want to ask directly: <b>is something not working with Menuvia?</b>',
      reply: 'Reply to this email with a word or two. If it is a bug, I will fix it within 24h. If a feature is missing, I will add it to the roadmap. If it is something else — I am listening.',
    },
    fr: {
      subject: '{restaurant} — je vois que vous faites une pause. Puis-je vous aider ?',
      greet: 'Bonjour {name},',
      greet_anon: 'Bonjour,',
      noticed: 'J’ai remarqué que la dernière commande via Menuvia chez <b>{restaurant}</b> date d’il y a <b>{days} jours</b>.',
      ask: 'Je ne tire pas de conclusions — les restaurateurs avisés ont des semaines chargées, une basse saison, ou testent simplement autre chose. Mais je veux vous demander franchement : <b>y a-t-il quelque chose qui ne fonctionne pas avec Menuvia ?</b>',
      reply: 'Répondez à cet e-mail en un mot ou deux. Si c’est un bug, je le corrige sous 24 h. S’il manque une fonctionnalité, je l’ajoute à la feuille de route. Si c’est autre chose — je vous écoute.',
    },
    de: {
      subject: '{restaurant} — ich sehe, Sie machen eine Pause. Kann ich helfen?',
      greet: 'Hallo {name},',
      greet_anon: 'Hallo,',
      noticed: 'Mir ist aufgefallen, dass die letzte Bestellung über Menuvia bei <b>{restaurant}</b> schon <b>{days} Tage</b> her ist.',
      ask: 'Ich ziehe keine voreiligen Schlüsse — kluge Gastronomen haben volle Wochen, eine ruhige Saison oder testen einfach etwas anderes. Aber ich frage direkt: <b>Funktioniert etwas mit Menuvia nicht?</b>',
      reply: 'Antworten Sie auf diese E-Mail mit ein, zwei Worten. Ist es ein Fehler, behebe ich ihn innerhalb von 24 Stunden. Fehlt eine Funktion, nehme ich sie in die Planung auf. Ist es etwas anderes — ich höre zu.',
    },
  },

  win_back_30d: {
    ro: {
      subject: '{restaurant} — o lună fără comenzi. Vorbim?',
      greet: 'Bună {name},',
      greet_anon: 'Bună Patron,',
      intro: '{days} zile fără comenzi prin Menuvia la <b>{restaurant}</b>. Vreau să fiu transparent: la pragul ăsta e clar că ceva nu funcționează pentru tine.',
      scenarios: 'Două scenarii probabile:',
      scenario_blocker: '<b>Ai un blocker tehnic</b> pe care nu l-am identificat. Răspunde la acest email — rezolv săptămâna asta.',
      scenario_switched: '<b>Ai trecut pe alt produs.</b> E ok. Dar înainte, dă-mi 10 minute la telefon (răspunde cu "sună-mă"). Vreau să înțeleg ce am ratat — pentru următorii {restaurant}-uri.',
      thanks: 'Oricum ar fi: îți mulțumesc că ai dat o șansă produsului.',
    },
    en: {
      subject: '{restaurant} — a month without orders. Shall we talk?',
      greet: 'Hello {name},',
      greet_anon: 'Hello,',
      intro: '{days} days without orders through Menuvia at <b>{restaurant}</b>. I want to be honest: at this point it is clear that something is not working for you.',
      scenarios: 'Two likely scenarios:',
      scenario_blocker: '<b>You have a technical obstacle</b> that I have not spotted. Reply to this email — I will fix it this week.',
      scenario_switched: '<b>You have moved to another product.</b> That is fine. But first, give me 10 minutes on the phone (reply with "call me"). I want to understand what I missed — for the next restaurants like {restaurant}.',
      thanks: 'Either way: thank you for giving the product a chance.',
    },
    fr: {
      subject: '{restaurant} — un mois sans commandes. On en parle ?',
      greet: 'Bonjour {name},',
      greet_anon: 'Bonjour,',
      intro: '{days} jours sans commandes via Menuvia chez <b>{restaurant}</b>. Je veux être franc : à ce stade, il est clair que quelque chose ne fonctionne pas pour vous.',
      scenarios: 'Deux scénarios probables :',
      scenario_blocker: '<b>Vous avez un obstacle technique</b> que je n’ai pas identifié. Répondez à cet e-mail — je le règle cette semaine.',
      scenario_switched: '<b>Vous êtes passé à un autre produit.</b> C’est d’accord. Mais avant, accordez-moi 10 minutes au téléphone (répondez « appelez-moi »). Je veux comprendre ce que j’ai raté — pour les prochains restaurants comme {restaurant}.',
      thanks: 'Quoi qu’il en soit : merci d’avoir donné sa chance au produit.',
    },
    de: {
      subject: '{restaurant} — ein Monat ohne Bestellungen. Sprechen wir?',
      greet: 'Hallo {name},',
      greet_anon: 'Hallo,',
      intro: '{days} Tage ohne Bestellungen über Menuvia bei <b>{restaurant}</b>. Ich will ehrlich sein: An diesem Punkt ist klar, dass etwas für Sie nicht funktioniert.',
      scenarios: 'Zwei wahrscheinliche Szenarien:',
      scenario_blocker: '<b>Sie haben ein technisches Hindernis</b>, das ich nicht erkannt habe. Antworten Sie auf diese E-Mail — ich löse es diese Woche.',
      scenario_switched: '<b>Sie sind zu einem anderen Produkt gewechselt.</b> Das ist in Ordnung. Aber vorher: Geben Sie mir 10 Minuten für ein Telefonat (antworten Sie mit „rufen Sie mich an“). Ich möchte verstehen, was ich übersehen habe — für die nächsten Betriebe wie {restaurant}.',
      thanks: 'Wie auch immer: Danke, dass Sie dem Produkt eine Chance gegeben haben.',
    },
  },

  nps_survey: {
    ro: {
      subject: '{restaurant} — pe scara 0-10, ce notă dai Menuvia?',
      greet: 'Bună {name},',
      greet_anon: 'Bună Patron,',
      intro: 'Sunt 2 luni de când folosești Menuvia. O singură întrebare:',
      question: 'Pe scara 0–10, cât de probabil e să recomanzi Menuvia altui patron de restaurant?',
      hint: 'Click pe notă → deschide email-ul tău cu nota pre-completată. Adaugă 1-2 fraze cu motivul (opțional). Pentru orice notă sub 7, sun personal în 48h.',
      mailto_score: 'Nota: {score}/10',
      mailto_reason: 'Motiv (opțional):',
    },
    en: {
      subject: '{restaurant} — on a scale of 0-10, how would you rate Menuvia?',
      greet: 'Hello {name},',
      greet_anon: 'Hello,',
      intro: 'You have been using Menuvia for 2 months. Just one question:',
      question: 'On a scale of 0–10, how likely are you to recommend Menuvia to another restaurant owner?',
      hint: 'Tap a score → your email app opens with the score filled in. Add 1-2 sentences with the reason (optional). For any score below 7, I will call you personally within 48h.',
      mailto_score: 'Score: {score}/10',
      mailto_reason: 'Reason (optional):',
    },
    fr: {
      subject: '{restaurant} — sur une échelle de 0 à 10, quelle note donnez-vous à Menuvia ?',
      greet: 'Bonjour {name},',
      greet_anon: 'Bonjour,',
      intro: 'Cela fait 2 mois que vous utilisez Menuvia. Une seule question :',
      question: 'Sur une échelle de 0 à 10, quelle est la probabilité que vous recommandiez Menuvia à un autre restaurateur ?',
      hint: 'Cliquez sur une note → votre messagerie s’ouvre avec la note pré-remplie. Ajoutez 1 ou 2 phrases sur la raison (facultatif). Pour toute note inférieure à 7, je vous appelle personnellement sous 48 h.',
      mailto_score: 'Note : {score}/10',
      mailto_reason: 'Raison (facultatif) :',
    },
    de: {
      subject: '{restaurant} — auf einer Skala von 0-10: Welche Note geben Sie Menuvia?',
      greet: 'Hallo {name},',
      greet_anon: 'Hallo,',
      intro: 'Sie nutzen Menuvia seit 2 Monaten. Nur eine Frage:',
      question: 'Wie wahrscheinlich ist es auf einer Skala von 0–10, dass Sie Menuvia einem anderen Gastronomen empfehlen?',
      hint: 'Klicken Sie auf eine Note → Ihr E-Mail-Programm öffnet sich mit der vorausgefüllten Note. Fügen Sie 1-2 Sätze zur Begründung hinzu (optional). Bei jeder Note unter 7 rufe ich Sie innerhalb von 48 Stunden persönlich an.',
      mailto_score: 'Note: {score}/10',
      mailto_reason: 'Begründung (optional):',
    },
  },

  // ── Rețeaua de vânzări către patron (mig 299/303) ────────────────────────
  partner_access_requested: {
    ro: {
      subject: '{agent} cere acces la meniul {restaurant}',
      subject_agent_anon: 'Agentul tău Menuvia',
      subject_restaurant_anon: 'restaurantului tău',
      title: 'Agentul tău Menuvia cere acces',
      body: '{agent} cere acces la meniul și mesele {restaurant}, ca să te ajute cu configurarea.',
      body_agent: '<b>{agent}</b>, agentul tău Menuvia,',
      body_agent_anon: 'Agentul tău Menuvia',
      body_restaurant: 'restaurantului <b>{restaurant}</b>',
      body_restaurant_anon: 'restaurantului tău',
      scope: 'Accesul acoperă DOAR meniul și mesele cu codurile QR — nu comenzile, încasările, rezervările sau datele fiscale. Îl poți revoca oricând. Fără aprobarea ta, agentul nu primește niciun acces; dacă nu-l cunoști, ignoră acest email.',
      cta: 'Vezi cererea →',
    },
    en: {
      subject: '{agent} is asking for access to the menu of {restaurant}',
      subject_agent_anon: 'Your Menuvia agent',
      subject_restaurant_anon: 'your restaurant',
      title: 'Your Menuvia agent is asking for access',
      body: '{agent} is asking for access to the menu and tables of {restaurant}, to help you with the setup.',
      body_agent: '<b>{agent}</b>, your Menuvia agent,',
      body_agent_anon: 'Your Menuvia agent',
      body_restaurant: '<b>{restaurant}</b>',
      body_restaurant_anon: 'your restaurant',
      scope: 'The access covers ONLY the menu and the tables with their QR codes — not orders, payments, reservations or tax data. You can revoke it at any time. Without your approval, the agent gets no access; if you do not know them, ignore this email.',
      cta: 'View the request →',
    },
    fr: {
      subject: '{agent} demande l’accès au menu de {restaurant}',
      subject_agent_anon: 'Votre agent Menuvia',
      subject_restaurant_anon: 'votre restaurant',
      title: 'Votre agent Menuvia demande l’accès',
      body: '{agent} demande l’accès au menu et aux tables {restaurant}, pour vous aider à la configuration.',
      body_agent: '<b>{agent}</b>, votre agent Menuvia,',
      body_agent_anon: 'Votre agent Menuvia',
      body_restaurant: 'du restaurant <b>{restaurant}</b>',
      body_restaurant_anon: 'de votre restaurant',
      scope: 'L’accès couvre UNIQUEMENT le menu et les tables avec leurs codes QR — pas les commandes, les encaissements, les réservations ni les données fiscales. Vous pouvez le révoquer à tout moment. Sans votre accord, l’agent n’obtient aucun accès ; si vous ne le connaissez pas, ignorez cet e-mail.',
      cta: 'Voir la demande →',
    },
    de: {
      subject: '{agent} bittet um Zugriff auf die Speisekarte von {restaurant}',
      subject_agent_anon: 'Ihr Menuvia-Berater',
      subject_restaurant_anon: 'Ihrem Restaurant',
      title: 'Ihr Menuvia-Berater bittet um Zugriff',
      body: '{agent} bittet um Zugriff auf die Speisekarte und die Tische {restaurant}, um Ihnen bei der Einrichtung zu helfen.',
      body_agent: '<b>{agent}</b>, Ihr Menuvia-Berater,',
      body_agent_anon: 'Ihr Menuvia-Berater',
      body_restaurant: 'des Restaurants <b>{restaurant}</b>',
      body_restaurant_anon: 'Ihres Restaurants',
      scope: 'Der Zugriff umfasst NUR die Speisekarte und die Tische mit ihren QR-Codes — keine Bestellungen, Zahlungen, Reservierungen oder Steuerdaten. Sie können ihn jederzeit widerrufen. Ohne Ihre Zustimmung erhält der Berater keinen Zugriff; wenn Sie ihn nicht kennen, ignorieren Sie diese E-Mail.',
      cta: 'Anfrage ansehen →',
    },
  },

  // ── Oaspetele (singurul email către oaspete; 7 limbi) ────────────────────
  reservation_reminder: {
    ro: {
      subject: 'Reminder: rezervarea ta la {restaurant} {when}',
      hello: 'Bună {name}!',
      hello_anon: 'Bună !',
      intro: 'Îți reamintim de rezervarea ta la <b>{restaurant}</b>:',
      label_datetime: 'Data și ora',
      label_party: 'Persoane',
      label_code: 'Cod confirmare',
      call: 'Dacă nu mai poți veni, te rugăm să suni: {phone}',
      closing: 'Te așteptăm cu drag.',
    },
    en: {
      subject: 'Reminder: your reservation at {restaurant} {when}',
      hello: 'Hello {name}!',
      hello_anon: 'Hello!',
      intro: 'This is a reminder of your reservation at <b>{restaurant}</b>:',
      label_datetime: 'Date and time',
      label_party: 'Guests',
      label_code: 'Confirmation code',
      call: 'If you can no longer come, please call: {phone}',
      closing: 'We look forward to seeing you.',
    },
    de: {
      subject: 'Erinnerung: deine Reservierung bei {restaurant} {when}',
      hello: 'Hallo {name}!',
      hello_anon: 'Hallo!',
      intro: 'Wir erinnern dich an deine Reservierung bei <b>{restaurant}</b>:',
      label_datetime: 'Datum und Uhrzeit',
      label_party: 'Personen',
      label_code: 'Bestätigungscode',
      call: 'Falls du nicht kommen kannst, ruf uns bitte an: {phone}',
      closing: 'Wir freuen uns auf deinen Besuch.',
    },
    fr: {
      subject: 'Rappel : votre réservation chez {restaurant} {when}',
      hello: 'Bonjour {name} !',
      hello_anon: 'Bonjour !',
      intro: 'Nous vous rappelons votre réservation chez <b>{restaurant}</b> :',
      label_datetime: 'Date et heure',
      label_party: 'Personnes',
      label_code: 'Code de confirmation',
      call: 'Si vous ne pouvez plus venir, merci de nous appeler : {phone}',
      closing: 'Au plaisir de vous accueillir.',
    },
    it: {
      subject: 'Promemoria: la tua prenotazione da {restaurant} {when}',
      hello: 'Ciao {name}!',
      hello_anon: 'Ciao!',
      intro: 'Ti ricordiamo la tua prenotazione da <b>{restaurant}</b>:',
      label_datetime: 'Data e ora',
      label_party: 'Persone',
      label_code: 'Codice di conferma',
      call: 'Se non puoi più venire, chiamaci: {phone}',
      closing: 'Ti aspettiamo con piacere.',
    },
    hu: {
      subject: 'Emlékeztető: {restaurant} – foglalás {when}',
      hello: 'Kedves {name}!',
      hello_anon: 'Kedves Vendégünk!',
      intro: 'Emlékeztetünk a(z) <b>{restaurant}</b> étteremben leadott foglalásodra:',
      label_datetime: 'Dátum és időpont',
      label_party: 'Személyek száma',
      label_code: 'Visszaigazolási kód',
      call: 'Ha mégsem tudsz eljönni, kérjük, hívj minket: {phone}',
      closing: 'Szeretettel várunk!',
    },
    es: {
      subject: 'Recordatorio: tu reserva en {restaurant} {when}',
      hello: '¡Hola, {name}!',
      hello_anon: '¡Hola!',
      intro: 'Te recordamos tu reserva en <b>{restaurant}</b>:',
      label_datetime: 'Fecha y hora',
      label_party: 'Personas',
      label_code: 'Código de confirmación',
      call: 'Si ya no puedes venir, llámanos: {phone}',
      closing: 'Te esperamos con mucho gusto.',
    },
  },

  // ── Trimiterile directe (nu trec prin coadă) ─────────────────────────────
  // send-invite.js
  team_invite: {
    ro: {
      subject: 'Ai fost invitat la {restaurant} pe Menuvia',
      title: 'Ai fost invitat la <strong>{restaurant}</strong>',
      invited_by: '{inviter} te-a invitat ca {role} pe Menuvia.',
      accept_hint: 'Acceptă invitația pentru a accesa dashboardul restaurantului.',
      cta: 'Acceptă invitația',
      expires: 'Linkul expiră în 7 zile. Dacă nu ai solicitat această invitație, ignoră acest email.',
      role_manager: 'Manager',
      role_waiter: 'Ospătar',
      role_kitchen: 'Bucătărie',
      // Rezervele când numele lipsește din DB (rând lipsă / eroare tranzitorie).
      restaurant_anon: 'restaurantul tău',
      inviter_anon: 'Un coleg',
    },
    en: {
      subject: 'You’ve been invited to {restaurant} on Menuvia',
      title: 'You’ve been invited to <strong>{restaurant}</strong>',
      invited_by: '{inviter} invited you as {role} on Menuvia.',
      accept_hint: 'Accept the invitation to access the restaurant’s dashboard.',
      cta: 'Accept the invitation',
      expires: 'The link expires in 7 days. If you did not request this invitation, ignore this email.',
      role_manager: 'Manager',
      role_waiter: 'Waiter',
      role_kitchen: 'Kitchen',
      restaurant_anon: 'your restaurant',
      inviter_anon: 'A colleague',
    },
    fr: {
      subject: 'Vous avez été invité(e) chez {restaurant} sur Menuvia',
      title: 'Vous avez été invité(e) chez <strong>{restaurant}</strong>',
      invited_by: '{inviter} vous a invité(e) en tant que {role} sur Menuvia.',
      accept_hint: 'Acceptez l’invitation pour accéder à l’espace du restaurant.',
      cta: 'Accepter l’invitation',
      expires: 'Le lien expire dans 7 jours. Si vous n’avez pas demandé cette invitation, ignorez cet e-mail.',
      role_manager: 'Manager',
      role_waiter: 'Serveur',
      role_kitchen: 'Cuisine',
      restaurant_anon: 'votre restaurant',
      inviter_anon: 'Un collègue',
    },
    de: {
      subject: 'Sie wurden zu {restaurant} auf Menuvia eingeladen',
      title: 'Sie wurden zu <strong>{restaurant}</strong> eingeladen',
      invited_by: '{inviter} hat Sie als {role} zu Menuvia eingeladen.',
      accept_hint: 'Nehmen Sie die Einladung an, um auf den Verwaltungsbereich des Restaurants zuzugreifen.',
      cta: 'Einladung annehmen',
      expires: 'Der Link läuft in 7 Tagen ab. Wenn Sie diese Einladung nicht angefordert haben, ignorieren Sie diese E-Mail.',
      role_manager: 'Manager',
      role_waiter: 'Service',
      role_kitchen: 'Küche',
      // Dativ: „Sie wurden zu Ihrem Restaurant … eingeladen”.
      restaurant_anon: 'Ihrem Restaurant',
      inviter_anon: 'Ein Kollege',
    },
  },

  // welcome-email.js
  signup_welcome: {
    ro: {
      subject: 'Bun venit la Menuvia',
      hello: 'Bun venit, {name}!',
      hello_anon: 'Bun venit!',
      created: 'Contul tău Menuvia a fost creat cu succes.',
      pitch: 'Acum poți să-ți digitalizezi meniul, să primești comenzi de pe telefoanele clienților și să urmărești tot ce se întâmplă în restaurant în timp real.',
      cta: 'Mergi la dashboard',
      questions: 'Ai întrebări? Răspunde la acest email.',
    },
    en: {
      subject: 'Welcome to Menuvia',
      hello: 'Welcome, {name}!',
      hello_anon: 'Welcome!',
      created: 'Your Menuvia account has been created.',
      pitch: 'You can now digitise your menu, take orders from your guests’ phones and follow everything that happens in the restaurant as it happens.',
      cta: 'Go to the dashboard',
      questions: 'Questions? Reply to this email.',
    },
    fr: {
      subject: 'Bienvenue sur Menuvia',
      hello: 'Bienvenue, {name} !',
      hello_anon: 'Bienvenue !',
      created: 'Votre compte Menuvia a bien été créé.',
      pitch: 'Vous pouvez désormais numériser votre menu, recevoir des commandes depuis les téléphones de vos clients et suivre en temps réel tout ce qui se passe au restaurant.',
      cta: 'Accéder à mon espace',
      questions: 'Des questions ? Répondez à cet e-mail.',
    },
    de: {
      subject: 'Willkommen bei Menuvia',
      hello: 'Willkommen, {name}!',
      hello_anon: 'Willkommen!',
      created: 'Ihr Menuvia-Konto wurde erfolgreich erstellt.',
      pitch: 'Sie können jetzt Ihre Speisekarte digitalisieren, Bestellungen von den Handys Ihrer Gäste empfangen und in Echtzeit verfolgen, was im Restaurant passiert.',
      cta: 'Zum Verwaltungsbereich',
      questions: 'Fragen? Antworten Sie auf diese E-Mail.',
    },
  },
}

/** O limbă e COMPLETĂ pentru un tabel când are toate cheile românei, nevide. */
function isComplete(table, lang) {
  const ro = table && table.ro
  const t = table && table[lang]
  if (!ro || !t || typeof t !== 'object') return false
  return Object.keys(ro).every((k) => typeof t[k] === 'string' && t[k] !== '')
}

/**
 * Șirurile unui tabel pe o limbă: limba cerută dacă e completă, altfel
 * engleza (dacă e completă), altfel româna — mereu un obiect ÎNTREG, deci un
 * email nu amestecă niciodată două limbi.
 */
function pickLang(table, lang) {
  if (isComplete(table, lang)) return table[lang]
  if (isComplete(table, 'en')) return table.en
  return table.ro
}

function kindStrings(kind, lang, strings = EMAIL_STRINGS) {
  const table = strings[kind]
  if (!table || !table.ro) throw new Error(`emailStrings: kind fără texte: ${kind}`)
  return pickLang(table, lang)
}

function commonStrings(lang, common = COMMON) {
  return pickLang(common, lang)
}

/**
 * `{nume}` → valoarea din `vars`, într-o SINGURĂ trecere (o valoare care
 * conține „{x}” nu e re-interpretată); placeholder fără valoare → ''.
 * Valorile se dau deja escapate, ca șiruri.
 */
function fill(tpl, vars = {}) {
  return String(tpl).replace(/\{([a-z_]+)\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : '',
  )
}

module.exports = {
  EMAIL_STRINGS,
  COMMON,
  RO_PLACEHOLDER_NAMES,
  kindStrings,
  commonStrings,
  isComplete,
  fill,
}

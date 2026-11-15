import type { Translation } from '../../core'
import type ro from './ro'

// Sie; Gast (nicht Kunde); Abholung = ridicare; „Verwaltungsbereich“ für das
// Panel des Restaurants; Tarif = Plan (die Handelsnamen bleiben die aus
// PLAN_LABELS); Schaltflächen im Infinitiv. Der Pfad „Einstellungen → Aussehen
// der Speisekarte → Anordnung der Produkte“ ist der aus `tables`.
const de: Translation<typeof ro> = {
  save_busy: 'Wird gespeichert…',
  unsaved: 'Sie haben ungespeicherte Änderungen',
  toast_saved: 'Gespeichert',
  toast_uploadFailed: 'Hochladen fehlgeschlagen',
  slug_taken: 'Slug nicht verfügbar: „{slug}“ wird bereits verwendet',
  err_slug: 'Der Slug konnte nicht geändert werden.',
  err_save: 'Speichern fehlgeschlagen',

  info_title: 'Allgemeine Angaben',
  info_name: 'Name des Restaurants *',
  info_namePh: 'La Bella Trattoria',
  info_tagline: 'Slogan',
  info_taglinePh: 'Authentische Küche',
  info_city: 'Stadt',
  info_cityPh: 'Freiburg',
  info_phone: 'Telefon',
  info_phonePh: '+49 xxx xxxxxxx',
  info_hours: 'Öffnungszeiten',
  info_hoursPh: 'Mo–So: 12:00–23:00',
  info_description: 'Beschreibung',
  info_descriptionPh: 'Über das Restaurant…',

  country_title: 'Land des Restaurants',
  country_descRo:
    'Zahlungen in der App, der Fiskalbeleg und der MwSt.-Bericht sind nur für Restaurants in Rumänien verfügbar.',
  country_desc: 'Das Land, in dem sich der Betrieb befindet.',
  country_ownerOnly: 'Nur der Inhaber des Restaurants kann das Land ändern.',
  tz_title: 'Zeitzone',
  tz_desc: 'Öffnungszeiten, Abholzeiten und Reservierungszeiten werden in dieser Zeitzone berechnet.',
  tz_aria: 'Zeitzone des Restaurants',

  hours_title: 'Detaillierte Öffnungszeiten',
  hours_desc:
    'Wird für die Anzeige „JETZT GEÖFFNET“ und den Text „Heute 08:00–23:00“ auf der öffentlichen Speisekarte verwendet.',
  hours_copyMonday: 'Montag → alle kopieren',
  hours_open: 'Geöffnet',
  hours_opensLabel: 'Öffnet',
  hours_closesLabel: 'Schließt',
  hours_openAria: '{day} Öffnungszeit',
  hours_closeAria: '{day} Schließzeit',
  hours_confirmTitle: 'Die Zeiten von Dienstag bis Sonntag mit denen vom Montag überschreiben?',
  hours_confirmDesc: 'Diese Aktion kann nicht rückgängig gemacht werden.',
  hours_confirmOk: 'Überschreiben',
  day_mon: 'Montag',
  day_tue: 'Dienstag',
  day_wed: 'Mittwoch',
  day_thu: 'Donnerstag',
  day_fri: 'Freitag',
  day_sat: 'Samstag',
  day_sun: 'Sonntag',

  logo_title: 'Logo',
  logo_desc: 'Quadratisches Logo. Optional, wird als Avatar / künftiges Favicon verwendet.',
  logo_alt: 'Logo',
  logo_upload: 'Logo hochladen',
  logo_remove: 'Logo entfernen',
  uploading: 'Wird hochgeladen…',
  cover_title: 'Titelbild',
  cover_desc:
    'Wird oben auf der öffentlichen Speisekarte angezeigt. Empfohlen: Format 16:9, >1200 px Breite. ' +
    'Fehlt es, verwenden wir einen Farbverlauf aus Ihrem Design.',
  cover_alt: 'Titelbild',
  cover_none: 'Kein Bild — Farbverlauf des aktiven Designs',
  cover_upload: 'Bild hochladen',

  amen_title: 'Ausstattung',
  amen_desc: 'Werden als Plaketten oben auf der öffentlichen Speisekarte angezeigt.',
  amenity_wifi: 'WLAN',
  amenity_vegan_options: 'Vegane Optionen',
  amenity_outdoor_seating: 'Terrasse',
  amenity_parking: 'Parkplatz',
  amenity_cards: 'Kartenzahlung',
  amenity_reservations: 'Reservierungen',
  amenity_pet_friendly: 'Haustiere erlaubt',

  wifi_title: 'WLAN-Passwort (optional)',
  wifi_desc: 'Wird in der Speisekarte im Klartext angezeigt. Leer lassen, wenn Sie es nicht veröffentlichen möchten.',
  wifi_label: 'WLAN-Passwort',
  wifi_ph: 'z. B. tinctura2024',
  social_title: 'Soziale Medien',
  social_website: 'Website',
  google_title: 'Google-Rezensionen (automatische Rezensionen)',
  google_descPay:
    'Nachdem der Gast bezahlt und die Feedback-Fragen beantwortet hat, zeigen wir ihm eine Schaltfläche ' +
    '„Rezension auf Google schreiben“, die ihn direkt zu Ihrem Unternehmensprofil führt. Die ' +
    'Schaltfläche erscheint allen Gästen, unabhängig von der Bewertung — Google erlaubt nicht, den Link ' +
    'nur zufriedenen Gästen zu zeigen.',
  google_desc:
    'Nachdem der Gast die Feedback-Fragen beantwortet hat, zeigen wir ihm eine Schaltfläche „Rezension ' +
    'auf Google schreiben“, die ihn direkt zu Ihrem Unternehmensprofil führt. Die Schaltfläche erscheint ' +
    'allen Gästen, unabhängig von der Bewertung — Google erlaubt nicht, den Link nur zufriedenen Gästen ' +
    'zu zeigen.',
  google_placeId: 'Google Place ID',
  google_help:
    'Ihre Place ID finden Sie hier: {link}. Suchen Sie den Namen Ihres Betriebs und kopieren Sie die ID (sie beginnt mit „ChIJ…“).',
  google_finder: 'Place ID Finder',
  google_configured: 'Eingerichtet',
  google_preview: 'URL-Vorschau: {link}',

  preview_title: 'Vorschau',
  preview_desc: 'So sehen Ihre Gäste die Speisekarte — die Vorschau aktualisiert sich bei jeder Änderung.',
  url_title: 'URL der Speisekarte',
  url_slugLabel: 'Adresse der Speisekarte (Slug)',
  url_slugPh: 'slug-url',
  accent_title: 'Akzentfarbe',
  accent_aria: 'Akzentfarbe {name}',
  accent_C8963C: 'Gold',
  accent_E05555: 'Rot',
  accent_4CAF6E: 'Grün',
  accent_5B8DEF: 'Blau',
  accent_9B72CF: 'Lila',
  accent_E07B45: 'Orange',
  accent_3ABFBF: 'Türkis',
  theme_title: 'Design der QR-Speisekarte',
  theme_desc: 'Wählen Sie den visuellen Stil Ihrer Speisekarte. Er gilt sofort für die Seite, die Ihre Gäste sehen.',
  theme_bg: 'Hintergrund',
  theme_accent: 'Akzent',
  theme_surface: 'Oberfläche',
  theme_note: 'Nach dem Speichern sehen Gäste das neue Design beim nächsten Laden der Speisekarte.',
  theme_cafe_name: 'Editorial Koralle',
  theme_cafe_desc: 'Warme Creme + Koralle. Redaktionell, einladend, kursive Serifenschrift.',
  theme_pizzeria_name: 'Italienische Pizzeria',
  theme_pizzeria_desc: 'Rot + Weiß + Grün. Fröhlich, energiegeladen, italienische Schriften.',
  'theme_fine-dining_name': 'Fine Dining',
  'theme_fine-dining_desc': 'Schwarz + elegantes Gold. Raffiniert, minimalistisch, klassische Serifenschrift.',
  theme_pub_name: 'Pub & Bar',
  theme_pub_desc: 'Dunkelgrün + Bernstein. Robust, maskulin, industrielle Schriften.',
  theme_mexican_name: 'Mexikanisch / Fast Food',
  theme_mexican_desc: 'Kräftige Farben — Rot + Gelb. Fröhlich, energiegeladen, auffällig.',
  theme_asian_name: 'Asiatisch & Sushi',
  theme_asian_desc: 'Minimalistisches Weiß + japanisches Rot. Klar, aufgeräumt, zeitlos.',
  theme_healthy_name: 'Gesund & Vegan',
  theme_healthy_desc: 'Grün + natürliche Creme. Klar, frisch, runde Schriften.',
  theme_mediterranean_name: 'Mediterran',
  theme_mediterranean_desc: 'Santorini-Blau + Weiß. Luftig, hell, Urlaubsgefühl.',
  layout_title: 'Anordnung der Produkte',
  layout_desc:
    'Wie die Produkte auf der Seite angeordnet sind, die Ihre Gäste sehen. Gilt für die digitale Speisekarte und die QR-Speisekarte.',
  layout_list: 'Liste',
  layout_listDesc: 'Kleines Foto + Text. Klassisch und kompakt.',
  layout_grid: 'Fotogalerie',
  layout_gridDesc: 'Große Fotos, 2 Spalten. Am visuellsten.',
  layout_minimal: 'Elegant minimal',
  layout_minimalDesc: 'Text ohne Fotos. Redaktioneller Stil, klassisch und schnell.',
  layout_photo: 'Foto zuerst',
  layout_photoDesc: 'Große Fotos mit Name und Preis auf dem Foto. Tippen Sie auf das Foto für Details und Optionen.',
  layout_flipbook: 'Flipbook (PDF/Seiten)',
  layout_flipbookDesc: 'Die Seiten der Speisekarte als Bilder, zum Durchblättern wie ein Buch.',
  fb_pagesTitle: 'Seiten der Speisekarte ({n}/{max})',
  fb_help:
    'Haben Sie Ihre Speisekarte als PDF? Exportieren Sie die Seiten als Bilder (oder fotografieren Sie ' +
    'sie) und laden Sie sie hier hoch — oder nutzen Sie den KI-Import unter Produkte, um daraus eine ' +
    'interaktive Speisekarte zu machen.',
  fb_pageAlt: 'Seite {n}',
  fb_moveUp: 'Seite {n} nach oben verschieben',
  fb_moveDown: 'Seite {n} nach unten verschieben',
  fb_remove: 'Seite {n} löschen',
  fb_empty: 'Noch keine Seiten. Bis Sie Seiten hochladen, sehen Gäste die Speisekarte im Stil „Liste“.',
  fb_upload: 'Seiten hochladen (Mehrfachauswahl möglich)',
  fb_orderNote:
    'Mit Flipbook sehen Gäste die Speisekarte wie ein Buch — Bestellen über die Speisekarte ist in ' +
    'diesem Stil nicht möglich; der Service lässt sich weiterhin rufen.',
  fb_full: 'Maximal {max} Seiten — löschen Sie eine, um eine weitere hinzuzufügen',
  fb_partial: {
    one: 'Maximal {max} Seiten — nur die erste wird hochgeladen',
    other: 'Maximal {max} Seiten — nur die ersten {n} werden hochgeladen',
  },
  fb_added: {
    one: '{n} Seite hinzugefügt — vergessen Sie nicht zu speichern',
    other: '{n} Seiten hinzugefügt — vergessen Sie nicht zu speichern',
  },
  el_title: 'Elemente der Speisekarte',
  el_desc: 'Wählen Sie, was Gäste auf der Speisekarte sehen. Standardmäßig ist alles aktiviert.',
  el_cover: 'Titelbild',
  el_coverDesc: 'Das Titelbild ganz oben. Ist es deaktiviert, wird ein Farbverlauf angezeigt.',
  el_tagline: 'Slogan',
  el_taglineDesc: 'Der Slogan des Restaurants, unter dem Namen angezeigt.',
  el_status: 'Status geöffnet / geschlossen',
  el_statusDesc: 'Die Plakette, die zeigt, ob das Restaurant gerade geöffnet ist.',
  el_amenities: 'WLAN & Vegan',
  el_amenitiesDesc: 'Plaketten für WLAN und vegane Optionen.',
  el_social: 'Soziale Medien',
  el_socialDesc: 'Plaketten mit Links zu Instagram, TikTok, Facebook und Website.',
  branding_title: 'Badge „Erstellt mit Menuvia“',
  branding_desc: 'Der dezente Link unten auf der öffentlichen Speisekarte. In Ihrem Tarif können Sie ihn ausblenden.',
  branding_toggle: 'Badge „Erstellt mit Menuvia“ anzeigen',
  langs_title: 'Sprachen der Speisekarte',
  langs_desc: 'Die Sprache, in der die Speisekarte geschrieben ist, und die zusätzlichen Sprachen, in denen Gäste sie ansehen können.',
  langs_base: 'Originalsprache der Speisekarte',
  langs_baseHelp:
    'Die Sprache, in der Sie Produktnamen und -beschreibungen geschrieben haben. Übersetzungen werden für die anderen Sprachen ergänzt.',
  cur_title: 'Währung der Speisekarte',
  cur_descPay:
    'Die Währung, in der die Preise auf der öffentlichen und der QR-Speisekarte angezeigt werden. Ihr Menuvia-Abonnement und die Fiskalisierung sind nicht betroffen.',
  cur_desc:
    'Die Währung, in der die Preise auf der öffentlichen und der QR-Speisekarte angezeigt werden. Ihr Menuvia-Abonnement ist nicht betroffen.',
  cur_ron: 'RON (Lei)',

  mod_title: 'Optionale Module',
  mod_desc:
    'Aktivieren Sie nur, was Sie brauchen. Deaktivierte Module sind serverseitig gesperrt — weder Gäste ' +
    'noch Mitarbeitende können darin Daten anlegen.',
  mod_resv: 'Reservierungen',
  mod_resvDesc:
    'Gäste können über die öffentliche Speisekarte Tische reservieren. Sie bestätigen und verwalten sie im Verwaltungsbereich unter Reservierungen.',
  mod_resvOn: 'Modul Reservierungen aktiviert',
  mod_resvOff: 'Modul Reservierungen deaktiviert',
  pickup_title: 'Bestellungen zur Abholung (Click & Collect)',
  pickup_toggle: 'Bestellungen zur Abholung',
  pickupOnly_title: 'Modus „Nur Abholung“ (ohne Tische)',
  pickup_lead: 'Mindest-Zubereitungszeit (Min.)',
  pickup_leadAria: 'Mindest-Zubereitungszeit (Minuten)',
  pickup_slot: 'Zeitfenster-Intervall (Min.)',
  pickup_slotAria: 'Zeitfenster-Intervall (Minuten)',
  pickup_open: 'Beginn',
  pickup_openAria: 'Beginn der Abholung',
  pickup_close: 'Ende',
  pickup_closeAria: 'Ende der Abholung',
  pickup_instr: 'Hinweise für Gäste (optional)',
  pickup_instrPh: 'z. B. Bei Ankunft anrufen, Seiteneingang',
  pickup_kitchenNote:
    'Bestellungen zur Abholung erscheinen in der Küchenansicht mit dem Badge {badge}. Name des Gastes und Abholzeit sind sichtbar.',
  pickup_badge: '📦 Abholung',
  pk_lead: 'Bestellungen zur Abholung im Restaurant, über Ihre öffentliche Seite',
  pk_flipbookTail: '. Achtung: {why}',
  pk_flipbookNoOrders:
    'im Stil Flipbook zeigt die öffentliche Seite die Speisekarte wie ein Buch, ohne Warenkorb, ' +
    'daher können Gäste nicht zur Abholung bestellen. Für Bestellungen wählen Sie einen anderen ' +
    'Stil unter Einstellungen → Aussehen der Speisekarte → Anordnung der Produkte.',
  pk_activeLead: 'Mit aktivierter Abholung können Gäste über Ihre öffentliche Seite',
  pk_activeTail: ' bestellen, ohne einen QR-Code zu scannen, und direkt im Restaurant abholen. Barzahlung bei Abholung.',
  pk_plainTail: '.',
  po_suspended:
    'In Ihrem Tarif gilt dieser Modus nicht: Ohne Bestellungen zur Abholung zeigt der Verwaltungsbereich Ihre Tische und Reservierungen.',
  po_desc:
    'Für Foodtruck / Theke: blendet Tischplan und Reservierungen im Verwaltungsbereich aus. ' +
    'Der allgemeine QR-Code unter Tische & QR-Codes wird zu Ihrem Haupt-QR-Code.',
  sugg_title: 'Vorschläge im Warenkorb',
  sugg_desc:
    'Schlägt automatisch Produkte aus Kategorien vor, die im Warenkorb fehlen (z. B. ein Gast hat ein Hauptgericht, aber kein Dessert gewählt).',
  sugg_msgLabel: 'Angezeigte Nachricht',
  sugg_msgAria: 'Nachricht bei den Vorschlägen',
  sugg_msgPh: '🍰 Bevor Sie absenden … darf es noch etwas sein?',
  vat_title: 'MwSt.-Sätze',
  vat_desc:
    'Die 4 MwSt.-Gruppen Ihres Restaurants. Ändern Sie den Prozentsatz, wenn der Staat die Sätze ändert — ' +
    'die Produkte behalten ihre Gruppe automatisch.',

  plan_title: 'Aktueller Tarif',
  plan_failed: 'Der Tarif konnte nicht geprüft werden',
  plan_checking: 'Wird geprüft…',
  signOut: 'Abmelden',
}

export default de

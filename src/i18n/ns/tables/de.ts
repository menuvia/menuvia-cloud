import type { Translation } from '../../core'
import type ro from './ro'

// masă = Tisch; zonă = Bereich (wie `waiter.resv_zone`); client = Gast;
// „Panou” = „Verwaltungsbereich”, „plan” = „Tarif” (wie `dashboard`/`home`);
// ridicare = Abholung; Meniu = Speisekarte. Sie-Form, Buttons im Infinitiv.
const de: Translation<typeof ro> = {
  saving: 'Wird gespeichert…',

  qr_genFailed: 'Der QR-Code konnte nicht erstellt werden',
  qr_alt: 'QR-Code für {label}',
  qr_altPlain: 'QR-Code',

  addTable: 'Tisch hinzufügen',
  editTable: 'Tisch bearbeiten',
  modal_name: 'Tischname *',
  modal_namePlaceholder: 'Tisch 1, Terrasse A…',
  modal_slug: 'URL-Slug',
  modal_slugPlaceholder: 'tisch-1',
  modal_slugHint: 'Interne Kennung des Tisches — wirkt sich nicht auf bereits gedruckte QR-Codes aus',
  modal_seats: 'Plätze (optional)',
  modal_zone: 'Bereich (optional)',
  modal_zonePlaceholder: 'Terrasse, Innenraum, Bar…',
  modal_zoneHint:
    'Gäste können bei der Online-Reservierung den Bereich wählen (z. B. Terrasse oder Innenraum)',
  modal_err_nameRequired: 'Der Name ist erforderlich.',
  modal_err_duplicate:
    'Es gibt bereits einen Tisch mit dieser Kennung. Wählen Sie einen anderen Namen oder Slug.',
  modal_err_save:
    'Der Tisch konnte nicht gespeichert werden. Prüfen Sie die Angaben und versuchen Sie es erneut.',

  general_title: 'Allgemeiner QR-Code der Speisekarte',
  general_leadsTo: 'Führt zu {path} — {text}',
  general_png: 'PNG',
  copyLink: 'Link kopieren',
  linkCopied: 'Link kopiert',
  general_copyFailed: 'Wir konnten den Link nicht kopieren',

  pk_flipbookNoOrders:
    'im Stil Flipbook zeigt die öffentliche Seite die Speisekarte wie ein Buch, ohne Warenkorb, ' +
    'daher können Gäste nicht zur Abholung bestellen. Für Bestellungen wählen Sie einen anderen ' +
    'Stil unter Einstellungen → Aussehen der Speisekarte → Anordnung der Produkte.',
  gm_tail: 'Gut für das Schaufenster, Flyer oder die Theke.',
  gm_flipbook: 'Gäste sehen die Speisekarte; {why} {tail}',
  gm_withPickup:
    'Gäste sehen die Speisekarte; mit aktiven Abholbestellungen können sie auch bestellen. {tail}',
  gm_plain: 'Gäste sehen die Speisekarte. {tail}',
  po_tail: 'Sie können jederzeit Tische hinzufügen, falls sich etwas ändert.',
  po_suspended:
    'Modus „Nur Abholung“ ausgesetzt: Ihr Tarif enthält keine Abholbestellungen, daher zeigt der ' +
    'Verwaltungsbereich Ihre Tische und Reservierungen. Über den allgemeinen QR-Code oben sehen ' +
    'Gäste die Speisekarte, ohne zur Abholung bestellen zu können. Die Einstellung bleibt ' +
    'gespeichert und gilt wieder, sobald Sie zum Tarif {plan} wechseln.',
  po_head: 'Modus „Nur Abholung“ aktiv — Sie brauchen keine Tische.',
  po_flipbook: '{head} Drucken Sie den allgemeinen QR-Code oben aus. Achtung: {why} {tail}',
  po_withPickup:
    '{head} Drucken Sie den allgemeinen QR-Code oben aus; Gäste bestellen und holen an der Theke ab. {tail}',
  po_plain: '{head} Drucken Sie den allgemeinen QR-Code oben aus. {tail}',

  summary: '{active} aktiv · {total} insgesamt',
  pdf_title: 'QR-Codes als PDF zum Drucken herunterladen',
  pdf_button: 'QR-Codes herunterladen',
  pdf_downloading: 'Wird heruntergeladen…',
  pdf_menuAria: 'Download-Formate für QR-Codes',
  pdf_grid: 'Raster — 6 / Seite',
  pdf_gridHint: 'Zum Aufkleben auf die Tische',
  pdf_tent: 'Klappkarten',
  pdf_tentHint: '4 / Seite, als Tischaufsteller',
  pdf_poster: 'A4-Poster',
  pdf_posterHint: '1 großer QR-Code / Seite',
  pdf_noActive: 'Kein aktiver Tisch mit QR-Code',
  pdf_done: 'PDF heruntergeladen',
  pdf_failed: 'Das PDF konnte nicht erstellt werden. Versuchen Sie es erneut.',
  pdf_noCards: 'Keine QR-Codes zum Drucken',

  pdf_buttonCount: { one: 'QR herunterladen ({n} Tisch)', other: 'QR herunterladen ({n} Tische)' },
  pdf_donePartial: {
    one: 'PDF heruntergeladen — {n} Tisch wurde ausgelassen',
    other: 'PDF heruntergeladen — {n} Tische wurden ausgelassen',
  },
  pdf_skippedNoQr: {
    one: '{n} Tisch ohne QR-Code ist nicht im PDF enthalten.',
    other: '{n} Tische ohne QR-Code sind nicht im PDF enthalten.',
  },
  pdf_skippedInactive: {
    one: '{n} inaktiver Tisch ist nicht im PDF enthalten.',
    other: '{n} inaktive Tische sind nicht im PDF enthalten.',
  },
  pdf_skipGenerate: 'Fehlende QR-Codes erstellen',
  pdf_skipGenerated: 'Die fehlenden QR-Codes wurden erstellt. Laden Sie das PDF erneut herunter.',
  sel_barAria: 'Ausgewählte Tische',
  sel_count: { one: '{n} Tisch ausgewählt', other: '{n} Tische ausgewählt' },
  sel_hint: 'Markieren Sie Tische, um sie zu drucken oder einem Bereich zuzuordnen.',
  sel_all: 'Alle auswählen ({n})',
  sel_clear: 'Auswahl aufheben',
  sel_rowAria: '{name} auswählen',
  sel_zone: 'Bereich auswählen',
  sel_zoneOff: 'Bereich abwählen',
  sel_zoneAria: 'Tische im Bereich {zone} auswählen',
  sel_zoneOffAria: 'Tische im Bereich {zone} abwählen',
  sel_setZone: 'Bereich festlegen…',
  sel_activate: 'Aktivieren',
  sel_deactivate: 'Deaktivieren',
  sel_activateAria: 'Ausgewählte Tische aktivieren',
  sel_deactivateAria: 'Ausgewählte Tische deaktivieren',
  sel_activated: { one: '{n} Tisch aktiviert', other: '{n} Tische aktiviert' },
  sel_deactivated: { one: '{n} Tisch deaktiviert', other: '{n} Tische deaktiviert' },
  sel_partial: 'Nur {done} von {total} Tischen wurden aktualisiert. Die Liste wurde neu geladen.',
  zoneBulk_title: { one: 'Bereich für {n} Tisch', other: 'Bereich für {n} Tische' },
  zoneBulk_label: 'Bereich',
  zoneBulk_hint: 'Lassen Sie das Feld leer, damit die Tische keinem Bereich zugeordnet sind.',
  zoneBulk_done: { one: 'Bereich für {n} Tisch festgelegt', other: 'Bereich für {n} Tische festgelegt' },
  zoneBulk_cleared: { one: 'Bereich von {n} Tisch entfernt', other: 'Bereich von {n} Tischen entfernt' },
  action_cardPdf: 'PDF-Karte',
  action_cardPdfAria: 'PDF-Karte für {name}',
  card_menuAria: 'Kartenformat für {name}',
  card_tent: 'Klappkarte',
  card_tentHint: 'Als Tischaufsteller',
  toast_cardDownloaded: 'PDF-Karte für {name} heruntergeladen',

  domain_previewTitle:
    'Technisches Detail: VITE_APP_URL ist nicht gesetzt — die Vorschau-URL wird verwendet.',
  domain_mismatchTitle: 'Technisches Detail: Die aktuelle Domain weicht von VITE_APP_URL ab.',
  domain_preview:
    'Achtung: Jetzt erstellte QR-Codes enthalten eine temporäre Testadresse, nicht die endgültige Adresse der Speisekarte. Drucken Sie sie noch nicht aus — wenden Sie sich an den Support, wenn Sie Hilfe brauchen.',
  domain_mismatch:
    'Sie sind auf einer anderen Adresse als der für die Speisekarte konfigurierten. Erstellte QR-Codes verwenden die konfigurierte Adresse, nicht die aktuelle.',

  bulk_titleEmpty: 'Sie haben noch keine Tische eingerichtet',
  bulk_title: 'QR-Codes für die Tische erstellen',
  bulk_descEmpty: 'Geben Sie die Anzahl der Tische ein, und Menuvia erstellt die QR-Codes automatisch.',
  bulk_desc:
    'Sagen Sie uns, wie viele Tische Sie haben, und Menuvia erstellt automatisch für jeden Tisch einen QR-Code.',
  bulk_placeholder: 'Wie viele Tische? z. B. 80',
  bulk_aria: 'Anzahl der Tische',
  bulk_busy: 'Wird erstellt…',
  bulk_btnEmpty: 'Tische und QR-Codes erstellen',
  bulk_btn: 'QR-Codes erstellen',
  bulk_footer: 'Sie können jeden QR-Code später bearbeiten, deaktivieren oder neu erstellen.',
  bulk_countRequired: 'Geben Sie die Anzahl der Tische ein (z. B. 80)',
  bulk_alreadyHave: {
    one: 'Sie haben bereits {n} Tisch eingerichtet',
    other: 'Sie haben bereits {n} Tische eingerichtet',
  },
  bulk_limit:
    'Ihr Tarif erlaubt bis zu {max} Tische / QR-Codes. Für mehr können Sie in einen höheren Tarif wechseln.',
  bulk_created: {
    one: '{n} Tisch erstellt, mit eigenem QR-Code',
    other: '{n} Tische erstellt, jeder mit eigenem QR-Code',
  },
  bulk_duplicate:
    'Einige Tische gibt es bereits — aktualisieren Sie die Liste und versuchen Sie es erneut.',
  bulk_failed: 'Die Tische konnten nicht erstellt werden. Versuchen Sie es erneut.',

  load_error: 'Wir konnten die Tische nicht laden',
  search_placeholder: 'Nach Namen suchen…',
  search_aria: 'Tisch nach Namen suchen',
  zone_filterAria: 'Nach Bereich filtern',
  zone_all: 'Alle Bereiche',
  noZone: 'Ohne Bereich',
  noMatches: 'Kein Tisch entspricht den Filtern.',
  seats: { one: '{n} Platz', other: '{n} Plätze' },
  inactive: 'Inaktiv',
  status_noQr: 'Kein QR-Code — tippen Sie auf „QR erstellen“',
  status_active: 'QR aktiv',
  status_disabled: 'QR deaktiviert',
  action_png: 'QR herunterladen (PNG)',
  action_regenerate: 'QR neu erstellen',
  action_generate: 'QR erstellen',
  action_deactivate: 'Deaktivieren',
  action_activate: 'Aktivieren',
  action_deactivateAria: 'Tisch deaktivieren',
  action_activateAria: 'Tisch aktivieren',
  action_delete: 'Tisch löschen',

  toast_verifyFailed:
    'Wir konnten die vorhandenen QR-Codes nicht prüfen. Die gedruckten bleiben gültig — versuchen Sie es erneut.',
  toast_tokensFailed: 'Fehler beim Erstellen der QR-Codes',
  toast_added: 'Tisch hinzugefügt',
  toast_updated: 'Tisch aktualisiert',
  toast_saveFailed: 'Fehler beim Speichern',
  toast_deleteFailed: 'Fehler beim Löschen',
  toast_deleted: 'Tisch gelöscht',
  toast_deactivated: 'Tisch deaktiviert',
  toast_activated: 'Tisch aktiviert',
  toast_updateFailed: 'Fehler beim Aktualisieren',
  toast_rotated: 'Neuer QR-Code erstellt',
  toast_rotateFailed: 'Fehler beim Erstellen des QR-Codes',
  toast_pngDownloaded: 'QR-Code für {name} heruntergeladen',
  toast_downloadFailed: 'Fehler beim Herunterladen',
  toast_copyFailed: 'Der Link konnte nicht kopiert werden',

  rotate_aria: 'QR-Code für {name} neu erstellen',
  rotate_title: 'QR neu erstellen — {name}',
  rotate_desc:
    'Der alte QR-Code funktioniert dann nicht mehr. Möchten Sie einen neuen für diesen Tisch erstellen?',
  rotate_confirm: 'Neu erstellen',
  delete_desc: 'Alle zugehörigen QR-Codes werden gelöscht. Bestehende Bestellungen sind nicht betroffen.',
}

export default de

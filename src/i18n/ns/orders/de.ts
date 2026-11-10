import type { Translation } from '../../core'
import type ro from './ro'

const de: Translation<typeof ro> = {
  money: '{amount} lei',
  tableLabel: 'Tisch {table}',
  noTable: 'Ohne Tisch',
  soldOut: 'Ausverkauft',
  saving: 'Wird gespeichert…',

  method_cash: 'Bar',
  method_card_pos: 'Karte (Terminal)',
  method_card_online: 'Online-Karte',
  method_meal_voucher: 'Essensgutschein',
  method_other: 'Andere Zahlungsart',

  cancel_title: 'Bestellung stornieren',
  cancel_errGeneric:
    'Die Stornierung wurde abgelehnt. Prüfen Sie Ihre Rolle oder den Grund und versuchen Sie es erneut.',
  cancel_blocked:
    'Für diese Bestellung wurden bereits {amount} lei kassiert; sie kann nicht direkt storniert werden.',
  cancel_voidHelp:
    'Wenn das Geld {returned} wurde, stornieren Sie die Zahlungen (mit Grund, wird im Audit-Protokoll erfasst) — dann wird die Bestellung storniert. Andernfalls schließen Sie sie mit einer Zahlung ab.',
  cancel_voidHelpReturned: 'dem Gast zurückgegeben',
  cancel_voidOnline: '{refund}, bevor Sie die Zahlungen stornieren.',
  cancel_voidOnlineRefund: 'Online-Zahlungen werden manuell in Stripe erstattet',
  cancel_reasonVoid: 'Grund (Pflicht für das Storno)',
  cancel_reasonServed: 'Grund (Pflicht — die Bestellung wurde serviert)',
  cancel_reasonOptional: 'Grund (optional)',
  cancel_reasonPlaceholder: 'z. B. Gast hat storniert, Produkt nicht verfügbar…',
  cancel_dismiss: 'Zurück',
  cancel_voiding: 'Zahlungen werden storniert…',
  cancel_voidAndCancel: 'Zahlungen und Bestellung stornieren',
  cancel_cancelling: 'Wird storniert…',

  cancelRej_overPayments:
    'Die Bestellung hat bereits kassierte Zahlungen und kann nicht storniert werden. Schließen Sie sie mit einer Zahlung ab.',
  cancelRej_reasonRequired: 'Für das Stornieren einer servierten Bestellung ist ein Grund erforderlich.',
  cancelRej_voidReasonRequired: 'Für das Stornieren einer Zahlung ist ein Grund erforderlich.',
  cancelRej_role:
    'Ihre Rolle erlaubt diese Aktion nicht (nur Inhaber oder Manager können Zahlungen oder Bestellungen stornieren).',
  cancelRej_terminal: 'Die Bestellung ist bereits abgeschlossen und kann nicht mehr storniert werden.',
  cancelRej_network: 'Keine Verbindung — die Stornierung wurde nicht gesendet. Bitte erneut versuchen.',

  actionError_dismiss: 'Meldung schließen',

  edit_title: 'Bestellung bearbeiten',
  edit_errMenuLoad: 'Die Speisekarte konnte nicht geladen werden',
  edit_errEmpty:
    'Die Bestellung muss mindestens 1 Produkt enthalten. Zum Stornieren nutzen Sie die Schaltfläche „Stornieren“ bei der Bestellung.',
  edit_errOrphan:
    'Die Bestellung enthält Produkte, die aus der Speisekarte gelöscht wurden (mit ⚠ markiert). Entfernen Sie sie oder bitten Sie den Inhaber, das Produkt vor dem Speichern wieder zu aktivieren.',
  edit_emptyCart:
    'Keine Produkte in der Bestellung. Fügen Sie mindestens eines hinzu oder stornieren Sie die Bestellung.',
  edit_orphanTitle: 'Aus der Speisekarte gelöscht',
  edit_orphanHint: 'Aus der Speisekarte gelöscht — nur entfernen',
  edit_addProduct: '+ Produkt hinzufügen',
  edit_newSubtotal: 'Neue Zwischensumme',
  edit_discountRecalc: '(der Rabatt von {amount} lei wird neu berechnet)',
  edit_saveChanges: 'Änderungen speichern',
  edit_pickProduct: 'Produkt auswählen',
  edit_noProducts: 'Keine Kategorie mit Produkten',

  edit_errNetwork: 'Keine Verbindung — die Änderung wurde nicht gespeichert. Bitte erneut versuchen.',
  edit_errConcurrent:
    'Jemand anderes hat die Bestellung inzwischen geändert. Schließen und öffnen Sie die Bestellung erneut und versuchen Sie es dann noch einmal.',
  edit_errOptionGroup:
    'Die gewählten Optionen erfüllen die Regeln einer Optionsgruppe des Produkts nicht. Prüfen Sie das Produkt und speichern Sie erneut.',
  edit_errWhoNamed: 'Das Produkt „{name}“',
  edit_errWhoUnknown: 'Ein Produkt der Bestellung',
  edit_errSoldOutNone:
    '{who} ist ausverkauft und kann nicht mehr hinzugefügt werden. Entfernen Sie es aus der Bestellung und speichern Sie erneut.',
  edit_errOffMenuNone:
    '{who} ist nicht mehr auf der Speisekarte und kann nicht mehr hinzugefügt werden. Entfernen Sie es aus der Bestellung und speichern Sie erneut.',
  edit_errSoldOutSome:
    '{who} ist inzwischen ausverkauft. {keep} Verringern Sie die Menge oder entfernen Sie es und speichern Sie erneut.',
  edit_errOffMenuSome:
    '{who} ist nicht mehr auf der Speisekarte. {keep} Verringern Sie die Menge oder entfernen Sie es und speichern Sie erneut.',
  edit_errKeepUpTo: 'Sie können höchstens die bereits bestellte Menge behalten ({n}).',
  edit_errKeepOnly: 'Sie können nur die bereits bestellte Menge behalten.',
  edit_errPartialPayments:
    'Für die Bestellung sind Zahlungen erfasst; sie kann nicht mehr bearbeitet werden.',
  edit_errTerminal: 'Die Bestellung ist bereits abgeschlossen und kann nicht mehr bearbeitet werden.',
  edit_errRole: 'Ihre Rolle erlaubt das Bearbeiten der Bestellung nicht.',
  edit_errNotFound: 'Die Bestellung existiert nicht mehr.',
  edit_errProductGone:
    'Ein Produkt der Bestellung ist auf der Speisekarte nicht mehr verfügbar. Entfernen Sie es und speichern Sie erneut.',
  edit_errOptionGone:
    'Eine gewählte Option ist nicht mehr verfügbar. Prüfen Sie das Produkt und speichern Sie erneut.',
  edit_errQuantity: 'Die Menge pro Zeile muss zwischen 1 und {max} liegen.',
  edit_errTooMany: 'Eine Bestellung kann höchstens 100 Produkte enthalten.',
  edit_errGeneric: 'Die Änderung wurde nicht gespeichert. Bitte erneut versuchen.',

  mod_addToOrder: 'Zur Bestellung hinzufügen — {amount} lei',
  mod_chooseExact: 'Genau {n} wählen',
  mod_chooseBetween: 'Zwischen {min} und {max} wählen',
  mod_chooseAtLeast: 'Mindestens {n} wählen',
  mod_max: 'Höchstens {n}',
  mod_extras: 'Extras',
  mod_quantity: 'Menge',
  mod_notesPlaceholder: 'Hinweise (optional)',
  mod_missing: 'Bitte wählen: {group}',

  audit_title: 'Bestellverlauf',
  audit_errLoad: 'Fehler beim Laden',
  audit_empty: 'Für diese Bestellung wurden noch keine Ereignisse erfasst.',
  audit_system: 'System',
  audit_ev_created: 'Hat die Bestellung erstellt',
  audit_ev_deleted: 'Hat die Bestellung gelöscht',
  audit_ev_confirmed: 'Hat die Bestellung bestätigt',
  audit_ev_preparing: 'Hat sie in die Zubereitung gegeben',
  audit_ev_ready: 'Hat sie als fertig markiert',
  audit_ev_served: 'Hat sie als serviert markiert',
  audit_ev_closed: 'Hat den Tisch abgeschlossen (ohne Fiskalbeleg)',
  audit_ev_paid: 'Hat die Zahlung kassiert',
  audit_ev_cancelled: 'Hat die Bestellung storniert',
  audit_ev_status: 'Status → {status}',
  audit_ev_discount: 'Hat den Rabatt geändert',
  audit_ev_total: 'Hat die Summe neu berechnet',
  audit_ev_modified: 'Hat die Bestellung geändert',
  audit_ev_itemsChanged: 'Hat die Bestellung geändert ({items}{total})',
  audit_itemsCount: { one: '{from} → {n} Produkt', other: '{from} → {n} Produkte' },
  audit_itemsUnknown: 'Produkte',
  audit_totalPart: ' · Summe {amount} lei',
  audit_ev_itemAdded: 'Hat {product} × {qty} hinzugefügt',
  audit_ev_itemDeleted: 'Hat {product} × {qty} entfernt',
  audit_productFallback: 'Produkt',
  audit_ev_itemModified: 'Hat ein Produkt geändert',

  ready_serve: 'Serviert',

  pickup_at: 'Abholung um {time}',

  card_status_new: 'Neu',
  card_status_confirmed: 'Bestätigt',
  card_status_preparing: 'In Zubereitung',
  card_status_ready: 'Bereit zum Servieren',
  card_status_served: 'Serviert',
  card_status_closed: 'Abgeschlossen',
  card_status_paid: 'Bezahlt',
  card_status_cancelled: 'Storniert',
  card_srcPickup: 'Abholung',
  card_srcManual: 'Manuell',
  card_late: 'verspätet',
  card_takenBy: 'Aufgenommen von: {name}',
  card_servedBy: 'Serviert von: {name}',
  card_reprint: 'In der Küche neu drucken',
  card_cancel: 'Stornieren',
  card_history: 'Verlauf ansehen',
  card_payFull: 'Vollständige Zahlung',
  card_payPartial: 'Teilzahlung',
  card_closeOrder: 'Bestellung abschließen',
  card_closeTable: 'Tisch abschließen',
  card_cashRegisterNote: 'Zahlung und Beleg laufen über Ihre bestehende Kasse',
  card_planChecking: 'Der Tarif des Restaurants wird geprüft — der Abschluss der Bestellung ist gleich wieder verfügbar.',
  card_closeEarlyTitle: 'Bestellung abschließen, bevor sie serviert wurde?',
  card_closeEarlyDesc:
    'Die Bestellung wird als abgeschlossen markiert (der Bestand wird abgezogen und Treuepunkte werden vergeben). Wurde sie nicht ausgeführt, nutzen Sie „Stornieren“.',
  card_closeTableTitle: 'Tisch abschließen?',
  card_closeTableDesc: '{note} Zahlung und Beleg laufen über die Kasse des Lokals.',
  card_closeTableUnknown:
    'Servierte Bestellungen werden abgeschlossen; noch nicht servierte (neu oder in Zubereitung) werden storniert.',
  card_closeTableAll: 'Alle offenen Bestellungen dieses Tisches und seine Sitzung werden abgeschlossen.',
  card_closeTableUnserved: {
    one: 'Servierte Bestellungen werden abgeschlossen; {n} nicht servierte Runde (neu oder in Zubereitung) wird STORNIERT.',
    other:
      'Servierte Bestellungen werden abgeschlossen; {n} nicht servierte Runden (neu oder in Zubereitung) werden STORNIERT.',
  },

  step_preparing: 'In Zubereitung setzen',
  step_ready: 'Fertig',
  step_served: 'Serviert',

  entry_errMenu: 'Die Speisekarte konnte nicht geladen werden. Prüfen Sie die Verbindung.',
  entry_errTables: 'Die Tische konnten nicht geladen werden. Prüfen Sie die Verbindung.',
  entry_errStill: 'Klappt noch nicht. Prüfen Sie die Internetverbindung.',
  entry_errNotSent: 'Die Bestellung wurde nicht gesendet. Bitte erneut versuchen.',
  entry_errMissingGroup:
    'Bei einem Produkt im Warenkorb fehlt die Auswahl in einer Pflicht-Optionsgruppe.',
  entry_errSoldOut:
    'Ein Produkt im Warenkorb ist inzwischen ausverkauft. Entfernen Sie es und senden Sie erneut.',
  entry_errProductGone:
    'Ein Produkt im Warenkorb ist nicht mehr auf der Speisekarte. Entfernen Sie es und senden Sie erneut.',
  entry_errOptions:
    'Eine Option oder ein Extra im Warenkorb ist nicht mehr verfügbar. Fügen Sie das Produkt erneut hinzu.',
  entry_errQuantity: 'Die Menge pro Zeile muss zwischen 1 und {max} liegen.',
  entry_errTooMany: 'Die Bestellung enthält zu viele Produkte.',
  entry_errNotesTooLong: 'Die Hinweise sind zu lang.',
  entry_errOrderingOff: 'Das Restaurant nimmt gerade keine Bestellungen an.',
  entry_discardTitle: 'Begonnene Bestellung verwerfen?',
  entry_discardDesc: {
    one: '{n} Produkt im Warenkorb geht verloren. Die Bestellung wurde NICHT an die Küche gesendet.',
    other:
      '{n} Produkte im Warenkorb gehen verloren. Die Bestellung wurde NICHT an die Küche gesendet.',
  },
  entry_discardConfirm: 'Bestellung verwerfen',
  entry_discardKeep: 'Bestellung fortsetzen',
  entry_selectTable: 'Tisch auswählen',
  entry_closeAria: 'Neue Bestellung schließen',
  entry_cartCount: 'Warenkorb ({n})',
  entry_cart: 'Warenkorb',
  entry_total: 'Summe: {amount} lei',
  entry_notesPlaceholder: 'Hinweise zur Bestellung (optional)',
  entry_sending: 'Wird gesendet…',
  entry_send: 'Bestellung senden',
}

export default de

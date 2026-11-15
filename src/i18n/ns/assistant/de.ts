import type { Translation } from '../../core'
import type ro from './ro'

// Sie; KI-Assistent (wie `dashboard.nav_ai`); Speisekarte = Menü;
// ausverkauft / verfügbar wie `products`; Schaltflächen im Infinitiv. Die
// `err_ai*`-Texte sind GENAU die aus `imports`.
const de: Translation<typeof ro> = {
  fab_open: 'KI-Assistenten öffnen',
  title: 'KI-Assistent',
  intro:
    'Hallo! Ich bin Ihr Assistent. Ich kann Fragen beantworten und Änderungen an der QR-Speisekarte vorschlagen.',
  intro_try: 'Probieren Sie: {ex1} oder {ex2}.',
  intro_ex1: '„Pizza Margherita für 32 lei hinzufügen“',
  intro_ex2: '„Tiramisu als ausverkauft markieren“',
  typing: 'Der Assistent schreibt…',
  input_placeholder: 'Nachricht schreiben…',
  send_aria: 'Nachricht senden',
  no_reply: '(keine Antwort)',
  err_chat: 'Fehler beim KI-Assistenten.',
  err_aiQuota:
    'Der KI-Assistent hat zu viele Anfragen erhalten oder das Kontingent ist aufgebraucht. Versuchen Sie es später erneut.',
  err_aiSession: 'Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an.',
  err_aiForbidden: 'Sie dürfen den KI-Assistenten für dieses Restaurant nicht verwenden.',
  err_aiUnavailable: 'Der KI-Assistent ist für dieses Restaurant gerade nicht verfügbar.',
  err_aiBusy: 'Der KI-Assistent konnte gerade nicht antworten. Versuchen Sie es in einigen Augenblicken erneut.',
  action_create_product: 'Produkt hinzufügen',
  action_update_product: 'Produkt bearbeiten',
  action_toggle_sold_out: 'Verfügbarkeit des Produkts',
  action_create_category: 'Kategorie hinzufügen',
  status_applied: '· übernommen ✓',
  status_rejected: '· abgelehnt',
  status_error: '· Fehler',
  field_name: 'Name',
  field_price: 'Preis (lei)',
  field_emoji: 'Emoji',
  field_category: 'Kategorie',
  no_category: '(ohne Kategorie)',
  field_categoryName: 'Name der Kategorie',
  soldOut_sentence: '{product} als {state} markieren.',
  product_quoted: '„{name}“',
  state_soldOut: 'AUSVERKAUFT',
  state_available: 'VERFÜGBAR',
  product_label: 'Produkt: {name}',
  confirm: 'Bestätigen',
  reject: 'Ablehnen',
}

export default de

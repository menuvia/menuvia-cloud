import type { Translation } from '../../core'
import type ro from './ro'

// Sie; KI-Assistent (wie `dashboard.nav_ai`); Schaltflächen im Infinitiv.
const de: Translation<typeof ro> = {
  loading: 'Wird geladen…',
  intro:
    'Aktivieren Sie den KI-Assistenten, um den Chatbot im Verwaltungsbereich und den Speisekarten-Import aus Fotos ' +
    'zu nutzen. Sie brauchen keine technische Einrichtung — der Schlüssel wird von Menuvia verwaltet.',
  quota_title: 'Verbrauch in diesem Monat',
  quota_included: '/ {n} inklusive',
  quota_credits: '+ {n} Credits',
  quota_exhausted:
    'Sie haben das inklusive Kontingent aufgebraucht. Kaufen Sie unten Guthaben, um fortzufahren.',
  load_error:
    'Wir konnten die gespeicherte KI-Konfiguration nicht lesen. Damit wir sie nicht durch die Standardwerte ' +
    'ersetzen (und der gespeicherte API-Schlüssel verloren geht), ist das Speichern gesperrt, bis wir sie ' +
    'lesen können.',
  enable: 'KI-Assistenten für dieses Restaurant aktivieren',
  enable_desc:
    'Der Assistent ist für Ihr Konto standardmäßig aktiv — der Schlüssel wird von Menuvia verwaltet, Sie ' +
    'brauchen keine technische Einrichtung.',
  enable_quota: 'Sie haben {n} Tokens pro Monat inklusive.',
  advanced: 'Erweitert (optional)',
  advanced_desc: 'Nur wenn Sie einen eigenen Schlüssel / einen anderen Anbieter nutzen möchten.',
  provider: 'Anbieter',
  provider_openai: 'OpenAI',
  provider_anthropic: 'Anthropic (Claude)',
  provider_gemini: 'Google Gemini',
  provider_custom: 'Benutzerdefiniert (OpenAI-kompatibel)',
  hint_openai: 'Schlüssel von platform.openai.com (beginnt mit sk-…)',
  hint_anthropic: 'Schlüssel von console.anthropic.com',
  hint_gemini: 'Schlüssel von aistudio.google.com',
  hint_custom: 'Beliebiger OpenAI-kompatibler Endpoint (z. B. selbst gehostet, OpenRouter)',
  model: 'Modell',
  model_placeholder: 'z. B. {examples}',
  baseUrl: 'Endpoint-URL (https)',
  baseUrl_placeholder: 'https://api.beispiel.de/v1',
  apiKey: 'API-Schlüssel',
  apiKey_saved: '· gespeichert ✓',
  apiKey_placeholderSaved: '•••••••• (leer lassen, um den Schlüssel zu behalten)',
  apiKey_placeholderEmpty: 'Leer lassen für den Menuvia-Schlüssel',
  err_customUrl: 'Der benutzerdefinierte Anbieter braucht eine https-URL.',
  err_customKey: 'Der benutzerdefinierte Anbieter braucht einen API-Schlüssel.',
  saved_byo: 'Konfiguration gespeichert. Ihr Schlüssel ist verschlüsselt und sicher.',
  saved_platform: 'Konfiguration gespeichert. Der Schlüssel wird von Menuvia verwaltet.',
  err_save: 'Speichern fehlgeschlagen.',
  err_buy: 'Wir konnten die Zahlung nicht starten.',
  readonly_note:
    'Im Gründermodus sehen Sie die Konfiguration, aber speichern kann sie nur das Team des Restaurants, aus ' +
    'dem eigenen Konto.',
  saving: 'Wird gespeichert…',
  save: 'Konfiguration speichern',
  credits_title: 'Zusätzliches Guthaben',
  credits_desc:
    'Inklusives Kontingent überschritten? Kaufen Sie zusätzliche Tokens, die nicht verfallen.',
  pack_tokens: '{n} Tokens',
  opening: 'Wird geöffnet…',
  buy: 'Kaufen',

  err_network:
    'Wir konnten den Server nicht erreichen. Prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.',
  err_auth: 'Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an.',
  err_forbidden: 'Sie dürfen den KI-Assistenten für dieses Restaurant nicht nutzen.',
  err_rate_limited:
    'Zu viele Anfragen an den KI-Assistenten. Warten Sie kurz und versuchen Sie es erneut.',
  err_unavailable:
    'Der Dienst ist derzeit nicht verfügbar. Versuchen Sie es in einigen Augenblicken erneut.',
  err_model_missing: 'Wählen Sie ein Modell.',
  err_base_url:
    'Die Endpoint-URL wird nicht akzeptiert. Verwenden Sie eine öffentliche https-Adresse.',
  err_api_key_invalid: 'Der API-Schlüssel ist ungültig.',
  err_api_key_required: 'Der benutzerdefinierte Anbieter braucht einen API-Schlüssel.',
  err_checkout_failed:
    'Wir konnten die Zahlung nicht starten. Versuchen Sie es in einigen Augenblicken erneut.',
}

export default de

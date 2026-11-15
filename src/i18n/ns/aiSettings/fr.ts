import type { Translation } from '../../core'
import type ro from './ro'

// vous ; assistant IA (comme `dashboard.nav_ai`).
const fr: Translation<typeof ro> = {
  loading: 'Chargement…',
  intro:
    'Activez l’assistant IA pour utiliser le chatbot de votre espace et l’import de menu à partir de ' +
    'photos. Aucune configuration technique n’est nécessaire — la clé est gérée par Menuvia.',
  quota_title: 'Consommation ce mois-ci',
  quota_included: '/ {n} inclus',
  quota_credits: '+ {n} crédits',
  quota_exhausted:
    'Vous avez épuisé le quota inclus. Achetez des crédits ci-dessous pour continuer.',
  load_error:
    'Nous n’avons pas pu lire la configuration IA enregistrée. Pour ne pas la remplacer par les valeurs ' +
    'par défaut (et ne pas perdre la clé API enregistrée), l’enregistrement est bloqué jusqu’à ce que nous ' +
    'puissions la lire.',
  enable: 'Activer l’assistant IA pour ce restaurant',
  enable_desc:
    'L’assistant est actif par défaut pour votre compte — la clé est gérée par Menuvia, aucune ' +
    'configuration technique n’est nécessaire.',
  enable_quota: 'Vous disposez de {n} tokens inclus par mois.',
  advanced: 'Avancé (facultatif)',
  advanced_desc: 'Uniquement si vous voulez utiliser votre propre clé / un autre fournisseur.',
  provider: 'Fournisseur',
  provider_openai: 'OpenAI',
  provider_anthropic: 'Anthropic (Claude)',
  provider_gemini: 'Google Gemini',
  provider_custom: 'Personnalisé (compatible OpenAI)',
  hint_openai: 'Clé obtenue sur platform.openai.com (commence par sk-…)',
  hint_anthropic: 'Clé obtenue sur console.anthropic.com',
  hint_gemini: 'Clé obtenue sur aistudio.google.com',
  hint_custom: 'Tout endpoint compatible OpenAI (ex. auto-hébergé, OpenRouter)',
  model: 'Modèle',
  model_placeholder: 'ex. {examples}',
  baseUrl: 'URL de l’endpoint (https)',
  baseUrl_placeholder: 'https://api.exemple.fr/v1',
  apiKey: 'Clé API',
  apiKey_saved: '· enregistrée ✓',
  apiKey_placeholderSaved: '•••••••• (laissez vide pour conserver la clé)',
  apiKey_placeholderEmpty: 'Laissez vide pour utiliser la clé Menuvia',
  err_customUrl: 'Le fournisseur personnalisé a besoin d’une URL https.',
  err_customKey: 'Le fournisseur personnalisé a besoin d’une clé API.',
  saved_byo: 'Configuration enregistrée. Votre clé est chiffrée et sécurisée.',
  saved_platform: 'Configuration enregistrée. La clé est gérée par Menuvia.',
  err_save: 'Échec de l’enregistrement.',
  err_buy: 'Nous n’avons pas pu lancer le paiement.',
  readonly_note:
    'En mode fondateur, vous voyez la configuration, mais seule l’équipe du restaurant peut l’enregistrer, ' +
    'depuis son propre compte.',
  saving: 'Enregistrement…',
  save: 'Enregistrer la configuration',
  credits_title: 'Crédits supplémentaires',
  credits_desc:
    'Vous avez dépassé le quota inclus ? Achetez des tokens supplémentaires qui n’expirent pas.',
  pack_tokens: '{n} tokens',
  opening: 'Ouverture…',
  buy: 'Acheter',

  err_network:
    'Nous n’avons pas pu joindre le serveur. Vérifiez votre connexion internet et réessayez.',
  err_auth: 'Votre session a expiré. Reconnectez-vous.',
  err_forbidden: 'Vous n’avez pas le droit d’utiliser l’assistant IA pour ce restaurant.',
  err_rate_limited: 'Trop de demandes envoyées à l’assistant IA. Patientez un peu et réessayez.',
  err_unavailable:
    'Le service n’est pas disponible pour le moment. Réessayez dans quelques instants.',
  err_model_missing: 'Choisissez un modèle.',
  err_base_url: 'L’URL de l’endpoint n’est pas acceptée. Utilisez une adresse https publique.',
  err_api_key_invalid: 'La clé API n’est pas valide.',
  err_api_key_required: 'Le fournisseur personnalisé a besoin d’une clé API.',
  err_checkout_failed: 'Nous n’avons pas pu lancer le paiement. Réessayez dans quelques instants.',
}

export default fr

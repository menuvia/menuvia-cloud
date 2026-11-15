import type { Translation } from '../../core'
import type ro from './ro'

// AI assistant = AI assistant (as `dashboard.nav_ai`); “dashboard” for the panel.
const en: Translation<typeof ro> = {
  loading: 'Loading…',
  intro:
    'Turn on the AI assistant to use the chatbot in the dashboard and menu import from photos. You don’t ' +
    'need any technical setup — the key is managed by Menuvia.',
  quota_title: 'Usage this month',
  quota_included: '/ {n} included',
  quota_credits: '+ {n} credits',
  quota_exhausted: 'You’ve used up the included quota. Buy credits below to continue.',
  load_error:
    'We couldn’t read the saved AI configuration. So we don’t replace it with the default values (and lose ' +
    'the saved API key), saving is blocked until we can read it.',
  enable: 'Turn on the AI assistant for this restaurant',
  enable_desc:
    'The assistant is on by default for your account — the key is managed by Menuvia, you don’t need any ' +
    'technical setup.',
  enable_quota: 'You have {n} tokens included per month.',
  advanced: 'Advanced (optional)',
  advanced_desc: 'Only if you want to use your own key / another provider.',
  provider: 'Provider',
  provider_openai: 'OpenAI',
  provider_anthropic: 'Anthropic (Claude)',
  provider_gemini: 'Google Gemini',
  provider_custom: 'Custom (OpenAI-compatible)',
  hint_openai: 'Key from platform.openai.com (starts with sk-…)',
  hint_anthropic: 'Key from console.anthropic.com',
  hint_gemini: 'Key from aistudio.google.com',
  hint_custom: 'Any OpenAI-compatible endpoint (e.g. self-hosted, OpenRouter)',
  model: 'Model',
  model_placeholder: 'e.g. {examples}',
  baseUrl: 'Endpoint URL (https)',
  baseUrl_placeholder: 'https://api.example.com/v1',
  apiKey: 'API key',
  apiKey_saved: '· saved ✓',
  apiKey_placeholderSaved: '•••••••• (leave empty to keep the key)',
  apiKey_placeholderEmpty: 'Leave empty to use the Menuvia key',
  err_customUrl: 'The custom provider needs an https URL.',
  err_customKey: 'The custom provider needs an API key.',
  saved_byo: 'Configuration saved. Your key is encrypted and secure.',
  saved_platform: 'Configuration saved. The key is managed by Menuvia.',
  err_save: 'Couldn’t save.',
  err_buy: 'We couldn’t start the payment.',
  readonly_note:
    'In founder mode you can see the configuration, but only the restaurant’s team can save it, from their own account.',
  saving: 'Saving…',
  save: 'Save configuration',
  credits_title: 'Extra credits',
  credits_desc: 'Gone over the included quota? Buy extra tokens that don’t expire.',
  pack_tokens: '{n} tokens',
  opening: 'Opening…',
  buy: 'Buy',

  err_network: 'We couldn’t reach the server. Check your internet connection and try again.',
  err_auth: 'Your session has expired. Sign in again.',
  err_forbidden: 'You don’t have permission to use the AI assistant for this restaurant.',
  err_rate_limited: 'Too many requests to the AI assistant. Wait a moment and try again.',
  err_unavailable: 'The service isn’t available right now. Try again in a few moments.',
  err_model_missing: 'Choose a model.',
  err_base_url: 'The endpoint URL isn’t accepted. Use a public https address.',
  err_api_key_invalid: 'The API key isn’t valid.',
  err_api_key_required: 'The custom provider needs an API key.',
  err_checkout_failed: 'We couldn’t start the payment. Try again in a few moments.',
}

export default en

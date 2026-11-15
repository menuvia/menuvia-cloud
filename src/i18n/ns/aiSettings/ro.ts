// Namespace `aiSettings` — fila Asistent AI (lotul L6b): AiSettingsTab cu
// introducerea, consumul lunii, comutatorul, secțiunea „Avansat (opțional)”
// (furnizorii, modelul, endpoint-ul, cheia API), mesajele de salvare și
// pachetele de credite.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — „...” cu TREI puncte („Se
// încarcă...”, „Se salvează...”, „Se deschide...”; deci NU „Se încarcă…” din
// `common`), „tokens” (cuvântul englezesc, ca înainte), „· salvată ✓”.
// Erorile serverului: în română textul românesc al funcțiilor AI se afișează
// ca atare (`describeStaffError` = `toUserMessage`); în altă limbă se alege
// după `code` (`err_<code>`, contractul `{ error, code }` din
// netlify/functions/lib/aiErrors.js), altfel rezerva contextului.
// NU e aici (din `common`): „Reîncearcă”.
// NU se traduc (date): numele mărcilor (OpenAI, Anthropic, Google Gemini),
// numele modelelor, domeniile furnizorilor, prețurile pachetelor (bani, „19
// lei” ca azi). Numerele (tokens, credite) se formatează în limba personalului
// (în română `toLocaleString('ro-RO')`, ca înainte).
const ro = {
  loading: 'Se încarcă...',
  intro:
    'Activează asistentul AI ca să folosești chatbot-ul din panou și importul de meniu din poze. Nu ai ' +
    'nevoie de nicio configurare tehnică — cheia e gestionată de Menuvia.',
  quota_title: 'Consum luna aceasta',
  quota_included: '/ {n} incluse',
  quota_credits: '+ {n} credite',
  quota_exhausted: 'Ai consumat cota inclusă. Cumpără credite mai jos ca să continui.',
  load_error:
    'Nu am putut citi configurația AI salvată. Ca să nu o înlocuim cu valorile implicite (și să nu se ' +
    'piardă cheia API salvată), salvarea e blocată până o citim.',
  enable: 'Activează asistentul AI pentru acest restaurant',
  enable_desc:
    'Asistentul e activ implicit pentru contul tău — cheia e gestionată de Menuvia, nu ai nevoie de ' +
    'nicio configurare tehnică.',
  enable_quota: 'Ai {n} tokens incluși pe lună.',
  advanced: 'Avansat (opțional)',
  advanced_desc: 'Doar dacă vrei să folosești propria cheie / alt furnizor.',
  provider: 'Furnizor',
  provider_openai: 'OpenAI',
  provider_anthropic: 'Anthropic (Claude)',
  provider_gemini: 'Google Gemini',
  provider_custom: 'Personalizat (OpenAI-compatible)',
  hint_openai: 'Cheie de la platform.openai.com (începe cu sk-…)',
  hint_anthropic: 'Cheie de la console.anthropic.com',
  hint_gemini: 'Cheie de la aistudio.google.com',
  hint_custom: 'Orice endpoint compatibil OpenAI (ex. self-hosted, OpenRouter)',
  model: 'Model',
  model_placeholder: 'ex. {examples}',
  baseUrl: 'URL endpoint (https)',
  baseUrl_placeholder: 'https://api.exemplu.ro/v1',
  apiKey: 'Cheie API',
  apiKey_saved: '· salvată ✓',
  apiKey_placeholderSaved: '•••••••• (lasă gol pentru a păstra cheia)',
  apiKey_placeholderEmpty: 'Lasă gol pentru cheia Menuvia',
  err_customUrl: 'Furnizorul personalizat are nevoie de un URL https.',
  err_customKey: 'Furnizorul personalizat are nevoie de o cheie API.',
  saved_byo: 'Configurație salvată. Cheia ta este criptată și securizată.',
  saved_platform: 'Configurație salvată. Cheia este gestionată de Menuvia.',
  err_save: 'Eroare la salvare.',
  err_buy: 'Nu am putut porni plata.',
  readonly_note:
    'În modul fondator vezi configurația, dar o poate salva doar echipa restaurantului, din contul ei.',
  saving: 'Se salvează...',
  save: 'Salvează configurația',
  credits_title: 'Credite suplimentare',
  credits_desc: 'Ai depășit cota inclusă? Cumpără tokens suplimentari care nu expiră.',
  pack_tokens: '{n} tokens',
  opening: 'Se deschide...',
  buy: 'Cumpără',

  // ── Doar în celelalte limbi: `code`-urile funcțiilor ai-config /
  //    ai-credits-checkout (în română serverul își trimite textul) ──
  err_network: 'Nu am putut contacta serverul. Verifică internetul și reîncearcă.',
  err_auth: 'Sesiunea a expirat. Intră din nou în cont.',
  err_forbidden: 'Nu ai drepturi să folosești asistentul AI pentru acest restaurant.',
  err_rate_limited: 'Prea multe cereri către asistentul AI. Așteaptă puțin și reîncearcă.',
  err_unavailable: 'Serviciul nu e disponibil momentan. Reîncearcă în câteva momente.',
  err_model_missing: 'Alege un model.',
  err_base_url: 'URL-ul endpoint-ului nu e acceptat. Folosește o adresă publică https.',
  err_api_key_invalid: 'Cheia API nu e validă.',
  err_api_key_required: 'Furnizorul personalizat are nevoie de o cheie API.',
  err_checkout_failed: 'Nu am putut porni plata. Reîncearcă în câteva momente.',
}

export default ro

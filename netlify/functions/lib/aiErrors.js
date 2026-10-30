// netlify/functions/lib/aiErrors.js
// Contractul de EROARE al funcțiilor AI (ai-proxy, ai-config,
// ai-generate-image, ai-credits-checkout): orice răspuns non-200 e
//   { error: <mesaj în română, scris pentru patron>, code: <cod stabil> }
//
// De ce există: cele patru funcții întorceau un amestec de engleză internă
// („Forbidden", „Invalid or expired token", „AI provider request failed",
// „Could not verify AI quota") și română, aproape totul FĂRĂ cod — iar
// clientul (src/lib/ai.ts) afișa `error` ca atare. Patronul vedea „Forbidden"
// în toast, iar AiBulkGenerate nu putea deosebi o eroare de configurare (care
// se repetă la FIECARE produs) de una a unui singur produs.
//
// Mesajele stau AICI, într-un singur loc; `code` e contractul (testele și
// clientul decid pe cod, nu pe text — textul se poate rescrie liber).
// Clichetul din tests/functions/ai-error-contract.test.js cere ca:
//   • fiecare mesaj să fie în română (diacritice) și fără termeni interni;
//   • fiecare răspuns non-200 al celor patru funcții să treacă pe aici.
'use strict'

const AI_ERROR_MESSAGES = {
  method_not_allowed: 'Cererea nu e permisă (doar POST).',
  server_config: 'Asistentul AI nu e pornit pe server momentan. Încearcă mai târziu sau scrie-ne.',
  auth_missing: 'Nu ești autentificat. Intră din nou în cont.',
  auth_invalid: 'Sesiunea a expirat. Intră din nou în cont.',
  bad_json: 'Cererea nu a putut fi citită. Reîncearcă.',
  missing_restaurant: 'Lipsește restaurantul din cerere.',
  invalid_feature: 'Funcția AI cerută nu există.',
  missing_messages: 'Cererea către asistent e goală.',
  payload_too_large: 'Pozele trimise sunt prea mari (maximum 8 MB în total). Încearcă cu mai puține poze sau cu poze mai mici.',
  forbidden: 'Nu ai drepturi să folosești asistentul AI pentru acest restaurant.',
  config_load_failed: 'Nu am putut citi setările asistentului AI. Reîncearcă.',
  config_save_failed: 'Nu am putut salva setările asistentului AI. Reîncearcă.',
  ai_disabled: 'Asistentul AI e dezactivat pentru acest restaurant. Îl pornești din Setări → Asistent AI.',
  provider_key_missing: 'Asistentul AI nu e configurat pentru acest furnizor. Adaugă o cheie în Setări → Asistent AI → Avansat.',
  key_load_failed: 'Nu am putut încărca cheia API salvată. Salveaz-o din nou în Setări → Asistent AI.',
  model_missing: 'Lipsește modelul în setările asistentului AI.',
  invalid_provider: 'Furnizorul AI ales nu există. Alege OpenAI, Anthropic, Gemini sau Personalizat.',
  base_url_required: 'Furnizorul personalizat cere o adresă https.',
  base_url_rejected: 'Adresa furnizorului AI personalizat nu e permisă. Verifică setările.',
  api_key_invalid: 'Cheia API trebuie să fie text.',
  api_key_too_long: 'Cheia API e prea lungă.',
  api_key_required: 'Furnizorul personalizat are nevoie de o cheie API înainte să-l activezi.',
  quota_check_failed: 'Nu am putut verifica cota AI. Reîncearcă în câteva momente.',
  quota_exceeded: 'Ai atins limita de tokens AI inclusă. Cumpără credite suplimentare ca să continui.',
  provider_timeout: 'Furnizorul AI a răspuns prea greu. Reîncearcă; la importul de meniu, încearcă cu mai puține poze.',
  provider_failed: 'Furnizorul AI nu a putut răspunde acum. Reîncearcă în câteva momente.',
  provider_no_images: 'Generarea de imagini merge doar cu OpenAI sau Gemini. Schimbă furnizorul în Setări → Asistent AI.',
  missing_product: 'Lipsește produsul din cerere.',
  missing_product_name: 'Produsul are nevoie de un nume ca să-i generăm imaginea.',
  image_failed: 'Generarea imaginii a eșuat la furnizor. Reîncearcă.',
  image_save_failed: 'Imaginea s-a generat, dar nu am putut-o salva. Reîncearcă.',
  product_not_found: 'Produsul nu a fost găsit.',
  product_update_failed: 'Imaginea s-a generat, dar nu am putut-o atașa produsului. Reîncearcă.',
  invalid_pack: 'Pachetul de credite ales nu există.',
  service_unavailable: 'Serviciu temporar indisponibil. Reîncearcă în câteva momente.',
}

/**
 * Răspunsul de eroare al unei funcții AI. `detail` (opțional, deja în română
 * sau un motiv tehnic scurt) se adaugă în paranteză — ex. motivul exact pentru
 * care adresa unui furnizor personalizat a fost respinsă.
 */
function aiError(statusCode, code, detail) {
  const base = AI_ERROR_MESSAGES[code]
  if (!base) throw new Error(`aiError: cod necunoscut „${code}" — adaugă-l în AI_ERROR_MESSAGES`)
  const error = detail ? `${base} (${String(detail).slice(0, 200)})` : base
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error, code }),
  }
}

/** Un timeout al lui AbortSignal.timeout() — furnizorul n-a răspuns la timp. */
function isTimeoutError(e) {
  return !!e && (e.name === 'TimeoutError' || e.name === 'AbortError')
}

module.exports = { AI_ERROR_MESSAGES, aiError, isTimeoutError }

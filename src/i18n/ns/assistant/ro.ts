// Namespace `assistant` — asistentul AI din panou (lotul L7): AiChatbot cu
// butonul flotant, antetul, mesajul de bun venit și exemplele de întrebări,
// indicatorul „scrie”, câmpul de mesaj, erorile și cardurile de acțiune
// propuse (tipul acțiunii, starea, câmpurile editabile, „Confirmă” /
// „Respinge”).
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — „…” (Unicode) în „Scrie un mesaj…” și
// „Asistentul scrie…”, ghilimeaua DREAPTĂ de închidere în exemple și în numele
// produsului („„Adaugă o pizza Margherita la 32 lei"”, „„Tiramisu"”),
// majusculele „STOC EPUIZAT” / „DISPONIBIL”, „· aplicat ✓”.
// Refuzurile AI (`err_ai*`) au EXACT textele din `imports`/`translations`
// (testul XA6): `describeAiError` din lib/translationMessages.ts le alege după
// `code` în celelalte limbi; în română rămâne textul serverului
// (`toUserMessage`, ca înainte).
// NU se traduc: PROMPT-ul trimis modelului și răspunsurile lui (lib/aiChatPrompt.ts
// — text pentru model, cere explicit răspunsuri în română; reziduu consemnat),
// numele produselor și ale categoriilor (date), emoji-urile.
// NU e aici (din `common`): „Închide”, clasele de erori.
const ro = {
  fab_open: 'Deschide asistentul AI',
  title: 'Asistent AI',
  intro: 'Salut! Sunt asistentul tău. Pot răspunde la întrebări și pot propune modificări pe meniul QR.',
  // {ex1}/{ex2} = exemplele, în <em>.
  intro_try: 'Încearcă: {ex1} sau {ex2}.',
  intro_ex1: '„Adaugă o pizza Margherita la 32 lei"',
  intro_ex2: '„Marchează Tiramisu ca epuizat"',
  typing: 'Asistentul scrie…',
  input_placeholder: 'Scrie un mesaj…',
  send_aria: 'Trimite mesajul',
  no_reply: '(fără răspuns)',
  err_chat: 'Eroare la asistentul AI.',
  err_aiQuota: 'Asistentul AI a primit prea multe cereri sau cota e epuizată. Reîncearcă mai târziu.',
  err_aiSession: 'Sesiunea a expirat. Intră din nou în cont.',
  err_aiForbidden: 'Nu ai drepturi să folosești asistentul AI pentru acest restaurant.',
  err_aiUnavailable: 'Asistentul AI nu e disponibil acum pentru acest restaurant.',
  err_aiBusy: 'Asistentul AI nu a putut răspunde acum. Reîncearcă în câteva momente.',
  action_create_product: 'Adaugă produs',
  action_update_product: 'Modifică produs',
  action_toggle_sold_out: 'Disponibilitate produs',
  action_create_category: 'Adaugă categorie',
  status_applied: '· aplicat ✓',
  status_rejected: '· respins',
  status_error: '· eroare',
  field_name: 'Nume',
  field_price: 'Preț (lei)',
  field_emoji: 'Emoji',
  field_category: 'Categorie',
  no_category: '(fără categorie)',
  field_categoryName: 'Nume categorie',
  // {product} = numele produsului în ghilimele (`product_quoted`), {state} =
  // starea țintă, ambele în <strong>.
  soldOut_sentence: 'Marchează {product} ca {state}.',
  product_quoted: '„{name}"',
  state_soldOut: 'STOC EPUIZAT',
  state_available: 'DISPONIBIL',
  product_label: 'Produs: {name}',
  confirm: 'Confirmă',
  reject: 'Respinge',
}

export default ro

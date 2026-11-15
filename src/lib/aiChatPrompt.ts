// src/lib/aiChatPrompt.ts — textul pentru MODEL al asistentului AI din panou
// (AiChatbot), mutat aici din componentă în lotul L7 cu ieșirea BYTE-identică.
// NU e text de ecran: promptul de sistem (contextul de meniu cu id-urile reale
// și protocolul de acțiuni) și marcajul unui răspuns gol din istoricul trimis
// înapoi modelului rămân în română în ORICE limbă a personalului — promptul
// cere explicit „Răspunzi mereu în română”. Ca asistentul să răspundă în
// limba personalului e o decizie de produs (reziduu consemnat în L7), nu o
// traducere.
// Fișier .ts (nu .tsx): scanerul SK5 al textului vizibil umblă doar prin
// componente, iar aici nu e nimic vizibil.

export interface ChatPromptCategory {
  id: string
  emoji: string
  name: string
}

export interface ChatPromptProduct {
  id: string
  name: string
  price: number
  is_sold_out?: boolean | null
  category_id?: string | null
}

/** Conținutul trimis modelului în locul unui răspuns gol al lui (în istoric),
 *  ca înainte — pe ecran se afișează `assistant.no_reply` în limba
 *  personalului. */
export const AI_CHAT_EMPTY_REPLY = '(fără răspuns)'

/** Promptul de sistem: contextul de meniu (id-uri reale ca modelul să poată
 *  referi produse) + protocolul de acțiuni. */
export function buildChatSystemPrompt(
  restaurantName: string,
  categories: readonly ChatPromptCategory[],
  products: readonly ChatPromptProduct[],
): string {
  const cats = categories.map((c) => `- ${c.id} · ${c.emoji} ${c.name}`).join('\n')
  const prods = products
    .slice(0, 200)
    .map(
      (p) =>
        `- ${p.id} · ${p.name} · ${p.price} lei${p.is_sold_out ? ' · STOC EPUIZAT' : ''}${p.category_id ? ` · cat:${p.category_id}` : ''}`,
    )
    .join('\n')
  return [
    `Ești asistentul AI al restaurantului „${restaurantName}" din platforma Menuvia.`,
    'Ajuți la gestionarea meniului digital QR. Răspunzi mereu în română, concis și prietenos.',
    '',
    'Poți PROPUNE modificări pe meniu. Când propui modificări, adaugă la FINALUL răspunsului un bloc ```json``` cu forma:',
    '{"actions":[{"type":"create_product","name":"...","price":25,"description":"...","category_id":"<id categorie>","emoji":"🍕"}]}',
    'Tipuri de acțiuni permise:',
    '- create_product: {name, price (lei, număr), description?, category_id?, emoji?}',
    '- update_product: {product_id, name?, price?, description?, emoji?}',
    '- toggle_sold_out: {product_id, sold_out (true/false)}',
    '- create_category: {name, emoji?}',
    'Folosește DOAR id-urile reale din contextul de mai jos. Nu inventa id-uri.',
    'Nu aplica tu nimic — utilizatorul confirmă manual fiecare acțiune. Dacă userul doar pune o întrebare, NU adăuga bloc json.',
    '',
    'CATEGORII:',
    cats || '(niciuna)',
    '',
    'PRODUSE:',
    prods || '(niciunul)',
  ].join('\n')
}

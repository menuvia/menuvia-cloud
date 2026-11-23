// src/lib/aiChatPrompt.ts — textul pentru MODEL al asistentului AI din panou
// (AiChatbot), mutat aici din componentă în lotul L7 cu ieșirea BYTE-identică.
// NU e text de ecran: promptul de sistem (contextul de meniu cu id-urile reale
// și protocolul de acțiuni) și marcajul unui răspuns gol din istoricul trimis
// înapoi modelului rămân în română în ORICE limbă a personalului (modelul îl
// înțelege oricum). Ce se schimbă cu limba (activarea limbilor personalului):
//   - limba RĂSPUNSULUI = limba personalului (`replyLang`): un manager german
//     primea răspunsul în română;
//   - conținutul de meniu PROPUS (nume, descrieri) se cere în limba de BAZĂ a
//     meniului (`menuLang`), nu în limba de chat: e o DATĂ văzută de oaspete;
//   - prețurile se spun în moneda localului (`currency`), nu „lei” fix.
// Pe română + română + RON promptul e BYTE-identic cu cel de dinainte (XA7).
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

/** Numele limbilor în română, pentru instrucțiunile din prompt. */
const LANG_NAME_RO: Readonly<Record<string, string>> = {
  ro: 'română',
  en: 'engleză',
  fr: 'franceză',
  de: 'germană',
  it: 'italiană',
  hu: 'maghiară',
  es: 'spaniolă',
}

export interface ChatPromptOptions {
  /** Limba personalului — limba în care răspunde asistentul. */
  replyLang?: string
  /** Limba de bază a meniului — limba conținutului de meniu propus. */
  menuLang?: string
  /** Moneda meniului (cod ISO 4217); RON = „lei”. */
  currency?: string | null
}

/** Promptul de sistem: contextul de meniu (id-uri reale ca modelul să poată
 *  referi produse) + protocolul de acțiuni. */
export function buildChatSystemPrompt(
  restaurantName: string,
  categories: readonly ChatPromptCategory[],
  products: readonly ChatPromptProduct[],
  opts: ChatPromptOptions = {},
): string {
  const replyName = LANG_NAME_RO[opts.replyLang ?? 'ro'] ?? LANG_NAME_RO.ro
  const menuName = LANG_NAME_RO[opts.menuLang ?? 'ro'] ?? LANG_NAME_RO.ro
  const money = !opts.currency || opts.currency === 'RON' ? 'lei' : opts.currency
  // Instrucțiunea despre conținutul propus apare DOAR când diferă de limba
  // răspunsului (pe română + română promptul rămâne cel de dinainte).
  const menuLine =
    menuName === replyName
      ? []
      : [`Numele și descrierile pe care le propui pentru meniu le scrii în ${menuName} (limba meniului), nu în limba conversației.`]
  const cats = categories.map((c) => `- ${c.id} · ${c.emoji} ${c.name}`).join('\n')
  const prods = products
    .slice(0, 200)
    .map(
      (p) =>
        `- ${p.id} · ${p.name} · ${p.price} ${money}${p.is_sold_out ? ' · STOC EPUIZAT' : ''}${p.category_id ? ` · cat:${p.category_id}` : ''}`,
    )
    .join('\n')
  return [
    `Ești asistentul AI al restaurantului „${restaurantName}" din platforma Menuvia.`,
    `Ajuți la gestionarea meniului digital QR. Răspunzi mereu în ${replyName}, concis și prietenos.`,
    ...menuLine,
    '',
    'Poți PROPUNE modificări pe meniu. Când propui modificări, adaugă la FINALUL răspunsului un bloc ```json``` cu forma:',
    '{"actions":[{"type":"create_product","name":"...","price":25,"description":"...","category_id":"<id categorie>","emoji":"🍕"}]}',
    'Tipuri de acțiuni permise:',
    `- create_product: {name, price (${money}, număr), description?, category_id?, emoji?}`,
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

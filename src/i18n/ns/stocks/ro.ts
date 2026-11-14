// Namespace `stocks` — fila Stocuri (lotul L5b): StocksTab cu toate secțiunile
// lui (sumarul de sus, ghidul de bun venit, ingredientele cu alerta de stoc
// minim, fișa ingredientului, ajustarea manuală, furnizorii, NIR-urile cu fișa
// de creare, profitabilitatea), plus unitățile afișate de `formatStockT` /
// `unitSymbolT` / `unitLabelT` (lib/stocks.ts) și refuzurile citite de
// `describeStockError` (lib/stockMessages.ts). Chunk propriu: fila e LENEȘĂ în
// DashboardPage, deci namespace-ul se încarcă doar cu ea.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — inclusiv pluralele false („1
// furnizori”, „1 NIR-uri totale”, „Termen plată: 1 zile”, „și încă 1
// produse”, „1 ingrediente active”), „...” cu trei puncte peste tot (dar „→”
// la ghid), ghilimelele DREPTE din indiciul furnizorului nou (`"X"`) și
// ghilimelele curbe din „Click „+ NIR nou” …”. Un plural fals devine cheie
// PLURALĂ cu formele ro identice, ca franceza/germana să poată acorda.
// Glosar: NIR (notă de intrare-recepție) rămâne „NIR” în română; în celelalte
// limbi e termenul firesc al recepției mărfii, consecvent peste tot: goods
// receipt / réception (de marchandises) / Wareneingang.
// NU sunt aici (din `common`): „Anulează”, „Salvează”, „Șterge”, „Editează”,
// „Reîncearcă”.
// NU se traduc (date): numele ingredientelor/furnizorilor/produselor,
// categoria ingredientului, notele, eticheta cotei TVA din `vat_rates`, codurile
// unităților și statusurile NIR din DB (se traduce doar AFIȘAREA lor), nota
// implicită a ajustării (`MANUAL_ADJUST_NOTE`, scrisă în DB).
const ro = {
  // Bani: `toFixed(2)` + „lei”, identic în cele patru limbi (regula L3a).
  money: '{amount} lei',
  saving: 'Salvez...',

  // ── Antetul, sumarul de sus și ghidul de bun venit ──
  intro: 'Stocuri, rețete, furnizori, profitabilitate.',
  stats_loadError: 'Nu am putut încărca sumarul stocurilor.',
  stat_ingredients: 'Ingrediente',
  stat_belowMin: { one: '{n} sub prag', few: '{n} sub prag', other: '{n} sub prag' },
  stat_allOk: 'toate ok',
  stat_stockValue: 'Valoare stoc',
  stat_stockValueSub: 'total ingrediente',
  stat_suppliers: 'Furnizori',
  stat_suppliersNone: 'niciunul',
  stat_suppliersActive: 'activi',
  stat_nirs: 'NIR-uri',
  stat_nirsPending: 'în așteptare',
  welcome_title: 'Bun venit în Stocuri',
  welcome_desc:
    'Modulul de gestiune îți permite să urmărești stocul de ingrediente, să definești rețete și să vezi profitabilitatea fiecărui produs.',
  // {title} = textul îngroșat al pasului (`welcome_stepNTitle`).
  welcome_step1Title: 'Adaugă ingredientele',
  welcome_step1: '{title} — făină, ulei, brânză, cașcaval. Pune cantitatea curentă și costul pe unitate.',
  welcome_step2Title: 'Definește rețetele',
  welcome_step2:
    '{title} — la editarea unui produs (ex: Pizza Margherita), adaugi ingrediente cu cantitatea consumată per bucată.',
  welcome_step3Title: 'Vezi profit + stoc automat',
  welcome_step3: '{title} — la fiecare comandă finalizată, ingredientele scad automat și vezi marja per produs.',
  welcome_cta: 'Începe cu primul ingredient →',
  tab_ingredients: 'Ingrediente',
  tab_suppliers: 'Furnizori',
  tab_purchases: 'NIR',
  tab_profitability: 'Profitabilitate',

  // ── Unitățile (enum `IngredientUnit`, mig 026): simbolul scurt e EXACT codul
  //    în română; numele lung e `unitLabel` de dinainte ──
  unit_g: 'g',
  unit_kg: 'kg',
  unit_ml: 'ml',
  unit_l: 'l',
  unit_buc: 'buc',
  unit_pachet: 'pachet',
  unitName_g: 'grame',
  unitName_kg: 'kilograme',
  unitName_ml: 'mililitri',
  unitName_l: 'litri',
  unitName_buc: 'bucăți',
  unitName_pachet: 'pachete',

  // ── Cota TVA (doar pe planul cu bon): {rate}% ({label}) vine din `vat_rates`
  //    (date); rezerva pentru o grupă fără cotă configurată ──
  vat_group: 'Grupa {n}',
  vat_badge: 'TVA {rate}',

  // ── Ingredientele ──
  ing_loading: 'Se încarcă stocurile...',
  ing_loadError: 'Nu am putut încărca ingredientele.',
  ing_lowCount: {
    one: '{n} ingredient sub prag',
    few: '{n} ingrediente sub prag',
    other: '{n} ingrediente sub prag',
  },
  // {names} = primele 3 nume (date), despărțite prin virgulă.
  ing_lowMore: { one: '{names} și încă {n}', few: '{names} și încă {n}', other: '{names} și încă {n}' },
  ing_none: 'Niciun ingredient. Adaugă primul!',
  ing_count: { one: '{n} ingrediente active', few: '{n} ingrediente active', other: '{n} ingrediente active' },
  ing_add: 'Adaugă ingredient',
  ing_emptyTitle: 'Niciun ingredient configurat încă',
  ing_emptyDesc: 'Începe cu cele mai folosite (făină, ulei, lapte) și adaugă rețetele la produse',
  ing_min: '/ min {amount}',
  ing_costPerUnit: '{amount} lei / {unit}',
  ing_adjust: 'Ajustează stoc',

  // ── Fișa ingredientului ──
  ingm_titleEdit: 'Editează ingredient',
  ingm_titleNew: 'Ingredient nou',
  ingm_emoji: 'Emoji',
  ingm_name: 'Nume *',
  ingm_namePh: 'Făină tip 000',
  ingm_category: 'Categorie (opțional)',
  ingm_categoryPh: 'ex: Cereale, Lactate, Băuturi',
  ingm_unit: 'Unitate de măsură',
  ingm_vat: 'Cota TVA',
  ingm_stock: 'Stoc curent ({unit})',
  ingm_minAlert: 'Alertă sub ({unit})',
  ingm_optional: 'Opțional',
  ingm_cost: 'Cost per {unit} (lei)',
  ingm_costHint: 'Folosit pentru calcul profit. Va fi recalculat automat la fiecare NIR.',
  ingm_deleteTitle: 'Șterge {name}?',
  err_nameRequired: 'Numele e obligatoriu',

  // ── Ajustarea manuală ──
  adj_current: 'Stoc curent: {amount}',
  adj_hint: 'Pune cantitatea reală pe care o ai în stoc acum',
  adj_reason: 'Motiv (opțional)',
  adj_reasonPh: 'ex: Inventar, risipă, schimb furnizor',
  err_qtyInvalid: 'Cantitate invalidă',

  // ── Furnizorii ──
  sup_loading: 'Se încarcă furnizorii...',
  sup_loadError: 'Nu am putut încărca furnizorii.',
  sup_count: { one: '{n} furnizori', few: '{n} furnizori', other: '{n} furnizori' },
  sup_add: 'Adaugă furnizor',
  sup_empty: 'Niciun furnizor încă',
  sup_vatId: 'CUI: {id}',
  sup_terms: { one: 'Termen plată: {n} zile', few: 'Termen plată: {n} zile', other: 'Termen plată: {n} zile' },
  supm_title: 'Furnizor nou',
  supm_name: 'Nume firmă *',
  supm_namePh: 'ex: SC Lactate Brașov SRL',
  supm_vat: 'CUI / CIF',
  supm_vatPh: 'RO12345678',
  supm_phone: 'Telefon',
  supm_phonePh: '07XX XXX XXX',
  supm_email: 'Email',

  // ── NIR-urile ──
  nir_loading: 'Se încarcă NIR-urile...',
  nir_loadError: 'Nu am putut încărca NIR-urile.',
  nir_none: 'Niciun NIR. Adaugă primul când primești marfă.',
  nir_count: { one: '{n} NIR-uri totale', few: '{n} NIR-uri totale', other: '{n} NIR-uri totale' },
  nir_new: 'NIR nou',
  nir_needIngredient: 'Pentru a crea un NIR, adaugă mai întâi cel puțin 1 ingredient în tab-ul Ingrediente.',
  nir_emptyTitle: 'Niciun NIR încă',
  nir_emptyDesc: 'Click „+ NIR nou” când primești marfă de la furnizor',
  // {id} = primele 8 caractere ale id-ului, când NIR-ul n-are număr de factură.
  nir_fallbackName: 'NIR #{id}',
  // Statusurile din DB (`purchase_orders.status`) — doar afișarea.
  nir_status_draft: 'Draft',
  nir_status_received: 'Recepționat',
  nir_status_paid: 'Plătit',
  nir_status_cancelled: 'Anulat',
  nir_receiveTitle: 'Confirmă recepționarea?',
  nir_receiveDesc: 'Stocul va crește automat.',
  nir_receive: 'Recepționează',

  // ── Fișa de creare NIR ──
  nirm_desc: 'Înregistrează intrarea de marfă de la furnizor. Stocurile cresc la recepționare.',
  nirm_supplier: 'Furnizor (opțional)',
  nirm_supplierPh: 'Tastează pentru a căuta sau crea nou...',
  // Ghilimele DREPTE, ca înainte. {name} = numele tastat (dată).
  nirm_supplierCreate: 'Apasă Salvează ca să creezi furnizorul "{name}"',
  nirm_date: 'Data factură',
  nirm_number: 'Număr factură',
  nirm_numberPh: 'ex: F-2024-1234',
  nirm_items: 'Produse',
  nirm_pickIngredient: 'Alege ingredient...',
  nirm_removeRow: 'Șterge rândul',
  nirm_qty: 'Cantitate',
  nirm_unitPrice: 'Preț/unitate',
  nirm_vat: 'TVA',
  nirm_lineTotalVat: 'Total linie (cu TVA)',
  nirm_lineTotal: 'Total linie',
  nirm_addRow: 'Adaugă rând',
  nirm_subtotal: 'Subtotal (fără TVA)',
  nirm_vatTotal: 'TVA',
  nirm_total: 'TOTAL',
  nirm_notes: 'Note (opțional)',
  nirm_notesPh: 'ex: livrare cu întârziere, marfă lipsă, etc.',
  nirm_receiveNow: 'Recepționează imediat',
  nirm_receiveNowHint: 'Stocurile vor crește automat. Bifează doar dacă marfa e fizic primită acum.',
  nirm_saveReceive: 'Salvează & recepționează',
  nirm_saveDraft: 'Salvează ca draft',
  err_noValidItems: 'Adaugă cel puțin un ingredient cu cantitate validă',

  // ── Refuzurile serverului (hint-urile din mig 066, create_purchase_order_atomic),
  //    citite de `describeStockError` DOAR în altă limbă decât româna (în
  //    română rămâne exact `toUserMessage` de dinainte) ──
  hint_noItems: 'Adaugă cel puțin un ingredient cu cantitate validă',
  hint_invalidQuantity: 'Cantitatea fiecărui rând trebuie să fie mai mare decât 0.',
  hint_invalidPrice: 'Prețul pe unitate nu poate fi negativ.',
  hint_invalidVat: 'Cota TVA a unui rând nu e validă.',
  hint_wrongIngredient: 'Un ingredient din listă nu mai aparține acestui restaurant. Reîncarcă pagina.',

  // ── Profitabilitatea ──
  prof_loading: 'Se calculează profitabilitatea...',
  prof_loadError: 'Nu am putut calcula profitabilitatea.',
  prof_info:
    'Pentru ca un produs să apară aici cu cost calculat, trebuie să-i adaugi rețeta (Editare produs → Rețetă).',
  prof_empty: 'Niciun produs de analizat încă',
  prof_withRecipe: 'Cu rețetă configurată ({n})',
  prof_cost: 'Cost: {amount} lei',
  prof_sell: 'Vând: {amount} lei',
  prof_marginPct: '{pct}%',
  prof_margin: 'marjă',
  prof_noRecipe: 'Fără rețetă ({n}) — nu se poate calcula profitul',
  // {names} = primele 5 nume (date).
  prof_more: {
    one: '{names} și încă {n} produse',
    few: '{names} și încă {n} produse',
    other: '{names} și încă {n} produse',
  },
}

export default ro

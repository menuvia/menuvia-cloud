// Namespace `products` — fila Produse a panoului (lotul L5a, partea 1):
// ProductsTab cu toate subcomponentele (lista, filtrele, fișa produsului cu
// imaginea/AI-ul/cota TVA/opțiunile/extra-urile/perechile/rețeta, ștergerea),
// ProductsToolbar și ProductOrderModal. SURSA DE ADEVĂR: en/fr/de au tipul
// `Translation<typeof ro>`. Româna e BYTE-identică cu textele de dinainte —
// inclusiv „Se încarcă...” cu trei puncte (dar „Se salvează…”, „Se
// generează…”, „Se creează…” cu ellipsis, fiecare cum era), ghilimelele DREPTE
// de închidere din exemplul extra-urilor („+5 lei brânză extra") și pluralele
// false („2 extra-uri”, „20 ingrediente”, „✓ 1 produse importate”).
// Sumele rămân `toFixed(2)` + „lei” (`money`, identic în cele patru limbi):
// formatarea pe limba personalului e un lot separat (regula L3a).
// NU sunt aici (din `common`): „Anulează”, „Salvează”, „Șterge”, „Editează”,
// „Reîncearcă”. NU se traduc (date): numele produselor/categoriilor/grupurilor/
// ingredientelor, eticheta și descrierea cotelor TVA, unitățile de măsură.
const ro = {
  money: '{amount} lei',
  loadingDots: 'Se încarcă...',
  optional: '(opțional)',
  saving: 'Se salvează…',
  generating: 'Se generează…',
  unknownError: 'Eroare necunoscută',

  // ── Insigna „fără categorie” (lista) ──
  badge_noCategoryTitle: 'Alege o categorie ca produsul să apară în meniu',
  badge_noCategory: 'Fără categorie · nu apare în meniu',

  // ── Fișa produsului: titlul, închiderea, validarea ──
  sheet_titleEdit: 'Editează produs',
  sheet_titleAdd: 'Adaugă produs',
  discard_title: 'Renunți la modificări?',
  discard_desc: 'Modificările din fișă nu sunt salvate și se pierd.',
  discard_confirm: 'Renunță',
  discard_stay: 'Rămân în fișă',
  vatExit_title: 'Închizi fișa produsului?',
  vatExit_confirm: 'Închide fișa',
  // „Salvează traducerile” = butonul din ExtraTranslations (lotul L5a, partea 2).
  extraTr_title: 'Traducerile extra-urilor nu sunt salvate',
  extraTr_desc:
    'Ai tastat traduceri pentru extra-uri fără „Salvează traducerile”. Ele se salvează separat și se pierd când se închide fișa.',
  extraTr_confirm: 'Salvează fișa fără ele',
  val_nameRequired: 'Numele produsului e obligatoriu',
  val_priceNegative: 'Prețul nu poate fi negativ',
  val_priceInvalid: 'Prețul nu e un număr valid (ex. 12,50)',
  saveAndNext: 'Salvează și adaugă următorul',

  // ── Câmpurile de bază ──
  field_nameReq: 'Nume *',
  field_name: 'Nume',
  field_namePh: 'Spaghete Carbonara',
  field_priceReq: 'Preț (lei) *',
  field_price: 'Preț (lei)',
  field_pricePh: '32,00',
  field_category: 'Categorie',
  field_noCategory: 'Fără categorie',
  field_newCategoryOption: '➕ Categorie nouă…',
  field_noCategoriesYet: 'Creează întâi o categorie: produsele fără categorie nu apar în meniul clienților.',
  field_noCategoryNote: 'Fără categorie, produsul nu apare în meniul clienților.',
  field_newCategoryName: 'Nume categorie nouă',
  field_creating: 'Se creează…',
  field_create: 'Creează',
  field_description: 'Descriere',
  field_descriptionPh: 'Descriere produs...',
  field_status: 'Status',
  status_active: 'Activ',
  status_activeDesc: 'Apare în meniu',
  status_special: 'Specialitate',
  status_specialDesc: '⭐ apare evidențiat',
  status_soldOut: 'Epuizat',
  status_soldOutDesc: 'Afișat dezactivat',

  // ── Cota TVA (doar pe planul cu bon) ──
  vat_label: 'Cotă TVA',
  vat_loading: 'Se încarcă cotele TVA...',
  vat_loadError: 'Nu am putut încărca cotele TVA.',
  vat_none: 'Nu există cote TVA configurate. Le setezi din Setări → Comenzi & plăți → Cote TVA.',
  vat_open: 'Deschide cotele TVA',
  vat_configurable: 'Configurabil în Setări → Comenzi & plăți → Cote TVA',

  // ── Imaginea ──
  img_label: 'Imagine produs',
  img_alt: 'Preview',
  img_remove: 'Elimină imaginea',
  img_upload: 'Încarcă imagine produs',
  img_add: '+ Imagine',
  img_notImage: 'Te rugăm încarcă un fișier imagine (JPG, PNG, WEBP).',
  img_tooLarge: 'Imaginea e prea mare (max 10MB). Comprim-o și reîncearcă.',
  img_uploadFailed: 'Încărcarea imaginii a eșuat. Reîncearcă.',
  img_aiSaveFirstTitle: 'Salvează întâi produsul',
  img_aiTitle: 'Generează o imagine cu AI',
  img_aiGenerate: '✨ Generează imagine',
  img_aiBadge: '✨ generată de AI — verifică',

  // ── AI: nutriția și imaginea ──
  ai_nameFirst: 'Adaugă întâi numele produsului.',
  ai_nutriDone: 'Valori generate de AI — verifică-le. Alergenii necesită confirmare manuală.',
  ai_nutriFailed: 'Eroare la generarea nutriției.',
  ai_imgSaveFirst: 'Salvează întâi produsul, apoi generează imaginea.',
  ai_imgDone: 'Imagine generată de AI și publicată în meniu — verifică-o.',
  ai_imgFailed: 'Eroare la generarea imaginii.',

  // ── Etichetele dietetice (id-urile din DIETARY_TAGS, lib/constants; în
  //    română EXACT `label`-ul de acolo — testul LV9) ──
  diet_label: 'Etichete dietetice',
  diet_aiBadge: '✨ sugerat de AI — verifică',
  diet_hint: 'Opțional. Ajută clienții să găsească produse potrivite cu dieta lor (vegetarian, picant, etc).',
  diet_signature: 'Signature',
  diet_nou: 'Nou',
  diet_vegetarian: 'Vegetarian',
  diet_vegan: 'Vegan',
  'diet_fara-gluten': 'Fără gluten',
  'diet_fara-lactoza': 'Fără lactoză',
  diet_picant: 'Picant',
  diet_raw: 'Raw',

  // ── Alergenii EU 1169/2011 (id-urile din ALLERGENS, lib/constants; în
  //    română EXACT `label` / `desc` de acolo — testul LV9) ──
  allergen_label: 'Alergeni',
  allergen_hint: 'Bifează dacă produsul conține. Cerință legală (EU 1169/2011) — protejează clienții cu alergii.',
  allergen_aiSuggested: 'Sugerat de AI — confirmă doar ce e corect (răspundere legală):',
  allergen_contains: '⚠️ Conține:',
  allergen_gluten: 'Gluten',
  allergen_crustacee: 'Crustacee',
  allergen_oua: 'Ouă',
  allergen_peste: 'Pește',
  allergen_arahide: 'Arahide',
  allergen_soia: 'Soia',
  allergen_lapte: 'Lapte',
  allergen_nuci: 'Nuci',
  allergen_telina: 'Țelină',
  allergen_mustar: 'Muștar',
  allergen_susan: 'Susan',
  allergen_sulfiti: 'Sulfiți',
  allergen_lupin: 'Lupin',
  allergen_molusce: 'Moluște',
  allergenDesc_gluten: 'grâu, secară, orz, ovăz',
  allergenDesc_crustacee: 'creveți, crab, homar',
  allergenDesc_oua: 'toate preparatele cu ouă',
  allergenDesc_peste: 'inclusiv sosuri cu pește',
  allergenDesc_arahide: 'inclusiv ulei de arahide',
  allergenDesc_soia: 'inclusiv tofu, lapte soia',
  allergenDesc_lapte: 'inclusiv lactate, unt',
  allergenDesc_nuci: 'migdale, nuci, alune, caju',
  allergenDesc_telina: 'frunze, tulpini, semințe',
  allergenDesc_mustar: 'semințe, frunze, pulbere',
  allergenDesc_susan: 'semințe și ulei de susan',
  allergenDesc_sulfiti: 'vin, oțet, fructe uscate',
  allergenDesc_lupin: 'făină și semințe de lupin',
  allergenDesc_molusce: 'scoici, caracatițe, calmar',

  // ── Detalii suplimentare (timp, porție, nutriție) ──
  more_title: 'Detalii suplimentare',
  more_filled: '{n} din 6 completate',
  more_prepTime: 'Timp pregătire',
  more_prepTimeLabel: 'Timp pregătire (minute)',
  more_minutes: 'min',
  more_prepTimeHint: 'Apare ca ⏱️ ~15 min',
  more_portion: 'Cantitate / porție',
  more_portionPh: '350g',
  more_portionHint: 'Ex: 350g, 500ml, 2 buc',
  more_nutrition: 'Valori nutriționale',
  more_nutritionAiBadge: '✨ estimate de AI — verifică',
  more_nutritionAi: '✨ Generează cu AI',
  more_calories: 'Calorii (kcal)',
  more_protein: 'Proteine (g)',
  more_carbs: 'Carbohidrați (g)',
  more_fat: 'Grăsimi (g)',
  more_nutritionHint: 'Valori per porție. Cele generate de AI sunt estimative — corectează-le dacă e nevoie.',
  // „💡 ” + <strong>{more_tipStrong}</strong> + „ ” + {more_tipRest}
  more_tipStrong: 'Aceste detalii sunt opționale.',
  more_tipRest: 'Apar în meniu doar dacă le completezi. Lasă goale dacă nu sunt relevante pentru produs.',

  // ── Opțiunile produsului (grupurile legate, lotul O1b) ──
  groups_title: 'Opțiuni',
  groups_hint: 'Grupurile bifate apar în fișa produsului, pentru client și pentru ospătar.',
  groups_saveFirst: 'Salvează produsul mai întâi, apoi alege-i opțiunile.',
  groups_loading: 'Se încarcă opțiunile…',
  groups_loadError: 'Nu am putut încărca grupurile de opțiuni.',
  groups_none: 'Nu ai încă grupuri de opțiuni. Le creezi din Meniu → Opțiuni.',
  groups_required: 'Obligatoriu',

  // ── Extras & Pereche ──
  upsell_title: 'Extras & Pereche',
  // Pluralele false păstrate: „1 extra” / „2 extra-uri” / „20 extra-uri”.
  upsell_extrasCount: { one: '{n} extra', few: '{n} extra-uri', other: '{n} extra-uri' },
  upsell_pairingsCount: { one: '{n} pereche', few: '{n} perechi', other: '{n} perechi' },
  // „ℹ️ ” + <strong>{saveFirstStrong}</strong> + „ ” + {upsell_saveFirstRest}
  saveFirstStrong: 'Salvează produsul mai întâi.',
  upsell_saveFirstRest: 'După ce produsul este creat, poți reveni aici pentru a adăuga extra-uri și produse pereche.',
  upsell_extrasTitle: '💎 Extras (add-on plătite)',
  upsell_extrasHint:
    'Adaos LA produs cu cost extra. Ex: „+5 lei brânză extra", „+3 lei bacon". Clientul le bifează în fereastra produsului, înainte să adauge în coș.',
  upsell_extraPrice: '+{amount} lei',
  upsell_extraDelete: 'Șterge extra-ul {name}',
  upsell_pairingsTitle: '💡 Pereche (sugestii după adăugarea în coș)',
  upsell_pairingsHint:
    'Produse care MERG BINE cu acesta. Apar ca pop-up după ce clientul adaugă în coș. Ex: friptură → vin, cartofi pai.',
  upsell_pairingGone: 'Produs scos din meniu (ocupă un loc)',
  upsell_pairingRemove: 'Scoate',
  upsell_noOtherProducts: 'Nu există alte produse active. Adaugă mai multe produse mai întâi.',
  // „💡 ” + <strong>{upsell_diffStrong}</strong> + „ ” + {upsell_diffRest}
  upsell_diffStrong: 'Diferența:',
  upsell_diffRest: 'Extras = adaos LA produs (brânză extra). Pereche = produs SEPARAT sugerat (vin, salată).',
  extra_emoji: 'Emoji extra',
  extra_name: 'Nume extra',
  extra_namePh: 'Brânză extra',
  extra_price: 'Preț extra (lei)',
  add: '+ Adaugă',

  // ── Rețeta (gestiune stocuri) ──
  recipe_title: 'Rețetă (ingrediente consumate)',
  recipe_count: { one: '{n} ingredient', few: '{n} ingrediente', other: '{n} ingrediente' },
  recipe_saveFirstRest: 'După ce produsul e creat, poți adăuga ingrediente în rețetă pentru a urmări costuri și stoc.',
  recipe_noIngredientsStrong: 'Nu ai ingrediente în stoc încă.',
  recipe_noIngredientsRest: 'Mergi la Meniu → Stocuri → Ingrediente și adaugă-le pe cele folosite în acest produs.',
  recipe_hint:
    'Definește câte unități din fiecare ingredient se consumă pentru 1 bucată din acest produs. La fiecare comandă plătită, sistemul scade automat din stoc.',
  recipe_lineCost: '({amount} lei)',
  recipe_ingredientDelete: 'Șterge ingredientul {name}',
  recipe_totalCost: 'Cost total rețetă:',
  recipe_margin: '→ marja {pct}%',
  recipe_allAdded: 'Toate ingredientele sunt deja adăugate la rețetă',
  recipe_ingredient: 'Ingredient',
  recipe_chooseIngredient: 'Alege ingredient...',
  recipe_quantity: 'Cantitate',
  // Unitățile ingredientelor (enum `IngredientUnit`, CHECK în mig 026): în
  // română EXACT codul afișat înainte.
  unit_g: 'g',
  unit_kg: 'kg',
  unit_ml: 'ml',
  unit_l: 'l',
  unit_buc: 'buc',
  unit_pachet: 'pachet',
  recipe_quantityOf: 'Cantitate {name} ({unit})',

  // ── Refuzurile serverului din fișă (fallback-ul `describeStaffError`) ──
  err_extraAdd: 'Nu am putut adăuga extra-ul.',
  err_extraDelete: 'Nu am putut șterge extra-ul.',
  err_groupsSave: 'Nu am putut salva opțiunile produsului.',
  err_recipeSave: 'Nu am putut salva rețeta.',
  err_ingredientDelete: 'Nu am putut șterge ingredientul.',
  err_pairingRemove: 'Nu am putut elimina perechea.',
  err_pairingAdd: 'Nu am putut adăuga perechea.',
  err_categoryCreate: 'Nu am putut crea categoria.',
  err_update: 'Nu s-a putut actualiza.',
  err_orderSave: 'Ordinea nu a putut fi salvată.',
  // Hint-urile serverului, DOAR în altă limbă decât româna (în română mesajul
  // serverului rămâne afișat ca înainte — `describeProductError`):
  // `product_limit`/`upgrade_plan` (enforce_product_limit, mig 290),
  // `group_not_found`/`product_not_found`/`duplicate_groups` (mig 319).
  hint_productLimit: 'Ai atins limita de produse a planului. Pentru mai multe e nevoie de un plan superior.',
  hint_groupNotFound: 'Un grup de opțiuni nu mai există. Închide fișa și redeschide-o.',
  hint_productNotFound: 'Produsul nu mai există. Închide fișa și reîncarcă lista.',
  hint_duplicateGroups: 'Un grup de opțiuni apare de două ori. Închide fișa și redeschide-o.',

  // ── Lista și filtrele ──
  list_summary: '{total} total · {active} active',
  list_search: 'Caută...',
  list_all: 'Toate',
  list_uncategorized: 'Fără categorie ({n})',
  list_reorder: 'Ordonează produsele',
  // {label} = eticheta și cota grupei din `vat_rates` (date), sau `list_vatGroup`.
  list_vatNote:
    'Toate produsele sunt pe aceeași grupă TVA ({label}). Verifică băuturile și alcoolul înainte de primul bon — grupa se schimbă din fișa produsului.',
  list_vatGroup: 'grupa {n}',
  list_vatSee: 'Vezi cotele TVA',
  list_vat: 'TVA {rate}',
  col_product: 'Produs',
  col_category: 'Categorie',
  col_price: 'Preț',
  col_status: 'Status',
  col_actions: 'Acțiuni',
  empty_noMatch: 'Niciun produs găsit',
  empty_none: 'Niciun produs încă',
  empty_noMatchDesc: 'Încearcă alt termen de căutare sau șterge filtrul.',
  empty_noneDesc: 'Adaugă primul produs din meniu — manual, din poză sau prin CSV.',
  empty_importPhoto: 'Importă din poză',
  empty_addManual: 'Adaugă manual',
  empty_importCsv: 'Importă din CSV',
  list_special: '⭐ SPECIAL',
  // Insigna „Epuizat” cu sursa (soldOutSourceKind, lib/soldOut): în română
  // EXACT „EPUIZAT · ” + soldOutSourceLabel(...).toUpperCase() (testul LV9).
  list_soldOutStock: 'EPUIZAT · DIN STOC',
  list_soldOutManual: 'EPUIZAT · MANUAL',
  list_soldOutStockTitle: 'Un ingredient din rețetă e sub o porție. Revine singur când stocul crește.',
  list_soldOutManualTitle: 'Marcat epuizat de personal.',
  list_unblocked: 'DEBLOCAT MANUAL',
  list_unblockedTitle: 'Deblocat de personal deși stocul e sub o porție. Regula de stoc se reia după ce stocul crește.',
  list_active: 'Activ',
  list_inactive: 'Inactiv',
  // Eticheta spinner-ului de comutare (în română = implicitul lui Spinner).
  list_toggling: 'Se încarcă',
  list_activate: 'Activează produsul',
  list_deactivate: 'Dezactivează produsul',
  list_editAria: 'Editează produsul',
  list_deleteAria: 'Șterge produsul',
  list_markAvailable: 'Marchează disponibil',
  list_markSoldOut: 'Marchează epuizat',
  list_unmarkSpecial: 'Scoate din specialități',
  list_markSpecial: 'Marchează specialitate',

  // ── Toast-urile listei ──
  toast_added: 'Produs adăugat',
  toast_updated: 'Actualizat',
  toast_deleted: 'Șters',
  toast_activated: 'Activat',
  toast_deactivated: 'Dezactivat',
  toast_available: 'Disponibil',
  toast_soldOut: 'Epuizat',
  toast_normal: 'Normal',
  toast_special: 'Special!',
  toast_orderSaved: 'Ordinea a fost salvată',
  // Pluralul fals păstrat: „✓ 1 produse importate”.
  toast_imported: { one: '✓ {n} produse importate', few: '✓ {n} produse importate', other: '✓ {n} produse importate' },

  // ── Ștergerea ──
  del_title: 'Șterge produs',
  // {name} = <strong> cu numele produsului (fillNodes).
  del_question: 'Ești sigur că vrei să ștergi {name}?',

  // ── Antetul filei (ProductsToolbar) ──
  toolbar_bulkAiAria: 'Generează AI pentru tot meniul (imagini și nutriție)',
  toolbar_bulkAiTitle: 'Generează imagini + nutriție cu AI pentru tot meniul',
  toolbar_bulkAiShort: 'AI',
  toolbar_bulkAi: 'Generează AI',
  toolbar_import: 'Importă',
  toolbar_importPhoto: 'Din poză (AI)',
  toolbar_importCsv: 'Din fișier CSV',
  toolbar_add: '+ Adaugă produs',
  toolbar_limit: 'Limită atinsă — Upgrade',

  // ── Ordinea produselor (ProductOrderModal) ──
  order_title: 'Ordinea produselor din „{name}”',
  order_hint: 'Așa apar produsele în meniul clienților și la ospătar.',
  order_up: 'Mută „{name}” mai sus',
  order_down: 'Mută „{name}” mai jos',
  order_save: 'Salvează ordinea',
}

export default ro

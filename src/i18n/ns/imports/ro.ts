// Namespace `imports` — importurile meniului (lotul L5a2): AiMenuImport
// (importul din poze, montat din fila Produse ȘI din onboarding), AiBulkGenerate
// (lotul AI pe tot meniul, din Produse și din Traduceri) și ProductsCsvImport
// (fila Produse), plus textele calculate de `lib/importMessages.ts` și de
// `lib/productsCsv.ts`. Namespace SEPARAT, nu chei în `products`: onboarding-ul
// (funnel-ul, viu în engleză) încarcă doar acest chunk, nu cele 261 de chei ale
// filei Produse.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — inclusiv pluralele false („Am găsit 1
// produse”, „Cele 1 produse extrase”, „Importă 1 produse →”, „1 produse
// importate!”, „20 produse”, fără „de”), ghilimelele DREPTE de închidere unde
// erau (`categoria „X": …`, `„✨ generat de AI — verifică"`, `„verifică"`),
// „Import în progres...” cu trei puncte (dar „Se procesează…”, „Se salvează…”,
// „Se generează…” cu ellipsis). Un plural fals devine cheie PLURALĂ cu formele
// ro identice, ca franceza/germana să poată acorda.
// NU sunt aici (din `common`): „Închide” (aria-label), „Anulează”, „Înapoi”.
// NU se traduc (date): numele produselor/categoriilor din poze sau din CSV,
// mesajele brute ale serverului în română (doar în română se afișează),
// PROMPT-ul trimis modelului (`buildMenuImportPrompt`, text pentru model).
const ro = {
  money: '{amount} lei',
  done: 'Gata',

  // ── Refuzurile asistentului AI (codurile AiError din lib/ai), citite de
  //    `describeAiError` (lib/translationMessages.ts). EXACT textele din
  //    namespace-ul `translations` (testul IY8): același refuz are același
  //    text pe Traduceri și în importuri. ──
  err_aiQuota: 'Asistentul AI a primit prea multe cereri sau cota e epuizată. Reîncearcă mai târziu.',
  err_aiSession: 'Sesiunea a expirat. Intră din nou în cont.',
  err_aiForbidden: 'Nu ai drepturi să folosești asistentul AI pentru acest restaurant.',
  err_aiUnavailable: 'Asistentul AI nu e disponibil acum pentru acest restaurant.',
  err_aiBusy: 'Asistentul AI nu a putut răspunde acum. Reîncearcă în câteva momente.',

  // ── AiMenuImport: importul din poze ──
  ai_title: '📸 Import meniu din poze',
  ai_tooMany:
    'Poți încărca maximum {max} poze odată. Importă restul paginilor într-o a doua rundă — produsele se adaugă, nu se înlocuiesc.',
  ai_unsupported:
    'Un fișier are un format nesuportat (ex. HEIC). Exportă-l ca JPEG/PNG sau fă un screenshot al meniului.',
  ai_tooLarge: 'Pozele sunt prea mari chiar și comprimate. Încearcă mai puține pagini odată.',
  ai_noneFound: 'Nu am găsit produse în poze. Încearcă poze mai clare.',
  ai_errProcess: 'Eroare la procesarea pozelor.',
  // Fișierul nu s-a putut citi (FileReader) — în română ajunge pe ecran prin
  // `toUserMessage`, ca înainte; în altă limbă se recunoaște după cod.
  ai_errFileRead: 'Nu am putut citi fișierul.',
  // Respingerea de plafon de la server: în română `{message}` e mesajul
  // serverului, ca înainte; în altă limbă e `ai_limitReached`.
  ai_errServerLimit: 'Nimic nu a fost salvat. {message} Debifează produse sau treci la un plan superior.',
  ai_limitReached: 'Ai atins limita de produse a planului.',
  ai_fallbackLead: 'Poți continua și fără AI:',
  ai_fallbackCsv: 'Importă din CSV',
  ai_fallbackManual: 'Adaugă produsele manual',
  ai_resume: {
    one: 'Ai un import început: {n} produs extras, încă nesalvate. Ai un import nesalvat — reia-l sau renunță la el.',
    few: 'Ai un import început: {n} produse extrase, încă nesalvate. Ai un import nesalvat — reia-l sau renunță la el.',
    other: 'Ai un import început: {n} produse extrase, încă nesalvate. Ai un import nesalvat — reia-l sau renunță la el.',
  },
  // „Reia importul” e pomenit și de `ai_leftInDraft` (același buton).
  ai_resumeBtn: 'Reia importul',
  ai_discardBtn: 'Renunță la draft',
  ai_discardTitle: 'Renunți la draft?',
  ai_discardDesc: {
    one: 'Cele {n} produse extrase, încă nesalvate, se pierd definitiv.',
    few: 'Cele {n} produse extrase, încă nesalvate, se pierd definitiv.',
    other: 'Cele {n} produse extrase, încă nesalvate, se pierd definitiv.',
  },
  ai_uploadIntro:
    'Fotografiază sau încarcă până la {max} poze clare cu meniul (paginile lui). AI-ul extrage produsele și secțiunile, apoi verifici și corectezi înainte de salvare.',
  ai_processing: 'Se procesează…',
  ai_pickPhotos: 'Alege pozele',
  ai_found: {
    one: 'Am găsit {n} produse. E totul corect?',
    few: 'Am găsit {n} produse. E totul corect?',
    other: 'Am găsit {n} produse. E totul corect?',
  },
  ai_reviewHint: 'Corectează ce e greșit, debifează ce nu vrei, apoi salvează.',
  ai_reviewNewSections: 'Secțiunile marcate cu ➕ se creează automat la salvare.',
  // Plafonul planului înainte de salvare (`productLimitState`, lib/aiImportDraft).
  ai_limitFull:
    'Ai atins limita de produse a planului — nu mai poți adăuga produse noi. Nimic nu a fost salvat. Treci la un plan superior sau șterge produse existente.',
  ai_limitAllowed: {
    one: 'Planul tău mai permite {n} produs, iar tu ai selectat {selected}.',
    few: 'Planul tău mai permite {n} produse, iar tu ai selectat {selected}.',
    other: 'Planul tău mai permite {n} produse, iar tu ai selectat {selected}.',
  },
  ai_limitUntick: {
    one: 'Debifează {n} produs sau treci la un plan superior. Nimic nu a fost salvat încă.',
    few: 'Debifează {n} produse sau treci la un plan superior. Nimic nu a fost salvat încă.',
    other: 'Debifează {n} produse sau treci la un plan superior. Nimic nu a fost salvat încă.',
  },
  ai_keepWithin: {
    one: 'Păstrează primul produs, restul rămân în draft',
    few: 'Păstrează primele {n} produse, restul rămân în draft',
    other: 'Păstrează primele {n} produse, restul rămân în draft',
  },
  ai_namePh: 'Nume produs',
  ai_descPh: 'Descriere (opțional)',
  ai_noCategory: 'Fără categorie',
  ai_newCategory: '➕ {name} (nouă)',
  ai_doneSaved: {
    one: '{n} produse salvate',
    few: '{n} produse salvate',
    other: '{n} produse salvate',
  },
  ai_doneIssues: { one: '{n} probleme', few: '{n} probleme', other: '{n} probleme' },
  ai_doneSavedWithIssues: '{saved}, {issues}',
  ai_doneAdded: {
    one: '{n} produse adăugate!',
    few: '{n} produse adăugate!',
    other: '{n} produse adăugate!',
  },
  ai_doneWhere: 'Le găsești în tab-ul Produse.',
  ai_leftInDraft: {
    one: '{n} produs a rămas în draft, nesalvate. Redeschide importul și apasă „Reia importul”.',
    few: '{n} produse au rămas în draft, nesalvate. Redeschide importul și apasă „Reia importul”.',
    other: '{n} produse au rămas în draft, nesalvate. Redeschide importul și apasă „Reia importul”.',
  },
  ai_deferred: {
    one: 'Un produs n-a încăput în planul curent. Le salvezi din draft după ce treci la un plan superior.',
    few: '{n} produse n-au încăput în planul curent. Le salvezi din draft după ce treci la un plan superior.',
    other: '{n} produse n-au încăput în planul curent. Le salvezi din draft după ce treci la un plan superior.',
  },
  // Problemele de pe ecranul „done” (ținute ca DATE, `ImportIssue`).
  ai_issueCategory: 'categoria „{name}": nu a putut fi creată (produsele ei intră fără categorie)',
  ai_issueLimit: 'limita de produse a planului a fost atinsă — restul produselor nu au fost salvate',
  ai_issueProduct: '{name}: nu a putut fi salvat',
  ai_unnamedProduct: 'produs fără nume',
  ai_saving: 'Se salvează…',
  ai_saveN: {
    one: 'Salvează {n} produse',
    few: 'Salvează {n} produse',
    other: 'Salvează {n} produse',
  },

  // ── AiBulkGenerate: lotul AI pe tot meniul ──
  bulk_title: '✨ Generează AI pentru meniu',
  bulk_intro:
    'Completez automat ce lipsește din meniu. Tot ce generez e marcat „✨ generat de AI — verifică", ca să corectezi ușor.',
  bulk_images: 'Imagini ({n} fără imagine)',
  bulk_imagesNote:
    'Merg cu furnizorul implicit (OpenAI) sau cu Gemini. Pe Claude sau pe un furnizor personalizat, imaginile se sar, cu un singur mesaj.',
  bulk_nutrition: 'Macronutrienți ({n} fără valori)',
  // „{todo} de tradus” e invariabil în română (textul de dinainte).
  bulk_translateIn: {
    one: 'Traduceri în {n} limbă ({todo} de tradus)',
    few: 'Traduceri în {n} limbi ({todo} de tradus)',
    other: 'Traduceri în {n} limbi ({todo} de tradus)',
  },
  // Numele secțiunii din Setări („Aspect meniu → Limbi meniu”) în limba
  // personalului, ca `translations.tab_pickLangsAdmin`.
  bulk_trNoteFull:
    'Traduce numele, descrierile, opțiunile și extra-urile în limbile alese din Setări → Aspect meniu → Limbi meniu. Completează doar ce lipsește (nu suprascrie traducerile editate manual) și marchează textele noi «de verificat».',
  bulk_trNoteNames:
    'Traduce numele + descrierea în limbile alese din Setări → Aspect meniu → Limbi meniu. Completează doar ce lipsește (nu suprascrie traducerile editate manual) și marchează textele noi «de verificat».',
  bulk_quotaTitle: 'Cotă AI epuizată',
  bulk_doneTitle: 'Gata!',
  // Rezumatul: bucățile unite cu „ · ”, apoi „.”; traducerile cu „ + ”.
  bulk_sumNutrition: {
    one: '{n} seturi de valori nutriționale',
    few: '{n} seturi de valori nutriționale',
    other: '{n} seturi de valori nutriționale',
  },
  bulk_sumImages: { one: '{n} imagini generate', few: '{n} imagini generate', other: '{n} imagini generate' },
  bulk_sumProducts: { one: '{n} produse', few: '{n} produse', other: '{n} produse' },
  bulk_sumCategories: { one: '{n} categorii', few: '{n} categorii', other: '{n} categorii' },
  bulk_sumOptions: {
    one: '{n} opțiuni și extra-uri',
    few: '{n} opțiuni și extra-uri',
    other: '{n} opțiuni și extra-uri',
  },
  bulk_sumTranslated: '{items} traduse',
  bulk_buyCredits: 'Cumpără credite din Setări → Asistent AI ca să continui.',
  bulk_reviewAll: '✨ Tot ce s-a generat e marcat „verifică" — corectează în fiecare produs.',
  // Formele lui `roCount` (lib/menuTranslations) = `Intl.PluralRules('ro')`.
  bulk_textsTranslated: {
    one: '✨ {n} text tradus — marcate «de verificat».',
    few: '✨ {n} texte traduse — marcate «de verificat».',
    other: '✨ {n} de texte traduse — marcate «de verificat».',
  },
  bulk_openTranslations: 'Verifică traducerile',
  bulk_generating: 'Se generează…',
  bulk_generateFor: {
    one: 'Generează pentru {n} produs',
    few: 'Generează pentru {n} produse',
    other: 'Generează pentru {n} produse',
  },
  bulk_generateTranslations: 'Generează traduceri',
  // Progresul și erorile lotului (ținute ca DATE, `BulkIssue`/`BulkCurrent`).
  bulk_translating: 'Traduc {kind} ({n})…',
  bulk_kind_categories: 'categorii',
  bulk_kind_products: 'produse',
  bulk_kind_groups: 'grupuri de opțiuni',
  bulk_kind_options: 'opțiuni',
  bulk_kind_extras: 'extra-uri',
  // Eticheta rândului din eroarea de scriere („Ciorbă (categorie): …”); la
  // produse era „traducere”.
  bulk_row_categories: 'categorie',
  bulk_row_products: 'traducere',
  bulk_row_groups: 'grup',
  bulk_row_options: 'opțiune',
  bulk_row_extras: 'extra',
  bulk_row_nutrition: 'nutriție',
  bulk_row_image: 'imagine',
  bulk_errTrStopped: 'Traduceri oprite: {reason}',
  bulk_errTrBatch: 'Traducere {kind}: {reason}',
  bulk_errRow: '{name} ({row}): {reason}',
  bulk_errNutritionStopped: 'Macronutrienți opriți: {reason} Restul produselor au fost sărite.',
  bulk_errImagesStopped: 'Imagini oprite: {reason} Restul produselor au fost sărite.',
  bulk_errGeneric: 'eroare la generare',
  // Codul `provider_no_images` (furnizor fără imagini): în română ajunge pe
  // ecran mesajul serverului, ca înainte; în altă limbă textul ăsta.
  bulk_errNoImages: 'Generarea de imagini merge doar cu OpenAI sau Gemini. Schimbă furnizorul în Setări → Asistent AI.',

  // ── ProductsCsvImport: importul din CSV ──
  csv_title: '📥 Import produse din CSV',
  csv_subtitle: 'Util pentru migrare rapidă de la alt soft (SmartBill, Octopus, Excel manual).',
  csv_formatTitle: 'Format așteptat (CSV cu header):',
  csv_columnsLabel: 'Coloane:',
  // {columns} = „Coloane:” îngroșat; {name}/{category}/{price} = antetele
  // coloanelor în limba personalului (`csv_head_*`), în cursiv.
  csv_columnsNote: '{columns} {name} și {category} și {price} obligatorii. Categoriile inexistente se creează automat.',
  csv_vatNote: 'TVA = 1-4 (default 1).',
  csv_downloadTemplate: '📄 Descarcă template CSV',
  // Numele fișierului descărcat.
  csv_templateFile: 'template-produse-menuvia.csv',
  csv_uploadFile: '📁 Încarcă fișier CSV',
  csv_pasteLead: 'Sau lipește CSV direct:',
  // {count} = numărul îngroșat (element, prin `fillNodes`).
  csv_detected: {
    one: 'Detectate {count} rânduri:',
    few: 'Detectate {count} rânduri:',
    other: 'Detectate {count} rânduri:',
  },
  csv_valid: { one: '{n} valide', few: '{n} valide', other: '{n} valide' },
  csv_invalid: { one: '{n} cu erori', few: '{n} cu erori', other: '{n} cu erori' },
  csv_preview: 'Previzualizare →',
  csv_willCreate: {
    one: '{count} produse vor fi create.',
    few: '{count} produse vor fi create.',
    other: '{count} produse vor fi create.',
  },
  csv_newCategories: {
    one: 'Se vor crea și {count} categorii noi:',
    few: 'Se vor crea și {count} categorii noi:',
    other: 'Se vor crea și {count} categorii noi:',
  },
  csv_skipped: {
    one: '⚠ {n} rânduri vor fi sărite (au erori).',
    few: '⚠ {n} rânduri vor fi sărite (au erori).',
    other: '⚠ {n} rânduri vor fi sărite (au erori).',
  },
  csv_colStatus: 'Status',
  csv_colName: 'Nume',
  csv_colCategory: 'Categorie',
  csv_colPrice: 'Preț',
  csv_colVat: 'TVA',
  csv_limitFull:
    'Ai atins limita de produse a planului tău — importul nu poate adăuga produse noi. Șterge produse sau treci la un plan mai mare.',
  // „Planul tău mai are loc pentru <b>3</b> produse — se importă primele 3,
  // iar 2 rânduri rămân pe dinafară.” {lead}/{rest} = bucățile de mai jos.
  csv_slots: {
    one: '{lead} — se importă primele {n}, iar {rest} pe dinafară.',
    few: '{lead} — se importă primele {n}, iar {rest} pe dinafară.',
    other: '{lead} — se importă primele {n}, iar {rest} pe dinafară.',
  },
  csv_slotsLead: {
    one: 'Planul tău mai are loc pentru {count} produs',
    few: 'Planul tău mai are loc pentru {count} produse',
    other: 'Planul tău mai are loc pentru {count} produse',
  },
  csv_slotsRest: { one: '{n} rând rămâne', few: '{n} rânduri rămân', other: '{n} rânduri rămân' },
  csv_back: '← Înapoi',
  csv_importN: {
    one: 'Importă {n} produse →',
    few: 'Importă {n} produse →',
    other: 'Importă {n} produse →',
  },
  csv_progress: 'Import în progres... {pct}%',
  csv_imported: {
    one: '{n} produse importate!',
    few: '{n} produse importate!',
    other: '{n} produse importate!',
  },
  // Erorile de RÂND (codurile din `lib/productsCsv.ts`, ținute ca DATE).
  csv_rowMissingName: 'lipsește numele',
  csv_rowMissingCategory: 'lipsește categoria',
  csv_rowMissingPrice: 'lipsește prețul',
  csv_rowBadPrice: 'preț neparsabil ("{raw}")',
  csv_rowNegativePrice: 'preț negativ',
  csv_rowBadVat: 'TVA trebuie 1-4',
  csv_rowNameTooLong: 'nume prea lung (>100)',
  // Erorile IMPORTULUI (`CsvImportFailure`). În română `{reason}` e mesajul
  // brut al serverului, ca înainte; în altă limbă e clasa erorii tradusă.
  csv_errBaseline:
    'Nu am putut citi meniul existent, deci importul nu a pornit (nu s-a adăugat nimic). Reîncearcă.',
  csv_errVerifyProducts:
    'Nu am putut verifica ce s-a importat deja, deci nu am reluat importul (ca să nu dublăm produse). Reîncearcă.',
  csv_errVerifyCategories:
    'Nu am putut verifica categoriile create deja, deci nu am reluat importul (ca să nu dublăm categorii). Reîncearcă.',
  csv_errCategory: 'Eroare la categoria "{name}": {reason}',
  csv_errBatch: 'Eroare la batch {index}: {reason}',
  csv_errUnknown: 'Eroare necunoscută la import',
  // Hint-ul `product_limit`/`upgrade_plan` (mig 290) — doar în altă limbă.
  csv_hintProductLimit: 'Ai atins limita de produse a planului.',
  // Antetele coloanelor din ȘABLON și din exemple, în limba personalului.
  // Importul le acceptă pe ale TUTUROR celor patru limbi (`CSV_HEADER_ALIASES`).
  csv_head_name: 'nume',
  csv_head_category: 'categorie',
  csv_head_price: 'pret',
  csv_head_emoji: 'emoji',
  csv_head_description: 'descriere',
  csv_head_vat: 'tva',
  // Rândurile-EXEMPLU ale șablonului descărcabil (și ale casetei „Format
  // așteptat”): documentație, deci în limba personalului. Fără virgule în
  // celule (fără ghilimele); ultima coloană e TVA (se taie pe Planurile 1–2).
  csv_templateRows:
    'Espresso,Cafele,8.00,☕,Cafea italiană pură,1\nCappuccino,Cafele,14.00,☕,Cu spumă de lapte,1\nLatte Macchiato,Cafele,16.00,🥛,,1\nLimonadă,Băuturi reci,14.00,🍋,Cu mentă proaspătă,1\nCheesecake,Prăjituri,16.00,🍰,Cu fructe de pădure,1',
  csv_exampleRows: 'Espresso,Cafele,8.00,☕,,1\nLatte,Cafele,14.00,🥛,Cu lapte,1',
}

export default ro

// Namespace `translations` — ecranul Meniu → Traduceri (TranslationsTab +
// TranslationRow, lotul O6c) și traducerile din fișa produsului
// (ProductTranslations, ExtraTranslations, insigna AiReviewMark) — lotul L5a,
// partea 2. SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`.
// Româna e BYTE-identică cu textele de dinainte, inclusiv pluralele lui
// `roCount` (lib/menuTranslations): „1 câmp” / „2 câmpuri” / „20 de câmpuri”
// — formele `few`/`other` ale `Intl.PluralRules('ro')` coincid exact cu regula
// lui (testul LX8 le compară pe 0…1000).
// NU sunt aici (din `common`): „Salvează”, „Reîncearcă”. NU se traduc (date):
// numele categoriilor/produselor/grupurilor/opțiunilor/extra-urilor și
// traducerile scrise de patron.
const ro = {
  // ── Numele limbilor MENIULUI (cele 7 ale oaspetelui, lib/i18nMenu
  //    MENU_LANGS) — alt concept decât limba personalului. În română sunt
  //    EXACT etichetele de dinainte (numele fiecărei limbi în limba EI,
  //    `MENU_LANGS[].label`, testul LX7); în en/fr/de, numele în limba
  //    personalului, în forma din interiorul propoziției („en anglais”).
  //    Începutul de pastilă/titlu trece prin `menuLangTitle` (majusculă).
  menuLang_ro: 'Română',
  menuLang_en: 'English',
  menuLang_de: 'Deutsch',
  menuLang_fr: 'Français',
  menuLang_it: 'Italiano',
  menuLang_hu: 'Magyar',
  menuLang_es: 'Español',

  // ── Câmpurile traductibile (TranslationRow, ProductTranslations,
  //    ExtraTranslations) ──
  field_name: 'Nume',
  field_description: 'Descriere',
  field_meta_text: 'Subtitlu',
  // Eticheta vizibilă a câmpului: „Nume (English)”.
  fieldIn: '{field} ({lang})',
  // Numele accesibil: „Nume în English pentru «Bacon»”.
  fieldAria: '{field} în {lang} pentru «{name}»',
  // Insigna de pe un câmp completat de AI și neverificat (`ai_fields`, O6c).
  aiMark: '✨ tradus automat — verifică',
  // „{n} de verificat” — invariabil în română (textul de dinainte).
  toReview: '{n} de verificat',

  // ── Rândul (TranslationRow) ──
  row_saved: '✓ Salvat',
  row_confirm: 'Confirmă',
  row_fromGroup: 'din grupul «{group}»',

  // ── Fișa produsului (ProductTranslations) ──
  pt_title: 'Traduceri',
  pt_optional: '(opțional)',
  pt_langsCount: '{done}/{total} limbi',
  pt_intro:
    'Numele și descrierea în alte limbi. Originalul de sus ({base}) rămâne baza — câmpurile lăsate goale afișează automat originalul.',
  pt_auto: '✨ Tradu automat',
  pt_allDone: 'Toate limbile au deja nume și descriere.',
  pt_autoHint: 'Completează doar câmpurile goale; textul tău rămâne.',
  pt_reviewed: 'Am verificat',
  pt_namePlaceholder: 'Nume produs',
  pt_descPlaceholder: 'Descriere produs',
  pt_noNew: 'Nu am primit traduceri noi. Reîncearcă.',
  pt_filled: {
    one: 'Am completat {n} câmp — verifică-le, apoi Salvează.',
    few: 'Am completat {n} câmpuri — verifică-le, apoi Salvează.',
    other: 'Am completat {n} de câmpuri — verifică-le, apoi Salvează.',
  },
  pt_aiFailed: 'Traducerea automată nu a reușit. Reîncearcă.',

  // ── Extra-ul din fișă (ExtraTranslations) ──
  ex_toggle: 'Traduceri {done}/{total}',
  // «Salvează» = butonul fișei (`common.save`).
  ex_hint: 'Se salvează pe loc, separat de «Salvează».',
  // Același text ca butonul pomenit de `products.extraTr_desc`.
  ex_save: 'Salvează traducerile',
  ex_saved: 'Traducerile extra-ului au fost salvate.',
  ex_failed: 'Traducerile extra-ului nu au fost salvate.',

  // ── Ecranul Traduceri (TranslationsTab) ──
  kind_category: 'Categorie',
  kind_product: 'Produs',
  kind_group: 'Grup de opțiuni',
  kind_option: 'Opțiune',
  kind_extra: 'Extra',
  sec_categories: 'Categorii',
  sec_products: 'Produse',
  sec_options: 'Opțiuni',
  sec_extras: 'Extra-uri',
  tab_onlyBase: 'Meniul e oferit doar în {lang}',
  tab_pickLangsAdmin: 'Alege limbile în plus din Setări → Aspect meniu → Limbi meniu.',
  tab_pickLangsOwner: 'Proprietarul alege limbile meniului din Setări.',
  tab_pickLangs: 'Alege limbile',
  tab_loadFailed: 'Nu am putut încărca meniul.',
  tab_noProducts: 'Meniul nu are încă produse vizibile clienților.',
  tab_intro:
    'Meniul e scris în {base} (limba de bază). Aici completezi și verifici traducerile pentru limbile oferite clienților.',
  tab_langGroup: 'Limba traducerii',
  // Pluralul fals păstrat: „1 lipsă” / „2 lipsă” (textul de dinainte).
  tab_missing: { one: '{n} lipsă', few: '{n} lipsă', other: '{n} lipsă' },
  tab_complete: '✓ complet',
  // Pluralul lui `roCount(total, 'text tradus', 'texte traduse')`.
  tab_progress: {
    one: '{done} din {n} text tradus ({pct}%)',
    few: '{done} din {n} texte traduse ({pct}%)',
    other: '{done} din {n} de texte traduse ({pct}%)',
  },
  tab_guestsSee: 'Clienții văd meniul în {lang}',
  tab_guestsDont: 'Clienții nu văd încă limba: tradu măcar o categorie sau un produs',
  tab_aiMissing: '✨ Tradu automat ce lipsește ({n})',
  tab_preview: 'Previzualizează în {lang}',
  tab_appearsAfter: 'Apare clienților după prima traducere a unei categorii sau a unui produs.',
  tab_flipbook: 'Pe stilul Flipbook clientul vede paginile încărcate, nu textele.',
  tab_planUnknown: 'Nu știm încă dacă planul include opțiunile și extra-urile, deci nu sunt numărate aici.',
  tab_truncated:
    'Meniul are cel puțin {n} de produse sau categorii. Ecranul le vede doar pe primele {n}, deci nu poate spune că totul e tradus.',
  tab_completeAll: 'Meniul e tradus complet în {lang}.',
  tab_filterGroup: 'Ce rânduri arăt',
  tab_fMissing: 'Lipsă ({n})',
  tab_fReview: 'De verificat ({n})',
  tab_fAll: 'Toate',
  tab_searchLabel: 'Caută în original și în traducere',
  tab_searchPlaceholder: 'Caută…',
  tab_optLoading: 'Se încarcă opțiunile și extra-urile…',
  tab_optError: 'Opțiuni și extra-uri: {error}',
  tab_optLoadFailed: 'Nu am putut citi opțiunile și extra-urile.',
  tab_noMatch: 'Niciun rând nu se potrivește căutării.',
  tab_nothingReview: 'Nimic de verificat în {lang}.',
  tab_nothing: 'Nimic de arătat aici.',
  tab_showMore: 'Arată încă {n}',
  // Pluralul lui `roCount(n, 'rând nesalvat', 'rânduri nesalvate')`.
  tab_unsaved: {
    one: 'Ai {n} rând nesalvat',
    few: 'Ai {n} rânduri nesalvate',
    other: 'Ai {n} de rânduri nesalvate',
  },
  tab_saveAll: 'Salvează tot',
  tab_saveFailed: 'Traducerea nu a fost salvată. Reîncearcă.',
  tab_confirmFailed: 'Nu am putut confirma traducerea. Reîncearcă.',
  // Titlul lotului AI (AiBulkGenerate, lotul L5a2 — modalul însuși e încă în
  // română).
  tab_aiTitle: '✨ Traduceri automate',

  // ── Refuzurile, DOAR în altă limbă (describeTranslationError,
  //    lib/translationMessages): în română rămâne `toUserMessage` de dinainte,
  //    deci aceste texte nu apar niciodată pe un ecran românesc. Contractul e
  //    `code`-ul (AiError, lib/ai; `not_found` din saveRowTranslations). ──
  err_notInMenu: 'Elementul nu mai e în meniu.',
  err_aiQuota: 'Asistentul AI a primit prea multe cereri sau cota e epuizată. Reîncearcă mai târziu.',
  err_aiSession: 'Sesiunea a expirat. Intră din nou în cont.',
  err_aiForbidden: 'Nu ai drepturi să folosești asistentul AI pentru acest restaurant.',
  err_aiUnavailable: 'Asistentul AI nu e disponibil acum pentru acest restaurant.',
  err_aiBusy: 'Asistentul AI nu a putut răspunde acum. Reîncearcă în câteva momente.',
}

export default ro

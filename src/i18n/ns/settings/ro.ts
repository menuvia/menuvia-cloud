// Namespace `settings` — fila Setări (lotul L6b): SettingsTab cu cele patru
// secțiuni ale ei (Restaurant / Aspect meniu / Comenzi & plăți / Abonament &
// cont) — informațiile principale, țara și fusul orar, programul pe zile,
// logo-ul și coperta, facilitățile, WiFi-ul, rețelele sociale, Google Reviews,
// previzualizarea, adresa meniului (slug), culoarea de accent, temele,
// așezarea produselor și paginile Flipbook, elementele meniului, badge-ul
// Menuvia, limbile și moneda meniului, modulele, ridicarea, sugestiile la coș,
// titlul cardului de cote TVA, planul curent, bara de salvare; plus textele
// despre ridicare de pe acest ecran, compuse de `pickupSettingsCopyT`
// (lib/pickupCopy.ts — `pickupCardDescription`/`pickupOnlyToggleDescription`
// de acolo rămân oracolul românesc) și etichetele din lib/settingsLang.ts
// (zilele, temele, mostrele de accent, facilitățile, țările).
// Chunk propriu: fila e LENEȘĂ în DashboardPage. SettingsTab cere SUS și
// `settingsCards` (cardurile montate static), `common` și `translations`
// (numele limbilor meniului, `menuLangTitle`) — o singură suspendare la prima
// randare într-o limbă nouă.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — „...” cu trei puncte („Se
// salvează...”, „Se încarcă...”, „Despre restaurant...”, „"ChIJ..."”), „…” DOAR
// pe „Se verifică…”, ghilimelele DREPTE din „"DESCHIS ACUM"”/„"Astăzi
// 08:00–23:00"”/„Slug indisponibil: "x"”, ghilimeaua DREAPTĂ de închidere din
// „„Listă"”, „„Creat cu Menuvia"” și „„doar ridicare"”, anglicismele de azi
// („Tagline”, „Background”, „Surface”, „Upload eșuat”, „URL preview:”). Un
// plural fals devine cheie PLURALĂ cu formele ro identice („încarc doar
// primele 1”), ca franceza/germana să poată acorda.
// Conținutul cardurilor FISCALE rămâne în română, deliberat (VatRatesEditor,
// OnlinePaymentsCard — `feature_requires_ro`, mig 296); aici e doar titlul și
// descrierea cardului de cote TVA, scrise direct în SettingsTab.
// NU sunt aici (din `common`): „Salvează”, „Șterge”, „Anulează”, „Reîncearcă”.
// NU se traduc (date): numele restaurantului și valorile salvate, slug-ul,
// hostul de brand, identificatorii IANA ai fusurilor orare (`Europe/Paris` —
// același identificator în orice limbă, ca în sistemul de operare), codurile
// ISO ale monedelor, numele COMERCIALE ale planurilor (`PLAN_LABELS`, nume
// proprii), numele rețelelor sociale și mesajul IMPLICIT al sugestiilor la coș
// (`CHECKOUT_SUGGESTION_DEFAULT_MESSAGE`, lib/settingsLang.ts — se SALVEAZĂ și
// îl vede OASPETELE, deci e dată a meniului, ca recompensa implicită a
// fidelizării; doar placeholder-ul câmpului se traduce).
const ro = {
  // ── Salvarea formularului ──
  save_busy: 'Se salvează...',
  unsaved: 'Ai modificări nesalvate',
  toast_saved: 'Salvat',
  toast_uploadFailed: 'Upload eșuat',
  slug_taken: 'Slug indisponibil: "{slug}" e deja folosit',
  // Rezerva lui `describeStaffError` la schimbarea slug-ului (RPC-ul
  // change_restaurant_slug nu poartă hint).
  err_slug: 'Eroare la schimbarea slug-ului.',
  // Rezerva comutatorului de modul (setModule).
  err_save: 'Eroare la salvare',

  // ── Informații principale ──
  info_title: 'Informații principale',
  // Eticheta vizibilă poartă „ *”; numele accesibil e fără (SettingsTab o taie).
  info_name: 'Nume restaurant *',
  info_namePh: 'La Bella Trattoria',
  info_tagline: 'Tagline',
  info_taglinePh: 'Bucătărie autentică',
  info_city: 'Oraș',
  info_cityPh: 'Sibiu',
  info_phone: 'Telefon',
  info_phonePh: '07xx xxx xxx',
  info_hours: 'Program',
  info_hoursPh: 'Lun–Dum: 12:00–23:00',
  info_description: 'Descriere',
  info_descriptionPh: 'Despre restaurant...',

  // ── Țara și fusul orar (lotul G1) ──
  country_title: 'Țara restaurantului',
  country_descRo:
    'Plățile în aplicație, bonul fiscal și raportul TVA există doar pentru restaurantele din România.',
  country_desc: 'Țara în care funcționează localul.',
  // Și textul hint-ului `country_owner_only` (mig 296) în celelalte limbi.
  country_ownerOnly: 'Doar proprietarul restaurantului poate schimba țara.',
  tz_title: 'Fusul orar',
  tz_desc: 'Ora din program, de la ridicări și de la rezervări se socotește în acest fus.',
  tz_aria: 'Fusul orar al restaurantului',

  // ── Programul pe zile ──
  hours_title: 'Program detaliat',
  hours_desc: 'Folosit pentru indicatorul "DESCHIS ACUM" și textul "Astăzi 08:00–23:00" din meniul public.',
  hours_copyMonday: 'Copiază luni → toate',
  hours_open: 'Deschis',
  hours_opensLabel: 'Deschide',
  hours_closesLabel: 'Închide',
  hours_openAria: '{day} deschidere',
  hours_closeAria: '{day} închidere',
  hours_confirmTitle: 'Suprascrii orarul din Marți–Duminică cu cel de Luni?',
  hours_confirmDesc: 'Nu poți anula această acțiune.',
  hours_confirmOk: 'Suprascrie',
  // Zilele (`WEEK_DAY_KEYS` din lib/settingsLang.ts) — în română EXACT
  // `WEEK_DAY_LABELS` de dinainte (oracolul din același fișier).
  day_mon: 'Luni',
  day_tue: 'Marți',
  day_wed: 'Miercuri',
  day_thu: 'Joi',
  day_fri: 'Vineri',
  day_sat: 'Sâmbătă',
  day_sun: 'Duminică',

  // ── Logo și copertă ──
  logo_title: 'Logo',
  logo_desc: 'Logo pătrat. Opțional, folosit ca avatar / favicon viitor.',
  logo_alt: 'Logo',
  logo_upload: 'Încarcă logo',
  logo_remove: 'Șterge logo',
  uploading: 'Se încarcă...',
  cover_title: 'Imagine cover',
  cover_desc:
    'Afișată în hero-ul meniului public. Recomandat: format 16:9, >1200px lățime. ' +
    'Dacă lipsește, folosim un gradient generat din tema ta.',
  cover_alt: 'Cover',
  cover_none: 'Fără imagine — gradient temă activă',
  cover_upload: 'Încarcă imagine',

  // ── Facilități (`AMENITIES`, lib/constants — în română EXACT `labelRo`) ──
  amen_title: 'Facilități',
  amen_desc: 'Afișate ca pills în hero-ul meniului public.',
  amenity_wifi: 'WiFi',
  amenity_vegan_options: 'Opțiuni vegane',
  amenity_outdoor_seating: 'Terasă',
  amenity_parking: 'Parcare',
  amenity_cards: 'Card',
  amenity_reservations: 'Rezervări',
  amenity_pet_friendly: 'Pet friendly',

  // ── WiFi, social, Google Reviews ──
  wifi_title: 'Parolă WiFi (opțional)',
  wifi_desc: 'Afișată în meniu sub formă vizibilă. Lasă gol dacă nu vrei să publici.',
  wifi_label: 'Parolă WiFi',
  wifi_ph: 'ex: tinctura2024',
  social_title: 'Social media',
  social_website: 'Website',
  google_title: 'Google Reviews (recenzii automate)',
  google_descPay:
    'După ce clientul finalizează plata și răspunde la întrebările de feedback, îi afișăm un buton ' +
    '„Scrie o recenzie pe Google” care îl duce direct la pagina ta de business. Butonul apare tuturor ' +
    'clienților, indiferent de notă — Google nu permite să arăți linkul doar celor mulțumiți.',
  google_desc:
    'După ce clientul răspunde la întrebările de feedback, îi afișăm un buton „Scrie o recenzie pe ' +
    'Google” care îl duce direct la pagina ta de business. Butonul apare tuturor clienților, ' +
    'indiferent de notă — Google nu permite să arăți linkul doar celor mulțumiți.',
  google_placeId: 'Google Place ID',
  // `{link}` = linkul „Place ID Finder” (fillNodes).
  google_help: 'Găsești Place ID-ul aici: {link}. Caută numele localului tău, copiază ID-ul (începe cu "ChIJ...").',
  google_finder: 'Place ID Finder',
  google_configured: 'Configurat',
  // `{link}` = adresa de recenzie (fillNodes).
  google_preview: 'URL preview: {link}',

  // ── Aspect meniu ──
  preview_title: 'Previzualizare',
  preview_desc: 'Așa arată meniul clienților — se actualizează pe măsură ce schimbi.',
  url_title: 'URL meniu',
  url_slugLabel: 'Adresa meniului (slug)',
  url_slugPh: 'slug-url',
  accent_title: 'Culoare accent',
  accent_aria: 'Culoare accent {name}',
  // Mostrele (`ACCENT_SWATCHES`, lib/accentPalette — în română EXACT `name`).
  accent_C8963C: 'Auriu',
  accent_E05555: 'Roșu',
  accent_4CAF6E: 'Verde',
  accent_5B8DEF: 'Albastru',
  accent_9B72CF: 'Mov',
  accent_E07B45: 'Portocaliu',
  accent_3ABFBF: 'Turcoaz',
  theme_title: 'Tema meniului QR',
  theme_desc: 'Alege stilul vizual pentru meniul tău. Se aplică instant pe pagina pe care o văd clienții.',
  theme_bg: 'Background',
  theme_accent: 'Accent',
  theme_surface: 'Surface',
  theme_note: 'După salvare, clienții vor vedea noua temă instant la următoarea încărcare a meniului.',
  // Temele (`THEMES`, lib/themes — în română EXACT `name`/`description`).
  theme_cafe_name: 'Editorial coral',
  theme_cafe_desc: 'Cremă warm + coral. Editorial, primitor, tipografie serif italic.',
  theme_pizzeria_name: 'Pizzerie italiană',
  theme_pizzeria_desc: 'Roșu + alb + verde. Vesel, energic, fonturi italienești.',
  'theme_fine-dining_name': 'Fine dining',
  'theme_fine-dining_desc': 'Negru + auriu elegant. Sofisticat, minimalist, serif clasic.',
  theme_pub_name: 'Pub & Bar',
  theme_pub_desc: 'Verde închis + ambră. Robust, masculin, fonturi industriale.',
  theme_mexican_name: 'Mexican / Fast',
  theme_mexican_desc: 'Culori vii — roșu + galben. Vesel, energic, atrăgător.',
  theme_asian_name: 'Asian & Sushi',
  theme_asian_desc: 'Alb minimalist + roșu Japan. Curat, ordonat, atemporal.',
  theme_healthy_name: 'Healthy & Vegan',
  theme_healthy_desc: 'Verde + crem natural. Curat, fresh, fonturi rotunde.',
  theme_mediterranean_name: 'Mediteranean',
  theme_mediterranean_desc: 'Albastru + alb Santorini. Aerat, luminos, vacanță.',
  // Titlul secțiunii e și al treilea nivel din calea „Setări → Aspect meniu →
  // Așezarea produselor” (`tables.pk_flipbookNoOrders`, `pk_flipbookNoOrders`
  // de mai jos) — aliniat în toate cele patru limbi.
  layout_title: 'Așezarea produselor',
  layout_desc:
    'Cum sunt aranjate produsele pe pagina pe care o văd clienții. Se aplică pe meniul digital și pe meniul QR.',
  layout_list: 'Listă',
  layout_listDesc: 'Poză mică + text. Clasic și compact.',
  layout_grid: 'Galerie foto',
  layout_gridDesc: 'Poze mari, 2 coloane. Cel mai vizual.',
  layout_minimal: 'Minimal elegant',
  layout_minimalDesc: 'Text, fără poze. Aer editorial, clasic și rapid.',
  layout_photo: 'Foto-first',
  layout_photoDesc: 'Poze mari cu numele și prețul pe poză. Atinge poza pentru detalii și opțiuni.',
  layout_flipbook: 'Flipbook (PDF/pagini)',
  layout_flipbookDesc: 'Paginile meniului ca imagini, răsfoibile ca o carte.',
  fb_pagesTitle: 'Paginile meniului ({n}/{max})',
  fb_help:
    'Ai meniul ca PDF? Exportă paginile ca imagini (sau pozează-le) și încarcă-le aici — ori ' +
    'folosește Importul AI din Produse ca să-l transformi în meniu interactiv.',
  fb_pageAlt: 'Pagina {n}',
  fb_moveUp: 'Mută pagina {n} mai sus',
  fb_moveDown: 'Mută pagina {n} mai jos',
  fb_remove: 'Șterge pagina {n}',
  fb_empty: 'Nicio pagină încă. Până încarci pagini, clienții văd meniul pe stilul „Listă".',
  fb_upload: 'Încarcă pagini (poți selecta mai multe)',
  fb_orderNote:
    'Cu flipbook, clienții văd meniul ca pe o carte — comanda din meniu nu e disponibilă pe acest ' +
    'stil; chemarea ospătarului rămâne.',
  fb_full: 'Maxim {max} pagini — șterge una ca să adaugi alta',
  // `{n}` = câte încap; plural fals în română („doar primele 1”).
  fb_partial: {
    one: 'Maxim {max} pagini — încarc doar primele {n}',
    few: 'Maxim {max} pagini — încarc doar primele {n}',
    other: 'Maxim {max} pagini — încarc doar primele {n}',
  },
  fb_added: {
    one: '{n} pagină adăugată — nu uita să salvezi',
    few: '{n} pagini adăugate — nu uita să salvezi',
    other: '{n} pagini adăugate — nu uita să salvezi',
  },
  el_title: 'Elemente meniu',
  el_desc: 'Alege ce se vede pe meniul clienților. Toate sunt pornite implicit.',
  el_cover: 'Copertă',
  el_coverDesc: 'Imaginea de copertă din partea de sus. Dezactivată, se afișează un gradient.',
  el_tagline: 'Slogan',
  el_taglineDesc: 'Sloganul restaurantului afișat sub nume.',
  el_status: 'Status deschis / închis',
  el_statusDesc: 'Pastila care arată dacă restaurantul e deschis acum.',
  el_amenities: 'WiFi & Vegan',
  el_amenitiesDesc: 'Pile cu facilitățile WiFi și opțiuni vegan.',
  el_social: 'Social',
  el_socialDesc: 'Pile cu link-uri Instagram, TikTok, Facebook și website.',
  branding_title: 'Badge „Creat cu Menuvia"',
  branding_desc: 'Linkul discret din josul meniului public. Pe planul tău îl poți ascunde.',
  branding_toggle: 'Afișează badge-ul „Creat cu Menuvia"',
  langs_title: 'Limbi meniu',
  langs_desc: 'Limba în care e scris meniul și limbile în plus în care clientul îl poate vedea.',
  langs_base: 'Limba originală a meniului',
  langs_baseHelp:
    'Limba în care ai scris numele și descrierile produselor. Traducerile se adaugă pentru celelalte limbi.',
  cur_title: 'Moneda meniului',
  cur_descPay:
    'Moneda în care se afișează prețurile în meniul public și QR. Abonamentul Menuvia și fiscalizarea nu sunt afectate.',
  cur_desc: 'Moneda în care se afișează prețurile în meniul public și QR. Abonamentul Menuvia nu e afectat.',
  // Opțiunea RON a selectorului (celelalte monede = codul ISO, ca înainte).
  cur_ron: 'RON (lei)',

  // ── Comenzi & plăți ──
  mod_title: 'Module opționale',
  mod_desc:
    'Activează doar ce ai nevoie. Modulele dezactivate sunt blocate server-side — nici clienții, nici ' +
    'angajații nu pot crea date pe ele.',
  mod_resv: 'Rezervări',
  mod_resvDesc:
    'Permite clienților să rezerve mese din meniul public. Le confirmi și le gestionezi din panou, la Rezervări.',
  mod_resvOn: 'Modulul Rezervări activat',
  mod_resvOff: 'Modulul Rezervări dezactivat',
  pickup_title: 'Comenzi pentru ridicare (click-and-collect)',
  pickup_toggle: 'Comenzi pentru ridicare',
  pickupOnly_title: 'Mod „doar ridicare" (fără mese)',
  pickup_lead: 'Pregătire minim (min)',
  pickup_leadAria: 'Pregătire minim (minute)',
  pickup_slot: 'Interval slot (min)',
  pickup_slotAria: 'Interval slot (minute)',
  pickup_open: 'Deschidere',
  pickup_openAria: 'Deschidere ridicare',
  pickup_close: 'Închidere',
  pickup_closeAria: 'Închidere ridicare',
  pickup_instr: 'Instrucțiuni client (opțional)',
  pickup_instrPh: 'Ex: Sună la sosire, intrarea pe lateral',
  // `{badge}` = eticheta îngroșată a badge-ului (`pickup_badge`, fillNodes) —
  // aceeași ca pe cardul din Bucătărie (`orders.card_srcPickup`).
  pickup_kitchenNote:
    'Comenzile pickup apar în KitchenPage cu badge {badge}. Numele clientului și ora ridicării sunt vizibile.',
  pickup_badge: '📦 Pickup',
  // Textele despre ridicare compuse de `pickupSettingsCopyT` (lib/pickupCopy.ts).
  // Descrierea cardului = `lead` + linkul paginii publice + `tail`.
  pk_lead: 'Comenzi cu ridicare de la restaurant, de pe pagina ta publică',
  pk_flipbookTail: '. Atenție: {why}',
  pk_flipbookNoOrders:
    'pe stilul Flipbook pagina publică arată meniul ca pe o carte, fără coș, deci clienții ' +
    'nu pot comanda pentru ridicare. Pentru comenzi, alege alt stil din Setări → Aspect meniu → ' +
    'Așezarea produselor.',
  pk_activeLead: 'Cu ridicarea pornită, clienții pot comanda de pe pagina ta publică',
  pk_activeTail: ' fără să scaneze QR și ridică direct de la restaurant. Plata cash la ridicare.',
  pk_plainTail: '.',
  po_suspended:
    'Pe planul tău modul nu se aplică: fără comenzi pentru ridicare, panoul îți arată mesele și rezervările.',
  po_desc:
    'Pentru food truck / tejghea: ascunde Harta sălii și Rezervările din panou. ' +
    'QR-ul general din Mese & QR devine QR-ul tău principal.',
  sugg_title: 'Sugestii la coș',
  sugg_desc:
    'Sugerează automat produse din categorii lipsă din coș (ex: client a luat fel principal dar n-a luat desert).',
  sugg_msgLabel: 'Mesaj afișat',
  sugg_msgAria: 'Mesaj afișat la sugestii',
  // Placeholder-ul (exemplul); valoarea IMPLICITĂ salvată e o dată a meniului
  // (`CHECKOUT_SUGGESTION_DEFAULT_MESSAGE`) și rămâne în română.
  sugg_msgPh: '🍰 Înainte să trimiți... ai vrea ceva în plus?',
  vat_title: 'Cote TVA',
  vat_desc:
    'Cele 4 grupe de TVA folosite în restaurantul tău. Modifică procentul când statul schimbă cotele — ' +
    'produsele își păstrează automat grupa.',

  // ── Abonament & cont ──
  plan_title: 'Plan curent',
  plan_failed: 'Nu am putut verifica planul',
  plan_checking: 'Se verifică…',
  signOut: 'Deconectare',
}

export default ro

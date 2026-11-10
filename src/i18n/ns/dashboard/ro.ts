// Namespace `dashboard` — cadrul panoului (DashboardPage): bara laterală,
// navigarea, bara de sus pe mobil, banda vizitei de fondator / agent,
// întrebările „ai modificări nesalvate”, încărcarea tab-urilor, ecranul
// „Rezervările nu sunt activate”, intrările spre ecranele live, modalul
// limitei de produse, plus descrierea comutatorului de limbă din Setări →
// Abonament & cont (UiLanguageCard) — lotul L3b — și butonul „Ajutor” din bara
// laterală (HelpButton, lotul L4c; restul comutatorului e în `common`).
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte.
// „Reîncearcă” vine din `common` (retry). Numele comerciale ale planurilor NU
// sunt aici: vin din PLAN_LABELS / plans.ts (regula 4), ca `{plan}`.
const ro = {
  // ── Navigarea: etichetele din lib/dashboardNav.ts, traduse la RANDARE ──
  // Cheia o dă `navLabelKey` / `navGroupLabelKey` (src/i18n/navLabels.ts);
  // valorile românești sunt EXACT etichetele datelor (testul NL1–NL5).
  navGroup_acasa: 'Acasă',
  navGroup_locatii: 'Locații',
  navGroup_comenzi: 'Comenzi',
  navGroup_meniu: 'Meniu',
  'navGroup_mese-qr': 'Mese & QR',
  navGroup_rapoarte: 'Rapoarte',
  navGroup_setari: 'Setări',
  nav_home: 'Acasă',
  nav_locatii: 'Toate locațiile',
  nav_comenzi: 'Comenzi live',
  nav_reservations: 'Rezervări',
  'nav_casa-tura': 'Ture de casă',
  nav_products: 'Produse',
  nav_categories: 'Categorii',
  nav_modificatori: 'Opțiuni',
  nav_traduceri: 'Traduceri',
  'nav_happy-hour': 'Promoții',
  nav_gestiune: 'Stocuri',
  nav_mese: 'Mese & QR-uri',
  nav_arhitectura: 'Hartă sală',
  nav_raport: 'Vânzări',
  nav_analytics: 'Statistici',
  nav_tva: 'TVA',
  nav_invoices: 'Facturi',
  nav_settings: 'Restaurant',
  'nav_settings-menu': 'Aspect meniu',
  'nav_settings-orders': 'Comenzi & plăți',
  'nav_settings-orders_noPayments': 'Comenzi',
  'nav_settings-orders_noOrdering': 'Meniu QR',
  nav_echipa: 'Echipă',
  nav_ture: 'Program echipă',
  'nav_casa-marcat': 'Casă & tichete',
  'nav_casa-marcat_noFiscal': 'Imprimantă bucătărie',
  nav_ai: 'Asistent AI',
  'nav_settings-account': 'Abonament & cont',
  // Numele accesibil al rândului de chip-uri: „Secțiuni Setări”.
  chips_aria: 'Secțiuni {group}',

  // ── Bara laterală ──
  sidebar_closeMenu: 'Închide meniul',
  sidebar_restaurant: 'Restaurant',
  sidebar_chooseRestaurant: 'Alege restaurantul',
  status_active: 'Activ',
  status_inactive: 'Inactiv',
  status_activeTitle: 'Meniul public e activ',
  status_inactiveTitle: 'Meniul public e oprit — clienții nu îl pot deschide',
  // Româna păstrează forma de azi pentru ORICE n (byte-identic; „1 rezervări”
  // e textul de dinainte) — acordul corect e o schimbare de text separată.
  // Celelalte limbi au formele lor reale.
  pendingReservations: {
    one: '{n} rezervări în așteptare',
    few: '{n} rezervări în așteptare',
    other: '{n} rezervări în așteptare',
  },
  sidebar_previewMenu: 'Previzualizează meniu',
  sidebar_viewAsWaiter: 'Vezi ca ospătar',
  sidebar_waiterTitleFiscal: 'Deschide ecranul de ospătar — comenzi live, rezervări, plăți',
  sidebar_waiterTitle: 'Deschide ecranul de ospătar — comenzi live și rezervări',
  sidebar_founder: 'Panou fondator',
  sidebar_founderTitle: 'Panoul de fondator — toată platforma într-un singur loc',

  // ── Banda vizitei (fondator / agent de vânzări) ──
  visit_founder: 'Mod fondator — {name}',
  visit_agent: 'Vizită de agent de vânzări — {name}',
  visit_restaurantFallback: 'restaurant',
  visit_exit: 'Ieși din vizită',

  // ── Bara de sus pe mobil ──
  mobile_openMenu: 'Deschide meniul',

  // ── Erori ──
  err_restaurantLoad: 'Eroare la încărcarea restaurantului.',
  // Respinsă de „Deschide” din „Toate locațiile”; LocationsTab o afișează.
  err_locationNotListed:
    'Locația nu apare în lista ta de acces. Reîncarcă pagina și încearcă din nou.',

  // ── Încărcarea tab-urilor (Suspense) — punctele sunt cele de dinainte ──
  loading_generic: 'Se încarcă...',
  loading_locations: 'Se încarcă locațiile...',
  loading_products: 'Se încarcă produsele...',
  loading_categories: 'Se încarcă categoriile...',
  loading_modifiers: 'Se încarcă modificatorii...',
  loading_translations: 'Se încarcă traducerile…',
  loading_tables: 'Se încarcă mesele…',
  loading_charts: 'Se încarcă graficele…',
  loading_report: 'Se încarcă raportul...',
  // Fără diacritice: textul de dinainte, păstrat byte-identic.
  loading_floorPlan: 'Se incarca harta...',
  loading_team: 'Se încarcă echipa…',
  loading_assignments: 'Se încarcă alocările…',
  loading_stock: 'Se încarcă gestiunea...',
  loading_vatReport: 'Se încarcă raportul TVA...',
  loading_invoices: 'Se încarcă facturile...',
  loading_reservations: 'Se încarcă rezervările...',
  loading_settings: 'Se încarcă setările...',
  loading_ai: 'Se încarcă asistentul AI...',

  // ── Rezervările oprite (modulul `reservations`) ──
  resv_disabledTitle: 'Rezervările nu sunt activate',
  resv_disabledDesc:
    'Clienții tăi vor putea rezerva o masă direct din meniul public, iar tu le confirmi și le gestionezi de aici. Activezi modulul dintr-un singur click, din Setări.',
  resv_enableInSettings: 'Activează din Setări',

  // ── Comenzi live: intrările spre ecranele live (OrdersHub) ──
  hub_waiterTitle: 'Ecranul ospătarului',
  hub_waiterDescFiscal: 'Comenzile deschise acum, pe mese — preluare manuală și plăți la masă',
  hub_waiterDesc: 'Comenzile deschise acum, pe mese — și preluare manuală',
  hub_kitchenTitle: 'Bucătărie',
  hub_kitchenDesc: 'Ecranul de preparare al bucătăriei',
  hub_opensNewScreen: 'Se deschide un ecran nou',

  // ── Modificări nesalvate în Setări (confirmarea ieșirii) ──
  unsaved_title: 'Ai modificări nesalvate în Setări',
  unsaved_leaveDesc: 'Dacă pleci acum, modificările se pierd. Salvează-le întâi din Setări.',
  unsaved_leaveConfirm: 'Pleacă fără să salvezi',
  unsaved_stayInSettings: 'Rămân în Setări',
  unsaved_switchDesc:
    'Dacă treci la „{next}”, modificările nesalvate pentru „{current}” se pierd. Salvează-le întâi.',
  unsaved_switchConfirm: 'Schimbă fără să salvezi',
  unsaved_stayHere: 'Rămân aici',
  unsaved_otherRestaurant: 'alt restaurant',
  unsaved_addLocationDesc:
    'După creare, panoul trece pe locația nouă, iar modificările nesalvate se pierd. Salvează-le întâi, apoi adaugă locația.',
  unsaved_addLocationConfirm: 'Continuă fără să salvezi',

  // ── Limita de produse atinsă (UpgradeModal) ──
  upgrade_title: 'Deblochează mai mult',
  upgrade_rowQrMenu: 'Meniu QR',
  upgrade_rowProducts: 'Produse',
  upgrade_rowTables: 'Mese + QR',
  upgrade_rowQrOrders: 'Comenzi prin QR',
  upgrade_rowKitchen: 'Ecran bucătărie',
  upgrade_rowWaiterOrders: 'Comenzi ospătar',
  upgrade_rowReports: 'Rapoarte',
  upgrade_reportsGrowth: 'Comenzi + produse vândute',
  upgrade_perMonth: 'lei/lună',
  upgrade_trialNote: 'Primele 30 de zile gratuite · Anulezi oricând',
  // `{plan}` = numele comercial (plans.ts); în română = `ctaLabel` + „ →”.
  upgrade_cta: 'Activează {plan} →',
  upgrade_notNow: 'Nu acum',

  // ── Butonul „Ajutor” din bara laterală (HelpButton, lotul L4c) ──
  // Etichetele acțiunilor: în română EXACT cele din `buildHelpOptions`
  // (lib/agentContact.ts, folosit și de teste) — HelpButton le alege după
  // tipul acțiunii și după sursă (agent / suport).
  help_button: 'Ajutor',
  help_agent: 'Agentul tău Menuvia, te poate ajuta:',
  help_agentNamed: 'Agentul tău Menuvia, {name}, te poate ajuta:',
  help_support: 'Ai o întrebare sau o problemă? Scrie-ne pe email.',
  help_call: 'Sună agentul',
  help_whatsapp: 'WhatsApp',
  help_emailAgent: 'Scrie pe email',
  help_emailSupport: 'Scrie-ne pe email',

  // ── Limba interfeței (UiLanguageCard, Setări → Abonament & cont) ──
  // Restul textelor comutatorului (titlul, salvarea, erorile, numele
  // limbilor) stau în `common` (lotul L4c): le folosește și comutatorul
  // compact din antetul Ospătarului și al Bucătăriei.
  lang_desc:
    'Limba panoului, a ecranului de ospătar și a bucătăriei. Se păstrează în contul tău, pe orice dispozitiv. Limbile meniului pentru clienți se aleg separat, din Aspect meniu.',
}

export default ro

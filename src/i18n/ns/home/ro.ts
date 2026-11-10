// Namespace `home` — „Acasă” din panou (HomeTab) și cardurile lui: oferta
// planului (PlanUpsellCard), agentul (AgentCard), plus cardul de abonament din
// Setări (SubscriptionCard) și banda „planul nu s-a încărcat” (PlanBanners) —
// lotul L3a. SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`.
// Româna e BYTE-identică cu textele de dinainte. Numele comerciale ale
// planurilor NU sunt aici: vin din PLAN_LABELS (regula 4), ca `{plan}`.
// „Reîncearcă” și „Închide” sunt în `common` (retry / close).
const ro = {
  // ── Salutul ──
  welcome_title: 'Bun venit, {name}',
  welcome_description:
    'Configurează restaurantul, verifică QR-urile și urmărește activitatea de azi.',

  // ── Cifrele zilei ──
  metric_ordersToday: 'Comenzi azi',
  metric_ordersTodayHint: 'fără cele anulate',
  metric_loadFailedHint: 'nu s-a putut încărca',
  metric_activeProducts: 'Produse active',
  metric_activeQrs: 'QR-uri active',
  metric_pickupQrHint: 'QR general (doar ridicare)',
  metric_scannableTablesHint: 'mese scanabile',
  metric_occupiedTables: 'Mese ocupate acum',
  metric_openOrdersHint: 'cu comenzi deschise',
  metric_revenueToday: 'Încasări azi',
  metric_revenueHint: 'plăți înregistrate azi',
  metric_tipsToday: 'Bacșiș azi',
  metric_tipsHint: 'informativ, nu intră în încasări',
  metric_setup: 'Configurare',
  metric_setupDoneHint: 'totul e gata ✓',
  metric_setupStepsHint: 'pași completați',
  metrics_someFailed: 'Unele cifre nu s-au putut încărca.',

  // ── Pașii de configurare ──
  setup_title: 'Configurare restaurant',
  setup_progress: '{done}/{total} pași completați',
  setup_progressAria: 'Progres configurare',
  setup_addProducts: 'Adaugă produse',
  setup_createCategories: 'Creează categorii',
  setup_generateTableQrs: 'Generează QR-uri pentru mese',
  setup_checkPublicMenu: 'Verifică meniul public',
  setup_inviteTeam: 'Invită echipa',
  setup_firstOrderPickup: 'Prima comandă de test — deschide meniul public și comandă',
  setup_firstOrderTable: 'Prima comandă de test — deschide QR-ul unei mese și comandă',
  setup_itemDoneAria: '{label} (completat)',
  setup_itemUnknownAria: '{label} (stare necunoscută)',

  // ── Scorul meniului ──
  score_title: 'Scor meniu',
  score_loading: 'Se încarcă scorul...',

  // ── Acțiuni rapide ──
  quick_title: 'Acțiuni rapide',
  quick_addProduct: 'Adaugă produs',
  quick_generateQrs: 'Generează QR-uri',
  quick_qrStands: 'Suporturi QR fizice',
  quick_viewPublicMenu: 'Vezi meniul public',
  quick_viewOrders: 'Vezi comenzile',
  quick_inviteWaiter: 'Invită ospătar',

  // ── Abonament & facturare (SubscriptionCard, Setări → Abonament & cont) ──
  sub_title: 'Abonament & facturare',
  // Spațiul de la final e al propoziției care urmează (`sub_manageHint`).
  sub_yourPlan: 'Planul tău: {name}. ',
  sub_manageHint: 'Actualizează cardul, schimbă planul sau descarcă facturile.',
  sub_noCustomer:
    'Contul tău nu are un abonament plătit cu cardul, deci aici nu ai nimic de gestionat. Planurile și prețurile sunt pe pagina de planuri.',
  sub_portalFallback: 'Nu am putut deschide portalul de facturare. Reîncearcă în câteva momente.',
  sub_seePlans: 'Vezi planurile',
  sub_opening: 'Se deschide…',
  sub_manage: 'Gestionează abonamentul',

  // ── Oferta planului (PlanUpsellCard) ──
  upsell_regionLabel: 'Ofertă: {title}',
  upsell_orderingLead: 'Clienții comandă singuri, iar bucătăria primește comanda pe loc.',
  upsell_orderingBenefit1: 'Comenzi de la masă, prin QR',
  upsell_orderingBenefit2: 'Ecran de bucătărie pentru comenzile noi',
  upsell_orderingBenefit3: 'Comenzi pentru ridicare',
  upsell_paymentsTitle: 'Plata la masă',
  upsell_paymentsLead: 'Pe planul {plan}.',
  upsell_paymentsBenefit1: 'Oaspetele plătește din telefon',
  upsell_paymentsBenefit2: 'Bonul fiscal se emite automat',
  upsell_paymentsBenefit3: 'Încasările și TVA-ul se raportează singure',
  upsell_seePlan: 'Vezi planul',

  // ── Planul nu s-a încărcat (PlanBanners) ──
  planUnknown_text:
    'Nu am putut încărca planul restaurantului. Până se încarcă, unele secțiuni rămân ascunse.',

  // ── Agentul tău Menuvia (AgentCard, mig 303) ──
  agent_heading: 'Agentul tău Menuvia',
  agent_defaultName: 'Agent de vânzări',
  // Ce poate și ce NU poate agentul (textul din mig 286, arătat înainte de buton).
  agent_scope:
    'Agentul vede și poate edita DOAR meniul (categorii, produse, opțiuni) și mesele cu codurile QR. ' +
    'NU vede comenzile, încasările, rezervările, datele fiscale, setările sau echipa. ' +
    'Nu îți afectează abonamentul și îl poți retrage oricând.',
  agent_accessGranted: 'Acces acordat',
  agent_accessRequested: 'Agentul a cerut acces',
  agent_accessRevoked: 'Acces retras',
  agent_accessNone: 'Fără acces',
  agent_ownerOnly: 'Doar proprietarul restaurantului poate acorda sau retrage accesul agentului.',
  agent_grant: 'Permite accesul agentului',
  agent_grantOk: 'Agentul are acum acces la meniu',
  agent_decline: 'Refuză cererea',
  agent_declineOk: 'Cererea agentului a fost refuzată',
  agent_revoke: 'Retrage accesul',
  agent_revokeOk: 'Accesul agentului a fost retras',
  agent_revokeConfirmTitle: 'Retragi accesul agentului?',
  agent_revokeConfirmText:
    'Agentul nu va mai putea vedea sau edita meniul și mesele. Poți să-i dai din nou acces oricând.',
}

export default ro

// Valori brute (hex/rgba) — paleta originală, sursă unică de adevăr.
// FOLOSEȘTE D_RAW doar în contexte care NU sunt CSS, unde var() nu se
// rezolvă: atribute SVG (`fill=`/`stroke=`), config Recharts (tick/dot),
// canvas 2D. Aceste valori NU se tematizează (rămân fixe pe dark), dar nu
// se rup. Pentru orice valoare folosită în `style={{...}}` folosește `D`.
export const D_RAW = {
  bg: '#080808',
  s1: '#0F0F0F',
  s2: '#161616',
  s3: '#1E1E1E',
  s4: '#252525',
  gold: '#C8963C',
  goldL: '#E2B472',
  goldA: 'rgba(200,150,60,0.12)',
  t1: '#F0EAE0',
  t2: '#9A9590',
  t3: '#7C766C', // FIX AA (~4.6:1 pe s1); fostul #4A4844 → tDisabled
  tDisabled: '#4A4844',
  green: '#4CAF6E',
  greenA: 'rgba(76,175,110,0.12)',
  greenText: '#6FCB8E',
  red: '#E05555',
  redA: 'rgba(224,85,85,0.12)',
  redText: '#F08080',
  amber: '#E8A020',
  amberA: 'rgba(232,160,32,0.12)',
  info: '#7EB8F7',
  infoA: 'rgba(126,184,247,0.12)',
  border: 'rgba(255,255,255,0.10)',
  bHov: 'rgba(255,255,255,0.16)',
  borderStrong: 'rgba(255,255,255,0.14)',
  surfaceHover: 'rgba(255,255,255,0.04)',
  onGold: '#1A1208',
  goldBorder: 'rgba(200,150,60,0.32)',
} as const

// Helper: citește o CSS variable (cu fallback la valoarea brută din D_RAW).
// Permite migrarea graduală — componentele vechi cu inline styles merg
// neschimbate, dar acum culorile vin dintr-un singur loc (tokens.css) și
// pot răspunde la temă (dark/light). Vezi src/styles/tokens.css.
const cssVar = (name: string, fallback: string) => `var(${name}, ${fallback})`

export const D = {
  bg: cssVar('--color-bg', D_RAW.bg),
  s1: cssVar('--color-surface-1', D_RAW.s1),
  s2: cssVar('--color-surface-2', D_RAW.s2),
  s3: cssVar('--color-surface-3', D_RAW.s3),
  s4: cssVar('--color-surface-4', D_RAW.s4),
  gold: cssVar('--color-gold', D_RAW.gold),
  goldL: cssVar('--color-gold-light', D_RAW.goldL),
  goldA: cssVar('--color-gold-subtle', D_RAW.goldA),
  t1: cssVar('--color-text-1', D_RAW.t1),
  t2: cssVar('--color-text-2', D_RAW.t2),
  t3: cssVar('--color-text-3', D_RAW.t3),
  green: cssVar('--color-success', D_RAW.green),
  greenA: cssVar('--color-success-bg', D_RAW.greenA),
  greenText: cssVar('--color-success-text', D_RAW.greenText),
  red: cssVar('--color-danger', D_RAW.red),
  redA: cssVar('--color-danger-bg', D_RAW.redA),
  redText: cssVar('--color-danger-text', D_RAW.redText),
  amber: cssVar('--color-warning', D_RAW.amber),
  amberA: cssVar('--color-warning-bg', D_RAW.amberA),
  info: cssVar('--color-info', D_RAW.info),
  infoA: cssVar('--color-info-bg', D_RAW.infoA),
  border: cssVar('--color-border', D_RAW.border),
  bHov: cssVar('--color-border-hover', D_RAW.bHov),
  borderStrong: cssVar('--color-border-strong', D_RAW.borderStrong),
  surfaceHover: cssVar('--color-surface-hover', D_RAW.surfaceHover),
  tDisabled: cssVar('--color-text-disabled', D_RAW.tDisabled),
  onGold: cssVar('--color-on-gold', D_RAW.onGold),
  goldBorder: cssVar('--color-gold-border', D_RAW.goldBorder),
  // Fonturi ca tokens (elimină 'Fraunces'/'DM Sans' hardcodate în componente)
  fontDisplay: cssVar('--font-display', "'Fraunces', Georgia, serif"),
  fontBody: cssVar('--font-body', "'DM Sans', system-ui, sans-serif"),
  fontMono: cssVar('--font-mono', "'JetBrains Mono', ui-monospace, monospace"),
} as const

export type OrderStatus =
  | 'new'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'paid'
  | 'cancelled'
  | 'closed'
export type OrderSource = 'qr' | 'waiter' | 'pickup'
export type PaymentMethod = 'cash' | 'card_pos' | 'other' | 'meal_voucher'
export type MemberRole = 'owner' | 'manager' | 'waiter' | 'kitchen'

export const STATUS_META: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  new: { label: 'Nou', color: D.t2, bg: D.s3 },
  confirmed: { label: 'Confirmat', color: D.amber, bg: D.amberA },
  preparing: { label: 'În preparare', color: D.goldL, bg: D.goldA },
  ready: { label: 'Gata de servit', color: D.green, bg: D.greenA },
  served: { label: 'Servit', color: D.info, bg: D.infoA },
  paid: { label: 'Plătit', color: D.t2, bg: D.s2 },
  cancelled: { label: 'Anulat', color: D.red, bg: D.redA },
  closed: { label: 'Închis', color: D.t2, bg: D.s2 },
}

export const TRANSITION_LABELS: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Acceptă',
  preparing: 'Începe prepararea',
  ready: 'Gata de servit',
  served: 'Servit',
  paid: 'Plătit',
  cancelled: 'Anulează',
}

export const KITCHEN_TRANSITIONS: OrderStatus[] = ['confirmed', 'preparing', 'ready']
export const WAITER_TRANSITIONS: OrderStatus[] = ['served', 'paid']

// Numele COMERCIALE ale planurilor (taxonomia din 3 concepte — vezi
// lib/features.ts planTier). Intern rămân free/starter/growth/pro/enterprise.
// 'business' (legacy pre-rebranding) NU mai există: mig 062 a migrat toate
// conturile la 'pro' și CHECK-ul pe profiles.plan îl respinge de atunci.
// Consumatorii folosesc oricum fallback-ul `PLAN_LABELS[p] || p`.
export const PLAN_LABELS: Record<string, string> = {
  free: 'Demo gratuit',
  starter: 'Meniu Digital',
  growth: 'Meniu + Comenzi',
  pro: 'Fiscalizare',
  enterprise: 'Custom / Lanțuri',
}

// ── Alergeni (Regulamentul EU 1169/2011) ─────────────────────
// Toți 14 alergeni obligatorii conform legislației europene.
// Afișarea în meniu digital este obligatorie. Risc: amendă ANPC.
export const ALLERGENS = [
  { id: 'gluten', label: 'Gluten', emoji: '🌾', desc: 'grâu, secară, orz, ovăz' },
  { id: 'crustacee', label: 'Crustacee', emoji: '🦐', desc: 'creveți, crab, homar' },
  { id: 'oua', label: 'Ouă', emoji: '🥚', desc: 'toate preparatele cu ouă' },
  { id: 'peste', label: 'Pește', emoji: '🐟', desc: 'inclusiv sosuri cu pește' },
  { id: 'arahide', label: 'Arahide', emoji: '🥜', desc: 'inclusiv ulei de arahide' },
  { id: 'soia', label: 'Soia', emoji: '🫘', desc: 'inclusiv tofu, lapte soia' },
  { id: 'lapte', label: 'Lapte', emoji: '🥛', desc: 'inclusiv lactate, unt' },
  { id: 'nuci', label: 'Nuci', emoji: '🌰', desc: 'migdale, nuci, alune, caju' },
  { id: 'telina', label: 'Țelină', emoji: '🌿', desc: 'frunze, tulpini, semințe' },
  { id: 'mustar', label: 'Muștar', emoji: '🟡', desc: 'semințe, frunze, pulbere' },
  { id: 'susan', label: 'Susan', emoji: '🌱', desc: 'semințe și ulei de susan' },
  { id: 'sulfiti', label: 'Sulfiți', emoji: '🍷', desc: 'vin, oțet, fructe uscate' },
  { id: 'lupin', label: 'Lupin', emoji: '🌼', desc: 'făină și semințe de lupin' },
  { id: 'molusce', label: 'Moluște', emoji: '🐚', desc: 'scoici, caracatițe, calmar' },
] as const

export type AllergenId = (typeof ALLERGENS)[number]['id']

// ── Taguri dietetice (opționale, dar valoroase comercial) ────
export const DIETARY_TAGS = [
  { id: 'signature', label: 'Signature', emoji: '★', color: '#C56B5A' },
  { id: 'nou', label: 'Nou', emoji: '✦', color: '#9A8C7A' },
  { id: 'vegetarian', label: 'Vegetarian', emoji: '🥗', color: '#4CAF6E' },
  { id: 'vegan', label: 'Vegan', emoji: '🌱', color: '#388E3C' },
  { id: 'fara-gluten', label: 'Fără gluten', emoji: '🚫🌾', color: '#E8A020' },
  { id: 'fara-lactoza', label: 'Fără lactoză', emoji: '🚫🥛', color: '#E8A020' },
  { id: 'picant', label: 'Picant', emoji: '🌶️', color: '#E05555' },
  { id: 'raw', label: 'Raw', emoji: '🥬', color: '#66BB6A' },
] as const

export type DietaryTagId = (typeof DIETARY_TAGS)[number]['id']

// ── Amenities (afișate ca pills în hero meniu public) ────────
// Fiecare are un label scurt RO/EN și un id stocat în
// restaurants.amenities (text[] enum).
export type AmenityId =
  | 'wifi'
  | 'vegan_options'
  | 'outdoor_seating'
  | 'parking'
  | 'cards'
  | 'reservations'
  | 'pet_friendly'

export const AMENITIES: Array<{ id: AmenityId; labelRo: string; labelEn: string }> = [
  { id: 'wifi', labelRo: 'WiFi', labelEn: 'WiFi' },
  { id: 'vegan_options', labelRo: 'Opțiuni vegane', labelEn: 'Vegan' },
  { id: 'outdoor_seating', labelRo: 'Terasă', labelEn: 'Outdoor' },
  { id: 'parking', labelRo: 'Parcare', labelEn: 'Parking' },
  { id: 'cards', labelRo: 'Card', labelEn: 'Cards' },
  { id: 'reservations', labelRo: 'Rezervări', labelEn: 'Reservations' },
  { id: 'pet_friendly', labelRo: 'Pet friendly', labelEn: 'Pet friendly' },
]

// ── Mini i18n (doar pentru strings vizibile pe meniul public) ─
// Restaurantele cu language ∈ {ro, en, de, fr, it, hu, es} primesc textul lor;
// orice altă limbă primește fallback EN.
type PublicMenuLang = 'ro' | 'en' | 'de' | 'fr' | 'it' | 'hu' | 'es'

export const PUBLIC_MENU_STRINGS = {
  open_now: {
    ro: 'DESCHIS ACUM',
    en: 'OPEN NOW',
    de: 'JETZT GEÖFFNET',
    fr: 'OUVERT MAINTENANT',
    it: 'APERTO ORA',
    hu: 'MOST NYITVA',
    es: 'ABIERTO AHORA',
  },
  closed: {
    ro: 'ÎNCHIS',
    en: 'CLOSED',
    de: 'GESCHLOSSEN',
    fr: 'FERMÉ',
    it: 'CHIUSO',
    hu: 'ZÁRVA',
    es: 'CERRADO',
  },
  search_placeholder: {
    ro: 'Caută în meniu...',
    en: 'Search menu...',
    de: 'Menü durchsuchen...',
    fr: 'Rechercher au menu...',
    it: 'Cerca nel menu...',
    hu: 'Keresés a menüben...',
    es: 'Buscar en el menú...',
  },
  all_categories: {
    ro: 'Toate',
    en: 'All',
    de: 'Alle',
    fr: 'Tout',
    it: 'Tutti',
    hu: 'Összes',
    es: 'Todo',
  },
  no_results: {
    ro: 'Niciun rezultat',
    en: 'No results',
    de: 'Keine Ergebnisse',
    fr: 'Aucun résultat',
    it: 'Nessun risultato',
    hu: 'Nincs találat',
    es: 'Sin resultados',
  },
  clear_filters: {
    ro: 'Șterge filtrele',
    en: 'Clear filters',
    de: 'Filter löschen',
    fr: 'Effacer les filtres',
    it: 'Cancella filtri',
    hu: 'Szűrők törlése',
    es: 'Borrar filtros',
  },
  menu_by: {
    ro: 'MENIU BY MENUVIA',
    en: 'MENU BY MENUVIA',
    de: 'MENÜ BY MENUVIA',
    fr: 'MENU BY MENUVIA',
    it: 'MENU BY MENUVIA',
    hu: 'MENÜ BY MENUVIA',
    es: 'MENÚ BY MENUVIA',
  },
  today: {
    ro: 'Astăzi',
    en: 'Today',
    de: 'Heute',
    fr: "Aujourd'hui",
    it: 'Oggi',
    hu: 'Ma',
    es: 'Hoy',
  },
  back: {
    ro: 'Înapoi',
    en: 'Back',
    de: 'Zurück',
    fr: 'Retour',
    it: 'Indietro',
    hu: 'Vissza',
    es: 'Atrás',
  },
  pickup_badge: {
    ro: 'Comandă pentru ridicare',
    en: 'Order for pickup',
    de: 'Zum Abholen bestellen',
    fr: 'Commander à emporter',
    it: 'Ordina per il ritiro',
    hu: 'Rendelés elvitelre',
    es: 'Pedir para recoger',
  },
  reserve_cta: {
    ro: 'Rezervă o masă',
    en: 'Reserve a table',
    de: 'Tisch reservieren',
    fr: 'Réserver une table',
    it: 'Prenota un tavolo',
    hu: 'Asztalfoglalás',
    es: 'Reservar una mesa',
  },
  reserve_trust: {
    ro: 'Garantăm că rezervarea ta este transmisă',
    en: 'We guarantee your reservation is received',
    de: 'Wir garantieren, dass deine Reservierung ankommt',
    fr: 'Nous garantissons la bonne réception de votre réservation',
    it: 'Garantiamo che la tua prenotazione venga ricevuta',
    hu: 'Garantáljuk, hogy foglalásod megérkezik',
    es: 'Garantizamos que tu reserva se recibe',
  },
  reserve_party_label: {
    ro: 'NUMĂRUL DE PERSOANE',
    en: 'NUMBER OF PEOPLE',
    de: 'ANZAHL DER PERSONEN',
    fr: 'NOMBRE DE PERSONNES',
    it: 'NUMERO DI PERSONE',
    hu: 'SZEMÉLYEK SZÁMA',
    es: 'NÚMERO DE PERSONAS',
  },
  reserve_date_label: {
    ro: 'DATA REZERVĂRII',
    en: 'RESERVATION DATE',
    de: 'RESERVIERUNGSDATUM',
    fr: 'DATE DE RÉSERVATION',
    it: 'DATA DELLA PRENOTAZIONE',
    hu: 'FOGLALÁS DÁTUMA',
    es: 'FECHA DE LA RESERVA',
  },
  reserve_today: {
    ro: 'Astăzi',
    en: 'Today',
    de: 'Heute',
    fr: "Aujourd'hui",
    it: 'Oggi',
    hu: 'Ma',
    es: 'Hoy',
  },
  reserve_tomorrow: {
    ro: 'Mâine',
    en: 'Tomorrow',
    de: 'Morgen',
    fr: 'Demain',
    it: 'Domani',
    hu: 'Holnap',
    es: 'Mañana',
  },
  reserve_other_date: {
    ro: 'Altă dată',
    en: 'Other date',
    de: 'Anderes Datum',
    fr: 'Autre date',
    it: 'Altra data',
    hu: 'Másik dátum',
    es: 'Otra fecha',
  },
  reserve_zone_label: {
    ro: 'ZONA',
    en: 'AREA',
    de: 'BEREICH',
    fr: 'ZONE',
    it: 'ZONA',
    hu: 'TERÜLET',
    es: 'ZONA',
  },
  reserve_zone_any: {
    ro: 'Oriunde',
    en: 'Any area',
    de: 'Überall',
    fr: "N'importe où",
    it: 'Ovunque',
    hu: 'Bárhol',
    es: 'Cualquier zona',
  },
  reserve_time_label: {
    ro: 'ORA REZERVĂRII',
    en: 'RESERVATION HOUR',
    de: 'RESERVIERUNGSZEIT',
    fr: 'HEURE DE RÉSERVATION',
    it: 'ORA DELLA PRENOTAZIONE',
    hu: 'FOGLALÁS IDŐPONTJA',
    es: 'HORA DE LA RESERVA',
  },
  reserve_contact_label: {
    ro: 'CONTACT',
    en: 'CONTACT',
    de: 'KONTAKT',
    fr: 'CONTACT',
    it: 'CONTATTO',
    hu: 'KAPCSOLAT',
    es: 'CONTACTO',
  },
  reserve_name: {
    ro: 'Nume',
    en: 'Name',
    de: 'Name',
    fr: 'Nom',
    it: 'Nome',
    hu: 'Név',
    es: 'Nombre',
  },
  reserve_phone: {
    ro: 'Telefon',
    en: 'Phone',
    de: 'Telefon',
    fr: 'Téléphone',
    it: 'Telefono',
    hu: 'Telefon',
    es: 'Teléfono',
  },
  reserve_email_opt: {
    ro: 'Email (opțional)',
    en: 'Email (optional)',
    de: 'E-Mail (optional)',
    fr: 'E-mail (facultatif)',
    it: 'Email (facoltativo)',
    hu: 'E-mail (opcionális)',
    es: 'Correo (opcional)',
  },
  reserve_notes_opt: {
    ro: 'Observații (opțional)',
    en: 'Notes (optional)',
    de: 'Anmerkungen (optional)',
    fr: 'Remarques (facultatif)',
    it: 'Note (facoltativo)',
    hu: 'Megjegyzés (opcionális)',
    es: 'Notas (opcional)',
  },
  reserve_submit: {
    ro: 'Rezervă',
    en: 'Reserve',
    de: 'Reservieren',
    fr: 'Réserver',
    it: 'Prenota',
    hu: 'Foglalás',
    es: 'Reservar',
  },
  reserve_submitting: {
    ro: 'Se trimite...',
    en: 'Sending...',
    de: 'Wird gesendet...',
    fr: 'Envoi...',
    it: 'Invio in corso...',
    hu: 'Küldés...',
    es: 'Enviando...',
  },
  reserve_success_title: {
    ro: 'Rezervare confirmată!',
    en: 'Reservation confirmed!',
    de: 'Reservierung bestätigt!',
    fr: 'Réservation confirmée !',
    it: 'Prenotazione confermata!',
    hu: 'Foglalás megerősítve!',
    es: '¡Reserva confirmada!',
  },
  reserve_pending_title: {
    ro: 'Rezervare primită',
    en: 'Reservation received',
    de: 'Reservierung erhalten',
    fr: 'Réservation reçue',
    it: 'Prenotazione ricevuta',
    hu: 'Foglalás beérkezett',
    es: 'Reserva recibida',
  },
  reserve_pending_sub: {
    ro: 'Echipa restaurantului va confirma în scurt timp.',
    en: 'The venue will confirm shortly.',
    de: 'Das Restaurant bestätigt in Kürze.',
    fr: "L'établissement confirmera sous peu.",
    it: 'Il locale confermerà a breve.',
    hu: 'Az étterem hamarosan megerősíti.',
    es: 'El local confirmará en breve.',
  },
  reserve_pending_no_table_sub: {
    ro: 'Locul tău e rezervat — ospătarul îți alocă masa la sosire.',
    en: 'Your spot is held — the waiter will assign a table on arrival.',
    de: 'Dein Platz ist reserviert — der Kellner weist dir bei Ankunft einen Tisch zu.',
    fr: "Votre place est retenue — le serveur vous attribuera une table à l'arrivée.",
    it: "Il tuo posto è riservato — il cameriere ti assegnerà un tavolo all'arrivo.",
    hu: 'A helyed foglalva van — a pincér érkezéskor asztalt jelöl ki.',
    es: 'Tu lugar está reservado — el camarero te asignará una mesa al llegar.',
  },
  reserve_code_label: {
    ro: 'COD REZERVARE',
    en: 'BOOKING CODE',
    de: 'BUCHUNGSCODE',
    fr: 'CODE DE RÉSERVATION',
    it: 'CODICE PRENOTAZIONE',
    hu: 'FOGLALÁSI KÓD',
    es: 'CÓDIGO DE RESERVA',
  },
  reserve_back_to_menu: {
    ro: 'Înapoi la meniu',
    en: 'Back to menu',
    de: 'Zurück zum Menü',
    fr: 'Retour au menu',
    it: 'Torna al menu',
    hu: 'Vissza a menühöz',
    es: 'Volver al menú',
  },
  reserve_post_paid_cta: {
    ro: 'Rezervă o masă',
    en: 'Reserve a table',
    de: 'Tisch reservieren',
    fr: 'Réserver une table',
    it: 'Prenota un tavolo',
    hu: 'Asztalfoglalás',
    es: 'Reservar una mesa',
  },
  reserve_post_paid_sub: {
    ro: 'Pentru data viitoare',
    en: 'For your next visit',
    de: 'Für deinen nächsten Besuch',
    fr: 'Pour votre prochaine visite',
    it: 'Per la tua prossima visita',
    hu: 'A következő látogatásodra',
    es: 'Para tu próxima visita',
  },
  reserve_no_slots: {
    ro: 'Nu există slot-uri disponibile',
    en: 'No available slots',
    de: 'Keine freien Zeitfenster',
    fr: 'Aucun créneau disponible',
    it: 'Nessuno slot disponibile',
    hu: 'Nincs szabad időpont',
    es: 'No hay horarios disponibles',
  },
  reserve_call_if_change: {
    ro: 'Sună dacă nu mai poți veni',
    en: 'Call if you can no longer make it',
    de: 'Ruf an, falls du nicht kommen kannst',
    fr: 'Appelez si vous ne pouvez plus venir',
    it: 'Chiama se non puoi più venire',
    hu: 'Hívj, ha mégsem tudsz jönni',
    es: 'Llama si ya no puedes venir',
  },
  reserve_email_reminder: {
    ro: 'Vei primi un email reminder înainte de vizită.',
    en: 'You will receive an email reminder before your visit.',
    de: 'Du erhältst vor deinem Besuch eine Erinnerungs-E-Mail.',
    fr: 'Vous recevrez un e-mail de rappel avant votre visite.',
    it: 'Riceverai un promemoria via email prima della visita.',
    hu: 'A látogatásod előtt emlékeztető e-mailt kapsz.',
    es: 'Recibirás un correo recordatorio antes de tu visita.',
  },
  // Alegerea mesei pe harta sălii (secțiune opțională, apare doar cu floor plan).
  reserve_add_another: {
    ro: '+ Rezervă altă masă',
    en: '+ Book another table',
    de: '+ Weiteren Tisch reservieren',
    fr: '+ Réserver une autre table',
    it: '+ Prenota un altro tavolo',
    hu: '+ Másik asztal foglalása',
    es: '+ Reservar otra mesa',
  },
  reserve_pick_table_label: {
    ro: 'ALEGE MASA (OPȚIONAL)',
    en: 'CHOOSE A TABLE (OPTIONAL)',
    de: 'TISCH WÄHLEN (OPTIONAL)',
    fr: 'CHOISIR UNE TABLE (FACULTATIF)',
    it: 'SCEGLI UN TAVOLO (FACOLTATIVO)',
    hu: 'VÁLASSZ ASZTALT (OPCIONÁLIS)',
    es: 'ELIGE UNA MESA (OPCIONAL)',
  },
  reserve_any_free_table: {
    ro: 'Oricare masă liberă',
    en: 'Any free table',
    de: 'Beliebiger freier Tisch',
    fr: "N'importe quelle table libre",
    it: 'Qualsiasi tavolo libero',
    hu: 'Bármelyik szabad asztal',
    es: 'Cualquier mesa libre',
  },
  reserve_pick_table_hint: {
    ro: 'Atinge o masă liberă pentru a o alege, sau lasă „Oricare masă liberă" pentru alocare automată.',
    en: 'Tap a free table to pick it, or keep “Any free table” for automatic assignment.',
    de: 'Tippe auf einen freien Tisch, um ihn zu wählen, oder behalte „Beliebiger freier Tisch“ für die automatische Zuweisung.',
    fr: 'Touchez une table libre pour la choisir, ou gardez « N’importe quelle table libre » pour une attribution automatique.',
    it: 'Tocca un tavolo libero per sceglierlo, oppure lascia «Qualsiasi tavolo libero» per l’assegnazione automatica.',
    hu: 'Érints meg egy szabad asztalt a kiválasztáshoz, vagy hagyd a „Bármelyik szabad asztal“ opciót az automatikus kijelöléshez.',
    es: 'Toca una mesa libre para elegirla, o deja «Cualquier mesa libre» para la asignación automática.',
  },
  reserve_map_loading: {
    ro: 'Se încarcă harta sălii…',
    en: 'Loading floor plan…',
    de: 'Saalplan wird geladen…',
    fr: 'Chargement du plan de salle…',
    it: 'Caricamento della piantina…',
    hu: 'Teremtérkép betöltése…',
    es: 'Cargando el plano de la sala…',
  },
  reserve_map_error: {
    ro: 'Harta sălii nu s-a putut încărca — poți continua cu alocare automată.',
    en: 'The floor plan could not be loaded — you can continue with automatic assignment.',
    de: 'Der Saalplan konnte nicht geladen werden — du kannst mit automatischer Zuweisung fortfahren.',
    fr: 'Le plan de salle n’a pas pu être chargé — vous pouvez continuer avec une attribution automatique.',
    it: 'Impossibile caricare la piantina — puoi continuare con l’assegnazione automatica.',
    hu: 'A teremtérképet nem sikerült betölteni — folytathatod az automatikus kijelöléssel.',
    es: 'No se pudo cargar el plano de la sala — puedes continuar con la asignación automática.',
  },
  reserve_seats_word: {
    ro: 'locuri',
    en: 'seats',
    de: 'Plätze',
    fr: 'places',
    it: 'posti',
    hu: 'férőhely',
    es: 'plazas',
  },
  reserve_deselect_table: {
    ro: 'Deselectează masa',
    en: 'Deselect table',
    de: 'Tischauswahl aufheben',
    fr: 'Désélectionner la table',
    it: 'Deseleziona il tavolo',
    hu: 'Asztal kijelölésének visszavonása',
    es: 'Anular selección de mesa',
  },
  // Banner Happy Hour (prefixul; sufixele -%/-lei rămân în afara dicționarului).
  happy_hour_active: {
    ro: 'Happy Hour activ:',
    en: 'Happy Hour active:',
    de: 'Happy Hour aktiv:',
    fr: 'Happy Hour actif :',
    it: 'Happy Hour attivo:',
    hu: 'Happy Hour aktív:',
    es: 'Happy Hour activo:',
  },
  // Bara sticky + sheet-ul „Lista mea" (meniu digital fără comenzi).
  my_list: {
    ro: 'Lista mea',
    en: 'My list',
    de: 'Meine Liste',
    fr: 'Ma liste',
    it: 'La mia lista',
    hu: 'Listám',
    es: 'Mi lista',
  },
  view_cart: {
    ro: 'Vezi coșul',
    en: 'View cart',
    de: 'Warenkorb ansehen',
    fr: 'Voir le panier',
    it: 'Vedi il carrello',
    hu: 'Kosár megtekintése',
    es: 'Ver el carrito',
  },
  // Plural produs/produse (en: item/items — pluralul e ales de apelant pe count).
  item_one: {
    ro: 'produs',
    en: 'item',
    de: 'Artikel',
    fr: 'article',
    it: 'articolo',
    hu: 'termék',
    es: 'artículo',
  },
  item_many: {
    ro: 'produse',
    en: 'items',
    de: 'Artikel',
    fr: 'articles',
    it: 'articoli',
    hu: 'termék',
    es: 'artículos',
  },
  in_my_list: {
    ro: 'în lista mea',
    en: 'in my list',
    de: 'in meiner Liste',
    fr: 'dans ma liste',
    it: 'nella mia lista',
    hu: 'a listámon',
    es: 'en mi lista',
  },
  in_cart: {
    ro: 'în coș',
    en: 'in cart',
    de: 'im Warenkorb',
    fr: 'dans le panier',
    it: 'nel carrello',
    hu: 'a kosárban',
    es: 'en el carrito',
  },
  list_hint: {
    ro: 'Lista mea · atinge un produs ca să adaugi',
    en: 'My list · tap a product to add',
    de: 'Meine Liste · tippe auf ein Produkt zum Hinzufügen',
    fr: 'Ma liste · touchez un produit pour l’ajouter',
    it: 'La mia lista · tocca un prodotto per aggiungerlo',
    hu: 'Listám · érints meg egy terméket a hozzáadáshoz',
    es: 'Mi lista · toca un producto para añadirlo',
  },
  order_yours: {
    ro: 'Comanda ta',
    en: 'Your order',
    de: 'Deine Bestellung',
    fr: 'Votre commande',
    it: 'Il tuo ordine',
    hu: 'A rendelésed',
    es: 'Tu pedido',
  },
  list_subtitle: {
    ro: 'Ce vrei să iei — salvat pe telefonul tău. Arată-i ospătarului când comanzi.',
    en: 'What you want to get — saved on your phone. Show it to the waiter when you order.',
    de: 'Was du möchtest — auf deinem Handy gespeichert. Zeig es dem Kellner beim Bestellen.',
    fr: 'Ce que vous voulez prendre — enregistré sur votre téléphone. Montrez-le au serveur au moment de commander.',
    it: 'Cosa vuoi prendere — salvato sul tuo telefono. Mostralo al cameriere quando ordini.',
    hu: 'Amit szeretnél — a telefonodra mentve. Mutasd meg a pincérnek, amikor rendelsz.',
    es: 'Lo que quieres pedir — guardado en tu teléfono. Muéstraselo al camarero al ordenar.',
  },
  list_empty: {
    ro: 'Lista e goală. Atinge un produs din meniu ca să-l adaugi aici.',
    en: 'Your list is empty. Tap a product in the menu to add it here.',
    de: 'Deine Liste ist leer. Tippe im Menü auf ein Produkt, um es hier hinzuzufügen.',
    fr: 'Votre liste est vide. Touchez un produit du menu pour l’ajouter ici.',
    it: 'La tua lista è vuota. Tocca un prodotto nel menu per aggiungerlo qui.',
    hu: 'A listád üres. Érints meg egy terméket a menüből, hogy ide add.',
    es: 'Tu lista está vacía. Toca un producto del menú para añadirlo aquí.',
  },
  remove: {
    ro: 'Elimină',
    en: 'Remove',
    de: 'Entfernen',
    fr: 'Retirer',
    it: 'Rimuovi',
    hu: 'Eltávolítás',
    es: 'Quitar',
  },
  total: {
    ro: 'Total',
    en: 'Total',
    de: 'Gesamt',
    fr: 'Total',
    it: 'Totale',
    hu: 'Összesen',
    es: 'Total',
  },
  clear_list: {
    ro: 'Golește lista',
    en: 'Clear list',
    de: 'Liste leeren',
    fr: 'Vider la liste',
    it: 'Svuota la lista',
    hu: 'Lista ürítése',
    es: 'Vaciar la lista',
  },
  close: {
    ro: 'Închide',
    en: 'Close',
    de: 'Schließen',
    fr: 'Fermer',
    it: 'Chiudi',
    hu: 'Bezárás',
    es: 'Cerrar',
  },
} as const

export type PublicMenuStringKey = keyof typeof PUBLIC_MENU_STRINGS

const SUPPORTED_PUBLIC_MENU_LANGS: readonly PublicMenuLang[] = [
  'ro',
  'en',
  'de',
  'fr',
  'it',
  'hu',
  'es',
]

export function T(lang: string | null | undefined, key: PublicMenuStringKey): string {
  const normalized: PublicMenuLang = (SUPPORTED_PUBLIC_MENU_LANGS as readonly string[]).includes(
    lang ?? '',
  )
    ? (lang as PublicMenuLang)
    : 'en'
  return PUBLIC_MENU_STRINGS[key][normalized]
}

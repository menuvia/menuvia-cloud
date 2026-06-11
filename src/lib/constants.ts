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
  t3: '#4A4844',
  green: '#4CAF6E',
  greenA: 'rgba(76,175,110,0.12)',
  red: '#E05555',
  redA: 'rgba(224,85,85,0.12)',
  amber: '#E8A020',
  border: 'rgba(255,255,255,0.07)',
  bHov: 'rgba(255,255,255,0.13)',
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
  red: cssVar('--color-danger', D_RAW.red),
  redA: cssVar('--color-danger-bg', D_RAW.redA),
  amber: cssVar('--color-warning', D_RAW.amber),
  border: cssVar('--color-border', D_RAW.border),
  bHov: cssVar('--color-border-hover', D_RAW.bHov),
} as const

export type OrderStatus =
  | 'new'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'paid'
  | 'cancelled'
export type OrderSource = 'qr' | 'waiter' | 'pickup'
export type PaymentMethod = 'cash' | 'card_pos' | 'other'
export type MemberRole = 'owner' | 'manager' | 'waiter' | 'kitchen'

export const STATUS_META: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  new: { label: 'Nou', color: D.t2, bg: D.s3 },
  confirmed: { label: 'Confirmat', color: D.amber, bg: 'rgba(232,160,32,0.12)' },
  preparing: { label: 'În preparare', color: D.goldL, bg: D.goldA },
  ready: { label: 'Gata de servit', color: D.green, bg: 'rgba(76,175,110,0.12)' },
  served: { label: 'Servit', color: '#7EB8F7', bg: 'rgba(126,184,247,0.12)' },
  paid: { label: 'Plătit', color: D.t3, bg: D.s2 },
  cancelled: { label: 'Anulat', color: D.red, bg: 'rgba(224,85,85,0.10)' },
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
export const PLAN_LABELS: Record<string, string> = {
  free: 'Demo gratuit',
  starter: 'Meniu Digital',
  growth: 'Meniu + Comenzi',
  pro: 'Fiscalizare',
  enterprise: 'Custom / Lanțuri',
  business: 'Business', // legacy — conturi vechi pre-rebranding
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
// Restaurantele cu language ∉ {ro, en} primesc fallback EN.
type PublicMenuLang = 'ro' | 'en'

export const PUBLIC_MENU_STRINGS = {
  open_now: { ro: 'DESCHIS ACUM', en: 'OPEN NOW' },
  closed: { ro: 'ÎNCHIS', en: 'CLOSED' },
  search_placeholder: { ro: 'Caută în meniu...', en: 'Search menu...' },
  all_categories: { ro: 'Toate', en: 'All' },
  no_results: { ro: 'Niciun rezultat', en: 'No results' },
  clear_filters: { ro: 'Șterge filtrele', en: 'Clear filters' },
  menu_by: { ro: 'MENIU BY MENUVIA', en: 'MENU BY MENUVIA' },
  today: { ro: 'Astăzi', en: 'Today' },
  back: { ro: 'Înapoi', en: 'Back' },
  pickup_badge: { ro: 'Comandă pentru ridicare', en: 'Order for pickup' },
  reserve_cta: { ro: 'Rezervă o masă', en: 'Reserve a table' },
  reserve_trust: {
    ro: 'Garantăm că rezervarea ta este transmisă',
    en: 'We guarantee your reservation is received',
  },
  reserve_party_label: { ro: 'NUMĂRUL DE PERSOANE', en: 'NUMBER OF PEOPLE' },
  reserve_date_label: { ro: 'DATA REZERVĂRII', en: 'RESERVATION DATE' },
  reserve_today: { ro: 'Astăzi', en: 'Today' },
  reserve_tomorrow: { ro: 'Mâine', en: 'Tomorrow' },
  reserve_other_date: { ro: 'Altă dată', en: 'Other date' },
  reserve_zone_label: { ro: 'ZONA', en: 'AREA' },
  reserve_zone_any: { ro: 'Oriunde', en: 'Any area' },
  reserve_time_label: { ro: 'ORA REZERVĂRII', en: 'RESERVATION HOUR' },
  reserve_contact_label: { ro: 'CONTACT', en: 'CONTACT' },
  reserve_name: { ro: 'Nume', en: 'Name' },
  reserve_phone: { ro: 'Telefon', en: 'Phone' },
  reserve_email_opt: { ro: 'Email (opțional)', en: 'Email (optional)' },
  reserve_notes_opt: { ro: 'Observații (opțional)', en: 'Notes (optional)' },
  reserve_submit: { ro: 'Rezervă', en: 'Reserve' },
  reserve_submitting: { ro: 'Se trimite...', en: 'Sending...' },
  reserve_success_title: { ro: 'Rezervare confirmată!', en: 'Reservation confirmed!' },
  reserve_pending_title: { ro: 'Rezervare primită', en: 'Reservation received' },
  reserve_pending_sub: {
    ro: 'Echipa restaurantului va confirma în scurt timp.',
    en: 'The venue will confirm shortly.',
  },
  reserve_pending_no_table_sub: {
    ro: 'Locul tău e rezervat — ospătarul îți alocă masa la sosire.',
    en: 'Your spot is held — the waiter will assign a table on arrival.',
  },
  reserve_code_label: { ro: 'COD REZERVARE', en: 'BOOKING CODE' },
  reserve_back_to_menu: { ro: 'Înapoi la meniu', en: 'Back to menu' },
  reserve_post_paid_cta: { ro: 'Rezervă o masă', en: 'Reserve a table' },
  reserve_post_paid_sub: { ro: 'Pentru data viitoare', en: 'For your next visit' },
  reserve_no_slots: {
    ro: 'Nu există slot-uri disponibile',
    en: 'No available slots',
  },
  reserve_call_if_change: {
    ro: 'Sună dacă nu mai poți veni',
    en: 'Call if you can no longer make it',
  },
  reserve_email_reminder: {
    ro: 'Vei primi un email reminder înainte de vizită.',
    en: 'You will receive an email reminder before your visit.',
  },
} as const

export type PublicMenuStringKey = keyof typeof PUBLIC_MENU_STRINGS

export function T(lang: string | null | undefined, key: PublicMenuStringKey): string {
  const normalized: PublicMenuLang = lang === 'ro' ? 'ro' : 'en'
  return PUBLIC_MENU_STRINGS[key][normalized]
}

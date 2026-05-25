export const D = {
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

export const PLAN_LABELS: Record<string, string> = {
  free: 'Meniu Gratuit',
  pro: 'Comenzi Pro',
  business: 'Business',
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
  { id: 'vegetarian', label: 'Vegetarian', emoji: '🥗', color: '#4CAF6E' },
  { id: 'vegan', label: 'Vegan', emoji: '🌱', color: '#388E3C' },
  { id: 'fara-gluten', label: 'Fără gluten', emoji: '🚫🌾', color: '#E8A020' },
  { id: 'fara-lactoza', label: 'Fără lactoză', emoji: '🚫🥛', color: '#E8A020' },
  { id: 'picant', label: 'Picant', emoji: '🌶️', color: '#E05555' },
  { id: 'raw', label: 'Raw', emoji: '🥬', color: '#66BB6A' },
] as const

export type DietaryTagId = (typeof DIETARY_TAGS)[number]['id']

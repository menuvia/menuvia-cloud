// ─────────────────────────────────────────────────────────────
// plans.ts — Sursa de adevăr pentru cele 3 planuri comerciale.
// PricingPage, UpgradeModal, UpgradePrompt și fallback-ul de limite
// citesc TOATE de aici. DB (plan_limits + plan_features) trebuie aliniat
// cu mig 089.
// ─────────────────────────────────────────────────────────────
// Reguli de copy (impuse comercial):
//   - NU scrie „nelimitat" dacă limita e finită.
//   - NU scrie „Fără card" decât dacă Stripe permite trial fără card.
//   - NU folosi „Pro" ca text vizibil clientului — e id intern.
//   - Fără termeni tehnici (Modifiers, KDS, FiscalNet) — copy în română umană.
//   - Mesaj central: Meniu Digital = QR. Meniu + Comenzi = comenzi QR.
//     Fiscalizare = bon fiscal, TVA, casă.
// ─────────────────────────────────────────────────────────────

export type PlanId = 'starter' | 'growth' | 'pro'

export interface PlanLimits {
  maxProducts: number
  maxTables: number
  maxTeamMembers: number
}

export interface Plan {
  id: PlanId
  name: string // numele vizibil clientului — NICIODATĂ „Pro"/„Growth"
  emoji: string
  priceMonthly: number // lei/lună la billing lunar
  priceYearly: number // lei/lună la billing anual (~17% reducere)
  badge: string | null
  tagline: string
  // Features pozitive (apar cu ✓ pe card). Limitele importante sunt
  // duplicate aici ca text uman, pentru claritate pe pagina de pricing.
  included: string[]
  // Lucruri marcate explicit ca „nu" pe planurile mai mici, ca să fie
  // clar ce câștigi când urci. Lasă gol dacă lista de included e suficientă.
  notIncluded: string[]
  limits: PlanLimits
  ctaLabel: string // textul pe buton — niciodată „Pro" sau „Upgrade"
  highlight: boolean // card recomandat (scalat + badge)
}

// ── Cele 3 planuri ──────────────────────────────────────────

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Meniu Digital',
    emoji: '📖',
    priceMonthly: 99,
    priceYearly: 83,
    badge: null,
    tagline: 'Meniul tău, frumos, pe telefonul clientului. QR pe masă în 15 minute.',
    included: [
      'QR-uri pe mese — clienții văd meniul pe telefon',
      'Până la 300 de produse',
      'Până la 120 mese / QR-uri',
      'Imagini la produse',
      'Alergeni + dietetic',
      'Multilingv RO/EN',
    ],
    notIncluded: ['Comenzi prin QR', 'Dashboard bucătărie'],
    limits: { maxProducts: 300, maxTables: 120, maxTeamMembers: 1 },
    ctaLabel: 'Activează Meniu Digital',
    highlight: false,
  },
  {
    id: 'growth',
    name: 'Meniu + Comenzi',
    emoji: '🛎',
    priceMonthly: 249,
    priceYearly: 208,
    badge: 'Recomandat',
    tagline: 'Clienții comandă singuri de la masă. Plata și bonul rămân pe casa ta actuală.',
    included: [
      'Tot din Meniu Digital +',
      'Până la 1.000 de produse',
      'Până la 300 mese active / QR-uri',
      'Aceleași QR-uri activează comenzile — fără re-printare',
      'Identificare automată a mesei',
      'Dashboard bucătărie',
      'Flux ospătar (preluare + închidere comandă)',
      'Rapoarte zilnice + săptămânale',
      'Echipă până la 10 membri',
      'Mod offline pentru ospătari',
      'Fără branding Menuvia',
    ],
    notIncluded: ['Plăți și bon fiscal în aplicație', 'TVA, casă, facturi'],
    limits: { maxProducts: 1000, maxTables: 300, maxTeamMembers: 10 },
    ctaLabel: 'Activează Meniu + Comenzi',
    highlight: true,
  },
  {
    id: 'pro',
    name: 'Fiscalizare',
    emoji: '🧾',
    priceMonthly: 499,
    priceYearly: 415,
    badge: 'Pilot',
    tagline: 'Plăți și bon fiscal direct din aplicație, pe casa ta de marcat.',
    included: [
      'Tot din Meniu + Comenzi +',
      'Până la 2.000 de produse',
      'Până la 500 mese active / QR-uri',
      'Plăți în aplicație: cash, card, plata împărțită',
      'Bon fiscal pe casa ta (Datecs / Activa / Tremol)',
      'Raport TVA + Încasări pe zi/tură',
      'Facturi (integrare Oblio)',
      'Gestiune stocuri + rețete',
      'Program echipă (alocare mese, ture)',
      'Suport prioritar (răspuns în 4 ore)',
    ],
    notIncluded: [],
    limits: { maxProducts: 2000, maxTables: 500, maxTeamMembers: 1000 },
    ctaLabel: 'Discută cu noi (pilot)',
    highlight: false,
  },
]

// ── Helpers ─────────────────────────────────────────────────

const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p]),
) as Record<PlanId, Plan>

export function getPlan(id: PlanId): Plan {
  return PLAN_BY_ID[id]
}

// Mapping intern → tier comercial pentru codul existent:
//   free/starter → 'starter' (Meniu Digital — free e demo/trial)
//   growth       → 'growth'  (Meniu + Comenzi)
//   pro/enterprise → 'pro'   (Fiscalizare — enterprise e tot tier 3)
export function getPlanByInternalId(internal: string): Plan {
  if (internal === 'growth') return PLAN_BY_ID.growth
  if (internal === 'pro' || internal === 'enterprise') return PLAN_BY_ID.pro
  return PLAN_BY_ID.starter
}

// Trust signals afișate sub grila de planuri — adevărate, verificate.
// „Fără card pentru trial" NU apare aici: până nu confirmăm că Stripe
// Checkout poate fi configurat fără card, nu promitem.
export const TRUST_SIGNALS = [
  { icon: '🎁', label: '30 zile gratuite', desc: 'Anulezi cu un click, fără penalizări.' },
  { icon: '🔄', label: 'Migrare gratuită', desc: 'Îți mutăm meniul de la alt sistem.' },
  { icon: '🛟', label: 'Suport WhatsApp', desc: 'Direct cu Radu, fondatorul.' },
  { icon: '🏪', label: 'Plătești per restaurant', desc: 'Nu per cont. Lanțurile au ofertă custom.' },
]

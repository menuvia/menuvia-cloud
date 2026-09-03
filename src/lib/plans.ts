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
  priceMonthly: number // lei/lună la billing lunar — SINGURUL preț facturabil
  // NU adăuga `priceYearly` înapoi ca simplu câmp de afișare (audit v3,
  // rangul 11): pagina de prețuri arăta un preț anual pe care sistemul nu-l
  // putea încasa — checkout-ul pornea oricum abonamentul LUNAR, la prețul
  // lunar. Facturarea anuală cere, în ordine: prețuri anuale în Stripe, câte
  // un env var nou per plan (atenție, `stripe-checkout.js` are `.every(Boolean)`
  // la boot, deci devin obligatorii), un parametru de perioadă dus prin
  // `onCheckout` → `stripe-checkout.js`, ȘI intrările corespunzătoare în
  // `PLAN_BY_PRICE` din `stripe-webhook.js` (altfel webhook-ul nu recunoaște
  // abonamentul anual și îl tratează ca plan necunoscut).
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
    name: 'Meniu Digital + Rezervări',
    emoji: '📖',
    priceMonthly: 99,
    badge: null,
    tagline: 'Meniul tău, frumos, pe telefonul clientului. QR pe masă în 15 minute.',
    included: [
      'Meniu QR digital',
      'Până la 300 de produse',
      'Până la 120 mese / QR-uri',
      'Imagini la produse',
      'Alergeni + valori nutriționale',
      'Meniu în 7 limbi (RO, EN, DE, FR, IT, HU, ES)',
      'Teme premium + stil flipbook',
      'Import meniu din poze, cu AI',
      'Rezervări online + link pentru butonul Google',
      'Confirmări și remindere pe SMS (100/lună)',
    ],
    notIncluded: ['Comenzi prin QR', 'Dashboard bucătărie'],
    limits: { maxProducts: 300, maxTables: 120, maxTeamMembers: 1 },
    ctaLabel: 'Activează Meniu Digital',
    highlight: false,
  },
  {
    id: 'growth',
    name: 'Meniu + Comenzi',
    emoji: '🛎️',
    priceMonthly: 249,
    badge: 'Recomandat',
    tagline: 'Clienții comandă singuri de la masă. Plata și bonul rămân pe casa ta actuală.',
    included: [
      'Tot din Meniu Digital +',
      'Până la 1.000 de produse',
      'Până la 300 mese / QR-uri',
      'Comenzi prin QR (identificare automată a mesei)',
      'Dashboard bucătărie + flux ospătar',
      'Pre-comandă pentru ridicare (pickup)',
      'Promoții Happy Hour automate',
      'Program de fidelizare (puncte + recompense)',
      '„Cere nota" cu bacșiș, din telefonul clientului',
      'Recenzii Google după comandă',
      'Gestiune stocuri + rețete',
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
    badge: 'Pilot',
    tagline: 'Plăți și bon fiscal direct din aplicație, pe casa ta de marcat.',
    included: [
      'Tot din Meniu + Comenzi +',
      'Până la 2.000 de produse',
      'Până la 500 mese / QR-uri',
      'Plăți în aplicație: cash, card, plata împărțită',
      'Plata online la masă, din telefonul clientului',
      'Bon fiscal pe casa ta (Datecs / Activa / Tremol)',
      'Raport TVA + Încasări pe zi/tură',
      'Facturi (integrare Oblio)',
      'Hartă sală + panou live „Stadiu mese"',
      'Rezervări cu alegerea mesei pe hartă',
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

const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(PLANS.map((p) => [p.id, p])) as Record<
  PlanId,
  Plan
>

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

// ── Tabel comparativ (secțiunea „Compară planurile în detaliu") ──
// Valorile vin din PLANS.limits + included/notIncluded de mai sus și din
// gating-ul REAL din plan_features (mig 028+): stocuri/rețete = growth+,
// fără branding = growth+ (remove_branding), plăți online la masă = pro
// (online_payments, mig 203), hartă sală = pro (floor_plan), rezervări =
// modul pe orice plan (mig 086; tier 1 capacitate, tier 2+ complet, harta
// publică cere floor_layout → efectiv pro). Cotele AI = plan_limits
// .ai_imports_month (2/20/50). boolean → bifă/liniuță în UI, string → text
// scurt. Ține rândurile sincronizate cu PLANS și cu DB la orice schimbare.
export interface PlanComparisonRow {
  label: string
  starter: string | boolean
  growth: string | boolean
  pro: string | boolean
}

export const PLAN_COMPARISON: PlanComparisonRow[] = [
  {
    label: 'Produse în meniu',
    starter: 'Până la 300',
    growth: 'Până la 1.000',
    pro: 'Până la 2.000',
  },
  { label: 'Mese / QR-uri', starter: 'Până la 120', growth: 'Până la 300', pro: 'Până la 500' },
  { label: 'Meniu în 7 limbi', starter: true, growth: true, pro: true },
  { label: 'Teme premium + flipbook', starter: true, growth: true, pro: true },
  {
    label: 'Import meniu din poze (AI)',
    starter: '2 / lună',
    growth: '20 / lună',
    pro: '50 / lună',
  },
  { label: 'Comenzi prin QR', starter: false, growth: true, pro: true },
  { label: 'Dashboard bucătărie', starter: false, growth: true, pro: true },
  { label: 'Flux ospătar', starter: false, growth: true, pro: true },
  { label: 'Pre-comandă pentru ridicare (pickup)', starter: false, growth: true, pro: true },
  { label: 'Promoții Happy Hour automate', starter: false, growth: true, pro: true },
  { label: 'Fidelizare (puncte + recompense)', starter: false, growth: true, pro: true },
  { label: 'Recenzii Google după comandă', starter: false, growth: true, pro: true },
  { label: 'Fără branding Menuvia', starter: false, growth: true, pro: true },
  { label: 'Stocuri', starter: false, growth: 'Stocuri + rețete', pro: 'Stocuri + rețete' },
  {
    label: 'Rapoarte',
    starter: false,
    growth: 'Zilnice + săptămânale',
    pro: 'Zilnice + săptămânale + TVA/tură',
  },
  { label: 'Membri echipă', starter: '1', growth: 'Până la 10', pro: 'Până la 1.000' },
  {
    label: 'Plăți în aplicație',
    starter: false,
    growth: false,
    pro: 'Cash, card, plată împărțită',
  },
  {
    label: 'Plata online la masă (clientul plătește din telefon)',
    starter: false,
    growth: false,
    pro: 'Card, în lei',
  },
  {
    label: 'Bon fiscal + casă de marcat',
    starter: false,
    growth: false,
    pro: 'Datecs / Activa / Tremol',
  },
  { label: 'Facturi Oblio', starter: false, growth: false, pro: true },
  {
    label: 'Hartă sală + panou „Stadiu mese"',
    starter: false,
    growth: false,
    pro: true,
  },
  {
    label: 'Rezervări',
    starter: 'Agendă simplă',
    growth: 'Complete',
    pro: 'Complete + alegerea mesei pe hartă',
  },
]

// Trust signals afișate sub grila de planuri — adevărate, verificate.
// „Fără card pentru trial" NU apare aici: până nu confirmăm că Stripe
// Checkout poate fi configurat fără card, nu promitem.
export const TRUST_SIGNALS = [
  { icon: '🎁', label: '30 zile gratuite', desc: 'Anulezi cu un click, fără penalizări.' },
  { icon: '🔄', label: 'Migrare gratuită', desc: 'Îți mutăm meniul de la alt sistem.' },
  { icon: '🛟', label: 'Suport WhatsApp', desc: 'Direct cu Radu, fondatorul.' },
  {
    icon: '🏪',
    label: 'Plătești per restaurant',
    desc: 'Nu per cont. Lanțurile au ofertă custom.',
  },
]

// agentContact.ts — logică PURĂ pentru cardul „Agentul tău Menuvia” și butonul
// „Ajutor” (mig 303). Fără importuri: se testează fără DOM și fără Supabase.
//
// Contractul `get_my_agent(p_restaurant)` (lista albă din DB):
//   {has_agent:false}                                    — fără agent / atribuire
//                                                          terminală / agent neactiv
//   {has_agent:true, attribution_id, agent_name, contact_shared, phone, email,
//    access_state, can_manage}
// `phone`/`email` sunt non-null DOAR când agentul a consimțit la partajare ȘI
// apelantul e ownerul real; clientul NU decide asta (nu are de unde) — doar
// validează forma și construiește linkuri sigure din valori ne-încredere.

export type AgentAccessState = 'none' | 'requested' | 'granted' | 'revoked'

export interface MyAgent {
  has_agent: true
  attribution_id: string
  agent_name: string | null
  contact_shared: boolean
  phone: string | null
  email: string | null
  access_state: AgentAccessState
  can_manage: boolean
}

export type MyAgentResult = { has_agent: false } | MyAgent

const ACCESS_STATES: readonly string[] = ['none', 'requested', 'granted', 'revoked']

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function strOrNull(v: unknown): string | null | undefined {
  if (v === null) return null
  if (typeof v === 'string') return v
  return undefined // formă necunoscută
}

/**
 * Validează răspunsul RPC. `null` = formă necunoscută (UI-ul NU randează nimic:
 * un buton „Permite accesul” construit pe date pe care nu le înțelegem ar fi
 * mai rău decât lipsa lui — tristate, fail-closed).
 */
export function parseMyAgent(raw: unknown): MyAgentResult | null {
  if (!isObj(raw)) return null
  if (raw.has_agent === false) return { has_agent: false }
  if (raw.has_agent !== true) return null
  const name = strOrNull(raw.agent_name)
  const phone = strOrNull(raw.phone)
  const email = strOrNull(raw.email)
  if (
    typeof raw.attribution_id !== 'string' ||
    raw.attribution_id.length === 0 ||
    name === undefined ||
    phone === undefined ||
    email === undefined ||
    typeof raw.contact_shared !== 'boolean' ||
    typeof raw.can_manage !== 'boolean' ||
    typeof raw.access_state !== 'string' ||
    !ACCESS_STATES.includes(raw.access_state)
  ) {
    return null
  }
  return {
    has_agent: true,
    attribution_id: raw.attribution_id,
    agent_name: name && name.trim() ? name.trim() : null,
    contact_shared: raw.contact_shared,
    phone,
    email,
    access_state: raw.access_state as AgentAccessState,
    can_manage: raw.can_manage,
  }
}

// ── Ce poate și ce NU poate agentul (textul din mig 286, arătat înainte de buton) ──
export const AGENT_ACCESS_SCOPE_TEXT =
  'Agentul vede și poate edita DOAR meniul (categorii, produse, opțiuni) și mesele cu codurile QR. ' +
  'NU vede comenzile, încasările, rezervările, datele fiscale, setările sau echipa. ' +
  'Nu îți afectează abonamentul și îl poți retrage oricând.'

export interface AgentAccessView {
  label: string
  tone: 'ok' | 'wait' | 'neutral'
}

export function describeAgentAccess(state: AgentAccessState): AgentAccessView {
  switch (state) {
    case 'granted':
      return { label: 'Acces acordat', tone: 'ok' }
    case 'requested':
      return { label: 'Agentul a cerut acces', tone: 'wait' }
    case 'revoked':
      return { label: 'Acces retras', tone: 'neutral' }
    default:
      return { label: 'Fără acces', tone: 'neutral' }
  }
}

// ── Linkuri de contact din valori ne-încredere ────────────────────────────────
// Telefonul și emailul vin din câmpuri scrise de agent; ajung în `href`. Deci:
// reconstruim linkul DOAR din cifre / un email validat, niciodată din textul brut.

/** Cifrele internaționale (fără +) ale unui număr, sau null. România: 07… → 407…. */
function internationalDigits(phone: string): string | null {
  const trimmed = phone.trim()
  if (!/^\+?[0-9 ()./-]{5,32}$/.test(trimmed)) return null
  const hasPlus = trimmed.startsWith('+')
  let d = trimmed.replace(/\D/g, '')
  if (!hasPlus && d.startsWith('00')) d = d.slice(2)
  else if (!hasPlus && d.startsWith('0')) {
    // Prefix național: știm să-l completăm doar pentru România (10 cifre cu 0 în
    // față: 07… mobil, 02…/03… fix). Orice alt format național → fără link
    // (un prefix ghicit greșit ar suna/scrie altcuiva).
    if (d.length === 10) d = '4' + d
    else return null
  }
  return d.length >= 8 && d.length <= 15 ? d : null
}

/** `tel:` din cifre; null dacă numărul nu arată a telefon. */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null
  const d = internationalDigits(phone)
  return d ? `tel:+${d}` : null
}

/** Link WhatsApp (`wa.me/<cifre>`); null când nu putem deduce prefixul internațional. */
export function whatsappHref(phone: string | null | undefined): string | null {
  if (!phone) return null
  const d = internationalDigits(phone)
  return d ? `https://wa.me/${d}` : null
}

/** `mailto:` pentru un email plauzibil; null altfel. */
export function mailtoHref(email: string | null | undefined): string | null {
  if (!email) return null
  const e = email.trim()
  if (e.length > 254 || !/^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/.test(e)) return null
  return `mailto:${e}`
}

// ── Butonul „Ajutor” ──────────────────────────────────────────────────────────
export type HelpActionKind = 'call' | 'whatsapp' | 'email'

export interface HelpAction {
  kind: HelpActionKind
  label: string
  href: string
}

export interface HelpOptions {
  /** 'agent' = contactul agentului (cu consimțământ); 'support' = adresa de suport. */
  source: 'agent' | 'support'
  agentName: string | null
  actions: HelpAction[]
}

/**
 * Cine răspunde la „Ajutor”: agentul, DOAR dacă a consimțit la partajarea
 * contactului (get_my_agent întoarce telefonul/emailul doar atunci) și are cel
 * puțin un canal valid; altfel adresa de suport. Fără termene de răspuns —
 * textul promite un canal, nu un timp.
 */
export function buildHelpOptions(agent: MyAgentResult | null, supportEmail: string): HelpOptions {
  if (agent && agent.has_agent && agent.contact_shared) {
    const actions: HelpAction[] = []
    const tel = telHref(agent.phone)
    if (tel) actions.push({ kind: 'call', label: 'Sună agentul', href: tel })
    const wa = whatsappHref(agent.phone)
    if (wa) actions.push({ kind: 'whatsapp', label: 'WhatsApp', href: wa })
    const mail = mailtoHref(agent.email)
    if (mail) actions.push({ kind: 'email', label: 'Scrie pe email', href: mail })
    if (actions.length > 0) return { source: 'agent', agentName: agent.agent_name, actions }
  }
  const support = mailtoHref(supportEmail)
  return {
    source: 'support',
    agentName: null,
    actions: support ? [{ kind: 'email', label: 'Scrie-ne pe email', href: support }] : [],
  }
}

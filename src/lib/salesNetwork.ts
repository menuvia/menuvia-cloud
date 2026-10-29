// =============================================================
// Menuvia — src/lib/salesNetwork.ts
// Rețeaua de vânzări pe INVITAȚII (mig 304, pachetul 8a): stratul de client.
//
// Aici stau doar tipurile, apelurile RPC și maparea erorilor în română; ecranele
// (FounderPage, AfiliatPage, /sef-vanzari/:token) sunt pachetul 8b.
//
// Reguli pe care le respectă toate funcțiile:
//   • nu aruncă NICIODATĂ un obiect brut: orice eșec devine `SalesNetworkError`
//     (Error real, cu `reason` stabil, `code` Postgres și mesaj românesc);
//   • un refuz de business al serverului (`{ok:false, reason}`) e tratat ca eșec,
//     la fel ca o eroare de transport — apelantul are UN SINGUR drum de tratat;
//   • RPC nedeployat încă (PGRST202 / 42883) → `reason: 'unavailable'` („indisponibil"),
//     nu o eroare tehnică;
//   • tokenul unei invitații nu apare niciodată într-un mesaj de eroare, într-un
//     log sau într-un URL construit aici. Tokenul se întoarce O SINGURĂ DATĂ de
//     server la creare — UI-ul îl arată și îl lasă să dispară.
//   • serverul e autoritatea: validarea CUI-ului de aici (`normalizeRoCui`) e
//     doar o oglindă pentru UX (mesaj imediat), nu un gate.
// =============================================================
import { supabase } from './supabase'

// ── Tipuri ────────────────────────────────────────────────────────────────────

export type SalesRole = 'head' | 'agent'
export type AffiliateStatus = 'active' | 'suspended' | 'closed'
export type SettableAffiliateStatus = AffiliateStatus
export type InviteState = 'open' | 'used' | 'revoked' | 'expired'

export interface SalesContractStatus {
  /** Versiunea publicată acum; `null` = contractul NU e publicat (invitațiile sunt blocate). */
  currentVersion: string | null
  acceptedVersion: string | null
  acceptedAt: string | null
  /** Există o versiune publicată pe care acest cont n-a acceptat-o încă. */
  needsAcceptance: boolean
  /** sha256 hex al textului publicat; `null` = nepublicat. UI-ul își verifică textul cu el. */
  currentTextHash: string | null
}

export interface SalesHeadCard {
  affiliateId: string
  status: string
  /** Șeful a consimțit afișarea contactului. Fără el: name/phone/email sunt `null`. */
  contactShared: boolean
  name: string | null
  phone: string | null
  email: string | null
}

export interface SalesTeamMember {
  affiliateId: string
  /** Numărul de ordine (după data intrării) — eticheta cât contactul e ascuns. */
  ordinal: number
  status: string
  joinedAt: string
  contactShared: boolean
  name: string | null
  phone: string | null
  email: string | null
  clientsTotal: number
  clientsActive: number
  agentEarnedRonCents: number
  headBonusRonCents: number
  lastSaleAt: string | null
}

export interface SalesOpenInvite {
  id: string
  note: string | null
  createdAt: string
  expiresAt: string
}

export interface SalesNetwork {
  /** `null` = cont care nu face parte din rețeaua pe invitații. */
  role: SalesRole | null
  status: string | null
  affiliateId: string | null
  contactSharing: boolean
  contract: SalesContractStatus
  /** Cardul șefului (doar pentru agent). */
  head: SalesHeadCard | null
  /** Recruții DIRECȚI (doar pentru un șef activ). */
  team: SalesTeamMember[]
  openInvites: SalesOpenInvite[]
  limits: { openInvitesMax: number; inviteTtlDays: number }
}

export interface RedeemInviteInput {
  token: string
  phone: string
  cui: string
  /** Versiunea contractului AFIȘATĂ (trebuie să fie cea publicată). */
  contractVersion: string
  /** sha256 hex al textului afișat (vezi `sha256Hex`). */
  contractHash: string
  shareContact: boolean
}

export interface RedeemResult {
  affiliateId: string
  role: SalesRole
  status: string
  referralCode: string
  parentAffiliateId: string | null
  /** Dublu-submit al aceluiași token: contul exista deja, nimic nu s-a dublat. */
  already: boolean
}

export interface CreatedInvite {
  inviteId: string
  kind: SalesRole
  /** Tokenul în CLAR — apare O SINGURĂ DATĂ, doar aici. */
  token: string
  expiresAt: string
}

export interface AdminInvite {
  id: string
  kind: SalesRole
  state: InviteState
  email: string | null
  note: string | null
  createdAt: string
  expiresAt: string
  usedAt: string | null
  revokedAt: string | null
  invitedByAffiliateId: string | null
  invitedByName: string | null
  usedByAffiliateId: string | null
  usedByName: string | null
}

// ── Erori ─────────────────────────────────────────────────────────────────────

/** Motivele de refuz pe care le poate întoarce serverul (`{ok:false, reason}`). */
export const SALES_SERVER_REASONS = [
  'unauthenticated',
  'rate_limited',
  'contract_not_published',
  'contract_version_mismatch',
  'contract_hash_invalid',
  'contract_hash_mismatch',
  'invalid_text_hash',
  'anonymous_account',
  'cui_conflict',
  'phone_required',
  'cui_invalid',
  'invite_invalid',
  'already_affiliate',
  'not_a_head',
  'head_not_active',
  'contract_not_accepted',
  'too_many_open_invites',
  'invite_not_found',
  'already_used',
  'invalid_value',
  'not_an_affiliate',
  'invalid_email',
  'invalid_version',
  'draft_version',
  'invalid_status',
  'reason_required',
  'reason_too_long',
  'not_found',
  'erased',
  'not_in_network',
  'no_change',
  'invalid_transition',
] as const

export type SalesServerReason = (typeof SALES_SERVER_REASONS)[number]

/** Eșecuri care nu vin dintr-un `{ok:false}` al serverului. */
export type SalesClientReason =
  | 'unavailable' // RPC nedeployat (PGRST202 / 42883)
  | 'forbidden' // 42501: nu ești fondator / nu ai drept de execuție
  | 'network' // n-am ajuns la server
  | 'hash_unavailable' // browserul n-are crypto.subtle (context nesigur)
  | 'unknown' // formă de răspuns neașteptată

export type SalesFailureReason = SalesServerReason | SalesClientReason

export const SALES_FAILURE_MESSAGES: Record<SalesFailureReason, string> = {
  unauthenticated: 'Trebuie să te autentifici ca să continui.',
  rate_limited: 'Prea multe încercări. Așteaptă câteva minute și încearcă din nou.',
  contract_not_published:
    'Contractul de colaborare nu este încă publicat, deci invitațiile sunt blocate. Revino după publicare.',
  contract_version_mismatch:
    'Contractul s-a actualizat între timp. Redeschide linkul invitației și citește versiunea curentă.',
  contract_hash_mismatch:
    'Textul contractului afișat nu corespunde versiunii publicate. Redeschide linkul invitației și citește din nou contractul.',
  invalid_text_hash:
    'Hash-ul textului contractului trebuie să aibă 64 de caractere hexazecimale (sha256).',
  anonymous_account:
    'Ai nevoie de un cont cu adresă de email ca să continui. Autentifică-te cu emailul tău.',
  cui_conflict:
    'Acest CUI este deja folosit de alt cont din program. Verifică CUI-ul sau scrie-ne.',
  contract_hash_invalid:
    'Textul contractului nu a putut fi verificat. Redeschide linkul invitației și încearcă din nou.',
  phone_required: 'Introdu un număr de telefon valid (între 5 și 32 de caractere).',
  cui_invalid: 'CUI-ul nu este valid. Verifică cifrele (poți scrie cu sau fără RO în față).',
  // UN SINGUR mesaj pentru orice problemă a invitației (anti-oracol, ca pe server).
  // Pomenește și invitația legată de ALT email (mig 304 răspunde tot invite_invalid)
  // și ieșirea spre alt cont: fără ele, omul cu contul greșit cerea la nesfârșit
  // invitații noi, legate de același email.
  invite_invalid:
    'Invitația nu este validă: poate fi expirată, deja folosită sau retrasă, ori destinată altei adrese de email. Dacă ai alt cont, deconectează-te și intră cu emailul pentru care ai primit invitația; altfel cere o invitație nouă.',
  already_affiliate: 'Contul tău face deja parte din programul de vânzări.',
  not_a_head: 'Doar un șef de vânzări poate face această acțiune.',
  head_not_active: 'Contul tău de șef nu este activ, deci nu poți trimite invitații.',
  contract_not_accepted: 'Contractul de colaborare nu este acceptat pe acest cont.',
  too_many_open_invites:
    'Ai prea multe invitații deschise. Retrage una neutilizată sau așteaptă să expire, apoi încearcă din nou.',
  invite_not_found: 'Invitația nu a fost găsită.',
  already_used: 'Invitația a fost deja folosită, deci nu mai poate fi retrasă.',
  invalid_value: 'Valoarea trimisă nu este validă.',
  not_an_affiliate: 'Contul tău nu face parte din programul de vânzări.',
  invalid_email: 'Adresa de email nu este validă.',
  // Regula REALĂ (mig 304 și checkContractVersionInput): `^v?[0-9]+(\.[0-9]+)*$`, max 20.
  invalid_version:
    'Versiunea are forma 1.0, 1.0.3 sau v2: doar cifre separate prin punct, opțional cu „v” mic în față (maximum 20 de caractere).',
  draft_version: 'O versiune marcată DRAFT nu poate fi publicată.',
  invalid_status: 'Starea cerută nu este validă (activ, suspendat sau închis).',
  reason_required: 'Scrie motivul (cel puțin 3 caractere).',
  reason_too_long: 'Motivul este prea lung (maximum 500 de caractere).',
  not_found: 'Contul căutat nu există.',
  erased: 'Contul a fost șters (GDPR) și nu mai poate fi modificat.',
  not_in_network: 'Cererea din programul public se decide din lista de cereri, nu prin suspendare.',
  no_change: 'Contul are deja această stare.',
  invalid_transition: 'Un cont închis nu mai poate fi redeschis.',
  unavailable: 'Funcția nu este disponibilă încă. Încearcă din nou puțin mai târziu.',
  forbidden: 'Nu ai drepturi pentru această acțiune.',
  network: 'Nu am putut contacta serverul. Verifică conexiunea și încearcă din nou.',
  hash_unavailable:
    'Browserul nu permite verificarea contractului. Deschide pagina într-un browser actualizat, pe https.',
  unknown: 'Răspuns neașteptat de la server. Încearcă din nou.',
}

export class SalesNetworkError extends Error {
  readonly reason: SalesFailureReason
  /** Cod Postgres/PostgREST, când eroarea vine din transport. */
  readonly code: string | null
  constructor(reason: SalesFailureReason, code: string | null = null) {
    super(SALES_FAILURE_MESSAGES[reason])
    this.name = 'SalesNetworkError'
    this.reason = reason
    this.code = code
  }
}

export function isSalesServerReason(value: unknown): value is SalesServerReason {
  return typeof value === 'string' && (SALES_SERVER_REASONS as readonly string[]).includes(value)
}

/** Eroarea PostgREST/Postgres → motiv stabil. Fără mesajul brut (poate conține argumente). */
export function classifyRpcError(error: {
  code?: string | null
  message?: string | null
}): SalesNetworkError {
  const code = typeof error.code === 'string' && error.code !== '' ? error.code : null
  // Funcție inexistentă: PostgREST (PGRST202) sau Postgres (42883) — frontend înaintea migrației.
  if (code === 'PGRST202' || code === '42883') return new SalesNetworkError('unavailable', code)
  if (code === '42501') return new SalesNetworkError('forbidden', code)
  // JWT lipsă/expirat (PGRST301/302/303) → nu mai ești autentificat.
  if (code !== null && /^PGRST30[123]$/.test(code))
    return new SalesNetworkError('unauthenticated', code)
  // Fără cod = eroare de transport (fetch picat, offline, CORS).
  if (code === null) return new SalesNetworkError('network')
  return new SalesNetworkError('unknown', code)
}

// ── Parsare defensivă (răspuns necunoscut → eroare, nu undefined în UI) ───────

type Json = Record<string, unknown>

function asObject(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null
}
function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function reqStr(value: unknown): string {
  if (typeof value !== 'string') throw new SalesNetworkError('unknown')
  return value
}
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
function bool(value: unknown): boolean {
  return value === true
}
function role(value: unknown): SalesRole | null {
  return value === 'head' || value === 'agent' ? value : null
}
function affiliateStatus(value: unknown): AffiliateStatus | null {
  return value === 'active' || value === 'suspended' || value === 'closed' ? value : null
}

function parseContract(value: unknown): SalesContractStatus {
  const o = asObject(value)
  return {
    currentVersion: str(o?.current_version),
    acceptedVersion: str(o?.accepted_version),
    acceptedAt: str(o?.accepted_at),
    needsAcceptance: bool(o?.needs_acceptance),
    currentTextHash: str(o?.current_text_hash),
  }
}

function parseHead(value: unknown): SalesHeadCard | null {
  const o = asObject(value)
  if (!o) return null
  return {
    affiliateId: reqStr(o.affiliate_id),
    status: reqStr(o.status),
    contactShared: bool(o.contact_shared),
    name: str(o.name),
    phone: str(o.phone),
    email: str(o.email),
  }
}

function parseMember(value: unknown): SalesTeamMember {
  const o = asObject(value)
  if (!o) throw new SalesNetworkError('unknown')
  return {
    affiliateId: reqStr(o.affiliate_id),
    ordinal: num(o.ordinal),
    status: reqStr(o.status),
    joinedAt: reqStr(o.joined_at),
    contactShared: bool(o.contact_shared),
    name: str(o.name),
    phone: str(o.phone),
    email: str(o.email),
    clientsTotal: num(o.clients_total),
    clientsActive: num(o.clients_active),
    agentEarnedRonCents: num(o.agent_earned_ron_cents),
    headBonusRonCents: num(o.head_bonus_ron_cents),
    lastSaleAt: str(o.last_sale_at),
  }
}

function parseOpenInvite(value: unknown): SalesOpenInvite {
  const o = asObject(value)
  if (!o) throw new SalesNetworkError('unknown')
  return {
    id: reqStr(o.id),
    note: str(o.note),
    createdAt: reqStr(o.created_at),
    expiresAt: reqStr(o.expires_at),
  }
}

export function parseSalesNetwork(data: unknown): SalesNetwork {
  const o = asObject(data)
  if (!o || o.ok !== true) throw new SalesNetworkError('unknown')
  const limits = asObject(o.limits)
  // Rol necunoscut (sau lipsă) = formă neașteptată → eroare (tristate), NU `null`:
  // `null` înseamnă „în afara rețelei" și ar ascunde ecranele unui cont care e în rețea.
  const parsedRole = role(o.role)
  if (parsedRole === null && o.role !== null) throw new SalesNetworkError('unknown')
  return {
    role: parsedRole,
    status: str(o.status),
    affiliateId: str(o.affiliate_id),
    contactSharing: bool(o.contact_sharing),
    contract: parseContract(o.contract),
    head: parseHead(o.head),
    team: Array.isArray(o.team) ? o.team.map(parseMember) : [],
    openInvites: Array.isArray(o.open_invites) ? o.open_invites.map(parseOpenInvite) : [],
    limits: {
      openInvitesMax: num(limits?.open_invites_max),
      inviteTtlDays: num(limits?.invite_ttl_days),
    },
  }
}

function parseRedeem(body: Json): RedeemResult {
  const r = role(body.role)
  if (r === null) throw new SalesNetworkError('unknown')
  return {
    affiliateId: reqStr(body.affiliate_id),
    role: r,
    status: reqStr(body.status),
    referralCode: reqStr(body.referral_code),
    parentAffiliateId: str(body.parent_affiliate_id),
    already: body.already === true,
  }
}

function parseCreatedInvite(body: Json): CreatedInvite {
  const kind = role(body.kind)
  if (kind === null) throw new SalesNetworkError('unknown')
  return {
    inviteId: reqStr(body.invite_id),
    kind,
    token: reqStr(body.token),
    expiresAt: reqStr(body.expires_at),
  }
}

function inviteState(value: unknown): InviteState | null {
  return value === 'open' || value === 'used' || value === 'revoked' || value === 'expired'
    ? value
    : null
}

function parseAdminInvite(value: unknown): AdminInvite {
  const o = asObject(value)
  const kind = role(o?.kind)
  const state = inviteState(o?.state)
  if (!o || kind === null || state === null) throw new SalesNetworkError('unknown')
  return {
    id: reqStr(o.id),
    kind,
    state,
    email: str(o.email),
    note: str(o.note),
    createdAt: reqStr(o.created_at),
    expiresAt: reqStr(o.expires_at),
    usedAt: str(o.used_at),
    revokedAt: str(o.revoked_at),
    invitedByAffiliateId: str(o.invited_by_affiliate_id),
    invitedByName: str(o.invited_by_name),
    usedByAffiliateId: str(o.used_by_affiliate_id),
    usedByName: str(o.used_by_name),
  }
}

// ── Transport ─────────────────────────────────────────────────────────────────

async function rpcData(fn: string, args?: Record<string, unknown>): Promise<unknown> {
  let res: { data: unknown; error: { code?: string | null; message?: string | null } | null }
  try {
    res = await supabase.rpc(fn, args)
  } catch {
    // supabase-js nu aruncă de obicei, dar un fetch picat/CORS poate; fără cauza brută.
    throw new SalesNetworkError('network')
  }
  if (res.error) throw classifyRpcError(res.error)
  return res.data
}

/** RPC cu răspuns obiect `{ok, ...}`: `ok:false` devine eroare cu `reason`. */
async function rpcObject(fn: string, args?: Record<string, unknown>): Promise<Json> {
  const data = await rpcData(fn, args)
  const body = asObject(data)
  if (!body) throw new SalesNetworkError('unknown')
  // Succesul cere `ok === true` EXPLICIT: un corp fără `ok` (RPC schimbat, proxy,
  // răspuns gol) nu are voie să treacă drept reușită pe apelurile care nu parsează nimic.
  if (body.ok !== true) {
    throw new SalesNetworkError(
      body.ok === false && isSalesServerReason(body.reason) ? body.reason : 'unknown',
    )
  }
  return body
}

// ── Utilizator autentificat ───────────────────────────────────────────────────

/** „Echipa mea": rolul, contractul, cardul șefului / recruții direcți. */
export async function fetchSalesNetwork(): Promise<SalesNetwork> {
  const body = await rpcObject('get_sales_network')
  return parseSalesNetwork(body)
}

/** Răscumpără o invitație (și acceptă contractul în același pas). */
export async function redeemSalesInvite(
  kind: SalesRole,
  input: RedeemInviteInput,
): Promise<RedeemResult> {
  const body = await rpcObject(
    kind === 'head' ? 'redeem_sales_head_invite' : 'redeem_agent_invite',
    {
      p_token: input.token.trim(),
      p_phone: input.phone.trim(),
      p_cui: input.cui.trim(),
      p_contract_version: input.contractVersion,
      p_contract_hash: input.contractHash,
      p_share_contact: input.shareContact,
    },
  )
  return parseRedeem(body)
}

/** Șeful creează o invitație de agent. Tokenul se întoarce O SINGURĂ DATĂ. */
export async function createAgentInvite(note?: string): Promise<CreatedInvite> {
  const body = await rpcObject('create_agent_invite', { p_note: note?.trim() || null })
  return parseCreatedInvite(body)
}

/** Șeful retrage o invitație neacceptată. */
export async function revokeAgentInvite(inviteId: string): Promise<void> {
  await rpcObject('revoke_agent_invite', { p_invite_id: inviteId })
}

/** Consimțământul (revocabil) ca numele/telefonul/emailul să fie afișate. */
export async function setMyContactSharing(share: boolean): Promise<boolean> {
  const body = await rpcObject('set_my_contact_sharing', { p_share: share })
  return body.contact_sharing === true
}

// ── Fondator ──────────────────────────────────────────────────────────────────

export async function adminCreateHeadInvite(email?: string, note?: string): Promise<CreatedInvite> {
  const body = await rpcObject('admin_create_sales_head_invite', {
    p_email: email?.trim() || null,
    p_note: note?.trim() || null,
  })
  return parseCreatedInvite(body)
}

export async function adminRevokeInvite(inviteId: string): Promise<void> {
  await rpcObject('admin_revoke_affiliate_invite', { p_invite_id: inviteId })
}

/** Lista invitațiilor — fără token și fără hash (serverul nu le întoarce). */
export async function adminListInvites(): Promise<AdminInvite[]> {
  const data = await rpcData('admin_list_affiliate_invites')
  if (!Array.isArray(data)) throw new SalesNetworkError('unknown')
  return data.map(parseAdminInvite)
}

export async function adminSetAffiliateStatus(
  affiliateId: string,
  status: SettableAffiliateStatus,
  reason: string,
): Promise<AffiliateStatus> {
  const body = await rpcObject('admin_set_affiliate_status', {
    p_affiliate_id: affiliateId,
    p_status: status,
    p_reason: reason.trim(),
  })
  const next = affiliateStatus(body.status)
  if (next === null) throw new SalesNetworkError('unknown')
  return next
}

export interface PublishedContract {
  version: string | null
  textHash: string | null
}

/**
 * Publică contractul: versiunea ȘI sha256 al textului exact (serverul respinge la
 * răscumpărare orice alt hash). `version = null` retrage contractul (invitațiile
 * se blochează); hash-ul se ignoră atunci.
 */
export async function adminSetContractVersion(
  version: string | null,
  textHash: string | null,
): Promise<PublishedContract> {
  const body = await rpcObject('admin_set_sales_contract_version', {
    p_version: version,
    p_text_hash: textHash,
  })
  return { version: str(body.version), textHash: str(body.text_hash) }
}

// ── Helperi puri ──────────────────────────────────────────────────────────────

/** Forma unui token (43 de caractere URL-safe): refuză din start link-uri evident greșite. */
export function isInviteTokenShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value.trim())
}

const CUI_KEY = [7, 5, 3, 2, 1, 7, 5, 3, 2] as const

/**
 * CUI normalizat (doar cifre, fără RO) sau `null`. Oglinda lui `normalize_ro_cui`
 * (mig 304): prefix RO opțional, 2–10 cifre fără zero în față, cifra de control
 * cu cheia 753217532. DOAR pentru UX — serverul decide.
 */
export function normalizeRoCui(raw: string): string | null {
  let c = raw.replace(/\s+/g, '').toUpperCase()
  if (c.startsWith('RO')) c = c.slice(2)
  if (!/^[1-9][0-9]{1,9}$/.test(c)) return null
  const control = Number(c.charAt(c.length - 1))
  const body = c.slice(0, -1).padStart(9, '0')
  let sum = 0
  for (let i = 0; i < 9; i += 1) sum += Number(body.charAt(i)) * CUI_KEY[i]
  return ((sum * 10) % 11) % 10 === control ? c : null
}

export function isValidRoCui(raw: string): boolean {
  return normalizeRoCui(raw) !== null
}

/**
 * sha256 hex al unui text (UTF-8) — pentru `contractHash`: hash-ul documentului
 * AFIȘAT. Cere `crypto.subtle` (doar pe https); fără el, eroare clară, nu un
 * hash fals.
 */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new SalesNetworkError('hash_unavailable')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Mesajul pentru orice eșec, inclusiv unul care nu e `SalesNetworkError` (nu scurge mesajul brut). */
export function describeSalesError(error: unknown): string {
  return error instanceof SalesNetworkError ? error.message : SALES_FAILURE_MESSAGES.unknown
}

// src/lib/salesInviteFlow.ts
// Decizii PURE ale paginii de răscumpărare a invitațiilor de rețea
// (pages/SalesInviteRedeemPage.tsx): calea de întoarcere după înscriere și
// validarea câmpurilor. Separate de pagină ca să fie testabile fără DOM.
import { safeNextPath } from './authRedirect'
import {
  SALES_FAILURE_MESSAGES,
  isInviteTokenShape,
  normalizeRoCui,
  type SalesFailureReason,
  type SalesNetworkError,
  type SalesRole,
} from './salesNetwork'

/** Calea FĂRĂ token la care e înlocuit URL-ul după citirea tokenului. */
export const INVITE_BASE_PATH: Readonly<Record<SalesRole, string>> = {
  head: '/sef-vanzari',
  agent: '/echipa',
}

/**
 * Calea invitației CU token (`/sef-vanzari/<token>`), sau `null` dacă tokenul nu
 * are forma unui token ori calea nu trece de validarea open-redirect
 * (`safeNextPath`). O folosesc înscrierea (`?next=`) și reîncărcarea paginii
 * (tokenul a fost scos din URL la montare, deci un reload simplu l-ar pierde).
 */
export function invitePathWithToken(kind: SalesRole, token: string): string | null {
  if (!isInviteTokenShape(token)) return null
  return safeNextPath(`${INVITE_BASE_PATH[kind]}/${token.trim()}`)
}

/**
 * Calea spre înscriere care readuce omul pe invitație după login, sau `null`
 * dacă tokenul nu are forma unui token (nu punem gunoi într-un `?next=`) ori
 * calea nu trece de validarea open-redirect (`safeNextPath`).
 */
export function signupPathForInvite(kind: SalesRole, token: string): string | null {
  const next = invitePathWithToken(kind, token)
  if (next === null) return null
  return `/auth?mode=signup&lang=ro&next=${encodeURIComponent(next)}`
}

export interface InviteFieldsCheck {
  ok: boolean
  phone: string
  /** CUI normalizat (doar cifre), sau `null` dacă e invalid. */
  cui: string | null
  phoneError: string | null
  cuiError: string | null
}

/** Oglinda UX a validărilor de pe server (telefon 5–32 caractere, CUI cu cifră de control). */
export function checkInviteFields(phoneRaw: string, cuiRaw: string): InviteFieldsCheck {
  const phone = phoneRaw.trim()
  const phoneBad = phone.length < 5 || phone.length > 32
  const cui = normalizeRoCui(cuiRaw)
  return {
    ok: !phoneBad && cui !== null,
    phone,
    cui,
    phoneError: phoneBad ? SALES_FAILURE_MESSAGES.phone_required : null,
    cuiError: cui === null ? SALES_FAILURE_MESSAGES.cui_invalid : null,
  }
}

/**
 * Câmpul formularului la care aparține un refuz al serverului (mesajul stă sub
 * câmp, nu în josul formularului): `cui_conflict` / `cui_invalid` → CUI,
 * `phone_required` → telefon; orice alt motiv → `null` (mesaj general).
 */
export function fieldForSalesReason(reason: SalesFailureReason): 'phone' | 'cui' | null {
  if (reason === 'cui_conflict' || reason === 'cui_invalid') return 'cui'
  if (reason === 'phone_required') return 'phone'
  return null
}

// ── Contractul afișat vs. contractul publicat ─────────────────────────────────

/** sha256 al textului local, calculat asincron (hooks/useContractTextHash). */
export type ContractTextHash =
  | { status: 'none' } // nu există text de calculat
  | { status: 'pending' }
  | { status: 'ready'; hash: string }
  | { status: 'error'; error: SalesNetworkError }

export type ContractGate =
  /** Serverul nu are o versiune publicată: invitațiile sunt blocate. */
  | { state: 'unpublished' }
  /** Versiunea publicată nu are text în acest bundle (aplicație mai veche). */
  | { state: 'missing_text'; version: string }
  /** sha256-ul textului local încă se calculează. */
  | { state: 'checking'; version: string }
  /** Browserul nu poate calcula sha256 (`crypto.subtle` lipsă). */
  | { state: 'hash_error'; version: string; message: string }
  /** Textul local NU e cel publicat (amprentă diferită sau lipsă pe server). */
  | { state: 'mismatch'; version: string }
  /** Textul local e EXACT cel publicat: se poate accepta. */
  | { state: 'ready'; version: string; text: string; hash: string }

/**
 * FAIL-CLOSED: acceptarea e permisă DOAR când sha256(textul afișat) este
 * amprenta publicată de server pentru versiunea curentă. Serverul verifică și el
 * (`contract_hash_mismatch`), dar fără verificarea locală omul ar bifa „am citit
 * și accept” pe un text pe care serverul îl respinge abia la trimitere.
 */
export function contractGate(
  publishedVersion: string | null,
  publishedHash: string | null,
  localText: string | null,
  localHash: ContractTextHash,
): ContractGate {
  if (publishedVersion === null) return { state: 'unpublished' }
  if (localText === null) return { state: 'missing_text', version: publishedVersion }
  // O versiune fără amprentă nu poate fi verificată (serverul n-ar accepta-o oricum).
  if (publishedHash === null) return { state: 'mismatch', version: publishedVersion }
  if (localHash.status === 'error')
    return { state: 'hash_error', version: publishedVersion, message: localHash.error.message }
  if (localHash.status !== 'ready') return { state: 'checking', version: publishedVersion }
  if (localHash.hash !== publishedHash) return { state: 'mismatch', version: publishedVersion }
  return { state: 'ready', version: publishedVersion, text: localText, hash: localHash.hash }
}

/** Primele 12 caractere ale unei amprente sha256 (afișare), cu „…”. */
export function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash
}

/**
 * Mesajul unui refuz la REacceptarea contractului din panou (mig 308,
 * components/afiliat/ContractReacceptSection). Motivele de contract au mesaje
 * scrise pentru răscumpărare („Redeschide linkul invitației”, „invitațiile sunt
 * blocate”); în panou nu există niciun link și nicio invitație, deci toate cele
 * patru motive de contract primesc varianta panoului.
 */
export function reacceptMessage(reason: SalesFailureReason): string {
  // Contract retras între timp: după reîncărcare nu mai e nimic de citit.
  if (reason === 'contract_not_published') {
    return 'Contractul a fost retras între timp. Reîncarcă pagina.'
  }
  if (
    reason === 'contract_version_mismatch' ||
    reason === 'contract_hash_mismatch' ||
    reason === 'contract_hash_invalid'
  ) {
    return 'Contractul s-a actualizat între timp. Reîncarcă pagina și citește versiunea curentă.'
  }
  return SALES_FAILURE_MESSAGES[reason]
}

/** Eticheta unei versiuni de contract: `1.0` → `v1.0`, `v2` rămâne `v2`. */
export function contractVersionLabel(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

// ── Ecranul fondatorului (components/founder/SalesNetworkPanel.tsx) ───────────

/** Linkul de invitație: `<baza publică>/sef-vanzari/<token>` (agent: `/echipa/`). */
export function buildInviteLink(kind: SalesRole, token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${INVITE_BASE_PATH[kind]}/${token}`
}

export type ContractVersionCheck = { ok: true; version: string } | { ok: false; message: string }

/**
 * Oglinda locală a regulilor serverului pentru versiunea de contract
 * (`admin_set_sales_contract_version`, mig 304): „draft” (orice majuscule) →
 * `draft_version`; peste 20 de caractere sau altă formă decât
 * `^v?[0-9]+(\.[0-9]+)*$` (ex. `1.0`, `v2`, `1.0.3`) → `invalid_version`.
 * Serverul rămâne autoritatea; aici doar mesajul vine imediat.
 */
export function checkContractVersionInput(raw: string): ContractVersionCheck {
  const version = raw.trim()
  if (version === '') return { ok: false, message: 'Scrie versiunea contractului (ex. 1.0).' }
  if (/draft/i.test(version)) return { ok: false, message: SALES_FAILURE_MESSAGES.draft_version }
  if (version.length > 20 || !/^v?[0-9]+(\.[0-9]+)*$/.test(version))
    return { ok: false, message: SALES_FAILURE_MESSAGES.invalid_version }
  return { ok: true, version }
}

/** Etichetele stărilor unui cont din rețea, în ordinea afișării. */
type SettableStatus = 'active' | 'suspended' | 'closed'

export const AFFILIATE_STATUS_OPTIONS: readonly { value: SettableStatus; label: string }[] = [
  { value: 'active', label: 'Activ' },
  { value: 'suspended', label: 'Suspendat' },
  { value: 'closed', label: 'Închis' },
]

/**
 * Stările în care poate fi mutat un cont, în oglinda serverului: `closed` e
 * terminal, iar starea curentă nu se „schimbă” în ea însăși. Orice altă stare
 * (pending / rejected = cereri din programul public) → nimic de oferit aici.
 */
export function nextStatusesFor(current: string): SettableStatus[] {
  if (current === 'active') return ['suspended', 'closed']
  if (current === 'suspended') return ['active', 'closed']
  return []
}

/**
 * Rolul afișat în lista „Rețeaua”. Sursa e `sales_role` (mig 304), NU legătura
 * cu un părinte: un afiliat din programul public (`sales_role` NULL) n-are
 * părinte, dar nu e șef de vânzări — n-a intrat prin invitație și n-a acceptat
 * contractul de rețea. `admin_list_affiliates` proiectează `sales_role` din
 * mig 305 (cheia mereu prezentă; `null` JSON = program public). `unknown` =
 * cheia lipsește (frontend înaintea migrației 305) sau valoarea nu e una
 * dintre cele trei știute: fără rol confirmat, nimeni nu e etichetat „Șef”.
 */
export type NetworkRole = 'head' | 'agent' | 'public' | 'unknown'

export const NETWORK_ROLE_LABELS: Readonly<Record<NetworkRole, string>> = {
  head: 'Șef',
  agent: 'Agent',
  public: 'Partener (program public)',
  unknown: 'Partener',
}

export interface NetworkListRow {
  affiliateId: string
  status: string
  parentAffiliateId: string | null
  role: NetworkRole
  name: string
}

interface NetworkSourceRow {
  affiliate_id: string
  status: string
  parent_affiliate_id: string | null
  full_name: string | null
  email: string | null
  referral_code: string
  erased_at?: string | null
  /** mig 304, proiectat din 305; NULL = program public / afiliat vechi; ABSENT = fără 305. */
  sales_role?: 'head' | 'agent' | null
}

function networkRoleOf(r: NetworkSourceRow): NetworkRole {
  if (r.sales_role === 'head') return 'head'
  if (r.sales_role === 'agent') return 'agent'
  if (r.sales_role === null) return 'public'
  return 'unknown'
}

/**
 * Lista „Rețeaua”: doar conturi în active / suspended / closed (cererile
 * pending / rejected se decid din lista de cereri), conturile fără părinte
 * înaintea celor legate de ele. ORDINEA vine din `parent_affiliate_id`
 * (structura), dar ROLUL afișat vine din `sales_role` (`networkRoleOf`).
 */
export function networkRows(rows: readonly NetworkSourceRow[]): NetworkListRow[] {
  const inNetwork = rows.filter(
    (r) => r.status === 'active' || r.status === 'suspended' || r.status === 'closed',
  )
  const toRow = (r: NetworkSourceRow): NetworkListRow => ({
    affiliateId: r.affiliate_id,
    status: r.status,
    parentAffiliateId: r.parent_affiliate_id,
    role: networkRoleOf(r),
    name: r.erased_at ? '(cont șters)' : r.full_name || r.email || r.referral_code,
  })
  const heads = inNetwork.filter((r) => r.parent_affiliate_id === null)
  const out: NetworkListRow[] = []
  for (const h of heads) {
    out.push(toRow(h))
    for (const a of inNetwork.filter((r) => r.parent_affiliate_id === h.affiliate_id))
      out.push(toRow(a))
  }
  // Conturi al căror părinte nu e în listă (închis / filtrat): nu le pierdem.
  for (const a of inNetwork.filter(
    (r) =>
      r.parent_affiliate_id !== null &&
      !heads.some((h) => h.affiliate_id === r.parent_affiliate_id),
  ))
    out.push(toRow(a))
  return out
}

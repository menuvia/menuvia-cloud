// src/lib/userMessages.ts
// Mesajul pe care îl VEDE omul când o acțiune din panou eșuează.
//
// Până acum ~80 de locuri randau direct `error.message`: PostgREST/Postgres/
// supabase-js răspund în ENGLEZĂ și cu jargon („new row violates row-level
// security policy for table products”, „JSON object requested, multiple (or no)
// rows returned”, „Forbidden”). Un ospătar sau un manager care vede asta nu
// știe dacă e vina lui, a rețelei sau a aplicației.
//
// Contractul `toUserMessage(err, fallback?)`:
//   - refuz de drepturi (42501 / RLS / „permission denied” / mesajele englezești
//     de autorizare din RPC-urile vechi)  → „Nu ai drepturi pentru această acțiune.”
//   - PGRST116 (0 rânduri la `.single()`)   → „Elementul nu mai există sau nu ai acces la el.”
//   - HTTP 403 / „Forbidden”                → „Acțiune nepermisă pentru rolul tău.”
//   - 23505 (unicitate)                     → „Există deja un element cu aceste date.”
//   - cădere de rețea (lib/networkError)    → „Fără conexiune. Verifică internetul și reîncearcă.”
//   - mesaj DEJA românesc (al RPC-urilor noastre, al codului client) → păstrat
//   - orice altceva → `fallback` (implicit „Acțiunea nu a putut fi finalizată. Reîncearcă.”)
//
// Ordinea contează: drepturile și rețeaua se decid ÎNAINTEA testului „e deja
// românesc”, fiindcă un mesaj românesc poate purta și el un cod 42501 (o
// politică) — omul trebuie să afle că e o problemă de drepturi, nu un text
// tehnic. Mesajele românești FĂRĂ cod de drepturi trec neatinse: sunt refuzuri
// de business scrise pentru om (`raise exception` din migrații, `new Error(...)`
// din client).
import { isNetworkError } from './networkError'

export const MSG_NO_PERMISSION = 'Nu ai drepturi pentru această acțiune.'
export const MSG_NOT_FOUND = 'Elementul nu mai există sau nu ai acces la el.'
export const MSG_FORBIDDEN = 'Acțiune nepermisă pentru rolul tău.'
export const MSG_DUPLICATE = 'Există deja un element cu aceste date.'
export const MSG_NETWORK = 'Fără conexiune. Verifică internetul și reîncearcă.'
export const MSG_GENERIC = 'Acțiunea nu a putut fi finalizată. Reîncearcă.'

interface ErrorFacts {
  message: string
  code: string
  status: number | null
}

function factsOf(err: unknown): ErrorFacts {
  if (typeof err === 'string') return { message: err, code: '', status: null }
  if (err == null || typeof err !== 'object') return { message: '', code: '', status: null }
  const o = err as { message?: unknown; code?: unknown; status?: unknown }
  const message = typeof o.message === 'string' ? o.message : ''
  const code = typeof o.code === 'string' ? o.code : typeof o.code === 'number' ? String(o.code) : ''
  const status = typeof o.status === 'number' ? o.status : null
  return { message, code, status }
}

// Formele de refuz de drepturi pe care le scriu Postgres, PostgREST și
// RPC-urile vechi (în engleză) din lanțul de migrații.
const PERMISSION_TEXT =
  /permission denied|row-level security|violates row-level|insufficient privilege|not authorized|not a member of this restaurant|\brole \S+ cannot\b|only owners?\b.*can/i

const FORBIDDEN_TEXT = /^\s*forbidden\s*$/i

const DUPLICATE_TEXT = /duplicate key value|violates unique constraint/i

// ── E deja românesc? ────────────────────────────────────────────────────────
// Diacriticele contează DOAR în afara ghilimelelor: `create_order: invalid
// options for product "Ciorbă"` e englezesc, diacriticul e din numele
// produsului. Fără diacritice se compară cuvinte: unele există doar în română,
// altele doar în engleză, iar mesajul e românesc numai cu mai multe dintâi
// decât dintr-ale doilea. „invalid" stă în lista românească (serverul scrie
// „Tip feedback invalid", „Parametru invalid"), iar engleza are destule cuvinte
// în jur („Invalid device secret", „invalid options for product") ca să câștige.
const DIACRITICS = /[ăâîșțşţĂÂÎȘȚŞŢ]/
const QUOTED = /"[^"]*"|„[^”"]*[”"]|«[^»]*»|'[^']*'/g
const RO_WORDS = new Set([
  'nu', 'e', 'este', 'sunt', 'de', 'la', 'pe', 'din', 'cu', 'si', 'sau', 'pentru',
  'trebuie', 'poate', 'deja', 'doar', 'prea', 'mare', 'mic', 'eroare', 'acces',
  'interzis', 'invalid', 'invalida', 'inexistent', 'inexistenta', 'necunoscut',
  'necunoscuta', 'obligatoriu', 'obligatorie', 'acest', 'aceasta', 'comanda',
  'masa', 'produsul', 'planul', 'contul', 'modul', 'parametru', 'apel',
  'reincearca', 'incearca', 'pot', 'ai', 'are',
])
const EN_WORDS = new Set([
  'the', 'a', 'an', 'for', 'not', 'must', 'cannot', 'can', 'found', 'only', 'of',
  'to', 'is', 'are', 'has', 'have', 'be', 'with', 'this', 'that', 'at', 'least',
  'one', 'does', 'did', 'no', 'or', 'and', 'in', 'on', 'product', 'products',
  'order', 'orders', 'role', 'options', 'quantity', 'device', 'secret', 'source',
  'item', 'items', 'required', 'authentication', 'belong', 'state', 'status',
  'current', 'request', 'failed', 'error', 'unknown', 'missing', 'already',
  'exists', 'too', 'large', 'value', 'table', 'user',
])

function isRomanianText(text: string): boolean {
  const unquoted = text.replace(QUOTED, ' ')
  if (DIACRITICS.test(unquoted)) return true
  let ro = 0
  let en = 0
  for (const w of unquoted.toLowerCase().split(/[^a-z]+/)) {
    if (!w) continue
    if (RO_WORDS.has(w)) ro++
    if (EN_WORDS.has(w)) en++
  }
  return ro > en
}

/** Mesajul în română, pentru om, al unei erori de orice formă. */
export function toUserMessage(err: unknown, fallback: string = MSG_GENERIC): string {
  const { message, code, status } = factsOf(err)
  if (code === '42501' || PERMISSION_TEXT.test(message)) return MSG_NO_PERMISSION
  if (code === 'PGRST116') return MSG_NOT_FOUND
  if (code === '23505' || DUPLICATE_TEXT.test(message)) return MSG_DUPLICATE
  if (isNetworkError(err)) return MSG_NETWORK
  const trimmed = message.trim()
  // Un mesaj românesc câștigă și pe 403: AiError vine cu status 403 și un text
  // precis („Nu ai drepturi să folosești asistentul AI…"), mai util decât cel
  // generic. MSG_FORBIDDEN doar pentru 403 fără text sau cu text englezesc.
  if (trimmed && isRomanianText(trimmed)) return trimmed
  if (status === 403 || FORBIDDEN_TEXT.test(message)) return MSG_FORBIDDEN
  return fallback
}

/**
 * O scriere (DELETE/UPDATE) refuzată de RLS NU întoarce eroare: PostgREST
 * răspunde 200 cu ZERO rânduri afectate. Fără `.select(...)` și numărarea
 * rândurilor, UI-ul arăta „Șters” pe un rând care rămânea în bază. Întoarce
 * eroarea de drepturi pentru 0 rânduri, eroarea originală dacă există, altfel
 * `null`.
 */
export function zeroRowsAsDenied(res: {
  data: readonly unknown[] | null
  error: { message: string; code?: string } | null
}): { message: string; code: string } | null {
  if (res.error) return { message: res.error.message, code: res.error.code ?? '' }
  if (!res.data || res.data.length === 0) return { message: MSG_NO_PERMISSION, code: '42501' }
  return null
}

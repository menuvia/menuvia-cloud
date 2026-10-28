// src/lib/telemetryScrub.ts
// ─────────────────────────────────────────────────────────────────
// Igiena telemetriei: tokenurile din URL nu au voie să ajungă la Sentry sau la
// PostHog. Funcții PURE (fără DOM, fără rețea), folosite de main.tsx (Sentry:
// beforeSend / beforeSendTransaction / beforeBreadcrumb) și de analytics.ts
// (PostHog: before_send).
//
// Ce e secret în URL-urile aplicației:
//   • căi cu token: /sef-vanzari/:token, /echipa/:token (invitații de rețea),
//     /invite/:token (invitație de personal), /q/:token (masa QR);
//   • aceleași căi ÎMPACHETATE într-un parametru: /auth?next=%2Fsef-vanzari%2FTOKEN
//     (fluxul „cont nou → revino la invitație”), inclusiv codificat de două ori;
//   • parametri de query/hash cu valori de sesiune sau de unică folosință
//     (access_token din linkul de resetare a parolei, ?cancel=COD la rezervări).
//
// Regula de proiectare: mai bine o redactare în plus (telemetria pierde un
// detaliu) decât una în minus (un secret iese din aplicație). De aceea căile cu
// token se redactează oriunde apar într-un șir, nu doar la începutul lui.
// ─────────────────────────────────────────────────────────────────

/** Segmentele-prefix ale rutelor al căror următor segment e un token. */
export const TOKEN_ROUTE_PREFIXES: readonly string[] = ['sef-vanzari', 'echipa', 'invite', 'q']

/** Parametri de query/hash a căror valoare nu are ce căuta în telemetrie. */
export const SENSITIVE_PARAMS: readonly string[] = [
  'access_token',
  'refresh_token',
  'provider_token',
  'token',
  'token_hash',
  'code',
  'cancel',
]

const REDACTED_TOKEN = ':token'
const REDACTED_VALUE = '[redacted]'

// Separatorul poate fi `/`, `%2F` sau `%252F` (codificat o dată / de două ori).
const SEP = '(?:/|%(?:25)*2[fF])'
const TOKEN_PATH_RE = new RegExp(
  `(${SEP})(${TOKEN_ROUTE_PREFIXES.join('|')})(${SEP})[^/?#&%\\s"'<>\\\\]+`,
  'g',
)
const SENSITIVE_PARAM_RE = new RegExp(`([?&#])(${SENSITIVE_PARAMS.join('|')})=[^&#\\s]*`, 'g')

/** Redactează tokenurile și parametrii sensibili dintr-un URL / o cale / un text. */
export function scrubTokenPaths(input: string): string {
  if (input === '') return input
  return input
    .replace(
      TOKEN_PATH_RE,
      (_match: string, s1: string, prefix: string, s2: string) =>
        `${s1}${prefix}${s2}${REDACTED_TOKEN}`,
    )
    .replace(
      SENSITIVE_PARAM_RE,
      (_match: string, lead: string, key: string) => `${lead}${key}=${REDACTED_VALUE}`,
    )
}

const MAX_DEPTH = 24

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function scrubUnknown(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubTokenPaths(value)
  if (value === null || typeof value !== 'object') return value
  if (depth > MAX_DEPTH || seen.has(value)) return '[truncated]'
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((v) => scrubUnknown(v, depth + 1, seen))
    // Date, Error, Map etc. nu sunt JSON simplu: le lăsăm neatinse.
    if (!isPlainObject(value)) return value
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = scrubUnknown(v, depth + 1, seen)
    return out
  } finally {
    // O referință repetată (nu circulară) e legitimă: se scoate la ieșire.
    seen.delete(value)
  }
}

/**
 * Copie a lui `value` în care FIECARE șir a trecut prin `scrubTokenPaths`
 * (obiecte simple și array-uri, recursiv). Evenimentele Sentry/PostHog poartă
 * URL-ul în locuri diferite (`request.url`, `transaction`, breadcrumbs,
 * `$current_url`, `$referrer`, mesaje de eroare…): o listă de câmpuri ar rata
 * exact câmpul următor, deci se parcurge tot.
 */
export function scrubTokenPathsDeep<T>(value: T): T {
  return scrubUnknown(value, 0, new WeakSet<object>()) as T
}

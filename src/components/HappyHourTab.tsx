// ─────────────────────────────────────────────────────────────
// HappyHourTab — Reguli automate de reducere pe interval orar
//
// Owner/manager creează reguli ca:
//   • "Happy Hour 17-19" — 20% pe TOT, în fiecare zi
//   • "Cocktailuri week-end" — 15% pe categoria Cocktailuri, doar Vi-Sâ 21-23
//
// Reducerea se aplică pe SERVER (trg_apply_happy_hour_auto, mig 077) pe
// comenzile QR și de ridicare; la plata de la ospătar (Planul 3) apare ca
// sugestie („Aplică Happy Hour”).
// Aici doar definim regulile — fără niciun calcul de reducere în client.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef, useId } from 'react'
import { D } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import { InlineSpinner } from './PageLoader'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { confirm as confirmDialog } from './ui/confirm'
import { Modal } from './_dashboard/sharedUI'
import { useToast } from './ui/useToast'
import { parseDecimalCents } from '../lib/decimal'
import {
  fetchHappyHourRules,
  createHappyHourRule,
  updateHappyHourRule,
  deleteHappyHourRule,
  evaluateHappyHourForNow,
  type HappyHourRule,
  type ActiveRule,
} from '../lib/happyHour'
import { supabase } from '../lib/supabase'
import { isNetworkError } from '../lib/networkError'
import { MSG_NOT_FOUND, MSG_NO_PERMISSION } from '../lib/userMessages'
import { usePollWhileVisible } from '../hooks/usePollWhileVisible'
import { dayLabel, dayLabels } from '../lib/happyHourDays'
import { useT } from '../i18n/useT'
import { promotionsNs } from '../i18n/ns/promotions'
import { commonNs } from '../i18n/ns/common'
import { describeStaffError } from '../i18n/staffErrors'
import type { StringKey } from '../i18n/core'
import type promotionsRo from '../i18n/ns/promotions/ro'

// Ce a aflat fila despre bază după o salvare FĂRĂ răspuns (vezi `handleSave`):
// `not_saved` = lista reîncărcată arată că salvarea n-a ajuns (`create` alege
// textul: regula lipsește / regula n-are valorile tale); `unverified` = lista
// nu s-a putut reîncărca, deci nu se știe.
// Și după o MODIFICARE care n-a atins niciun rând (recenzia adversarială a lui
// cdcb6dd, `saveUpdate`): `gone` = regula nu mai e în listă (ștearsă pe alt
// dispozitiv sau ascunsă de RLS) — aceeași modificare n-are ce schimba;
// `conflict` = regula a fost modificată pe alt dispozitiv după ce s-a deschis
// editorul — salvarea n-a suprascris-o, iar sesiunea e re-armată pe rândul
// proaspăt; `stale_unverified` = rândul nu mai era cel deschis, dar lista nu s-a
// putut reîncărca.
type VerifyResult =
  | { kind: 'not_saved'; create: boolean }
  | { kind: 'unverified' }
  | { kind: 'gone' }
  | { kind: 'conflict' }
  | { kind: 'stale_unverified' }
// Erorile ținute ca DATE (lotul L5b): validarea editorului e o cheie, refuzul
// serverului e eroarea brută; textul se compune la RANDARE, în limba curentă.
type EditorError =
  | { kind: 'invalid'; key: StringKey<typeof promotionsRo> }
  | { kind: 'server'; err: unknown }
  | VerifyResult
type RuleFields = Omit<HappyHourRule, 'id' | 'restaurant_id' | 'created_at' | 'updated_at'>
// Rezultatul unei salvări din editor; un refuz al serverului ARUNCĂ. Pe
// `saved` fila a închis deja editorul (inclusiv pe o salvare confirmată abia
// de verificare); altfel editorul rămâne deschis, deblocat, cu ciorna.
type SaveOutcome = { kind: 'saved' } | VerifyResult
// Ce face editorul cât cererea e în aer: salvează sau verifică (lista
// reîncărcată după o salvare rămasă fără răspuns).
type SavePhase = 'saving' | 'verifying'
// Ce scrie editorul deschis, ținut de filă pe toată durata lui (deschidere →
// închidere), nu pe o singură încercare. La creare: id-ul regulii, generat în
// CLIENT la deschiderea editorului (`openEditor`) și retrimis la FIECARE
// încercare, plus valorile trimise de fiecare încercare, în ordine (`attempts`) —
// verificarea le folosește ca să afle CARE încercare a ajuns (`handleSave`).
// Id-ul e per SESIUNE (recenzia adversarială a lotului C4a), nu per încercare
// și nici per filă: per încercare, un INSERT comis după ce clientul a renunțat
// la el ar rămâne alături de reîncercare — regula dublată, ambele reduc
// comenzile QR (mig 077); per filă, al doilea editor deschis ar primi 23505 pe
// id-ul primei reguli și ar SUPRASCRIE-o. O creare găsită astfel în bază (23505
// pe cheia primară, sau verificarea care găsește valorile unei încercări de
// dinainte) devine modificarea acelui id.
// La modificare, `stamp` = `updated_at`-ul rândului peste care scrie editorul
// (concurența optimistă, recenzia adversarială a lui cdcb6dd): salvarea unei
// reguli existente trimite TOATE câmpurile, inclusiv `is_active`, din lista
// încărcată la deschidere — fără gardă, readucea tăcut ce schimbase alt
// dispozitiv (un Happy Hour oprit de pe telefon pornea din nou, iar mig 077
// reducea apoi fiecare comandă QR/de ridicare). Modificarea se aplică doar
// peste ACEST `updated_at`. `null` = rândul există (23505 pe cheia primară), dar
// versiunea lui nu s-a citit încă: `saveUpdate` reîncarcă lista înainte să
// scrie, niciodată o modificare fără gardă.
type SaveSession =
  | { kind: 'create'; id: string; attempts: RuleFields[] }
  | { kind: 'update'; id: string; stamp: string | null }
type UpdateSession = Extract<SaveSession, { kind: 'update' }>
// Cum s-a încheiat o cerere de salvare (`sendWithDeadline`).
type SendResult<T> = { kind: 'answered'; value: T } | { kind: 'unanswered' }
type LoadResult = { ok: true; rules: HappyHourRule[] } | { ok: false }

// Textul unui rezultat de verificare (fiecare spune ce s-a aflat despre bază).
function verifyErrorKey(e: VerifyResult): StringKey<typeof promotionsRo> {
  switch (e.kind) {
    case 'not_saved':
      return e.create ? 'err_notSavedCreate' : 'err_notSavedUpdate'
    case 'unverified':
      return 'err_saveUnverified'
    case 'gone':
      return 'err_ruleGone'
    case 'conflict':
      return 'err_ruleChanged'
    case 'stale_unverified':
      return 'err_ruleStaleUnverified'
  }
}

// Cât așteaptă editorul confirmarea unei salvări (recenzia lotului C4a). Cât
// cererea e în aer, editorul NU se poate închide (vezi `confirmDiscard`), iar
// supabase-js nu are timeout: fără termen, o cerere care nu se mai întoarce
// (conexiune pe jumătate închisă pe mobil, PWA reluat în mijlocul cererii)
// lăsa tot panoul blocat sub overlay până la reîncărcarea paginii. La termen
// cererea se ANULEAZĂ — iar când cade pe drum fără răspunsul serverului, la fel
// (`isServerAnswer`) — și fila VERIFICĂ singură ce a ajuns în bază: lista
// reîncărcată stă sub overlay-ul modalului, deci omul n-o putea citi fără să
// închidă editorul și să-și piardă ciorna. O reîncercare nu dublează regula:
// crearea se retrimite cu ACELAȘI id (`SaveSession`).
export const HAPPY_HOUR_SAVE_TIMEOUT_MS = 20_000
// Termenul reîncărcării de verificare: și ea e o cerere fără timeout propriu,
// iar cât durează editorul rămâne blocat.
export const HAPPY_HOUR_VERIFY_TIMEOUT_MS = 10_000

// O cerere concurează cu un termen; `'timeout'` = termenul a venit primul. Un
// refuz venit ÎNAINTE de termen aruncă; unul venit după nu mai ajunge nicăieri
// (`Promise.race` s-a hotărât deja și îl absoarbe).
async function raceDeadline<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  try {
    return await Promise.race([p, deadline])
  } finally {
    clearTimeout(timer)
  }
}

// Eroarea e RĂSPUNSUL serverului? Un refuz poartă un cod (SQLSTATE sau
// PGRST…), iar cererea nu s-a aplicat: editorul îl afișează și o reîncercare
// pleacă direct. Altfel nu se știe ce e în bază (recenzia lotului C4a): o
// cădere de rețea (`TypeError: Load failed` pe Safari, `Failed to fetch` —
// lib/networkError; supabase-js o întoarce cu `code: ''`) poate veni DUPĂ ce
// INSERT-ul s-a comis și doar răspunsul s-a pierdut (Wi-Fi → 4G, reset
// HTTP/2), iar o eroare fără cod (ex. pagina HTML a unui gateway 502/504) nu
// spune nici ea nimic despre tranzacție. Tratată ca refuz, editorul spunea
// „Fără conexiune” despre o salvare care poate fi deja în bază, iar lista nu se
// mai reîncărca la închidere. Deci se tratează ca termenul: fila verifică lista.
function isServerAnswer(e: unknown): boolean {
  if (isNetworkError(e)) return false
  const code = e != null && typeof e === 'object' ? (e as { code?: unknown }).code : undefined
  return typeof code === 'string' && code !== ''
}

// Rândul din bază are EXACT valorile trimise? (verificarea unei modificări
// fără răspuns, și a unei creări: CARE încercare a ajuns). Ora vine din `time`
// cu secunde, zilele ca mulțime, iar sumele din `numeric(10,2)` se compară în
// bani: comparația e EXACTĂ fiindcă și încercarea poartă deja sume la precizia
// coloanei — editorul le rotunjește ZECIMAL înainte de trimitere, ca baza
// (`parseDecimalCents` în `go()`), deci ambele părți au cel mult două zecimale
// și `Math.round(v * 100)` nu greșește pe niciuna. O nepotrivire falsă NU e
// inofensivă (recenzia adversarială a lui b3121b8): la o modificare ar cere
// doar o reîncercare, dar la o CREARE fără răspuns un rând care nu are
// valorile niciunei încercări trece drept „salvat” (alt dispozitiv l-a
// modificat, HHM10) — „1,005” trimis ca 1.005 dădea 100 de bani în client și
// 101 în bază, deci nepotrivire cu FIECARE încercare și „salvat” peste
// valorile altei încercări (HHM26).
function sameRuleFields(row: HappyHourRule, f: RuleFields): boolean {
  const hm = (v: string) => v.slice(0, 5)
  const cents = (v: number | null) => (v == null ? null : Math.round(Number(v) * 100))
  const daySet = (d: readonly number[]) => [...d].sort((a, b) => a - b).join(',')
  return (
    row.name === f.name &&
    row.is_active === f.is_active &&
    hm(row.starts_at) === hm(f.starts_at) &&
    hm(row.ends_at) === hm(f.ends_at) &&
    daySet(row.days_of_week) === daySet(f.days_of_week) &&
    row.scope === f.scope &&
    (row.category_id ?? null) === (f.category_id ?? null) &&
    (row.product_id ?? null) === (f.product_id ?? null) &&
    row.discount_type === f.discount_type &&
    cents(row.discount_value) === cents(f.discount_value) &&
    cents(row.max_discount) === cents(f.max_discount)
  )
}

// 23505 pe CHEIA PRIMARĂ la INSERT = rândul cu id-ul sesiunii există deja. Id-ul
// e un UUID generat în client la deschiderea editorului (`openEditor`), deci
// rândul nu poate fi decât al ACESTEI sesiuni, și la PRIMA trimitere (recenzia
// adversarială a lotului C4a): o încercare de dinainte, comisă după ce clientul
// a renunțat la ea, sau chiar aceeași cerere livrată de DOUĂ ori de transport —
// Chromium retrimite o cerere rămasă fără antete de răspuns după un
// ERR_CONNECTION_RESET pe un socket keep-alive refolosit (sau o eroare HTTP/2 /
// QUIC), indiferent de metodă, deci prima livrare se comite și a doua primește
// 23505. Doar pe cheia primară (mig 036: `id uuid primary key`, adică
// `happy_hour_rules_pkey` — numele constrângerii stă în mesaj în orice limbă,
// iar `details` numește coloana): o constrângere unică ADĂUGATĂ mai târziu (ex.
// pe nume) e un refuz real; tratată ca rândul sesiunii, modificarea ar ținti un
// id care nu există, iar editorul s-ar închide pe „salvat” fără nicio regulă.
function isOwnRowConflict(e: unknown): boolean {
  if (e == null || typeof e !== 'object') return false
  const { code, message, details } = e as {
    code?: unknown
    message?: unknown
    details?: unknown
  }
  if (code !== '23505') return false
  return (
    (typeof message === 'string' && message.includes('happy_hour_rules_pkey')) ||
    (typeof details === 'string' && details.includes('(id)='))
  )
}
// Erorile care țin DOAR de reducerea în procent (plafonul există doar acolo, iar
// „max 100” nu se aplică unei sume în lei): la trecerea pe sumă fixă se șterg,
// altfel mesajul rămânea lângă un câmp ascuns (recenzia lotului C4a).
const PERCENT_ONLY_ERRORS: readonly StringKey<typeof promotionsRo>[] = [
  'err_capInvalid',
  'err_pctMax',
]

interface Props {
  restaurantId: string
  // planSurface.fiscal (lotul P): butonul „Aplică Happy Hour" există doar în
  // plata reală (PayModal, Planul 3). Pe Planul 2 regulile se aplică singure pe
  // comenzile QR și de ridicare (trg_apply_happy_hour_auto, mig 077), deci
  // textul nu mai promite un buton „la plată".
  payAtTable: boolean
}

interface Category {
  id: string
  name: string
  emoji: string | null
}
interface Product {
  id: string
  name: string
  emoji: string | null
}

// ── Style ────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: D.s1,
  border: `1px solid ${D.border}`,
  borderRadius: 14,
  padding: 22,
  marginBottom: 16,
}
const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 12px',
  fontSize: '0.9rem',
  color: D.t1,
  outline: 'none',
  height: 40,
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: '0.74rem',
  color: D.t2,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 5,
  fontWeight: 500,
}
const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 14px',
  height: 38,
  borderRadius: 8,
  fontSize: '0.86rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  ...extra,
})

// ── Main ──────────────────────────────────────────────────────
export default function HappyHourTab({ restaurantId, payAtTable }: Props) {
  // Sus, înaintea returnului de încărcare: cardurile, editorul și confirmarea
  // folosesc aceleași namespace-uri, deci nu suspendă fila (L4b/L4c).
  const { t, tp } = useT(promotionsNs)
  const tc = useT(commonNs)
  const toast = useToast()
  const [rules, setRules] = useState<HappyHourRule[]>([])
  const [active, setActive] = useState<ActiveRule[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  // Restaurantul pentru care s-a încheiat O încărcare (null = niciuna încă).
  // Spinnerul pe toată fila stă DOAR până atunci (recenzia lotului C4a): o
  // reîncărcare în fundal (după termenul unei salvări, cu editorul deschis) nu
  // are voie să-l arate — returnul de mai jos ar demonta editorul, cu ciorna
  // lui. Înainte, `loading && rules.length === 0` făcea exact asta pe o filă
  // fără reguli. (Tiparul „schelet doar fără date” din InvoicesTab.)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [err, setErr] = useState<{ err: unknown } | null>(null)
  const [editing, setEditing] = useState<HappyHourRule | 'new' | null>(null)
  // Garda de secvență (tiparul InvoicesTab): doar încărcarea pornită ULTIMA
  // scrie starea. Fără ea, o reîncărcare lentă care se întorcea DUPĂ una mai
  // nouă punea înapoi lista de dinainte, iar la o schimbare de restaurant pe
  // aceeași instanță răspunsul întârziat al celui VECHI aducea regulile lui și
  // `loadedFor` pe id-ul lui: spinner pe toată fila, pentru totdeauna. (Fila e
  // și montată pe cheia restaurantului în DashboardPage — recenzia CodeRabbit pe
  // #393; garda rămâne pentru încărcările aceluiași restaurant.)
  const loadSeqRef = useRef(0)
  // Câte erori a pus fila pe banner (crește la fiecare). O încărcare reușită
  // șterge bannerul doar dacă nu a apărut între timp o eroare NOUĂ (ex. o
  // ștergere refuzată cât lista era în aer): acelea nu le-a lămurit ea.
  const errSeqRef = useRef(0)
  const showErr = useCallback((e: unknown) => {
    errSeqRef.current += 1
    setErr({ err: e })
  }, [])
  const sessionRef = useRef<SaveSession | null>(null)
  // O salvare a rămas fără răspuns: la închiderea editorului lista se mai
  // reîncarcă o dată — o cerere anulată în client poate fi comisă și DUPĂ
  // verificare, iar omul care renunță trebuie să vadă ce e în bază.
  const reloadOnCloseRef = useRef(false)

  // `signal` (doar reîncărcarea de verificare) anulează cererile la termenul
  // ei; o încărcare anulată nu pune nimic pe bannerul filei — o spune editorul.
  // Bannerul NU se șterge când PORNEȘTE o încărcare, ci doar când una REUȘEȘTE
  // și e încă ultima (recenzia adversarială a lotului C4a): o verificare
  // abandonată la termenul ei nu mai ajunge la nicio ramură care scrie
  // bannerul, deci un `setErr(null)` de la început lăsa o filă a cărei PRIMĂ
  // încărcare picase să arate „Nicio regulă încă” peste o listă care nu s-a
  // încărcat niciodată.
  const load = useCallback(
    async (signal?: AbortSignal): Promise<LoadResult> => {
      const seq = ++loadSeqRef.current
      const errSeq = errSeqRef.current
      try {
        const cats = supabase
          .from('categories')
          .select('id,name,emoji')
          .eq('restaurant_id', restaurantId)
          .order('display_order')
        const prods = supabase
          .from('products')
          .select('id,name,emoji')
          .eq('restaurant_id', restaurantId)
          .eq('is_active', true)
          .order('name')
        const [rs, act, catsRes, prodsRes] = await Promise.all([
          fetchHappyHourRules(restaurantId, signal),
          // Un eșec lasă bannerul „activ acum” cum era (ca sondajul de la 60 s).
          evaluateHappyHourForNow(restaurantId).catch(() => null),
          signal ? cats.abortSignal(signal) : cats,
          signal ? prods.abortSignal(signal) : prods,
        ])
        // Verificarea a renunțat (termenul ei a trecut, editorul a spus deja
        // „nu se știe”): ce mai sosește nu scrie starea.
        if (signal?.aborted) return { ok: false }
        if (seq === loadSeqRef.current) {
          setRules(rs)
          if (act != null) setActive(act)
          // Doar dintr-o cerere REUȘITĂ (recenzia lotului C4a): builder-ele
          // supabase-js nu aruncă — o cerere picată sau anulată se încheie cu
          // `{ data: null, error }`, iar `data ?? []` golea listele editorului
          // rămas DESCHIS peste reîncărcarea de verificare: categoria/produsul
          // ales arăta doar „— Selectează… —” și nu se mai putea alege altul,
          // iar cardurile din spate arătau „?”. Pe eroare rămân cele de
          // dinainte.
          if (!catsRes.error) setCategories((catsRes.data ?? []) as Category[])
          if (!prodsRes.error) setProducts((prodsRes.data ?? []) as Product[])
          // O sub-cerere picată la o încărcare OBIȘNUITĂ (fără `signal`: prima,
          // cea de după o salvare, cea de la închidere) se spune pe banner
          // (recenzia adversarială a lui cdcb6dd): sărită tăcut, cu bannerul
          // șters, la PRIMA încărcare listele rămâneau goale — o regulă pe
          // categorie/produs nu se putea crea, iar editorul cerea „Selectează o
          // categorie” cu selectul gol, fără niciun motiv vizibil. Verificarea
          // (cu `signal`) păstrează listele de dinainte și nu atinge bannerul:
          // eroarea ei o spune editorul, iar bannerul stă oricum sub modal.
          const subErr = catsRes.error ?? prodsRes.error
          if (subErr != null) {
            if (signal == null) showErr(subErr)
          } else if (errSeqRef.current === errSeq) {
            // Totul a venit: eroarea de dinainte (o încărcare picată, o acțiune
            // refuzată) nu mai descrie fila.
            setErr(null)
          }
        }
        return { ok: true, rules: rs }
      } catch (e) {
        if (seq === loadSeqRef.current && !signal?.aborted) showErr(e)
        return { ok: false }
      } finally {
        if (seq === loadSeqRef.current) setLoadedFor(restaurantId)
      }
    },
    [restaurantId, showErr],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Re-evaluează regula activă la 60 s, DOAR cu fila vizibilă (perf-staff-6);
  // la revenire, imediat — ora a trecut cât timp n-a privit nimeni.
  usePollWhileVisible(() => {
    evaluateHappyHourForNow(restaurantId)
      .then(setActive)
      .catch(() => {})
  }, 60_000)

  function openEditor(target: HappyHourRule | 'new') {
    // Un id NOU la fiecare deschidere pentru o regulă nouă (`SaveSession`).
    // `crypto.randomUUID` direct, ca `lib/idempotency.ts` și cheia comenzii
    // ospătarului (WaiterEntry): panoul rulează doar pe https, unde există în
    // toate browserele țintă. Un înlocuitor care nu e UUID (ca vizitatorul din
    // `lib/affiliate.ts`) nu se poate folosi: coloana e `uuid`, INSERT-ul ar fi
    // respins.
    // La o regulă existentă, sesiunea ține `updated_at`-ul rândului din listă:
    // versiunea peste care scrie editorul (`SaveSession`).
    sessionRef.current =
      target === 'new'
        ? { kind: 'create', id: crypto.randomUUID(), attempts: [] }
        : { kind: 'update', id: target.id, stamp: target.updated_at }
    setEditing(target)
  }

  function closeEditor() {
    sessionRef.current = null
    setEditing(null)
    if (!reloadOnCloseRef.current) return
    reloadOnCloseRef.current = false
    void load()
  }

  // Salvarea s-a confirmat (direct sau abia prin verificare): editorul se
  // închide. `late` = confirmată de lista reîncărcată după o salvare fără
  // răspuns — omul o află dintr-un mesaj, fiindcă editorul dispare fără
  // răspunsul obișnuit.
  function finishSaved(late: boolean) {
    sessionRef.current = null
    reloadOnCloseRef.current = false
    setEditing(null)
    if (late) {
      // Lista tocmai s-a reîncărcat (verificarea), deci nu mai e nevoie de una.
      toast.success(t('saved_late'))
      return
    }
    void load()
  }

  // Reîncărcarea de verificare, mărginită de HAPPY_HOUR_VERIFY_TIMEOUT_MS
  // (anulată la termen). Lista ei ajunge și sub editor (aceeași `load`). null
  // = nu se știe ce e în bază.
  async function reloadForVerify(): Promise<HappyHourRule[] | null> {
    const ctrl = new AbortController()
    const r = await raceDeadline(load(ctrl.signal), HAPPY_HOUR_VERIFY_TIMEOUT_MS)
    if (r === 'timeout') {
      ctrl.abort()
      return null
    }
    return r.ok ? r.rules : null
  }

  // Cererea concurează cu HAPPY_HOUR_SAVE_TIMEOUT_MS; la termen e anulată
  // (`AbortSignal`, nu doar ignorată). `answered` = serverul a răspuns, cu
  // rezultatul cererii (la modificare: rândul atins sau `null`, vezi
  // `saveUpdate`); `unanswered` = serverul n-a răspuns: termenul a trecut SAU
  // cererea a căzut pe drum (`isServerAnswer` fals) — în ambele cazuri salvarea
  // poate fi totuși în bază, deci apelantul verifică. Doar un refuz al
  // serverului ARUNCĂ.
  async function sendWithDeadline<T>(
    op: (signal: AbortSignal) => Promise<T>,
  ): Promise<SendResult<T>> {
    const ctrl = new AbortController()
    try {
      const r = await raceDeadline(
        op(ctrl.signal).then((value) => ({ kind: 'answered' as const, value })),
        HAPPY_HOUR_SAVE_TIMEOUT_MS,
      )
      if (r !== 'timeout') return r
    } catch (e) {
      if (isServerAnswer(e)) throw e
    }
    ctrl.abort()
    reloadOnCloseRef.current = true
    return { kind: 'unanswered' }
  }

  // Regula sesiunii nu mai e în listă: aceeași modificare n-are ce schimba, deci
  // editorul nu sfătuiește o reîncercare. Lista tocmai s-a reîncărcat, iar
  // închiderea editorului o mai reîncarcă o dată.
  function ruleGone(): SaveOutcome {
    reloadOnCloseRef.current = true
    return { kind: 'gone' }
  }

  // Modificarea unei reguli existente, cu gardă pe `updated_at` (`SaveSession`).
  async function saveUpdate(
    s: UpdateSession,
    rule: RuleFields,
    onPhase: (p: SavePhase) => void,
  ): Promise<SaveOutcome> {
    let stamp = s.stamp
    if (stamp == null) {
      // 23505 pe cheia primară, fără o listă proaspătă: rândul sesiunii există,
      // dar nu se știe peste ce versiune scrie editorul — se citește întâi, nu
      // se trimite o modificare fără gardă. Rândul e în bază (activ, poate),
      // deci lista se reîncarcă la închidere chiar dacă citirea de aici pică.
      reloadOnCloseRef.current = true
      onPhase('verifying')
      const fresh = await reloadForVerify()
      if (fresh == null) return { kind: 'unverified' }
      const row = fresh.find((r) => r.id === s.id)
      if (row == null) return ruleGone()
      stamp = row.updated_at
      s.stamp = stamp
    }
    onPhase('saving')
    const guard = stamp
    const sent = await sendWithDeadline((signal) =>
      updateHappyHourRule(s.id, rule, { ifUpdatedAt: guard, signal }),
    )
    if (sent.kind === 'answered') {
      if (sent.value != null) {
        // Versiunea scrisă acum e cea peste care scrie orice salvare următoare.
        s.stamp = sent.value.updated_at
        finishSaved(false)
        return { kind: 'saved' }
      }
      return resolveUntouched(s, rule, guard, onPhase)
    }
    // Fără răspuns: modificarea a ajuns dacă rândul din bază are EXACT valorile
    // trimise. O nepotrivire = nu s-a salvat; o reîncercare pleacă cu aceeași
    // gardă (dacă între timp rândul s-a schimbat, o prinde `resolveUntouched`).
    onPhase('verifying')
    const fresh = await reloadForVerify()
    if (fresh == null) return { kind: 'unverified' }
    const row = fresh.find((r) => r.id === s.id)
    if (row == null) return ruleGone()
    if (sameRuleFields(row, rule)) {
      finishSaved(true)
      return { kind: 'saved' }
    }
    return { kind: 'not_saved', create: false }
  }

  // Serverul a RĂSPUNS, dar modificarea n-a atins niciun rând: rândul nu mai e
  // cel cu `guard` (sau nu mai e deloc). Lista reîncărcată spune de ce:
  // lipsește → `gone`; are deja valorile trimise → salvat (o încercare de
  // dinainte a ajuns tăcut, ex. după termenul ei); are încă `guard` → nimeni nu
  // l-a schimbat, deci modificarea a fost refuzată tăcut (RLS după o schimbare
  // de rol): mesajul de drepturi, nu „modificată pe alt dispozitiv” la nesfârșit;
  // altfel → `conflict`, iar sesiunea trece pe versiunea proaspătă: ciorna
  // rămâne, iar o a doua salvare, deliberată, o suprascrie știind.
  async function resolveUntouched(
    s: UpdateSession,
    rule: RuleFields,
    guard: string,
    onPhase: (p: SavePhase) => void,
  ): Promise<SaveOutcome> {
    onPhase('verifying')
    const fresh = await reloadForVerify()
    if (fresh == null) {
      reloadOnCloseRef.current = true
      return { kind: 'stale_unverified' }
    }
    const row = fresh.find((r) => r.id === s.id)
    if (row == null) return ruleGone()
    if (sameRuleFields(row, rule)) {
      s.stamp = row.updated_at
      finishSaved(true)
      return { kind: 'saved' }
    }
    if (row.updated_at === guard) {
      throw Object.assign(new Error(MSG_NO_PERMISSION), { code: '42501' })
    }
    s.stamp = row.updated_at
    return { kind: 'conflict' }
  }

  // Refuzul serverului se propagă în RuleEditor (setErr LOCAL, vizibil în
  // modal) — pe bannerul de aici ar fi ACOPERIT de overlay-ul modalului rămas
  // deschis.
  async function handleSave(rule: RuleFields, onPhase: (p: SavePhase) => void): Promise<SaveOutcome> {
    const s = sessionRef.current
    // Editorul există doar cu o sesiune (`openEditor` o pune înaintea lui
    // `setEditing`); fără ea nu se trimite nimic.
    if (s == null) return { kind: 'unverified' }
    if (s.kind === 'update') return saveUpdate(s, rule, onPhase)

    // Crearea trimite MEREU id-ul sesiunii, și la reîncercare: înainte nu e
    // nimic de lămurit. O încercare de dinainte ajunsă totuși în bază (comisă
    // după ce clientul a renunțat la ea) face ca aceasta să fie respinsă de
    // cheia primară (23505) — niciodată un al doilea rând. Valorile încercării
    // rămân în sesiune, pentru verificarea de mai jos.
    onPhase('saving')
    s.attempts.push(rule)
    let sent: SendResult<HappyHourRule>
    try {
      sent = await sendWithDeadline((signal) =>
        createHappyHourRule(restaurantId, s.id, rule, signal),
      )
    } catch (e) {
      // Doar un refuz al SERVERULUI ajunge aici (o cădere de rețea e „fără
      // răspuns”, `sendWithDeadline`). 23505 pe cheia primară = rândul
      // sesiunii există deja, la orice trimitere (`isOwnRowConflict`): de acum
      // editorul scrie regula aceea, cu ce e acum în formular — o modificare pe
      // id, cu confirmarea ei obișnuită. Versiunea rândului nu se știe încă
      // (`stamp: null`): `saveUpdate` o citește înainte să scrie.
      if (isOwnRowConflict(e)) {
        const next: UpdateSession = { kind: 'update', id: s.id, stamp: null }
        sessionRef.current = next
        return saveUpdate(next, rule, onPhase)
      }
      throw e
    }
    if (sent.kind === 'answered') {
      finishSaved(false)
      return { kind: 'saved' }
    }
    // Fără răspuns: se caută rândul cu id-ul sesiunii în lista reîncărcată.
    // Nu după nume — numele nu sunt unice, iar o regulă cu același nume creată
    // de pe alt dispozitiv trecea drept a acestui editor (omul își pierdea
    // ciorna, iar reîncercarea ajungea să modifice regula CELUILALT).
    onPhase('verifying')
    const fresh = await reloadForVerify()
    if (fresh == null) return { kind: 'unverified' }
    const row = fresh.find((r) => r.id === s.id)
    // Negăsit: reîncercarea retrimite ACELAȘI id, deci o creare comisă abia
    // după această verificare nu se dublează (23505 → modificare).
    if (row == null) return { kind: 'not_saved', create: true }
    // Rândul are valorile unei încercări DE DINAINTE, nu ale acesteia (recenzia
    // adversarială a lotului C4a): aceea a ajuns, iar aceasta a fost respinsă
    // de cheia primară — un INSERT nu poate suprascrie un rând —, cu răspunsul
    // pierdut și el. Confirmată doar pe id, o reîncercare cu valori corectate
    // (categoria „Cocktailuri” în loc de toate produsele, alt procent, alt
    // interval) se închidea pe „Regula s-a salvat”, ciorna se pierdea, iar
    // reducerea veche se aplica pe comenzile QR și de ridicare (mig 077). Ca la
    // 23505-ul primit: modificarea id-ului, cu ce e acum în formular — peste
    // versiunea pe care tocmai a citit-o verificarea.
    const earlier = s.attempts.slice(0, -1)
    if (!sameRuleFields(row, rule) && earlier.some((f) => sameRuleFields(row, f))) {
      const next: UpdateSession = { kind: 'update', id: s.id, stamp: row.updated_at }
      sessionRef.current = next
      return saveUpdate(next, rule, onPhase)
    }
    // Valorile acestei încercări, sau ale NICIUNEIA: un rând cu acest id nu
    // poate fi decât al sesiunii, deci regula s-a creat, iar valori pe care
    // nu le-a trimis nicio încercare vin de la alt dispozitiv, care a modificat-o
    // după ce a ajuns. Editorul nu „repară” peste modificarea celuilalt.
    // Ramura cere o comparație EXACTĂ: o nepotrivire falsă cu toate încercările
    // ar ajunge aici ca „salvat” — de aceea sumele pleacă deja rotunjite ca în
    // bază (`go()`, HHM26).
    finishSaved(true)
    return { kind: 'saved' }
  }

  // Lotul C4a: confirmarea comună (ui/confirm: dialog real, focus, Escape) în
  // locul unui overlay făcut de mână. `cancelLabel` EXPLICIT: implicitul
  // urmează <html lang> (pe panou `ro`), nu limba personalului.
  async function handleDelete(rule: HappyHourRule) {
    const ok = await confirmDialog({
      title: t('del_title'),
      description: t('del_question', { name: rule.name }),
      confirmLabel: tc.t('delete'),
      cancelLabel: tc.t('cancel'),
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteHappyHourRule(rule.id)
      void load()
    } catch (e) {
      showErr(e)
    }
  }

  // Comutatorul trimite DOAR `is_active`, spre starea scrisă pe buton, deci nu
  // poate readuce altceva decât a cerut omul: n-are nevoie de gardă. Dacă n-a
  // atins niciun rând (regula ștearsă pe alt dispozitiv, sau fără drepturi),
  // o spune — înainte, apăsarea pe „Oprește” nu făcea nimic, fără niciun mesaj.
  async function toggleActive(rule: HappyHourRule) {
    try {
      const done = await updateHappyHourRule(rule.id, { is_active: !rule.is_active })
      void load()
      // DUPĂ `load()`: reușita ei șterge doar erorile de dinaintea ei (`errSeqRef`).
      if (done == null) showErr(Object.assign(new Error(MSG_NOT_FOUND), { code: 'PGRST116' }))
    } catch (e) {
      showErr(e)
    }
  }

  if (loadedFor !== restaurantId) {
    return <InlineSpinner label={t('loading')} />
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 22,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: '0.86rem', color: D.t2, marginTop: 4, maxWidth: 600 }}>
            {payAtTable ? t('intro_payAtTable') : t('intro_auto')}
          </div>
        </div>
        <button
          onClick={() => openEditor('new')}
          style={btn({ background: D.gold, color: '#000', height: 40 })}
        >
          <Icon name="plus" size={16} />
          {t('newRule')}
        </button>
      </div>

      {err == null ? null : (
        <div
          style={{
            ...card,
            borderColor: D.red,
            background: D.redA,
            color: D.red,
            marginBottom: 16,
          }}
        >
          {describeStaffError(err.err, tc)}
          <button
            onClick={() => setErr(null)}
            aria-label={t('closeError')}
            style={{
              float: 'right',
              background: 'transparent',
              border: 'none',
              color: D.red,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 44,
              minHeight: 44,
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {/* Active right now banner */}
      {active.length === 0 ? null : (
        <div
          style={{
            ...card,
            borderColor: D.gold,
            background: 'rgba(212,165,116,0.06)',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontSize: '0.86rem',
              color: D.gold,
              fontWeight: 600,
              marginBottom: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="sparkle" size={15} />
            {tp('activeNow', active.length)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {active.map((r) => (
              <span
                key={r.id}
                style={{
                  padding: '6px 12px',
                  background: D.goldA,
                  borderRadius: 6,
                  fontSize: '0.84rem',
                  color: D.t1,
                  border: `1px solid ${D.gold}`,
                }}
              >
                <strong>{r.name}</strong> ·{' '}
                {r.discount_type === 'percent'
                  ? t('value_pct', { value: r.discount_value })
                  : t('value_amount', { value: r.discount_value })}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rules list */}
      {rules.length === 0 ? (
        <EmptyState
          icon="percent"
          title={t('empty_title')}
          description={payAtTable ? t('empty_payAtTable') : t('empty_auto')}
          action={
            <button
              onClick={() => openEditor('new')}
              style={btn({ background: D.gold, color: '#000', height: 40 })}
            >
              <Icon name="plus" size={16} />
              {t('firstRule')}
            </button>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rules.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              categories={categories}
              products={products}
              onEdit={() => openEditor(r)}
              onDelete={() => void handleDelete(r)}
              onToggle={() => void toggleActive(r)}
            />
          ))}
        </div>
      )}

      {editing && (
        <RuleEditor
          rule={editing === 'new' ? null : editing}
          categories={categories}
          products={products}
          onClose={closeEditor}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ── Rule card ────────────────────────────────────────────────
function RuleCard({
  rule,
  categories,
  products,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: HappyHourRule
  categories: Category[]
  products: Product[]
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  const { t } = useT(promotionsNs)
  const tc = useT(commonNs)
  const cat = categories.find((c) => c.id === rule.category_id)
  const prod = products.find((p) => p.id === rule.product_id)
  const days =
    rule.days_of_week.length === 0
      ? t('days_all')
      : rule.days_of_week.map((d) => dayLabel(d, { t })).join(' ')
  const scope =
    rule.scope === 'all' ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon name="tag" size={13} /> {t('scope_all')}
      </span>
    ) : rule.scope === 'category' ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon name="box" size={13} /> {cat?.emoji || ''} {cat?.name || '?'}
      </span>
    ) : (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon name="utensils" size={13} /> {prod?.emoji || ''} {prod?.name || '?'}
      </span>
    )

  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${rule.is_active ? D.gold + '44' : D.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        opacity: rule.is_active ? 1 : 0.55,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 280px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 4,
              flexWrap: 'wrap',
            }}
          >
            <strong style={{ fontSize: '0.98rem', color: D.t1, fontFamily: 'Fraunces,serif' }}>
              {rule.name}
            </strong>
            {rule.is_active ? (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 8px',
                  background: D.greenA,
                  color: D.green,
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                {t('status_active')}
              </span>
            ) : (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 8px',
                  background: D.s3,
                  color: D.t3,
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                {t('status_off')}
              </span>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 14px',
              fontSize: '0.82rem',
              color: D.t2,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="clock" size={13} /> {rule.starts_at.slice(0, 5)}–{rule.ends_at.slice(0, 5)}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="calendar" size={13} /> {days}
            </span>
            <span>{scope}</span>
            <span style={{ color: D.gold, fontWeight: 600 }}>
              {rule.discount_type === 'percent'
                ? t('card_offPct', { value: rule.discount_value })
                : t('card_offAmount', { value: rule.discount_value })}
              {/* Un plafon STOCAT de 0 lei se arată (recenzia adversarială a
                  lui cdcb6dd): serverul plafonează fiecare reducere la el
                  (mig 077), deci regula nu reduce nimic — ascuns, cardul
                  arăta „−20%” peste o regulă care nu dă nicio reducere.
                  Editorul nu mai trimite 0 (`go()`), iar o salvare din editor
                  îl face „fără plafon”. */}
              {rule.max_discount == null
                ? null
                : ` ${t('card_cap', { amount: rule.max_discount })}`}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onToggle}
            style={btn({
              background: rule.is_active ? D.s3 : D.goldA,
              color: rule.is_active ? D.t2 : D.goldL,
              border: `1px solid ${D.border}`,
              height: 32,
              padding: '0 10px',
              fontSize: '0.78rem',
            })}
          >
            {rule.is_active ? t('stop') : t('start')}
          </button>
          <button
            onClick={onEdit}
            style={btn({
              background: D.s3,
              color: D.t1,
              border: `1px solid ${D.border}`,
              height: 32,
              padding: '0 10px',
              fontSize: '0.78rem',
            })}
          >
            {tc.t('edit')}
          </button>
          <button
            onClick={onDelete}
            aria-label={t('deleteAria', { name: rule.name })}
            style={btn({
              background: 'transparent',
              color: D.red,
              border: `1px solid ${D.red}33`,
              height: 32,
              minWidth: 44,
              padding: '0 10px',
              fontSize: '0.78rem',
            })}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Rule editor modal ────────────────────────────────────────
// Lotul C4a: `Modal` din sharedUI (role="dialog" cu numele din titlu, capcană
// de focus, Escape, portal, scroll blocat, fundalul închide doar un click
// început ȘI terminat pe el) în locul unui overlay `div` făcut de mână: o
// selecție de text trasă din panou închidea editorul și pierdea regula. Cu
// formularul modificat, orice închidere (fundal, Escape, ✕, „Anulează”)
// întreabă întâi. „Creează” e blocat cât timp cererea e în aer — un dublu-click
// crea regula de DOUĂ ori — și la fel tot formularul și ÎNCHIDEREA (recenzia
// lotului C4a): o modificare tastată în timpul cererii nu intra în ea și se
// pierdea la succes, iar un editor închis și redeschis în timpul cererii era
// închis de succesul celei VECHI (`setEditing(null)` din părinte), cu ciorna
// lui cu tot; redeschis pe ACEEAȘI regulă, pornea de la valorile de dinainte
// de salvare și, salvat, readucea tăcut reducerea veche — bani greșiți pe
// comenzi, fiindcă reducerea se aplică pe server. Blocajul e MĂRGINIT: după
// HAPPY_HOUR_SAVE_TIMEOUT_MS cererea se anulează, fila verifică lista (cel
// mult HAPPY_HOUR_VERIFY_TIMEOUT_MS) și fie închide editorul (salvarea ajunsese),
// fie îl deblochează cu ce s-a tastat și spune ce a aflat. Reducerea în sine se
// aplică pe SERVER (trg_apply_happy_hour_auto, mig 077): aici doar definim
// regula, fără niciun calcul de reducere în client.
function RuleEditor({
  rule,
  categories,
  products,
  onClose,
  onSave,
}: {
  rule: HappyHourRule | null
  categories: Category[]
  products: Product[]
  onClose: () => void
  onSave: (r: RuleFields, onPhase: (p: SavePhase) => void) => Promise<SaveOutcome>
}) {
  const { t } = useT(promotionsNs)
  const tc = useT(commonNs)
  const [name, setName] = useState(rule?.name ?? '')
  const [startsAt, setStartsAt] = useState(rule?.starts_at?.slice(0, 5) ?? '17:00')
  const [endsAt, setEndsAt] = useState(rule?.ends_at?.slice(0, 5) ?? '19:00')
  const [days, setDays] = useState<number[]>(rule?.days_of_week ?? [])
  const [scope, setScope] = useState<'all' | 'category' | 'product'>(rule?.scope ?? 'all')
  const [categoryId, setCategoryId] = useState(rule?.category_id ?? '')
  const [productId, setProductId] = useState(rule?.product_id ?? '')
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>(
    rule?.discount_type ?? 'percent',
  )
  const [discountValue, setDiscountValue] = useState(String(rule?.discount_value ?? 20))
  const [maxDiscount, setMaxDiscount] = useState(
    rule?.max_discount != null ? String(rule.max_discount) : '',
  )
  const [isActive, setIsActive] = useState(rule?.is_active ?? true)
  const [err, setErr] = useState<EditorError | null>(null)
  // null = nimic în aer; altfel ce face fila: salvează sau verifică.
  const [phase, setPhase] = useState<SavePhase | null>(null)
  const saving = phase != null
  // Garda SINCRONĂ: două click-uri în același tick ar vedea încă `saving` false.
  const savingRef = useRef(false)
  const isMobile = useIsMobile()
  const uid = useId()
  const ids = {
    name: `${uid}-name`,
    from: `${uid}-from`,
    to: `${uid}-to`,
    days: `${uid}-days`,
    scope: `${uid}-scope`,
    discount: `${uid}-discount`,
    value: `${uid}-value`,
    cap: `${uid}-cap`,
    capHint: `${uid}-capHint`,
    err: `${uid}-err`,
  }

  const snapshot = JSON.stringify([
    name,
    startsAt,
    endsAt,
    days,
    scope,
    categoryId,
    productId,
    discountType,
    discountValue,
    maxDiscount,
    isActive,
  ])
  const [initialSnapshot] = useState(snapshot)

  async function confirmDiscard(): Promise<boolean> {
    // Cererea e în aer: nici „Anulează” (în formularul blocat), nici
    // ✕/Escape/fundalul (toate trec pe aici, prin `confirmClose`) nu închid
    // editorul până nu se termină — cu succes, refuz sau termenul din părinte
    // (inclusiv verificarea de după el).
    if (savingRef.current) return false
    if (snapshot === initialSnapshot) return true
    return confirmDialog({
      title: t('discard_title'),
      description: t('discard_desc'),
      confirmLabel: t('discard_confirm'),
      // EXPLICIT: implicitul urmează <html lang> (pe panou `ro`).
      cancelLabel: t('discard_stay'),
      destructive: true,
    })
  }

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))
  }

  function go() {
    if (savingRef.current) return
    if (!name.trim()) {
      setErr({ kind: 'invalid', key: 'err_name' })
      return
    }
    // Câmpurile sunt text cu tastatură zecimală (lotul C4a): „12,5” e 12.5. Pe
    // vechiul `type="number"`, `replace(',', '.')` era cod mort — valoarea nu
    // conținea niciodată virgulă, iar „12,5” ajungea gol.
    //
    // Sumele pleacă la precizia COLOANEI (`numeric(10,2)`, mig 036), rotunjite
    // ZECIMAL cu jumătatea în sus, exact ca baza (`parseDecimalCents`; recenzia
    // adversarială a lui b3121b8): „1,005” e 1,01 și în cerere, nu doar în
    // rândul stocat. Trimis ca 1.005, verificarea unei creări fără răspuns îl
    // compara în bani cu rândul (1.005 × 100 = 100,4999… → 100, rândul → 101),
    // nu recunoștea încercarea care ajunsese și închidea editorul pe „salvat”
    // peste valorile ei (`sameRuleFields`, HHM26). Tot așa „0,004” e acum 0:
    // mesajul „trebuie să fie pozitivă” lângă câmp, nu refuzul CHECK-ului din
    // bază (`discount_value > 0`, care vedea tot 0,00).
    const dvCents = parseDecimalCents(discountValue)
    if (dvCents != null && Number.isNaN(dvCents)) {
      setErr({ kind: 'invalid', key: 'err_valueInvalid' })
      return
    }
    if (dvCents == null || dvCents <= 0) {
      setErr({ kind: 'invalid', key: 'err_value' })
      return
    }
    const dv = dvCents / 100
    if (discountType === 'percent' && dv > 100) {
      setErr({ kind: 'invalid', key: 'err_pctMax' })
      return
    }
    // Plafonul: gol = fără plafon. Un text fără formă de număr dădea NaN, care
    // pleca la server ca `null` în JSON — plafonul dispărea tăcut.
    const capCents = discountType === 'percent' ? parseDecimalCents(maxDiscount) : null
    if (capCents != null && Number.isNaN(capCents)) {
      setErr({ kind: 'invalid', key: 'err_capInvalid' })
      return
    }
    // 0 lei — sau un text care se rotunjește la 0 bani, „0,004” — = FĂRĂ plafon,
    // ca golul (recenzia adversarială a lui cdcb6dd): trimis ca 0, serverul
    // plafona FIECARE reducere la 0 (mig 077), iar oaspetele plătea prețul
    // întreg cât cardul și insigna din meniul QR arătau „−20%”. Câmpul e
    // „opțional”, iar indiciul de sub el o spune.
    const cap = capCents == null || capCents === 0 ? null : capCents / 100
    if (scope === 'category' && !categoryId) {
      setErr({ kind: 'invalid', key: 'err_category' })
      return
    }
    if (scope === 'product' && !productId) {
      setErr({ kind: 'invalid', key: 'err_product' })
      return
    }
    setErr(null)
    savingRef.current = true
    setPhase('saving')
    // Pe succes (și pe o salvare confirmată abia de verificare) părintele
    // închide editorul; altfel rămâne deschis, deblocat, cu ce s-a tastat.
    onSave(
      {
        name: name.trim(),
        is_active: isActive,
        starts_at: startsAt + ':00',
        ends_at: endsAt + ':00',
        days_of_week: days,
        scope,
        category_id: scope === 'category' ? categoryId : null,
        product_id: scope === 'product' ? productId : null,
        discount_type: discountType,
        discount_value: dv,
        max_discount: cap,
      },
      setPhase,
    ).then(
      (outcome) => {
        if (outcome.kind === 'saved') return
        savingRef.current = false
        setPhase(null)
        setErr(outcome)
      },
      (e: unknown) => {
        savingRef.current = false
        setPhase(null)
        setErr({ kind: 'server', err: e })
      },
    )
  }

  // Câmpul vizat de eroarea de validare (aria-invalid + legătura cu mesajul).
  const badKey = err?.kind === 'invalid' ? err.key : null
  const invalidOn = (keys: readonly StringKey<typeof promotionsRo>[]) =>
    badKey != null && keys.includes(badKey) ? { 'aria-invalid': true, 'aria-describedby': ids.err } : {}

  return (
    <Modal title={rule ? t('edit_title') : t('newRule')} onClose={onClose} width={540} confirmClose={confirmDiscard}>
      {/* `fieldset disabled` blochează ORICE control dinăuntru, inclusiv unul
          adăugat mai târziu — fără un `disabled={saving}` de ținut minte pe
          fiecare. Stilul anulează chenarul implicit al lui `fieldset`. */}
      <fieldset
        disabled={saving}
        style={{
          border: 0,
          margin: 0,
          padding: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div>
          <label htmlFor={ids.name} style={lbl}>
            {t('field_name')}
          </label>
          <input
            id={ids.name}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inp}
            placeholder={t('field_namePh')}
            maxLength={80}
            {...invalidOn(['err_name'])}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
          <div>
            <label htmlFor={ids.from} style={lbl}>
              {t('field_from')}
            </label>
            <input
              id={ids.from}
              type="time"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              style={inp}
            />
          </div>
          <div>
            <label htmlFor={ids.to} style={lbl}>
              {t('field_to')}
            </label>
            <input
              id={ids.to}
              type="time"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              style={inp}
            />
          </div>
        </div>

        <div role="group" aria-labelledby={ids.days}>
          <div id={ids.days} style={lbl}>
            {t('field_days')}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {dayLabels({ t }).map((lab, i) => {
              const d = i + 1
              const on = days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  style={btn({
                    background: on ? D.goldA : D.s3,
                    color: on ? D.goldL : D.t2,
                    border: `1px solid ${on ? D.gold : D.border}`,
                    width: 44,
                    height: 36,
                    padding: 0,
                    fontSize: '0.82rem',
                  })}
                >
                  {lab}
                </button>
              )
            })}
            {days.length === 0 ? null : (
              <button
                type="button"
                onClick={() => setDays([])}
                style={btn({
                  background: 'transparent',
                  color: D.t3,
                  height: 36,
                  fontSize: '0.78rem',
                  padding: '0 10px',
                })}
              >
                {t('days_reset')}
              </button>
            )}
          </div>
        </div>

        <div role="group" aria-labelledby={ids.scope}>
          <div id={ids.scope} style={lbl}>
            {t('field_scope')}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['all', 'category', 'product'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
                style={btn({
                  background: scope === s ? D.goldA : D.s3,
                  color: scope === s ? D.goldL : D.t2,
                  border: `1px solid ${scope === s ? D.gold : D.border}`,
                  height: 34,
                  padding: '0 12px',
                  fontSize: '0.82rem',
                })}
              >
                <Icon
                  name={s === 'all' ? 'tag' : s === 'category' ? 'box' : 'utensils'}
                  size={14}
                />
                {s === 'all' ? t('scope_all') : s === 'category' ? t('scope_category') : t('scope_product')}
              </button>
            ))}
          </div>
          {scope === 'category' && (
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={inp}
              aria-label={t('scope_category')}
              {...invalidOn(['err_category'])}
            >
              <option value="">{t('pick_category')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          )}
          {scope === 'product' && (
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              style={inp}
              aria-label={t('scope_product')}
              {...invalidOn(['err_product'])}
            >
              <option value="">{t('pick_product')}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div role="group" aria-labelledby={ids.discount}>
          <div id={ids.discount} style={lbl}>
            {t('field_discount')}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              type="button"
              aria-pressed={discountType === 'percent'}
              onClick={() => setDiscountType('percent')}
              style={btn({
                background: discountType === 'percent' ? D.goldA : D.s3,
                color: discountType === 'percent' ? D.goldL : D.t2,
                border: `1px solid ${discountType === 'percent' ? D.gold : D.border}`,
                height: 34,
                fontSize: '0.82rem',
              })}
            >
              {t('type_pct')}
            </button>
            <button
              type="button"
              aria-pressed={discountType === 'amount'}
              onClick={() => {
                setDiscountType('amount')
                setMaxDiscount('')
                setErr((e) =>
                  e?.kind === 'invalid' && PERCENT_ONLY_ERRORS.includes(e.key) ? null : e,
                )
              }}
              style={btn({
                background: discountType === 'amount' ? D.goldA : D.s3,
                color: discountType === 'amount' ? D.goldL : D.t2,
                border: `1px solid ${discountType === 'amount' ? D.gold : D.border}`,
                height: 34,
                fontSize: '0.82rem',
              })}
            >
              {t('type_amount')}
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                isMobile || discountType === 'amount' ? '1fr' : '1fr 1fr',
              gap: 10,
            }}
          >
            <div>
              <label htmlFor={ids.value} style={lbl}>
                {t('field_value')}
              </label>
              <input
                id={ids.value}
                type="text"
                inputMode="decimal"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                style={inp}
                placeholder={discountType === 'percent' ? '20' : '50'}
                aria-label={t('field_valueAria')}
                {...invalidOn(['err_value', 'err_valueInvalid', 'err_pctMax'])}
              />
            </div>
            {discountType === 'percent' && (
              <div>
                <label htmlFor={ids.cap} style={lbl}>
                  {t('field_cap')}
                </label>
                <input
                  id={ids.cap}
                  type="text"
                  inputMode="decimal"
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value)}
                  style={inp}
                  placeholder={t('field_capPh')}
                  aria-label={t('field_capAria')}
                  aria-describedby={ids.capHint}
                  {...invalidOn(['err_capInvalid'])}
                />
                <div id={ids.capHint} style={{ fontSize: '0.74rem', color: D.t3, marginTop: 4 }}>
                  {t('field_capHint')}
                </div>
              </div>
            )}
          </div>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: D.t2,
            fontSize: '0.86rem',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span>{t('field_active')}</span>
        </label>

        {err == null ? null : (
          <div
            id={ids.err}
            role="alert"
            style={{
              padding: 10,
              background: D.redA,
              color: D.red,
              borderRadius: 8,
              fontSize: '0.86rem',
            }}
          >
            {err.kind === 'invalid'
              ? t(err.key)
              : err.kind === 'server'
                ? describeStaffError(err.err, tc, { fallback: t('err_save') })
                : t(verifyErrorKey(err))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => {
              void confirmDiscard().then((ok) => {
                if (ok) onClose()
              })
            }}
            style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
          >
            {tc.t('cancel')}
          </button>
          <button
            type="button"
            onClick={go}
            disabled={saving}
            aria-busy={saving || undefined}
            style={btn({ background: D.gold, color: '#000', opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' })}
          >
            {phase === 'verifying'
              ? t('verifying')
              : saving
                ? t('saving')
                : rule
                  ? t('saveChanges')
                  : t('create')}
          </button>
        </div>
      </fieldset>
    </Modal>
  )
}

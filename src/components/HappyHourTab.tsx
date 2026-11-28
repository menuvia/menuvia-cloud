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
import { parseDecimalInput } from '../lib/decimal'
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
// nu s-a putut reîncărca, deci nu se știe; `list_unavailable` = nu s-a trimis
// nimic, fiindcă fără o listă de încredere o creare fără răspuns n-ar mai putea
// fi verificată.
type VerifyResult =
  | { kind: 'not_saved'; create: boolean }
  | { kind: 'unverified' }
  | { kind: 'list_unavailable' }
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
// reîncărcată după un termen, ori dinaintea unei reîncercări).
type SavePhase = 'saving' | 'verifying'
// Ce scrie editorul deschis, ținut de filă pe toată durata lui (deschidere →
// închidere), nu pe o singură încercare. La creare: id-urile regulilor de
// DINAINTE de prima încercare (null = lista nu era de încredere), numele
// trimise și dacă o încercare a rămas fără răspuns (`unresolved`) — atunci
// următoarea încercare verifică întâi lista, ca un INSERT comis DUPĂ
// verificarea de la termen să nu fie dublat. O creare confirmată astfel devine
// modificarea regulii găsite.
type SaveSession =
  | { kind: 'create'; beforeIds: ReadonlySet<string> | null; names: Set<string>; unresolved: boolean }
  | { kind: 'update'; id: string }
type LoadResult = { ok: true; rules: HappyHourRule[] } | { ok: false }

// Textul unui rezultat de verificare (fiecare spune ce s-a aflat despre bază).
function verifyErrorKey(e: VerifyResult): StringKey<typeof promotionsRo> {
  switch (e.kind) {
    case 'not_saved':
      return e.create ? 'err_notSavedCreate' : 'err_notSavedUpdate'
    case 'unverified':
      return 'err_saveUnverified'
    case 'list_unavailable':
      return 'err_listUnavailable'
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
// închidă editorul și să-și piardă ciorna, iar o reîncercare oarbă dubla regula
// (`happy_hour_rules` n-are nicio cheie unică în afara lui `id`, mig 036; două
// reguli active reduc amândouă comenzile QR, mig 077).
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
// spune nici ea nimic despre tranzacție. Tratată ca refuz, următorul click
// trimitea încă un INSERT fără să verifice — exact dublura pe care o previne
// termenul. Deci se tratează ca termenul: fila verifică lista.
function isServerAnswer(e: unknown): boolean {
  if (isNetworkError(e)) return false
  const code = e != null && typeof e === 'object' ? (e as { code?: unknown }).code : undefined
  return typeof code === 'string' && code !== ''
}

// Rândul din bază are EXACT valorile trimise? (verificarea unei modificări
// fără răspuns). Ora vine din `time` cu secunde, sumele din `numeric(10,2)`
// (comparate în bani), zilele ca mulțime. O nepotrivire falsă (ex. o sumă cu
// trei zecimale, rotunjită de bază) spune doar „nu s-a salvat”, iar
// reîncercarea unei modificări e inofensivă.
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

// Regula creată de editorul deschis, dacă lista o arată: o regulă NOUĂ (id-ul
// ei lipsea dinaintea primei încercări) cu unul dintre numele trimise. Doar
// numele, nu toate valorile: un rând inserat are exact valorile trimise, iar o
// nepotrivire falsă aici ar spune „nu s-a salvat” despre o regulă salvată —
// adică exact reîncercarea care o dublează.
function findCreated(rules: readonly HappyHourRule[], s: SaveSession): HappyHourRule | null {
  if (s.kind !== 'create' || s.beforeIds == null) return null
  const before = s.beforeIds
  return rules.find((r) => !before.has(r.id) && s.names.has(r.name)) ?? null
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
  // Lista din stare e cea din bază? false după o încărcare refuzată: atunci
  // id-urile ei nu pot spune ce regulă e NOUĂ după o salvare fără răspuns.
  const rulesTrustedRef = useRef(false)
  const sessionRef = useRef<SaveSession | null>(null)
  // O salvare a rămas fără răspuns: la închiderea editorului lista se mai
  // reîncarcă o dată — o cerere anulată în client poate fi comisă și DUPĂ
  // verificare, iar omul care renunță trebuie să vadă ce e în bază.
  const reloadOnCloseRef = useRef(false)

  // `signal` (doar reîncărcarea de verificare) anulează cererile la termenul
  // ei; o încărcare anulată nu pune nimic pe bannerul filei — o spune editorul.
  const load = useCallback(
    async (signal?: AbortSignal): Promise<LoadResult> => {
      const seq = ++loadSeqRef.current
      setErr(null)
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
          rulesTrustedRef.current = true
        }
        return { ok: true, rules: rs }
      } catch (e) {
        if (seq === loadSeqRef.current && !signal?.aborted) {
          setErr({ err: e })
          rulesTrustedRef.current = false
        }
        return { ok: false }
      } finally {
        if (seq === loadSeqRef.current) setLoadedFor(restaurantId)
      }
    },
    [restaurantId],
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
    sessionRef.current =
      target === 'new'
        ? { kind: 'create', beforeIds: null, names: new Set(), unresolved: false }
        : { kind: 'update', id: target.id }
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
  // (`AbortSignal`, nu doar ignorată). `'unanswered'` = serverul n-a răspuns:
  // termenul a trecut SAU cererea a căzut pe drum (`isServerAnswer` fals) — în
  // ambele cazuri salvarea poate fi totuși în bază, deci apelantul verifică.
  // Doar un refuz al serverului ARUNCĂ.
  async function sendWithDeadline(
    op: (signal: AbortSignal) => Promise<unknown>,
  ): Promise<'saved' | 'unanswered'> {
    const ctrl = new AbortController()
    try {
      const r = await raceDeadline(
        op(ctrl.signal).then(() => 'saved' as const),
        HAPPY_HOUR_SAVE_TIMEOUT_MS,
      )
      if (r === 'saved') return 'saved'
    } catch (e) {
      if (isServerAnswer(e)) throw e
    }
    ctrl.abort()
    reloadOnCloseRef.current = true
    return 'unanswered'
  }

  async function saveUpdate(
    id: string,
    rule: RuleFields,
    onPhase: (p: SavePhase) => void,
  ): Promise<SaveOutcome> {
    onPhase('saving')
    if ((await sendWithDeadline((signal) => updateHappyHourRule(id, rule, signal))) === 'saved') {
      finishSaved(false)
      return { kind: 'saved' }
    }
    // Fără răspuns: modificarea a ajuns dacă rândul din bază are EXACT valorile
    // trimise. O nepotrivire = nu s-a salvat; reîncercarea e inofensivă (aceeași
    // modificare, pe același rând).
    onPhase('verifying')
    const fresh = await reloadForVerify()
    if (fresh == null) return { kind: 'unverified' }
    const row = fresh.find((r) => r.id === id)
    if (row && sameRuleFields(row, rule)) {
      finishSaved(true)
      return { kind: 'saved' }
    }
    return { kind: 'not_saved', create: false }
  }

  // Refuzul serverului se propagă în RuleEditor (setErr LOCAL, vizibil în
  // modal) — pe bannerul de aici ar fi ACOPERIT de overlay-ul modalului rămas
  // deschis.
  async function handleSave(rule: RuleFields, onPhase: (p: SavePhase) => void): Promise<SaveOutcome> {
    const s = sessionRef.current
    // Editorul există doar cu o sesiune (`openEditor` o pune înaintea lui
    // `setEditing`); fără ea nu se trimite nimic.
    if (s == null) return { kind: 'unverified' }
    if (s.kind === 'update') return saveUpdate(s.id, rule, onPhase)

    // Crearea: înaintea INSERT-ului, lista de comparat trebuie să fie de
    // încredere, iar o încercare rămasă fără răspuns (termen sau cădere de
    // rețea) trebuie lămurită — altfel un INSERT comis după verificarea de
    // atunci ar fi dublat de reîncercare.
    if (s.beforeIds == null && rulesTrustedRef.current) {
      s.beforeIds = new Set(rules.map((r) => r.id))
    }
    if (s.beforeIds == null || s.unresolved) {
      onPhase('verifying')
      const fresh = await reloadForVerify()
      if (fresh == null) return { kind: s.unresolved ? 'unverified' : 'list_unavailable' }
      const created = findCreated(fresh, s)
      if (created) {
        // Încercarea de dinainte ajunsese: de acum editorul scrie regula aceea
        // (cu ce e acum în formular), nu încă una.
        sessionRef.current = { kind: 'update', id: created.id }
        return saveUpdate(created.id, rule, onPhase)
      }
      s.unresolved = false
      if (s.beforeIds == null) s.beforeIds = new Set(fresh.map((r) => r.id))
    }

    onPhase('saving')
    s.names.add(rule.name)
    s.unresolved = true
    let sent: 'saved' | 'unanswered'
    try {
      sent = await sendWithDeadline((signal) => createHappyHourRule(restaurantId, rule, signal))
    } catch (e) {
      // Doar un refuz al SERVERULUI ajunge aici — un răspuns: nu s-a creat
      // nimic. O cădere de rețea e „fără răspuns” (`sendWithDeadline`), deci
      // `unresolved` rămâne și reîncercarea verifică întâi.
      s.unresolved = false
      throw e
    }
    if (sent === 'saved') {
      finishSaved(false)
      return { kind: 'saved' }
    }
    onPhase('verifying')
    const fresh = await reloadForVerify()
    if (fresh == null) return { kind: 'unverified' }
    if (findCreated(fresh, s)) {
      finishSaved(true)
      return { kind: 'saved' }
    }
    // `unresolved` RĂMÂNE: anularea oprește cererea doar în client, deci
    // INSERT-ul poate fi comis și după această verificare; reîncercarea
    // verifică lista încă o dată înainte să trimită.
    return { kind: 'not_saved', create: true }
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
      setErr({ err: e })
    }
  }

  async function toggleActive(rule: HappyHourRule) {
    try {
      await updateHappyHourRule(rule.id, { is_active: !rule.is_active })
      void load()
    } catch (e) {
      setErr({ err: e })
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
              {rule.max_discount == null || !(rule.max_discount > 0)
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
    const dv = parseDecimalInput(discountValue)
    if (dv != null && Number.isNaN(dv)) {
      setErr({ kind: 'invalid', key: 'err_valueInvalid' })
      return
    }
    if (dv == null || dv <= 0) {
      setErr({ kind: 'invalid', key: 'err_value' })
      return
    }
    if (discountType === 'percent' && dv > 100) {
      setErr({ kind: 'invalid', key: 'err_pctMax' })
      return
    }
    // Plafonul: gol = fără plafon. Un text fără formă de număr dădea NaN, care
    // pleca la server ca `null` în JSON — plafonul dispărea tăcut.
    const cap = discountType === 'percent' ? parseDecimalInput(maxDiscount) : null
    if (cap != null && Number.isNaN(cap)) {
      setErr({ kind: 'invalid', key: 'err_capInvalid' })
      return
    }
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
                  {...invalidOn(['err_capInvalid'])}
                />
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

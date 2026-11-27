// ─────────────────────────────────────────────────────────────
// BridgeTab — Management casă de marcat (FiscalNet integration)
//
// Permite:
//   • Înregistrare device bridge (generează device_secret) + instalarea în 3
//     pași: installer-ul (VITE_BRIDGE_DOWNLOAD_URL), config.json generat în
//     browser, verificarea `--check` (lotul C7a)
//   • Vizualizare status device (online/offline din `last_seen_at`, NU din
//     flag-ul lipicios `bridge_devices.status` — lib/bridgeLiveness.ts)
//   • Listă bonuri pending/sent/success/error/cancelled cu retry/cancel
//   • Mapare grupe TVA → grupe FiscalNet (1-5)
//
// LIMBA (C7a): pe Planul 2 fila e doar imprimanta din bucătărie (nefiscală) și
// urmează limba personalului (namespace-ul `bridge`); pe Planul 3 e ecran
// FISCAL și rămâne în română prin lege (lib/fiscalScreens.ts) — aceleași chei,
// cerute cu `lang: 'ro'`, iar textele strict fiscale stau scrise aici.
//
// Bridge-ul local (Node.js + tray icon Windows) folosește device_secret
// ca să se autentifice la RPC-urile bridge_* din migration 030.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { confirm as confirmDialog } from './ui/confirm'
import { FISCAL_CONFIRM } from '../lib/fiscalScreens'
import { InlineSpinner } from './PageLoader'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { receiptStatsForRomaniaDay } from '../lib/receiptStats'
import { usePollWhileVisible } from '../hooks/usePollWhileVisible'
import { toUserMessage, zeroRowsAsDenied } from '../lib/userMessages'
import { isBridgeDeviceLive } from '../lib/bridgeLiveness'
import {
  BRIDGE_CONFIG_FILENAME,
  bridgeConfigJson,
  downloadTextFile,
  getBridgeDownloadUrl,
  getBridgePublicConfig,
  secretTail,
} from '../lib/bridgeSetup'
import { useT } from '../i18n/useT'
import { bridgeNs } from '../i18n/ns/bridge'
import { commonNs } from '../i18n/ns/common'
import { describeStaffError } from '../i18n/staffErrors'
import type { StringKey, Translator } from '../i18n/core'
import type bridgeRo from '../i18n/ns/bridge/ro'

// Coloanele EXPLICITE pe care ecranul le afișează (perf-staff-5). Înainte
// `select('*')` aducea, la fiecare 15 s, `device_secret` (cheia cu care
// bridge-ul se autentifică la RPC-urile bridge_* — nu are ce căuta în memoria
// unei file de browser care nu-l arată) și payload-urile FiscalNet / ESC-POS
// ale celor 100 de bonuri + 50 de tichete, pe care ecranul nu le randează.
// Secretul se vede O SINGURĂ dată, din răspunsul lui bridge_register.
// Fără `status`: e un flag lipicios (mig 265), viața se citește din `last_seen_at`.
const DEVICE_COLUMNS =
  'id,name,last_seen_at,fiscalnet_brand,fiscalnet_model,prints_kitchen_receipts'
const RECEIPT_COLUMNS =
  'id,order_id,status,bon_number,error_code,error_info,retry_count,total_snapshot,created_at'
const TICKET_COLUMNS = 'id,order_id,status,error_code,retry_count,is_reprint,created_at'
const VAT_COLUMNS = 'vat_group,rate_percent,label,fiscalnet_group'
// Ritmul „live" (status casă, bonuri, tichete) — DOAR cu fila vizibilă.
const LIVE_POLL_MS = 15_000

interface BridgeDevice {
  id: string
  name: string
  last_seen_at: string | null
  fiscalnet_brand: string | null
  fiscalnet_model: string | null
  prints_kitchen_receipts: boolean
}

interface PendingReceipt {
  id: string
  order_id: string
  status: 'pending' | 'sent' | 'success' | 'error' | 'cancelled'
  bon_number: string | null
  error_code: string | null
  error_info: string | null
  retry_count: number
  total_snapshot: number
  created_at: string
}

interface VatRateRow {
  vat_group: number
  rate_percent: number
  label: string
  fiscalnet_group: number
}

interface Props {
  restaurantId: string
  // false pe tier 2 (mig 227): secțiunile FISCALE (bonuri, mapare TVA, stats)
  // se ascund; rămân device-urile + tichetele de bucătărie.
  fiscalEnabled: boolean
}

// Tichet de bucătărie (mig 227) — oglinda lui PendingReceipt, fără câmpurile
// fiscale (bon_number/total_snapshot), plus is_reprint. Fără payload-ul ESC/POS:
// e treaba bridge-ului, ecranul nu-l afișează.
interface KitchenTicket {
  id: string
  order_id: string
  status: 'pending' | 'sent' | 'success' | 'error' | 'cancelled'
  error_code: string | null
  retry_count: number
  is_reprint: boolean
  created_at: string
}

// ── Style tokens ──────────────────────────────────────────────
const card: React.CSSProperties = {
  background: D.s1,
  border: `1px solid ${D.border}`,
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
}
const h2: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 600,
  color: D.t1,
  margin: '0 0 14px',
  fontFamily: 'Fraunces,serif',
}
const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 12px',
  fontSize: '0.88rem',
  color: D.t1,
  outline: 'none',
  height: 40,
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}
const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 14px',
  height: 38,
  borderRadius: 9,
  fontSize: '0.85rem',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'DM Sans,sans-serif',
  ...extra,
})
const lbl: React.CSSProperties = {
  fontSize: '0.72rem',
  color: D.t2,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 6,
  fontWeight: 500,
}

// ── Status helpers ────────────────────────────────────────────
type BridgeKey = StringKey<typeof bridgeRo>
type BridgeT = Translator<typeof bridgeRo>
type QueueStatus = PendingReceipt['status']

const STATUS_STYLE: Record<QueueStatus, { color: string; bg: string }> = {
  pending: { color: D.amber, bg: 'rgba(232,160,32,0.12)' },
  sent: { color: D.goldL, bg: D.goldA },
  success: { color: D.green, bg: D.greenA },
  error: { color: D.red, bg: D.redA },
  cancelled: { color: D.t3, bg: D.s2 },
}
// `sent` diferă pe coadă: „Trimis la casă” (bon, fiscal, în română) vs
// „Trimis la imprimantă” (tichet) — îl alege apelantul.
const STATUS_KEY: Record<Exclude<QueueStatus, 'sent'>, BridgeKey> = {
  pending: 'st_pending',
  success: 'st_success',
  error: 'st_error',
  cancelled: 'st_cancelled',
}

function relativeTime(iso: string | null, bt: BridgeT): string {
  if (!iso) return bt.t('rel_never')
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return bt.t('rel_now')
  if (diff < 3_600_000) return bt.t('rel_min', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return bt.t('rel_hours', { n: Math.floor(diff / 3_600_000) })
  return bt.tp('rel_days', Math.floor(diff / 86_400_000))
}

/** O eroare ținută ca DATĂ: textul se compune la randare, în limba curentă.
 *  `key` = rezerva din namespace; `text` = rezerva fiscală (doar română). */
interface ErrState {
  error: unknown
  key?: BridgeKey
  text?: string
}

function ronFmt(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' RON'
}

// ── Main component ────────────────────────────────────────────
export default function BridgeTab({ restaurantId, fiscalEnabled }: Props) {
  // Pe Planul 3 ecranul e FISCAL: și textele comune ies în română
  // (lib/fiscalScreens.ts); pe Planul 2 urmează limba personalului.
  const pin = fiscalEnabled ? { lang: 'ro' as const } : undefined
  const bt = useT(bridgeNs, pin)
  const tc = useT(commonNs, pin)
  // Confirmările: pe Planul 3 butonul de renunțare fixat în română
  // (FISCAL_CONFIRM); pe Planul 2 ambele etichete EXPLICITE, în limba
  // textelor (dialogul e portalat, nu moștenește limba ecranului).
  const confirmLang = fiscalEnabled
    ? FISCAL_CONFIRM
    : { cancelLabel: tc.t('cancel'), lang: bt.lang }
  const downloadUrl = getBridgeDownloadUrl()
  const publicConfig = getBridgePublicConfig()

  const [devices, setDevices] = useState<BridgeDevice[]>([])
  const [receipts, setReceipts] = useState<PendingReceipt[]>([])
  const [tickets, setTickets] = useState<KitchenTicket[]>([])
  const [vatRates, setVatRates] = useState<VatRateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ErrState | null>(null)
  const errText = err
    ? describeStaffError(err.error, tc, { fallback: err.key ? bt.t(err.key) : err.text })
    : null

  // Register modal
  const [showRegister, setShowRegister] = useState(false)
  // Numele implicit al device-ului urmează planul: casa de marcat pe planul cu
  // bon, PC-ul imprimantei din bucătărie altfel (lotul P).
  const defaultRegName = fiscalEnabled ? 'Casa de marcat principală' : bt.t('reg_defaultName')
  const [regName, setRegName] = useState(defaultRegName)
  const [regBrand, setRegBrand] = useState('datecs')
  const [regModel, setRegModel] = useState('')
  const [regBusy, setRegBusy] = useState(false)
  const [newSecret, setNewSecret] = useState<{ deviceId: string; secret: string } | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  // VAT mapping editor
  const [showVatMap, setShowVatMap] = useState(false)
  const [vatEdits, setVatEdits] = useState<Record<number, number>>({})
  const [vatBusy, setVatBusy] = useState(false)

  // Filter
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'error' | 'done'>('active')
  // mig 277: bon cu eșec AMBIGUU (POSIBIL DUPLICAT) pe care adminul l-a GĂSIT pe
  // bandă → înregistrează numărul (bridge_force_resolve_stuck pe error+marker).
  const [printedFor, setPrintedFor] = useState<PendingReceipt | null>(null)
  const [printedBon, setPrintedBon] = useState('')
  const [printedBusy, setPrintedBusy] = useState(false)
  const [printedErr, setPrintedErr] = useState<string | null>(null)

  // Guard de secvență: la schimbarea restaurantului, un răspuns vechi nu trebuie
  // să afișeze device-urile/bonurile altui restaurant.
  const loadSeqRef = useRef(0)
  // Maparea TVA cerută (montare / după salvare) și încă NEAPLICATĂ. Guard-ul de
  // secvență de mai sus ARUNCĂ răspunsul unei încărcări depășite — iar cea care
  // o depășește e, de regulă, una live (revenirea în filă chiar în timpul
  // încărcării inițiale, sau tick-ul de 15 s în timpul reîncărcării de după
  // salvare). Fără acest flag cotele nu se mai citeau până la remontare:
  // modalul „Mapare TVA" spunea fals „Nu ai cote TVA configurate încă" sau
  // arăta maparea DINAINTEA salvării. La fel după o citire de cote eșuată.
  // Cât e true, ORICE încărcare (și cea live) cere și cotele.
  const configPendingRef = useRef(true)
  // `withConfig` = și maparea TVA (configurare, nu stare live): se citește la
  // montare și după salvarea mapării, NU la fiecare 15 s. Pe tier 2 (fără
  // fiscal) bonurile și cotele nici nu se cer — secțiunile lor sunt ascunse.
  const load = useCallback(
    async (opts: { withConfig?: boolean } = {}) => {
      if (opts.withConfig === true) configPendingRef.current = true
      const withConfig = configPendingRef.current
      const seq = ++loadSeqRef.current
      setLoading(true)
      setErr(null)
      try {
        const [dRes, tRes, rRes, vRes] = await Promise.all([
          supabase
            .from('bridge_devices')
            .select(DEVICE_COLUMNS)
            .eq('restaurant_id', restaurantId)
            .order('created_at'),
          supabase
            .from('kitchen_tickets')
            .select(TICKET_COLUMNS)
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
            .limit(50),
          fiscalEnabled
            ? supabase
                .from('pending_receipts')
                .select(RECEIPT_COLUMNS)
                .eq('restaurant_id', restaurantId)
                .order('created_at', { ascending: false })
                .limit(100)
            : null,
          fiscalEnabled && withConfig
            ? supabase
                .from('vat_rates')
                .select(VAT_COLUMNS)
                .eq('restaurant_id', restaurantId)
                .order('vat_group')
            : null,
        ])
        if (seq !== loadSeqRef.current) return
        if (dRes.error) throw dRes.error
        if (rRes?.error) throw rRes.error
        if (vRes?.error) throw vRes.error
        // Tichetele sunt tolerante la absența migrației 227 (tabel inexistent
        // pe un DB vechi) — nu blocăm tab-ul fiscal pentru asta.
        setDevices((dRes.data || []) as BridgeDevice[])
        setReceipts(rRes ? ((rRes.data || []) as PendingReceipt[]) : [])
        if (vRes) {
          setVatRates((vRes.data || []) as VatRateRow[])
          configPendingRef.current = false
        }
        setTickets(tRes.error ? [] : ((tRes.data || []) as KitchenTicket[]))
      } catch (e) {
        if (seq === loadSeqRef.current) setErr({ error: e, key: 'err_load' })
      } finally {
        if (seq === loadSeqRef.current) setLoading(false)
      }
    },
    [restaurantId, fiscalEnabled],
  )

  useEffect(() => {
    void load({ withConfig: true })
  }, [load])

  // Status live (casă, bonuri, tichete) la 15 s, DOAR cu fila vizibilă; la
  // revenirea în filă se citește imediat (usePollWhileVisible, perf-staff-6).
  usePollWhileVisible(() => void load(), LIVE_POLL_MS)

  async function handleRegister() {
    if (!regName.trim()) return
    setRegBusy(true)
    try {
      const { data, error } = await supabase.rpc('bridge_register', {
        p_restaurant_id: restaurantId,
        p_name: regName.trim(),
        // Pe tier 2 (fără fiscal) device-ul e doar pentru imprimanta de
        // bucătărie — câmpurile FiscalNet rămân goale.
        p_fiscalnet_brand: fiscalEnabled ? regBrand || null : null,
        p_fiscalnet_model: fiscalEnabled ? regModel.trim() || null : null,
      })
      if (error) throw error
      const row = Array.isArray(data) && data.length ? data[0] : null
      if (row) {
        setNewSecret({ deviceId: row.device_id, secret: row.device_secret })
        if (!fiscalEnabled) {
          // Pe tier 2 device-ul există DOAR pentru tichete de bucătărie —
          // activăm implicit tipărirea (best-effort, toggle-ul rămâne la vedere).
          await supabase
            .from('bridge_devices')
            .update({ prints_kitchen_receipts: true })
            .eq('id', row.device_id)
        }
      }
      await load()
    } catch (e) {
      setErr({ error: e, key: 'err_register' })
    } finally {
      setRegBusy(false)
    }
  }

  function closeKeyModal() {
    setNewSecret(null)
    setShowRegister(false)
    setRegName(defaultRegName)
    setRegModel('')
    setCopiedKey(false)
    setCopyFailed(false)
  }

  /** config.json-ul dispozitivului abia înregistrat, generat în browser: se
   *  pune lângă installer, iar wizardul `--setup` îl preia (C7a). Pe Planul 2
   *  poartă `kitchen.enabled` — device-ul există doar pentru tichete. */
  function downloadConfig() {
    if (!newSecret || !publicConfig) return
    downloadTextFile(
      BRIDGE_CONFIG_FILENAME,
      bridgeConfigJson({
        ...publicConfig,
        deviceSecret: newSecret.secret,
        kitchenOnly: !fiscalEnabled,
      }),
      'application/json',
    )
  }

  async function handleDeleteDevice(id: string) {
    const ok = await confirmDialog({
      title: bt.t('delete_title'),
      description: fiscalEnabled
        ? 'Bridge-ul instalat nu va mai putea trimite bonuri.'
        : bt.t('delete_descKitchen'),
      confirmLabel: bt.t('delete_confirm'),
      ...confirmLang,
      destructive: true,
    })
    if (!ok) return
    try {
      // 0 rânduri șterse = refuz RLS tăcut; îl spunem, nu reîncărcăm „ca șters".
      const denied = zeroRowsAsDenied(
        await supabase.from('bridge_devices').delete().eq('id', id).select('id'),
      )
      if (denied) {
        setErr({ error: denied, key: 'err_delete' })
        return
      }
      await load()
    } catch (e) {
      setErr({ error: e, key: 'err_delete' })
    }
  }

  /** Retrimite un bon error/cancelled; pe marker AMBIGUU cere confirmarea benzii și trimite ack-ul serverului (mig 270). */
  async function handleRetry(id: string, errorInfo?: string | null) {
    // Eșec AMBIGUU (marker scris de bridge/lib/fiscalnet.js): bonul POATE fi
    // deja tipărit (timeout după predarea către driver / abort după POST).
    // Retrimiterea oarbă = bon fiscal DUBLU real (bandă + raport Z + ANAF) —
    // cerem verificarea umană a benzii, oglinda politicii Oblio din mig 218.
    // mig 270: gate-ul e și SERVER-side — RPC-ul respinge retry-ul peste marker
    // fără `p_ack_ambiguous: true` (hint ambiguous_receipt). Dialogul de aici
    // e confirmarea umană; ack-ul spune serverului că banda a fost verificată.
    // PREFIX, nu substring — exact predicatul serverului (`like 'POSIBIL DUPLICAT%'`).
    const ambiguous = Boolean(errorInfo && errorInfo.startsWith('POSIBIL DUPLICAT'))
    if (ambiguous) {
      const ok = await confirmDialog({
        title: 'Posibil bon deja tipărit!',
        description:
          'Confirmarea de la casă s-a pierdut DUPĂ trimitere — bonul poate fi deja pe bandă. ' +
          'Verifică fizic banda casei (sau raportul X) înainte de retrimitere: dacă bonul există, ' +
          'anulează-l pe acesta în loc să-l retrimiți, altfel emiți un bon fiscal DUBLU.',
        confirmLabel: 'Am verificat banda — retrimite',
        ...FISCAL_CONFIRM,
        destructive: true,
      })
      if (!ok) return
    }
    try {
      const { error } = await supabase.rpc(
        'bridge_retry_receipt',
        ambiguous ? { p_receipt_id: id, p_ack_ambiguous: true } : { p_receipt_id: id },
      )
      if (error) {
        if (error.hint === 'ambiguous_receipt') {
          throw new Error(
            'Serverul a refuzat retrimiterea: bonul are un eșec ambiguu și poate fi deja tipărit. Verifică banda casei și confirmă explicit.',
          )
        }
        throw new Error(error.message || 'Eroare la retrimitere')
      }
      await load()
    } catch (e) {
      setErr({ error: e, text: 'Eroare la retrimitere' })
    }
  }

  /** Deschide dialogul „Bonul a ieșit” pentru un bon cu marker ambiguu (mig 277). */
  function openPrinted(r: PendingReceipt) {
    setPrintedFor(r)
    setPrintedBon('')
    setPrintedErr(null)
  }

  /** Bon AMBIGUU găsit TIPĂRIT pe bandă: scrie numărul lui ca success (cu audit), fără să-l retrimită. */
  async function handleVerifiedPrinted() {
    if (!printedFor) return
    const bon = printedBon.trim()
    if (!bon) return
    setPrintedBusy(true)
    setPrintedErr(null)
    try {
      const { error } = await supabase.rpc('bridge_force_resolve_stuck', {
        p_receipt_id: printedFor.id,
        p_was_printed: true,
        p_bon_number: bon,
      })
      if (error) {
        // Refuzul serverului cu textul lui (already_resolved / not_resolvable / role_insufficient).
        setPrintedErr(toUserMessage(error, 'Eroare la înregistrarea bonului'))
        return
      }
      setPrintedFor(null)
      await load()
    } catch (e) {
      setPrintedErr(toUserMessage(e, 'Eroare la înregistrarea bonului'))
    } finally {
      setPrintedBusy(false)
    }
  }

  async function handleCancel(id: string) {
    const ok = await confirmDialog({
      title: 'Anulezi acest bon?',
      description: 'Nu va mai fi trimis la casă.',
      confirmLabel: 'Anulează bon',
      ...FISCAL_CONFIRM,
      destructive: true,
    })
    if (!ok) return
    try {
      const { error } = await supabase.rpc('bridge_cancel_receipt', { p_receipt_id: id })
      if (error) throw error
      await load()
    } catch (e) {
      setErr({ error: e, text: 'Eroare la anulare' })
    }
  }

  // ── Tichete bucătărie (mig 227) ─────────────────────────────
  async function toggleKitchenPrint(d: BridgeDevice) {
    try {
      const { error } = await supabase
        .from('bridge_devices')
        .update({ prints_kitchen_receipts: !d.prints_kitchen_receipts })
        .eq('id', d.id)
      if (error) throw error
      await load()
    } catch (e) {
      setErr({ error: e, key: 'err_save' })
    }
  }

  async function handleTicketRetry(id: string) {
    try {
      const { error } = await supabase.rpc('kitchen_ticket_retry', { p_ticket_id: id })
      if (error) throw error
      await load()
    } catch (e) {
      setErr({ error: e, key: 'err_ticketRetry' })
    }
  }

  async function handleTicketCancel(id: string) {
    const ok = await confirmDialog({
      title: bt.t('ticketCancel_title'),
      description: bt.t('ticketCancel_desc'),
      confirmLabel: bt.t('ticketCancel_confirm'),
      ...confirmLang,
      destructive: true,
    })
    if (!ok) return
    try {
      const { error } = await supabase.rpc('kitchen_ticket_cancel', { p_ticket_id: id })
      if (error) throw error
      await load()
    } catch (e) {
      setErr({ error: e, key: 'err_ticketCancel' })
    }
  }

  function openVatMap() {
    const map: Record<number, number> = {}
    vatRates.forEach((v) => {
      map[v.vat_group] = v.fiscalnet_group
    })
    setVatEdits(map)
    setShowVatMap(true)
  }

  async function handleSaveVatMap() {
    setVatBusy(true)
    try {
      for (const [vg, fg] of Object.entries(vatEdits)) {
        const { error } = await supabase
          .from('vat_rates')
          .update({ fiscalnet_group: fg })
          .eq('restaurant_id', restaurantId)
          .eq('vat_group', Number(vg))
        if (error) throw error
      }
      setShowVatMap(false)
      await load({ withConfig: true })
    } catch (e) {
      setErr({ error: e, text: 'Eroare la salvare mapare TVA' })
    } finally {
      setVatBusy(false)
    }
  }

  // Filtered receipts
  const filtered = receipts.filter((r) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return r.status === 'pending' || r.status === 'sent'
    if (statusFilter === 'error') return r.status === 'error'
    if (statusFilter === 'done') return r.status === 'success' || r.status === 'cancelled'
    return true
  })

  // Stats „azi" — ziua României pe AMBELE părți ale comparației. Înainte „azi"
  // era în ora României, dar `created_at` (UTC, de la PostgREST) se compara ca
  // prefix de șir, deci bonurile dintre 00:00 și 02:00/03:00 nu intrau în „azi"
  // în NICIO zi. Logica e pură, în lib/receiptStats.ts (testată fără randare).
  const stats = receiptStatsForRomaniaDay(receipts, new Date())

  if (loading && devices.length === 0) {
    return (
      <InlineSpinner
        label={fiscalEnabled ? 'Se încarcă casa de marcat...' : bt.t('loading_printer')}
      />
    )
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <div style={{ fontSize: '0.82rem', color: D.t2, marginTop: 4 }}>
            {fiscalEnabled
              ? 'Integrare FiscalNet (Datecs / Activa / Tremol). Bonurile fiscale se tipăresc automat la plată.'
              : bt.t('intro_kitchen')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {fiscalEnabled && (
            <button
              onClick={openVatMap}
              style={btn({ background: D.s2, color: D.t1, border: `1px solid ${D.border}` })}
            >
              <Icon name="percent" size={15} />
              Mapare TVA
            </button>
          )}
          <button
            onClick={() => setShowRegister(true)}
            style={btn({ background: D.gold, color: '#0a0a0a' })}
          >
            <Icon name="plus" size={15} />
            {fiscalEnabled ? 'Înregistrează casă' : bt.t('register_device')}
          </button>
        </div>
      </div>

      {errText && (
        <div
          style={{
            ...card,
            borderColor: D.red,
            background: D.redA,
            color: D.red,
            marginBottom: 16,
          }}
        >
          {errText}
          <button
            onClick={() => setErr(null)}
            aria-label={bt.t('err_dismiss')}
            style={{
              float: 'right',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 44,
              minHeight: 44,
              background: 'transparent',
              border: 'none',
              color: D.red,
              cursor: 'pointer',
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {/* Stats today (fiscal — doar Plan 3) */}
      {fiscalEnabled && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <StatCard label="În așteptare azi" value={stats.pending} color={D.amber} />
          <StatCard label="Tipărite azi" value={stats.success} color={D.green} />
          <StatCard
            label="Eșuate azi"
            value={stats.errors}
            color={stats.errors > 0 ? D.red : D.t2}
          />
        </div>
      )}

      {/* Devices */}
      <div style={card}>
        <h2 style={h2}>{fiscalEnabled ? 'Case de marcat înregistrate' : bt.t('devices_title')}</h2>
        {devices.length === 0 ? (
          <EmptyState
            icon="receipt"
            title={fiscalEnabled ? 'Nu ai înregistrat nicio casă de marcat.' : bt.t('empty_title')}
            description={
              fiscalEnabled
                ? 'Înregistrează prima casă ca să primești cheia de instalare pentru Bridge-ul Menuvia.'
                : bt.t('empty_desc')
            }
            action={
              <div
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}
              >
                <button
                  onClick={() => setShowRegister(true)}
                  style={btn({ background: D.gold, color: '#0a0a0a' })}
                >
                  <Icon name="plus" size={15} />
                  {fiscalEnabled ? 'Înregistrează casă' : bt.t('register_device')}
                </button>
                {/* Aceiași pași ca fereastra cu cheia (C7a): fără ei, starea
                    goală nu spunea de unde se ia programul. */}
                <ol
                  data-testid="bridge-empty-steps"
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    textAlign: 'left',
                    fontSize: '0.8rem',
                    color: D.t2,
                    lineHeight: 1.6,
                    maxWidth: 460,
                  }}
                >
                  <li>{bt.t('empty_step1')}</li>
                  <li>
                    {bt.t('empty_step2')}
                    {downloadUrl && (
                      <>
                        {' '}
                        <a
                          href={downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: D.goldL }}
                        >
                          {bt.t('step1_download')}
                        </a>
                      </>
                    )}
                  </li>
                  <li>{bt.t('empty_step3')}</li>
                </ol>
              </div>
            }
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {devices.map((d) => {
              // Viața din `last_seen_at` (pragul lui bridge_connection_status,
              // mig 265) — NU din `status`, care rămâne `online` pe veci.
              const live = isBridgeDeviceLive(d.last_seen_at, Date.now())
              const pill = live
                ? {
                    label: bt.t('status_online'),
                    hint: bt.t('status_onlineHint'),
                    color: D.green,
                    bg: D.greenA,
                  }
                : {
                    label: bt.t('status_offline'),
                    hint: bt.t('status_offlineHint'),
                    color: D.t2,
                    bg: D.s3,
                  }
              return (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: 14,
                    background: D.s2,
                    borderRadius: 10,
                    border: `1px solid ${D.border}`,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: '0.95rem', color: D.t1, fontWeight: 500 }}>
                      {d.name}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: D.t2, marginTop: 3 }}>
                      {/* Marca și modelul sunt ale CASEI de marcat (FiscalNet):
                          pe planul fără bon device-ul e doar PC-ul imprimantei din
                          bucătărie, deci fără „Brand nedefinit" (lotul P). */}
                      {fiscalEnabled && (
                        <>
                          {d.fiscalnet_brand ? d.fiscalnet_brand.toUpperCase() : 'Brand nedefinit'}
                          {d.fiscalnet_model ? ` · ${d.fiscalnet_model}` : ''}
                          {' · '}
                        </>
                      )}
                      {bt.t('last_seen', { when: relativeTime(d.last_seen_at, bt) })}
                    </div>
                  </div>
                  <div
                    data-testid="bridge-device-status"
                    title={pill.hint}
                    style={{
                      display: 'inline-flex',
                      padding: '5px 10px',
                      borderRadius: 6,
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      color: pill.color,
                      background: pill.bg,
                    }}
                  >
                    {pill.label}
                  </div>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: '0.78rem',
                      color: d.prints_kitchen_receipts ? D.goldL : D.t2,
                      cursor: 'pointer',
                      minHeight: 32,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={d.prints_kitchen_receipts}
                      onChange={() => void toggleKitchenPrint(d)}
                      style={{ accentColor: D.gold, width: 16, height: 16, cursor: 'pointer' }}
                    />
                    {bt.t('kitchen_toggle')}
                  </label>
                  <button
                    onClick={() => handleDeleteDevice(d.id)}
                    style={btn({
                      background: 'transparent',
                      color: D.red,
                      border: `1px solid ${D.border}`,
                      height: 44,
                      fontSize: '0.78rem',
                    })}
                  >
                    {tc.t('delete')}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pending receipts — doar Plan 3 (bani + bon fiscal). Pe Planul 2 nu
          mai apare nici upsell-ul compact „Bonuri fiscale automate" (lotul P:
          upsell-ul e unul, pe Acasă). */}
      {fiscalEnabled && (
      <div style={card}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <h2 style={{ ...h2, margin: 0 }}>Bonuri fiscale</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['active', 'error', 'done', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={btn({
                  background: statusFilter === s ? D.goldA : D.s2,
                  color: statusFilter === s ? D.goldL : D.t2,
                  border: `1px solid ${statusFilter === s ? D.gold : D.border}`,
                  height: 44,
                  fontSize: '0.78rem',
                })}
              >
                {s === 'active'
                  ? 'Active'
                  : s === 'error'
                    ? 'Eșuate'
                    : s === 'done'
                      ? 'Finalizate'
                      : 'Toate'}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div
            style={{ padding: '24px 16px', textAlign: 'center', color: D.t2, fontSize: '0.88rem' }}
          >
            {receipts.length === 0
              ? 'Niciun bon fiscal trimis încă. Când o comandă trece în "plătit" iar casa este conectată, bonul se generează automat.'
              : 'Niciun bon în categoria aleasă.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${D.border}`, color: D.t2 }}>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {bt.t('col_created')}
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Total
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {bt.t('col_status')}
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Bon #
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {bt.t('col_details')}
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '10px 8px',
                      fontWeight: 500,
                      fontSize: '0.76rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {bt.t('col_actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const st = STATUS_STYLE[r.status]
                  const stLabel = r.status === 'sent' ? 'Trimis la casă' : bt.t(STATUS_KEY[r.status])
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${D.border}` }}>
                      <td style={{ padding: '10px 8px', color: D.t2, whiteSpace: 'nowrap' }}>
                        {relativeTime(r.created_at, bt)}
                      </td>
                      <td style={{ padding: '10px 8px', color: D.t1, fontWeight: 500 }}>
                        {ronFmt(r.total_snapshot)}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 5,
                            fontSize: '0.76rem',
                            color: st.color,
                            background: st.bg,
                          }}
                        >
                          {stLabel}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '10px 8px',
                          color: D.t2,
                          fontFamily: 'monospace',
                          fontSize: '0.78rem',
                        }}
                      >
                        {r.bon_number || '—'}
                      </td>
                      <td
                        style={{
                          padding: '10px 8px',
                          color: D.t2,
                          fontSize: '0.76rem',
                          maxWidth: 220,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.error_info || (r.retry_count > 0 ? bt.tp('retries', r.retry_count) : '')}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                        {(r.status === 'error' || r.status === 'cancelled') && (
                          <button
                            onClick={() => handleRetry(r.id, r.error_info)}
                            style={btn({
                              background: 'transparent',
                              color: D.goldL,
                              border: `1px solid ${D.border}`,
                              height: 44,
                              fontSize: '0.74rem',
                              padding: '0 10px',
                            })}
                          >
                            Retrimite
                          </button>
                        )}
                        {r.status === 'error' && (r.error_info ?? '').startsWith('POSIBIL DUPLICAT') && (
                          <button
                            onClick={() => openPrinted(r)}
                            title="Bonul există fizic pe bandă — înregistrează numărul lui, fără retrimitere"
                            style={btn({
                              background: 'transparent',
                              color: D.goldL,
                              border: `1px solid ${D.border}`,
                              height: 44,
                              fontSize: '0.74rem',
                              padding: '0 10px',
                              marginLeft: 6,
                            })}
                          >
                            Bonul a ieșit
                          </button>
                        )}
                        {r.status === 'pending' && (
                          <button
                            onClick={() => handleCancel(r.id)}
                            style={btn({
                              background: 'transparent',
                              color: D.red,
                              border: `1px solid ${D.border}`,
                              height: 44,
                              fontSize: '0.74rem',
                              padding: '0 10px',
                            })}
                          >
                            {tc.t('cancel')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* Tichete bucătărie (mig 227) — NEfiscale, coadă separată de bonuri. */}
      <div style={card}>
        <h2 style={h2}>{bt.t('tickets_title')}</h2>
        <div style={{ fontSize: '0.8rem', color: D.t2, marginBottom: 12, lineHeight: 1.5 }}>
          {bt.t('tickets_desc')}
          {/* Distincția față de bon are sens doar pe planul care emite bonuri. */}
          {fiscalEnabled && ' Tichetele NU sunt bonuri fiscale.'}
        </div>
        {tickets.length === 0 ? (
          <div
            style={{ padding: '20px 16px', textAlign: 'center', color: D.t2, fontSize: '0.88rem' }}
          >
            {bt.t('tickets_empty')}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${D.border}`, color: D.t2 }}>
                  {(
                    ['col_created', 'col_order', 'col_status', 'col_details', 'col_actions'] as const
                  ).map((h, i) => (
                    <th
                      key={h}
                      style={{
                        textAlign: i === 4 ? 'right' : 'left',
                        padding: '10px 8px',
                        fontWeight: 500,
                        fontSize: '0.76rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {bt.t(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const st = STATUS_STYLE[t.status]
                  return (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${D.border}` }}>
                      <td style={{ padding: '10px 8px', color: D.t2, whiteSpace: 'nowrap' }}>
                        {relativeTime(t.created_at, bt)}
                      </td>
                      <td
                        style={{
                          padding: '10px 8px',
                          color: D.t2,
                          fontFamily: 'monospace',
                          fontSize: '0.78rem',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        #{t.order_id.slice(0, 8)}
                        {t.is_reprint && (
                          <span
                            style={{
                              marginLeft: 6,
                              padding: '2px 6px',
                              borderRadius: 5,
                              fontSize: '0.7rem',
                              color: D.goldL,
                              background: D.goldA,
                              fontFamily: 'DM Sans,sans-serif',
                            }}
                          >
                            {bt.t('reprint')}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 5,
                            fontSize: '0.76rem',
                            color: st.color,
                            background: st.bg,
                          }}
                        >
                          {t.status === 'sent' ? bt.t('st_sentPrinter') : bt.t(STATUS_KEY[t.status])}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '10px 8px',
                          color: D.t2,
                          fontSize: '0.76rem',
                          maxWidth: 220,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t.error_code || (t.retry_count > 0 ? bt.tp('retries', t.retry_count) : '')}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                        {(t.status === 'error' || t.status === 'cancelled') && (
                          <button
                            onClick={() => handleTicketRetry(t.id)}
                            style={btn({
                              background: 'transparent',
                              color: D.goldL,
                              border: `1px solid ${D.border}`,
                              height: 44,
                              fontSize: '0.74rem',
                              padding: '0 10px',
                            })}
                          >
                            {tc.t('retry')}
                          </button>
                        )}
                        {t.status === 'pending' && (
                          <button
                            onClick={() => handleTicketCancel(t.id)}
                            style={btn({
                              background: 'transparent',
                              color: D.red,
                              border: `1px solid ${D.border}`,
                              height: 44,
                              fontSize: '0.74rem',
                              padding: '0 10px',
                            })}
                          >
                            {tc.t('cancel')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Register Modal ─── */}
      {showRegister && !newSecret && (
        <Modal
          onClose={() => setShowRegister(false)}
          closeLabel={tc.t('close')}
          title={fiscalEnabled ? 'Înregistrează casă de marcat' : bt.t('reg_titleDevice')}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={lbl}>{bt.t('reg_name')}</div>
              <input
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                style={inp}
                placeholder={fiscalEnabled ? 'ex: Casa de marcat principală' : bt.t('reg_namePh')}
              />
            </div>
            {fiscalEnabled && (
              <>
                <div>
                  <div style={lbl}>Brand</div>
                  <select
                    value={regBrand}
                    onChange={(e) => setRegBrand(e.target.value)}
                    style={inp}
                  >
                    <option value="datecs">Datecs</option>
                    <option value="activa">Activa</option>
                    <option value="tremol">Tremol</option>
                    <option value="custom">Custom Q3X</option>
                    <option value="other">Alt brand</option>
                  </select>
                </div>
                <div>
                  <div style={lbl}>Model (opțional)</div>
                  <input
                    value={regModel}
                    onChange={(e) => setRegModel(e.target.value)}
                    style={inp}
                    placeholder="ex: DP-25, MP-55"
                  />
                </div>
              </>
            )}
            <div
              style={{
                fontSize: '0.78rem',
                color: D.t2,
                lineHeight: 1.5,
                background: D.s3,
                padding: 12,
                borderRadius: 8,
              }}
            >
              {fiscalEnabled
                ? 'După înregistrare vei primi o cheie unică de instalare. O folosești o singură dată la instalarea Bridge-ului pe PC-ul cu FiscalNet. Cheia poate fi recuperată mai târziu doar prin re-înregistrare.'
                : bt.t('reg_infoKitchen')}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
              <button
                onClick={() => setShowRegister(false)}
                style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
              >
                {tc.t('cancel')}
              </button>
              <button
                onClick={handleRegister}
                disabled={regBusy || !regName.trim()}
                style={btn({ background: D.gold, color: '#0a0a0a', opacity: regBusy ? 0.6 : 1 })}
              >
                {regBusy ? bt.t('reg_busy') : bt.t('reg_submit')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── „Bonul a ieșit” (fiscal, mig 277) ─── */}
      {printedFor && (
        <Modal
          onClose={() => {
            if (!printedBusy) setPrintedFor(null)
          }}
          closeLabel={tc.t('close')}
          title="Bonul a ieșit pe bandă"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: '0.82rem', color: D.t2, lineHeight: 1.5 }}>
              Confirmarea de la casă s-a pierdut, dar bonul <strong>există fizic pe bandă</strong>.
              Scrie numărul lui (NRBON de pe bon sau din raportul X): se înregistrează ca tipărit, cu
              urmă în audit, iar factura Oblio a comenzii (dacă e cerută) iese cu mențiunea lui.{' '}
              <strong>Nu retrimite</strong> — ar ieși un bon fiscal dublu.
            </div>
            <label style={{ fontSize: '0.78rem', color: D.t2 }}>
              Numărul bonului
              <input
                value={printedBon}
                onChange={(e) => setPrintedBon(e.target.value)}
                placeholder="Ex: 0042"
                inputMode="numeric"
                autoFocus
                disabled={printedBusy}
                style={{
                  display: 'block',
                  width: '100%',
                  boxSizing: 'border-box',
                  marginTop: 6,
                  height: 44,
                  padding: '0 12px',
                  borderRadius: 8,
                  border: `1px solid ${D.border}`,
                  background: D.s3,
                  color: D.t1,
                  fontSize: '0.95rem',
                  fontFamily: 'monospace',
                }}
              />
            </label>
            {printedErr && (
              <div role="alert" style={{ fontSize: '0.78rem', color: D.red }}>
                {printedErr}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPrintedFor(null)}
                disabled={printedBusy}
                style={btn({
                  background: 'transparent',
                  color: D.t2,
                  border: `1px solid ${D.border}`,
                  height: 44,
                  padding: '0 14px',
                })}
              >
                Renunță
              </button>
              <button
                onClick={() => void handleVerifiedPrinted()}
                disabled={printedBusy || !printedBon.trim()}
                style={btn({ height: 44, padding: '0 14px' })}
              >
                {printedBusy ? 'Se înregistrează…' : 'Înregistrează bonul'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {newSecret && (
        <Modal
          // Cheia de instalare se afișează O SINGURĂ DATĂ („nu mai poate fi
          // recuperată") — un tap accidental pe fundal o pierdea definitiv.
          dismissable={false}
          closeLabel={tc.t('close')}
          onClose={closeKeyModal}
          title={fiscalEnabled ? 'Casă înregistrată' : bt.t('key_titleDevice')}
        >
          {/* C7a: înainte fereastra arăta DOAR cheia — fără link de descărcare,
              fără pași, iar wizardul cerea o „anon key" pe care panoul nu o
              afișa nicăieri. Acum: programul, config.json gata făcut,
              verificarea. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: '0.88rem', color: D.t1, lineHeight: 1.55 }}>
              {bt.t('key_intro')}
            </div>
            <ol
              data-testid="bridge-key-steps"
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <SetupStep
                n={1}
                title={bt.t('step1_title')}
                desc={
                  fiscalEnabled
                    ? 'Installer-ul pentru Windows, pe PC-ul cu FiscalNet de lângă casa de marcat.'
                    : bt.t('step1_descKitchen')
                }
              >
                {downloadUrl ? (
                  <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      ...btn({ background: D.s2, color: D.t1, border: `1px solid ${D.border}` }),
                      textDecoration: 'none',
                      alignSelf: 'flex-start',
                    }}
                  >
                    <Icon name="download" size={15} />
                    {bt.t('step1_download')}
                  </a>
                ) : (
                  // Fără VITE_BRIDGE_DOWNLOAD_URL nu se inventează un link
                  // (niciodată unul mort): spunem cum se obține programul.
                  <div style={{ fontSize: '0.78rem', color: D.t2, lineHeight: 1.5 }}>
                    {bt.t('step1_missing')}
                  </div>
                )}
              </SetupStep>
              <SetupStep
                n={2}
                title={bt.t('step2_title')}
                desc={
                  publicConfig
                    ? fiscalEnabled
                      ? bt.t('step2_desc')
                      : `${bt.t('step2_desc')} ${bt.t('step2_kitchenNote')}`
                    : null
                }
              >
                {publicConfig && (
                  <>
                    <button
                      onClick={downloadConfig}
                      style={btn({
                        background: D.gold,
                        color: '#0a0a0a',
                        alignSelf: 'flex-start',
                      })}
                    >
                      <Icon name="download" size={15} />
                      {bt.t('step2_download')}
                    </button>
                    <div style={{ fontSize: '0.74rem', color: D.t2, lineHeight: 1.5 }}>
                      {bt.t('step2_private')}
                    </div>
                  </>
                )}
                {/* Installer-ul NU înlocuiește un config.json existent, iar un
                    fișier vechi lângă installer poate fi cel copiat; wizardul
                    arată doar coada cheii, deci comparația se face pe ea. */}
                <div
                  data-testid="bridge-secret-tail"
                  style={{ fontSize: '0.74rem', color: D.t2, lineHeight: 1.5 }}
                >
                  {bt.t('step2_tail', { tail: secretTail(newSecret.secret) })}
                </div>
                <div style={{ fontSize: '0.78rem', color: D.t2, lineHeight: 1.55 }}>
                  {bt.t('key_label')}
                </div>
                <div
                  data-testid="bridge-device-secret"
                  style={{
                    background: D.s3,
                    padding: 14,
                    borderRadius: 9,
                    border: `1px solid ${D.gold}`,
                    fontFamily: 'monospace',
                    fontSize: '0.82rem',
                    color: D.goldL,
                    wordBreak: 'break-all',
                  }}
                >
                  {newSecret.secret}
                </div>
                <button
                  onClick={() => {
                    // Feedback la copiere — înainte eșecul era înghițit tăcut și
                    // nu exista niciun semn că s-a copiat (cheie critică).
                    if (!navigator.clipboard) {
                      setCopiedKey(false)
                      setCopyFailed(true)
                      return
                    }
                    navigator.clipboard
                      .writeText(newSecret.secret)
                      .then(() => {
                        setCopiedKey(true)
                        setCopyFailed(false)
                      })
                      .catch(() => {
                        setCopiedKey(false)
                        setCopyFailed(true)
                      })
                  }}
                  style={btn({
                    background: D.s2,
                    color: D.t1,
                    border: `1px solid ${D.border}`,
                    alignSelf: 'flex-start',
                  })}
                >
                  <Icon name="copy" size={15} />
                  {copiedKey ? bt.t('key_copied') : bt.t('key_copy')}
                </button>
                {copyFailed && (
                  <div style={{ fontSize: '0.78rem', color: D.red, lineHeight: 1.5 }}>
                    {bt.t('key_copyFailed')}
                  </div>
                )}
              </SetupStep>
              <SetupStep
                n={3}
                title={bt.t('step3_title')}
                desc={
                  fiscalEnabled
                    ? 'Installer-ul pornește bridge-ul la final (altfel: meniul Start → Menuvia Bridge → „Pornește bridge-ul”, sau repornește PC-ul). „Verificare conexiune (check)” din același meniu spune dacă vede serverul Menuvia și FiscalNet. Dovada că rulează: casa rămâne aici „● Online” și după 3 minute — verificarea singură o aprinde doar câteva minute.'
                    : bt.t('step3_descKitchen')
                }
              />
            </ol>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: '0.78rem',
                color: D.amber,
                background: 'rgba(232,160,32,0.08)',
                padding: 12,
                borderRadius: 8,
                lineHeight: 1.5,
              }}
            >
              <span style={{ flexShrink: 0, marginTop: 1 }}>
                <Icon name="alert" size={15} />
              </span>
              <span>{bt.t('key_warning')}</span>
            </div>
            <button
              onClick={closeKeyModal}
              style={btn({ background: D.gold, color: '#0a0a0a', alignSelf: 'flex-end' })}
            >
              {bt.t('key_done')}
            </button>
          </div>
        </Modal>
      )}

      {/* ── VAT Mapping Modal ─── */}
      {showVatMap && (
        <Modal
          onClose={() => setShowVatMap(false)}
          closeLabel={tc.t('close')}
          title="Mapare grupe TVA → FiscalNet"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: '0.82rem', color: D.t2, lineHeight: 1.55 }}>
              La fiscalizare, instalatorul setează grupele TVA pe casă (1-5). Asigură-te că maparea
              de mai jos corespunde cu setarea reală a casei tale — altfel bonurile vor ieși cu TVA
              greșit.
            </div>
            {vatRates.length === 0 && (
              <div
                style={{
                  padding: '18px 14px',
                  textAlign: 'center',
                  color: D.t2,
                  fontSize: '0.84rem',
                  lineHeight: 1.55,
                  background: D.s2,
                  borderRadius: 8,
                  border: `1px solid ${D.border}`,
                }}
              >
                Nu ai cote TVA configurate încă. Adaugă întâi cotele de TVA în setările
                restaurantului, apoi revino aici ca să le mapezi pe grupele casei de marcat.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {vatRates.map((v) => (
                <div
                  key={v.vat_group}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 10,
                    background: D.s2,
                    borderRadius: 8,
                    border: `1px solid ${D.border}`,
                  }}
                >
                  <div style={{ flex: 1, fontSize: '0.85rem', color: D.t1 }}>
                    <div>
                      Grupa {v.vat_group} · <span style={{ color: D.goldL }}>{v.label}</span>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: D.t2 }}>{v.rate_percent}% TVA</div>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: D.t3 }}>→ FiscalNet</div>
                  <select
                    value={vatEdits[v.vat_group] ?? v.fiscalnet_group}
                    onChange={(e) =>
                      setVatEdits((s) => ({ ...s, [v.vat_group]: Number(e.target.value) }))
                    }
                    style={{ ...inp, width: 80, height: 34 }}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        Gr. {n}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowVatMap(false)}
                style={btn({ background: D.s2, color: D.t2, border: `1px solid ${D.border}` })}
              >
                {tc.t('cancel')}
              </button>
              <button
                onClick={handleSaveVatMap}
                disabled={vatBusy || vatRates.length === 0}
                style={btn({
                  background: D.gold,
                  color: '#0a0a0a',
                  opacity: vatBusy || vatRates.length === 0 ? 0.6 : 1,
                })}
              >
                {vatBusy ? 'Se salvează...' : 'Salvează maparea'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{ background: D.s1, border: `1px solid ${D.border}`, borderRadius: 10, padding: 14 }}
    >
      <div
        style={{
          fontSize: '0.74rem',
          color: D.t2,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '1.6rem',
          fontWeight: 600,
          color,
          marginTop: 6,
          fontFamily: 'Fraunces,serif',
        }}
      >
        {value}
      </div>
    </div>
  )
}

/** Un pas al instalării (fereastra cu cheia): număr, titlu, explicație, acțiuni. */
function SetupStep({
  n,
  title,
  desc,
  children,
}: {
  n: number
  title: string
  desc?: string | null
  children?: React.ReactNode
}) {
  return (
    <li
      style={{
        display: 'flex',
        gap: 12,
        padding: 12,
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 10,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 24,
          height: 24,
          borderRadius: 12,
          background: D.goldA,
          color: D.goldL,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.78rem',
          fontWeight: 600,
        }}
      >
        {n}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '0.88rem', color: D.t1, fontWeight: 600 }}>{title}</div>
        {desc && <div style={{ fontSize: '0.78rem', color: D.t2, lineHeight: 1.5 }}>{desc}</div>}
        {children}
      </div>
    </li>
  )
}

function Modal({
  title,
  onClose,
  closeLabel,
  children,
  dismissable = true,
}: {
  title: string
  onClose: () => void
  /** Eticheta X-ului (din `common`, în limba ecranului). */
  closeLabel: string
  children: React.ReactNode
  /** false = nici backdrop-ul, nici X-ul NU închid (conținut critic, ex. cheia de instalare). */
  dismissable?: boolean
}) {
  return (
    <div
      onClick={dismissable ? onClose : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.s1,
          border: `1px solid ${D.border}`,
          borderRadius: 14,
          padding: 22,
          maxWidth: 480,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              color: D.t1,
              margin: 0,
              fontFamily: 'Fraunces,serif',
            }}
          >
            {title}
          </h2>
          {dismissable && (
            <button
              onClick={onClose}
              aria-label={closeLabel}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 44,
                minHeight: 44,
                background: 'transparent',
                border: 'none',
                color: D.t2,
                cursor: 'pointer',
                lineHeight: 1,
                padding: 4,
                margin: -8,
              }}
            >
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

// ReservationSheet — bottom sheet pentru rezervări publice (anon).
// Submit prin RPC create_reservation_public (SECURITY DEFINER, advisory lock).
// Layout inspirat de design ialoc.ro: chip-pills orizontale + trust strip.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import type { CSSProperties } from 'react'
import { supabase } from '../lib/supabase'
import { T } from '../lib/publicMenuStrings'
import type { Restaurant } from '../lib/qr'
import {
  fetchPublicFloorPlan,
  fetchTablesAvailability,
  type PublicFloorTable,
  type TableAvailabilityRow,
} from '../lib/qr'
import type { FloorLayout } from '../lib/floorPlan'
import { CANVAS_W, CANVAS_H } from '../lib/floorPlan'
import type { MenuTheme } from '../lib/themes'
import FloorPlanViewer from './menu/FloorPlanViewer'

interface PubColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

interface Props {
  restaurant: Restaurant
  theme: MenuTheme
  accent: string
  PUB: PubColors
  lang: string
  onClose: () => void
}

interface PublicSettings {
  open_days: number[]
  open_time: string
  close_time: string
  slot_interval: number
  reservation_duration: number
  min_advance_hours: number
  max_advance_days: number
  max_party_size: number
}

interface CreateResult {
  reservation_id: string
  confirmation_code: string
  status: string
  table_name: string | null
  starts_at: string
  ends_at: string
  requested_zone: string | null
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n
}

function ymd(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function parseTime(hhmm: string): { h: number; m: number } {
  const parts = hhmm.split(':')
  return { h: Number(parts[0] ?? 0), m: Number(parts[1] ?? 0) }
}

function minutesOfDay(hhmm: string): number {
  const t = parseTime(hhmm)
  return t.h * 60 + t.m
}

// Adaugă `n` zile la o dată YYYY-MM-DD (fus local — folosită doar pentru a muta
// data unui slot de după miezul nopții pe ziua următoare).
function addDaysYmd(dateYmd: string, n: number): string {
  const [y, mo, d] = dateYmd.split('-').map(Number)
  return ymd(new Date(y!, mo! - 1, d! + n))
}

// Data reală a unui slot. Pentru un restaurant deschis PESTE miezul nopții
// (close <= open), sloturile cu ora sub ora de deschidere aparțin zilei
// următoare (ex. program 18:00–02:00: slotul „01:00" ales „azi" e de fapt mâine
// la 01:00). Astfel disponibilitatea și submit-ul folosesc instantul corect.
function effectiveSlotYmd(dateYmd: string, timeSlot: string, settings: PublicSettings): string {
  const openMin = minutesOfDay(settings.open_time)
  const closeMin = minutesOfDay(settings.close_time)
  const wrap = closeMin <= openMin
  if (wrap && minutesOfDay(timeSlot) < openMin) return addDaysYmd(dateYmd, 1)
  return dateYmd
}

function buildSlots(
  dateYmd: string,
  settings: PublicSettings,
  minAdvanceMs: number,
  timeZone: string,
): string[] {
  const open = parseTime(settings.open_time)
  const close = parseTime(settings.close_time)
  const interval = settings.slot_interval
  if (!dateYmd || interval <= 0) return []

  // Etichetele de oră sunt ore de PERETE ale restaurantului (independente de
  // fus). Filtrarea min_advance se face însă pe instantul REAL (UTC) al fiecărui
  // slot în fusul RESTAURANTULUI, nu în fusul browserului — altfel un client din
  // diaspora vedea sloturi care erau de fapt în trecut (sau invers).
  const minEpoch = Date.now() + minAdvanceMs
  const openMin = open.h * 60 + open.m
  const closeMin = close.h * 60 + close.m
  // Restaurant deschis peste miezul nopții (close <= open): iterăm până la
  // close+24h și etichetăm sloturile de după miezul nopții cu ora de perete
  // (mins % 1440). Data reală a fiecărui slot (azi vs. mâine) se ia din
  // `effectiveSlotYmd`, ca filtrul min_advance să compare instantul corect.
  const endMin = closeMin <= openMin ? closeMin + 24 * 60 : closeMin
  const slots: string[] = []
  for (let mins = openMin; mins < endMin; mins += interval) {
    const wall = mins % (24 * 60)
    const label = pad2(Math.floor(wall / 60)) + ':' + pad2(wall % 60)
    const slotYmd = effectiveSlotYmd(dateYmd, label, settings)
    const slotEpoch = new Date(isoForLocalDateTime(slotYmd, label, timeZone)).getTime()
    if (Number.isFinite(slotEpoch) && slotEpoch >= minEpoch) slots.push(label)
  }
  return slots
}

// Convertește ora aleasă (oră de perete) în UTC ISO, interpretată ÎN fusul
// restaurantului — NU în fusul browserului vizitatorului. Fără asta, un client
// din diaspora care alege 19:00 pentru un restaurant din București trimitea o
// oră greșită (interpretată în fusul lui). Trucul standard fără librării:
// calculează offset-ul fusului la acel instant și aplică-l.
function isoForLocalDateTime(dateYmd: string, hhmm: string, timeZone: string): string {
  const [y, mo, d] = dateYmd.split('-').map(Number)
  const t = parseTime(hhmm)
  const asUtc = Date.UTC(y!, mo! - 1, d!, t.h, t.m, 0, 0)
  try {
    // Offset-ul fusului = diferența dintre cum arată ACELAȘI instant redat în
    // `timeZone` vs. în UTC. Redăm în AMBELE și le parsăm identic (în fusul
    // browserului) → offset-ul browserului se anulează, rămâne doar offset-ul
    // restaurantului. Fără asta, un client care NU e în UTC primea o oră greșită
    // (ex. Bucureștean 19:00 → 19:00Z în loc de 16:00Z).
    const utcWall = new Date(new Date(asUtc).toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    const tzWall = new Date(new Date(asUtc).toLocaleString('en-US', { timeZone })).getTime()
    if (Number.isFinite(utcWall) && Number.isFinite(tzWall)) {
      return new Date(asUtc - (tzWall - utcWall)).toISOString()
    }
  } catch {
    /* fus invalid → fallback la UTC brut (comportamentul vechi) */
  }
  return new Date(asUtc).toISOString()
}

function formatDateRo(dateYmd: string, lang: string): string {
  const [y, mo, d] = dateYmd.split('-').map(Number)
  const dt = new Date(y!, mo! - 1, d!)
  return dt.toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export default function ReservationSheet({ restaurant, theme, accent, PUB, lang, onClose }: Props) {
  useBodyScrollLock(true)
  // Fusul restaurantului (fallback București) — folosit la construirea sloturilor
  // și la conversia orei de perete în instant UTC.
  const tz = restaurant.timezone || 'Europe/Bucharest'
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [zones, setZones] = useState<string[]>([])
  const [partySize, setPartySize] = useState<number>(2)
  const [dateChoice, setDateChoice] = useState<'today' | 'tomorrow' | 'other'>('today')
  const [customDate, setCustomDate] = useState<string>('')
  const [zone, setZone] = useState<string | null>(null)
  const [timeSlot, setTimeSlot] = useState<string>('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateResult | null>(null)

  // ── Harta sălii (rezervare cu alegere pe hartă) — pur aditiv ────
  // Dacă restaurantul n-are floor_layout sau RPC-ul dă eroare, harta pur și
  // simplu nu se afișează, iar fluxul clasic (zonă text + auto-alocare) rămâne.
  const [floorLayout, setFloorLayout] = useState<FloorLayout | null>(null)
  const [publicTables, setPublicTables] = useState<PublicFloorTable[]>([])
  const [availability, setAvailability] = useState<TableAvailabilityRow[]>([])
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  // Bump pentru a re-declanșa efectul (guarded) de încărcare a disponibilității,
  // fără un fetch paralel separat care ar putea suprascrie cu date vechi.
  const [reloadNonce, setReloadNonce] = useState(0)
  const [mapLoading, setMapLoading] = useState(false)
  // Semnalizează că fetch-ul hărții/disponibilității a eșuat (rețea/RLS/timeout).
  // Neblocant: fluxul cu alocare automată rămâne complet utilizabil.
  const [mapError, setMapError] = useState(false)
  // Mesaj efemer la atingerea unei mese ocupate (feedback, se stinge singur).
  const [occupiedMsg, setOccupiedMsg] = useState<string | null>(null)

  // Load public settings + zones via lightweight selects.
  // reservation_settings RLS = admin-only, dar avem nevoie de slot_interval,
  // open_time, close_time pe public — folosim RPC fără sau read direct?
  // Soluție: facem un select cu anon care primește un rând per restaurant
  // prin policy publică separată (TBD). Pentru acum: defaults + RPC va
  // valida server-side oricum.
  useEffect(() => {
    let cancelled = false
    async function load() {
      // OPT-R2: settings + zone-uri sunt interogări INDEPENDENTE — în paralel.
      // Try select public via dedicated read policy (settings public-readable).
      // Fallback la defaults dacă RLS blochează.
      const [{ data: s }, { data: tz }] = await Promise.all([
        supabase
          .from('reservation_settings')
          .select(
            'open_days, open_time, close_time, slot_interval, reservation_duration, min_advance_hours, max_advance_days, max_party_size',
          )
          .eq('restaurant_id', restaurant.id)
          .maybeSingle(),
        supabase
          .from('tables')
          .select('zone')
          .eq('restaurant_id', restaurant.id)
          .eq('is_active', true)
          .not('zone', 'is', null),
      ])
      if (cancelled) return
      const resolved: PublicSettings = (s as PublicSettings) ?? {
        open_days: [1, 2, 3, 4, 5, 6, 7],
        open_time: '10:00',
        close_time: '23:00',
        slot_interval: 30,
        reservation_duration: 90,
        min_advance_hours: 2,
        max_advance_days: 30,
        max_party_size: 20,
      }
      setSettings(resolved)
      // Clamp party-ul la limita reală: dacă restaurantul acceptă max 1 masă de
      // 1 loc, valoarea inițială hardcodată (2) ar fi respinsă tardiv de RPC.
      setPartySize((p) => Math.min(Math.max(p, 1), Math.max(resolved.max_party_size, 1)))

      const uniq = Array.from(
        new Set(
          ((tz ?? []) as { zone: string | null }[]).map((r) => r.zone).filter(Boolean) as string[],
        ),
      ).sort((a, b) => a.localeCompare(b, lang === 'ro' ? 'ro' : 'en'))
      setZones(uniq)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [restaurant.id, lang])

  const chosenDateYmd = useMemo(() => {
    if (dateChoice === 'today') return ymd(new Date())
    if (dateChoice === 'tomorrow') {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      return ymd(d)
    }
    return customDate
  }, [dateChoice, customDate])

  const slots = useMemo(() => {
    if (!settings || !chosenDateYmd) return []
    const minAdvanceMs = settings.min_advance_hours * 3_600_000
    return buildSlots(chosenDateYmd, settings, minAdvanceMs, tz)
  }, [settings, chosenDateYmd, tz])

  // Auto-reset time if no longer valid
  useEffect(() => {
    if (timeSlot && !slots.includes(timeSlot)) setTimeSlot('')
  }, [slots, timeSlot])

  // Slotul complet (starts_at ISO + ends_at derivat din durata din settings).
  // ends_at = starts_at + reservation_duration (minute) — aceeași durată pe care
  // RPC-ul o folosește implicit când p_duration_minutes e null. Fără party/dată/
  // oră complete → null (harta nu se încarcă).
  const slot = useMemo(() => {
    if (!settings || !chosenDateYmd || !timeSlot) return null
    // Data reală a slotului (ziua următoare pentru sloturile de după miezul nopții).
    const startsAt = isoForLocalDateTime(
      effectiveSlotYmd(chosenDateYmd, timeSlot, settings),
      timeSlot,
      tz,
    )
    const endsAt = new Date(
      new Date(startsAt).getTime() + settings.reservation_duration * 60_000,
    ).toISOString()
    return { startsAt, endsAt }
  }, [settings, chosenDateYmd, timeSlot, tz])

  // Reîncarcă disponibilitatea (folosit la eroarea table_unavailable). Trece prin
  // efectul guarded de mai jos (nonce) ca un răspuns întârziat pentru slotul
  // vechi să nu suprascrie disponibilitatea proaspătă.
  const reloadAvailability = useCallback(() => {
    setReloadNonce((n) => n + 1)
  }, [])

  // La schimbarea slotului (dată/oră/party): încarcă în paralel harta + disponibilitatea.
  // Deselectăm masa aleasă — nu mai e garantată pentru noul slot.
  useEffect(() => {
    if (!slot || !restaurant.slug) {
      setFloorLayout(null)
      setPublicTables([])
      setAvailability([])
      setSelectedTableId(null)
      return
    }
    let cancelled = false
    const slug = restaurant.slug
    setMapLoading(true)
    setMapError(false)
    setOccupiedMsg(null)
    setSelectedTableId(null)
    void Promise.all([
      fetchPublicFloorPlan(slug),
      fetchTablesAvailability(slug, slot.startsAt, slot.endsAt, partySize),
    ])
      .then(([plan, avail]) => {
        if (cancelled) return
        setFloorLayout(plan.floor_layout)
        setPublicTables(plan.tables)
        setAvailability(avail)
        setMapLoading(false)
      })
      .catch(() => {
        // Orice respingere (rețea/RLS/timeout): oprim spinner-ul ca harta să nu
        // rămână blocată și arătăm un mesaj neblocant. Fără hartă, fluxul cade
        // înapoi pe alocarea automată (p_table_id = null).
        if (cancelled) return
        setFloorLayout(null)
        setPublicTables([])
        setAvailability([])
        setMapError(true)
        setMapLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slot, restaurant.slug, partySize, reloadNonce])

  // Feedback-ul de masă ocupată se stinge singur după câteva secunde.
  useEffect(() => {
    if (!occupiedMsg) return
    const id = window.setTimeout(() => setOccupiedMsg(null), 3500)
    return () => window.clearTimeout(id)
  }, [occupiedMsg])

  // Harta se afișează doar dacă există un layout cu cel puțin o masă pe primul etaj.
  const hasFloorMap = useMemo(
    () => floorLayout != null && (floorLayout.floors[0]?.tables.length ?? 0) > 0,
    [floorLayout],
  )

  const availabilityByTableId = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const r of availability) m.set(r.table_id, r.is_available)
    return m
  }, [availability])

  const tablesByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of publicTables) m.set(t.name.trim().toLowerCase(), t.id)
    return m
  }, [publicTables])

  // Masa aleasă pe hartă (pentru chip-ul de confirmare afișat în afara SVG-ului).
  const selectedTable = useMemo(
    () => publicTables.find((t) => t.id === selectedTableId) ?? null,
    [publicTables, selectedTableId],
  )

  const submit = useCallback(async () => {
    setError(null)
    if (!chosenDateYmd) {
      setError(lang === 'ro' ? 'Alege data' : 'Choose date')
      return
    }
    if (!timeSlot) {
      setError(lang === 'ro' ? 'Alege ora' : 'Choose time')
      return
    }
    if (!settings) return
    if (name.trim().length === 0) {
      setError(lang === 'ro' ? 'Numele este obligatoriu' : 'Name is required')
      return
    }
    if (phone.trim().length === 0) {
      setError(lang === 'ro' ? 'Telefonul este obligatoriu' : 'Phone is required')
      return
    }
    // Email opțional, dar dacă e completat trebuie să fie valid (altfel se stoca orice string).
    if (email.trim().length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError(lang === 'ro' ? 'Email invalid' : 'Invalid email')
      return
    }
    setSubmitting(true)
    // Data reală a slotului (mâine pentru sloturile de după miezul nopții).
    const startsAt = isoForLocalDateTime(
      effectiveSlotYmd(chosenDateYmd, timeSlot, settings),
      timeSlot,
      tz,
    )
    const { data, error: rpcErr } = await supabase.rpc('create_reservation_public', {
      p_slug: restaurant.slug,
      p_customer_name: name.trim(),
      p_customer_phone: phone.trim(),
      p_party_size: partySize,
      p_starts_at: startsAt,
      p_customer_email: email.trim().length > 0 ? email.trim() : null,
      p_special_requests: notes.trim().length > 0 ? notes.trim() : null,
      p_duration_minutes: null,
      p_zone: zone,
      // Masa aleasă pe hartă (null = auto-alocare, comportamentul clasic).
      p_table_id: selectedTableId,
    })
    setSubmitting(false)
    if (rpcErr) {
      // Mapăm erorile DB cunoscute la mesaje prietenoase (nu expunem text brut Postgres).
      const m = rpcErr.message || ''
      // Masa aleasă tocmai a fost luată de altcineva (hint `table_unavailable`).
      // Reîncărcăm disponibilitatea și deselectăm, ca clientul să aleagă alta.
      if (/table_unavailable/i.test(m)) {
        setSelectedTableId(null)
        void reloadAvailability()
        setError(
          lang === 'ro'
            ? 'Masa tocmai a fost rezervată. Alege altă masă liberă.'
            : 'That table was just booked. Please pick another free table.',
        )
        return
      }
      // Precedență fixă: overlap → rate-limit → modul dezactivat → fallback.
      let friendly: string
      if (/overlap|exclusion/i.test(m)) {
        friendly =
          lang === 'ro'
            ? 'Intervalul ales se suprapune cu altă rezervare. Alege altă oră.'
            : 'That time overlaps another reservation. Pick another slot.'
      } else if (/rate.?limit|prea multe|too many/i.test(m)) {
        friendly =
          lang === 'ro'
            ? 'Prea multe rezervări într-un interval scurt. Reîncearcă mai târziu.'
            : 'Too many reservations in a short time. Try again later.'
      } else if (/module|not activ|dezactiv|disabled/i.test(m)) {
        friendly =
          lang === 'ro'
            ? 'Rezervările nu sunt active pentru acest restaurant.'
            : 'Reservations are not enabled for this restaurant.'
      } else if (/nu acceptă rezervări|această zi|closed|închis|open_days/i.test(m)) {
        // Ziua aleasă e închisă (RPC mig 201) — mesaj clar, nu fallback-ul generic.
        friendly =
          lang === 'ro'
            ? 'Restaurantul e închis în ziua aleasă. Alege altă zi.'
            : 'The restaurant is closed on the selected day. Pick another day.'
      } else {
        friendly =
          lang === 'ro'
            ? 'Nu am putut salva rezervarea. Verifică datele și reîncearcă.'
            : 'Could not save the reservation. Check the details and try again.'
      }
      setError(friendly)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setResult(row as CreateResult)
  }, [settings, chosenDateYmd, timeSlot, name, phone, partySize, email, notes, zone, selectedTableId, reloadAvailability, restaurant.slug, tz, lang])

  const maxParty = settings?.max_party_size ?? 20

  const chipBase: CSSProperties = {
    padding: '10px 14px',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    border: `1.5px solid ${PUB.border}`,
    background: PUB.surface,
    color: PUB.text,
    cursor: 'pointer',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    fontFamily: theme.fonts.body,
  }
  const chipActive = (active: boolean): CSSProperties =>
    active ? { background: accent, color: '#fff', borderColor: accent } : {}

  const labelStyle: CSSProperties = {
    fontSize: 11,
    letterSpacing: '0.1em',
    fontWeight: 600,
    color: PUB.text2,
    marginTop: 22,
    marginBottom: 10,
  }
  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    border: `1.5px solid ${PUB.border}`,
    borderRadius: 10,
    fontSize: 14,
    fontFamily: theme.fonts.body,
    background: PUB.surface,
    color: PUB.text,
    outline: 'none',
    boxSizing: 'border-box',
  }

  // ── SUCCESS state ─────────────────────────────────────────────
  if (result) {
    const isConfirmed = result.status === 'confirmed'
    // Pending fără masă alocată ≠ pending care așteaptă confirmare admin.
    // Mesaj diferit ca să nu sugerăm clientului că rezervarea poate fi refuzată.
    const isPendingNoTable = !isConfirmed && !result.table_name
    return (
      <SheetShell onClose={onClose} PUB={PUB} theme={theme} accent={accent} title={restaurant.name}>
        <div style={{ padding: '32px 22px', textAlign: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: isConfirmed ? accent : PUB.surface,
              border: isConfirmed ? 'none' : `2px solid ${accent}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: isConfirmed ? '#fff' : accent,
              fontSize: 30,
            }}
          >
            {isConfirmed ? '✓' : '⏳'}
          </div>
          <div
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 24,
              fontWeight: 600,
              color: PUB.text,
              marginBottom: 8,
            }}
          >
            {T(lang, isConfirmed ? 'reserve_success_title' : 'reserve_pending_title')}
          </div>
          {!isConfirmed && (
            <div style={{ fontSize: 14, color: PUB.text2, marginBottom: 16, lineHeight: 1.5 }}>
              {T(lang, isPendingNoTable ? 'reserve_pending_no_table_sub' : 'reserve_pending_sub')}
            </div>
          )}
          <div
            style={{
              background: PUB.surface,
              border: `1px solid ${PUB.border}`,
              borderRadius: 14,
              padding: 18,
              margin: '20px 0',
              textAlign: 'left',
            }}
          >
            <div
              style={{ fontSize: 11, color: PUB.text2, letterSpacing: '0.08em', marginBottom: 4 }}
            >
              {T(lang, 'reserve_code_label')}
            </div>
            <div
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: 22,
                color: accent,
                letterSpacing: '0.18em',
                fontWeight: 600,
                marginBottom: 14,
              }}
            >
              {result.confirmation_code}
            </div>
            <div style={{ fontSize: 14, color: PUB.text, marginBottom: 4 }}>
              {formatDateRo(
                settings ? effectiveSlotYmd(chosenDateYmd, timeSlot, settings) : chosenDateYmd,
                lang,
              )}{' '}
              · {timeSlot}
            </div>
            <div style={{ fontSize: 13, color: PUB.text2 }}>
              {partySize}{' '}
              {lang === 'ro'
                ? partySize === 1
                  ? 'persoană'
                  : 'persoane'
                : partySize === 1
                  ? 'person'
                  : 'people'}
              {result.table_name ? ' · ' + result.table_name : ''}
            </div>
          </div>
          {email.trim().length > 0 && (
            <div style={{ fontSize: 12, color: PUB.text3, marginBottom: 14 }}>
              {T(lang, 'reserve_email_reminder')}
            </div>
          )}
          {restaurant.phone && (
            <div style={{ fontSize: 13, color: PUB.text2, marginBottom: 22 }}>
              {T(lang, 'reserve_call_if_change')}:{' '}
              <a href={'tel:' + restaurant.phone} style={{ color: accent, textDecoration: 'none' }}>
                {restaurant.phone}
              </a>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexDirection: 'column' }}>
            <button
              onClick={() => {
                setResult(null)
                setError(null)
                setName('')
                setPhone('')
                setEmail('')
                setNotes('')
              }}
              style={{
                padding: '14px 20px',
                background: accent,
                border: 'none',
                borderRadius: 12,
                color: '#fff',
                fontFamily: theme.fonts.body,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {T(lang, 'reserve_add_another')}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '14px 20px',
                background: 'transparent',
                border: `1.5px solid ${PUB.border}`,
                borderRadius: 12,
                color: PUB.text,
                fontFamily: theme.fonts.body,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {T(lang, 'reserve_back_to_menu')}
            </button>
          </div>
        </div>
      </SheetShell>
    )
  }

  // ── FORM state ────────────────────────────────────────────────
  return (
    <SheetShell onClose={onClose} PUB={PUB} theme={theme} accent={accent} title={restaurant.name}>
      <div
        style={{
          padding: '10px 18px 12px',
          background: PUB.surface,
          color: PUB.text2,
          fontSize: 13,
          borderBottom: `1px solid ${PUB.border}`,
        }}
      >
        {T(lang, 'reserve_trust')}
      </div>
      <div style={{ padding: '6px 22px 22px', flex: 1, overflowY: 'auto' }}>
        {/* Party size */}
        <div style={labelStyle}>{T(lang, 'reserve_party_label')}</div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            scrollbarWidth: 'none',
            paddingBottom: 4,
          }}
          data-testid="party-size-row"
        >
          {Array.from({ length: Math.min(maxParty, 20) }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => setPartySize(n)}
              style={{
                ...chipBase,
                minWidth: 48,
                height: 48,
                padding: 0,
                fontSize: 16,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                ...chipActive(partySize === n),
              }}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Date */}
        <div style={labelStyle}>{T(lang, 'reserve_date_label')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <button
            onClick={() => setDateChoice('today')}
            style={{
              ...chipBase,
              padding: '14px 8px',
              textAlign: 'center',
              ...chipActive(dateChoice === 'today'),
            }}
          >
            {T(lang, 'reserve_today')}
          </button>
          <button
            onClick={() => setDateChoice('tomorrow')}
            style={{
              ...chipBase,
              padding: '14px 8px',
              textAlign: 'center',
              ...chipActive(dateChoice === 'tomorrow'),
            }}
          >
            {T(lang, 'reserve_tomorrow')}
          </button>
          <button
            onClick={() => setDateChoice('other')}
            style={{
              ...chipBase,
              padding: '14px 8px',
              textAlign: 'center',
              ...chipActive(dateChoice === 'other'),
            }}
          >
            📅 {T(lang, 'reserve_other_date')}
          </button>
        </div>
        {dateChoice === 'other' && (
          <input
            type="date"
            value={customDate}
            min={ymd(new Date())}
            // Nu lăsăm clientul să aleagă o dată dincolo de fereastra permisă
            // (RPC-ul o respinge oricum). Fallback 30 zile dacă settings n-a venit.
            max={ymd(new Date(Date.now() + (settings?.max_advance_days ?? 30) * 86_400_000))}
            onChange={(e) => setCustomDate(e.target.value)}
            style={{ ...inputStyle, marginTop: 10 }}
          />
        )}

        {/* Zone (only if any zones defined) */}
        {zones.length > 0 && (
          <>
            <div style={labelStyle}>{T(lang, 'reserve_zone_label')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => setZone(null)}
                style={{ ...chipBase, ...chipActive(zone === null) }}
              >
                {T(lang, 'reserve_zone_any')}
              </button>
              {zones.map((z) => (
                <button
                  key={z}
                  onClick={() => setZone(z)}
                  style={{ ...chipBase, ...chipActive(zone === z) }}
                >
                  {z}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Time */}
        <div style={labelStyle}>{T(lang, 'reserve_time_label')}</div>
        {slots.length === 0 ? (
          <div style={{ fontSize: 13, color: PUB.text2, padding: '10px 0' }}>
            {T(lang, 'reserve_no_slots')}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              scrollbarWidth: 'none',
              paddingBottom: 4,
            }}
            data-testid="time-slot-row"
          >
            {slots.map((s) => (
              <button
                key={s}
                onClick={() => setTimeSlot(s)}
                style={{
                  ...chipBase,
                  fontVariantNumeric: 'tabular-nums',
                  ...chipActive(timeSlot === s),
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Placeholder cât timp se încarcă harta — evită saltul vizual când
            secțiunea „Alege masa" ar apărea brusc după fetch. */}
        {slot && mapLoading && !hasFloorMap && (
          <>
            <div style={labelStyle}>{T(lang, 'reserve_pick_table_label')}</div>
            <div
              aria-busy="true"
              aria-live="polite"
              style={{
                width: '100%',
                aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
                borderRadius: 12,
                border: `1px solid ${PUB.border}`,
                background: PUB.surface,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: PUB.text3,
                fontSize: 13,
              }}
            >
              {T(lang, 'reserve_map_loading')}
            </div>
          </>
        )}

        {/* Mesaj neblocant dacă harta n-a putut fi încărcată — fluxul cu
            alocare automată rămâne complet funcțional. */}
        {slot && mapError && !mapLoading && (
          <div
            role="status"
            style={{
              marginTop: 12,
              padding: '10px 14px',
              borderRadius: 10,
              background: PUB.surface,
              border: `1px solid ${PUB.border}`,
              color: PUB.text2,
              fontSize: 13,
            }}
          >
            {T(lang, 'reserve_map_error')}
          </div>
        )}

        {/* Alege masa pe hartă (opțional) — pur aditiv, apare doar dacă
            restaurantul are o hartă a sălii cu mese și e ales un slot. */}
        {hasFloorMap && floorLayout && (
          <>
            <div style={labelStyle}>{T(lang, 'reserve_pick_table_label')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <button
                onClick={() => setSelectedTableId(null)}
                style={{ ...chipBase, ...chipActive(selectedTableId === null) }}
              >
                {T(lang, 'reserve_any_free_table')}
              </button>
              {/* Confirmarea mesei alese, în afara SVG-ului, cu buton de deselectare. */}
              {selectedTable && (
                <span
                  style={{
                    ...chipBase,
                    ...chipActive(true),
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'default',
                  }}
                >
                  {`Masa ${selectedTable.name}`}
                  {selectedTable.seats != null
                    ? ` · ${selectedTable.seats} ${T(lang, 'reserve_seats_word')}`
                    : ''}
                  <button
                    type="button"
                    aria-label={T(lang, 'reserve_deselect_table')}
                    onClick={() => setSelectedTableId(null)}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      border: 'none',
                      background: 'rgba(255,255,255,0.28)',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 14,
                      lineHeight: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
            <div style={{ opacity: mapLoading ? 0.6 : 1, transition: 'opacity .15s' }}>
              <FloorPlanViewer
                layout={floorLayout}
                availabilityByTableId={availabilityByTableId}
                tablesByName={tablesByName}
                selectedTableId={selectedTableId}
                onSelectTable={(id) => setSelectedTableId(id)}
                onOccupiedTap={(tblLabel) =>
                  setOccupiedMsg(
                    lang === 'ro'
                      ? `Masa ${tblLabel} e deja rezervată la ora aleasă.`
                      : `Table ${tblLabel} is already booked at the selected time.`,
                  )
                }
                accent={accent}
                PUB={PUB}
                lang={lang}
              />
            </div>
            {/* Feedback efemer la atingerea unei mese ocupate. */}
            {occupiedMsg && (
              <div
                role="status"
                style={{
                  fontSize: 12,
                  color: PUB.text2,
                  marginTop: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: PUB.surface,
                  border: `1px solid ${PUB.border}`,
                }}
              >
                {occupiedMsg}
              </div>
            )}
            <div style={{ fontSize: 12, color: PUB.text3, marginTop: 8 }}>
              {T(lang, 'reserve_pick_table_hint')}
            </div>
          </>
        )}

        {/* Contact */}
        <div style={labelStyle}>{T(lang, 'reserve_contact_label')}</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={T(lang, 'reserve_name')}
          style={{ ...inputStyle, marginBottom: 10 }}
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={T(lang, 'reserve_phone')}
          type="tel"
          inputMode="tel"
          style={{ ...inputStyle, marginBottom: 10 }}
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={T(lang, 'reserve_email_opt')}
          type="email"
          inputMode="email"
          style={{ ...inputStyle, marginBottom: 10 }}
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={T(lang, 'reserve_notes_opt')}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
        />

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              borderRadius: 10,
              background: 'rgba(224,85,85,0.10)',
              border: '1px solid rgba(224,85,85,0.30)',
              color: '#E05555',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div
        style={{
          padding: '14px 22px calc(14px + env(safe-area-inset-bottom, 0px))',
          borderTop: `1px solid ${PUB.border}`,
          background: PUB.bg,
        }}
      >
        <button
          onClick={submit}
          disabled={submitting}
          style={{
            width: '100%',
            padding: '16px',
            background: accent,
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontFamily: theme.fonts.body,
            fontSize: 15,
            fontWeight: 700,
            cursor: submitting ? 'wait' : 'pointer',
            opacity: submitting ? 0.7 : 1,
            boxShadow: `0 4px 14px ${accent}55`,
          }}
        >
          {submitting ? T(lang, 'reserve_submitting') : T(lang, 'reserve_submit')}
        </button>
      </div>
    </SheetShell>
  )
}

interface ShellProps {
  onClose: () => void
  PUB: PubColors
  theme: MenuTheme
  accent: string
  title: string
  children: React.ReactNode
}

function SheetShell({ onClose, PUB, theme, accent, title, children }: ShellProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,18,8,0.55)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 160,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: PUB.bg,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Accent header bar */}
        <div
          style={{
            background: accent,
            color: '#fff',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderRadius: '20px 20px 0 0',
          }}
        >
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#fff',
              color: accent,
              border: 'none',
              fontSize: 18,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
            }}
          >
            ×
          </button>
          <div
            style={{
              flex: 1,
              fontFamily: theme.fonts.heading,
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

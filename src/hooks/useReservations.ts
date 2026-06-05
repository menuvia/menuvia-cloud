import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pickAllowed } from '../lib/sanitize'
import { playSound } from '../lib/utils'

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type ReservationSource =
  | 'public'
  | 'phone'
  | 'google'
  | 'widget'
  | 'walk_in'
  | 'dashboard'

export interface Reservation {
  id: string
  restaurant_id: string
  table_id: string | null
  customer_name: string
  customer_phone: string
  customer_email: string | null
  party_size: number
  special_requests: string | null
  starts_at: string
  ends_at: string
  status: ReservationStatus
  source: ReservationSource
  reminder_sent_at: string | null
  confirmation_code: string
  requested_zone: string | null
  created_at: string
  updated_at: string
  table?: { id: string; name: string; seats: number | null; zone: string | null } | null
}

export interface ReservationSettings {
  id: string
  restaurant_id: string
  open_days: number[]
  open_time: string
  close_time: string
  slot_interval: number
  reservation_duration: number
  min_advance_hours: number
  max_advance_days: number
  max_party_size: number
  auto_confirm: boolean
  reminder_hours_before: number
}

export interface DateRange {
  from: string
  to: string
}

const RESERVATION_SETTINGS_UPDATE_FIELDS = [
  'open_days',
  'open_time',
  'close_time',
  'slot_interval',
  'reservation_duration',
  'min_advance_hours',
  'max_advance_days',
  'max_party_size',
  'auto_confirm',
  'reminder_hours_before',
] as const satisfies readonly (keyof ReservationSettings)[]

export function useReservations(restaurantId: string | null, range: DateRange) {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // ID-urile rezervărilor cunoscute din primul fetch — evită playSound la
  // events de catch-up când socket-ul se conectează (replay events care
  // sunau ca rezervări noi pentru rezervări deja vizibile).
  const knownIdsRef = useRef<Set<string>>(new Set())

  const fetchReservations = useCallback(async () => {
    if (!restaurantId) {
      setReservations([])
      knownIdsRef.current = new Set()
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: e } = await supabase
      .from('reservations')
      .select('*, table:tables(id,name,seats,zone)')
      .eq('restaurant_id', restaurantId)
      .gte('starts_at', range.from)
      .lte('starts_at', range.to)
      .order('starts_at', { ascending: true })
    if (e) {
      setError(e.message)
      setReservations([])
    } else {
      const rows = (data ?? []) as Reservation[]
      setReservations(rows)
      // Repopulează cache de ID-uri pe fiecare fetch (păstrează vechiul +
      // adaugă noile rezervări vizibile fără să facă sunet retroactiv).
      for (const r of rows) knownIdsRef.current.add(r.id)
    }
    setLoading(false)
  }, [restaurantId, range.from, range.to])

  useEffect(() => {
    void fetchReservations()
  }, [fetchReservations])

  useEffect(() => {
    if (!restaurantId) return
    const ch = supabase
      .channel(`reservations:${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          // Sunet DOAR pentru rezervare cu adevărat nouă: INSERT și ID
          // necunoscut. Evită beep retroactiv pe replay/catch-up și pe
          // INSERT-uri care ne-au ajuns deja prin fetch.
          if (payload.eventType === 'INSERT') {
            const id = (payload.new as { id?: string } | null)?.id
            if (id && !knownIdsRef.current.has(id)) {
              knownIdsRef.current.add(id)
              playSound(880, 140)
            }
          }
          void fetchReservations()
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [restaurantId, fetchReservations])

  const updateStatus = useCallback(
    async (id: string, status: ReservationStatus) => {
      const prev = reservations
      setReservations(p => p.map(r => (r.id === id ? { ...r, status } : r)))
      const { error: e } = await supabase
        .from('reservations')
        .update({ status })
        .eq('id', id)
      if (e) {
        setReservations(prev)
        throw new Error(e.message)
      }
    },
    [reservations],
  )

  const assignTable = useCallback(
    async (id: string, tableId: string | null) => {
      const { error: e } = await supabase
        .from('reservations')
        .update({ table_id: tableId })
        .eq('id', id)
      if (e) throw new Error(e.message)
      await fetchReservations()
    },
    [fetchReservations],
  )

  // Combinat: alocă masa + marchează seated într-un singur update (evită
  // 2 round-trips și starea intermediară). Folosit de ospătar la sosire.
  // `tableId` e OBLIGATORIU non-null la apel — semantica „seated" cere masă;
  // caller-ul (WaiterPage) blochează butonul când nu există masă selectată.
  const seat = useCallback(
    async (id: string, tableId: string) => {
      if (!tableId) throw new Error('Masă obligatorie pentru a marca rezervarea ca așezată')
      const patch = { status: 'seated' as ReservationStatus, table_id: tableId }
      const prev = reservations
      setReservations(p => p.map(r => (r.id === id ? { ...r, ...patch } : r)))
      const { error: e } = await supabase.from('reservations').update(patch).eq('id', id)
      if (e) {
        setReservations(prev)
        throw new Error(e.message)
      }
    },
    [reservations],
  )

  return {
    reservations,
    loading,
    error,
    refetch: fetchReservations,
    updateStatus,
    assignTable,
    seat,
  }
}

export function useReservationSettings(restaurantId: string | null) {
  const [settings, setSettings] = useState<ReservationSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    if (!restaurantId) {
      setSettings(null)
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: e } = await supabase
      .from('reservation_settings')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single()
    if (e) {
      setError(e.message)
      setSettings(null)
    } else {
      setSettings(data as ReservationSettings)
    }
    setLoading(false)
  }, [restaurantId])

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  const save = useCallback(
    async (patch: Partial<ReservationSettings>) => {
      if (!restaurantId) return
      const clean = pickAllowed(patch, RESERVATION_SETTINGS_UPDATE_FIELDS)
      const { data, error: e } = await supabase
        .from('reservation_settings')
        .update(clean)
        .eq('restaurant_id', restaurantId)
        .select()
        .single()
      if (e) throw new Error(e.message)
      setSettings(data as ReservationSettings)
    },
    [restaurantId],
  )

  return { settings, loading, error, save, refetch: fetchSettings }
}

export function useTableZones(restaurantId: string | null) {
  const [zones, setZones] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const fetchZones = useCallback(async () => {
    if (!restaurantId) {
      setZones([])
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('tables')
      .select('zone')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .not('zone', 'is', null)
    const unique = Array.from(
      new Set(((data ?? []) as { zone: string | null }[]).map(r => r.zone).filter(Boolean) as string[]),
    ).sort((a, b) => a.localeCompare(b, 'ro'))
    setZones(unique)
    setLoading(false)
  }, [restaurantId])

  useEffect(() => {
    void fetchZones()
  }, [fetchZones])

  return { zones, loading, refetch: fetchZones }
}

export function dayRange(date: Date): DateRange {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function weekRange(from: Date): DateRange {
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const end = new Date(from)
  end.setDate(end.getDate() + 7)
  end.setHours(23, 59, 59, 999)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function useDateRange(initial: DateRange) {
  const [range, setRange] = useState<DateRange>(initial)
  const setToday = useCallback(() => setRange(dayRange(new Date())), [])
  const setTomorrow = useCallback(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    setRange(dayRange(d))
  }, [])
  const setWeek = useCallback(() => setRange(weekRange(new Date())), [])
  const setSpecificDate = useCallback((date: Date) => setRange(dayRange(date)), [])
  return useMemo(
    () => ({ range, setToday, setTomorrow, setWeek, setSpecificDate, setRange }),
    [range, setToday, setTomorrow, setWeek, setSpecificDate],
  )
}

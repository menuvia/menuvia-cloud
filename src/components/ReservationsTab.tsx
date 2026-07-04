// Reservations admin tab — list, filter, status flow + settings card.
// Owner/manager only (RLS).
import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { D } from '../lib/constants'
import {
  useReservations,
  useReservationSettings,
  useDateRange,
  dayRange,
  weekRange,
  type Reservation,
  type ReservationStatus,
  type ReservationSettings,
} from '../hooks/useReservations'
import { Skeleton } from './ui/Skeleton'
import { EmptyState } from './ui/EmptyState'
import { Icon } from './ui/Icon'
import { useToast } from './ui/useToast'

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: 'În așteptare',
  confirmed: 'Confirmată',
  seated: 'Așezat',
  completed: 'Finalizată',
  cancelled: 'Anulată',
  no_show: 'No-show',
}

const STATUS_COLOR: Record<ReservationStatus, { bg: string; fg: string }> = {
  pending: { bg: 'rgba(232,160,32,0.14)', fg: D.amber },
  confirmed: { bg: 'rgba(200,150,60,0.12)', fg: D.gold },
  seated: { bg: 'rgba(76,175,110,0.14)', fg: D.green },
  completed: { bg: D.s2, fg: D.t3 },
  cancelled: { bg: 'rgba(224,85,85,0.10)', fg: D.red },
  no_show: { bg: 'rgba(224,85,85,0.10)', fg: D.red },
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('ro-RO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ro-RO', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function groupByDay(reservations: Reservation[]): Map<string, Reservation[]> {
  const map = new Map<string, Reservation[]>()
  for (const r of reservations) {
    const key = r.starts_at.slice(0, 10)
    const list = map.get(key)
    if (list) list.push(r)
    else map.set(key, [r])
  }
  return map
}

interface Props {
  restaurantId: string
}

export default function ReservationsTab({ restaurantId }: Props) {
  const { range, setToday, setTomorrow, setWeek, setSpecificDate } = useDateRange(
    dayRange(new Date()),
  )
  const [pendingOnly, setPendingOnly] = useState(false)
  const { reservations, loading, error, refetch, updateStatus } = useReservations(
    restaurantId,
    range,
  )
  const toast = useToast()

  // Care preset de interval e activ acum — ca să evidențiem chip-ul corect
  // (patronul trebuie să vadă ce filtru e aplicat, nu doar să apese orbește).
  const activeRangeKey = useMemo<'today' | 'tomorrow' | 'week' | 'custom'>(() => {
    const now = new Date()
    const tomorrow = new Date(now.getTime() + 86400000)
    const today = dayRange(now)
    const tmr = dayRange(tomorrow)
    const wk = weekRange(now)
    if (range.from === today.from && range.to === today.to) return 'today'
    if (range.from === tmr.from && range.to === tmr.to) return 'tomorrow'
    if (range.from === wk.from && range.to === wk.to) return 'week'
    return 'custom'
  }, [range])

  const filtered = useMemo(() => {
    if (!pendingOnly) return reservations
    return reservations.filter((r) => r.status === 'pending')
  }, [reservations, pendingOnly])

  const grouped = useMemo(() => groupByDay(filtered), [filtered])

  const handleStatus = useCallback(
    async (id: string, status: ReservationStatus, label: string) => {
      try {
        await updateStatus(id, status)
        toast.success(label)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Eroare actualizare')
      }
    },
    [updateStatus, toast],
  )

  return (
    <div style={{ padding: 20, color: D.t1 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <h2
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 28,
            fontWeight: 600,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          Rezervări
        </h2>
        <div style={{ fontSize: 13, color: D.t2 }}>
          {filtered.length} {filtered.length === 1 ? 'rezervare' : 'rezervări'} în interval
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <FilterChip onClick={setToday} active={activeRangeKey === 'today'}>
          Azi
        </FilterChip>
        <FilterChip onClick={setTomorrow} active={activeRangeKey === 'tomorrow'}>
          Mâine
        </FilterChip>
        <FilterChip onClick={setWeek} active={activeRangeKey === 'week'}>
          Săptămâna asta
        </FilterChip>
        <input
          type="date"
          onChange={(e) => {
            if (e.target.value) {
              const [y, mo, d] = e.target.value.split('-').map(Number)
              setSpecificDate(new Date(y!, mo! - 1, d!))
            }
          }}
          style={{
            // Țintă tactilă ≥44px, aliniat cu chip-urile și butoanele.
            minHeight: 44,
            padding: '8px 12px',
            border: `1px solid ${activeRangeKey === 'custom' ? D.gold : D.border}`,
            borderRadius: 8,
            background: D.s3,
            color: D.t1,
            fontSize: 13,
            outline: 'none',
          }}
        />
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 44,
            padding: '8px 12px',
            border: `1px solid ${D.border}`,
            borderRadius: 8,
            background: pendingOnly ? D.s2 : D.s3,
            cursor: 'pointer',
            fontSize: 13,
            color: D.t2,
          }}
        >
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => setPendingOnly(e.target.checked)}
            style={{ margin: 0 }}
          />
          Doar pending
        </label>
        <button
          onClick={() => void refetch()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 44,
            padding: '8px 12px',
            border: `1px solid ${D.border}`,
            borderRadius: 8,
            background: D.s3,
            color: D.t2,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          <Icon name="refresh" size={15} />
          Reîmprospătează
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: 'rgba(224,85,85,0.08)',
            border: '1px solid rgba(224,85,85,0.20)',
            color: D.red,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Nicio rezervare în intervalul ales"
          description="Schimbă filtrul de dată sau verifică setările"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {[...grouped.entries()].map(([dayKey, list]) => (
            <div key={dayKey}>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: D.t2,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  margin: '0 0 10px',
                }}
              >
                {formatDay(list[0]!.starts_at)}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.map((r) => (
                  <ReservationCard
                    key={r.id}
                    r={r}
                    onConfirm={() => handleStatus(r.id, 'confirmed', 'Rezervare confirmată')}
                    onSeated={() => handleStatus(r.id, 'seated', 'Marcat ca așezat')}
                    onCancel={() => handleStatus(r.id, 'cancelled', 'Rezervare anulată')}
                    onNoShow={() => handleStatus(r.id, 'no_show', 'Marcat ca no-show')}
                    onComplete={() => handleStatus(r.id, 'completed', 'Rezervare finalizată')}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <SettingsSection restaurantId={restaurantId} />
    </div>
  )
}

function FilterChip({
  children,
  onClick,
  active = false,
}: {
  children: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        // Țintă tactilă ≥44px (aliniat cu ActionButton-urile din card).
        minHeight: 44,
        padding: '8px 14px',
        // Chip-ul activ e evidențiat clar (fundal + bordură + weight), ca patronul
        // să vadă ce interval e aplicat.
        border: `1px solid ${active ? D.gold : D.border}`,
        borderRadius: 100,
        background: active ? D.s2 : D.s3,
        color: active ? D.t1 : D.t2,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
      }}
    >
      {children}
    </button>
  )
}

interface CardProps {
  r: Reservation
  onConfirm: () => void
  onSeated: () => void
  onCancel: () => void
  onNoShow: () => void
  onComplete: () => void
}

function ReservationCard({ r, onConfirm, onSeated, onCancel, onNoShow, onComplete }: CardProps) {
  const status = STATUS_COLOR[r.status]
  return (
    <div
      style={{
        padding: 14,
        border: `1px solid ${D.border}`,
        borderRadius: 12,
        background: D.s2,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 8,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 22,
            fontWeight: 600,
            color: D.t1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatTime(r.starts_at)}
        </div>
        <div style={{ fontSize: 14, color: D.t1, fontWeight: 500 }}>{r.customer_name}</div>
        <div style={{ fontSize: 13, color: D.t2 }}>
          · {r.party_size} {r.party_size === 1 ? 'persoană' : 'persoane'}
        </div>
        {r.table && (
          <div style={{ fontSize: 12, color: D.t2 }}>
            · {r.table.name}
            {r.table.zone ? ' (' + r.table.zone + ')' : ''}
          </div>
        )}
        <div
          style={{
            marginLeft: 'auto',
            padding: '4px 10px',
            borderRadius: 100,
            background: status.bg,
            color: status.fg,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {STATUS_LABEL[r.status]}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          fontSize: 12,
          color: D.t2,
          marginBottom: 10,
        }}
      >
        <a
          href={'tel:' + r.customer_phone}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            color: D.t2,
            textDecoration: 'none',
            // flexWrap mută doar item-uri ÎNTREGI pe rândul următor; valorile
            // lungi neîntrerupte (email) au nevoie și de break la nivel de item.
            overflowWrap: 'anywhere',
            minWidth: 0,
          }}
        >
          <Icon name="phone" size={13} />
          {r.customer_phone}
        </a>
        {r.customer_email && (
          <a
            href={'mailto:' + r.customer_email}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              color: D.t2,
              textDecoration: 'none',
              overflowWrap: 'anywhere',
              minWidth: 0,
            }}
          >
            <Icon name="mail" size={13} />
            {r.customer_email}
          </a>
        )}
        <span style={{ color: D.t3, fontFamily: 'monospace' }}>{r.confirmation_code}</span>
      </div>
      {r.special_requests && (
        <div
          style={{
            fontSize: 13,
            color: D.t2,
            fontStyle: 'italic',
            padding: '8px 10px',
            background: D.s3,
            borderRadius: 8,
            marginBottom: 10,
          }}
        >
          "{r.special_requests}"
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {r.status === 'pending' && <ActionButton onClick={onConfirm}>Confirmă</ActionButton>}
        {(r.status === 'pending' || r.status === 'confirmed') && (
          <ActionButton onClick={onSeated}>Așezat</ActionButton>
        )}
        {r.status === 'seated' && <ActionButton onClick={onComplete}>Finalizează</ActionButton>}
        {r.status === 'confirmed' && (
          <ActionButton onClick={onNoShow} danger>
            No-show
          </ActionButton>
        )}
        {r.status !== 'cancelled' && r.status !== 'completed' && r.status !== 'no_show' && (
          <ActionButton onClick={onCancel} danger>
            Anulează
          </ActionButton>
        )}
      </div>
    </div>
  )
}

function ActionButton({
  children,
  onClick,
  danger,
}: {
  children: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="pressable"
      style={{
        // Touch target ≥44px (butoanele de tranziție se apasă din picioare, pe telefon).
        padding: '10px 16px',
        minHeight: 44,
        border: `1px solid ${danger ? 'rgba(224,85,85,0.30)' : D.border}`,
        borderRadius: 10,
        background: danger ? 'rgba(224,85,85,0.08)' : D.s3,
        color: danger ? D.red : D.t1,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  )
}

// ── Settings section (collapsible) ───────────────────────────
function SettingsSection({ restaurantId }: { restaurantId: string }) {
  const { settings, loading, save } = useReservationSettings(restaurantId)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Partial<ReservationSettings>>({})
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const merged: ReservationSettings | null = useMemo(() => {
    if (!settings) return null
    return { ...settings, ...draft }
  }, [settings, draft])

  const onSave = useCallback(async () => {
    if (!merged) return
    setSaving(true)
    try {
      await save(draft)
      setDraft({})
      toast.success('Setări salvate')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Eroare salvare')
    } finally {
      setSaving(false)
    }
  }, [save, draft, merged, toast])

  if (loading || !merged) {
    return (
      <div style={{ marginTop: 32 }}>
        <Skeleton variant="card" />
      </div>
    )
  }

  return (
    <div
      style={{
        marginTop: 32,
        border: `1px solid ${D.border}`,
        borderRadius: 12,
        background: D.s2,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'transparent',
          border: 'none',
          color: D.t1,
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="settings" size={16} />
          Setări rezervări
        </span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} color={D.t2} />
      </button>
      {open && (
        <div
          style={{
            padding: '0 16px 18px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 14,
          }}
        >
          <SettingField label="Ora deschidere">
            <input
              type="time"
              value={merged.open_time?.slice(0, 5) ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, open_time: e.target.value }))}
              style={settingsInputStyle}
            />
          </SettingField>
          <SettingField label="Ora închidere">
            <input
              type="time"
              value={merged.close_time?.slice(0, 5) ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, close_time: e.target.value }))}
              style={settingsInputStyle}
            />
          </SettingField>
          <SettingField label="Interval slot (min)">
            <select
              value={merged.slot_interval}
              onChange={(e) => setDraft((d) => ({ ...d, slot_interval: Number(e.target.value) }))}
              style={settingsInputStyle}
            >
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
            </select>
          </SettingField>
          <SettingField label="Durata rezervării (min)">
            <select
              value={merged.reservation_duration}
              onChange={(e) =>
                setDraft((d) => ({ ...d, reservation_duration: Number(e.target.value) }))
              }
              style={settingsInputStyle}
            >
              <option value={60}>60</option>
              <option value={90}>90</option>
              <option value={120}>120</option>
              <option value={180}>180</option>
            </select>
          </SettingField>
          <SettingField label="Rezervare cu minim (ore înainte)">
            <input
              type="number"
              min={0}
              max={72}
              value={merged.min_advance_hours}
              onChange={(e) =>
                setDraft((d) => ({ ...d, min_advance_hours: Number(e.target.value) }))
              }
              style={settingsInputStyle}
            />
          </SettingField>
          <SettingField label="Se poate rezerva cu maxim (zile înainte)">
            <input
              type="number"
              min={1}
              max={90}
              value={merged.max_advance_days}
              onChange={(e) =>
                setDraft((d) => ({ ...d, max_advance_days: Number(e.target.value) }))
              }
              style={settingsInputStyle}
            />
          </SettingField>
          <SettingField label="Max persoane / rezervare">
            <input
              type="number"
              min={1}
              max={50}
              value={merged.max_party_size}
              onChange={(e) => setDraft((d) => ({ ...d, max_party_size: Number(e.target.value) }))}
              style={settingsInputStyle}
            />
          </SettingField>
          <SettingField label="Reminder cu (ore înainte)">
            <select
              value={merged.reminder_hours_before}
              onChange={(e) =>
                setDraft((d) => ({ ...d, reminder_hours_before: Number(e.target.value) }))
              }
              style={settingsInputStyle}
            >
              <option value={0}>Fără</option>
              <option value={6}>6h</option>
              <option value={12}>12h</option>
              <option value={24}>24h</option>
              <option value={48}>48h</option>
            </select>
          </SettingField>
          <SettingField label="Confirmare automată">
            <label
              style={{
                display: 'inline-flex',
                gap: 8,
                alignItems: 'center',
                color: D.t1,
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={merged.auto_confirm}
                onChange={(e) => setDraft((d) => ({ ...d, auto_confirm: e.target.checked }))}
              />
              {merged.auto_confirm ? 'Activat' : 'Dezactivat'}
            </label>
          </SettingField>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => void onSave()}
              disabled={saving || Object.keys(draft).length === 0}
              style={{
                padding: '10px 18px',
                background: D.gold,
                color: '#000',
                border: 'none',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? 'wait' : 'pointer',
                opacity: Object.keys(draft).length === 0 ? 0.5 : 1,
              }}
            >
              {saving ? 'Se salvează...' : 'Salvează setări'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const settingsInputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: `1px solid ${D.border}`,
  borderRadius: 8,
  background: D.s3,
  color: D.t1,
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

function SettingField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.06em',
          fontWeight: 600,
          color: D.t2,
          marginBottom: 6,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

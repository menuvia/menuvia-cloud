// ─────────────────────────────────────────────────────────────
// WaiterAssignments — Alocare mese pe ospătari
// Owner/Manager alocă mesele restaurantului pe ospătari activi.
// Fiecare ospătar vede pe telefon DOAR comenzile de la mesele lui.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { D } from '../lib/constants'
import { QueryError } from './PageLoader'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'

interface Props {
  restaurantId: string
}

interface WaiterMember {
  user_id: string
  role: string
  profile: { full_name: string | null; email: string | null } | null
}
interface Table {
  id: string
  name: string
  seats: number | null
}

// ─── Shared styles ─────────────────────────────────────────────
const sLabel: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  color: D.t2,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 8,
}
const sCard: React.CSSProperties = {
  background: D.s2,
  border: `1px solid ${D.border}`,
  borderRadius: 12,
  overflow: 'hidden',
}

function initials(name: string | null | undefined, email: string) {
  if (name)
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  return email.slice(0, 2).toUpperCase()
}

function displayName(m: WaiterMember) {
  return m.profile?.full_name || m.profile?.email || m.user_id.slice(0, 8)
}

export default function WaiterAssignments({ restaurantId }: Props) {
  const { user } = useAuth()
  const [waiters, setWaiters] = useState<WaiterMember[]>([])
  const [tables, setTables] = useState<Table[]>([])
  // Map: user_id → Set<table_id>
  const [assignments, setAssignments] = useState<Map<string, Set<string>>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null) // user_id being saved
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [membRes, tabRes, assignRes] = await Promise.all([
        // Membri waiter/manager — FĂRĂ embed pe profiles. Embed-ul
        // `profile:profiles(...)` depinde de relația PostgREST, care poate eșua
        // după lockdown-ul de autorizare (mig 096) → arunca „Eroare la încărcare"
        // pe tot tab-ul. Luăm profilurile separat (vezi mai jos), non-fatal.
        supabase
          .from('restaurant_memberships')
          .select('user_id, role')
          .eq('restaurant_id', restaurantId)
          .in('role', ['waiter', 'manager']),
        // All active tables
        supabase
          .from('tables')
          .select('id, name, seats')
          .eq('restaurant_id', restaurantId)
          .eq('is_active', true)
          .order('name'),
        // Current assignments
        supabase
          .from('waiter_table_assignments')
          .select('user_id, table_id')
          .eq('restaurant_id', restaurantId),
      ])

      if (membRes.error) throw membRes.error
      if (tabRes.error) throw tabRes.error
      if (assignRes.error) throw assignRes.error

      const memberRows = (membRes.data ?? []) as { user_id: string; role: string }[]

      // Profiluri (nume/email pt afișare) — interogare separată. Dacă eșuează
      // (RLS pe profiluri etc.), NU blocăm pagina: cădem pe fallback fără nume.
      const userIds = memberRows.map((m) => m.user_id)
      const profileMap = new Map<string, { full_name: string | null; email: string | null }>()
      if (userIds.length > 0) {
        const profRes = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', userIds)
        for (const p of (profRes.data ?? []) as Array<{
          id: string
          full_name: string | null
          email: string | null
        }>) {
          profileMap.set(p.id, { full_name: p.full_name, email: p.email })
        }
      }

      const waiterList = memberRows.map((m) => ({
        user_id: m.user_id,
        role: m.role,
        profile: profileMap.get(m.user_id) ?? null,
      }))
      setWaiters(waiterList)
      setTables((tabRes.data ?? []) as Table[])

      // Build assignment map
      const map = new Map<string, Set<string>>()
      for (const w of waiterList) map.set(w.user_id, new Set())
      for (const a of (assignRes.data ?? []) as { user_id: string; table_id: string }[]) {
        map.get(a.user_id)?.add(a.table_id)
      }
      setAssignments(map)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare')
    }
    setLoading(false)
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  // Toggle a table assignment for a waiter
  const toggle = async (waiterUserId: string, tableId: string) => {
    const current = assignments.get(waiterUserId) ?? new Set()
    const isAssigned = current.has(tableId)
    setSaving(waiterUserId)

    // Optimistic update
    const next = new Map(assignments)
    const newSet = new Set(current)
    isAssigned ? newSet.delete(tableId) : newSet.add(tableId)
    next.set(waiterUserId, newSet)
    setAssignments(next)

    try {
      if (isAssigned) {
        // Remove
        const { error } = await supabase
          .from('waiter_table_assignments')
          .delete()
          .eq('user_id', waiterUserId)
          .eq('table_id', tableId)
          .eq('restaurant_id', restaurantId)
        if (error) throw error
      } else {
        // Add
        const { error } = await supabase.from('waiter_table_assignments').upsert(
          {
            user_id: waiterUserId,
            table_id: tableId,
            restaurant_id: restaurantId,
            assigned_by: user?.id ?? null,
          },
          { onConflict: 'user_id,table_id' },
        )
        if (error) throw error
      }
      showToast(isAssigned ? 'Masă eliminată' : 'Masă alocată')
    } catch (e: unknown) {
      // Rollback
      const rollback = new Map(assignments)
      rollback.set(waiterUserId, current)
      setAssignments(rollback)
      setError(e instanceof Error ? e.message : 'Eroare')
    }
    setSaving(null)
  }

  // Clear ALL assignments for a waiter (show all orders)
  const clearWaiter = async (waiterUserId: string) => {
    setSaving(waiterUserId)
    const prev = new Map(assignments)
    const next = new Map(assignments)
    next.set(waiterUserId, new Set())
    setAssignments(next)
    try {
      const { error } = await supabase
        .from('waiter_table_assignments')
        .delete()
        .eq('user_id', waiterUserId)
        .eq('restaurant_id', restaurantId)
      if (error) throw error
      showToast('Alocări eliminate — ospătarul vede toate mesele')
    } catch (e: unknown) {
      setAssignments(prev)
      setError(e instanceof Error ? e.message : 'Eroare')
    }
    setSaving(null)
  }

  // Assign ALL tables to a waiter
  const assignAll = async (waiterUserId: string) => {
    setSaving(waiterUserId)
    const prev = new Map(assignments)
    const next = new Map(assignments)
    next.set(waiterUserId, new Set(tables.map((t) => t.id)))
    setAssignments(next)
    try {
      const rows = tables.map((t) => ({
        user_id: waiterUserId,
        table_id: t.id,
        restaurant_id: restaurantId,
        assigned_by: user?.id ?? null,
      }))
      const { error } = await supabase
        .from('waiter_table_assignments')
        .upsert(rows, { onConflict: 'user_id,table_id' })
      if (error) throw error
      showToast('Toate mesele alocate')
    } catch (e: unknown) {
      setAssignments(prev)
      setError(e instanceof Error ? e.message : 'Eroare')
    }
    setSaving(null)
  }

  if (loading)
    return (
      <div>
        <h2
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.5rem',
            color: D.t1,
            marginBottom: 20,
          }}
        >
          Ture & Alocări
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Skeleton variant="card" count={2} />
        </div>
      </div>
    )

  if (error)
    return (
      <div>
        <h2
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.5rem',
            color: D.t1,
            marginBottom: 20,
          }}
        >
          Ture & Alocări
        </h2>
        <QueryError message={error} onRetry={load} />
      </div>
    )

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.5rem',
            color: D.t1,
            letterSpacing: '-0.02em',
          }}
        >
          Ture & Alocări
        </h2>
        <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>
          Alocă mesele pe ospătari — fiecare ospătar vede pe telefon doar comenzile lui
        </p>
      </div>

      {/* Legend */}
      <div
        style={{
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 10,
          padding: '10px 14px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <span style={{ flexShrink: 0, marginTop: 1, color: D.gold }}>
          <Icon name="info" size={16} />
        </span>
        <div style={{ fontSize: '0.78rem', color: D.t2, lineHeight: 1.7 }}>
          <strong style={{ color: D.t1 }}>Fără alocare</strong> — ospătarul vede toate comenzile
          (comportament implicit).
          <br />
          <strong style={{ color: D.t1 }}>Cu alocare</strong> — ospătarul vede DOAR comenzile de la
          mesele lui alocate.
        </div>
      </div>

      {waiters.length === 0 ? (
        <EmptyState
          icon="users"
          title="Niciun ospătar adăugat."
          description={
            <>
              Adaugă membri din tab-ul <strong style={{ color: D.t1 }}>Echipă</strong>.
            </>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {waiters.map((waiter) => {
            const assigned = assignments.get(waiter.user_id) ?? new Set()
            const isSaving = saving === waiter.user_id
            const hasAssignments = assigned.size > 0
            const name = displayName(waiter)

            return (
              <div key={waiter.user_id} style={sCard}>
                {/* Waiter header */}
                <div
                  style={{
                    padding: '14px 18px',
                    borderBottom: `1px solid ${D.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Avatar */}
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: D.goldA,
                        border: `1px solid ${D.gold}44`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'Fraunces,serif',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        color: D.gold,
                        flexShrink: 0,
                      }}
                    >
                      {initials(waiter.profile?.full_name, waiter.profile?.email ?? '')}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: D.t1 }}>{name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            background: D.s3,
                            color: D.t3,
                            padding: '1px 7px',
                            borderRadius: 4,
                            fontWeight: 500,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {waiter.role}
                        </span>
                        {hasAssignments ? (
                          <span style={{ fontSize: '0.72rem', color: D.gold }}>
                            {assigned.size} mese alocate
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: D.t3 }}>
                            Toate mesele (nicio alocare)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quick actions */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    {hasAssignments && (
                      <button
                        onClick={() => void clearWaiter(waiter.user_id)}
                        disabled={isSaving}
                        style={{
                          padding: '5px 12px',
                          fontSize: '0.75rem',
                          fontFamily: 'DM Sans,sans-serif',
                          borderRadius: 7,
                          border: `1px solid ${D.border}`,
                          background: 'transparent',
                          color: D.t3,
                          cursor: 'pointer',
                          opacity: isSaving ? 0.5 : 1,
                        }}
                      >
                        Șterge toate
                      </button>
                    )}
                    <button
                      onClick={() => void assignAll(waiter.user_id)}
                      disabled={isSaving || assigned.size === tables.length}
                      style={{
                        padding: '5px 12px',
                        fontSize: '0.75rem',
                        fontFamily: 'DM Sans,sans-serif',
                        borderRadius: 7,
                        border: `1px solid ${D.gold}44`,
                        background: D.goldA,
                        color: D.goldL,
                        cursor: 'pointer',
                        opacity: isSaving || assigned.size === tables.length ? 0.5 : 1,
                        fontWeight: 600,
                      }}
                    >
                      Toate mesele
                    </button>
                  </div>
                </div>

                {/* Tables grid */}
                <div style={{ padding: '12px 18px' }}>
                  <div style={sLabel}>Click pe masă pentru a aloca / dealoca</div>
                  {tables.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: D.t3 }}>Nicio masă activă.</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                      {tables.map((table) => {
                        const isAssigned = assigned.has(table.id)
                        return (
                          <button
                            key={table.id}
                            onClick={() => void toggle(waiter.user_id, table.id)}
                            disabled={isSaving}
                            title={`${table.name}${table.seats ? ` · ${table.seats} loc.` : ''}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '6px 12px',
                              borderRadius: 8,
                              cursor: isSaving ? 'wait' : 'pointer',
                              fontFamily: 'DM Sans,sans-serif',
                              fontSize: '0.82rem',
                              fontWeight: isAssigned ? 700 : 400,
                              border: `2px solid ${isAssigned ? D.gold : D.border}`,
                              background: isAssigned ? D.goldA : 'transparent',
                              color: isAssigned ? D.gold : D.t3,
                              transition: 'all .15s',
                              outline: 'none',
                              opacity: isSaving ? 0.6 : 1,
                            }}
                          >
                            <Icon name="table" size={14} />
                            {table.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 80,
            right: 16,
            zIndex: 9999,
            background: D.s2,
            borderLeft: `3px solid ${D.green}`,
            borderRadius: 10,
            padding: '10px 16px',
            fontSize: '0.875rem',
            color: D.t1,
            boxShadow: '0 8px 32px rgba(0,0,0,.4)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="check" size={15} color={D.green} />
          {toast}
        </div>
      )}
    </div>
  )
}

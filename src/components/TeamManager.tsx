import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import type { MemberRole } from '../lib/constants'
import type { Restaurant } from '../hooks/useData'

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  waiter: 'Ospătar',
  kitchen: 'Bucătărie',
}
const ROLE_COLORS: Record<MemberRole, string> = {
  owner: D.gold,
  manager: D.goldL,
  waiter: '#7EB8F7',
  kitchen: D.green,
}

const btn = (e: React.CSSProperties = {}): React.CSSProperties => ({
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
  whiteSpace: 'nowrap',
  ...e,
})
const inp: React.CSSProperties = {
  width: '100%',
  background: D.s3,
  border: `1px solid ${D.border}`,
  borderRadius: 9,
  padding: '10px 13px',
  fontSize: '0.9rem',
  color: D.t1,
  outline: 'none',
  fontFamily: 'DM Sans,sans-serif',
  boxSizing: 'border-box',
}

function useToast() {
  const [toasts, setToasts] = useState<{ id: string; msg: string; type: string }[]>([])
  const toast = useCallback((msg: string, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
  }, [])
  return { toasts, toast }
}
function Toast({ toasts }: { toasts: { id: string; msg: string; type: string }[] }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: D.s3,
            borderLeft: `3px solid ${t.type === 'error' ? D.red : D.green}`,
            borderRadius: 10,
            padding: '10px 16px',
            fontSize: '0.875rem',
            color: D.t1,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            minWidth: 220,
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

interface Member {
  id: string
  role: MemberRole
  joined_at: string
  user: { id: string; email: string; full_name: string | null } | null
}
interface Invite {
  id: string
  email: string
  role: MemberRole
  created_at: string
  expires_at: string
}

export default function TeamManager({
  restaurant,
  currentUserId,
}: {
  restaurant: Restaurant
  currentUserId: string
}) {
  const { toasts, toast } = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Exclude<MemberRole, 'owner'>>('waiter')
  const [sending, setSending] = useState(false)
  const [invErr, setInvErr] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [mr, ir] = await Promise.all([
        supabase
          .from('restaurant_memberships')
          .select('id,role,joined_at,user:profiles(id,email,full_name)')
          .eq('restaurant_id', restaurant.id)
          .order('joined_at'),
        supabase
          .from('invite_tokens')
          .select('id,email,role,created_at,expires_at')
          .eq('restaurant_id', restaurant.id)
          .is('accepted_at', null)
          .gt('expires_at', new Date().toISOString()),
      ])
      setMembers((mr.data || []) as unknown as Member[])
      setInvites((ir.data || []) as unknown as Invite[])
    } catch (err) {
      console.error('[TeamManager] load error:', err)
      toast('Nu s-a putut încărca echipa', 'error')
    }
    setLoading(false)
  }, [restaurant.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
  }, [load])

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setSending(true)
    setInvErr(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/send-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          role,
          restaurant_id: restaurant.id,
          restaurant_name: restaurant.name,
          invited_by_name: session?.user?.user_metadata?.full_name || '',
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        setInvErr(d.error || 'Eroare la trimitere')
      } else {
        toast(`Invitație trimisă la ${email}`)
        setEmail('')
        await load()
      }
    } catch (err) {
      console.error('[TeamManager] sendInvite error:', err)
      setInvErr('Eroare de conexiune. Verifică internetul.')
    }
    setSending(false)
  }

  const revokeInvite = async (id: string) => {
    try {
      const { error } = await supabase.from('invite_tokens').delete().eq('id', id)
      if (error) throw error
      toast('Invitație anulată')
      await load()
    } catch {
      toast('Eroare la anulare', 'error')
    }
  }

  const removeMember = async () => {
    if (!removeTarget) return
    try {
      const { error } = await supabase
        .from('restaurant_memberships')
        .delete()
        .eq('id', removeTarget.id)
      if (error) throw error
      toast('Membru eliminat')
    } catch {
      toast('Eroare la eliminare', 'error')
    }
    setRemoveTarget(null)
    await load()
  }

  const changeRole = async (id: string, newRole: MemberRole) => {
    try {
      const { error } = await supabase
        .from('restaurant_memberships')
        .update({ role: newRole })
        .eq('id', id)
      if (error) throw error
      toast('Rol actualizat')
      await load()
    } catch {
      toast('Eroare la actualizare rol', 'error')
    }
  }

  return (
    <div>
      <Toast toasts={toasts} />
      <div style={{ marginBottom: 24 }}>
        <h2
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.5rem',
            color: D.t1,
            letterSpacing: '-0.02em',
          }}
        >
          Echipă
        </h2>
        <p style={{ color: D.t3, fontSize: '0.78rem', marginTop: 3 }}>
          {members.length} membr{members.length === 1 ? 'u' : 'i'} · Invitații expiră în 7 zile
        </p>
      </div>

      {/* Invite form */}
      <div
        style={{
          background: D.s2,
          border: `1px solid ${D.gold}33`,
          borderRadius: 14,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: D.t1, marginBottom: 14 }}>
          Invită un membru nou
        </div>
        <form
          onSubmit={sendInvite}
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: D.t2, marginBottom: 5 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ion@restaurant.ro"
              required
              style={inp}
              onFocus={(e) => (e.target.style.borderColor = D.gold)}
              onBlur={(e) => (e.target.style.borderColor = D.border)}
            />
          </div>
          <div style={{ flex: '0 0 160px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: D.t2, marginBottom: 5 }}>
              Rol
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Exclude<MemberRole, 'owner'>)}
              style={{ ...inp, cursor: 'pointer' }}
            >
              <option value="manager">Manager</option>
              <option value="waiter">Ospătar</option>
              <option value="kitchen">Bucătărie</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={sending || !email.trim()}
            style={btn({
              background: sending ? D.s3 : D.gold,
              color: sending ? D.t3 : '#000',
              height: 42,
              opacity: sending ? 0.7 : 1,
            })}
          >
            {sending ? 'Se trimite...' : 'Trimite invitație'}
          </button>
        </form>
        {invErr && (
          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              color: D.red,
              background: D.redA,
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            {invErr}
          </div>
        )}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              color: D.t2,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}
          >
            Invitații în așteptare ({invites.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {invites.map((inv) => (
              <div
                key={inv.id}
                style={{
                  background: D.s2,
                  border: `1px solid ${D.border}`,
                  borderRadius: 10,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: '0.875rem', color: D.t1 }}>{inv.email}</div>
                  <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 2 }}>
                    {ROLE_LABELS[inv.role]} · expiră{' '}
                    {new Date(inv.expires_at).toLocaleDateString('ro-RO')}
                  </div>
                </div>
                <button
                  onClick={() => revokeInvite(inv.id)}
                  style={btn({
                    background: D.s3,
                    color: D.t2,
                    border: `1px solid ${D.border}`,
                    fontSize: '0.78rem',
                    height: 32,
                  })}
                >
                  Anulează
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members */}
      <div>
        <div
          style={{
            fontSize: '0.8rem',
            fontWeight: 600,
            color: D.t2,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 10,
          }}
        >
          Membri actuali ({members.length})
        </div>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: D.t3 }}>Se încarcă...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {members.map((m) => {
              const isSelf = m.user?.id === currentUserId
              const isOwner = m.role === 'owner'
              const name = m.user?.full_name || m.user?.email || 'Utilizator'
              return (
                <div
                  key={m.id}
                  style={{
                    background: D.s2,
                    border: `1px solid ${D.border}`,
                    borderRadius: 12,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: D.s3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1rem',
                      color: D.t2,
                      flexShrink: 0,
                      fontFamily: 'Fraunces,serif',
                    }}
                  >
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 500, color: D.t1 }}>
                        {name}
                      </span>
                      {isSelf && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            background: D.goldA,
                            color: D.goldL,
                            padding: '1px 6px',
                            borderRadius: 4,
                          }}
                        >
                          Tu
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 2 }}>
                      {m.user?.email}
                    </div>
                  </div>
                  {!isOwner && !isSelf ? (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.id, e.target.value as MemberRole)}
                      style={{
                        background: D.s3,
                        border: `1px solid ${D.border}`,
                        borderRadius: 7,
                        padding: '4px 10px',
                        color: ROLE_COLORS[m.role],
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        fontFamily: 'DM Sans,sans-serif',
                      }}
                    >
                      <option value="manager">Manager</option>
                      <option value="waiter">Ospătar</option>
                      <option value="kitchen">Bucătărie</option>
                    </select>
                  ) : (
                    <span
                      style={{ fontSize: '0.8rem', color: ROLE_COLORS[m.role], fontWeight: 500 }}
                    >
                      {ROLE_LABELS[m.role]}
                    </span>
                  )}
                  {!isOwner && !isSelf && (
                    <button
                      onClick={() => setRemoveTarget(m)}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 7,
                        background: D.redA,
                        border: `1px solid rgba(224,85,85,0.2)`,
                        color: D.red,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      🗑
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {removeTarget && (
        <div
          onClick={() => setRemoveTarget(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 16,
              padding: 24,
              maxWidth: 380,
              width: '100%',
            }}
          >
            <div
              style={{
                fontFamily: 'Fraunces,serif',
                fontSize: '1.05rem',
                color: D.t1,
                marginBottom: 12,
              }}
            >
              Elimină din echipă
            </div>
            <p style={{ color: D.t2, fontSize: '0.875rem', marginBottom: 22 }}>
              Ești sigur că vrei să elimini{' '}
              <strong style={{ color: D.t1 }}>
                {removeTarget.user?.full_name || removeTarget.user?.email}
              </strong>
              ?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setRemoveTarget(null)}
                style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
              >
                Anulează
              </button>
              <button onClick={removeMember} style={btn({ background: D.red, color: '#fff' })}>
                Elimină
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import { Skeleton } from './ui/Skeleton'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { useIsMobile } from '../hooks/useIsMobile'
import type { MemberRole } from '../lib/constants'
import type { Restaurant } from '../hooks/useData'
import { changeMemberRole, removeMember, revokeInvite } from '../lib/restaurants'
import { getPartnerAccess, revokeAffiliateAccess, type PartnerAccessRow } from '../lib/founder'

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
  minHeight: 44,
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
  minHeight: 44,
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
  const isMobile = useIsMobile()
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
      const [mr, ir, namesRes] = await Promise.all([
        // Membership rows — pentru `id` (necesar la schimbare rol / eliminare)
        // și rol. FĂRĂ embed pe profiles: embed-ul `user:profiles(...)` eșua
        // sub RLS `profiles_self`, deci numele colegilor apăreau ca UUID.
        supabase
          .from('restaurant_memberships')
          .select('id,role,joined_at,user_id')
          .eq('restaurant_id', restaurant.id)
          .order('joined_at'),
        supabase
          .from('invite_tokens')
          .select('id,email,role,created_at,expires_at')
          .eq('restaurant_id', restaurant.id)
          .is('accepted_at', null)
          .gt('expires_at', new Date().toISOString()),
        // Nume/email membri — prin RPC SECURITY DEFINER (mig 173), care ocolește
        // RLS-ul de pe `profiles` pentru un apelant care e membru.
        supabase.rpc('get_restaurant_members', { p_restaurant_id: restaurant.id }),
      ])

      // Hartă user_id → nume/email din RPC.
      const nameMap = new Map<string, { email: string; full_name: string | null }>()
      for (const n of (namesRes.data || []) as Array<{
        user_id: string
        email: string | null
        full_name: string | null
      }>) {
        nameMap.set(n.user_id, { email: n.email ?? '', full_name: n.full_name })
      }

      const memberRows = (mr.data || []) as Array<{
        id: string
        role: MemberRole
        joined_at: string
        user_id: string
      }>
      const merged: Member[] = memberRows.map((m) => {
        const info = nameMap.get(m.user_id)
        return {
          id: m.id,
          role: m.role,
          joined_at: m.joined_at,
          user: info
            ? { id: m.user_id, email: info.email, full_name: info.full_name }
            : { id: m.user_id, email: '', full_name: null },
        }
      })
      setMembers(merged)
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

  const handleRevokeInvite = async (id: string) => {
    try {
      await revokeInvite({ inviteId: id })
      toast('Invitație anulată')
      await load()
    } catch {
      toast('Eroare la anulare', 'error')
    }
  }

  const handleRemoveMember = async () => {
    if (!removeTarget) return
    try {
      await removeMember({ membershipId: removeTarget.id })
      toast('Membru eliminat')
      setRemoveTarget(null)
      await load()
    } catch {
      // Pe eroare păstrăm modalul deschis (userul poate reîncerca) — nu mai închidem +
      // reîncărcăm ca și cum eliminarea a reușit.
      toast('Eroare la eliminare', 'error')
    }
  }

  const handleChangeRole = async (id: string, newRole: MemberRole) => {
    if (newRole === 'owner') {
      // UI nu permite promovarea la owner; defense in depth.
      toast('Promovarea la owner nu este permisă', 'error')
      return
    }
    try {
      await changeMemberRole({
        membershipId: id,
        newRole: newRole as Exclude<MemberRole, 'owner'>,
      })
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
        <p style={{ color: D.t2, fontSize: '0.78rem', marginTop: 3 }}>
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
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: 10,
            flexWrap: 'wrap',
            alignItems: isMobile ? 'stretch' : 'flex-end',
          }}
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
          <div style={{ flex: isMobile ? '1 1 auto' : '0 0 160px' }}>
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
              width: isMobile ? '100%' : undefined,
              opacity: sending ? 0.7 : 1,
            })}
          >
            {sending ? (
              'Se trimite...'
            ) : (
              <>
                <Icon name="send" size={15} />
                Trimite invitație
              </>
            )}
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
                  flexDirection: isMobile ? 'column' : 'row',
                  alignItems: isMobile ? 'stretch' : 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.875rem', color: D.t1, overflowWrap: 'anywhere' }}>
                    {inv.email}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 2 }}>
                    {ROLE_LABELS[inv.role]} · expiră{' '}
                    {new Date(inv.expires_at).toLocaleDateString('ro-RO')}
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeInvite(inv.id)}
                  style={btn({
                    background: D.s3,
                    color: D.t2,
                    border: `1px solid ${D.border}`,
                    fontSize: '0.78rem',
                    height: 32,
                    width: isMobile ? '100%' : undefined,
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
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton variant="table-row" count={3} />
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            icon="users"
            title="Niciun membru încă"
            description="Invită colegii tăi ca să gestionați împreună restaurantul."
          />
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
                    flexWrap: isMobile ? 'wrap' : 'nowrap',
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
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      ...(isMobile
                        ? { width: '100%', justifyContent: 'flex-end', marginTop: 2 }
                        : { marginLeft: 'auto' }),
                    }}
                  >
                    {!isOwner && !isSelf ? (
                      <select
                        value={m.role}
                        onChange={(e) => handleChangeRole(m.id, e.target.value as MemberRole)}
                        aria-label={`Rol pentru ${name}`}
                        style={{
                          background: D.s3,
                          border: `1px solid ${D.border}`,
                          borderRadius: 7,
                          padding: '4px 10px',
                          minHeight: 44,
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
                        aria-label={`Elimină ${name} din echipă`}
                        style={{
                          width: 44,
                          height: 44,
                          minWidth: 44,
                          minHeight: 44,
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
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </div>
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
              <button onClick={handleRemoveMember} style={btn({ background: D.red, color: '#fff' })}>
                Elimină
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Acces partener (afiliatul care a adus restaurantul, mig 187) —
          vizibil doar ownerului; gate-ul real e server-side în RPC. */}
      {currentUserId === restaurant.owner_id && (
        <PartnerAccessSection restaurantId={restaurant.id} toast={toast} />
      )}
    </div>
  )
}

function PartnerAccessSection({
  restaurantId,
  toast,
}: {
  restaurantId: string
  toast: (msg: string, type?: string) => void
}) {
  const [rows, setRows] = useState<PartnerAccessRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (isStale?: () => boolean) => {
    // Reset la început: fără el, la schimbarea restaurantului (sau pe eroare)
    // rămâneau afișate rândurile VECHIULUI restaurant sub cel curent.
    setLoaded(false)
    setRows([])
    try {
      const fetched = await getPartnerAccess(restaurantId)
      if (isStale?.()) return
      setRows(fetched)
    } catch {
      /* non-owner sau eroare — secțiunea rămâne goală */
    }
    if (isStale?.()) return
    setLoaded(true)
  }, [restaurantId])

  useEffect(() => {
    // Flag de anulare: două load-uri în zbor la switch rapid de restaurant
    // nu au voie să se rezolve out-of-order peste state.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  if (!loaded || rows.length === 0) return null
  const active = rows.filter((r) => r.revoked_at == null)

  async function handleRevoke() {
    setBusy(true)
    try {
      const res = await revokeAffiliateAccess(restaurantId)
      if (!res.ok) throw new Error(res.error ?? 'Eroare')
      toast('Accesul partenerului a fost revocat')
      setConfirming(false)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Eroare la revocare', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.border}`,
        borderRadius: 14,
        padding: 20,
        marginTop: 24,
      }}
    >
      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: D.t1, marginBottom: 4 }}>
        Acces partener
      </div>
      <p style={{ color: D.t2, fontSize: '0.78rem', marginBottom: 14 }}>
        Partenerul care ți-a recomandat Menuvia poate intra pe dashboardul tău ca să te ajute cu
        configurarea. Poți opri accesul oricând — nu îți afectează abonamentul.
      </p>
      {rows.map((r) => (
        <div
          key={r.attribution_id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
            padding: '10px 12px',
            background: D.s3,
            borderRadius: 10,
            marginBottom: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ color: D.t1, fontWeight: 600, fontSize: '0.85rem', overflowWrap: 'anywhere' }}>
              {r.affiliate_name || r.affiliate_email}
            </div>
            <div style={{ color: r.revoked_at ? D.red : D.green, fontSize: '0.72rem' }}>
              {r.revoked_at ? 'Acces revocat' : 'Acces activ'}
            </div>
          </div>
        </div>
      ))}
      {active.length > 0 &&
        (confirming ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: D.t2, fontSize: '0.8rem' }}>
              Sigur revoci accesul partenerului?
            </span>
            <button
              onClick={() => void handleRevoke()}
              disabled={busy}
              style={btn({ background: D.red, color: '#fff' })}
            >
              Da, revocă
            </button>
            <button
              onClick={() => setConfirming(false)}
              style={btn({ background: D.s3, color: D.t2, border: `1px solid ${D.border}` })}
            >
              Anulează
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            style={btn({
              background: 'transparent',
              color: D.red,
              border: '1px solid rgba(224,85,85,0.3)',
            })}
          >
            Revocă accesul
          </button>
        ))}
    </div>
  )
}

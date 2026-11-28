import { useState, useEffect, useCallback, useId } from 'react'
import { fnUrl } from '../lib/fn'
import { browserSite } from '../lib/domain'
import { supabase } from '../lib/supabase'
import { D } from '../lib/constants'
import { Skeleton } from './ui/Skeleton'
import { Icon } from './ui/Icon'
import { EmptyState } from './ui/EmptyState'
import { QueryError } from './PageLoader'
import { useIsMobile } from '../hooks/useIsMobile'
import type { MemberRole } from '../lib/constants'
import type { Restaurant } from '../hooks/useData'
import { changeMemberRole, removeMember, revokeInvite } from '../lib/restaurants'
// Limba (lotul L6b): textele vin din `team` („Anulează”/„Reîncearcă” din
// `common`); erorile sunt ținute ca DATE și traduse la randare — încărcarea
// prin `describeStaffError` (în română exact `toUserMessage`), refuzul
// invitației după `code` (în română textul serverului, ca înainte).
import { useT } from '../i18n/useT'
import { useUiLang } from '../i18n/UiLangContext'
import { describeStaffError } from '../i18n/staffErrors'
import { staffLocale } from '../i18n/format'
import { teamNs } from '../i18n/ns/team'
import { commonNs } from '../i18n/ns/common'
import type { Translator } from '../i18n/core'
import type teamRo from '../i18n/ns/team/ro'
// Toast-ul unic al panoului (sharedUI → ui/useToast, lotul V): înainte TeamManager
// avea o copie locală (fixă jos-dreapta, fără regiune live), deci notificările
// echipei arătau și se anunțau altfel decât restul panoului.
import { useToast, Toast } from './_dashboard/sharedUI'
// Confirmările (schimbarea rolului, eliminarea) trec prin dialogul comun
// (lotul C7c): role="dialog", Escape, focus prins — modalul de eliminare făcut
// de mână n-avea niciuna.
import { confirm } from './ui/confirm'

// Valoarea din DB → cheia textului (se traduce doar afișarea, nu valoarea).
const ROLE_KEYS = {
  owner: 'role_owner',
  manager: 'role_manager',
  waiter: 'role_waiter',
  kitchen: 'role_kitchen',
} as const satisfies Record<MemberRole, string>

// `code`-urile lui `send-invite.js` cu text propriu în celelalte limbi.
const INVITE_ERROR_KEYS = {
  server_config: 'inv_err_server_config',
  email_not_configured: 'inv_err_email_not_configured',
  missing_fields: 'inv_err_missing_fields',
  invalid_email: 'inv_err_invalid_email',
  invalid_role: 'inv_err_invalid_role',
  auth_invalid: 'inv_err_auth_invalid',
  forbidden: 'inv_err_forbidden',
  rate_limit_unavailable: 'inv_err_rate_limit_unavailable',
  rate_limited: 'inv_err_rate_limited',
  already_member: 'inv_err_already_member',
  invite_create_failed: 'inv_err_invite_create_failed',
  email_send_uncertain: 'inv_err_email_send_uncertain',
  email_send_failed: 'inv_err_email_send_failed',
} as const

// Ce înseamnă rolul NOU pentru membru (lotul C7c) — confirmarea schimbării și
// rândul de sub selectul invitației. Managerul e admin (`is_admin`): setări,
// echipă, rapoarte, încasări — un clic greșit pe select nu mai are voie să
// dea toate astea fără întrebare.
const ROLE_GAIN_KEYS = {
  manager: 'role_toManager',
  waiter: 'role_toWaiter',
  kitchen: 'role_toKitchen',
} as const satisfies Record<Exclude<MemberRole, 'owner'>, string>

function roleChangeDescription(
  from: MemberRole,
  to: Exclude<MemberRole, 'owner'>,
  tm: Translator<typeof teamRo>,
): string {
  const gain = tm.t(ROLE_GAIN_KEYS[to])
  return from === 'manager' && to !== 'manager' ? `${tm.t('role_fromManager')} ${gain}` : gain
}

// Refuzul invitației, ca DATĂ: textul și codul serverului, sau rețeaua.
type InviteError = { kind: 'server'; text: string | null; code: string | null } | { kind: 'network' }

function inviteErrorText(e: InviteError, tm: Translator<typeof teamRo>): string {
  if (e.kind === 'network') return tm.t('inv_err_network')
  // În română serverul își trimite deja textul românesc (ca înainte).
  if (tm.lang === 'ro') return e.text || tm.t('inv_err_send')
  const key =
    e.code && Object.prototype.hasOwnProperty.call(INVITE_ERROR_KEYS, e.code)
      ? INVITE_ERROR_KEYS[e.code as keyof typeof INVITE_ERROR_KEYS]
      : null
  return key ? tm.t(key) : tm.t('inv_err_send')
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
  canInvite,
}: {
  restaurant: Restaurant
  currentUserId: string
  // Obligatoriu (fără implicit permisiv). Fondatorul în vizită: send-invite
  // verifică membership-ul REAL al celui care invită, deci formularul i-ar da
  // doar un refuz. Echipa rămâne vizibilă.
  canInvite: boolean
}) {
  const tm = useT(teamNs)
  const tc = useT(commonNs)
  // Data invitației în formatul limbii UTILIZATORULUI, nu `tm.lang`.
  const { lang: uiLang } = useUiLang()
  const isMobile = useIsMobile()
  const { toasts, toast } = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  // Eroare persistentă de încărcare: fără ea, un eșec pe interogarea de membri
  // colapsa la starea goală „Niciun membru încă" (minte că echipa e goală în loc
  // să spună că n-a putut încărca) — arătăm QueryError cu Reîncearcă.
  // Ca DATĂ (`{ err }`): se traduce la randare.
  const [error, setError] = useState<{ err: unknown } | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Exclude<MemberRole, 'owner'>>('waiter')
  const [sending, setSending] = useState(false)
  const [invErr, setInvErr] = useState<InviteError | null>(null)
  const inviteRoleHintId = useId()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
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

      // Lista de membri e sursa principală: dacă eșuează, NU afișăm „echipă goală"
      // (ir/namesRes degradează grațios — invitații goale / nume fallback pe UUID).
      if (mr.error) throw mr.error

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
      setError({ err })
    }
    setLoading(false)
  }, [restaurant.id])

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
      const res = await fetch(fnUrl('send-invite'), {
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
          // Doar eticheta site-ului ('ro'/'com'); serverul o validează pe allowlist.
          site: browserSite(),
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        setInvErr({
          kind: 'server',
          text: typeof d.error === 'string' ? d.error : null,
          code: typeof d.code === 'string' ? d.code : null,
        })
        // Emailul poate să fi plecat (timeout după trimitere): invitația nouă
        // există, deci lista trebuie să o arate, cum promite mesajul serverului.
        if (d.code === 'email_send_uncertain') await load()
      } else {
        toast(tm.t('inv_sent', { email }))
        setEmail('')
        await load()
      }
    } catch (err) {
      console.error('[TeamManager] sendInvite error:', err)
      setInvErr({ kind: 'network' })
    }
    setSending(false)
  }

  const handleRevokeInvite = async (id: string) => {
    try {
      await revokeInvite({ inviteId: id })
      toast(tm.t('inv_revoked'))
      await load()
    } catch {
      toast(tm.t('err_revoke'), 'error')
    }
  }

  const handleRemoveMember = async (m: Member, name: string) => {
    const ok = await confirm({
      title: tm.t('remove_title'),
      description: tm.t('remove_confirm', { name }),
      confirmLabel: tm.t('remove'),
      cancelLabel: tc.t('cancel'),
      destructive: true,
    })
    if (!ok) return
    try {
      await removeMember({ membershipId: m.id })
      toast(tm.t('member_removed'))
      await load()
    } catch {
      // Pe eroare nu reîncărcăm ca și cum eliminarea ar fi reușit; butonul
      // rămâne, deci omul poate reîncerca.
      toast(tm.t('err_remove'), 'error')
    }
  }

  const handleChangeRole = async (m: Member, name: string, newRole: MemberRole) => {
    if (newRole === m.role) return
    if (newRole === 'owner') {
      // UI nu permite promovarea la owner; defense in depth.
      toast(tm.t('owner_forbidden'), 'error')
      return
    }
    // Selectul e CONTROLAT pe `m.role`: cât timp întrebarea e deschisă și la
    // „Anulează", React îl readuce pe rolul salvat — un clic greșit nu schimbă
    // nimic (lotul C7c). Promovarea la Manager e marcată distructiv.
    const ok = await confirm({
      title: tm.t('role_confirmTitle', { name, role: tm.t(ROLE_KEYS[newRole]) }),
      description: roleChangeDescription(m.role, newRole, tm),
      confirmLabel: tm.t('role_confirmOk'),
      cancelLabel: tc.t('cancel'),
      destructive: newRole === 'manager',
    })
    if (!ok) return
    try {
      await changeMemberRole({ membershipId: m.id, newRole })
      toast(tm.t('role_updated'))
      await load()
    } catch {
      toast(tm.t('err_role'), 'error')
    }
  }

  if (error)
    return (
      <QueryError
        message={describeStaffError(error.err, tc, { fallback: tm.t('err_load') })}
        onRetry={() => void load()}
        retryLabel={tc.t('retry')}
      />
    )

  const roleOptions = (
    <>
      <option value="manager">{tm.t('role_manager')}</option>
      <option value="waiter">{tm.t('role_waiter')}</option>
      <option value="kitchen">{tm.t('role_kitchen')}</option>
    </>
  )

  return (
    <div>
      <Toast toasts={toasts} />
      <div style={{ marginBottom: 24 }}>
        <p style={{ color: D.t2, fontSize: '0.78rem', marginTop: 3 }}>
          {tm.tp('members_count', members.length)}
        </p>
      </div>

      {/* Invite form */}
      {!canInvite ? (
        <p style={{ color: D.t2, fontSize: '0.82rem', lineHeight: 1.5, marginBottom: 24 }}>
          {tm.t('founder_note')}
        </p>
      ) : (
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
          {tm.t('invite_title')}
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
              {tm.t('email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={tm.t('email_placeholder')}
              required
              style={inp}
              onFocus={(e) => (e.target.style.borderColor = D.gold)}
              onBlur={(e) => (e.target.style.borderColor = D.border)}
            />
          </div>
          <div style={{ flex: isMobile ? '1 1 auto' : '0 0 160px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: D.t2, marginBottom: 5 }}>
              {tm.t('role')}
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Exclude<MemberRole, 'owner'>)}
              aria-describedby={inviteRoleHintId}
              style={{ ...inp, cursor: 'pointer' }}
            >
              {roleOptions}
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
              tm.t('sending')
            ) : (
              <>
                <Icon name="send" size={15} />
                {tm.t('send')}
              </>
            )}
          </button>
        </form>
        {/* Ce poate face rolul ales, într-un rând (lotul C7c). */}
        <div
          id={inviteRoleHintId}
          style={{ marginTop: 8, fontSize: '0.75rem', color: D.t2, lineHeight: 1.5 }}
        >
          {tm.t(ROLE_GAIN_KEYS[role])}
        </div>
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
            {inviteErrorText(invErr, tm)}
          </div>
        )}
      </div>
      )}

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
            {tm.t('pending_title', { n: invites.length })}
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
                    {tm.t('pending_meta', {
                      role: tm.t(ROLE_KEYS[inv.role]),
                      date: new Date(inv.expires_at).toLocaleDateString(staffLocale(uiLang)),
                    })}
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
                  {tc.t('cancel')}
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
          {tm.t('current_title', { n: members.length })}
        </div>
        {loading ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton variant="table-row" count={3} />
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            icon="users"
            title={tm.t('empty_title')}
            description={tm.t('empty_desc')}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {members.map((m) => {
              const isSelf = m.user?.id === currentUserId
              const isOwner = m.role === 'owner'
              const name = m.user?.full_name || m.user?.email || tm.t('user_fallback')
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
                          {tm.t('self')}
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
                        onChange={(e) => void handleChangeRole(m, name, e.target.value as MemberRole)}
                        aria-label={tm.t('role_aria', { name })}
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
                        {roleOptions}
                      </select>
                    ) : (
                      <span
                        style={{ fontSize: '0.8rem', color: ROLE_COLORS[m.role], fontWeight: 500 }}
                      >
                        {tm.t(ROLE_KEYS[m.role])}
                      </span>
                    )}
                    {!isOwner && !isSelf && (
                      <button
                        onClick={() => void handleRemoveMember(m, name)}
                        aria-label={tm.t('remove_aria', { name })}
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

      {/* Accesul agentului de vânzări NU mai trăiește aici (cerea planul 2): cardul
          „Agentul tău Menuvia” de pe Acasă / Setări (mig 303) funcționează pe orice plan. */}
    </div>
  )
}

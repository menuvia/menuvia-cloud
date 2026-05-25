// netlify/functions/send-invite.js
// Sends a team invite email with a magic link.
// Called by owner from the Team tab in dashboard.

const { createClient } = require('@supabase/supabase-js')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { email, role, restaurant_id, restaurant_name, invited_by_name } = JSON.parse(event.body || '{}')

  if (!email || !role || !restaurant_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) }
  }

  if (!['manager', 'waiter', 'kitchen'].includes(role)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid role' }) }
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // Verify the caller is an admin of this restaurant
  const authHeader = event.headers.authorization || ''
  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt)
  if (authErr || !user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  const { data: membership } = await supabase
    .from('restaurant_memberships')
    .select('role')
    .eq('restaurant_id', restaurant_id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['owner', 'manager'].includes(membership.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) }
  }

  // ── SEC-004: Rate limit anti-spam ──────────────────────────────
  // Max 20 invite emails / 24h per inviter. Prevents Resend domain suspension.
  const { data: rateLimitOk, error: rateLimitErr } = await supabase.rpc('check_rate_limit', {
    p_function_name:  'send_invite',
    p_scope_key:      user.id,
    p_max_requests:   20,
    p_window_minutes: 60 * 24,
  })

  if (rateLimitErr) {
    console.error('[send-invite] Rate limit check failed:', rateLimitErr.message)
    // Fail-closed: if rate limit can't be checked, reject (better than spam vector)
    return { statusCode: 503, body: JSON.stringify({ error: 'Rate limit service unavailable' }) }
  }

  if (!rateLimitOk) {
    return { statusCode: 429, body: JSON.stringify({
      error: 'Ai trimis prea multe invitații în ultimele 24 ore. Reîncearcă mâine sau contactează suportul.'
    }) }
  }

  // Check if already a member
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()

  if (existingProfile) {
    const { data: existingMembership } = await supabase
      .from('restaurant_memberships')
      .select('id')
      .eq('restaurant_id', restaurant_id)
      .eq('user_id', existingProfile.id)
      .single()

    if (existingMembership) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Acest utilizator este deja membru.' }) }
    }
  }

  // Delete any existing pending invite for this email + restaurant
  await supabase
    .from('invite_tokens')
    .delete()
    .eq('restaurant_id', restaurant_id)
    .eq('email', email)
    .is('accepted_at', null)

  // Create invite token
  const { data: invite, error: inviteErr } = await supabase
    .from('invite_tokens')
    .insert({
      restaurant_id,
      email,
      role,
      invited_by: user.id,
    })
    .select('token')
    .single()

  if (inviteErr) {
    console.error('Invite insert error:', inviteErr)
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not create invite' }) }
  }

  const appUrl   = process.env.VITE_APP_URL || 'https://menuvia.netlify.app'
  const acceptUrl = `${appUrl}/invite/${invite.token}`

  const ROLE_LABELS = { manager: 'Manager', waiter: 'Ospătar', kitchen: 'Bucătărie' }

  // Send email via Resend
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Menuvia <hello@menuvia.ro>',
      to:      [email],
      subject: `Ai fost invitat la ${restaurant_name} pe Menuvia`,
      html: `
        <div style="font-family:'DM Sans',sans-serif;max-width:520px;margin:0 auto;background:#0F0F0F;border-radius:16px;padding:40px;color:#F0EAE0;">
          <div style="font-family:Georgia,serif;font-size:24px;color:#C8963C;margin-bottom:24px;">Menuvia</div>
          <h2 style="font-family:Georgia,serif;font-size:20px;color:#F0EAE0;margin-bottom:12px;">
            Ai fost invitat la <strong>${restaurant_name}</strong>
          </h2>
          <p style="color:#9A9590;line-height:1.6;margin-bottom:8px;">
            ${invited_by_name || 'Cineva'} te-a invitat ca <strong style="color:#E2B472">${ROLE_LABELS[role] || role}</strong> pe Menuvia.
          </p>
          <p style="color:#9A9590;line-height:1.6;margin-bottom:28px;">
            Acceptă invitația pentru a accesa dashboardul restaurantului.
          </p>
          <a href="${acceptUrl}" style="display:inline-block;background:#C8963C;color:#000;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:24px;">
            Acceptă invitația
          </a>
          <p style="color:#4A4844;font-size:12px;line-height:1.5;margin-top:24px;">
            Linkul expiră în 7 zile. Dacă nu ai solicitat această invitație, ignoră acest email.
          </p>
        </div>
      `,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('Resend error:', body)
    return { statusCode: 500, body: JSON.stringify({ error: 'Email send failed' }) }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  }
}

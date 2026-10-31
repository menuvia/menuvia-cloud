// netlify/functions/send-invite.js
// Sends a team invite email with a magic link.
// Called by owner from the Team tab in dashboard.
//
// O invitație nouă NU mai șterge alte invitații (întărire, oct 2026):
//   1. emailul intra NEESCAPAT într-un filtru `ilike` — `_` și `%` sunt
//      wildcard-uri LIKE, iar PostgREST tratează și `*` ca `%`. O adresă ca
//      `ana_pop@x.ro` potrivea și `anaXpop@x.ro`, iar `%@%.%` (trece de regex)
//      ștergea TOATE invitațiile în așteptare ale restaurantului. Acum `_`/`%`/`\`
//      se escapează, iar `%`, `*` și `\` sunt refuzate în adresă.
//   2. invitațiile vechi se ștergeau ÎNAINTE de a crea și trimite una nouă: un
//      insert sau un email eșuat lăsa omul fără NICIUN link valid (cel vechi
//      murise, cel nou nu plecase). Acum: insert → email → abia la succes se
//      șterg CELELALTE invitații în așteptare (`neq token`); la un refuz clar al
//      lui Resend se șterge doar invitația NOUĂ, cele vechi rămân valabile.
// Erorile sunt `{ error: <română>, code }` — TeamManager afișează `error`.

const { createClient } = require('@supabase/supabase-js')
const { siteAppUrl, FROM_HELLO, LEGACY_NETLIFY_URL } = require('./lib/appUrl')

function fail(statusCode, code, error) {
  return { statusCode, body: JSON.stringify({ error, code }) }
}

// Valoare EXACTĂ într-un pattern LIKE/ILIKE: `\`, `%` și `_` devin literale
// (escape-ul implicit al lui LIKE în Postgres e backslash).
function likeExact(s) {
  return String(s).replace(/[\\%_]/g, (c) => `\\${c}`)
}

// Escapează conținut controlat de user înainte de interpolare în HTML-ul emailului
// (audit P3: restaurant_name/invited_by_name puteau injecta markup într-un email brandat).
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return fail(405, 'method_not_allowed', 'Cererea nu e permisă (doar POST).')
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail(500, 'server_config', 'Invitațiile nu sunt pornite pe server momentan. Încearcă mai târziu.')
  }
  // Fără cheia Resend, emailul ar pleca cu `Bearer undefined` și ar pica DUPĂ
  // ce invitația a fost scrisă — verificăm înaintea oricărei scrieri.
  if (!process.env.RESEND_API_KEY) {
    return fail(503, 'email_not_configured', 'Trimiterea emailurilor nu e pornită momentan. Scrie-ne și te ajutăm.')
  }

  // Parse protejat (audit aug 2026): era SINGURA funcție cu JSON.parse
  // neîmpachetat — un body malformat arunca SyntaxError neprins → 500 brut.
  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return fail(400, 'bad_json', 'Cererea nu a putut fi citită. Reîncearcă.')
  }
  // ★ audit v3 (SEC-06): restaurant_name / invited_by_name NU se mai citesc din
  // body — vin din DB după restaurant_id / user.id (mai jos). Altfel orice
  // cont gratuit cu un restaurant propriu putea trimite 20 de emailuri/zi
  // brandate hello@menuvia.ro cu subiect + conținut controlate de el (phishing
  // pe reputația domeniului). Câmpurile trimise încă de clienți vechi se ignoră.
  // `site`: DOAR eticheta site-ului de pe care s-a trimis invitația ('ro'/'com'),
  // validată pe allowlist în siteAppUrl — NICIODATĂ o origine din body (link
  // brandat spre orice domeniu = relay de phishing).
  const { email, role, restaurant_id, site } = payload

  if (!email || !role || !restaurant_id) {
    return fail(400, 'missing_fields', 'Completează adresa de email și rolul.')
  }

  // Validare format email (audit P3) — evită relay de email cu adrese malformate.
  // `%`, `*` și `\` sunt refuzate: sunt wildcard-uri / escape în filtrul `ilike`
  // de mai jos (PostgREST tratează `*` ca `%` și nu-l poate escapa), iar într-o
  // adresă reală nu apar practic niciodată.
  const cleanEmail = String(email).trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail) || /[%*\\]/.test(cleanEmail)) {
    return fail(400, 'invalid_email', 'Adresa de email nu e validă.')
  }
  // Pt DB folosim valoarea TRIMMED dar cu case-ul original (rezolvă mismatch-ul de
  // spații semnalat de review, fără a sparge dedup-ul rândurilor legacy mixed-case).
  const dbEmail = String(email).trim()

  if (!['manager', 'waiter', 'kitchen'].includes(role)) {
    return fail(400, 'invalid_role', 'Rolul ales nu există. Alege Manager, Ospătar sau Bucătărie.')
  }
  // Pentru filtrele `ilike` (potrivire fără diferență de majuscule, dar EXACTĂ).
  const emailPattern = likeExact(dbEmail)

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // Verify the caller is an admin of this restaurant
  const authHeader = event.headers.authorization || ''
  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt)
  if (authErr || !user) {
    return fail(401, 'auth_invalid', 'Sesiunea a expirat. Intră din nou în cont.')
  }

  const { data: membership } = await supabase
    .from('restaurant_memberships')
    .select('role')
    .eq('restaurant_id', restaurant_id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['owner', 'manager'].includes(membership.role)) {
    return fail(403, 'forbidden', 'Doar patronul sau managerul pot trimite invitații.')
  }

  // Numele restaurantului și al invitatorului — din DB (service_role), nu din body.
  const [{ data: restRow }, { data: inviterRow }] = await Promise.all([
    supabase.from('restaurants').select('name').eq('id', restaurant_id).maybeSingle(),
    supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle(),
  ])
  const restaurantName = String(restRow?.name || 'restaurantul tău')
  const invitedByName = String(inviterRow?.full_name || inviterRow?.email || 'Un coleg')
  // Conținut escapat pentru interpolarea în HTML-ul emailului.
  const safeRestaurantName = escapeHtml(restaurantName)
  const safeInvitedBy = escapeHtml(invitedByName)
  // Subiectul e text simplu (header), NU HTML — escaparea l-ar strica ("Fish & Chips"
  // → "Fish &amp; Chips"). Doar curățăm newline-urile (anti header-injection).
  const subjectRestaurantName = restaurantName.replace(/[\r\n]+/g, ' ').trim()

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
    return fail(503, 'rate_limit_unavailable', 'Nu am putut verifica limita de invitații. Reîncearcă în câteva momente.')
  }

  if (!rateLimitOk) {
    return fail(
      429,
      'rate_limited',
      'Ai trimis prea multe invitații în ultimele 24 ore. Reîncearcă mâine sau contactează suportul.',
    )
  }

  // Check if already a member
  // Match case-insensitive (ilike) — un profil 'John@x.com' trebuie găsit și pentru 'john@x.com'
  // fără a pierde rânduri legacy mixed-case.
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', emailPattern)
    .single()

  if (existingProfile) {
    const { data: existingMembership } = await supabase
      .from('restaurant_memberships')
      .select('id')
      .eq('restaurant_id', restaurant_id)
      .eq('user_id', existingProfile.id)
      .single()

    if (existingMembership) {
      return fail(409, 'already_member', 'Acest utilizator este deja membru.')
    }
  }

  // Create invite token — ÎNAINTE de a atinge invitațiile vechi (vezi antetul).
  const { data: invite, error: inviteErr } = await supabase
    .from('invite_tokens')
    .insert({
      restaurant_id,
      email: dbEmail,
      role,
      invited_by: user.id,
    })
    .select('token')
    .single()

  if (inviteErr) {
    console.error('Invite insert error:', inviteErr)
    return fail(500, 'invite_create_failed', 'Nu am putut crea invitația. Reîncearcă.')
  }

  // Orice valoare a lui `site` (absent = clienți vechi, 'ro', 'com', gunoi) →
  // cheia + fallback-ul de dinainte, EXACT (VITE_APP_URL → menuvia.netlify.app).
  // Linkul NU pleacă niciodată spre domeniul .com (nu ne aparține — D3).
  const appUrl   = siteAppUrl(site, { keys: ['VITE_APP_URL'], fallback: LEGACY_NETLIFY_URL })
  const acceptUrl = `${appUrl}/invite/${invite.token}`

  const ROLE_LABELS = { manager: 'Manager', waiter: 'Ospătar', kitchen: 'Bucătărie' }

  // Send email via Resend
  let res
  try {
    res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    // OPT-3: timeout explicit — un TCP agățat nu mai blochează funcția.
    signal: AbortSignal.timeout(8000),
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    FROM_HELLO,
      to:      [cleanEmail],
      subject: `Ai fost invitat la ${subjectRestaurantName} pe Menuvia`,
      html: `
        <div style="font-family:'DM Sans',sans-serif;max-width:520px;margin:0 auto;background:#0F0F0F;border-radius:16px;padding:40px;color:#F0EAE0;">
          <div style="font-family:Georgia,serif;font-size:24px;color:#C8963C;margin-bottom:24px;">Menuvia</div>
          <h2 style="font-family:Georgia,serif;font-size:20px;color:#F0EAE0;margin-bottom:12px;">
            Ai fost invitat la <strong>${safeRestaurantName}</strong>
          </h2>
          <p style="color:#9A9590;line-height:1.6;margin-bottom:8px;">
            ${safeInvitedBy} te-a invitat ca <strong style="color:#E2B472">${ROLE_LABELS[role] || role}</strong> pe Menuvia.
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
  } catch (e) {
    // Timeout / rețea DUPĂ ce cererea a plecat: Resend poate să fi trimis deja
    // emailul, deci NU ștergem invitația nouă (linkul din email ar muri) și nici
    // pe cele vechi (n-avem confirmare). Invitația nouă apare în listă.
    console.error('Resend fetch failed:', e && e.message)
    return fail(
      504,
      'email_send_uncertain',
      'Nu am putut confirma trimiterea emailului. Invitația apare în listă; dacă nu ajunge în câteva minute, trimite-o din nou.',
    )
  }

  if (!res.ok) {
    const body = await res.text()
    console.error('Resend error:', body)
    // Refuz CLAR: emailul n-a plecat. Ștergem doar invitația NOUĂ (linkul ei
    // n-a ajuns la nimeni); cele vechi rămân valabile.
    const { error: rollbackErr } = await supabase
      .from('invite_tokens')
      .delete()
      .eq('restaurant_id', restaurant_id)
      .eq('token', invite.token)
    if (rollbackErr) console.error('Invite rollback error:', rollbackErr.message)
    return fail(502, 'email_send_failed', 'Emailul cu invitația nu a putut fi trimis. Reîncearcă.')
  }

  // Emailul a plecat: ABIA ACUM retragem celelalte invitații în așteptare
  // pentru aceeași adresă (potrivire exactă, fără diferență de majuscule) —
  // ultimul link trimis e singurul valabil, ca înainte.
  const { error: cleanupErr } = await supabase
    .from('invite_tokens')
    .delete()
    .eq('restaurant_id', restaurant_id)
    .ilike('email', emailPattern)
    .is('accepted_at', null)
    .neq('token', invite.token)
  if (cleanupErr) console.error('Old invite cleanup error:', cleanupErr.message)

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  }
}

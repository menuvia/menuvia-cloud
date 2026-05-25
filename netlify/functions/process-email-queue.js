// netlify/functions/process-email-queue.js
// Cron-triggered (Netlify scheduled): la fiecare 5 min.
// Procesează coada email_queue → trimite via Resend → marchează status.
//
// Schedule (netlify.toml):
//   [functions."process-email-queue"]
//     schedule = "*/5 * * * *"

const { createClient } = require('@supabase/supabase-js')

const FROM_EMAIL = process.env.EMAIL_FROM || 'Menuvia <hello@menuvia.ro>'
const REPLY_TO   = process.env.EMAIL_REPLY_TO || 'radu@menuvia.ro'
const APP_URL    = process.env.APP_URL || 'https://menuvia.netlify.app'

// ── Email templates (Romanian, warm tone) ──────────────────────
// Each renders to { subject, html } given templateData.
const TEMPLATES = {
  welcome: (d) => ({
    subject: '🎉 Bun venit la Menuvia!',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:28px;margin:0 0 16px">Bun venit, ${esc(d.owner_name || 'patron')}!</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">Mulțumesc că ai ales Menuvia. Acum ai acces complet la <b>planul Pro</b>: meniu QR, comenzi în timp real, casă fiscală, gestiune stocuri și rapoarte detaliate.</p>
        <p style="color:#333;font-size:16px;line-height:1.55"><b>Pași următori:</b></p>
        <ol style="color:#333;font-size:15px;line-height:1.7">
          <li>Configurează meniul (import CSV sau import AI)</li>
          <li>Generează QR-uri pentru mese</li>
          <li>Invită echipa (ospătari, bucătărie)</li>
        </ol>
        <a href="${APP_URL}/dashboard" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">Deschide dashboard →</a>
        <p style="color:#666;font-size:13px;margin-top:24px">Răspund personal pe WhatsApp dacă ai întrebări. Mulțumesc pentru încredere!<br/>— Radu, fondator Menuvia</p>
      </div>
    `,
  }),

  onboarding_no_products: (d) => ({
    subject: '☕ Hai să-ți construim meniul în 3 minute',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:24px;margin:0 0 16px">${esc(d.owner_name || 'Bună')}, lipsește meniul!</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">Văd că ai creat contul dar n-ai adăugat încă produse. Am 3 opțiuni rapide pentru tine:</p>
        <ul style="color:#333;font-size:15px;line-height:1.7">
          <li><b>Setup Asistent</b> — alegi „cafenea/bar/restaurant" și încarc 11-15 produse cu prețuri realiste (3 min)</li>
          <li><b>Import CSV</b> — descarci template, completezi, urci (5 min pentru 100 produse)</li>
          <li><b>Import AI</b> — urci poza meniului tău, AI-ul scoate produsele singur (1 min)</li>
        </ul>
        <a href="${APP_URL}/dashboard" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Hai să adăugăm produse →</a>
        <p style="color:#666;font-size:13px;margin-top:24px">Dacă ai dificultăți, scrie-mi direct pe WhatsApp.<br/>— Radu</p>
      </div>
    `,
  }),

  trial_ending_3d: (d) => ({
    subject: '⏰ Trial-ul se termină în 3 zile',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:24px">Trial-ul tău Menuvia se termină în 3 zile</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">Bună ${esc(d.owner_name || 'patron')}!</p>
        <p style="color:#333;font-size:16px;line-height:1.55">Văd că folosești Menuvia și sper că ți-a fost de folos. Trial-ul gratuit se încheie în 3 zile. Pentru a continua fără întreruperi, actualizează cardul în setări.</p>
        <a href="${APP_URL}/dashboard?tab=billing" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Continuă cu Pro →</a>
        <p style="color:#666;font-size:13px;margin-top:24px">Dacă ai întrebări despre planuri, scrie-mi direct.</p>
      </div>
    `,
  }),

  payment_failed: (d) => ({
    subject: `⚠️ Plata nu s-a putut procesa (încercarea ${d.attempt || 1})`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#A93232;font-size:24px">Plata nu s-a putut procesa</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">Bună ${esc(d.owner_name || 'patron')},</p>
        <p style="color:#333;font-size:16px;line-height:1.55">Am încercat să procesăm plata abonamentului dar n-a reușit. Cele mai comune cauze:</p>
        <ul style="color:#333;font-size:15px;line-height:1.7">
          <li>Card expirat sau date schimbate</li>
          <li>Sold insuficient</li>
          <li>Card blocat de bancă pentru tranzacții online</li>
        </ul>
        <p style="color:#333;font-size:16px;line-height:1.55">Vom reîncerca automat în 3 zile. Până atunci, contul rămâne activ.</p>
        <a href="${APP_URL}/dashboard?tab=billing" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Actualizează metoda de plată →</a>
      </div>
    `,
  }),

  health_score_alert: (d) => ({
    subject: `[INTERN] Health score critic: ${d.score || '?'}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="color:#A93232">⚠️ Customer Health Alert</h2>
        <p>Restaurant ${esc(d.restaurant_id)}<br/>
        Patron: ${esc(d.owner_name)}<br/>
        Score: <b>${d.score}/100</b> (trend: ${d.trend})<br/>
        Comenzi săpt. asta: ${d.orders_this_week}<br/>
        Ultimul login: ${d.last_login || 'niciodată'}</p>
        <p><b>Acțiune sugerată:</b> Sună patronul în 24h, întreabă dacă e totul OK, oferă ajutor cu setup-ul.</p>
      </div>
    `,
  }),

  milestone_100_orders: (d) => ({
    subject: '🎉 100 comenzi prin Menuvia!',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:28px">100 comenzi! 🎉</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">Felicitări ${esc(d.owner_name || '')}! Tocmai ai depășit pragul de <b>100 comenzi procesate prin Menuvia</b>.</p>
        <p style="color:#333;font-size:16px;line-height:1.55">Mulțumesc că ai încredere în noi. Continuă tot așa!</p>
      </div>
    `,
  }),

  milestone_1000_orders: (d) => ({
    subject: '🏆 1.000 comenzi! Diploma vine prin poștă!',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:30px">1.000 comenzi!</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">${esc(d.owner_name || '')}, ai atins un milestone important. <b>1.000 de comenzi</b> procesate prin Menuvia.</p>
        <p style="color:#333;font-size:16px;line-height:1.55">Ca recunoștință, îți trimit prin poștă o diplomă personalizată. Dă-mi adresa pe WhatsApp.</p>
      </div>
    `,
  }),

  weekly_report: (d) => ({
    subject: `📊 Raportul săptămânal: ${d.revenue || 0} lei venit`,
    html: weeklyReportHtml(d),
  }),

  milestone_first_month: (d) => ({
    subject: '☕ Prima comandă! Felicitări',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:26px">Prima comandă! 🎊</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">${esc(d.owner_name || 'Patron')}, tocmai s-a procesat prima comandă plătită prin Menuvia (${d.total || 0} lei). E doar începutul!</p>
        <p style="color:#333;font-size:16px;line-height:1.55">Dacă ceva nu merge cum ar trebui, scrie-mi imediat.</p>
        <p style="color:#666;font-size:13px;margin-top:24px">— Radu</p>
      </div>
    `,
  }),
}

function weeklyReportHtml(d) {
  const revenue = formatLei(d.revenue)
  const prev    = formatLei(d.revenue_prev)
  const change  = d.revenue_change_pct
  const orders  = d.orders || 0
  const avgT    = formatLei(d.avg_ticket)
  const products = Array.isArray(d.top_products) ? d.top_products : []

  let trendIcon = '→'
  let trendColor = '#666'
  if (change !== null && change !== undefined) {
    if (change > 5)  { trendIcon = '↗'; trendColor = '#2C7A2C' }
    if (change < -5) { trendIcon = '↘'; trendColor = '#A93232' }
  }

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fafaf7">
      <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:26px;margin:0 0 6px">Raport săptămânal</h1>
      <p style="color:#666;margin:0 0 24px">${formatPeriod(d.period_start, d.period_end)}</p>

      <div style="background:#fff;border:1px solid #e8e4dc;border-radius:12px;padding:20px;margin-bottom:16px">
        <div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Venit total</div>
        <div style="font-family:Georgia,serif;font-size:36px;font-weight:600;color:#0A0908">${revenue}</div>
        <div style="color:${trendColor};font-size:14px;margin-top:4px">${trendIcon} ${change !== null ? Math.abs(change) + '% vs săpt. trecută' : 'date insuficiente'}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <tr><td style="padding:8px 0;color:#666">Comenzi:</td><td style="text-align:right;font-weight:600">${orders}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Valoare medie bon:</td><td style="text-align:right;font-weight:600">${avgT}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Ora de vârf:</td><td style="text-align:right;font-weight:600">${d.busiest_hour != null ? d.busiest_hour + ':00 – ' + (d.busiest_hour + 1) + ':00' : '—'}</td></tr>
      </table>

      ${products.length > 0 ? `
      <h2 style="font-family:Georgia,serif;font-size:18px;color:#0A0908;margin-top:24px">Top produse</h2>
      <table style="width:100%;border-collapse:collapse">
        ${products.map((p, i) => `
          <tr style="border-top:${i === 0 ? '1px solid #e8e4dc' : '1px solid #f3efe7'}">
            <td style="padding:10px 0;color:#0A0908">${i + 1}. ${esc(p.name)}</td>
            <td style="padding:10px 0;color:#666;text-align:right">${p.units_sold} buc</td>
            <td style="padding:10px 0;color:#0A0908;text-align:right;font-weight:600">${formatLei(p.revenue)}</td>
          </tr>
        `).join('')}
      </table>
      ` : ''}

      <a href="${APP_URL}/dashboard?tab=analytics" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:24px">Vezi raport detaliat →</a>

      <p style="color:#999;font-size:12px;margin-top:32px;border-top:1px solid #e8e4dc;padding-top:16px">Primești acest raport săptămânal pentru că ai un cont Menuvia activ. Poți dezactiva în setări.</p>
    </div>
  `
}

function formatLei(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' lei'
}

function formatPeriod(start, end) {
  try {
    const s = new Date(start)
    const e = new Date(end)
    const fmt = (d) => d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })
    return `${fmt(s)} – ${fmt(new Date(e.getTime() - 1))}`
  } catch { return '' }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ── Main handler ──────────────────────────────────────────────
exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY } = process.env

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Missing env' }
  }
  if (!RESEND_API_KEY) {
    console.warn('[process-email-queue] RESEND_API_KEY not set — emails skipped')
    return { statusCode: 200, body: 'No Resend key; skipped' }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Fetch up to 30 queued emails ready to send
  const { data: pending, error } = await supabase
    .from('email_queue')
    .select('*')
    .eq('status', 'queued')
    .lte('scheduled_for', new Date().toISOString())
    .lt('failed_attempts', 3)
    .order('scheduled_for', { ascending: true })
    .limit(30)

  if (error) {
    console.error('[process-email-queue] Fetch failed:', error.message)
    return { statusCode: 500, body: error.message }
  }

  if (!pending || pending.length === 0) {
    return { statusCode: 200, body: 'No pending emails' }
  }

  let sent = 0, failed = 0

  for (const email of pending) {
    // Mark as sending
    await supabase.from('email_queue').update({ status: 'sending' }).eq('id', email.id)

    const template = TEMPLATES[email.template_kind]
    if (!template) {
      await supabase.from('email_queue').update({
        status: 'failed',
        last_error: `Unknown template: ${email.template_kind}`,
        failed_attempts: email.failed_attempts + 1,
      }).eq('id', email.id)
      failed++
      continue
    }

    let rendered
    try {
      rendered = template(email.template_data || {})
    } catch (err) {
      await supabase.from('email_queue').update({
        status: 'failed',
        last_error: `Template render: ${err.message}`,
        failed_attempts: email.failed_attempts + 1,
      }).eq('id', email.id)
      failed++
      continue
    }

    const subject = email.subject_override || rendered.subject

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [email.recipient_email],
          subject,
          html: rendered.html,
          reply_to: REPLY_TO,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`Resend ${res.status}: ${errText.slice(0, 200)}`)
      }

      await supabase.from('email_queue').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
      }).eq('id', email.id)
      sent++
    } catch (err) {
      const attempts = email.failed_attempts + 1
      await supabase.from('email_queue').update({
        status: attempts >= 3 ? 'failed' : 'queued',
        failed_attempts: attempts,
        last_error: String(err.message || err).slice(0, 500),
        // Backoff: wait 10min × attempts before retry
        scheduled_for: new Date(Date.now() + attempts * 10 * 60_000).toISOString(),
      }).eq('id', email.id)
      failed++
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: pending.length, sent, failed }),
  }
}

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

  daily_report: (d) => ({
    subject: `☀️ Ieri ${formatLei(d.revenue)} (${d.orders || 0} comenzi) — ${esc(d.restaurant_name || '')}`,
    html: dailyReportHtml(d),
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

  reservation_reminder: (d) => ({
    subject: `Reminder: rezervarea ta la ${esc(d.restaurant_name || '')} ${formatRelativeDayRo(d.starts_at)}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:24px;margin:0 0 16px">
          Bună ${esc(d.customer_name || '')}!
        </h1>
        <p style="color:#333;font-size:16px;line-height:1.55">
          Îți reamintim de rezervarea ta la <b>${esc(d.restaurant_name || '')}</b>:
        </p>
        <div style="background:#fff;border:1px solid #E8DCC9;border-radius:12px;padding:20px;margin:16px 0">
          <div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Data și ora</div>
          <div style="color:#0A0908;font-size:18px;font-weight:600">${esc(formatDateTimeRo(d.starts_at))}</div>
          <div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:14px 0 6px">Persoane</div>
          <div style="color:#0A0908;font-size:18px;font-weight:600">${esc(String(d.party_size || ''))}</div>
          <div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:14px 0 6px">Cod confirmare</div>
          <div style="font-family:Georgia,serif;color:#C8963C;font-size:22px;letter-spacing:0.15em">${esc(d.confirmation_code || '')}</div>
        </div>
        ${
          d.restaurant_phone
            ? `<p style="color:#333;font-size:15px;line-height:1.55">Dacă nu mai poți veni, te rugăm să suni: <a href="tel:${esc(d.restaurant_phone)}" style="color:#C8963C">${esc(d.restaurant_phone)}</a></p>`
            : ''
        }
        <p style="color:#666;font-size:13px;margin-top:24px">Te așteptăm cu drag.</p>
      </div>
    `,
  }),

  win_back_7d: (d) => ({
    subject: `${esc(d.restaurant_name || '')} — văd că ai pauză. Pot ajuta cu ceva?`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:26px;margin:0 0 16px">Bună ${esc(d.owner_name || 'Patron')},</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">
          Am observat că ultima comandă prin Menuvia la <b>${esc(d.restaurant_name || '')}</b> a fost acum <b>${esc(String(d.days_since_last_order || ''))} zile</b>.
        </p>
        <p style="color:#333;font-size:16px;line-height:1.55">
          Nu trag concluzii — patroni inteligenți au săptămâni încărcate, sezon scăzut, sau pur și simplu testează altceva. Dar vreau să întreb direct: <b>e ceva ce nu merge cu Menuvia?</b>
        </p>
        <p style="color:#333;font-size:16px;line-height:1.55">
          Răspunde la acest email cu un cuvânt sau două. Dacă e un bug, îl rezolv în 24h. Dacă lipsește o feature, o pun în roadmap. Dacă e altceva — ascult.
        </p>
        <p style="color:#666;font-size:13px;margin-top:24px">— Radu, Menuvia</p>
      </div>
    `,
  }),

  win_back_30d: (d) => ({
    subject: `${esc(d.restaurant_name || '')} — o lună fără comenzi. Vorbim?`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:26px;margin:0 0 16px">Bună ${esc(d.owner_name || 'Patron')},</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">
          ${esc(String(d.days_since_last_order || ''))} zile fără comenzi prin Menuvia la <b>${esc(d.restaurant_name || '')}</b>. Vreau să fiu transparent: la pragul ăsta e clar că ceva nu funcționează pentru tine.
        </p>
        <p style="color:#333;font-size:16px;line-height:1.55">
          Două scenarii probabile:
        </p>
        <ul style="color:#333;font-size:16px;line-height:1.55">
          <li><b>Ai un blocker tehnic</b> pe care nu l-am identificat. Răspunde la acest email — rezolv săptămâna asta.</li>
          <li><b>Ai trecut pe alt produs.</b> E ok. Dar înainte, dă-mi 10 minute la telefon (răspunde cu "sună-mă"). Vreau să înțeleg ce am ratat — pentru următorii ${esc(d.restaurant_name || '')}-uri.</li>
        </ul>
        <p style="color:#333;font-size:16px;line-height:1.55">
          Oricum ar fi: îți mulțumesc că ai dat o șansă produsului.
        </p>
        <p style="color:#666;font-size:13px;margin-top:24px">— Radu</p>
      </div>
    `,
  }),

  nps_survey: (d) => {
    // mailto: pre-fill subject = nota + body = ID identificare.
    // Zero infra → patron click pe nota → deschide client email → trimite.
    // Înlocuiește cu URL real (route /nps) dacă vrei pagini de feedback.
    const replyEmail = 'radu@menuvia.ro'
    const link = (score) =>
      `mailto:${replyEmail}?subject=${encodeURIComponent('NPS ' + score + '/10 — ' + (d.restaurant_name || ''))}&body=${encodeURIComponent('Nota: ' + score + '/10\n\nMotiv (opțional):\n\n\n—\nUser: ' + (d.user_id || '') + '\nRestaurant: ' + (d.restaurant_name || ''))}`
    return {
      subject: `${esc(d.restaurant_name || 'Menuvia')} — pe scara 0-10, ce notă dai Menuvia?`,
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
          <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:26px;margin:0 0 16px">Bună ${esc(d.owner_name || 'Patron')},</h1>
          <p style="color:#333;font-size:16px;line-height:1.55">
            Sunt 2 luni de când folosești Menuvia. O singură întrebare:
          </p>
          <p style="color:#0A0908;font-size:18px;font-weight:600;line-height:1.4;margin:24px 0">
            Pe scara 0–10, cât de probabil e să recomanzi Menuvia altui patron de restaurant?
          </p>
          <div style="text-align:center;margin:24px 0">
            ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
              .map(
                (n) => `<a href="${link(n)}" style="display:inline-block;width:36px;height:36px;line-height:36px;margin:2px;border:1px solid #C8963C;border-radius:50%;color:#0A0908;text-decoration:none;font-weight:600">${n}</a>`,
              )
              .join('')}
          </div>
          <p style="color:#666;font-size:13px;line-height:1.55">
            Click pe notă → deschide email-ul tău cu nota pre-completată. Adaugă 1-2 fraze cu motivul (opțional). Pentru orice notă sub 7, sun personal în 48h.
          </p>
          <p style="color:#666;font-size:13px;margin-top:24px">— Radu</p>
        </div>
      `,
    }
  },

  // ── Handlere minimale adăugate pentru sincronizare cu enumul email_template_kind (mig 039+) ──

  onboarding_no_orders: (d) => ({
    subject: '👀 Meniul e gata — hai să prindem prima comandă',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:24px;margin:0 0 16px">${esc(d.owner_name || 'Bună')}, meniul e configurat!</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">Văd că ai produse în meniu dar încă n-a intrat nicio comandă. Cel mai probabil lipsește QR-ul pe masă sau clienții nu știu de el.</p>
        <a href="${APP_URL}/dashboard" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Generează QR-uri →</a>
        <p style="color:#666;font-size:13px;margin-top:24px">Scrie-mi pe WhatsApp dacă ai nevoie de ajutor.<br/>— Radu</p>
      </div>
    `,
  }),

  trial_ending_1d: (d) => ({
    subject: '⏰ Trial-ul se termină mâine',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:24px">Trial-ul tău Menuvia se termină mâine</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">Bună ${esc(d.owner_name || 'patron')}!</p>
        <p style="color:#333;font-size:16px;line-height:1.55">Mâine se încheie perioada de trial. Pentru a continua fără întreruperi, actualizează cardul în setări.</p>
        <a href="${APP_URL}/dashboard?tab=billing" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Continuă cu Pro →</a>
        <p style="color:#666;font-size:13px;margin-top:24px">Dacă ai întrebări despre planuri, scrie-mi direct.</p>
      </div>
    `,
  }),

  payment_recovered: (d) => ({
    subject: '✅ Plata s-a procesat cu succes',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:24px">Plata s-a procesat cu succes</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">Bună ${esc(d.owner_name || 'patron')},</p>
        <p style="color:#333;font-size:16px;line-height:1.55">Vestea bună: plata abonamentului a reușit, iar contul rămâne activ fără întreruperi. Mulțumesc pentru încredere.</p>
        <a href="${APP_URL}/dashboard?tab=billing" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Vezi detalii facturare →</a>
      </div>
    `,
  }),

  subscription_cancelled: (d) => ({
    subject: 'Abonamentul Menuvia a fost anulat',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:24px">Abonamentul tău a fost anulat</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">Bună ${esc(d.owner_name || 'patron')},</p>
        <p style="color:#333;font-size:16px;line-height:1.55">Confirmăm că abonamentul Menuvia pentru <b>${esc(d.restaurant_name || 'restaurantul tău')}</b> a fost anulat. Nu vei mai fi taxat.</p>
        <p style="color:#333;font-size:16px;line-height:1.55">Dacă te răzgândești, poți reactiva oricând din dashboard. Dacă anularea are legătură cu ceva ce am putea îmbunătăți, aș aprecia un răspuns la acest email.</p>
        <p style="color:#666;font-size:13px;margin-top:24px">Mulțumesc că ai încercat Menuvia.<br/>— Radu</p>
      </div>
    `,
  }),

  monthly_recap: (d) => ({
    subject: `📈 Recap lunar: ${formatLei(d.revenue)} venit`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:26px">Recap lunar</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">Bună ${esc(d.owner_name || 'patron')}, iată un rezumat al lunii pentru <b>${esc(d.restaurant_name || '')}</b>:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:6px 0;color:#666">Venit total:</td><td style="text-align:right;font-weight:600">${formatLei(d.revenue)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Comenzi:</td><td style="text-align:right;font-weight:600">${d.orders || 0}</td></tr>
        </table>
        <a href="${APP_URL}/dashboard?tab=analytics" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Vezi raport detaliat →</a>
      </div>
    `,
  }),

  invoice_ready: (d) => ({
    subject: '🧾 Factura ta Menuvia este disponibilă',
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:24px">Factura ta este disponibilă</h1>
        <p style="color:#333;font-size:16px;line-height:1.55">Bună ${esc(d.owner_name || 'patron')},</p>
        <p style="color:#333;font-size:16px;line-height:1.55">Factura pentru abonamentul Menuvia (${formatLei(d.amount)}) este acum disponibilă în dashboard.</p>
        <a href="${APP_URL}/dashboard?tab=billing" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Descarcă factura →</a>
      </div>
    `,
  }),

  // Template generic pentru emailuri ad-hoc: html/subject vin din template_data
  // (sau din subject_override la nivel de coadă). Fallback minimal dacă lipsesc.
  custom: (d) => ({
    subject: d.subject || 'Menuvia',
    html: d.html || `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <p style="color:#333;font-size:16px;line-height:1.55">${esc(d.body || '')}</p>
        <p style="color:#666;font-size:13px;margin-top:24px">— Radu, Menuvia</p>
      </div>
    `,
  }),
}

function formatDateTimeRo(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const date = d.toLocaleDateString('ro-RO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
    const time = d.toLocaleTimeString('ro-RO', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Bucharest',
    })
    return `${date} · ${time}`
  } catch {
    return String(iso)
  }
}

function formatRelativeDayRo(iso) {
  if (!iso) return ''
  try {
    const target = new Date(iso)
    const now = new Date()
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate())
    const days = Math.round((startTarget - startToday) / (1000 * 60 * 60 * 24))
    if (days <= 0) return 'astăzi'
    if (days === 1) return 'mâine'
    return 'pe ' + target.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' })
  } catch {
    return ''
  }
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

function dailyReportHtml(d) {
  const revenue = formatLei(d.revenue)
  const orders  = d.orders || 0
  const avgT    = formatLei(d.avg_ticket)
  const change  = d.revenue_change_pct
  const products = Array.isArray(d.top_products) ? d.top_products : []
  const dayLabel = formatRoDay(d.day)

  let trendIcon = '→'
  let trendColor = '#666'
  let trendLabel = 'date insuficiente'
  if (change !== null && change !== undefined) {
    if (change > 5)  { trendIcon = '↗'; trendColor = '#2C7A2C' }
    if (change < -5) { trendIcon = '↘'; trendColor = '#A93232' }
    trendLabel = `${Math.abs(change)}% vs ziua precedentă`
  }

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
      <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:24px;margin:0 0 4px">Raport zilnic</h1>
      <p style="color:#666;margin:0 0 20px">${esc(dayLabel)} · ${esc(d.restaurant_name || '')}</p>

      <div style="background:#fff;border:1px solid #e8e4dc;border-radius:12px;padding:18px;margin-bottom:14px">
        <div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Venit ieri</div>
        <div style="font-family:Georgia,serif;font-size:32px;font-weight:600;color:#0A0908">${revenue}</div>
        <div style="color:${trendColor};font-size:14px;margin-top:4px">${trendIcon} ${trendLabel}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
        <tr><td style="padding:6px 0;color:#666">Comenzi:</td><td style="text-align:right;font-weight:600">${orders}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Valoare medie bon:</td><td style="text-align:right;font-weight:600">${avgT}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Ora de vârf:</td><td style="text-align:right;font-weight:600">${d.busiest_hour != null ? d.busiest_hour + ':00 – ' + (d.busiest_hour + 1) + ':00' : '—'}</td></tr>
      </table>

      ${products.length > 0 ? `
      <h2 style="font-family:Georgia,serif;font-size:16px;color:#0A0908;margin:18px 0 8px">Top produse</h2>
      <table style="width:100%;border-collapse:collapse">
        ${products.map((p, i) => `
          <tr style="border-top:${i === 0 ? '1px solid #e8e4dc' : '1px solid #f3efe7'}">
            <td style="padding:8px 0;color:#0A0908">${i + 1}. ${esc(p.name)}</td>
            <td style="padding:8px 0;color:#666;text-align:right">${p.units_sold} buc</td>
            <td style="padding:8px 0;color:#0A0908;text-align:right;font-weight:600">${formatLei(p.revenue)}</td>
          </tr>
        `).join('')}
      </table>
      ` : ''}

      <a href="${APP_URL}/dashboard?tab=analytics" style="display:inline-block;background:#C8963C;color:#0A0908;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:20px">Vezi dashboard →</a>

      <p style="color:#999;font-size:12px;margin-top:28px;border-top:1px solid #e8e4dc;padding-top:14px">Primești acest raport zilnic pentru că ai un cont Menuvia activ. Răspunde la acest email cu „stop daily" și îl oprim.</p>
    </div>
  `
}

function formatRoDay(day) {
  if (!day) return ''
  try {
    const d = new Date(day)
    return d.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' })
  } catch { return String(day) }
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

  // Claim atomic până la 30 emailuri (UPDATE ... FOR UPDATE SKIP LOCKED via RPC) — rândurile
  // sunt deja marcate 'sending' de RPC, deci două rulări suprapuse NU pot prinde același rând
  // (anti dublu-trimitere). Înlocuiește vechiul select-then-update ne-atomic.
  const { data: pending, error } = await supabase.rpc('claim_email_batch', { p_limit: 30 })

  if (error) {
    console.error('[process-email-queue] Claim failed:', error.message)
    return { statusCode: 500, body: error.message }
  }

  if (!pending || pending.length === 0) {
    return { statusCode: 200, body: 'No pending emails' }
  }

  let sent = 0, failed = 0

  for (const email of pending) {
    // Deja claim-uit ('sending') de claim_email_batch — fără re-marcare aici.

    const template = TEMPLATES[email.template_kind]
    if (!template) {
      // Template necunoscut aici ≠ eroare permanentă: enumul email_template_kind poate fi
      // extins într-o migrație fără ca deploy-ul acestui fișier să fi prins încă handler-ul.
      // Tratăm identic cu eșecul tranzitoriu Resend (retry cu backoff), ca să nu pierdem
      // emailul definitiv înainte de următorul deploy.
      const attempts = email.failed_attempts + 1
      await supabase.from('email_queue').update({
        status: attempts >= 3 ? 'failed' : 'queued',
        failed_attempts: attempts,
        last_error: `Unknown template: ${email.template_kind}`,
        // Backoff: wait 10min × attempts before retry
        scheduled_for: new Date(Date.now() + attempts * 10 * 60_000).toISOString(),
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
          // Dedup REAL la sursă: Resend deduplică request-urile cu același `Idempotency-Key`
          // și NU retrimite emailul a doua oară. Cheia e derivată DETERMINIST din `email.id`
          // (invariant între retrimiteri — reclaim-ul mig 167 nu-l schimbă), deci dacă
          // UPDATE-ul status='sent' eșuează după un 200 și rândul e reclamat, al doilea apel
          // poartă ACEEAȘI cheie → Resend recunoaște duplicatul și previne dublu-send-ul.
          'Idempotency-Key': `idempotency-email-${email.id}`,
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
        const resendErr = new Error(`Resend ${res.status}: ${errText.slice(0, 200)}`)
        // 4xx = eroare permanentă (adresă invalidă, payload respins de Resend) — retry-ul
        // nu schimbă rezultatul. EXCEPȚIE: 429 (rate-limit Resend, 5 req/s per echipă) e
        // TRANZITORIU — trebuie reîncercat, nu abandonat definitiv. 5xx/network/429 → backoff.
        resendErr.permanent = res.status >= 400 && res.status < 500 && res.status !== 429
        // Resend respectă standardul IETF: header `retry-after` (secunde) la 429 — dacă
        // prezent, îl folosim ca bază de backoff în loc de backoff-ul liniar generic.
        const retryAfterHeader = res.headers.get('retry-after')
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN
        if (res.status === 429 && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
          resendErr.retryAfterMs = retryAfterSec * 1000
        }
        throw resendErr
      }

      // Emailul a plecat (Resend 200). Marcarea 'sent' TREBUIE verificată: dacă UPDATE-ul
      // eșuează (blip DB), rândul rămâne 'sending'/'queued' și reclaim-ul (mig 167) îl reia
      // → emailul se retrimite A DOUA OARĂ (dublu-send la facturi/notificări). Nu putem
      // reface trimiterea, dar NU tratăm rândul drept „gata" tăcut: log clar de risc.
      const { error: markErr } = await supabase.from('email_queue').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
      }).eq('id', email.id)
      if (markErr) {
        console.error(
          `[process-email-queue] DUBLU-SEND RISC: email ${email.id} (${email.template_kind} → ` +
          `${email.recipient_email}) trimis prin Resend, dar marcarea 'sent' a eșuat: ` +
          `${markErr.message}. Reclaim-ul (mig 167) îl poate retrimite.`
        )
        // Îl numărăm la 'failed' ca să fie vizibil în răspunsul funcției (marcarea, nu trimiterea,
        // a eșuat); rândul rămâne ne-'sent' și va fi reprocesat — dedup rămâne responsabilitatea
        // reclaim-ului/idempotenței din aval.
        failed++
        continue
      }
      sent++
    } catch (err) {
      const attempts = email.failed_attempts + 1
      if (err.permanent) {
        // Eroare 4xx de la Resend: fără backoff, marcăm direct 'failed'.
        await supabase.from('email_queue').update({
          status: 'failed',
          failed_attempts: attempts,
          last_error: String(err.message || err).slice(0, 500),
        }).eq('id', email.id)
      } else {
        // Backoff: respectă `Retry-After` de la Resend (429) dacă e prezent, altfel
        // backoff liniar generic (10min × attempts) pt. eșecuri 5xx/network.
        const backoffMs = err.retryAfterMs ?? attempts * 10 * 60_000
        await supabase.from('email_queue').update({
          status: attempts >= 3 ? 'failed' : 'queued',
          failed_attempts: attempts,
          last_error: String(err.message || err).slice(0, 500),
          scheduled_for: new Date(Date.now() + backoffMs).toISOString(),
        }).eq('id', email.id)
      }
      failed++
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: pending.length, sent, failed }),
  }
}

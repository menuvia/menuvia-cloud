// netlify/functions/process-email-queue.js
// Cron-triggered (Netlify scheduled): la fiecare 5 min.
// Procesează coada email_queue → trimite via Resend → marchează status.
//
// Schedule (netlify.toml):
//   [functions."process-email-queue"]
//     schedule = "*/5 * * * *"

const { createClient } = require('@supabase/supabase-js')

const { appUrl, FROM_HELLO, FOUNDER_EMAIL, LEGACY_NETLIFY_URL } = require('./lib/appUrl')

const FROM_EMAIL = process.env.EMAIL_FROM || FROM_HELLO
const REPLY_TO   = process.env.EMAIL_REPLY_TO || FOUNDER_EMAIL
// Sursa unică a domeniului (lib/appUrl.js), cu cheia și fallback-ul de
// dinainte, EXACT: doar APP_URL → menuvia.netlify.app.
const APP_URL    = appUrl({ keys: ['APP_URL'], fallback: LEGACY_NETLIFY_URL })

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

  // Notificarea RESTAURANTULUI la rezervare nouă (mig 254/255) — închide
  // paradoxul auto-confirmării: clientul primea „confirmat", localul nu afla
  // nimic fără dashboard-ul deschis. Destinatar: owner-ul (profiles.email).
  reservation_created: (d) => ({
    subject: `🍽 Rezervare nouă — ${esc(d.restaurant_name || '')}: ${esc(d.customer_name || '')}, ${esc(String(d.party_size || ''))} pers.`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:24px;margin:0 0 16px">
          Rezervare nouă la ${esc(d.restaurant_name || '')}
        </h1>
        <div style="background:#fff;border:1px solid #E8DCC9;border-radius:12px;padding:20px;margin:16px 0">
          <div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Client</div>
          <div style="color:#0A0908;font-size:18px;font-weight:600">${esc(d.customer_name || '')}</div>
          <div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:14px 0 6px">Telefon</div>
          <div style="color:#0A0908;font-size:18px;font-weight:600"><a href="tel:${esc(d.customer_phone || '')}" style="color:#C8963C;text-decoration:none">${esc(d.customer_phone || '')}</a></div>
          <div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:14px 0 6px">Data și ora</div>
          <div style="color:#0A0908;font-size:18px;font-weight:600">${esc(formatDateTimeRo(d.starts_at))}</div>
          <div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:14px 0 6px">Persoane</div>
          <div style="color:#0A0908;font-size:18px;font-weight:600">${esc(String(d.party_size || ''))}</div>
          ${
            d.special_requests
              ? `<div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:14px 0 6px">Mențiuni</div>
                 <div style="color:#0A0908;font-size:15px;white-space:pre-wrap">${esc(d.special_requests)}</div>`
              : ''
          }
        </div>
        <p style="color:#333;font-size:15px;line-height:1.55">
          ${
            d.status === 'confirmed'
              ? 'Rezervarea e <b>confirmată automat</b> — clientul a primit deja confirmarea.'
              : 'Rezervarea e <b>în așteptare</b> — confirm-o din dashboard ca clientul să primească răspunsul.'
          }
        </p>
        <a href="${APP_URL}/dashboard" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Vezi în dashboard →</a>
      </div>
    `,
  }),

  // Anulare PUBLICĂ pe cod de confirmare (mig 256/257) — perechea lui
  // reservation_created: owner-ul află că masa s-a eliberat.
  reservation_cancelled: (d) => ({
    subject: `❌ Rezervare anulată — ${esc(d.restaurant_name || '')}: ${esc(d.customer_name || '')}, ${esc(formatDateTimeRo(d.starts_at))}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        <h1 style="font-family:Georgia,serif;color:#0A0908;font-size:24px;margin:0 0 16px">
          Rezervare anulată de client
        </h1>
        <div style="background:#fff;border:1px solid #E8DCC9;border-radius:12px;padding:20px;margin:16px 0">
          <div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Client</div>
          <div style="color:#0A0908;font-size:18px;font-weight:600">${esc(d.customer_name || '')} · <a href="tel:${esc(d.customer_phone || '')}" style="color:#C8963C;text-decoration:none">${esc(d.customer_phone || '')}</a></div>
          <div style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:14px 0 6px">Era pentru</div>
          <div style="color:#0A0908;font-size:18px;font-weight:600">${esc(formatDateTimeRo(d.starts_at))} · ${esc(String(d.party_size || ''))} pers.</div>
        </div>
        <p style="color:#333;font-size:15px;line-height:1.55">Masa s-a eliberat — o poți oferi mai departe.</p>
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
    const replyEmail = FOUNDER_EMAIL
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

  // ══ Rețeaua de vânzări (mig 299) ══════════════════════════════════════
  // Șef de vânzări = afiliat FĂRĂ părinte; agent de vânzări = afiliat CU
  // părinte; pentru patron, „Agentul tău Menuvia". Deasupra fiecărui șablon
  // stă CONTRACTUL lui `template_data` — sursa de adevăr pentru producătorii
  // din PR-urile următoare (triggere/RPC-uri SQL, funcții Netlify). Reguli
  // comune tuturor celor nouă:
  //   • Orice șir venit din date intră în HTML DOAR prin esc(). Subiectul e
  //     text simplu (antet, nu HTML): trece prin subjectText(), care scoate
  //     caracterele de control — un esc() acolo ar arăta „&amp;" în inbox.
  //   • Cheile `*_url` sunt CĂI RELATIVE în aplicație („/afiliat"). Domeniul
  //     vine DOAR din APP_URL (lib/appUrl.js), prin appLink(); o valoare
  //     absolută („https://…", „//…", „javascript:…") e IGNORATĂ și se
  //     folosește calea implicită a șablonului. Producătorii SQL nu cunosc
  //     domeniul, iar prin template_data nu poate intra un link străin.
  //   • Banii vin în SUBUNITĂȚI: `*_cents` (întreg) + `currency` (ISO 4217,
  //     implicit RON), formatați ro-RO („1.234,56 lei").
  //   • `period` = 'YYYY-MM' (luna comisionului), `week` = 'YYYY-Www' (ISO),
  //     momentele = ISO 8601, afișate în Europe/Bucharest.
  //   • Orice cheie lipsă are text de rezervă: fiecare șablon se randează și
  //     cu `{}` (testul EK2), fără „undefined"/„NaN" în email.

  /**
   * agent_client_at_risk → AGENTUL clientului (producător: compute_health_scores, mig 300).
   *   restaurant_name  string             opțional (rezervă: „un restaurant de-al tău")
   *   city             string | null      opțional
   *   score            integer 0–100      opțional
   *   trend            'critical' | 'declining' | 'stable' | 'rising'   opțional
   *   agent_name       string             opțional — numele AGENTULUI, pentru salut
   *   panel_url        cale relativă      opțional, implicit /afiliat
   * NU conține — și nu are voie să conțină — date ale PATRONULUI (nume, email,
   * telefon): alerta INTERNĂ health_score_alert pleca greșit chiar către patron.
   */
  agent_client_at_risk: (d) => {
    const name = str(d.restaurant_name)
    const city = str(d.city)
    const score = scoreText(d.score)
    const trend = trendLabel(d.trend)
    return {
      subject: subjectText(`⚠️ Client în pericol: ${name || 'un restaurant de-al tău'}`),
      html: emailShell(`
        <h1 style="${H1}">Un client de-al tău are nevoie de atenție</h1>
        <p style="${P}">${greeting(d.agent_name)}</p>
        <p style="${P}">Restaurantul <b>${esc(name || 'atribuit ție')}</b>${city ? ` din ${esc(city)}` : ''} ${
          score ? `are scorul de sănătate <b>${esc(score)}</b>` : 'a intrat în zona critică a scorului de sănătate'
        }${trend ? ` (trend: ${esc(trend)})` : ''}.</p>
        <p style="${P}">Scorul (0–100) arată cât de activ e localul în Menuvia: autentificări recente, evoluția comenzilor, echipa invitată, alertele deschise și funcțiile folosite. Sub 40 e critic.</p>
        <p style="${P}"><b>Ce poți face:</b> ia legătura cu patronul în zilele următoare și întreabă-l dacă totul merge bine și dacă are nevoie de ajutor cu meniul, codurile QR sau echipa.</p>
        ${ctaButton(appLink(d.panel_url, '/afiliat'), 'Deschide panoul de agent →')}
        <p style="${NOTE}">Primești acest email pentru că restaurantul îți este atribuit ca agent Menuvia. Din motive de confidențialitate, emailul nu conține datele patronului.</p>
      `),
    }
  },

  /**
   * affiliate_application_received → ȘEFUL de vânzări: o cerere nouă în echipa lui.
   *   applicant_display_name  string | null  DOAR cu consimțământul solicitantului;
   *                                           null/lipsă → text generic, fără nume
   *   applied_at              ISO 8601       opțional
   *   head_name               string         opțional — numele ȘEFULUI, pentru salut
   *   review_url              cale relativă  opțional, implicit /afiliat
   */
  affiliate_application_received: (d) => {
    const applicant = str(d.applicant_display_name)
    const when = formatDateTimeRo(isoOrNull(d.applied_at))
    return {
      subject: subjectText(
        applicant ? `Cerere nouă în echipa ta: ${applicant}` : 'Cerere nouă în echipa ta de vânzări',
      ),
      html: emailShell(`
        <h1 style="${H1}">Cerere nouă în echipa ta</h1>
        <p style="${P}">${greeting(d.head_name)}</p>
        <p style="${P}">${
          applicant
            ? `<b>${esc(applicant)}</b> a cerut să intre în echipa ta ca agent de vânzări Menuvia.`
            : 'Cineva a cerut să intre în echipa ta ca agent de vânzări Menuvia.'
        }${when ? ` Cererea a fost trimisă ${esc(when)}.` : ''}</p>
        <p style="${P}">Decizia e a ta: aprobi sau respingi cererea din panou. Până atunci, contul solicitantului rămâne inactiv și nu poate câștiga comisioane.</p>
        ${ctaButton(appLink(d.review_url, '/afiliat'), 'Vezi cererea →')}
      `),
    }
  },

  /**
   * affiliate_application_decided → SOLICITANTUL: cererea lui a fost decisă.
   *   approved           boolean         true = aprobat, false = respins; orice
   *                                       altceva → text neutru („a primit un răspuns")
   *   head_display_name  string          opțional — numele șefului care a decis
   *   applicant_name     string          opțional — numele SOLICITANTULUI, pentru salut
   *   panel_url          cale relativă   opțional, implicit /afiliat
   */
  affiliate_application_decided: (d) => {
    const head = str(d.head_display_name)
    const approved = d.approved === true
    const rejected = d.approved === false
    const subject = approved
      ? 'Bine ai venit în echipa de vânzări Menuvia'
      : rejected
        ? 'Cererea ta de agent Menuvia nu a fost aprobată'
        : 'Cererea ta de agent Menuvia a primit un răspuns'
    const body = approved
      ? `<p style="${P}">${head ? `<b>${esc(head)}</b> ți-a aprobat cererea.` : 'Cererea ta a fost aprobată.'} Contul tău de agent de vânzări Menuvia e activ: linkul tău de recomandare te așteaptă în panou.</p>`
      : rejected
        ? `<p style="${P}">Cererea ta de a intra în echipa${head ? ` condusă de <b>${esc(head)}</b>` : ' de vânzări'} nu a fost aprobată. Dacă crezi că e o greșeală, vorbește direct cu persoana care te-a invitat.</p>`
        : `<p style="${P}">Cererea ta de a deveni agent de vânzări Menuvia a primit un răspuns. Îl găsești în panou.</p>`
    return {
      subject,
      html: emailShell(`
        <h1 style="${H1}">${esc(subject)}</h1>
        <p style="${P}">${greeting(d.applicant_name)}</p>
        ${body}
        ${ctaButton(appLink(d.panel_url, '/afiliat'), 'Deschide panoul →')}
      `),
    }
  },

  /**
   * affiliate_new_client → AGENTUL: un restaurant nou i-a fost atribuit.
   *   restaurant_name  string                 opțional; „Cont nou" când patronul
   *                                            nu și-a creat încă restaurantul
   *   source           'link' | 'agent_code'  opțional — cum a venit atribuirea
   *   agent_name       string                 opțional — pentru salut
   *   panel_url        cale relativă          opțional, implicit /afiliat
   */
  affiliate_new_client: (d) => {
    const name = str(d.restaurant_name) || 'Cont nou'
    const via =
      d.source === 'link'
        ? ' prin linkul tău de recomandare'
        : d.source === 'agent_code'
          ? ' prin codul tău de agent, introdus la înscriere'
          : ''
    return {
      subject: subjectText(`🎉 Client nou atribuit ție: ${name}`),
      html: emailShell(`
        <h1 style="${H1}">Ai un client nou</h1>
        <p style="${P}">${greeting(d.agent_name)}</p>
        <p style="${P}"><b>${esc(name)}</b> ți-a fost atribuit${esc(via)}.</p>
        <p style="${P}">Comisionul apare doar după ce clientul plătește un abonament; pe planul gratuit nu se generează comision. Îl poți ajuta acum cu meniul și codurile QR, ca să ajungă repede la primele comenzi.</p>
        ${ctaButton(appLink(d.panel_url, '/afiliat'), 'Deschide panoul de agent →')}
      `),
    }
  },

  /**
   * partner_access_requested → PATRONUL: agentul cere acces la meniu și mese.
   *   agent_display_name  string          opțional (rezervă: „Agentul tău Menuvia")
   *   restaurant_name     string          opțional
   *   owner_name          string          opțional — numele PATRONULUI, pentru salut
   *   approve_url         cale relativă   opțional, implicit /dashboard?tab=settings
   * Suprafața accesului e cea din mig 286: meniul + mesele/QR, nimic altceva.
   */
  partner_access_requested: (d) => {
    const agent = str(d.agent_display_name)
    const rest = str(d.restaurant_name)
    return {
      subject: subjectText(`${agent || 'Agentul tău Menuvia'} cere acces la meniul ${rest || 'restaurantului tău'}`),
      html: emailShell(`
        <h1 style="${H1}">Agentul tău Menuvia cere acces</h1>
        <p style="${P}">${greeting(d.owner_name)}</p>
        <p style="${P}">${agent ? `<b>${esc(agent)}</b>, agentul tău Menuvia,` : 'Agentul tău Menuvia'} cere acces la meniul și mesele ${rest ? `restaurantului <b>${esc(rest)}</b>` : 'restaurantului tău'}, ca să te ajute cu configurarea.</p>
        <p style="${P}">Accesul acoperă DOAR meniul și mesele cu codurile QR — nu comenzile, încasările, rezervările sau datele fiscale. Îl poți revoca oricând. Fără aprobarea ta, agentul nu primește niciun acces; dacă nu-l cunoști, ignoră acest email.</p>
        ${ctaButton(appLink(d.approve_url, '/dashboard?tab=settings'), 'Vezi cererea →')}
      `),
    }
  },

  /**
   * affiliate_invoice_requested → AFILIATUL (șef sau agent): emite factura pentru plată.
   *   period           'YYYY-MM'        luna comisionului
   *   amount_cents     integer          suma de facturat, în subunități
   *   currency         ISO 4217         opțional, implicit RON
   *   menuvia_billing  { company_name, cui, address }   datele de facturare ale
   *                    MENUVIA (din platform_settings); dacă lipsește oricare
   *                    câmp, emailul trimite la panou în loc să le afișeze parțial
   *   due_hint         string           opțional (ex. „până pe 10 noiembrie")
   *   affiliate_name   string           opțional — pentru salut
   *   upload_url       cale relativă    opțional, implicit /afiliat
   */
  affiliate_invoice_requested: (d) => {
    const period = periodLabel(d.period)
    const amount = fmtMoney(d.amount_cents, d.currency)
    const billing = isObj(d.menuvia_billing) ? d.menuvia_billing : {}
    const company = str(billing.company_name)
    const cui = str(billing.cui)
    const address = str(billing.address)
    const due = str(d.due_hint)
    return {
      subject: subjectText(`🧾 Încarcă factura pentru comisionul${period ? ` din ${period}` : ' tău'}`),
      html: emailShell(`
        <h1 style="${H1}">Factura pentru comisionul tău</h1>
        <p style="${P}">${greeting(d.affiliate_name)}</p>
        <p style="${P}">Comisionul tău${period ? ` pentru <b>${esc(period)}</b>` : ''} ${
          amount ? `este de <b>${esc(amount)}</b>` : 'e gata de facturat (suma exactă e în panou)'
        }. Ca să-l primești, emite o factură către Menuvia pe această sumă și încarc-o în panou.${due ? ` Termen: <b>${esc(due)}</b>.` : ''}</p>
        ${
          company && cui && address
            ? `<div style="${CARD}">
          <div style="${LABEL}">Datele de facturare Menuvia</div>
          <div style="color:#0A0908;font-size:15px;line-height:1.6"><b>${esc(company)}</b><br/>CUI: ${esc(cui)}<br/>${esc(address)}</div>
        </div>`
            : `<p style="${P}">Datele de facturare ale Menuvia le găsești în panou.</p>`
        }
        <p style="${P}">Plata pleacă după ce factura e încărcată și verificată.</p>
        ${ctaButton(appLink(d.upload_url, '/afiliat'), 'Încarcă factura →')}
      `),
    }
  },

  /**
   * affiliate_payout_sent → AFILIATUL: transferul comisionului a plecat.
   *   amount_cents        integer         suma transferată, în subunități
   *   currency            ISO 4217        opțional, implicit RON
   *   period              'YYYY-MM'       luna comisionului
   *   transfer_reference  string          opțional (ex. id-ul transferului Stripe „tr_…")
   *   affiliate_name      string          opțional — pentru salut
   *   panel_url           cale relativă   opțional, implicit /afiliat
   */
  affiliate_payout_sent: (d) => {
    const period = periodLabel(d.period)
    const amount = fmtMoney(d.amount_cents, d.currency)
    const ref = str(d.transfer_reference)
    return {
      subject: subjectText(`✅ Plata comisionului${period ? ` din ${period}` : ''} a plecat${amount ? `: ${amount}` : ''}`),
      html: emailShell(`
        <h1 style="${H1}">Plata comisionului a plecat</h1>
        <p style="${P}">${greeting(d.affiliate_name)}</p>
        <p style="${P}">Am trimis plata comisionului tău${period ? ` pentru <b>${esc(period)}</b>` : ''}${amount ? `: <b>${esc(amount)}</b>` : ''}.${ref ? ` Referința transferului: <code>${esc(ref)}</code>.` : ''}</p>
        <p style="${P}">Durata până în contul bancar depinde de calendarul de plăți Stripe și de bancă.</p>
        ${ctaButton(appLink(d.panel_url, '/afiliat'), 'Vezi plățile →')}
      `),
    }
  },

  /**
   * affiliate_payout_blocked → AFILIATUL: plata e blocată și cere o acțiune.
   *   amount_cents  integer         suma blocată, în subunități
   *   currency      ISO 4217        opțional, implicit RON
   *   period        'YYYY-MM'       luna comisionului
   *   reason_code   string          una din PAYOUT_BLOCK_REASONS (mai jos); un cod
   *                                 necunoscut primește text generic + codul, ca referință
   *   affiliate_name string         opțional — pentru salut
   *   action_url    cale relativă   opțional, implicit /afiliat
   */
  affiliate_payout_blocked: (d) => {
    const period = periodLabel(d.period)
    const amount = fmtMoney(d.amount_cents, d.currency)
    const code = str(d.reason_code)
    const reason = Object.prototype.hasOwnProperty.call(PAYOUT_BLOCK_REASONS, code)
      ? PAYOUT_BLOCK_REASONS[code]
      : null
    return {
      subject: subjectText(`⚠️ Plata comisionului${period ? ` din ${period}` : ''} e blocată`),
      html: emailShell(`
        <h1 style="${H1}">Plata comisionului tău e blocată</h1>
        <p style="${P}">${greeting(d.affiliate_name)}</p>
        <p style="${P}">Nu am putut trimite plata comisionului${period ? ` pentru <b>${esc(period)}</b>` : ''}${amount ? ` (<b>${esc(amount)}</b>)` : ''}.</p>
        <p style="${P}"><b>Motiv:</b> ${
          reason
            ? esc(reason)
            : `plata are nevoie de o acțiune din partea ta — detaliile sunt în panou${code ? ` (cod: <code>${esc(code)}</code>)` : ''}.`
        }</p>
        <p style="${P}">După ce rezolvi problema, plata poate fi reluată.</p>
        ${ctaButton(appLink(d.action_url, '/afiliat'), 'Rezolvă în panou →')}
      `),
    }
  },

  /**
   * founder_weekly_digest → FONDATORUL: raportul de luni al rețelei.
   *   week        'YYYY-Www'   săptămâna ISO raportată
   *   needs_you   [{ kind, label, count, url }]   PRIMA secțiune, evidențiată;
   *               un element-șir e tratat ca `label`; `url` = cale relativă
   *               (implicit /founder); listă goală → „nimic nu te așteaptă"
   *   network     { heads, agents, pending_old }  întregi (pending_old = cereri
   *               neaprobate de peste 7 zile)
   *   sales       { new_attributions, first_paid, attributed_mrr_cents, organic_mrr_cents }
   *   money       { accrued_cents, clawback_cents, payable_cents,
   *                 payouts_by_status: { <status>: count | { count, amount_cents } } }
   *   risks       [{ kind, label, count, url }]   (sau șiruri)
   *   system      { emails_failed, stripe_events_failed }
   * Fiecare secțiune apare DOAR dacă cheia ei e prezentă (obiect / listă).
   */
  founder_weekly_digest: (d) => {
    const week = weekLabel(d.week)
    let subject = `📋 Raportul de luni${week ? ` — ${week}` : ''}`
    if (Array.isArray(d.needs_you)) {
      const n = digestNeedsCount(d.needs_you)
      subject += n > 0 ? `: ${n} ${n === 1 ? 'lucru te așteaptă' : 'lucruri te așteaptă'}` : ': nimic nu te așteaptă'
    }
    return { subject: subjectText(subject), html: founderDigestHtml(d, week) }
  },

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
      // Aceeași zonă ca ora (audit aug 2026): fără ea, pe Netlify (TZ=UTC) o
      // rezervare de duminică 00:30 România apărea „sâmbătă … 00:30" — zi
      // greșită cu oră corectă, exact combinația care păcălește owner-ul.
      timeZone: 'Europe/Bucharest',
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

// ── Utilitare pentru șabloanele rețelei de vânzări (mig 299) ───────────────
// Toate întorc TEXT SIMPLU; apelantul îl trece prin esc() în HTML.

const H1 = 'font-family:Georgia,serif;color:#0A0908;font-size:24px;margin:0 0 16px'
const P = 'color:#333;font-size:16px;line-height:1.55'
const NOTE = 'color:#666;font-size:13px;line-height:1.5;margin-top:24px'
const CARD = 'background:#fff;border:1px solid #E8DCC9;border-radius:12px;padding:20px;margin:16px 0'
const LABEL = 'color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px'

function emailShell(inner) {
  return `
      <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf7">
        ${inner}
      </div>
    `
}

// `href` deja construit de appLink() (originea APP_URL + o cale validată).
function ctaButton(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;background:#C8963C;color:#0A0908;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">${esc(label)}</a>`
}

function greeting(name) {
  const n = str(name)
  return n ? `Bună, ${esc(n)},` : 'Bună,'
}

/** Șir curățat sau '' (numerele, obiectele, null → '' — fără „[object Object]"). */
function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Întreg sigur (număr sau șir de cifre), altfel null. */
function toInt(v) {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : NaN
  return Number.isSafeInteger(n) ? n : null
}

/**
 * Subiectul e un ANTET de text simplu, nu HTML: fără esc() (un „&" ar apărea
 * „&amp;" în inbox), dar fără caractere de control (CR/LF) și plafonat.
 */
function subjectText(s) {
  return String(s)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
}

/**
 * Link în aplicație: originea vine DOAR din APP_URL; `raw` e acceptat numai
 * ca o CALE relativă („/afiliat?tab=x"). Orice altceva — URL absolut, „//…",
 * backslash, spații, caractere de control, alt tip — cade pe `fallbackPath`.
 */
function appLink(raw, fallbackPath) {
  const p = str(raw)
  const ok =
    p.startsWith('/') && !p.startsWith('//') && !/[\\\s\u0000-\u001f\u007f]/.test(p)
  if (ok) {
    try {
      if (new URL(APP_URL + p).origin === APP_URL) return APP_URL + p
    } catch {
      /* cade pe calea implicită */
    }
  }
  return APP_URL + fallbackPath
}

/** Bani din subunități: 123456 + 'RON' → „1.234,56 lei"; invalid → ''. */
function fmtMoney(cents, currency) {
  const n = toInt(cents)
  if (n === null) return ''
  const c = str(currency).toUpperCase()
  const cur = /^[A-Z]{3}$/.test(c) ? c : 'RON'
  const amount = new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100)
  return cur === 'RON' ? `${amount} lei` : `${amount} ${cur}`
}

function fmtCount(v) {
  const n = toInt(v)
  return n === null ? '—' : new Intl.NumberFormat('ro-RO').format(n)
}

function scoreText(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 && n <= 100 ? `${Math.round(n)}/100` : ''
}

function trendLabel(v) {
  return { critical: 'critic', declining: 'în scădere', stable: 'stabil', rising: 'în creștere' }[str(v)] || ''
}

function isoOrNull(v) {
  const s = str(v)
  return s && Number.isFinite(new Date(s).getTime()) ? s : null
}

/** 'YYYY-MM' → „octombrie 2026"; altfel ''. */
function periodLabel(v) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(str(v))
  if (!m) return ''
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString('ro-RO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** 'YYYY-Www' (ISO 8601) → „săptămâna 43 (19–25 octombrie 2026)"; altfel ''. */
function weekLabel(v) {
  const m = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(str(v))
  if (!m) return ''
  const year = Number(m[1])
  const week = Number(m[2])
  // Săptămâna 1 e cea care conține 4 ianuarie; ziua 1 = luni.
  const jan4 = Date.UTC(year, 0, 4)
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7
  const monday = new Date(jan4 + ((week - 1) * 7 - jan4Dow) * 86400000)
  const sunday = new Date(monday.getTime() + 6 * 86400000)
  const day = (dt) => dt.toLocaleDateString('ro-RO', { day: 'numeric', timeZone: 'UTC' })
  const full = (dt) =>
    dt.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const range =
    monday.getUTCMonth() === sunday.getUTCMonth()
      ? `${day(monday)}–${full(sunday)}`
      : `${monday.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', timeZone: 'UTC' })} – ${full(sunday)}`
  return `săptămâna ${week} (${range})`
}

// Codurile cunoscute pentru affiliate_payout_blocked (producătorul: plățile
// automate). Un cod nou fără text aici primește mesajul generic + codul.
const PAYOUT_BLOCK_REASONS = {
  stripe_account_missing: 'nu ai conectat încă un cont Stripe pentru plăți.',
  stripe_onboarding_incomplete:
    'contul tău Stripe nu e încă activ pentru transferuri — finalizează verificarea în Stripe.',
  invoice_missing: 'factura pentru această perioadă nu a fost încărcată.',
  invoice_rejected: 'factura încărcată nu corespunde sumei sau datelor de facturare — încarcă una corectă.',
  contract_not_accepted: 'nu ai acceptat încă, în aplicație, contractul de agent.',
  legal_profile_missing: 'lipsesc datele tale de facturare (PFA sau SRL, cu CUI).',
  transfer_failed: 'transferul a fost respins de Stripe — verifică starea contului tău Stripe.',
}

const PAYOUT_STATUS_LABELS = {
  draft: 'ciornă',
  awaiting_invoice: 'așteaptă factura',
  invoice_matched: 'factură primită',
  processing: 'în curs',
  paid: 'plătite',
  failed: 'eșuate',
  on_hold: 'în așteptare (manual)',
  canceled: 'anulate',
}

/** Elementele de listă din digest: obiect {kind,label,count,url} sau șir. */
function digestItems(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((it) => (typeof it === 'string' ? { label: it } : isObj(it) ? it : null))
    .filter(Boolean)
}

/** Totalul pentru subiect: suma `count`-urilor; un element fără count = 1. */
function digestNeedsCount(list) {
  return digestItems(list).reduce((acc, it) => {
    const n = toInt(it.count)
    return acc + (n === null ? 1 : Math.max(0, n))
  }, 0)
}

function digestItemRows(list, fallbackPath) {
  return digestItems(list)
    .map((it) => {
      const label = str(it.label) || str(it.kind) || 'Acțiune'
      const n = toInt(it.count)
      return `<tr style="border-top:1px solid #f3efe7">
            <td style="padding:8px 0;color:#0A0908">${esc(label)}${n === null ? '' : ` <b>(${esc(fmtCount(n))})</b>`}</td>
            <td style="padding:8px 0;text-align:right"><a href="${esc(appLink(it.url, fallbackPath))}" style="color:#C8963C;text-decoration:none;font-weight:600">Deschide →</a></td>
          </tr>`
    })
    .join('')
}

function digestTable(key, title, rows) {
  return `
      <div data-digest="${key}" style="margin-top:20px">
        <h2 style="font-family:Georgia,serif;font-size:18px;color:#0A0908;margin:0 0 8px">${esc(title)}</h2>
        <table style="width:100%;border-collapse:collapse">
          ${rows
            .map(
              ([label, value, alarm]) =>
                `<tr><td style="padding:6px 0;color:#666">${esc(label)}</td><td style="padding:6px 0;text-align:right;font-weight:600;color:${alarm ? '#A93232' : '#0A0908'}">${esc(value || '—')}</td></tr>`,
            )
            .join('')}
        </table>
      </div>`
}

function founderDigestHtml(d, week) {
  const parts = []

  // 1. „Ce te așteaptă pe tine" — PRIMA și evidențiată: e singurul motiv
  //    pentru care fondatorul deschide emailul.
  if (Array.isArray(d.needs_you)) {
    const rows = digestItemRows(d.needs_you, '/founder')
    parts.push(`
      <div data-digest="needs_you" style="background:#fff;border:2px solid #C8963C;border-radius:12px;padding:18px;margin-bottom:8px">
        <h2 style="font-family:Georgia,serif;font-size:20px;color:#0A0908;margin:0 0 8px">Ce te așteaptă pe tine</h2>
        ${
          rows
            ? `<table style="width:100%;border-collapse:collapse">${rows}</table>`
            : `<p style="${P};margin:0">Nimic nu te așteaptă săptămâna asta.</p>`
        }
      </div>`)
  }

  if (isObj(d.network)) {
    const n = d.network
    const pendingOld = toInt(n.pending_old)
    parts.push(
      digestTable('network', 'Rețeaua', [
        ['Șefi de vânzări activi', fmtCount(n.heads)],
        ['Agenți de vânzări activi', fmtCount(n.agents)],
        ['Cereri neaprobate de peste 7 zile', fmtCount(n.pending_old), pendingOld !== null && pendingOld > 0],
      ]),
    )
  }

  if (isObj(d.sales)) {
    const s = d.sales
    parts.push(
      digestTable('sales', 'Vânzările', [
        ['Restaurante atribuite noi', fmtCount(s.new_attributions)],
        ['Prime plăți (conversii)', fmtCount(s.first_paid)],
        ['MRR adus de rețea', fmtMoney(s.attributed_mrr_cents, 'RON')],
        ['MRR organic', fmtMoney(s.organic_mrr_cents, 'RON')],
      ]),
    )
  }

  if (isObj(d.money)) {
    const m = d.money
    const rows = [
      ['Comisioane acumulate', fmtMoney(m.accrued_cents, 'RON')],
      ['Retrageri (clawback)', fmtMoney(m.clawback_cents, 'RON')],
      ['De plătit', fmtMoney(m.payable_cents, 'RON')],
    ]
    if (isObj(m.payouts_by_status)) {
      for (const [status, v] of Object.entries(m.payouts_by_status)) {
        const label = Object.prototype.hasOwnProperty.call(PAYOUT_STATUS_LABELS, status)
          ? PAYOUT_STATUS_LABELS[status]
          : status
        const count = isObj(v) ? v.count : v
        const amount = isObj(v) && toInt(v.amount_cents) !== null ? ` · ${fmtMoney(v.amount_cents, 'RON')}` : ''
        rows.push([`Plăți: ${label}`, `${fmtCount(count)}${amount}`, status === 'failed' || status === 'on_hold'])
      }
    }
    parts.push(digestTable('money', 'Banii', rows))
  }

  if (Array.isArray(d.risks) && d.risks.length > 0) {
    const rows = digestItemRows(d.risks, '/founder')
    if (rows) {
      parts.push(`
      <div data-digest="risks" style="margin-top:20px">
        <h2 style="font-family:Georgia,serif;font-size:18px;color:#A93232;margin:0 0 8px">Riscuri</h2>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`)
    }
  }

  if (isObj(d.system)) {
    const s = d.system
    const ef = toInt(s.emails_failed)
    const sf = toInt(s.stripe_events_failed)
    parts.push(
      digestTable('system', 'Sistemul', [
        ['Emailuri eșuate', fmtCount(s.emails_failed), ef !== null && ef > 0],
        ['Evenimente Stripe eșuate', fmtCount(s.stripe_events_failed), sf !== null && sf > 0],
      ]),
    )
  }

  return emailShell(`
        <h1 style="${H1}">Raportul de luni</h1>
        ${week ? `<p style="color:#666;margin:-8px 0 16px">${esc(week)}</p>` : ''}
        ${parts.length > 0 ? parts.join('') : `<p style="${P}">Raportul nu conține încă date.</p>`}
        ${ctaButton(appLink(null, '/founder'), 'Deschide panoul de fondator →')}
        <p style="${NOTE}">Raport generat automat de Menuvia din baza de date, la momentul generării.</p>
  `)
}

// Alertă Slack best-effort (nu aruncă, no-op fără webhook). Folosită DOAR pentru
// eșecuri de CONFIGURARE (cheie Resend invalidă/rotită → 401/403): fără ea,
// întreaga coadă (facturi, notificări de plată) devine 'failed' TĂCUT, iar
// funcția întoarce mereu 200. Health-check-ul verifică doar prezența cheii, nu
// validitatea — deci ăsta e singurul semnal că emailurile nu mai pleacă.
async function postEmailAlert(message) {
  const slackWebhook = process.env.SLACK_WEBHOOK_URL
  if (!slackWebhook) return
  try {
    const resp = await fetch(slackWebhook, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `🔴 process-email-queue: ${message}` }),
    })
    if (!resp.ok) console.error(`[process-email-queue] alertă Slack non-ok (${resp.status})`)
  } catch (e) {
    console.error('[process-email-queue] alertă Slack a eșuat:', e && e.message)
  }
}

// ── Main handler ──────────────────────────────────────────────
exports.handler = async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const { SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY } = process.env

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
  // Eșecuri de autentificare Resend (401/403) = problemă de CONFIG (cheie
  // invalidă/rotită), nu email individual → alertăm o singură dată la final.
  let authFailures = 0

  for (const email of pending) {
    // Deja claim-uit ('sending') de claim_email_batch — fără re-marcare aici.

    const template = TEMPLATES[email.template_kind]
    if (!template) {
      // Template necunoscut aici ≠ eroare permanentă: enumul email_template_kind poate fi
      // extins într-o migrație fără ca deploy-ul acestui fișier să fi prins încă handler-ul.
      // Cap pe TIMP (24h de la creare), NU pe failed_attempts: (a) deploy-ul JS poate
      // întârzia ore față de migrație — 3 încercări/30min pierdeau emailul înainte de
      // deploy; (b) NU incrementăm failed_attempts, ca să nu epuizăm bugetul de retry
      // Resend când template-ul devine cunoscut. Peste 24h → 'failed' (enum orfan real).
      const ageMs = Date.now() - new Date(email.created_at).getTime()
      const tooOld = Number.isFinite(ageMs) && ageMs > 24 * 60 * 60_000
      await supabase.from('email_queue').update({
        status: tooOld ? 'failed' : 'queued',
        last_error: `Unknown template: ${email.template_kind}`,
        scheduled_for: new Date(Date.now() + 15 * 60_000).toISOString(),
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
        // OPT-3: un TCP agățat spre Resend consuma întreaga invocare (10s) —
        // timeout explicit; AbortError cade pe ramura de retry existentă.
        signal: AbortSignal.timeout(8000),
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
        resendErr.status = res.status
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
      if (err.status === 401 || err.status === 403) authFailures++
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

  // Semnal de CONFIG rupt: dacă am prins 401/403 de la Resend, cheia e
  // invalidă/rotită → toată coada (facturi, notificări) se pierde tăcut.
  // Alertăm o singură dată pe rulare (best-effort).
  if (authFailures > 0) {
    await postEmailAlert(
      `${authFailures}/${pending.length} emailuri respinse cu 401/403 de Resend — ` +
      `cheia RESEND_API_KEY pare invalidă/rotită. Coada de email (facturi, notificări) ` +
      `nu mai pleacă până la remedierea cheii.`,
    )
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: pending.length, sent, failed, authFailures }),
  }
}

// Pentru testele din tests/functions (EK1–EK4): fiecare valoare din enumul
// email_template_kind trebuie să aibă șablon, iar șabloanele se randează pur.
exports.TEMPLATES = TEMPLATES

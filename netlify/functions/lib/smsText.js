// netlify/functions/lib/smsText.js
// Textele SMS-urilor către OASPETE (lotul L8b): 3 șabloane în cele 7 limbi ale
// meniului, ora pe fusul LOCALULUI, iar textul final e din setul GSM-7 de BAZĂ
// (GSM 03.38, un septet pe caracter) în TOATE limbile.
//
// Constrângerea REALĂ (nu „ASCII”): un singur caracter din afara tabelei GSM
// 03.38 trece mesajul pe UCS-2 (70 de caractere pe segment în loc de 160) și
// dublează costul; caracterele din tabela EXTINSĂ (€ [ ] { } | ~ ^ \) sunt
// GSM-7, dar costă câte DOUĂ septete. Tabela de bază CONȚINE literele é è à ù
// ì ò ä ö ü ñ ß æ ø å (și É Ä Ö Ü Ñ Æ Ø Å Ç), deci acestea RĂMÂN — germana se
// scrie cu umlauturi, italiana cu „è”, franceza cu „é/à”. Ce NU e în tabelă și
// forța UCS-2 până acum: ă â î ș ț, ê ô û ç ë ï, á í ó ú ő ű, ghilimelele,
// liniuțele și spațiile tipografice, emoji, alte alfabete. Codul vechi
// transliterea doar ă/â/î/ș/ț și doar în numele restaurantului.
// `toGsm7` reduce ORICE text la tabela de bază: păstrează ce e deja în ea,
// mapează semnele tipografice și tabela extinsă pe echivalente de un septet,
// scoate diacriticele din rest (NFKD), șterge caracterele INVIZIBILE de
// formatare (ZWSP, soft hyphen, BOM, LRM/RLM — altfel ar ieși „?” vizibil în
// numele lipit dintr-o pagină web), iar ce rămâne (alt alfabet, emoji) devine „?”.
//
// Româna pe București e BYTE-identică cu worker-ul vechi pe ORICE text care era
// deja în tabela de bază, inclusiv „Café Müller” (oracolul SO din
// tests/functions/sms-legacy-oracle.test.js); singurele diferențe sunt exact
// textele pe care codul vechi le lăsa în afara ei (ê, ’, –, [ …), unde codul nou
// dă `toGsm7(<textul vechi>)` (SO3).
//
// Toleranță: nicio funcție de aici nu aruncă pe date stricate — o randare care
// aruncă face rândul `failed` imediat.
'use strict'

const { LOCALES, DEFAULT_TZ, safeTimeZone } = require('./emailLang')

// ── GSM-7 (GSM 03.38) ───────────────────────────────────────────
// Tabela de BAZĂ, toate cele 128 de poziții MINUS LF, CR și ESC (LF/CR se
// mapează pe spațiu, ESC deschide tabela extinsă): 125 de caractere, fiecare
// un singur septet. Backtick-ul nu există deloc în GSM-7.
const GSM7_BASIC =
  '@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_SET = new Set(GSM7_BASIC)

// Ce nu e în tabelă și nu se reduce corect prin NFKD: literele fără
// descompunere (œ, ł, đ…), semnele tipografice, tabela extinsă (2 septete) și
// backtick-ul.
const SPECIAL = Object.freeze({
  ẞ: 'SS', œ: 'oe', Œ: 'OE', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ð: 'd', Ð: 'D', þ: 'th', Þ: 'Th',
  ı: 'i', ħ: 'h', Ħ: 'H', ŧ: 't', Ŧ: 'T', ŋ: 'n', Ŋ: 'N', ĸ: 'k',
  '€': 'EUR',
  // ghilimele și apostrofuri tipografice
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '´': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '«': '"', '»': '"', '‹': "'", '›': "'",
  // liniuțe, puncte de suspensie, buline
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...', '·': '-', '•': '-',
  // spații ne-ASCII (NBSP, spațiul îngust al lui Intl, spații de tipografie)
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  // tabela extinsă GSM-7 (2 septete fiecare) + backtick-ul (absent din GSM-7)
  '[': '(', ']': ')', '{': '(', '}': ')', '|': '/', '\\': '/', '~': '-', '^': "'", '`': "'",
  '\t': ' ', '\n': ' ', '\r': ' ',
})
const FORMAT_CHAR_RE = /^\p{Cf}$/u
const MARKS_RE = /\p{M}/gu

/** Orice text → caractere din tabela GSM-7 de BAZĂ (un septet fiecare). */
function toGsm7(text) {
  const s = String(text == null ? '' : text).normalize('NFC')
  let out = ''
  for (const ch of s) {
    if (GSM7_SET.has(ch)) out += ch
    else if (Object.prototype.hasOwnProperty.call(SPECIAL, ch)) out += SPECIAL[ch]
    else if (FORMAT_CHAR_RE.test(ch)) continue
    else {
      const base = ch.normalize('NFKD').replace(MARKS_RE, '')
      // Un semn diacritic rămas singur (fără literă de bază) dispare.
      if (base === '') continue
      // Rămășițele (alt alfabet, emoji) devin '?': un SMS lizibil pe jumătate e
      // mai bun decât unul pe UCS-2 la dublu preț.
      out += [...base].every((c) => GSM7_SET.has(c)) ? base : '?'
    }
  }
  return out
}

function isGsm7(text) {
  for (const ch of String(text)) if (!GSM7_SET.has(ch)) return false
  return true
}

// ── Data și ora ─────────────────────────────────────────────────
// Româna: EXACT formatul de dinainte ('15 iul 19:30' — lunile scurte RO n-au
// diacritice, primul punct scos), doar fusul nu mai e fixat pe București.
function formatWhenRo(iso, timeZone) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const date = d.toLocaleDateString('ro-RO', {
      day: 'numeric', month: 'short', timeZone,
    }).replace('.', '')
    const time = d.toLocaleTimeString('ro-RO', {
      hour: '2-digit', minute: '2-digit', timeZone,
    })
    return `${date} ${time}`
  } catch {
    return ''
  }
}

// Celelalte limbi: ziua + luna scurtă + ora în locale-ul limbii ('15 Jul 19:30',
// '15. März 19:30', '15 déc. 19:30', 'marc. 15. 19:30' — á nu e în GSM-7),
// reduse la tabela de bază.
function formatWhen(iso, ctx) {
  const timeZone = safeTimeZone(ctx && ctx.timeZone)
  const lang = ctx && ctx.lang
  if (!lang || lang === 'ro' || !LOCALES[lang]) return formatWhenRo(iso, timeZone)
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return ''
    const locale = LOCALES[lang]
    const date = d.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone })
    const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })
    return toGsm7(`${date} ${time}`)
  } catch {
    return ''
  }
}

// ── Textele ─────────────────────────────────────────────────────
// Scrise DIRECT în tabela GSM-7 de bază (SM4), ca lungimea să fie cea trimisă:
// literele din tabelă (é è à ä ö ü ß ñ ¿ ¡) se folosesc, celelalte (á í ó ú ê
// ô ç ő ű) nu există — de aceea „Codigo”, „Un imprévu ?” în loc de „Un
// empêchement ?”, iar maghiara e scrisă fără niciun accent (á/ó/ő lipsesc, iar
// un text pe jumătate accentuat se citește mai rău). Registrul = cel al
// fluxului oaspetelui (src/lib/guestStrings.ts) și al emailului de reminder:
// „du” (de), „tu” (it, es), „te” (hu), „vous” (fr).
// `ro` = textul vechi, exact. Placeholderele: {name} {when} {party} {code}
// {phone} {id}.
const SMS_STRINGS = Object.freeze({
  ro: {
    fallback_name: 'Restaurantul',
    confirmed: '{name}: Rezervare confirmata {when} pentru {party} pers. Cod: {code}.',
    confirmed_phone: ' Modificari? {phone}',
    reminder: '{name}: Reminder rezervare {when} pentru {party} pers. Cod: {code}.',
    reminder_phone: ' Nu ajungi? {phone}',
    pickup: '{name}: Comanda #{id} este gata de ridicare. Te asteptam!',
  },
  en: {
    fallback_name: 'The restaurant',
    confirmed: '{name}: Booking confirmed {when}, table for {party}. Code: {code}.',
    confirmed_phone: ' Changes? {phone}',
    reminder: '{name}: Reminder - booking {when}, table for {party}. Code: {code}.',
    reminder_phone: " Can't make it? {phone}",
    pickup: '{name}: Order #{id} is ready for pickup. See you soon!',
  },
  de: {
    fallback_name: 'Das Restaurant',
    confirmed: '{name}: Reservierung bestätigt {when}, Tisch für {party}. Code: {code}.',
    confirmed_phone: ' Änderungen? {phone}',
    reminder: '{name}: Erinnerung an deine Reservierung {when}, Tisch für {party}. Code: {code}.',
    reminder_phone: ' Verhindert? {phone}',
    pickup: '{name}: Deine Bestellung #{id} ist abholbereit. Bis gleich!',
  },
  fr: {
    fallback_name: 'Le restaurant',
    confirmed: '{name}: Réservation confirmée {when}, table pour {party}. Code : {code}.',
    confirmed_phone: ' Un changement ? {phone}',
    reminder: '{name}: Rappel de réservation {when}, table pour {party}. Code : {code}.',
    reminder_phone: ' Un imprévu ? {phone}',
    pickup: '{name}: Votre commande #{id} vous attend, à tout de suite !',
  },
  it: {
    fallback_name: 'Il ristorante',
    confirmed: '{name}: Prenotazione confermata {when}, tavolo per {party}. Codice: {code}.',
    confirmed_phone: ' Modifiche? {phone}',
    reminder: '{name}: Promemoria prenotazione {when}, tavolo per {party}. Codice: {code}.',
    reminder_phone: ' Non riesci a venire? {phone}',
    pickup: "{name}: L'ordine #{id} è pronto per il ritiro. A presto!",
  },
  hu: {
    fallback_name: 'Az etterem',
    confirmed: '{name}: Foglalas visszaigazolva {when}, {party} fo. Kod: {code}.',
    confirmed_phone: ' Valtozas? {phone}',
    reminder: '{name}: Emlekezteto - foglalas {when}, {party} fo. Kod: {code}.',
    reminder_phone: ' Nem tudsz jonni? {phone}',
    pickup: '{name}: A #{id} rendeles atveheto. Varunk!',
  },
  es: {
    fallback_name: 'El restaurante',
    confirmed: '{name}: Reserva confirmada {when}, mesa para {party}. Codigo: {code}.',
    confirmed_phone: ' ¿Cambios? {phone}',
    reminder: '{name}: Recordatorio de reserva {when}, mesa para {party}. Codigo: {code}.',
    reminder_phone: ' ¿No puedes venir? {phone}',
    pickup: '{name}: Pedido #{id} listo para recoger. ¡Te esperamos!',
  },
})

const RO_SMS_CTX = Object.freeze({ lang: 'ro', timeZone: DEFAULT_TZ })
const MAX_LEN = 160

function stringsFor(lang) {
  return SMS_STRINGS[lang] || SMS_STRINGS.ro
}

// Un singur pas de înlocuire: o valoare care conține „{code}” nu se re-expandează.
function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m))
}

function langOf(ctx) {
  const l = ctx && ctx.lang
  return typeof l === 'string' && SMS_STRINGS[l] ? l : 'ro'
}

// Rezervare: textul de bază + telefonul localului dacă încape în 160; altfel
// doar baza (codul și ora nu se taie niciodată pentru un telefon lung).
function reservationText(kind, d, ctx) {
  const lang = langOf(ctx)
  const s = stringsFor(lang)
  const data = d || {}
  const name = toGsm7(data.restaurant_name || s.fallback_name).slice(0, 30)
  const base = fill(s[kind], {
    name,
    when: formatWhen(data.starts_at, { lang, timeZone: ctx && ctx.timeZone }),
    party: toGsm7(data.party_size || '?'),
    code: toGsm7(data.confirmation_code || '-'),
  })
  const withPhone = data.restaurant_phone
    ? `${base}${fill(s[`${kind}_phone`], { phone: toGsm7(data.restaurant_phone) })}`
    : base
  return (withPhone.length <= MAX_LEN ? withPhone : base).slice(0, MAX_LEN)
}

const TEMPLATES = Object.freeze({
  reservation_confirmed: (d, ctx = RO_SMS_CTX) => reservationText('confirmed', d, ctx),
  pickup_ready: (d, ctx = RO_SMS_CTX) => {
    const lang = langOf(ctx)
    const s = stringsFor(lang)
    const data = d || {}
    const name = toGsm7(data.restaurant_name || s.fallback_name).slice(0, 40)
    return fill(s.pickup, { name, id: toGsm7(data.short_id || '') }).slice(0, MAX_LEN)
  },
  // Reminder pre-sosire (mig 233/234) — anti no-show pe rezervările telefonice.
  reservation_reminder: (d, ctx = RO_SMS_CTX) => reservationText('reminder', d, ctx),
})

module.exports = {
  SMS_STRINGS,
  TEMPLATES,
  RO_SMS_CTX,
  MAX_LEN,
  GSM7_BASIC,
  toGsm7,
  isGsm7,
  formatWhen,
}

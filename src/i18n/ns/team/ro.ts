// Namespace `team` — fila Echipă (lotul L6b): TeamManager cu contorul de
// membri, formularul de invitație (rolurile, trimiterea, refuzurile lui
// `send-invite` pe `code`), invitațiile în așteptare, lista membrilor
// (schimbarea rolului, eliminarea, modalul de confirmare) și toast-urile.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — pluralul fals al contorului („0
// membri”, „20 membri”, nu „20 de membri”: regula veche era doar 1 → „membru”),
// „Se trimite...” cu TREI puncte, „Eroare la trimitere” ca rezervă când
// serverul nu dă text. În română textul ROMÂNESC al serverului (`error` din
// `send-invite`) se afișează ca atare, ca înainte; în altă limbă se alege după
// `code` (`inv_err_<code>`), altfel rezerva.
// Rolurile: ACEEAȘI traducere ca `invite.role*` / `waiter.role_*` (Owner /
// Manager / Waiter / Kitchen; Propriétaire / Manager / Serveur / Cuisine;
// Inhaber / Manager / Service / Küche) — valorile din DB (`owner`, `manager`,
// `waiter`, `kitchen`) nu se schimbă, se traduce doar afișarea.
// NU e aici (din `common`): „Anulează”, „Reîncearcă”.
// NU se traduc (date): numele și emailurile membrilor, numele restaurantului.
const ro = {
  role_owner: 'Proprietar',
  role_manager: 'Manager',
  role_waiter: 'Ospătar',
  role_kitchen: 'Bucătărie',

  members_count: {
    one: '{n} membru · Invitații expiră în 7 zile',
    few: '{n} membri · Invitații expiră în 7 zile',
    other: '{n} membri · Invitații expiră în 7 zile',
  },
  founder_note:
    'În modul fondator vezi echipa, dar invitațiile le trimite doar proprietarul sau managerul ' +
    'restaurantului, din contul lui.',
  invite_title: 'Invită un membru nou',
  email: 'Email',
  email_placeholder: 'ion@restaurant.ro',
  role: 'Rol',
  sending: 'Se trimite...',
  send: 'Trimite invitație',
  inv_sent: 'Invitație trimisă la {email}',
  inv_revoked: 'Invitație anulată',
  err_revoke: 'Eroare la anulare',
  member_removed: 'Membru eliminat',
  err_remove: 'Eroare la eliminare',
  owner_forbidden: 'Promovarea la proprietar nu este permisă',
  role_updated: 'Rol actualizat',
  err_role: 'Eroare la actualizare rol',
  err_load: 'Nu s-a putut încărca echipa',

  // ── Refuzurile invitației ──
  inv_err_send: 'Eroare la trimitere',
  inv_err_network: 'Eroare de conexiune. Verifică internetul.',
  // Doar în celelalte limbi (în română serverul își trimite textul): `code`
  // din `send-invite.js` → text propriu.
  inv_err_server_config: 'Invitațiile nu sunt pornite pe server momentan. Încearcă mai târziu.',
  inv_err_email_not_configured:
    'Trimiterea emailurilor nu e pornită momentan. Scrie-ne și te ajutăm.',
  inv_err_missing_fields: 'Completează adresa de email și rolul.',
  inv_err_invalid_email: 'Adresa de email nu e validă.',
  inv_err_invalid_role: 'Rolul ales nu există. Alege Manager, Ospătar sau Bucătărie.',
  inv_err_auth_invalid: 'Sesiunea a expirat. Intră din nou în cont.',
  inv_err_forbidden: 'Doar patronul sau managerul pot trimite invitații.',
  inv_err_rate_limit_unavailable:
    'Nu am putut verifica limita de invitații. Reîncearcă în câteva momente.',
  inv_err_rate_limited:
    'Ai trimis prea multe invitații în ultimele 24 ore. Reîncearcă mâine sau contactează suportul.',
  inv_err_already_member: 'Acest utilizator este deja membru.',
  inv_err_invite_create_failed: 'Nu am putut crea invitația. Reîncearcă.',
  inv_err_email_send_uncertain:
    'Nu am putut confirma trimiterea emailului. Invitația apare în listă; dacă nu ajunge în câteva ' +
    'minute, trimite-o din nou.',
  inv_err_email_send_failed: 'Emailul cu invitația nu a putut fi trimis. Reîncearcă.',

  pending_title: 'Invitații în așteptare ({n})',
  // „Ospătar · expiră 15.11.2026”
  pending_meta: '{role} · expiră {date}',
  current_title: 'Membri actuali ({n})',
  empty_title: 'Niciun membru încă',
  empty_desc: 'Invită colegii tăi ca să gestionați împreună restaurantul.',
  user_fallback: 'Utilizator',
  self: 'Tu',
  role_aria: 'Rol pentru {name}',
  remove_aria: 'Elimină {name} din echipă',
  remove_title: 'Elimină din echipă',
  // Descrierea dialogului comun de confirmare (lotul C7c: `confirm()`, nu
  // modalul făcut de mână); `{name}` = numele membrului, text.
  remove_confirm: 'Ești sigur că vrei să elimini {name}?',
  remove: 'Elimină',

  // ── Schimbarea rolului (lotul C7c): confirmare cu urmările rolului NOU ──
  // `{role}` = numele rolului (`role_*`). `role_to*` sunt și rândul de sub
  // selectul invitației; `role_fromManager` se pune ÎNAINTEA lor la retrogradare.
  role_confirmTitle: 'Schimbi rolul pentru {name} în {role}?',
  role_confirmOk: 'Schimbă rolul',
  role_toManager:
    'Ca Manager va putea modifica setările restaurantului, invita și elimina membri din echipă și ' +
    'vedea rapoartele și încasările.',
  role_toWaiter: 'Va lucra în ecranul Ospătar: mesele și comenzile lor.',
  role_toKitchen: 'Va lucra în ecranul Bucătărie: comenzile de preparat.',
  role_fromManager: 'Își pierde accesul la setări, echipă, rapoarte și încasări.',
}

export default ro

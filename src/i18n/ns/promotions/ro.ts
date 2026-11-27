// Namespace `promotions` — fila Promoții / Happy Hour (lotul L5b): lista
// regulilor, bannerul „ACTIVĂ ACUM”, editorul de regulă, confirmarea ștergerii
// și zilele săptămânii (`lib/happyHourDays.ts`).
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — ghilimelele DREPTE din exemple
// (`ex: "Happy Hour 17-19, -20% pe tot"`), „Se încarcă regulile...” cu trei
// puncte, majusculele din insigne („ACTIVĂ”, „OPRITĂ”, „ACTIVE ACUM (2)”).
// Zilele (`day_1`…`day_7`, 1 = DUMINICĂ, ca `days_of_week` din DB) sunt în
// română EXACT `DAY_LABELS` din lib/happyHour.ts; în celelalte limbi sunt chei
// de dicționar, NU `Intl` (ICU diferă între Node, jsdom și browser).
// NU sunt aici (din `common`): „Anulează”, „Șterge”, „Editează”.
// NU se traduc (date): numele regulilor, categoriilor și produselor, orele
// (`HH:MM`), sumele (numărul ca înainte + „lei” — banii nu intră în L5b).
const ro = {
  loading: 'Se încarcă regulile...',
  intro_payAtTable:
    'Reguli automate de reducere pe interval orar și zilele săptămânii. Ospătarul va vedea un buton „Aplică Happy Hour” la plată dacă există regulă activă.',
  intro_auto:
    'Reguli automate de reducere pe interval orar și zilele săptămânii. Reducerea se aplică singură comenzilor din meniul QR și celor pentru ridicare, cât timp regula e activă.',
  newRule: 'Regulă nouă',
  closeError: 'Închide eroarea',
  activeNow: { one: 'ACTIVĂ ACUM', few: 'ACTIVE ACUM ({n})', other: 'ACTIVE ACUM ({n})' },
  // Valoarea reducerii: procent sau sumă fixă.
  value_pct: '{value}%',
  value_amount: '{value} lei',
  empty_title: 'Nicio regulă încă',
  empty_payAtTable:
    'Creează prima regulă (ex: "Happy Hour 17-19, -20% pe tot") și sistemul va sugera automat reducerea la plată în acest interval.',
  empty_auto:
    'Creează prima regulă (ex: "Happy Hour 17-19, -20% pe tot") și reducerea se aplică singură comenzilor din meniu în acest interval.',
  firstRule: 'Prima regulă',

  // ── Cardul regulii ──
  days_all: 'Toate zilele',
  scope_all: 'Pe tot',
  status_active: 'ACTIVĂ',
  status_off: 'OPRITĂ',
  card_offPct: '−{value}%',
  card_offAmount: '−{value} lei',
  card_cap: '(max {amount} lei)',
  stop: 'Oprește',
  start: 'Pornește',
  deleteAria: 'Șterge regula {name}',

  // ── Zilele săptămânii (index = days_of_week − 1; 1 = duminică) ──
  day_1: 'Du',
  day_2: 'Lu',
  day_3: 'Ma',
  day_4: 'Mi',
  day_5: 'Jo',
  day_6: 'Vi',
  day_7: 'Sâ',

  // ── Editorul ──
  edit_title: 'Editare regulă',
  field_name: 'Nume *',
  field_namePh: 'ex: Happy Hour 17-19',
  field_from: 'De la',
  field_to: 'Până la',
  field_days: 'Zilele săptămânii (gol = toate)',
  days_reset: 'Resetează',
  field_scope: 'Aplicare',
  scope_category: 'Categorie',
  scope_product: 'Produs',
  pick_category: '— Selectează categorie —',
  pick_product: '— Selectează produs —',
  field_discount: 'Reducere',
  type_pct: 'Procent (%)',
  type_amount: 'Sumă fixă (lei)',
  field_value: 'Valoare',
  field_valueAria: 'Valoarea reducerii',
  field_cap: 'Plafon maxim (lei, opțional)',
  field_capPh: 'Max lei (opțional)',
  field_capAria: 'Plafon maxim în lei, opțional',
  field_active: 'Regulă activă imediat',
  saveChanges: 'Salvează modificări',
  create: 'Creează regulă',
  err_name: 'Numele e obligatoriu',
  err_value: 'Valoarea reducerii trebuie să fie pozitivă',
  // Lotul C4a: câmpurile sunt text cu tastatură zecimală — un text fără
  // formă de număr e o eroare, nu un 0 tăcut / un plafon șters.
  err_valueInvalid: 'Valoarea nu e un număr valid (ex. 12,50)',
  err_capInvalid: 'Plafonul nu e un număr valid (ex. 30 sau 12,50)',
  err_pctMax: 'Procent max 100',
  err_category: 'Selectează o categorie',
  err_product: 'Selectează un produs',
  err_save: 'Eroare la salvare',
  // Salvarea n-a primit răspuns la timp (HAPPY_HOUR_SAVE_TIMEOUT_MS, recenzia
  // lotului C4a): cererea s-a anulat, iar fila a VERIFICAT singură lista
  // reîncărcată (lista stă sub editor, deci omul n-o poate citi). Fiecare text
  // spune ce s-a aflat; „nu se dublează” e adevărat fiindcă o reîncercare de
  // creare verifică întâi lista încă o dată, iar o modificare repetată scrie
  // același rând.
  err_notSavedCreate:
    'Serverul n-a răspuns la timp, iar regula nu apare în lista reîncărcată: nu s-a salvat. Poți încerca din nou — o nouă încercare nu dublează regula.',
  err_notSavedUpdate:
    'Serverul n-a răspuns la timp, iar regula din lista reîncărcată nu are valorile tale: modificarea nu s-a salvat. Poți încerca din nou.',
  err_saveUnverified:
    'Serverul n-a răspuns la timp, iar lista regulilor nu s-a putut reîncărca: nu se știe dacă salvarea a ajuns. Verifică conexiunea și încearcă din nou — o nouă încercare nu dublează regula.',
  // O regulă nouă se trimite doar cu o listă de încredere (altfel o creare
  // fără răspuns n-ar mai putea fi verificată): aici nu a plecat nimic.
  err_listUnavailable:
    'Lista regulilor nu s-a putut încărca, deci regula nu s-a trimis încă. Verifică conexiunea și încearcă din nou.',
  saving: 'Se salvează…',
  // Butonul cât fila verifică lista (după termen sau înaintea unei reîncercări).
  verifying: 'Se verifică…',
  // Mesajul (toast) când verificarea găsește salvarea: editorul s-a închis.
  saved_late: 'Regula s-a salvat — confirmarea a venit după ce conexiunea și-a revenit.',
  // Închiderea editorului cu modificări nesalvate (fundal, Escape, ✕, „Anulează”).
  discard_title: 'Renunți la modificări?',
  discard_desc: 'Regula nu e salvată, iar modificările se pierd.',
  discard_confirm: 'Renunță',
  discard_stay: 'Rămân în editor',

  // ── Ștergerea ──
  del_title: 'Ștergi regula?',
  // {name} = numele regulii (descrierea confirmării din ui/confirm, lotul C4a).
  del_question: 'Vrei să ștergi {name}? Acțiunea e ireversibilă.',
}

export default ro

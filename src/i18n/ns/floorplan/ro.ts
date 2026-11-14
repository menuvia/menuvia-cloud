// Namespace `floorplan` — editorul hărții sălii (lotul L6a): FloorPlanEditor cu
// antetul (cifrele sălii, comutatorul Live/Editare, anularea, salvarea și
// bannerul de eroare), bara de unelte (mese, structură, decoruri, etaje,
// grila), etichetele desenate pe canvas (locurile mesei, statusul Live, starea
// goală), panoul de proprietăți, ajutorul „Cum funcționează” și subsolul cu
// cifre. Chunk propriu: editorul e LENEȘ în DashboardPage, deci namespace-ul se
// încarcă doar cu el.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — inclusiv pluralele false („1 mese”,
// „1 locuri”, „1 libere”), „Se salvează...” cu trei puncte (NU „…” din
// `common`), „— nelegată —” cu linii de pauză. Un plural fals devine cheie
// PLURALĂ cu formele ro identice, ca franceza/germana să poată acorda.
// Glosar (aliniat cu `dashboard`/`waiter`): harta sălii = floor plan / plan de
// salle / Tischplan; masă = table / table / Tisch; loc = seat / place / Platz;
// zonă = area / zone / Bereich; etaj = floor / étage / Etage.
// NU sunt aici (din `common`): „Salvează”, „Șterge”.
// NU se traduc (date): etichetele meselor, numele etajelor și ale zonelor
// salvate, numele meselor reale din POS. Numele IMPLICITE ale unui etaj sau al
// unei zone NOI („Parter”, „Etaj 2”, „Zonă”) NU sunt aici: sunt scrise în harta
// salvată (DATE, văzute și de oaspete pe harta publică), deci rămân în română
// în orice limbă a personalului (`DEFAULT_FLOOR_NAME`/`defaultFloorName`/
// `DEFAULT_ZONE_LABEL` din lib/floorPlan.ts).
const ro = {
  // ── Formele meselor, statusurile, structura, decorurile ──
  shape_round: 'Rotundă',
  shape_square: 'Pătrată',
  shape_rect: 'Dreptunghi',
  shape_bar: 'Bar',
  status_free: 'Liberă',
  status_occupied: 'Ocupată',
  status_calling: 'Cheamă',
  status_reserved: 'Rezervată',
  wall_wall: 'Perete',
  wall_window: 'Fereastră',
  wall_door: 'Ușă',
  deco_plant: 'Plantă',
  deco_bar_counter: 'Tejghea',
  deco_wc: 'WC',
  deco_stairs: 'Scări',
  deco_kitchen_door: 'Bucătărie',
  deco_entrance: 'Intrare',

  // ── Antetul ──
  stats_tables: { one: '{n} mese', few: '{n} mese', other: '{n} mese' },
  stats_seats: { one: '{n} locuri', few: '{n} locuri', other: '{n} locuri' },
  mode_liveAria: 'Mod vizualizare live activ — comută pe editare',
  mode_editAria: 'Mod editare activ — comută pe vizualizare live',
  mode_liveTitle: 'Comută pe Editare',
  mode_editTitle: 'Comută pe Vizualizare live',
  mode_live: 'Live',
  mode_edit: 'Editare',
  undo_aria: 'Anulează ultima acțiune',
  undo_title: 'Anulează (Ctrl+Z)',
  saved: '✓ Salvat',
  saving: 'Se salvează...',
  // Salvarea respinsă: trei clase, deduse din mesajul RPC-ului (care NU ajunge
  // pe ecran în nicio limbă). Numele comercial al planului rămâne „Fiscalizare”.
  err_plan: 'Harta sălii e disponibilă pe planul Fiscalizare.',
  err_tooLarge: 'Layout prea mare. Simplifică harta și reîncearcă.',
  err_generic: 'A apărut o eroare la salvare. Reîncearcă.',

  // ── Bara de unelte ──
  section_tools: 'Instrumente',
  tool_select: '↖ Selectează',
  section_tables: 'Mese',
  seats_label: 'Locuri:',
  seats_aria: { one: '{n} locuri', few: '{n} locuri', other: '{n} locuri' },
  section_structure: 'Structură',
  tool_zone: '▢ Zonă',
  section_decos: 'Decoruri',
  section_floors: 'Etaje',
  floor_add: '+ Etaj',
  grid: 'Grilă',

  // ── Canvas-ul (etichete desenate pe hartă) ──
  // Locurile de pe masă, scurt (spațiul e mic).
  table_seats: { one: '{n} loc.', few: '{n} loc.', other: '{n} loc.' },
  empty_mobile: 'Selectează un instrument și atinge planul',
  empty_desktop: 'Selectează un instrument și dă click pe plan',
  empty_hint: 'Pereți · Mese · Zone · Decoruri',

  // ── Panoul de proprietăți ── ({label} = eticheta mesei, dată)
  prop_tableTitle: 'Masă #{label}',
  prop_label: 'Etichetă',
  prop_labelAria: 'Etichetă masă',
  prop_seats: 'Locuri',
  prop_seatsAria: 'Număr de locuri',
  prop_shape: 'Formă',
  prop_shapeAria: 'Formă masă',
  prop_size: 'Dimensiuni',
  prop_widthAria: 'Lățime masă (px)',
  prop_widthPh: 'L',
  prop_heightAria: 'Înălțime masă (px)',
  prop_heightPh: 'Î',
  prop_rotation: 'Rotație: {deg}°',
  prop_rotationAria: 'Rotație masă',
  prop_pos: 'Masă reală (POS)',
  prop_posAria: 'Masă reală din POS legată de această masă',
  prop_posAuto: 'Auto (după nume: {label})',
  prop_posNone: '— nelegată —',
  prop_posHint: 'Leagă masa de POS ca să vezi în Live comenzile și rezervările ei.',
  prop_rotate: 'Rotește',
  prop_deleteTableAria: 'Șterge masa',
  prop_deco: 'Decor',
  prop_wall: 'Perete',
  prop_zone: 'Zonă',
  prop_zoneName: 'Nume zonă',

  // ── Ajutorul „Cum funcționează” ──
  help_title: 'Cum funcționează',
  help_tap: 'Atinge',
  help_tapDesc: '— plasează / selectează',
  help_drag: 'Trage',
  help_dragDesc: '— mută masa',
  help_panel: 'Rotește / Șterge',
  help_panelDesc: '— din panoul de proprietăți',
  help_click: 'Click',
  help_clickDesc: '— plasează element',
  help_dragDesktop: 'Drag',
  // Tastele: „R” e scurtătura reală (`e.key === 'r'`), deci rămâne „R”.
  help_keyRotate: 'R',
  help_keyRotateDesc: '— rotește',
  help_keyDelete: 'Del',
  help_keyDeleteDesc: '— șterge',
  help_keyUndo: 'Ctrl+Z',
  help_keyUndoDesc: '— undo',
  help_walls: 'Pereți: {how}',
  help_wallsMobile: 'atinge și trage',
  help_wallsDesktop: 'click & drag',
  // {live} = „Live” evidențiat (`mode_live`).
  help_live: 'Mod {live} arată status mese în timp real',

  // ── Subsolul cu cifre ──
  footer_tables: 'Mese:',
  footer_seats: 'Locuri:',
  footer_walls: 'Pereți:',
  live_free: { one: '{n} libere', few: '{n} libere', other: '{n} libere' },
  live_occupied: { one: '{n} ocupate', few: '{n} ocupate', other: '{n} ocupate' },
  live_reserved: { one: '{n} rezervate', few: '{n} rezervate', other: '{n} rezervate' },
}

export default ro

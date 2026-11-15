// Namespace `health` — Scorul de sănătate (lotul L7): HealthScoreTab cu
// stările (încărcare eșuată, scor necalculat), antetul, recalcularea, cardul
// scorului (eticheta, tendința, delta, narațiunea), compoziția pe componente,
// sugestiile și nota „Cum funcționează scorul”; plus textele compuse de
// lib/healthLang.ts (`trendLabelT`, `scoreLabelT`,
// `getActionableSuggestionsT`, `formatTimeAgoT`, `scoreNarrativeT` — în
// română EXACT ieșirea de dinainte; `trendLabel`/`scoreLabel`/
// `getActionableSuggestions` din lib/health.ts rămân neatinse și sunt doar
// oracolul — antetul cardului „Scor meniu” de pe Acasă folosește și el
// variantele traduse, deci HomeTab cere și el namespace-ul).
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică — pluralele FALSE rămân („acum 1 minute”, „acum 21 zile”, „1
// bonuri în eroare”, „21 membri”: one = few = other), „…” pe „Se calculează…”
// / „⏳ Calculez…”, anglicismele de azi („Customer Health Score”, „Login
// frecvență”, „Engagement”, „Utilizare features”, „dashboardul”, „role”), „1-2”
// și „0-100” cu cratimă, ghilimelele „Ajutor”.
// Componenta de bonuri (Bridge fiscal) apare doar pe planul cu bon (prop
// `fiscal`); textele ei se traduc normal — descriu casa de marcat și bonurile
// în eroare, nu numesc un document fiscal (decizia L7). „Bridge” rămâne numele
// produsului. Calea „Setări → Casă & tichete” e cea din meniul panoului
// (`dashboard.navGroup_setari` + `dashboard.nav_casa-marcat`, în fiecare limbă).
// NU e aici (din `common`): „Reîncearcă”, clasele de erori.
// NU se traduc (date): scorurile și maximele componentelor, simbolurile
// tendinței (↗ → ↘ ⚠) și emoji-urile componentelor.
const ro = {
  err_load: 'Eroare la încărcare',
  err_recompute: 'Eroare recalculare',
  // Refuzul de cooldown al recalculării (mig 178, hint `cooldown`) — DOAR în
  // celelalte limbi; în română rămâne textul serverului („Scor recalculat
  // recent. Reîncearcă peste N minute.”).
  err_cooldown: 'Scorul a fost recalculat recent. Reîncearcă peste câteva minute.',
  loadFail_title: 'Nu am putut încărca scorul',
  loadFail_desc: 'A apărut o eroare la comunicarea cu serverul. Încearcă din nou în câteva momente.',
  none_title: 'Scorul nu a fost încă calculat',
  none_desc: 'Scorul se calculează automat la 30 minute. Poți declanșa o recalculare manuală acum.',
  computing: 'Se calculează…',
  compute_now: 'Calculează acum',
  eyebrow: 'Customer Health Score',
  title: 'Cum stă cafeneaua ta',
  last_recompute: 'Ultima recalculare: {ago}',
  recomputing: '⏳ Calculez…',
  recompute: '↻ Recalculează',
  // {delta} = diferența cu semn („+15”, „-3”).
  delta_vs_prev: '({delta} față de scorul precedent)',
  comp_title: 'Compoziție scor',
  bar_login: 'Login frecvență',
  bar_orders: 'Volum comenzi',
  bar_team: 'Echipă',
  bar_tickets: 'Stabilitate',
  bar_engagement: 'Engagement',
  sugg_title: 'Ce poți face pentru a crește scorul',
  how_title: 'Cum funcționează scorul',
  how_fiscal:
    'Scor 0-100, recalculat la 30 de minute, din 5 componente: login (20), comenzi (30), echipă (15), ' +
    'stabilitatea casei de marcat (20) și folosirea funcțiilor (15).',
  how_nonFiscal:
    'Scor 0-100, recalculat la 30 de minute, din 4 componente: login, comenzi, echipă și folosirea funcțiilor.',
  // ── „Ultima recalculare” (`formatTimeAgoT`) ──
  ago_seconds: 'acum câteva secunde',
  ago_minutes: { one: 'acum {n} minute', few: 'acum {n} minute', other: 'acum {n} minute' },
  ago_hours: { one: 'acum {n} ore', few: 'acum {n} ore', other: 'acum {n} ore' },
  ago_days: { one: 'acum {n} zile', few: 'acum {n} zile', other: 'acum {n} zile' },
  // ── Narațiunea de sub scor (`scoreNarrativeT`) ──
  narr_critical:
    'Cafeneaua ta arată semne îngrijorătoare. Verifică sugestiile de mai jos; dacă ai blocaje, folosește ' +
    'butonul „Ajutor”.',
  narr_excellent:
    'Felicitări! Folosești Menuvia la potențial maxim. Continuă tot așa și consideră să recomanzi platforma ' +
    'altor patroni.',
  narr_good:
    'Cont sănătos, dar mai sunt zone de îmbunătățit. Caută-ți spațiu pentru 1-2 din sugestiile de mai jos.',
  narr_average:
    'Sunt destule oportunități de optimizare. Adresează în primul rând componenta cu scorul cel mai mic.',
  narr_low: 'Folosirea aplicației e sub potențial. Începe cu componenta cu scorul cel mai mic.',
  // ── Tendința și eticheta scorului (`trendLabelT`, `scoreLabelT`) ──
  trend_rising: 'În creștere',
  trend_stable: 'Stabil',
  trend_declining: 'În scădere',
  trend_critical: 'Critic — necesită atenție',
  label_excellent: 'Excelent',
  label_good: 'Bun',
  label_average: 'Mediu',
  label_weak: 'Slab',
  label_critical: 'Critic',
  // ── Sugestiile (`getActionableSuggestionsT`): numele componentei + textul ──
  sc_login: 'Frecvență login',
  sg_loginNever:
    'Nu te-ai logat niciodată — accesează dashboardul măcar o dată pe zi pentru a vedea comenzile live.',
  sg_loginDays: {
    one: 'Ultimul login: acum {n} zile. Conectează-te cel puțin de 2-3 ori pe săptămână.',
    few: 'Ultimul login: acum {n} zile. Conectează-te cel puțin de 2-3 ori pe săptămână.',
    other: 'Ultimul login: acum {n} zile. Conectează-te cel puțin de 2-3 ori pe săptămână.',
  },
  sg_loginDaily: 'Conectează-te zilnic pentru scor maxim.',
  sc_orders: 'Volum comenzi',
  sg_ordersZero:
    'Zero comenzi săptămâna asta. Verifică că meniul QR e accesibil clienților și că ospătarii înregistrează ' +
    'comenzile.',
  sg_ordersDown: 'Comenzi în scădere ({wk} vs {prev} săpt. trecută). Verifică promoțiile, programul, traficul.',
  sg_ordersGrow: 'Continuă să crești volumul — Happy Hour, comenzi rapide QR, fidelizare clienți.',
  sc_team: 'Mărime echipă',
  sg_teamSolo:
    'Doar tu ești în cont. Invită ospătarii și bucătăria — productivitatea crește cu specializare pe role.',
  // {n} = membrii de acum, {more} = câți mai trebuie invitați.
  sg_teamMore: {
    one: '{n} membri. Invită încă {more} pentru scor maxim.',
    few: '{n} membri. Invită încă {more} pentru scor maxim.',
    other: '{n} membri. Invită încă {more} pentru scor maxim.',
  },
  sc_tickets: 'Erori Bridge fiscal',
  sg_ticketsAlerts: {
    one: '{n} bonuri în eroare în ultimele 7 zile. Verifică Setări → Casă & tichete — casa de marcat, hârtie, conexiune.',
    few: '{n} bonuri în eroare în ultimele 7 zile. Verifică Setări → Casă & tichete — casa de marcat, hârtie, conexiune.',
    other:
      '{n} bonuri în eroare în ultimele 7 zile. Verifică Setări → Casă & tichete — casa de marcat, hârtie, conexiune.',
  },
  sg_ticketsOk: 'Sistem fiscal stabil. Continuă.',
  sc_engagement: 'Utilizare features',
  sg_engagementFiscal:
    'Activează mai multe module: deschide ture de casă, configurează Happy Hour, adaugă rețete pentru ' +
    'gestiune stocuri, conectează Bridge fiscal.',
  sg_engagement:
    'Activează mai multe module: configurează Happy Hour, adaugă rețete pentru gestiune stocuri, conectează ' +
    'imprimanta din bucătărie.',
}

export default ro

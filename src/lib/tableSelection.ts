// ─────────────────────────────────────────────────────────────
// tableSelection.ts — ce intră în PDF-ul de QR din Mese & QR (lotul C5b).
//
// Înainte, „Descarcă QR-uri” lua MEREU toate mesele active cu QR: ignora
// căutarea și filtrul pe zonă, n-avea selecție, iar mesele fără QR ieșeau din
// PDF fără ca cineva să afle (toast-ul spunea doar „PDF descărcat”). După
// două mese adăugate, patronul retipărea tot (30 de mese = 5 pagini A4).
//
// Regula, pură (testată fără DOM):
//   1. o selecție ne-goală (cu selecția disponibilă) → exact mesele bifate,
//      ÎN ordinea listei, oricare ar fi filtrul de acum;
//   2. altfel lista VIZIBILĂ (căutare + zonă); dacă filtrele nu scot nimic,
//      sursa e „toate”, ca înainte (butonul își păstrează eticheta);
//   3. din domeniul ales intră în PDF doar mesele ACTIVE cu QR; celelalte se
//      NUMĂRĂ (fără QR / inactive), ca ecranul să le poată spune pe nume.
// Id-urile selectate care nu mai există în listă (masă ștearsă) se ignoră.
// Lista vizibilă e la fel de bună ca filtrele ei: un filtru pe care ecranul nu
// mai îl arată nu are voie să rămână activ (`reconcileZoneFilter`, mai jos).
// ─────────────────────────────────────────────────────────────

/** Minimul unei mese pentru decizie. */
export interface PrintableTableLike {
  id: string
  is_active: boolean
  active_token: unknown
}

/** De unde vine domeniul PDF-ului. */
export type QrPrintSource = 'all' | 'visible' | 'selection'

export interface QrPrintPlan<T> {
  source: QrPrintSource
  /** Mesele domeniului, în ordinea listei. */
  scope: T[]
  /** Cele care intră în PDF: active și cu QR. */
  printable: T[]
  /** Active, dar fără QR — nu pot fi tipărite până nu primesc unul. */
  noQr: T[]
  /** Inactive (cu sau fără QR) — QR-ul unei mese inactive nu duce la meniu. */
  inactive: T[]
}

export function planQrPrint<T extends PrintableTableLike>(
  all: readonly T[],
  visible: readonly T[],
  selected: ReadonlySet<string>,
  selectionEnabled: boolean,
): QrPrintPlan<T> {
  const picked = selectionEnabled ? all.filter((t) => selected.has(t.id)) : []
  const source: QrPrintSource =
    picked.length > 0 ? 'selection' : visible.length === all.length ? 'all' : 'visible'
  const scope = picked.length > 0 ? picked : [...visible]
  const printable: T[] = []
  const noQr: T[] = []
  const inactive: T[] = []
  for (const t of scope) {
    if (!t.is_active) inactive.push(t)
    else if (t.active_token) printable.push(t)
    else noQr.push(t)
  }
  return { source, scope, printable, noQr, inactive }
}

/** Selecția cu `ids` adăugate (`on`) sau scoase; întoarce un Set NOU. */
export function withIds(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  on: boolean,
): Set<string> {
  const next = new Set(selected)
  for (const id of ids) {
    if (on) next.add(id)
    else next.delete(id)
  }
  return next
}

/** `true` doar când FIECARE masă din grup e bifată (grup gol → `false`). */
export function allSelected(
  selected: ReadonlySet<string>,
  rows: readonly { id: string }[],
): boolean {
  return rows.length > 0 && rows.every((r) => selected.has(r.id))
}

// ── Filtrele listei (recenzia lotului C5b) ──
// Lista, „Selectează tot” și PDF-ul lucrează pe lista FILTRATĂ, deci un filtru
// rămas fără ieșire vizibilă golea ecranul ȘI schimba ce se tipărea:
//   - zona filtrată nu mai are mese (mutate în lot, redenumite, șterse):
//     select-ul n-o mai oferă, deci „Toate zonele” apărea ales și alegerea lui
//     nu declanșa nicio schimbare; fără nicio zonă select-ul nici nu se randa;
//   - sub prag câmpurile se ascund, dar căutarea veche filtra în continuare.
// Regula se aplică pe rândurile PROASPETE, la fiecare reîncărcare a listei
// (TablesManager `load()`, singurul loc care scrie lista).

/** Căutarea și filtrul pe zonă apar doar de la 9 mese (sub prag lista se scanează cu ochiul). */
export function tableFiltersShown(tableCount: number): boolean {
  return tableCount > 8
}

/**
 * Filtrul pe zonă după o reîncărcare: rămâne doar cu bara de filtre vizibilă
 * ȘI cu cel puțin o masă în zona lui. Când zona filtrată a dispărut, `follow`
 * (zona în care tocmai au fost mutate mesele prin „Setează zona…”) îi ia locul
 * dacă lista o are — redenumirea „Terasa” → „Terasă” rămâne pe aceleași mese;
 * altfel filtrul se golește (toată lista). O mutare PARȚIALĂ lasă zona veche
 * cu mese, deci filtrul rămâne pe ea.
 */
export function reconcileZoneFilter(
  rows: readonly { zone: string | null }[],
  current: string,
  follow: string | null,
): string {
  if (current === '' || !tableFiltersShown(rows.length)) return ''
  const has = (zone: string) => rows.some((r) => r.zone === zone)
  if (has(current)) return current
  return follow !== null && follow !== '' && has(follow) ? follow : ''
}

/** Căutarea după o reîncărcare: sub prag câmpul nu se vede, deci nu filtrează. */
export function reconcileTableSearch(tableCount: number, current: string): string {
  return tableFiltersShown(tableCount) ? current : ''
}

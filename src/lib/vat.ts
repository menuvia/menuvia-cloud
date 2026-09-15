// ─────────────────────────────────────────────────────────────
// vat.ts — Cote TVA configurabile per restaurant
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'

export interface VatRate {
  restaurant_id: string
  vat_group: number // 1-4
  rate_percent: number // ex: 9, 19, 5, 0
  label: string // ex: "Mâncare", "Alcool"
  description: string | null
  is_active: boolean
  updated_at: string
}

export async function fetchVatRates(restaurantId: string): Promise<VatRate[]> {
  const { data, error } = await supabase
    .from('vat_rates')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('vat_group')
  if (error) throw error
  return (data ?? []) as VatRate[]
}

export async function updateVatRate(
  restaurantId: string,
  vatGroup: number,
  fields: Partial<Pick<VatRate, 'rate_percent' | 'label' | 'description' | 'is_active'>>,
): Promise<void> {
  const { error } = await supabase
    .from('vat_rates')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('restaurant_id', restaurantId)
    .eq('vat_group', vatGroup)
  if (error) throw error
}

// Get readable label for vat_group from rates list
export function getVatLabel(rates: VatRate[], vatGroup: number): string {
  const r = rates.find((r) => r.vat_group === vatGroup)
  return r ? `${r.rate_percent}% (${r.label})` : `Grupa ${vatGroup}`
}

// Obține procentul TVA pentru vat_group din lista de cote.
// Întoarce `null` când grupa NU există în config (gap de configurare),
// ca să nu confundăm o grupă lipsă cu 0% real (ex: grupa 4 = neimpozabil).
// Consumatorii trebuie să trateze `null` ca eroare de config, nu ca 0%.
export function getVatRate(rates: VatRate[], vatGroup: number): number | null {
  const r = rates.find((r) => r.vat_group === vatGroup)
  return r ? r.rate_percent : null
}

// ── Raport TVA: agregare pe (grupă, cotă) ─────────────────────────────────────
// `vat_report_daily` (mig 272) întoarce cota SNAPSHOT-uită la vânzare, deci după
// o schimbare de cotă aceeași grupă apare cu DOUĂ cote în interval (ex. grupa 1
// la 9% până pe 31.07 și la 11% după). Cheia de agregare e (grupă, cotă), NU
// grupa singură — altfel două cote se însumează sub o singură etichetă, cea a
// primului rând, iar cardul „9% Mâncare” ar cuprinde și vânzările la 11%.
// Sumele erau corecte și înainte; eticheta mințea. Rezidualul cosmetic din 272.
export interface VatReportRow {
  vat_group: number
  vat_rate_percent: number
  vat_label: string
  gross_total: number | string
  vat_amount: number | string
  net_total: number | string
}

export interface VatReportAggregate {
  vat_group: number
  rate: number
  label: string
  gross: number
  vat: number
  net: number
}

export interface VatReportSummary {
  byRate: VatReportAggregate[] // sortat: cotă ASC, apoi grupă ASC
  totalGross: number
  totalVat: number
  totalNet: number
}

/**
 * Agregă rândurile din `vat_report_daily` pentru cardurile și totalurile
 * raportului TVA.
 *
 * Cheia de agregare e perechea (grupă, cotă), nu grupa singură: cota din view
 * e cea snapshot-uită la vânzare (mig 272), deci după o schimbare de cotă
 * aceeași grupă apare cu două cote în interval și fiecare primește propriul
 * agregat. Cota e normalizată prin `Number`, ca `'9.00'` și `9` să nu se
 * despartă în două chei.
 *
 * @param rows rândurile view-ului pentru un restaurant și un interval
 * @returns agregatele sortate cotă ASC, apoi grupă ASC, plus totalurile generale
 */
export function aggregateVatReport(rows: readonly VatReportRow[]): VatReportSummary {
  const map = new Map<string, VatReportAggregate>()
  let totalGross = 0
  let totalVat = 0
  let totalNet = 0
  for (const r of rows) {
    const rate = Number(r.vat_rate_percent)
    const key = `${r.vat_group}:${rate}`
    const agg = map.get(key) ?? {
      vat_group: r.vat_group,
      rate,
      label: r.vat_label,
      gross: 0,
      vat: 0,
      net: 0,
    }
    agg.gross += Number(r.gross_total)
    agg.vat += Number(r.vat_amount)
    agg.net += Number(r.net_total)
    map.set(key, agg)
    totalGross += Number(r.gross_total)
    totalVat += Number(r.vat_amount)
    totalNet += Number(r.net_total)
  }
  const byRate = [...map.values()].sort((a, b) => a.rate - b.rate || a.vat_group - b.vat_group)
  return { byRate, totalGross, totalVat, totalNet }
}

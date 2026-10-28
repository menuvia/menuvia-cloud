// =============================================================
// Menuvia — src/lib/invoices.ts
// Oblio invoice management: config + invoice issuance from UI.
// =============================================================
import { supabase } from './supabase'

export type InvoiceStatus = 'queued' | 'generating' | 'issued' | 'cancelled' | 'failed'

export interface OblioConfig {
  restaurant_id: string
  api_email: string
  company_cif: string
  company_name: string
  company_address: string | null
  company_state: string | null
  company_city: string | null
  default_series: string
  vat_included: boolean
  send_email: boolean
  language: string
  is_active: boolean
  test_mode: boolean
}

// Ce SCRIE formularul: secretul e doar-scriere (mig 287 — coloana nu mai e
// citibilă de rolurile client). `api_secret` gol/lipsă = nu-l schimba.
export type OblioConfigInput = OblioConfig & { api_secret?: string }

// Coloanele ne-secrete (lista explicită — un `select('*')` ar da 42501 pe api_secret).
const OBLIO_CONFIG_COLUMNS =
  'restaurant_id,api_email,company_cif,company_name,company_address,company_state,company_city,default_series,vat_included,send_email,language,is_active,test_mode'

export interface Invoice {
  id: string
  order_id: string
  customer_name: string
  customer_cif: string | null
  is_b2b: boolean
  total_with_vat: number
  oblio_series: string | null
  oblio_number: string | null
  oblio_link: string | null
  status: InvoiceStatus
  last_error: string | null
  issued_at: string | null
  created_at: string
  // Prezența XML-ului e-Factura (mig 269) — NU conținutul. Pe B2B, trimiterea în
  // SPV e obligație legală, iar datele existau din mig 041 fără să le citească
  // nimeni. `false` acoperă și facturile emise înainte de migrație.
  has_einvoice: boolean
}

// ── Oblio config CRUD ─────────────────────────────────────────

export async function fetchOblioConfig(restaurantId: string): Promise<OblioConfig | null> {
  const { data, error } = await supabase
    .from('oblio_configs')
    .select(OBLIO_CONFIG_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .maybeSingle()

  if (error) {
    console.error('[invoices] fetchOblioConfig:', error.message)
    return null
  }
  return data as OblioConfig | null
}

export async function saveOblioConfig(
  cfg: OblioConfigInput,
  // true = există deja un rând (configurat): UPDATE fără secret dacă a rămas gol.
  isExisting = false,
): Promise<void> {
  // Validate CIF
  if (!cfg.company_cif || !/^(RO)?\d{2,12}$/i.test(cfg.company_cif.trim())) {
    throw new Error('CIF firmă invalid (format: RO12345678 sau 12345678)')
  }

  const secret = (cfg.api_secret ?? '').trim()
  const { api_secret: _omit, ...rest } = cfg
  void _omit
  const row = {
    ...rest,
    company_cif: cfg.company_cif.toUpperCase().startsWith('RO')
      ? cfg.company_cif.toUpperCase()
      : 'RO' + cfg.company_cif,
  }

  if (isExisting) {
    // UPDATE, nu upsert: un INSERT fără api_secret ar pica pe NOT NULL înainte
    // de ON CONFLICT, iar secretul existent nu se poate citi ca să fie re-trimis.
    const { restaurant_id: rid, ...fields } = row
    // `.select` ca să aflăm câte rânduri a atins: un UPDATE filtrat de RLS sau
    // pe o configurație ștearsă între timp întoarce SUCCES cu 0 rânduri, iar
    // formularul ar spune „salvat" fără să fi salvat nimic.
    const { data, error } = await supabase
      .from('oblio_configs')
      .update(secret ? { ...fields, api_secret: secret } : fields)
      .eq('restaurant_id', rid)
      .select('restaurant_id')
    if (error) throw new Error(`Salvare config: ${error.message}`)
    if (!data || data.length === 0) {
      throw new Error('Salvare config: configurația nu mai există — reîncarcă pagina')
    }
    return
  }

  if (!secret) throw new Error('API secret este obligatoriu')
  const { error } = await supabase.from('oblio_configs').insert({ ...row, api_secret: secret })
  if (error) throw new Error(`Salvare config: ${error.message}`)
}

export async function deleteOblioConfig(restaurantId: string): Promise<void> {
  const { error } = await supabase.from('oblio_configs').delete().eq('restaurant_id', restaurantId)

  if (error) throw new Error(`Ștergere config: ${error.message}`)
}

// ── Invoice operations ────────────────────────────────────────

export interface IssueInvoiceParams {
  orderId: string
  customerName: string
  customerCif?: string
  customerAddress?: string
  customerEmail?: string
  customerPhone?: string
}

/** Enqueue an invoice for a paid order. Returns the invoice ID. */
export async function enqueueInvoice(p: IssueInvoiceParams): Promise<string> {
  const { data, error } = await supabase.rpc('enqueue_invoice_for_order', {
    p_order_id: p.orderId,
    p_customer_name: p.customerName,
    p_customer_cif: p.customerCif ?? null,
    p_customer_address: p.customerAddress ?? null,
    p_customer_email: p.customerEmail ?? null,
    p_customer_phone: p.customerPhone ?? null,
  })

  if (error) throw new Error(error.message)
  return data as string
}

export async function cancelInvoice(invoiceId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_invoice', {
    p_invoice_id: invoiceId,
    p_reason: reason ?? 'Anulată de utilizator',
  })
  if (error) throw new Error(error.message)
}

export async function listInvoices(
  restaurantId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<Invoice[]> {
  const { data, error } = await supabase.rpc('list_invoices_for_restaurant', {
    p_restaurant_id: restaurantId,
    p_limit: limit,
    p_offset: offset,
  })

  if (error) throw new Error(error.message)
  return (data || []) as Invoice[]
}

// ── Display helpers ───────────────────────────────────────────

export function invoiceStatusLabel(s: InvoiceStatus): string {
  switch (s) {
    case 'queued':
      return 'În coadă'
    case 'generating':
      return 'Se generează'
    case 'issued':
      return 'Emisă'
    case 'cancelled':
      return 'Anulată'
    case 'failed':
      return 'Eșec'
  }
}

export function invoiceStatusColor(
  s: InvoiceStatus,
  palette: { green: string; gold: string; red: string; t3: string },
): string {
  switch (s) {
    case 'issued':
      return palette.green
    case 'queued':
    case 'generating':
      return palette.gold
    case 'cancelled':
      return palette.t3
    case 'failed':
      return palette.red
  }
}

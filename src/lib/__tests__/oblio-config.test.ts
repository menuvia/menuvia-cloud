// Teste pe configul Oblio după mig 287: `api_secret` nu mai e citibil de rolurile
// client, deci (a) niciun select nu-l cere / nu folosește `*`, (b) un config
// existent se salvează prin UPDATE fără secret când câmpul a rămas gol.
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Call {
  op: string
  args: unknown[]
}
const { calls, result } = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; args: unknown[] }>,
  result: { error: null as { message: string } | null, data: null as unknown },
}))

vi.mock('../supabase', () => {
  const chain: Record<string, unknown> = {}
  const rec =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args })
      return chain
    }
  for (const op of ['from', 'select', 'insert', 'update', 'eq', 'upsert']) chain[op] = rec(op)
  chain.maybeSingle = () => Promise.resolve(result)
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
  return { supabase: chain }
})

import { fetchOblioConfig, saveOblioConfig, type OblioConfigInput } from '../invoices'

const base: OblioConfigInput = {
  restaurant_id: 'r1',
  api_email: 'a@b.ro',
  company_cif: '12345678',
  company_name: 'SRL',
  company_address: null,
  company_state: null,
  company_city: null,
  default_series: 'MENU',
  vat_included: true,
  send_email: true,
  language: 'RO',
  is_active: true,
  test_mode: false,
}
const find = (op: string): Call | undefined => calls.find((c) => c.op === op)

describe('oblio config — mig 287', () => {
  beforeEach(() => {
    calls.length = 0
    result.error = null
    result.data = null
  })

  it('OC1 citirea folosește listă explicită, fără * și fără api_secret', async () => {
    await fetchOblioConfig('r1')
    const sel = String(find('select')?.args[0])
    expect(sel).not.toBe('*')
    expect(sel).not.toContain('api_secret')
    expect(sel).toContain('company_name')
  })

  it('OC2 config existent + secret gol → UPDATE fără api_secret', async () => {
    result.data = [{ restaurant_id: 'r1' }]
    await saveOblioConfig({ ...base, api_secret: '' }, true)
    const upd = find('update')
    expect(upd).toBeDefined()
    expect(upd?.args[0]).not.toHaveProperty('api_secret')
    expect(upd?.args[0]).toHaveProperty('company_cif', 'RO12345678')
    expect(find('insert')).toBeUndefined()
    expect(find('upsert')).toBeUndefined()
  })

  it('OC3 config existent + secret nou → UPDATE cu secretul', async () => {
    result.data = [{ restaurant_id: 'r1' }]
    await saveOblioConfig({ ...base, api_secret: ' nou ' }, true)
    expect(find('update')?.args[0]).toHaveProperty('api_secret', 'nou')
  })

  it('OC4 config nou fără secret → eroare, nimic scris', async () => {
    await expect(saveOblioConfig({ ...base, api_secret: '' }, false)).rejects.toThrow(/secret/i)
    expect(calls.length).toBe(0)
  })

  it('OC5 config nou cu secret → INSERT', async () => {
    await saveOblioConfig({ ...base, api_secret: 's3' }, false)
    expect(find('insert')?.args[0]).toHaveProperty('api_secret', 's3')
  })

  it('OC6 UPDATE care nu atinge niciun rând (RLS / config ștearsă) → eroare, nu „salvat"', async () => {
    result.data = []
    await expect(saveOblioConfig({ ...base, api_secret: '' }, true)).rejects.toThrow(/nu mai există/)
    expect(find('select')?.args[0]).toBe('restaurant_id')
  })
})

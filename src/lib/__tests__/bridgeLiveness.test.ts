// „E pornit bridge-ul?" pentru un dispozitiv, din `last_seen_at` (lotul C7a).
// Prefixul BQ: verificat cu grep în src/, tests/, e2e/, supabase/, docs/,
// bridge/ și CLAUDE.md, nefolosit înainte.
//
//   BQ1  pragul e EXACT cel din `bridge_connection_status` (mig 265,
//        `interval '3 minutes'`, comparație strictă): 2:59 = viu, 3:00 = oprit;
//        `null` / dată stricată = oprit; o dată din viitor (ceasul browserului
//        în urmă) = viu. Mutația care pică: prag de 5 minute, sau `<=` în loc
//        de `<` (la exact 3 minute banner-ul spune „deconectat", fila „Online").
//   BQ1b clichet pe sursă: migrația 265 conține încă pragul de 3 minute — o
//        schimbare de o singură parte face CI roșu, nu un banner și o filă care
//        se contrazic.
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRIDGE_LIVENESS_MS, isBridgeDeviceLive } from '../bridgeLiveness'

const ROOT = process.cwd()
const NOW = Date.parse('2026-11-26T12:00:00Z')
const ago = (ms: number): string => new Date(NOW - ms).toISOString()

describe('lib/bridgeLiveness', () => {
  it('BQ1 pragul de 3 minute, strict, ca în mig 265', () => {
    expect(BRIDGE_LIVENESS_MS).toBe(180_000)
    expect(isBridgeDeviceLive(ago(30_000), NOW)).toBe(true)
    expect(isBridgeDeviceLive(ago(179_999), NOW)).toBe(true)
    expect(isBridgeDeviceLive(ago(180_000), NOW)).toBe(false)
    expect(isBridgeDeviceLive(ago(10 * 60_000), NOW)).toBe(false)
    expect(isBridgeDeviceLive(ago(3 * 86_400_000), NOW)).toBe(false)
    expect(isBridgeDeviceLive(null, NOW)).toBe(false)
    expect(isBridgeDeviceLive(undefined, NOW)).toBe(false)
    expect(isBridgeDeviceLive('nu e o dată', NOW)).toBe(false)
    expect(isBridgeDeviceLive(new Date(NOW + 60_000).toISOString(), NOW)).toBe(true)
  })

  it('BQ1b mig 265 are același prag', () => {
    const dir = resolve(ROOT, 'supabase/migrations')
    const file = readdirSync(dir).find((f) => /_migration_265_bridge_connection_status\.sql$/.test(f))
    expect(file).toBeDefined()
    const sql = readFileSync(resolve(dir, file ?? ''), 'utf8')
    expect(sql).toMatch(/v_last > now\(\) - interval '3 minutes'/)
  })
})

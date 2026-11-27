// Ce primește patronul după „Înregistrează" în fila Bridge (lotul C7a):
// linkul installer-ului și config.json-ul generat în browser. Prefixul BW:
// verificat cu grep în src/, tests/, e2e/, supabase/, docs/, bridge/ și
// CLAUDE.md, nefolosit înainte.
//
//   BW1  linkul de descărcare: DOAR `https://` absolut; gol, http, relativ,
//        `javascript:` sau gunoi → `null` (butonul nu apare — niciodată un link
//        mort). Mutația care pică: `return v || null` (orice șir devine link).
//        Control pozitiv: un https valid trece neschimbat.
//   BW2  config.json-ul: pe Planul 2 `kitchen.enabled: true` (mode tcp, FĂRĂ
//        host — îl cere wizardul) și `fiscalnet.required: false`; pe Planul 3
//        EXACT cele trei chei, fără secțiunea de bucătărie. Mutația care pică:
//        `kitchen` omis pe Planul 2 (bridge-ul instalat cu valorile implicite nu
//        tipărea nimic) sau pus și pe Planul 3.
//   BW3  CONTRACTUL cu bridge-ul: fișierul generat e citit de
//        `bridge/lib/config.js` REAL. Planul 3 trece validarea așa cum e;
//        Planul 2 cere exact UN lucru — IP-ul imprimantei (`kitchen.host`) — iar
//        cu el completat trece și păstrează `required=false`. Mutația care pică:
//        o cheie redenumită de o parte (ex. `anonKey` în loc de
//        `supabaseAnonKey`), pe care niciun test de formă n-ar vedea-o.
//   BW7  coada cheii din fereastra panoului (`secretTail`) e EXACT ce afișează
//        wizardul (`maskSecret` din `bridge/lib/setupDefaults.js` REAL):
//        installer-ul nu mai înlocuiește un config.json existent, iar
//        patronul vede dacă instalarea a păstrat altă cheie doar comparând
//        cele două cozi. Mutația care pică: altă lungime a cozii (ex.
//        `slice(-6)`) sau fără „…” de o singură parte. Control pozitiv: cheia
//        reală de test dă „…zz99”, nu șirul gol (altfel egalitatea ar trece și
//        cu ambele funcții întorcând '').
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bridgeConfigJson, bridgeDownloadUrl, buildBridgeConfig, secretTail } from '../bridgeSetup'

const ROOT = process.cwd()
const PUBLIC = { supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'anon-public-key' }
const SECRET = 'dev-secret-0123456789abcdef'

describe('lib/bridgeSetup', () => {
  it('BW1 linkul installer-ului: doar https absolut', () => {
    expect(bridgeDownloadUrl('https://files.example.org/menuvia-bridge-setup.exe')).toBe(
      'https://files.example.org/menuvia-bridge-setup.exe',
    )
    expect(bridgeDownloadUrl('  https://files.example.org/x.exe  ')).toBe('https://files.example.org/x.exe')
    for (const bad of [undefined, null, '', '   ', 'http://files.example.org/x.exe', '/download', 'javascript:alert(1)', 'not a url']) {
      expect(bridgeDownloadUrl(bad), String(bad)).toBeNull()
    }
  })

  it('BW2 config.json: bucătăria pe Planul 2, doar cele trei chei pe Planul 3', () => {
    expect(buildBridgeConfig({ ...PUBLIC, deviceSecret: SECRET, kitchenOnly: true })).toEqual({
      ...PUBLIC,
      deviceSecret: SECRET,
      fiscalnet: { required: false },
      kitchen: { enabled: true, mode: 'tcp' },
    })
    expect(buildBridgeConfig({ ...PUBLIC, deviceSecret: SECRET, kitchenOnly: false })).toEqual({
      ...PUBLIC,
      deviceSecret: SECRET,
    })
    const json = bridgeConfigJson({ ...PUBLIC, deviceSecret: SECRET, kitchenOnly: false })
    expect(json.endsWith('\n')).toBe(true)
    expect(JSON.parse(json)).toEqual({ ...PUBLIC, deviceSecret: SECRET })
  })

  it('BW3 bridge/lib/config.js citește fișierul generat (contractul cheilor)', () => {
    const req = createRequire(resolve(ROOT, 'package.json'))
    const { loadConfig } = req(resolve(ROOT, 'bridge/lib/config.js')) as {
      loadConfig: () => {
        supabaseUrl: string
        supabaseAnonKey: string
        deviceSecret: string
        fiscalnet: { required: boolean }
        kitchen: { enabled: boolean; host: string }
      }
    }
    // Variabilele de mediu au prioritate peste fișier în bridge — le scoatem.
    const keys = ['MENUVIA_BRIDGE_CONFIG', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DEVICE_SECRET', 'FISCALNET_REQUIRED', 'KITCHEN_ENABLED', 'KITCHEN_HOST']
    const saved = new Map(keys.map((k) => [k, process.env[k]]))
    const dir = mkdtempSync(join(tmpdir(), 'bw3-'))
    const file = join(dir, 'config.json')
    try {
      for (const k of keys) delete process.env[k]
      process.env.MENUVIA_BRIDGE_CONFIG = file

      writeFileSync(file, bridgeConfigJson({ ...PUBLIC, deviceSecret: SECRET, kitchenOnly: false }))
      const fiscal = loadConfig()
      expect(fiscal.supabaseUrl).toBe(PUBLIC.supabaseUrl)
      expect(fiscal.supabaseAnonKey).toBe(PUBLIC.supabaseAnonKey)
      expect(fiscal.deviceSecret).toBe(SECRET)
      expect(fiscal.fiscalnet.required).toBe(true)
      expect(fiscal.kitchen.enabled).toBe(false)

      writeFileSync(file, bridgeConfigJson({ ...PUBLIC, deviceSecret: SECRET, kitchenOnly: true }))
      let message = ''
      try {
        loadConfig()
      } catch (e) {
        message = e instanceof Error ? e.message : String(e)
      }
      // Singura lipsă: IP-ul imprimantei, pe care îl cere wizardul.
      expect(message).toMatch(/kitchen\.host/)
      expect(message.split('\n').filter((l) => l.trim().startsWith('-'))).toHaveLength(1)

      const withHost = JSON.parse(readFileSync(file, 'utf8')) as { kitchen: Record<string, unknown> }
      withHost.kitchen.host = '192.168.1.50'
      writeFileSync(file, JSON.stringify(withHost))
      const kitchen = loadConfig()
      expect(kitchen.kitchen.enabled).toBe(true)
      expect(kitchen.kitchen.host).toBe('192.168.1.50')
      expect(kitchen.fiscalnet.required).toBe(false)
      expect(kitchen.deviceSecret).toBe(SECRET)
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('BW7 coada cheii din panou = cea din wizardul --setup', () => {
    const req = createRequire(resolve(ROOT, 'package.json'))
    const { maskSecret } = req(resolve(ROOT, 'bridge/lib/setupDefaults.js')) as {
      maskSecret: (v: unknown) => string
    }
    expect(secretTail('dev-secret-0123456789abcdef-zz99')).toBe('…zz99')
    for (const s of ['dev-secret-0123456789abcdef-zz99', SECRET, 'abcde', 'abcd', 'a', '']) {
      expect(secretTail(s), s).toBe(maskSecret(s))
    }
  })
})

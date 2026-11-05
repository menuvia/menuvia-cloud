// Cromul comun din intrare (lotul L1): tabelul în patru limbi și alegerea
// limbii.
//   CR1  aceleași chei în ro/en/fr/de, texte ne-goale, fără locuri `{x}`
//        (tabelul nu interpolează — un „{name}” ar ieși pe ecran ca atare).
//        Mutația care pică: o cheie adăugată doar în `ro`.
//   CR2  româna e BYTE-identică cu textele de dinainte (ecranele românești nu
//        se schimbă) — inclusiv mesajul de rețea, care e `MSG_NETWORK`.
//   CR3  chromeLangOf: ro/fr/de/en rămân (cu regiune, oricum scrise); orice
//        altă limbă declarată (it, hu, es) → en; nimic → ro.
//        Mutația care pică: limba necunoscută căzută pe ro (un oaspete italian
//        ar primi bannerul în română).
//   CR4  documentChromeLang citește `<html lang>` ACUM; browserChromeLang ia
//        prima limbă suportată din preferințe, altfel en.
//   CR5  modulul nu importă nimic (intră în bundle-ul de intrare).
//   CR6  chromeFallbackLang (recenzia CodeRabbit pe #357): limba se declară pe
//        etichetă DOAR când tabelul a căzut pe altă limbă decât a paginii.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CHROME_STRINGS,
  browserChromeLang,
  chromeFallbackLang,
  chromeLangOf,
  documentChromeLang,
  type ChromeLang,
} from '../chrome'
import { MSG_NETWORK } from '../../lib/userMessages'

const LANGS: ChromeLang[] = ['ro', 'en', 'fr', 'de']

afterEach(() => {
  document.documentElement.removeAttribute('lang')
  vi.unstubAllGlobals()
})

describe('cromul comun — tabelul', () => {
  it('CR1 aceleași chei în cele patru limbi, texte ne-goale, fără `{x}`', () => {
    const roKeys = Object.keys(CHROME_STRINGS.ro).sort()
    for (const l of LANGS) {
      expect(Object.keys(CHROME_STRINGS[l]).sort()).toEqual(roKeys)
      for (const [k, v] of Object.entries(CHROME_STRINGS[l])) {
        expect(v.trim(), `${l}.${k}`).not.toBe('')
        expect(v, `${l}.${k}`).not.toMatch(/\{\w+\}/)
      }
    }
  })

  it('CR2 româna rămâne textul de dinainte', () => {
    expect(CHROME_STRINGS.ro.loading).toBe('Se încarcă…')
    expect(CHROME_STRINGS.ro.confirm_ok).toBe('Confirmă')
    expect(CHROME_STRINGS.ro.confirm_cancel).toBe('Anulează')
    expect(CHROME_STRINGS.ro.toast_close).toBe('Închide notificarea')
    expect(CHROME_STRINGS.ro.cookie_accept).toBe('Acceptă toate')
    expect(CHROME_STRINGS.ro.err_network).toBe(MSG_NETWORK)
  })
})

describe('cromul comun — limba', () => {
  it('CR3 chromeLangOf', () => {
    expect(chromeLangOf('de-AT')).toBe('de')
    expect(chromeLangOf('FR')).toBe('fr')
    expect(chromeLangOf('ro')).toBe('ro')
    expect(chromeLangOf('en_GB')).toBe('en')
    expect(chromeLangOf('it')).toBe('en')
    expect(chromeLangOf('hu')).toBe('en')
    expect(chromeLangOf('')).toBe('ro')
    expect(chromeLangOf(null)).toBe('ro')
  })

  it('CR4 `<html lang>` și preferințele browserului', () => {
    expect(documentChromeLang()).toBe('ro')
    document.documentElement.setAttribute('lang', 'de')
    expect(documentChromeLang()).toBe('de')
    vi.stubGlobal('navigator', { language: 'it-IT', languages: ['it-IT', 'fr-FR', 'en'] })
    expect(browserChromeLang()).toBe('fr')
    vi.stubGlobal('navigator', { language: 'ja', languages: ['ja', 'zh'] })
    expect(browserChromeLang()).toBe('en')
  })

  it('CR5 modulul nu importă nimic', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/i18n/chrome.ts'), 'utf8')
    expect(src).not.toMatch(/^\s*import\s/m)
  })
})

describe('cromul comun — limba declarată pe etichete', () => {
  it('CR6 chromeFallbackLang', () => {
    expect(chromeFallbackLang('it', chromeLangOf('it'))).toBe('en')
    expect(chromeFallbackLang('hu-HU', chromeLangOf('hu-HU'))).toBe('en')
    // Aceeași limbă (cu sau fără regiune) → moștenește.
    expect(chromeFallbackLang('de', chromeLangOf('de'))).toBeUndefined()
    expect(chromeFallbackLang('fr-CA', chromeLangOf('fr-CA'))).toBeUndefined()
    expect(chromeFallbackLang('', chromeLangOf(''))).toBeUndefined()
    expect(chromeFallbackLang(null, 'ro')).toBeUndefined()
  })
})

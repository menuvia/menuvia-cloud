// tests/functions/posthog-env.test.js
// CLICHET: cheia PostHog ajunge DOAR în build-ul de PRODUCȚIE.
//
// `VITE_POSTHOG_KEY` e o cheie de proiect `phc_` — PUBLICĂ prin construcție (o
// citește oricine din JS-ul paginii), deci stă în repo. Riscul nu e scurgerea
// ei, ci LOCUL: o cheie pusă în `[build.environment]` sau într-un context de
// preview ar trimite în proiectul de producție evenimentele fiecărui deploy
// preview, ale fiecărui branch deploy și ale E2E-ului — cifre false de
// activare exact în pâlnia pe care o măsurăm. Valoarea din netlify.toml bate
// UI-ul Netlify, deci fișierul e sursa de adevăr pentru contexte.
//
//   PE1  în netlify.toml, cheia `phc_` apare O SINGURĂ dată, în
//        `[context.production.environment]`, ca `VITE_POSTHOG_KEY`.
//   PE2  hostul de producție e cel UE (eu.i.posthog.com) — politica promite
//        PostHog Cloud UE; un host US ar muta datele în SUA tăcut.
//   PE3  niciun `VITE_POSTHOG_*` în afara contextului de producție (build,
//        deploy-preview, branch-deploy, develop sau orice context nou).
//   PE4  deploy-vps.yml (producția de rezervă) construiește cu ACEEAȘI cheie și
//        același host UE, în pasul de build; niciun alt workflow nu are cheia
//        (CI/E2E/Lighthouse rămân fără analytics).
//   PE5  în tot repo-ul, un token `phc_` real apare doar în cele două fișiere.
//   PE6  anti-vacuitate: parserul vede contextele cunoscute.
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const TOML = path.join(ROOT, 'netlify.toml')
const VPS = path.join(ROOT, '.github', 'workflows', 'deploy-vps.yml')
const EU_HOST = 'https://eu.i.posthog.com'
// Un token de proiect real: prefixul + cel puțin 30 de caractere. Placeholder-ele
// din documentație (`phc_xxx`) nu se potrivesc.
const KEY_RE = /phc_[A-Za-z0-9]{30,}/g

/** Secțiunile TOML (antet → linii), fără comentarii. */
function tomlSections(text) {
  const out = new Map()
  let cur = '(root)'
  out.set(cur, [])
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (line.startsWith('#') || line === '') continue
    const h = /^\[\[?([^\]]+)\]\]?$/.exec(line)
    if (h) {
      cur = h[1].trim()
      if (!out.has(cur)) out.set(cur, [])
      continue
    }
    out.get(cur).push(line)
  }
  return out
}

function tomlValue(lines, key) {
  for (const l of lines) {
    const m = new RegExp(`^${key}\\s*=\\s*"([^"]*)"$`).exec(l)
    if (m) return m[1]
  }
  return null
}

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'coverage', 'playwright-report', 'test-results'].includes(ent.name)) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full, out)
    else if (ent.isFile() && fs.statSync(full).size < 2_000_000) out.push(full)
  }
  return out
}

const PROD = 'context.production.environment'

describe('PostHog — cheia doar în producție', () => {
  const sections = tomlSections(fs.readFileSync(TOML, 'utf8'))
  const prodKey = tomlValue(sections.get(PROD) ?? [], 'VITE_POSTHOG_KEY')

  it('PE6 anti-vacuitate: contextele cunoscute se citesc', () => {
    for (const s of [
      'build.environment',
      PROD,
      'context.branch-deploy.environment',
      'context."develop".environment',
      'context.deploy-preview.environment',
    ]) {
      assert.ok(sections.has(s), `secțiunea ${s} lipsește din parser`)
    }
  })

  it('PE1 cheia apare o dată, ca VITE_POSTHOG_KEY în producție', () => {
    assert.ok(prodKey, 'VITE_POSTHOG_KEY lipsește din [context.production.environment]')
    assert.match(prodKey, /^phc_[A-Za-z0-9]{30,}$/)
    const text = fs.readFileSync(TOML, 'utf8')
    assert.deepEqual(text.match(KEY_RE), [prodKey], 'cheia apare și în altă parte a lui netlify.toml')
  })

  it('PE2 hostul de producție e cel UE', () => {
    assert.equal(tomlValue(sections.get(PROD), 'VITE_POSTHOG_HOST'), EU_HOST)
  })

  it('PE3 niciun VITE_POSTHOG_* în afara producției', () => {
    const leaks = []
    for (const [name, lines] of sections) {
      if (name === PROD) continue
      for (const l of lines) if (/VITE_POSTHOG_|phc_/.test(l)) leaks.push(`[${name}] ${l}`)
    }
    assert.deepEqual(leaks, [])
  })

  it('PE4 deploy-vps.yml construiește cu aceeași cheie și același host UE', () => {
    const yml = fs.readFileSync(VPS, 'utf8')
    const step = /- name: Install \+ build \(env de producție\)[\s\S]*?\n\s+run: \|/.exec(yml)
    assert.ok(step, 'pasul de build de producție din deploy-vps.yml nu se mai găsește')
    const key = /VITE_POSTHOG_KEY:\s*(\S+)/.exec(step[0])
    const host = /VITE_POSTHOG_HOST:\s*(\S+)/.exec(step[0])
    assert.ok(key && host, 'VITE_POSTHOG_KEY/HOST lipsesc din env-ul pasului de build')
    assert.equal(key[1], prodKey)
    assert.equal(host[1], EU_HOST)
    assert.deepEqual(yml.match(KEY_RE), [prodKey], 'cheia apare în deploy-vps.yml în afara pasului de build')
  })

  it('PE5 niciun alt fișier din repo nu conține un token phc_ real', () => {
    const allowed = new Set(['netlify.toml', '.github/workflows/deploy-vps.yml'])
    const hits = []
    const files = walk(ROOT, [])
    assert.ok(files.length > 500, `scanarea vede prea puține fișiere (${files.length})`)
    for (const f of files) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/')
      if (allowed.has(rel)) continue
      const text = fs.readFileSync(f, 'utf8')
      if (KEY_RE.test(text)) hits.push(rel)
      KEY_RE.lastIndex = 0
    }
    assert.deepEqual(hits, [])
  })
})

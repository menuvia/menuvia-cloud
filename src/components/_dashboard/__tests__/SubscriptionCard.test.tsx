// SubscriptionCard — „Abonament & facturare" din Setări → Abonament & cont
// (lotul O7c, nov 2026). Cardul îl vede DOAR proprietarul (SA1/SA2 din
// SettingsTabPlan.test.tsx), iar serverul (stripe-portal.js) răspunde 404
// `no_customer` când contul lui n-are client Stripe: proprietar pe gratuit care
// n-a pornit niciodată un checkout, sau cu plan setat manual / pilot. Până acum
// cardul îi spunea „Abonamentul e gestionat de contul proprietarului
// restaurantului." — fals (EL e proprietarul) și fără nicio ieșire.
//
//   SUB1  `no_customer` → textul neutru „…nu ai nimic de gestionat…" în
//         role=status, NICIUN „proprietar" în card, „Vezi planurile" ÎN LOCUL lui
//         „Gestionează abonamentul", iar click-ul cheamă `onSeePlans` o dată.
//         Mutațiile care pică: textul vechi „gestionat de contul proprietarului"
//         (b); butonul scos (c); butonul legat de un no-op (d).
//   SUB2  CONTROL POZITIV pentru SUB1: la prima randare și pe calea de redirect
//         (promisiune care nu se rezolvă) nu există „Vezi planurile" și nici
//         textul de no_customer. Mutația care pică: „Vezi planurile" randat
//         necondiționat (SUB1 singur ar rămâne verde).
//   SUB3  `portal_unavailable` cu mesaj românesc → role=alert cu EXACT acel text,
//         fără „Vezi planurile", iar „Gestionează abonamentul" rămâne (se poate
//         reîncerca). Mutația care pică: orice eroare cu cod tratată ca
//         no_customer (`if (be.code)`).
//   SUB4  corp englezesc fără cod („Stripe not configured", env lipsă pe server)
//         → textul de rezervă românesc, iar textul englezesc NU ajunge în DOM.
//         Mutația care pică: revenirea la `be.message || …`.
//   SUB5  (lotul L8d) în română un `code` cunoscut NU înlocuiește textul
//         serverului: `server_config` cu „Stripe not configured" → tot rezerva
//         românească (ca SUB4), iar portalul primește limba panoului ('ro' fără
//         provider). Mutațiile care pică: harta de coduri consultată și în
//         română (ar afișa „Portalul de facturare nu e disponibil momentan.");
//         `openBillingPortal()` fără limbă.
//   SUB6  (lotul L8d, recenzia adversarială) `PORTAL_ERROR_KEYS`
//         (lib/portalErrors.ts) are EXACT codurile de eroare pe care le scrie
//         stripe-portal.js, fără `no_customer` (ramura lui), citite din SURSA
//         funcției — cu control pozitiv pe extractor (comentariile nu contează,
//         un obiect pe mai multe linii da, cheia citată `'code'`/`"code"` da, un
//         text în formă de apel ÎN INTERIORUL unui șir / șablon / regex nu —
//         apelurile se caută pe TOKENI, nu pe text) și anti-vacuitate (≥ 8
//         coduri, `no_customer` și `portal_unavailable` printre ele). Înainte, șase din
//         cele șapte intrări puteau fi șterse sau scrise greșit fără să pice
//         nimic. Mutațiile care pică: `rate_limit` în loc de `rate_limited`
//         (cheie pe care serverul n-o trimite); o intrare ștearsă; un cod nou
//         în stripe-portal.js fără intrare în hartă; un cod scris cu cheie
//         citată (`'code': 'x'`) ignorat de extractor; un apel citat într-un
//         șir numărat (recenzia CodeRabbit pe #384, runda 2); o gramatică a
//         literalului mai îngustă decât a lui FEC (`portal:v2` ignorat — un
//         singur rând `rate_limit_unavailable` schimbat lângă geamănul lui nu
//         mai schimba setul); toate scrierile lui `code` din același obiect
//         numărate, nu doar ULTIMA, cea efectivă (runda 3).
//   SUB7  în en, fr și de, FIECARE cod → textul lui EXACT (oracolul de mai jos,
//         scris independent de hartă), nu `sub_portalFallback` și nu textul
//         românesc al serverului; controlul pozitiv cere ca cele patru texte +
//         rezerva să fie distincte în fiecare limbă (altfel o cheie re-legată
//         n-ar schimba nimic vizibil). Mutațiile care pică: o intrare ștearsă
//         (rezerva); `server_config` re-legat la `sub_errService`.
import { Suspense, type ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PORTAL_ERROR_KEYS } from '../../../lib/portalErrors'
import { preloadNamespace } from '../../../i18n/core'
import { homeNs } from '../../../i18n/ns/home'
import { commonNs } from '../../../i18n/ns/common'
import homeEn from '../../../i18n/ns/home/en'
import homeFr from '../../../i18n/ns/home/fr'
import homeDe from '../../../i18n/ns/home/de'
import { UiLangScope } from '../../../i18n/UiLangContext'
import type { StaffLang } from '../../../i18n/langs'

const openBillingPortal = vi.fn<(lang?: string) => Promise<never>>()

vi.mock('../../../lib/billing', () => ({
  openBillingPortal: (lang?: string) => openBillingPortal(lang),
}))

import { SubscriptionCard } from '../SubscriptionCard'

function billingError(message: string, code?: string): Error & { code?: string } {
  return Object.assign(new Error(message), { code })
}

const MANAGE = 'Gestionează abonamentul'
const SEE_PLANS = 'Vezi planurile'
const NO_CUSTOMER = /nu ai nimic de gestionat/i

beforeEach(() => {
  openBillingPortal.mockReset()
})

describe('SubscriptionCard', () => {
  it('SUB1: no_customer → mesaj adevărat, fără „proprietar", „Vezi planurile" cheamă onSeePlans', async () => {
    openBillingPortal.mockRejectedValueOnce(
      billingError('Nu ai încă un abonament de gestionat.', 'no_customer'),
    )
    const onSeePlans = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<SubscriptionCard onSeePlans={onSeePlans} />)
    await user.click(screen.getByRole('button', { name: MANAGE }))

    // (a) textul neutru, ca informație (status), nu ca eroare.
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(NO_CUSTOMER)
    expect(screen.queryByRole('alert')).toBeNull()
    // (b) nimic despre „proprietar" — omul care citește E proprietarul.
    expect(container.textContent ?? '').not.toMatch(/proprietar/i)
    // (b') nici promisiunea portalului: fără client Stripe nu există card de
    // actualizat și nici facturi de descărcat (recenzia CodeRabbit pe #351).
    expect(container.textContent ?? '').not.toMatch(/Actualizează cardul|descarcă facturile/)
    // (c) ieșirea înlocuiește butonul inutil, nu se adaugă lângă el.
    const seePlans = screen.getByRole('button', { name: SEE_PLANS })
    expect(screen.queryByRole('button', { name: MANAGE })).toBeNull()
    // (d) ieșirea chiar duce undeva.
    expect(onSeePlans).not.toHaveBeenCalled()
    await user.click(seePlans)
    expect(onSeePlans).toHaveBeenCalledTimes(1)
  })

  it('SUB2: control — fără no_customer nu există „Vezi planurile" (nici la randare, nici la redirect)', async () => {
    const onSeePlans = vi.fn()
    const user = userEvent.setup()
    render(<SubscriptionCard planName="Meniu Digital" onSeePlans={onSeePlans} />)
    // (a) prima randare: doar „Gestionează abonamentul".
    expect(screen.getByRole('button', { name: MANAGE })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SEE_PLANS })).toBeNull()
    expect(screen.queryByText(NO_CUSTOMER)).toBeNull()
    expect(screen.getByText(/Actualizează cardul, schimbă planul sau descarcă facturile/)).toBeInTheDocument()
    expect(onSeePlans).not.toHaveBeenCalled()
    // (b) calea de succes: openBillingPortal redirecționează și nu se mai întoarce.
    openBillingPortal.mockReturnValueOnce(new Promise<never>(() => {}))
    await user.click(screen.getByRole('button', { name: MANAGE }))
    expect(openBillingPortal).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Se deschide…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SEE_PLANS })).toBeNull()
    expect(screen.queryByText(NO_CUSTOMER)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onSeePlans).not.toHaveBeenCalled()
  })

  it('SUB3: portal_unavailable → mesajul serverului ca eroare, „Gestionează abonamentul" rămâne', async () => {
    openBillingPortal.mockRejectedValueOnce(
      billingError('Portalul de facturare nu e disponibil momentan.', 'portal_unavailable'),
    )
    const user = userEvent.setup()
    render(<SubscriptionCard onSeePlans={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: MANAGE }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Portalul de facturare nu e disponibil momentan\.$/)
    expect(screen.queryByRole('button', { name: SEE_PLANS })).toBeNull()
    expect(screen.queryByText(NO_CUSTOMER)).toBeNull()
    // Reîncercarea rămâne posibilă (butonul nu mai e în încărcare).
    expect(screen.getByRole('button', { name: MANAGE })).toBeEnabled()
  })

  it('SUB4: corp englezesc fără cod → textul de rezervă românesc, englezescul nu apare', async () => {
    openBillingPortal.mockRejectedValueOnce(billingError('Stripe not configured'))
    const user = userEvent.setup()
    const { container } = render(<SubscriptionCard onSeePlans={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: MANAGE }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Nu am putut deschide portalul de facturare/)
    expect(container.textContent ?? '').not.toMatch(/Stripe not configured/)
    expect(screen.queryByRole('button', { name: SEE_PLANS })).toBeNull()
  })

  it('SUB5: în română codul nu înlocuiește textul serverului; portalul primește limba', async () => {
    openBillingPortal.mockRejectedValueOnce(billingError('Stripe not configured', 'server_config'))
    const user = userEvent.setup()
    const { container } = render(<SubscriptionCard onSeePlans={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: MANAGE }))

    const alert = await screen.findByRole('alert')
    // Exact ce afișa cardul înainte de L8d pentru același corp (SUB4).
    expect(alert).toHaveTextContent(/Nu am putut deschide portalul de facturare/)
    expect(container.textContent ?? '').not.toMatch(/nu e disponibil momentan/)
    expect(openBillingPortal).toHaveBeenCalledWith('ro')
  })
})

// ── SUB6/SUB7: harta cod → text, legată de server și verificată cod cu cod ──
// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

type Tok = { k: 'id' | 'num' | 'str' | 'tpl' | 'p'; v: string }

/** Sfârșitul unui șablon `…` care începe la `start` (cu `${…}` imbricate). */
function skipTemplate(src: string, start: number): number {
  let i = start + 1
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') return i + 1
    if (c === '$' && src[i + 1] === '{') {
      i += 2
      let depth = 1
      while (i < src.length && depth > 0) {
        const x = src[i]
        if (x === "'" || x === '"') {
          let j = i + 1
          while (j < src.length && src[j] !== x) j += src[j] === '\\' ? 2 : 1
          i = j + 1
          continue
        }
        if (x === '`') {
          i = skipTemplate(src, i)
          continue
        }
        if (x === '{') depth += 1
        else if (x === '}') depth -= 1
        i += 1
      }
      continue
    }
    i += 1
  }
  return i
}

/**
 * Tokenii unei surse JS: comentariile se sar, iar un șir, un șablon sau un
 * regex devin UN singur token — deci nimic din interiorul lor nu poate arăta
 * ca un apel sau ca o cheie.
 */
function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  const n = src.length
  // Un `/` începe un regex după un operator / o paranteză deschisă / `return`.
  const regexAllowed = (): boolean => {
    const prev = out[out.length - 1]
    if (prev === undefined) return true
    if (prev.k === 'p') return !')]}'.includes(prev.v)
    return prev.k === 'id' && (prev.v === 'return' || prev.v === 'typeof')
  }
  let i = 0
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (/\s/.test(c)) {
      i += 1
    } else if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i)
      i = e < 0 ? n : e
    } else if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2)
      i = e < 0 ? n : e + 2
    } else if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      out.push({ k: 'str', v: src.slice(i + 1, j) })
      i = j + 1
    } else if (c === '`') {
      i = skipTemplate(src, i)
      out.push({ k: 'tpl', v: '' })
    } else if (c === '/' && regexAllowed()) {
      let j = i + 1
      let cls = false
      while (j < n && src[j] !== '\n') {
        const x = src[j]
        if (x === '\\') {
          j += 2
          continue
        }
        if (x === '[') cls = true
        else if (x === ']') cls = false
        else if (x === '/' && !cls) break
        j += 1
      }
      j += 1
      while (j < n && /[a-z]/i.test(src[j])) j += 1
      out.push({ k: 'tpl', v: '' })
      i = j
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < n && /[\w$]/.test(src[j])) j += 1
      out.push({ k: 'id', v: src.slice(i, j) })
      i = j
    } else if (/[0-9]/.test(c)) {
      let j = i
      while (j < n && /[0-9.]/.test(src[j])) j += 1
      out.push({ k: 'num', v: src.slice(i, j) })
      i = j
    } else if (src.startsWith('...', i)) {
      out.push({ k: 'p', v: '...' })
      i += 3
    } else {
      out.push({ k: 'p', v: c })
      i += 1
    }
  }
  return out
}

const isPunct = (t: Tok | undefined, v: string): boolean => t !== undefined && t.k === 'p' && t.v === v

// Gramatica literalului de cod — ACEEAȘI ca la FEC (`literalString` din
// tests/functions/fn-error-code-ratchet.test.js): litere mici, cifre, `_` și
// `:`. Una mai îngustă ar ignora tăcut un cod pe care FEC1 îl acceptă
// (`portal:v2`), deci un rând schimbat lângă un rând-geamăn neschimbat n-ar
// schimba nimic aici.
const CODE_LITERAL = /^[a-z0-9_:]+$/

/**
 * Codurile din corpurile `jsonResponse(<status non-2xx>, { …, code: '<x>' })`
 * ale unei funcții. Apelurile se caută pe TOKENI (un text în formă de apel
 * dintr-un șir, șablon, regex sau comentariu nu e apel — recenzia CodeRabbit
 * pe #384, runda 2) și se citește PROPRIETATEA `code` de la primul nivel al
 * corpului, cu cheia identificator SAU citată (`'code'` / `"code"`), a cărei
 * valoare e EXACT un literal (urmat de `,` sau `}`): un `code: 'x'` din
 * interiorul unui mesaj de eroare nu contează, iar un cod cu cifre
 * (`customer_lookup_v2_failed`) sau cu `:` nu e ratat. Pe un obiect cu mai
 * multe scrieri ale lui `code` (citate sau nu) contează doar ULTIMA — cea
 * efectivă în JS; dacă ea nu e un literal, corpul n-are cod citibil.
 */
function serverCodes(src: string): string[] {
  const toks = tokenize(src)
  const found = new Set<string>()
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.k !== 'id' || t.v !== 'jsonResponse' || isPunct(toks[i - 1], '.')) continue
    const status = toks[i + 2]
    if (!isPunct(toks[i + 1], '(') || status === undefined || status.k !== 'num' || !/^\d{3}$/.test(status.v)) continue
    if (!isPunct(toks[i + 3], ',') || !isPunct(toks[i + 4], '{')) continue
    const code = Number(status.v)
    if (code >= 200 && code < 300) continue
    let depth = 0
    let last: string | null = null
    for (let j = i + 4; j < toks.length; j++) {
      const x = toks[j]
      if (x.k === 'p' && '{[('.includes(x.v)) depth += 1
      else if (x.k === 'p' && '}])'.includes(x.v)) {
        depth -= 1
        if (depth === 0) break
      }
      // Începutul unei proprietăți la primul nivel: `{`-ul corpului sau un `,`.
      if (depth !== 1 || !(j === i + 4 || isPunct(x, ','))) continue
      const key = toks[j + 1]
      const value = toks[j + 3]
      const isCodeKey = key !== undefined && (key.k === 'id' || key.k === 'str') && key.v === 'code'
      if (!isCodeKey) continue
      // O scriere a lui `code` (și forma scurtă `{ code }` / o metodă `code()`)
      // înlocuiește orice scriere de dinainte.
      last =
        isPunct(toks[j + 2], ':') &&
        value !== undefined &&
        value.k === 'str' &&
        CODE_LITERAL.test(value.v) &&
        (isPunct(toks[j + 4], ',') || isPunct(toks[j + 4], '}'))
          ? value.v
          : null
    }
    if (last !== null) found.add(last)
  }
  return [...found].sort()
}

type SubErrKey = 'sub_errUnavailable' | 'sub_errRateLimited' | 'sub_errSession' | 'sub_errService'

// Oracolul, scris INDEPENDENT de `PORTAL_ERROR_KEYS`: ce trebuie să citească
// omul pentru fiecare refuz al portalului.
const EXPECTED_KEY: Readonly<Record<string, SubErrKey>> = {
  server_config: 'sub_errUnavailable', // env lipsă pe server: pentru om, portalul nu merge
  portal_unavailable: 'sub_errUnavailable',
  rate_limited: 'sub_errRateLimited',
  auth_missing: 'sub_errSession',
  auth_invalid: 'sub_errSession',
  rate_limit_unavailable: 'sub_errService',
  service_unavailable: 'sub_errService',
}

const DICTS = { en: homeEn, fr: homeFr, de: homeDe } as const

function inLang(lang: StaffLang, node: ReactNode) {
  return render(
    <UiLangScope lang={lang}>
      <Suspense fallback={null}>{node}</Suspense>
    </UiLangScope>,
  )
}

describe('SubscriptionCard — harta codurilor portalului (lotul L8d)', () => {
  beforeAll(async () => {
    const langs: StaffLang[] = ['en', 'fr', 'de']
    await Promise.all(
      langs.flatMap((l) => [preloadNamespace(homeNs, l), preloadNamespace(commonNs, l)]),
    )
  })

  it('SUB6: harta are EXACT codurile de eroare din stripe-portal.js (fără no_customer)', () => {
    // Control pozitiv pe extractor: comentariile nu contează, un URL nu e
    // comentariu, un obiect pe mai multe linii contează.
    const sample = [
      "// return jsonResponse(500, { error: 'x', code: 'din_comentariu' })",
      "/* code: 'din_bloc' */",
      "return jsonResponse(429, { error: 'Prea multe', code: 'rate_limited' })",
      "return jsonResponse(404, {\n  error: 'Nu',\n  code: 'no_customer',\n})",
      "const u = 'https://x.test' // code: 'dupa_url'",
      // Un cod cu cifre se vede; un „code: …” din interiorul mesajului NU;
      // un răspuns 2xx nu e eroare; un `code` imbricat nu e al corpului.
      "return jsonResponse(503, { error: 'x', code: 'customer_lookup_v2_failed' })",
      "return jsonResponse(500, { error: \"Folosiți code: 'legacy_customer'\", code: 'real_code' })",
      "return jsonResponse(200, { url, code: 'ok_code' })",
      "return jsonResponse(400, { error: 'y', detail: { code: 'nested_code' }, code: 'outer_code' })",
      // Cheia CITATĂ e tot `code` (ambele ghilimele).
      "return jsonResponse(503, { error: 'x', 'code': 'quoted_single' })",
      'return jsonResponse(503, { "code": \'quoted_double\', error: \'x\' })',
      // Un text în formă de apel ÎN INTERIORUL unui șir / șablon nu e apel.
      'const note = "diagnostic: jsonResponse(500, { code: \'example_only\' })"',
      "const esc = 'vezi jsonResponse(500, { code: \\'esc_only\\' })'",
      'const t = `jsonResponse(500, { code: \'in_template\' }) ${x}`',
      // Un regex cu ghilimele nu înghite restul fișierului.
      "const q = s.replace(/'/g, ''); return jsonResponse(409, { code: 'after_regex' })",
      // Valoarea trebuie să fie EXACT literalul (nu o expresie care îl conține).
      "return jsonResponse(500, { code: 'prefix_' + suffix })",
      // Aceeași gramatică ca FEC: un cod cu `:` se vede.
      "return jsonResponse(503, { error: 'x', code: 'portal:v2' })",
      // Mai multe scrieri ale lui `code`: doar ULTIMA (efectivă) contează, în
      // ambele ordini ale formelor citată / necitată; una ne-literală la final
      // lasă corpul fără cod.
      "return jsonResponse(503, { code: 'first_unquoted', error: 'x', 'code': 'last_quoted' })",
      'return jsonResponse(503, { "code": \'first_quoted\', code: \'last_unquoted\' })',
      "return jsonResponse(503, { code: 'shadowed_lit', code: notLiteral })",
      "return jsonResponse(503, { 'code': 'shadowed_short', code })",
    ].join('\n')
    expect(serverCodes(sample)).toEqual([
      'after_regex',
      'customer_lookup_v2_failed',
      'last_quoted',
      'last_unquoted',
      'no_customer',
      'outer_code',
      'portal:v2',
      'quoted_double',
      'quoted_single',
      'rate_limited',
      'real_code',
    ])

    const portalSrc = read('netlify/functions/stripe-portal.js')
    const server = serverCodes(portalSrc)
    // Un SINGUR rând din cele două `rate_limit_unavailable` schimbat (pe un cod
    // cu `:`, pe care FEC1 îl acceptă) trebuie să schimbe rezultatul: cu o
    // gramatică mai îngustă rândul schimbat ar fi ignorat, iar geamănul lui
    // neschimbat ar fi ținut setul identic.
    const twin = "code: 'rate_limit_unavailable'"
    expect(portalSrc.split(twin).length - 1).toBe(2)
    const mutated = serverCodes(portalSrc.replace(twin, "code: 'rate_limit:v2'"))
    expect(mutated).not.toEqual(server)
    expect(mutated).toContain('rate_limit:v2')
    expect(mutated).toContain('rate_limit_unavailable')
    // Anti-vacuitate: extractorul chiar vede funcția reală.
    expect(server).toContain('no_customer')
    expect(server).toContain('portal_unavailable')
    expect(server.length).toBeGreaterThanOrEqual(8)
    const errors = server.filter((c) => c !== 'no_customer')
    expect(Object.keys(PORTAL_ERROR_KEYS).sort()).toEqual(errors)
    // Oracolul de la SUB7 acoperă și el fiecare cod (un cod nou cere textul lui).
    expect(Object.keys(EXPECTED_KEY).sort()).toEqual(errors)
  })

  it('SUB7: în en/fr/de fiecare cod → textul lui, nu rezerva și nu româna serverului', async () => {
    const user = userEvent.setup()
    for (const lang of ['en', 'fr', 'de'] as const) {
      const d = DICTS[lang]
      // Control: textele diferă între ele și de rezervă, altfel o cheie
      // re-legată sau o intrare ștearsă n-ar schimba nimic pe ecran.
      const texts = [
        d.sub_errUnavailable,
        d.sub_errRateLimited,
        d.sub_errSession,
        d.sub_errService,
        d.sub_portalFallback,
      ]
      expect(new Set(texts).size, lang).toBe(texts.length)
      for (const [code, key] of Object.entries(EXPECTED_KEY)) {
        openBillingPortal.mockRejectedValueOnce(
          billingError(`Refuz românesc al serverului (${code}).`, code),
        )
        const { container, unmount } = inLang(lang, <SubscriptionCard onSeePlans={vi.fn()} />)
        await user.click(screen.getByRole('button', { name: d.sub_manage }))
        const alert = await screen.findByRole('alert')
        expect(alert.textContent, `${lang} ${code}`).toBe(d[key])
        expect(alert.textContent, `${lang} ${code}`).not.toBe(d.sub_portalFallback)
        expect(container.textContent ?? '', `${lang} ${code}`).not.toMatch(/Refuz românesc/)
        expect(openBillingPortal).toHaveBeenLastCalledWith(lang)
        unmount()
      }
    }
  })
})

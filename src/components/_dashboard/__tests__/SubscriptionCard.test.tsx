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
//         un obiect pe mai multe linii da) și anti-vacuitate (≥ 8 coduri,
//         `no_customer` și `portal_unavailable` printre ele). Înainte, șase din
//         cele șapte intrări puteau fi șterse sau scrise greșit fără să pice
//         nimic. Mutațiile care pică: `rate_limit` în loc de `rate_limited`
//         (cheie pe care serverul n-o trimite); o intrare ștearsă; un cod nou
//         în stripe-portal.js fără intrare în hartă.
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

/**
 * Codurile din corpurile `jsonResponse(<status non-2xx>, { …, code: '<x>' })`
 * ale unei funcții, fără comentarii. Se citește PROPRIETATEA `code` de la
 * primul nivel al corpului, nu orice text care arată ca un cod (recenzie
 * CodeRabbit pe #384): un `code: 'x'` din INTERIORUL unui mesaj de eroare nu
 * contează, iar un cod cu cifre (`customer_lookup_v2_failed`) nu e ratat.
 */
function serverCodes(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const found = new Set<string>()
  const call = /\bjsonResponse\(\s*(\d{3})\s*,\s*\{/g
  for (const m of code.matchAll(call)) {
    const status = Number(m[1])
    if (status >= 200 && status < 300) continue
    // Parcurge corpul `{ … }` cu adâncime și șiruri; reține doar `code:` de
    // la adâncimea 1 urmat de un literal.
    let i = (m.index ?? 0) + m[0].length
    let depth = 1
    let atKey = ''
    while (i < code.length && depth > 0) {
      const ch = code[i]
      if (ch === "'" || ch === '"' || ch === '`') {
        let j = i + 1
        while (j < code.length && code[j] !== ch) j += code[j] === '\\' ? 2 : 1
        const literal = code.slice(i + 1, j)
        if (depth === 1 && /(^|[\s,{])code\s*:\s*$/.test(atKey) && /^[a-z][a-z0-9_]*$/.test(literal)) {
          found.add(literal)
        }
        atKey = ''
        i = j + 1
        continue
      }
      if (ch === '{' || ch === '[' || ch === '(') depth += 1
      else if (ch === '}' || ch === ']' || ch === ')') depth -= 1
      if (depth === 1) atKey = ch === ',' ? ',' : atKey + ch
      i += 1
    }
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
    ].join('\n')
    expect(serverCodes(sample)).toEqual([
      'customer_lookup_v2_failed',
      'no_customer',
      'outer_code',
      'rate_limited',
      'real_code',
    ])

    const server = serverCodes(read('netlify/functions/stripe-portal.js'))
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

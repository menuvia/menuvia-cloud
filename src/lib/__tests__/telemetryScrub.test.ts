// Igiena telemetriei: tokenurile din URL nu ajung la Sentry / PostHog.
//
//   TS1  calea cu token e redactată pe fiecare prefix (șef, agent, invitație, QR)
//   TS2  query string, hash și URL absolut: tokenul dispare, restul rămâne
//   TS3  tokenul ÎMPACHETAT într-un parametru (?next=%2F…), o dată și de două ori codificat
//   TS4  căile nepotrivite rămân NEATINSE (byte-identic)
//   TS5  parametri sensibili (access_token, cancel, secretul intentului Stripe…) redactați;
//        ceilalți rămân
//   TS6  idempotent: a doua trecere nu schimbă nimic
//   TS7  parcurgere profundă: obiecte, array-uri, câmpuri imbricate; netextul rămâne
//   TS8  referință circulară nu blochează și nu scurge
//   TS9  forma evenimentelor reale (Sentry, PostHog) — fiecare câmp cu URL
//   TS10 CABLAJUL Sentry: beforeSend, beforeSendSpan, beforeBreadcrumb trec prin
//        scrubTokenPathsDeep — funcția pură nu ajută dacă nu e chemată. Cablajul PostHog NU
//        se mai verifică aici pe text-sursă (dubla AN3/AN4 și pica pe un comentariu, recenzia
//        CodeRabbit pe #385): AN3 (__tests__/analytics.test.ts) îngheață configurația
//        EFECTIVĂ primită de `posthog.init` — `before_send` ESTE `minimizeCaptureResult`,
//        `capture_heatmaps: false` —, iar AN4 îi exersează redactarea. (TS12 retras din
//        același motiv.)
//   TS11 CHEILE obiectelor se redactează (heatmap-ul PostHog pune URL-ul curent drept cheie);
//        două chei care devin identice după redactare își îmbină array-urile
//   TS13 numele parametrului se potrivește DECODAT: `payment%5Fintent_client_secret` e
//        citit de URLSearchParams ca secretul intentului, deci se redactează la fel;
//        parametrii nesensibili (redirect_status) rămân neatinși
//   TS14 un `?` NECODIFICAT în valoarea unui parametru nesensibil
//        (`?next=/reset-password?access_token=…`) începe un parametru nou, care se
//        verifică și el; valorile nesensibile rămân octet cu octet
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { scrubTokenPaths, scrubTokenPathsDeep } from '../telemetryScrub'

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'

describe('scrubTokenPaths', () => {
  it('TS1: redactează tokenul pe fiecare prefix', () => {
    expect(scrubTokenPaths(`/sef-vanzari/${TOKEN}`)).toBe('/sef-vanzari/:token')
    expect(scrubTokenPaths(`/echipa/${TOKEN}`)).toBe('/echipa/:token')
    expect(scrubTokenPaths(`/invite/${TOKEN}`)).toBe('/invite/:token')
    expect(scrubTokenPaths(`/q/${TOKEN}`)).toBe('/q/:token')
  })

  it('TS2: query, hash și URL absolut', () => {
    expect(scrubTokenPaths(`https://menuvia.ro/sef-vanzari/${TOKEN}?utm=x#top`)).toBe(
      'https://menuvia.ro/sef-vanzari/:token?utm=x#top',
    )
    expect(scrubTokenPaths(`/q/${TOKEN}?table=4`)).toBe('/q/:token?table=4')
    expect(scrubTokenPaths(`/echipa/${TOKEN}#sectiune`)).toBe('/echipa/:token#sectiune')
    expect(scrubTokenPaths(`https://menuvia.ro/invite/${TOKEN}`)).not.toContain(TOKEN)
  })

  it('TS3: tokenul împachetat într-un parametru, o dată și de două ori codificat', () => {
    const once = `/auth?mode=signup&next=${encodeURIComponent(`/sef-vanzari/${TOKEN}`)}`
    expect(once).toContain('%2Fsef-vanzari%2F')
    expect(scrubTokenPaths(once)).toBe('/auth?mode=signup&next=%2Fsef-vanzari%2F:token')
    const twice = `/auth?next=${encodeURIComponent(encodeURIComponent(`/echipa/${TOKEN}`))}`
    expect(twice).toContain('%252Fechipa%252F')
    expect(scrubTokenPaths(twice)).not.toContain(TOKEN)
    // codificarea cu litere mici (%2f) e tratată la fel
    expect(scrubTokenPaths(`?next=%2fq%2f${TOKEN}`)).toBe('?next=%2fq%2f:token')
  })

  it('TS4: căile nepotrivite rămân neatinse', () => {
    const untouched = [
      '/',
      '/dashboard',
      '/dashboard?tab=billing',
      '/m/pizzeria-mario',
      '/rezervare/pizzeria-mario',
      '/echipa',
      '/echipa/',
      '/sef-vanzari',
      '/invitee/abc',
      '/faq/abc',
      '/echipamente/abc',
      '/afiliat',
      'https://menuvia.ro/pricing?plan=growth',
      'Eroare la încărcare',
      '',
    ]
    for (const s of untouched) expect(scrubTokenPaths(s)).toBe(s)
  })

  it('TS5: parametri sensibili redactați, ceilalți rămân', () => {
    expect(scrubTokenPaths('/reset-password#access_token=abc.def&type=recovery')).toBe(
      '/reset-password#access_token=[redacted]&type=recovery',
    )
    expect(scrubTokenPaths('/rezervare/loc?cancel=XK92&lang=ro')).toBe(
      '/rezervare/loc?cancel=[redacted]&lang=ro',
    )
    expect(scrubTokenPaths('/x?a=1&refresh_token=zzz&token_hash=hhh')).toBe(
      '/x?a=1&refresh_token=[redacted]&token_hash=[redacted]',
    )
    // un nume care DOAR conține cuvântul nu se atinge
    expect(scrubTokenPaths('/x?zipcode=1234&tab=billing')).toBe('/x?zipcode=1234&tab=billing')
    // Revenirea din Stripe (3DS / redirect) pe /q/:token: secretul și id-ul
    // intentului nu pleacă (mutația: cheile scoase din SENSITIVE_PARAMS).
    expect(
      scrubTokenPaths(
        '/q/T?payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_X&redirect_status=succeeded',
      ),
    ).toBe(
      '/q/:token?payment_intent=[redacted]&payment_intent_client_secret=[redacted]&redirect_status=succeeded',
    )
    expect(
      scrubTokenPaths('/x?setup_intent=seti_1&setup_intent_client_secret=seti_1_secret_Y'),
    ).toBe('/x?setup_intent=[redacted]&setup_intent_client_secret=[redacted]')
  })

  it('TS6: idempotent', () => {
    const s = `https://menuvia.ro/auth?next=%2Fsef-vanzari%2F${TOKEN}#access_token=q`
    const once = scrubTokenPaths(s)
    expect(scrubTokenPaths(once)).toBe(once)
  })

  it('TS13: numele codificat procent se potrivește DECODAT, ca în URLSearchParams', () => {
    // Mutația care pică: potrivirea pe textul literal al numelui (regex-ul vechi
    // lăsa `pi_1_secret_X` în URL-ul trimis la Sentry/PostHog).
    const tail = 'intent_client_secret=pi_1_secret_X&redirect_status=succeeded'
    const literal = `/q/T?payment_intent=pi_1&payment_${tail}`
    const encoded = `/q/T?payment_intent=pi_1&payment%5F${tail}`
    // Premisa: aplicația citește ambele scrieri ca ACELAȘI parametru.
    for (const u of [literal, encoded]) {
      expect(new URL(u, 'https://site.test').searchParams.get('payment_intent_client_secret')).toBe(
        'pi_1_secret_X',
      )
    }
    expect(scrubTokenPaths(literal)).toBe(
      '/q/:token?payment_intent=[redacted]&payment_intent_client_secret=[redacted]&redirect_status=succeeded',
    )
    expect(scrubTokenPaths(encoded)).toBe(
      '/q/:token?payment_intent=[redacted]&payment%5Fintent_client_secret=[redacted]&redirect_status=succeeded',
    )
    expect(scrubTokenPaths(scrubTokenPaths(encoded))).toBe(scrubTokenPaths(encoded))
    // Escape cu litere mici, altă literă codificată, codificare dublă.
    expect(scrubTokenPaths('/x?payment%5fintent_client_secret=S')).toBe(
      '/x?payment%5fintent_client_secret=[redacted]',
    )
    expect(scrubTokenPaths('/reset-password#%61ccess_token=abc&type=recovery')).toBe(
      '/reset-password#%61ccess_token=[redacted]&type=recovery',
    )
    expect(scrubTokenPaths('/x?setup%255Fintent=seti_2')).toBe('/x?setup%255Fintent=[redacted]')
    // Control: ce nu e sensibil rămâne byte-identic — și codificat, și cu o
    // secvență invalidă, și un nume care doar CONȚINE un cuvânt sensibil.
    for (const s of [
      '/q/:token?redirect%5Fstatus=succeeded&lang=ro',
      '/x?tab%3D=1&lang=ro',
      '/x?%E0%A4%A=1&tab=billing',
      '/x?zip%63ode=1234',
    ]) {
      expect(scrubTokenPaths(s)).toBe(s)
    }
  })

  it('TS14: un `?` necodificat în valoarea unui parametru nesensibil începe un parametru nou', () => {
    // Mutația care pică: o singură trecere în care valoarea unui parametru
    // nesensibil merge până la `&`/`#` (prima variantă a potrivirii decodate):
    // `?next=/reset-password?access_token=…` ieșea întreg, cu tokenul în el.
    expect(scrubTokenPaths('https://menuvia.ro/auth?next=/reset-password?access_token=ABC')).toBe(
      'https://menuvia.ro/auth?next=/reset-password?access_token=[redacted]',
    )
    expect(scrubTokenPaths('https://menuvia.ro/rezervare/x?lang=ro?cancel=K7Q2')).toBe(
      'https://menuvia.ro/rezervare/x?lang=ro?cancel=[redacted]',
    )
    expect(scrubTokenPaths('/q/T?ref=a?payment_intent_client_secret=pi_1_secret_X')).toBe(
      '/q/:token?ref=a?payment_intent_client_secret=[redacted]',
    )
    expect(scrubTokenPaths('/x?ref=a?payment%5Fintent_client_secret=S')).toBe(
      '/x?ref=a?payment%5Fintent_client_secret=[redacted]',
    )
    // Pe mai multe niveluri, și cu parametri după.
    expect(scrubTokenPaths('/a?x=1?y=2?code=Z&lang=ro')).toBe('/a?x=1?y=2?code=[redacted]&lang=ro')
    // Valoarea unui parametru SENSIBIL se redactează toată, cu `?` cu tot.
    expect(scrubTokenPaths('/r?cancel=AB?CD&lang=ro')).toBe('/r?cancel=[redacted]&lang=ro')
    const nested = 'https://menuvia.ro/auth?next=/reset-password?access_token=ABC'
    expect(scrubTokenPaths(scrubTokenPaths(nested))).toBe(scrubTokenPaths(nested))
    // Control: un `?` în valori nesensibile rămâne octet cu octet.
    for (const s of [
      '/x?ref=a?b=1&lang=ro',
      '/auth?next=/dashboard?tab=billing',
      '/x?a=?&b=c?',
      '/x?a=1??b',
    ]) {
      expect(scrubTokenPaths(s)).toBe(s)
    }
  })
})

describe('scrubTokenPathsDeep', () => {
  it('TS7: parcurge obiecte și array-uri; netextul rămâne', () => {
    const date = new Date('2026-10-28T10:00:00Z')
    const input = {
      a: `/echipa/${TOKEN}`,
      n: 42,
      b: true,
      z: null,
      d: date,
      list: [`/q/${TOKEN}`, 1, { deep: `/invite/${TOKEN}` }],
      nested: { x: { y: { url: `https://menuvia.ro/sef-vanzari/${TOKEN}?k=1` } } },
    }
    const out = scrubTokenPathsDeep(input)
    expect(out.a).toBe('/echipa/:token')
    expect(out.n).toBe(42)
    expect(out.b).toBe(true)
    expect(out.z).toBeNull()
    expect(out.d).toBe(date)
    expect(out.list).toEqual(['/q/:token', 1, { deep: '/invite/:token' }])
    expect(out.nested.x.y.url).toBe('https://menuvia.ro/sef-vanzari/:token?k=1')
    // originalul nu e mutat
    expect(input.a).toBe(`/echipa/${TOKEN}`)
  })

  it('TS8: referință circulară nu blochează și nu scurge', () => {
    const o: Record<string, unknown> = { url: `/q/${TOKEN}` }
    o.self = o
    const out = scrubTokenPathsDeep(o)
    expect(out.url).toBe('/q/:token')
    expect(JSON.stringify(out)).not.toContain(TOKEN)
  })

  it('TS9: forma evenimentelor Sentry și PostHog', () => {
    const sentryEvent = {
      request: {
        url: `https://menuvia.ro/sef-vanzari/${TOKEN}`,
        headers: { Referer: `https://menuvia.ro/auth?next=%2Fechipa%2F${TOKEN}` },
      },
      transaction: `/echipa/${TOKEN}`,
      breadcrumbs: [
        { category: 'navigation', data: { from: `/q/${TOKEN}`, to: '/dashboard' } },
        {
          category: 'fetch',
          data: { url: `https://x.supabase.co/rest/v1/rpc/f?ref=/invite/${TOKEN}` },
        },
      ],
      exception: { values: [{ value: `Eroare la /invite/${TOKEN}` }] },
    }
    const s = JSON.stringify(scrubTokenPathsDeep(sentryEvent))
    expect(s).not.toContain(TOKEN)
    expect(s).toContain('/dashboard')

    const posthog = {
      event: '$pageview',
      properties: {
        $current_url: `https://menuvia.ro/sef-vanzari/${TOKEN}`,
        $pathname: `/sef-vanzari/${TOKEN}`,
        $referrer: `https://menuvia.ro/invite/${TOKEN}`,
        $initial_referrer: '$direct',
      },
      $set_once: { $initial_current_url: `https://menuvia.ro/echipa/${TOKEN}` },
    }
    const p = scrubTokenPathsDeep(posthog)
    expect(JSON.stringify(p)).not.toContain(TOKEN)
    expect(p.properties.$pathname).toBe('/sef-vanzari/:token')
    expect(p.properties.$initial_referrer).toBe('$direct')
    expect(p.event).toBe('$pageview')
  })

  it('TS11: tokenul din CHEILE obiectelor (heatmap PostHog) e redactat, datele rămân', () => {
    // Mutația „cheia copiată neatinsă” (out[k] = …) lasă tokenul în JSON; mutația
    // „fără îmbinare” pierde punctele primei chei (x: 1) când a doua o suprascrie.
    const other = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210-_edcba'
    const signup = (t: string) => `https://menuvia.ro/auth?mode=signup&next=%2Fsef-vanzari%2F${t}`
    const heatmap = {
      event: '$$heatmap',
      properties: {
        $heatmap_data: {
          [signup(TOKEN)]: [{ x: 1, y: 1, type: 'click' }],
          [signup(other)]: [{ x: 2, y: 2, type: 'click' }],
          'https://menuvia.ro/dashboard': [{ x: 3, y: 3, type: 'mousemove' }],
          [`/echipa/${TOKEN}`]: { nested: `/q/${TOKEN}` },
        },
      },
    }
    const out = scrubTokenPathsDeep(heatmap)
    const json = JSON.stringify(out)
    expect(json).not.toContain(TOKEN)
    expect(json).not.toContain(other)
    expect(out.properties.$heatmap_data).toEqual({
      'https://menuvia.ro/auth?mode=signup&next=%2Fsef-vanzari%2F:token': [
        { x: 1, y: 1, type: 'click' },
        { x: 2, y: 2, type: 'click' },
      ],
      'https://menuvia.ro/dashboard': [{ x: 3, y: 3, type: 'mousemove' }],
      '/echipa/:token': { nested: '/q/:token' },
    })
    // originalul nu e mutat
    expect(Object.keys(heatmap.properties.$heatmap_data)[0]).toContain(TOKEN)
  })
})

// Cablajul se păzește pe sursă: init-urile reale (Sentry/PostHog) nu pot rula în teste,
// iar o funcție corectă dar ne-apelată ar lăsa tokenurile să plece exact ca înainte.
// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
describe('cablajul telemetriei', () => {
  const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')

  it('TS10: hook-urile Sentry trec prin scrubTokenPathsDeep', () => {
    const main = read('src/main.tsx')
    for (const hook of [
      'beforeSend(event)',
      // Sentry 11 trimite spanurile în flux: `beforeSendTransaction` nu mai
      // rulează, deci hook-ul viu pentru căile din spanuri e `beforeSendSpan`.
      'beforeSendSpan(span)',
      'beforeBreadcrumb(breadcrumb)',
    ]) {
      const start = main.indexOf(hook)
      expect(start).toBeGreaterThan(-1)
      // corpul hook-ului: până la acolada lui de închidere (nu și hook-urile vecine)
      const end = main.indexOf('\n    },', start)
      expect(end).toBeGreaterThan(start)
      const body = main.slice(start, end)
      expect(body).toContain('return scrubTokenPathsDeep(')
    }
  })
})

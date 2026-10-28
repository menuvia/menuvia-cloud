// Igiena telemetriei: tokenurile din URL nu ajung la Sentry / PostHog.
//
//   TS1  calea cu token e redactată pe fiecare prefix (șef, agent, invitație, QR)
//   TS2  query string, hash și URL absolut: tokenul dispare, restul rămâne
//   TS3  tokenul ÎMPACHETAT într-un parametru (?next=%2F…), o dată și de două ori codificat
//   TS4  căile nepotrivite rămân NEATINSE (byte-identic)
//   TS5  parametri sensibili (access_token, cancel…) redactați; ceilalți rămân
//   TS6  idempotent: a doua trecere nu schimbă nimic
//   TS7  parcurgere profundă: obiecte, array-uri, câmpuri imbricate; netextul rămâne
//   TS8  referință circulară nu blochează și nu scurge
//   TS9  forma evenimentelor reale (Sentry, PostHog) — fiecare câmp cu URL
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
  })

  it('TS6: idempotent', () => {
    const s = `https://menuvia.ro/auth?next=%2Fsef-vanzari%2F${TOKEN}#access_token=q`
    const once = scrubTokenPaths(s)
    expect(scrubTokenPaths(once)).toBe(once)
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
})

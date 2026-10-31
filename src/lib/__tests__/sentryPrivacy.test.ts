// Ce trimite Sentry din browser (Sentry 11: `sendDefaultPii` → `dataCollection`,
// cu implicitul INVERSAT — nesetat înseamnă „colectează tot”).
//
//   SP1  fiecare categorie de date e oprită, exact (o cheie ștearsă sau trecută
//        pe true pică — implicitul ei ar fi colectarea)
//   SP2  `Sentry.init` din main.tsx primește configurația, iar nimeni din `src/`
//        nu mai setează `sendDefaultPii` (opțiune scoasă, ignorată tăcut în JS).
//        Spanurile trec prin `beforeSendSpan`: în v11 se trimit în flux, iar
//        `beforeSendTransaction` NU mai rulează (cod mort + avertisment în
//        consolă); `traceLifecycle` rămâne nesetat — pe 'static', un
//        `beforeSendSpan` neîmpachetat în `withStaticSpan` nu mai e chemat
//        deloc. Mutația care pică: hook-ul de span scos (tokenul din /q/ și
//        #access_token=… pleacă în `url.path`/`url.full`).
//   SP3  un span în forma v11 (`StreamedSpanJSON`: nume + atribute) iese curățat
//        de `scrubTokenPathsDeep`: calea cu token și fragmentul de autentificare
//        dispar, restul atributelor rămâne neatins
//
// Categoriile NOI dintr-un SDK viitor le prinde typecheck-ul, nu testul:
// SENTRY_DATA_COLLECTION_IS_EXHAUSTIVE din lib/sentryPrivacy.ts.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { SENTRY_DATA_COLLECTION, SENTRY_DATA_COLLECTION_IS_EXHAUSTIVE } from '../sentryPrivacy'
import { scrubTokenPathsDeep } from '../telemetryScrub'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== '__tests__') out.push(...sourceFiles(p))
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

describe('Sentry: colectarea de date', () => {
  it('SP1: fiecare categorie e oprită explicit', () => {
    expect(SENTRY_DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    })
    expect(SENTRY_DATA_COLLECTION_IS_EXHAUSTIVE).toBe(true)
  })

  it('SP2: init-ul o folosește, iar `sendDefaultPii` nu mai apare ca opțiune', () => {
    const main = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8')
    const inits = main.match(/Sentry\.init\(\{[\s\S]*?\n {2}\}\)/g) ?? []
    expect(inits).toHaveLength(1)
    expect(inits[0]).toMatch(/\bdataCollection: SENTRY_DATA_COLLECTION,/)
    expect(inits[0]).toMatch(/\n {4}beforeSendSpan\(span\) \{\n {6}return scrubTokenPathsDeep\(span\)\n {4}\},/)
    // Pe COD, nu pe comentarii (comentariul din init explică de ce lipsesc).
    const code = inits[0].replace(/\/\/.*$/gm, '')
    expect(code).not.toContain('beforeSendTransaction')
    expect(code).not.toContain('traceLifecycle')

    const offenders = sourceFiles(join(ROOT, 'src')).filter((f) =>
      /\bsendDefaultPii\s*:/.test(readFileSync(f, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('SP3: un span v11 iese fără tokenul din cale și fără fragmentul de autentificare', () => {
    const span = {
      trace_id: 't1',
      span_id: 's1',
      name: 'Pageload',
      start_timestamp: 1,
      status: 'ok' as const,
      is_segment: true,
      attributes: {
        'url.full':
          'https://menuvia.ro/reset-password#access_token=eyJhbGciOi.JWT.SIG&refresh_token=RT_SECRET&type=recovery',
        'url.path': '/invite/INV_TOKEN_123',
        'sentry.segment.name': '/q/QR_TOKEN_456',
        // Atribut cu formă de obiect (valoare + tip), cum îl acceptă SDK-ul.
        'app.route': { value: '/echipa/TEAM_TOKEN_789', type: 'string' },
        'http.response.status_code': 200,
      },
    }
    const out = scrubTokenPathsDeep(span)
    expect(out.attributes['url.full']).toBe(
      'https://menuvia.ro/reset-password#access_token=[redacted]&refresh_token=[redacted]&type=recovery',
    )
    expect(out.attributes['url.path']).toBe('/invite/:token')
    expect(out.attributes['sentry.segment.name']).toBe('/q/:token')
    expect(out.attributes['app.route']).toEqual({ value: '/echipa/:token', type: 'string' })
    expect(out.attributes['http.response.status_code']).toBe(200)
    expect(out.name).toBe('Pageload')
    expect(JSON.stringify(out)).not.toMatch(/INV_TOKEN|QR_TOKEN|TEAM_TOKEN|eyJhbGciOi|RT_SECRET/)
  })
})

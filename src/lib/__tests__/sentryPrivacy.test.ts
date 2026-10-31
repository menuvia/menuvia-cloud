// Ce trimite Sentry din browser (Sentry 11: `sendDefaultPii` → `dataCollection`,
// cu implicitul INVERSAT — nesetat înseamnă „colectează tot”).
//
//   SP1  fiecare categorie de date e oprită, exact (o cheie ștearsă sau trecută
//        pe true pică — implicitul ei ar fi colectarea)
//   SP2  `Sentry.init` din main.tsx primește configurația, iar nimeni din `src/`
//        nu mai setează `sendDefaultPii` (opțiune scoasă, ignorată tăcut în JS)
//
// Categoriile NOI dintr-un SDK viitor le prinde typecheck-ul, nu testul:
// SENTRY_DATA_COLLECTION_IS_EXHAUSTIVE din lib/sentryPrivacy.ts.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { SENTRY_DATA_COLLECTION, SENTRY_DATA_COLLECTION_IS_EXHAUSTIVE } from '../sentryPrivacy'

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

    const offenders = sourceFiles(join(ROOT, 'src')).filter((f) =>
      /\bsendDefaultPii\s*:/.test(readFileSync(f, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})

// Preconnect-ul spre Supabase din index.html (perf-guest-4, audit oct 2026).
//
//   IH1  DOUĂ preconnect-uri pe originea din build (`%VITE_SUPABASE_URL%`):
//        unul `crossorigin` (RPC-urile supabase-js, fetch CORS) și unul fără
//        (imaginile din Storage, inclusiv cover-ul LCP). Browserul ține pool-uri
//        separate; înainte se încălzea doar primul, deci cover-ul deschidea o
//        conexiune nouă. Control: preconnect-urile Google Fonts rămân.
//   IH2  niciun URL `*.supabase.co` scris de mână: originea de producție era
//        lipită în fișier (comentariul spunea „Vite substituie…", dar nu exista
//        nimic de substituit), deci preview-urile și E2E-ul încălzeau producția.
//
// Mutații care pică: scoaterea preconnect-ului fără `crossorigin` → IH1;
// URL-ul de producție înapoi în href → IH1 + IH2.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
// Comentariile HTML pot pomeni tiparele — se scot înainte de analiză.
const markup = html.replace(/<!--[\s\S]*?-->/g, '')
const links = markup.match(/<link\b[^>]*>/g) ?? []

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\b${name}(?:\\s*=\\s*"([^"]*)")?(?=[\\s/>])`))
  return m ? (m[1] ?? '') : null
}

describe('index.html — preconnect spre Supabase', () => {
  it('IH1 două preconnect-uri pe originea din build, cu și fără crossorigin', () => {
    const preconnects = links.filter((l) => attr(l, 'rel') === 'preconnect')
    const supa = preconnects.filter((l) => attr(l, 'href') === '%VITE_SUPABASE_URL%')
    expect(supa).toHaveLength(2)
    expect(supa.filter((l) => attr(l, 'crossorigin') != null)).toHaveLength(1)
    expect(supa.filter((l) => attr(l, 'crossorigin') == null)).toHaveLength(1)

    // Control pozitiv: parserul vede și celelalte preconnect-uri.
    const gstatic = preconnects.find((l) => attr(l, 'href') === 'https://fonts.gstatic.com')
    expect(gstatic).toBeDefined()
    expect(attr(gstatic ?? '', 'crossorigin')).not.toBeNull()
  })

  it('IH2 niciun URL Supabase scris de mână în index.html', () => {
    expect(html).not.toMatch(/[a-z0-9-]+\.supabase\.co/i)
  })
})

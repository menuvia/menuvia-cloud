// Inelul de focus la tastatură (audit a11y oct 2026). Zeci de câmpuri și
// butoane au `outline: 'none'` în stilul inline din JSX; un stil inline bate
// orice selector din foaie fără `!important`, deci regula globală
// `:focus-visible` nu se aplica pe ele și focusul era INVIZIBIL. Vitest rulează
// cu `css: false`, deci verificarea e pe sursa CSS (clichet), nu pe stilul
// calculat. Ce păzesc:
//   FR1  regula globală `:focus-visible` are `outline … !important` (mutația:
//        scoate `!important` → inline-ul câștigă din nou).
//   FR2  singura regulă care stinge inelul e cea pentru DIALOGUL focusat
//        programatic de FocusTrap (`[role='dialog'][tabindex='-1']`) — o regulă
//        nouă `…:focus-visible { outline: none }` pe altceva pică, inclusiv una
//        lărgită la orice `[tabindex='-1']` (ar stinge inelul taburilor cu
//        roving tabindex, focusate cât încă au -1).
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const STYLES = resolve(process.cwd(), 'src/styles')

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === '__tests__'
        ? []
        : cssFiles(join(dir, e.name))
      : e.name.endsWith('.css')
        ? [join(dir, e.name)]
        : [],
  )
}

/** Regulile `selector { corp }` dintr-o foaie, fără comentarii. */
function rules(css: string): { selector: string; body: string }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: { selector: string; body: string }[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean)) !== null) out.push({ selector: m[1].trim(), body: m[2] })
  return out
}

describe('inelul de focus', () => {
  it('FR1: `:focus-visible` global bate `outline: none` din stilurile inline', () => {
    const globalRules = rules(readFileSync(join(STYLES, 'global.css'), 'utf8'))
    const ring = globalRules.find((r) => r.selector === ':focus-visible')
    expect(ring, 'regula :focus-visible din global.css').toBeDefined()
    expect(ring?.body).toMatch(/outline:\s*2px solid var\(--color-gold\)\s*!important/)
  })

  it('FR2: doar dialogul focusat programatic își stinge inelul', () => {
    const offenders: string[] = []
    for (const file of cssFiles(STYLES)) {
      for (const r of rules(readFileSync(file, 'utf8'))) {
        if (!r.selector.includes(':focus-visible')) continue
        if (!/outline:\s*(none|0)\b/.test(r.body)) continue
        if (r.selector === "[role='dialog'][tabindex='-1']:focus-visible") continue
        offenders.push(`${file}: ${r.selector}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

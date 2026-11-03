// tests/functions/ui-toast-ratchet.test.js
// CLICHET: panoul are UN singur sistem de notificări (lotul V, recenzia #336).
//
// `ui/Toast` (ToastProvider + viewport) e sursa; `sharedUI` păstrează API-ul
// vechi `{ toasts, toast }` + `<Toast toasts />` și DELEAGĂ la el. TablesManager
// și TeamManager aveau fiecare câte o copie locală (fixă jos-dreapta, fără
// regiune live, cu altă durată și alt aspect) — a doua a scăpat primei măturări.
//
//   TS0  CONTROL POZITIV pe surse SINTETICE: detectorul prinde `function
//        useToast()`, `function Toast(`, `const useToast = …` și `export function
//        Toast(`; NU prinde un IMPORT al lor, un apel `useToast()` sau un
//        comentariu.
//   TS1  nicio definiție de useToast/Toast în src/components + src/pages în afara
//        `ui/` și `_dashboard/sharedUI.tsx`. Mutația care îl pică: copia locală
//        readusă în TeamManager.tsx (verificat).
//   TS2  toast.css: corpul toast-ului NU prinde click-urile (`.toast-viewport`
//        și `.toast` au `pointer-events: none`), doar `.toast__close` le primește
//        — sus, pe toată lățimea pe mobil, un toast `pointer-events: auto`
//        intercepta 3,5–6,5 s tap-urile pe antet și pe foi. Mutația care îl pică:
//        `.toast { pointer-events: auto }` (verificat).
//
// Rulează în jobul „Bridge tests" (`cd tests/functions && npm test`).
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { uiFiles, read, stripComments } = require('./helpers/uiSourceScan')

const TOAST_DEF_RE = /(?:^|\n)\s*(?:export\s+)?(?:function\s+(?:useToast|Toast)\s*\(|const\s+(?:useToast|Toast)\s*=)/

const OWNERS = new Set(['src/components/_dashboard/sharedUI.tsx'])
const isOwner = (f) => OWNERS.has(f) || f.startsWith('src/components/ui/')

function definesToast(src) {
  return TOAST_DEF_RE.test(stripComments(src))
}

/** Corpul regulii CSS cu selectorul EXACT dat (prima apariție). */
function cssRule(css, selector) {
  const re = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
  const m = css.match(re)
  return m ? m[1] : null
}

describe('clichet: un singur sistem de toast', () => {
  it('TS0 control pozitiv: detectorul prinde definițiile, nu importurile și apelurile', () => {
    for (const s of [
      'function useToast() {\n  return 1\n}',
      'function Toast({ toasts }: P) {',
      'export function Toast({ toasts }) {',
      'const useToast = () => ({})',
    ]) {
      assert.ok(definesToast(s), `ar trebui prinsă: ${s}`)
    }
    for (const s of [
      "import { useToast, Toast } from './_dashboard/sharedUI'",
      'const { toasts, toast } = useToast()',
      '<Toast toasts={toasts} />',
      '// function useToast() { — comentariu',
      'function ToastCard({ toast }) {',
    ]) {
      assert.equal(definesToast(s), false, `nu trebuie prinsă: ${s}`)
    }
  })

  it('TS1 nicio implementare locală de toast în afara ui/ și sharedUI', () => {
    const files = uiFiles()
    const bad = files.filter((f) => !isOwner(f) && definesToast(read(f)))
    assert.deepEqual(
      bad,
      [],
      'Toast local — folosește `useToast`/`Toast` din _dashboard/sharedUI (API vechi) sau ' +
        '`useToast` din ui/useToast. În interiorul unui dialog `aria-modal`: `useToast({ local: true })` ' +
        '+ `<Toast toasts={…} local />`.',
    )
    // Anti-vacuitate: proprietarii chiar definesc toast-ul (altfel TS1 ar trece și
    // cu un detector stricat).
    assert.ok(definesToast(read('src/components/_dashboard/sharedUI.tsx')))
    assert.ok(definesToast(read('src/components/ui/useToast.ts')))
  })

  it('TS2 toast-ul nu interceptează click-urile, doar butonul de închidere', () => {
    // Fără comentarii: explicația din CSS pomenește chiar `pointer-events: auto`.
    const css = read('src/styles/components/toast.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const viewport = cssRule(css, '.toast-viewport')
    const body = cssRule(css, '.toast')
    const close = cssRule(css, '.toast__close')
    assert.ok(viewport && body && close, 'regulile .toast-viewport / .toast / .toast__close lipsesc')
    assert.match(viewport, /pointer-events:\s*none/)
    assert.match(body, /pointer-events:\s*none/)
    assert.match(close, /pointer-events:\s*auto/)
    // Nicio altă regulă nu repornește click-urile pe corp/mesaj/iconiță.
    const autos = [...css.matchAll(/(?:^|\n)([^{}\n]+)\{[^}]*pointer-events:\s*auto/g)].map((m) => m[1].trim())
    assert.deepEqual(autos, ['.toast__close'])
  })
})

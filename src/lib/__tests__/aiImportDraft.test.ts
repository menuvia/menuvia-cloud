// Importul AI al meniului nu mai pierde munca (pachetul 10).
//
//   DR1  draftul se salvează și se reia (control pozitiv), per restaurant
//   DR2  STORAGE care ARUNCĂ (Safari „Block All Cookies”, webview-uri): save / load /
//        clear nu aruncă niciodată — fail-open (clasa RESID-15), iar fără storage
//        importul merge ca înainte
//   DR3  draft expirat / corupt / de altă formă / cu rânduri invalide → ignorat
//   DR4  la reluare, categoriile dispărute între timp se re-potrivesc pe nume
//   DR5  plafonul planului: UN singur mesaj, înainte de salvare; eroarea de la
//        server (hint product_limit) e recunoscută
//   DR6  promptul: pentru RON/ro e IDENTIC cu cel de dinainte; pentru alte monede /
//        limbi se schimbă doar prețurile + „nu traduce”
import { describe, it, expect } from 'vitest'
import {
  IMPORT_DRAFT_TTL_MS,
  buildMenuImportPrompt,
  clearImportDraft,
  describeProductLimit,
  isProductLimitError,
  loadImportDraft,
  reconcileDraftCategories,
  saveImportDraft,
  type ImportDraftProduct,
} from '../aiImportDraft'

function memStorage() {
  const m = new Map<string, string>()
  return {
    m,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

const throwing = {
  getItem: (): string | null => {
    throw new DOMException('denied', 'SecurityError')
  },
  setItem: (): void => {
    throw new DOMException('denied', 'SecurityError')
  },
  removeItem: (): void => {
    throw new DOMException('denied', 'SecurityError')
  },
}

function draft(over: Partial<ImportDraftProduct> = {}): ImportDraftProduct {
  return {
    name: 'Pizza',
    description: '',
    price: 32,
    emoji: '🍕',
    category_id: '',
    category_name: 'Pizza',
    include: true,
    ...over,
  }
}

const NOW = 1_800_000_000_000

describe('draftul importului', () => {
  it('DR1: se salvează și se reia, per restaurant', () => {
    const st = memStorage()
    saveImportDraft('r1', [draft(), draft({ name: 'Paste', price: 28 })], NOW, st)
    const got = loadImportDraft('r1', NOW + 60_000, st)
    expect(got?.drafts.map((d) => d.name)).toEqual(['Pizza', 'Paste'])
    expect(got?.savedAt).toBe(NOW)
    // Alt restaurant: nimic (draftul unui local nu apare la altul).
    expect(loadImportDraft('r2', NOW, st)).toBeNull()
    // Listă goală = ștergere; clear explicit la fel.
    saveImportDraft('r1', [], NOW, st)
    expect(loadImportDraft('r1', NOW, st)).toBeNull()
    saveImportDraft('r1', [draft()], NOW, st)
    clearImportDraft('r1', st)
    expect(st.m.size).toBe(0)
  })

  it('DR2: storage care ARUNCĂ — nicio funcție nu aruncă, load întoarce null', () => {
    expect(() => saveImportDraft('r1', [draft()], NOW, throwing)).not.toThrow()
    expect(() => clearImportDraft('r1', throwing)).not.toThrow()
    expect(loadImportDraft('r1', NOW, throwing)).toBeNull()
    // Fără storage deloc (SSR / acces care aruncă la obținerea obiectului).
    expect(() => saveImportDraft('r1', [draft()], NOW, null)).not.toThrow()
    expect(loadImportDraft('r1', NOW, null)).toBeNull()
    expect(() => clearImportDraft('r1', null)).not.toThrow()
  })

  it('DR3a: expirat / din viitor îndepărtat → ignorat și șters', () => {
    const st = memStorage()
    saveImportDraft('r1', [draft()], NOW, st)
    expect(loadImportDraft('r1', NOW + IMPORT_DRAFT_TTL_MS - 1, st)).not.toBeNull()
    expect(loadImportDraft('r1', NOW + IMPORT_DRAFT_TTL_MS + 1, st)).toBeNull()
    expect(st.m.size).toBe(0)
    saveImportDraft('r1', [draft()], NOW + 3_600_000, st) // ceas dat greșit: din viitor
    expect(loadImportDraft('r1', NOW, st)).toBeNull()
  })

  it('DR3b: JSON corupt / altă formă / rânduri invalide', () => {
    const st = memStorage()
    st.setItem('menuvia.ai_import_draft.r1', '{nu e json')
    expect(loadImportDraft('r1', NOW, st)).toBeNull()
    st.setItem('menuvia.ai_import_draft.r1', JSON.stringify({ v: 2, savedAt: NOW, drafts: [draft()] }))
    expect(loadImportDraft('r1', NOW, st)).toBeNull()
    st.setItem('menuvia.ai_import_draft.r1', JSON.stringify({ v: 1, savedAt: NOW, drafts: 'x' }))
    expect(loadImportDraft('r1', NOW, st)).toBeNull()
    // Rânduri invalide (preț negativ / NaN-as-null / câmp lipsă) se elimină, restul rămân.
    st.setItem(
      'menuvia.ai_import_draft.r1',
      JSON.stringify({
        v: 1,
        savedAt: NOW,
        drafts: [draft(), { ...draft(), price: -1 }, { ...draft(), price: null }, { name: 'x' }, null, 7],
      }),
    )
    expect(loadImportDraft('r1', NOW, st)?.drafts).toHaveLength(1)
    // Niciun rând valid → draftul se șterge (nu rămâne un banner „Reia” gol).
    st.setItem('menuvia.ai_import_draft.r1', JSON.stringify({ v: 1, savedAt: NOW, drafts: [{ name: 'x' }] }))
    expect(loadImportDraft('r1', NOW, st)).toBeNull()
    expect(st.m.size).toBe(0)
  })

  it('DR4: categoriile dispărute se re-potrivesc pe nume; cele existente rămân', () => {
    const out = reconcileDraftCategories(
      [
        draft({ category_id: 'c-vechi', category_name: 'Băuturi' }),
        draft({ category_id: 'c-ok', category_name: 'Pizza' }),
        draft({ category_id: 'c-vechi2', category_name: '' }),
        draft({ category_id: 'new:Deserturi', category_name: 'Deserturi' }),
        draft({ category_id: '', category_name: '' }),
      ],
      new Set(['c-ok']),
    )
    expect(out.map((d) => d.category_id)).toEqual(['new:Băuturi', 'c-ok', '', 'new:Deserturi', ''])
  })
})

describe('plafonul planului', () => {
  it('DR5a: UN singur mesaj, doar când selecția depășește locurile rămase', () => {
    expect(describeProductLimit(5, undefined)).toBeNull() // necunoscut → decide serverul
    expect(describeProductLimit(5, 5)).toBeNull()
    expect(describeProductLimit(0, 0)).toBeNull()
    const m = describeProductLimit(20, 12)
    expect(m).toMatch(/mai permite 12 produse/)
    expect(m).toMatch(/selectat 20/)
    expect(m).toMatch(/Debifează 8 produse/)
    expect(m).toMatch(/Nimic nu a fost salvat/)
    expect(describeProductLimit(3, 2)).toMatch(/mai permite 2 produse.*Debifează 1 produs /)
    expect(describeProductLimit(3, 1)).toMatch(/mai permite 1 produs,/)
    expect(describeProductLimit(1, 0)).toMatch(/atins limita de produse/)
  })

  it('DR5b: eroarea de plafon a serverului e recunoscută; alte erori nu', () => {
    expect(isProductLimitError({ hint: 'product_limit', message: 'x' })).toBe(true)
    expect(isProductLimitError({ message: 'Limită produse atinsă: maxim 15 pe planul curent.' })).toBe(true)
    expect(isProductLimitError({ message: 'Limita produse atinsa' })).toBe(true)
    expect(isProductLimitError({ details: 'product_limit' })).toBe(true)
    expect(isProductLimitError({ message: 'duplicate key', code: '23505' })).toBe(false)
    expect(isProductLimitError(null)).toBe(false)
    expect(isProductLimitError('Limită produse')).toBe(false)
    expect(isProductLimitError(undefined)).toBe(false)
  })
})

// Promptul de dinainte de pachetul 10, LITERAL.
const OLD_PROMPT =
  'Extrage toate produsele din aceste poze de meniu (pot fi mai multe pagini ale ACELUIAȘI meniu). ' +
  'Returnează DOAR un JSON array, fără markdown, cu obiecte de forma ' +
  '{"name": string, "description": string|null, "price": number, "emoji": string, "category": string|null}. ' +
  'Prețurile în lei (număr fără simbol). Emoji relevant pentru fiecare produs. ' +
  '"category" = numele secțiunii din meniu în care apare produsul (ex. "Feluri principale", "Băuturi") — ' +
  'folosește EXACT același nume pentru toate produsele din aceeași secțiune; null dacă nu e clar.'

describe('promptul de import', () => {
  it('DR6a: RON / ro / necunoscut → IDENTIC cu promptul de dinainte', () => {
    expect(buildMenuImportPrompt({ currency: 'RON', language: 'ro' })).toBe(OLD_PROMPT)
    expect(buildMenuImportPrompt({})).toBe(OLD_PROMPT)
    expect(buildMenuImportPrompt({ currency: null, language: null })).toBe(OLD_PROMPT)
    expect(buildMenuImportPrompt({ currency: 'XXX', language: 'zz' })).toBe(OLD_PROMPT)
  })

  it('DR6b: altă monedă — fără „în lei”, cu moneda restaurantului și fără conversie', () => {
    const p = buildMenuImportPrompt({ currency: 'EUR', language: 'ro' })
    expect(p).not.toContain('în lei')
    expect(p).toContain('(EUR)')
    expect(p).toMatch(/FĂRĂ conversie/)
    // Restul promptului (forma JSON, categoriile) rămâne.
    expect(p).toContain('"category" = numele secțiunii')
    expect(p).toContain('Emoji relevant pentru fiecare produs.')
  })

  it('DR6c: limba de bază non-RO — păstrează textul din poză, nu traduce', () => {
    const p = buildMenuImportPrompt({ currency: 'RON', language: 'de' })
    expect(p.startsWith(OLD_PROMPT)).toBe(true)
    expect(p).toContain('germană')
    expect(p).toMatch(/fără să le traduci/)
    // Limbă necunoscută → nicio instrucțiune inventată.
    expect(buildMenuImportPrompt({ language: 'xx' })).not.toMatch(/traduci/)
  })
})

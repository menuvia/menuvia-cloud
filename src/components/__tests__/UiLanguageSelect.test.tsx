// Comutatorul COMPACT de limbă din antetul Ospătarului și al Bucătăriei
// (lotul L4c) — tiparul UC1–UC8 al cardului din Setări (UiLanguageCard.test),
// pe aceeași salvare: hook-ul comun `useSetUiLanguage`. Prefixul e LU (verificat
// cu grep, nefolosit înainte; UC = cardul, UL = asserțiile SQL ale coloanei).
//   LU1  o singură limbă activă → nimic randat; fără provider (implicit
//        `ENABLED_STAFF_LANGS`, toate patru din activarea limbilor) → select-ul
//        apare, în română, cu cele patru limbi. Mutațiile care pică: garda
//        `visible` scoasă; `ENABLED_STAFF_LANGS` readus la `['ro']`.
//   LU2  patru limbi, interfața în franceză: select-ul cu numele accesibil din
//        `common`, limba curentă aleasă, fiecare limbă în limba EI, cu `lang`.
//   LU3  alegerea: UPDATE pe `profiles` cu `{ ui_language }` și `.select('id')`,
//        select-ul dezactivat cât se salvează, stocarea locală scrisă ÎNAINTE
//        de `refreshProfile()`, chemat o dată.
//   LU4  refuzul serverului → `role="alert"` cu textul de rezervă, fără
//        stocare și fără reîncărcare, alegerea revine pe limba de dinainte.
//   LU5  coloana mig 323 lipsește (PGRST204, răspunsul real al PostgREST la un
//        UPDATE pe o coloană necunoscută) → mesajul propriu, în varianta SCURTĂ
//        (fără „Panoul rămâne…” al cardului — pe ecranele de lucru nu e panou).
//        Mutația care pică: verificarea doar pe 42703.
//   LU6  zero rânduri actualizate (RLS) → eroare de drepturi, nu „salvat”.
//   LU7  stocarea ARUNCĂ (Safari „Block All Cookies”) → salvat în cont, fără alertă.
//   LU8  în germană: numele accesibil și refuzul în germană (textul se traduce
//        la RANDARE, din DATELE erorii).
//   LU9  clichet STRUCTURAL: cardul din Setări și comutatorul compact folosesc
//        ACELAȘI hook și niciunul nu scrie singur în profil / stocare — o a
//        doua implementare a salvării ar diverge la prima schimbare. Plus:
//        comutatorul e montat în antetul ambelor ecrane. Mutația care pică:
//        logica de salvare copiată înapoi în UiLanguageCard.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Suspense } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

type UpdateResult = {
  data: { id: string }[] | null
  error: { code?: string; message: string } | null
}

const h = vi.hoisted(() => ({
  calls: [] as string[],
  result: { data: [{ id: 'u1' }], error: null } as UpdateResult,
  hold: null as Promise<void> | null,
  storedAtRefresh: [] as (string | null)[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: unknown) => {
        h.calls.push(`update:${table}:${JSON.stringify(payload)}`)
        return {
          eq: (col: string, val: string) => {
            h.calls.push(`eq:${col}:${val}`)
            return {
              select: async (cols: string) => {
                h.calls.push(`select:${cols}`)
                if (h.hold) await h.hold
                return h.result
              },
            }
          },
        }
      },
    }),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    refreshProfile: async () => {
      h.calls.push('refreshProfile')
      h.storedAtRefresh.push(window.localStorage.getItem('menuvia_ui_lang'))
    },
  }),
}))

import { UiLanguageSelect } from '../UiLanguageSelect'
import { UiLangScope } from '../../i18n/UiLangContext'
import { preloadNamespace } from '../../i18n/core'
import { commonNs } from '../../i18n/ns/common'
import type { StaffLang } from '../../i18n/langs'

const ALL: readonly StaffLang[] = ['ro', 'en', 'fr', 'de']
const NAMES = ['Română', 'English', 'Français', 'Deutsch']

beforeAll(async () => {
  const langs: StaffLang[] = ['fr', 'de']
  await Promise.all(langs.map((l) => preloadNamespace(commonNs, l)))
})

beforeEach(() => {
  h.calls = []
  h.result = { data: [{ id: 'u1' }], error: null }
  h.hold = null
  h.storedAtRefresh = []
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderSelect(lang: StaffLang, enabled: readonly StaffLang[]) {
  return render(
    <UiLangScope lang={lang} enabled={enabled}>
      <Suspense fallback={null}>
        <UiLanguageSelect />
      </Suspense>
    </UiLangScope>,
  )
}

const select = () => screen.getByRole('combobox', { name: 'Limba interfeței' }) as HTMLSelectElement

describe('UiLanguageSelect — comutatorul compact', () => {
  it('LU1: o singură limbă activă → nimic randat; fără provider → cele patru limbi', () => {
    const scoped = renderSelect('ro', ['ro'])
    expect(scoped.container.textContent).toBe('')
    expect(screen.queryByRole('combobox')).toBeNull()
    scoped.unmount()
    // Fără provider = valoarea implicită: din activare, toate patru limbile.
    render(<UiLanguageSelect />)
    const sel = select()
    expect(sel.value).toBe('ro')
    expect((within(sel).getAllByRole('option') as HTMLOptionElement[]).map((o) => o.textContent)).toEqual(NAMES)
  })

  it('LU2: patru limbi → limba curentă și numele în limba lor', () => {
    renderSelect('fr', ALL)
    const sel = screen.getByRole('combobox', { name: 'Langue de l’interface' }) as HTMLSelectElement
    expect(sel.value).toBe('fr')
    const opts = within(sel).getAllByRole('option') as HTMLOptionElement[]
    expect(opts.map((o) => o.textContent)).toEqual(NAMES)
    expect(opts.map((o) => o.lang)).toEqual([...ALL])
  })

  it('LU3: alegerea scrie în profil, apoi local, apoi reîncarcă profilul', async () => {
    let release: () => void = () => {}
    h.hold = new Promise<void>((r) => {
      release = r
    })
    renderSelect('ro', ALL)
    await userEvent.setup().selectOptions(select(), 'en')
    expect(h.calls).toEqual(['update:profiles:{"ui_language":"en"}', 'eq:id:u1', 'select:id'])
    expect(select()).toBeDisabled()
    expect(select().value).toBe('en')
    release()
    await waitFor(() => expect(h.calls).toContain('refreshProfile'))
    expect(h.calls.filter((c) => c === 'refreshProfile')).toHaveLength(1)
    expect(h.storedAtRefresh).toEqual(['en'])
    await waitFor(() => expect(select()).not.toBeDisabled())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('LU4: refuzul serverului → alertă, fără stocare și fără reîncărcare', async () => {
    h.result = { data: null, error: { code: 'XX000', message: 'boom' } }
    renderSelect('ro', ALL)
    await userEvent.setup().selectOptions(select(), 'de')
    expect(await screen.findByRole('alert')).toHaveTextContent('Limba nu s-a putut salva. Reîncearcă.')
    expect(window.localStorage.getItem('menuvia_ui_lang')).toBeNull()
    expect(h.calls).not.toContain('refreshProfile')
    expect(select().value).toBe('ro')
    expect(select()).not.toBeDisabled()
  })

  it('LU5: coloana lipsește (PGRST204) → mesajul despre actualizarea serverului', async () => {
    h.result = {
      data: null,
      error: { code: 'PGRST204', message: "Could not find the 'ui_language' column of 'profiles' in the schema cache" },
    }
    renderSelect('ro', ALL)
    await userEvent.setup().selectOptions(select(), 'fr')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('serverul nu are ultima actualizare')
    expect(alert).not.toHaveTextContent('Limba nu s-a putut salva')
    // Varianta scurtă: pe Ospătar/Bucătărie nu e niciun panou de pomenit.
    expect(alert).toHaveTextContent('Limba nu se poate salva încă: serverul nu are ultima actualizare.')
    expect(alert).not.toHaveTextContent('Panoul')
    expect(h.calls).not.toContain('refreshProfile')
  })

  it('LU6: zero rânduri actualizate → eroare de drepturi, nu „salvat”', async () => {
    h.result = { data: [], error: null }
    renderSelect('ro', ALL)
    await userEvent.setup().selectOptions(select(), 'en')
    expect(await screen.findByRole('alert')).toHaveTextContent('Nu ai drepturi pentru această acțiune.')
    expect(window.localStorage.getItem('menuvia_ui_lang')).toBeNull()
    expect(h.calls).not.toContain('refreshProfile')
  })

  it('LU7: stocarea aruncă → limba se salvează în cont, fără alertă', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    renderSelect('ro', ALL)
    await userEvent.setup().selectOptions(select(), 'en')
    await waitFor(() => expect(h.calls).toContain('refreshProfile'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('LU8: în germană — numele accesibil și refuzul în germană', async () => {
    h.result = { data: null, error: { code: 'XX000', message: 'boom' } }
    renderSelect('de', ALL)
    const sel = screen.getByRole('combobox', { name: 'Sprache der Oberfläche' }) as HTMLSelectElement
    expect(sel.value).toBe('de')
    await userEvent.setup().selectOptions(sel, 'en')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Sprache konnte nicht gespeichert werden. Versuchen Sie es erneut.',
    )
    expect(document.body.textContent ?? '').not.toMatch(/Limba|boom/)
    expect(sel.value).toBe('de')
  })
})

describe('un singur drum de salvare pentru ambele comutatoare', () => {
  const ROOT = process.cwd()
  const src = (f: string): string => readFileSync(resolve(ROOT, f), 'utf8')
  // Fără comentarii: un comentariu care pomenește `refreshProfile` nu e cod.
  const code = (f: string): string => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('LU9: UiLanguageCard și UiLanguageSelect folosesc ACELAȘI hook; antetele îl montează', () => {
    const hook = code('src/i18n/useSetUiLanguage.ts')
    // Control pozitiv: tiparele chiar se găsesc acolo unde stă salvarea.
    for (const re of [/\.from\('profiles'\)/, /zeroRowsAsDenied/, /localStorage/, /refreshProfile\(\)/]) {
      expect(hook, String(re)).toMatch(re)
    }
    for (const f of ['src/components/UiLanguageCard.tsx', 'src/components/UiLanguageSelect.tsx']) {
      const c = code(f)
      expect(c, f).toMatch(/import \{[^}]*\buseSetUiLanguage\b[^}]*\} from '\.\.\/i18n\/useSetUiLanguage'/)
      expect(c, f).toMatch(/useSetUiLanguage\(\)/)
      for (const re of [/\bsupabase\b/, /\.from\(/, /localStorage/, /refreshProfile/, /zeroRowsAsDenied/]) {
        expect(c, `${f}: ${String(re)}`).not.toMatch(re)
      }
    }
    for (const f of ['src/pages/WaiterPage.tsx', 'src/pages/KitchenPage.tsx']) {
      expect(code(f), f).toMatch(/<UiLanguageSelect \/>/)
    }
  })
})
